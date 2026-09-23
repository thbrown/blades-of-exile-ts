/**
 * Render `preview.png` — the terrain view as a new game starts — for each
 * bundled scenario, for its card on the startup screen. It drives the real
 * game in Chromium (`?scenario=<id>` starts a fresh game with the default
 * party) and crops the terrain view off the canvas, so the picture is exactly
 * what a player sees. Installed scenarios take the same picture in the browser
 * the first time they're played (`render/preview.ts`).
 *
 * Needs `npx vite --port 5199` running.
 *
 * Usage: node scripts/scenario-previews.mjs [id ...]
 */

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5199/';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['valleydy', 'stealth', 'zakhazi', 'busywork'];
// WIN_RECTS.terView (render/layout.ts).
const TER = { top: 7, left: 19, bottom: 358, right: 298 };

const browser = await chromium.launch();
for (const id of ids) {
  const page = await browser.newPage();
  await page.goto(`${BASE}?scenario=${encodeURIComponent(id)}`);
  await page.waitForFunction(() => window.__session !== undefined, null, { timeout: 60000 });
  const dataUrl = await page.evaluate((r) => {
    const canvas = document.getElementById('canvas');
    const crop = document.createElement('canvas');
    crop.width = r.right - r.left;
    crop.height = r.bottom - r.top;
    crop.getContext('2d').drawImage(canvas, r.left, r.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return crop.toDataURL('image/png');
  }, TER);
  writeFileSync(`public/scenarios/${id}/preview.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`public/scenarios/${id}/preview.png`);
  await page.close();
}
await browser.close();
