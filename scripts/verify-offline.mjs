// The PWA's offline gate. Serves a production build, loads it and plays one
// bundled scenario, which is what makes the service worker
// (src/platform/serviceWorker.js) keep it; then **stops the server** and
// checks the startup screen comes back with every card, that scenario starts
// again (and by a `?scenario=` link), and one never played does not. The
// dev server has no worker, so this needs a build:
//   npx vite build --outDir /tmp/boe-site
//   node scripts/verify-offline.mjs /tmp/boe-site      # serves it on :4173
//
// Stopping the server, not Playwright's `context.setOffline`: that cuts the
// page off but not the worker's own fetches, so with it a scenario never
// cached still loads "offline", straight through the worker.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-shots';
mkdirSync(SHOTS, { recursive: true });
const outDir = process.argv[2] ?? '/tmp/boe-site';
const port = process.env.PORT ?? '4173';
const url = `http://localhost:${port}/blades-of-exile-ts/`;

const server = spawn('npx', ['vite', 'preview', '--base', '/blades-of-exile-ts/', '--outDir', outDir,
  '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => { if (String(d).includes(`:${port}`)) res(); });
  server.on('exit', (code) => rej(new Error(`vite preview exited (${code})`)));
});
const stopServer = () => { try { process.kill(-server.pid); } catch { /* already gone */ } };
process.on('exit', stopServer);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
let errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
// Chromium logs a 404 without saying which URL, so 404s are judged by their
// responses instead: offline, only two kinds are expected. A library preview
// is kept only once shown, and the startup screen shows each lazily, so those
// never scrolled to come back 404 (the card drops them); and Exile III's
// `scenario.xml` is a 404 on the published site online too (it isn't
// shipped; the card is fixed).
const EXPECTED_404 = [/\/library\/previews\//, /\/scenarios\/exile3\/scenario\.xml$/];
let notFound = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
const realErrors = () => [
  ...errors.filter((e) => !e.includes('status of 404')),
  ...notFound.filter((u) => !EXPECTED_404.some((re) => re.test(u))).map((u) => `404: ${u}`),
];
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

/**
 * From the startup screen, a new game into the start town. The first time,
 * a party is made on the way in (new-party.xml, then the party editor); after
 * that the party in memory goes straight in. Either way the intro comes up.
 */
const newGame = async (title) => {
  await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
  await page.locator('.startup .startup-choice', { hasText: title }).first().click();
  for (;;) {
    const up = await (await page.waitForFunction(() => {
      const names = window.__dialogs?.active?.def?.byName;
      return ['okay', 'delete6', 'str1'].find((n) => names?.has(n));
    }, null, { timeout: 30000 })).jsonValue();
    await page.keyboard.press('Enter'); // Create; the editor's Done; the intro's Done
    if (up === 'str1') break;
    await page.waitForFunction((n) => !window.__dialogs?.active?.def?.byName.has(n), up);
  }
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ inTown: window.__session.inTown, town: window.__session.univ.town?.record.name }));
};
const cacheNames = () => page.evaluate(() => caches.keys());

// 1. Online: the worker installs and takes the page; Valley is played.
await page.goto(url);
await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }));
  }
});
const online = await newGame('Valley of Dying Things');
check(online.inTown, 'online: the new Valley game did not start in its town');
// The rest of Valley downloads after the files the game asked for first.
await page.waitForFunction(async () => {
  const name = (await caches.keys()).find((n) => n.startsWith('boe-scenario-valleydy-'));
  return name !== undefined && (await (await caches.open(name)).keys()).length > 50;
}, null, { timeout: 30000 });
const cached = await cacheNames();
console.log('CACHES:', cached.join(', '));
check(!cached.some((n) => /^boe-scenario-(?!valleydy-)/.test(n)), 'a scenario never played was cached');

// 2. Offline: the startup screen, every card, and Valley again.
stopServer();
await new Promise((res) => server.on('exit', res));
errors = [];
notFound = [];
await page.goto(url);
await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
const cards = await page.evaluate(() => [...document.querySelectorAll('.startup-card strong')].map((e) => e.textContent));
await page.screenshot({ path: `${SHOTS}/offline-00-startup.png` });
console.log('CARDS:', JSON.stringify(cards));
check(['Valley of Dying Things', 'A Small Rebellion', 'The Za-Khazi Run', 'Bandit Busywork']
  .every((t) => cards.includes(t)), 'offline: a bundled scenario is missing from the startup screen');
const offline = await newGame('Valley of Dying Things');
await page.screenshot({ path: `${SHOTS}/offline-01-start-town.png` });
console.log('OFFLINE START TOWN:', JSON.stringify(offline));
check(offline.inTown, 'offline: the new Valley game did not start in its town');

// A page's query string isn't part of what was cached; it still loads.
await page.goto(`${url}?scenario=valleydy`);
await page.waitForFunction(() => window.__session?.inTown, null, { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/offline-02-query.png` });
check(realErrors().length === 0, `offline: ${realErrors().join(' | ')}`);
console.log('LIBRARY PREVIEWS NOT KEPT (404 offline):', notFound.filter((u) => u.includes('/library/previews/')).length);

// 3. Offline, a scenario never played: not there, and the page says so.
errors = [];
await page.goto(`${url}?scenario=stealth`);
await page.waitForTimeout(3000);
const unplayed = await page.evaluate(() => ({
  started: window.__session?.inTown === true, status: document.getElementById('status')?.textContent,
}));
await page.screenshot({ path: `${SHOTS}/offline-03-unplayed.png` });
console.log('UNPLAYED OFFLINE:', JSON.stringify(unplayed));
check(!unplayed.started, 'offline: a scenario never played started anyway');
check(/isn't saved for offline play/.test(unplayed.status ?? ''), `offline: a scenario never played said "${unplayed.status}"`);

// …and the same by its card, from the startup screen the link goes back to.
await page.click('#status a');
await page.waitForSelector('.startup .startup-choice', { timeout: 30000 });
await page.locator('.startup .startup-choice', { hasText: 'A Small Rebellion' }).first().click();
await page.waitForFunction(() => /isn't saved for offline play/.test(document.getElementById('status')?.textContent ?? ''),
  null, { timeout: 30000 }).catch(() => failures.push('offline: an unplayed card did not say it is not saved'));

await browser.close();
if (failures.length) {
  console.log('FAIL offline:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('OK offline: a scenario played online plays offline, by the startup screen and by link; one never played is not cached');
