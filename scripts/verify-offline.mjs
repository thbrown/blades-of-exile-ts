// The PWA's offline gate: loads a production build once online, lets the
// service worker (src/platform/serviceWorker.js) precache it, then cuts the
// network and checks the startup screen comes back and a bundled scenario
// starts with every request answered from the cache. Needs a build served
// under its real base path — the dev server has no worker:
//   npx vite build --outDir /tmp/boe-site
//   npx vite preview --base /blades-of-exile-ts/ --outDir /tmp/boe-site --port 4173
//   node scripts/verify-offline.mjs [http://localhost:4173/blades-of-exile-ts/]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-shots';
mkdirSync(SHOTS, { recursive: true });
const url = process.argv[2] ?? 'http://localhost:4173/blades-of-exile-ts/';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));

await page.goto(url);
await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
// Installed (the whole precache fetched) and in control of this page.
const version = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }));
  }
  return (await caches.keys()).join(', ') + ` (scope ${reg.scope})`;
});
console.log('CACHES:', version);

await context.setOffline(true);
await page.reload();
await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/offline-00-startup.png` });
await page.locator('.startup .startup-choice', { hasText: 'Valley of Dying Things' }).first().click();
// A new game: new-party.xml, the party editor, the intro — then the start
// town, drawn from the cached terrain and monster sheets.
const dialogHas = (name) => page.waitForFunction(
  (n) => window.__dialogs?.active?.def?.byName.has(n), name, { timeout: 30000 });
await dialogHas('okay');
await page.keyboard.press('Enter'); // Create
await dialogHas('delete6');
await page.keyboard.press('Enter'); // Done
await dialogHas('str1');
await page.keyboard.press('Enter'); // the intro's Done
await page.waitForTimeout(600);
const town = await page.evaluate(() => ({
  inTown: window.__session.inTown, town: window.__session.univ.town?.record.name,
}));
await page.screenshot({ path: `${SHOTS}/offline-01-start-town.png` });
console.log('START TOWN:', JSON.stringify(town));
if (!town.inTown) errors.push('the new game did not start in its start town');

// A page's query string isn't part of what was cached; it still loads.
await page.goto(`${url}?scenario=stealth`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/offline-02-query.png` });

await browser.close();
if (errors.length) {
  console.log('FAIL offline:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('OK offline: the startup screen, a new game in its start town and a ?query page, with no network');
