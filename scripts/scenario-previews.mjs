/**
 * Render `preview.png` — the terrain view as a new game starts — for each
 * bundled scenario, for its card on the startup screen. It drives the real
 * game in Chromium (`?scenario=<id>` starts a fresh game with the default
 * party) and crops the terrain view off the canvas, so the picture is exactly
 * what a player sees. Installed scenarios take the same picture in the browser
 * the first time they're played (`render/preview.ts`).
 *
 * `--library` does the same for every entry in the scenario library
 * (`library/dist/catalog.json`), writing `library/dist/previews/<id>.png`:
 * each is installed by clicking its card, as a player would, and then opened
 * with `?scenario=`. Re-run `scripts/build-library.ts` afterwards so the
 * catalog points at them. Entries that already have a preview are skipped.
 *
 * Needs `npx vite --port 5199` running.
 *
 * Usage: node scripts/scenario-previews.mjs [id ...]
 *        node scripts/scenario-previews.mjs --library
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5199/';
const library = process.argv.includes('--library');
const args = process.argv.slice(2).filter((a) => a !== '--library');
const ids = library
  ? JSON.parse(readFileSync('library/dist/catalog.json', 'utf8')).scenarios.map((e) => e.id)
    .filter((id) => !existsSync(`library/dist/previews/${id}.png`))
  : args.length ? args : ['valleydy', 'stealth', 'zakhazi', 'busywork'];
const outPath = (id) => (library ? `library/dist/previews/${id}.png` : `public/scenarios/${id}/preview.png`);
// WIN_RECTS.terView (render/layout.ts).
const TER = { top: 7, left: 19, bottom: 358, right: 298 };

const browser = await chromium.launch();
// One context, so what the library installs persists between pages.
const context = await browser.newContext();
for (const id of ids) {
  const page = await context.newPage();
  try {
    if (library) {
      await page.goto(BASE);
      const card = `.startup [data-library="${id}"]`;
      await page.waitForSelector(card, { timeout: 20000 });
      await page.click(card);
      // Installed once the party editor comes up.
      await page.waitForFunction(() => window.__dialogs?.active?.def?.byName.has('okay'), null, { timeout: 60000 });
    }
    await page.goto(`${BASE}?scenario=${encodeURIComponent(id)}`);
    await page.waitForFunction(() => window.__session !== undefined && window.__desktop, null, { timeout: 60000 });
    const dataUrl = await page.evaluate((r) => {
      const canvas = document.getElementById('canvas');
      // The game screen sits at an offset on the desktop (render/desktop.ts).
      const { gameX, gameY } = window.__desktop;
      const crop = document.createElement('canvas');
      crop.width = r.right - r.left;
      crop.height = r.bottom - r.top;
      crop.getContext('2d').drawImage(canvas, gameX + r.left, gameY + r.top, crop.width, crop.height,
        0, 0, crop.width, crop.height);
      return crop.toDataURL('image/png');
    }, TER);
    writeFileSync(outPath(id), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(outPath(id));
  } catch (err) {
    console.log(`${id}: FAILED ${err.message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
