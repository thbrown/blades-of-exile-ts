/**
 * What autosaving costs a player, measured in Chromium: the main-thread time of
 * a save's synchronous half, and whether walking with a save on *every* move
 * (the stress case; the default is every 10) produces frames or long tasks that
 * walking with saving off doesn't.
 *
 * Needs `npx vite --port 5199`. `CHROMIUM_PATH=...` for an installed Chromium.
 */

import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5199/';
const SCEN = process.argv[3] ?? 'valleydy';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function run(every) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  await page.addInitScript((n) => {
    localStorage.setItem('exile-js:prefs', JSON.stringify({
      ShowInstantHelp: false, DisplayMode: 5, UIScale: 2, Autosave_Every: n,
    }));
    window.__long = [];
    window.__frames = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); })
      .observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, every);
  await page.goto(`${BASE}?scenario=${SCEN}&pace=1`);
  await page.waitForFunction(() => window.__session !== undefined, { timeout: 30000 });
  await page.waitForTimeout(1000);
  while (await page.evaluate(() => !!window.__dialogs?.active)) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__scheduler.saveNow('Manual', 'manual')); // so a direct link autosaves
  // Sync cost of what a save does on the main thread.
  const sync = await page.evaluate(async () => {
    const io = await import('/src/fileio/saveIo.ts');
    const prev = await import('/src/render/preview.ts');
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      io.serialiseSave(window.__univ).serialise();
      io.previewOfUniverse(window.__univ);
      void prev.captureSaveThumb(document.querySelector('canvas'));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[15], p95: times[28] };
  });
  await page.evaluate(() => { window.__long.length = 0; window.__frames.length = 0; });
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press(keys[i % 4]);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__scheduler.settled());
  const out = await page.evaluate(async () => {
    const store = await import('/src/platform/saveStore.ts');
    const f = [...window.__frames].sort((a, b) => a - b);
    return {
      snaps: (await store.listSnaps(window.__univ.seriesId)).length,
      bytes: (await store.getSeries(window.__univ.seriesId)).bytes,
      longTasks: window.__long.length, longest: Math.max(0, ...window.__long),
      frames: f.length, p95Frame: f[Math.floor(f.length * 0.95)], worstFrame: f[f.length - 1],
    };
  });
  await page.close();
  return { every, sync, ...out };
}

for (const every of [0, 10, 1]) console.log(JSON.stringify(await run(every)));
await browser.close();
