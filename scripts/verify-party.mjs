/**
 * The party in memory, end to end in Chromium — the original's flow of making
 * a party first and taking it into any scenario:
 *
 *   startup (no party) → Make New Party → back at startup with it listed →
 *   Valley of Dying Things → win it (END_SCENARIO) → congrats-save →
 *   back at startup, party still listed → A Small Rebellion, where the custom-
 *   picture item is taken away with removed-special-items and gold and levels
 *   carry over → reload: still in memory.
 *
 * Needs `npx vite --port 5199`. `SHOTS_DIR=...` chooses where the screenshots
 * land. Exits non-zero on a failed check or any console error.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-party-shots';
mkdirSync(SHOTS, { recursive: true });
const BASE = process.argv[2] ?? 'http://localhost:5199/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => { errors.push(String(e)); });
await page.addInitScript(() => {
  try {
    localStorage.setItem('exile-js:prefs', JSON.stringify({ ShowInstantHelp: false, DisplayMode: 5, UIScale: 2 }));
  } catch { /* the default will do */ }
});

const failures = [];
const check = (what, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(what);
};
const panel = () => page.evaluate(() => document.querySelector('.startup-party')?.innerText ?? '');
const dialogUp = (name) => page.waitForFunction(
  (n) => window.__dialogs?.active?.def?.byName.has(n), name, { timeout: 30000 });
/** The intro: a `cThreeChoice` with Done alone, which it names `btn1`. */
const introUp = () => dialogUp('str1');
const inGame = () => page.waitForFunction(() => window.__session !== undefined, { timeout: 30000 });

await page.goto(`${BASE}?pace=1`);
await page.waitForSelector('.startup-party');
check('starts with no party', (await panel()).includes('No party in memory'));
await page.screenshot({ path: `${SHOTS}/p1-no-party.png` });

await page.click('text=Make New Party');
await dialogUp('okay');
await page.keyboard.press('Enter'); // new-party.xml: Create
await dialogUp('delete6');
await page.screenshot({ path: `${SHOTS}/p2-editor.png` });
await page.keyboard.press('Enter'); // the editor: Done
await page.waitForSelector('.startup-party li', { timeout: 30000 });
const names = await page.$$eval('.startup-pc-words strong', (els) => els.map((e) => e.textContent));
check('the new party is in memory', names.length === 6, names);
const pictures = await page.$$eval('.startup-pc-picture canvas', (cs) => cs.length);
check('each PC shows its picture', pictures === 6, pictures);
await page.screenshot({ path: `${SHOTS}/p3-party.png` });

await page.click('.startup-card[data-id="valleydy"]');
await inGame();
// put_party_in_scen's intro: the scenario's intro messages, one Done button.
await introUp();
check('the intro dialog comes up', true);
await page.screenshot({ path: `${SHOTS}/p3b-intro.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
check('the game has a URL of its own', new URL(page.url()).searchParams.get('play') === 'valleydy', page.url());

// Back leaves the game for the main menu, which says where the party is.
// A save made in the scenario is offered from there, with its picture.
await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  const { captureTerrainView } = await import('/src/render/preview.ts');
  await store.putSave('Party test', window.__saveGame(), await captureTerrainView(document.querySelector('canvas')));
});
await page.goBack();
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('Back returns to the main menu', new URL(page.url()).searchParams.get('play') === null, page.url());
check('it says where the party is', (await panel()).includes('Now adventuring in Valley of Dying Things'));
check('the save shows its picture', await page.evaluate(
  () => document.querySelector('[data-slot="Party test"] img') !== null));
await page.screenshot({ path: `${SHOTS}/p3c-menu-in-scenario.png` });
await page.click('text=Continue Valley of Dying Things');
await inGame();
await page.waitForTimeout(800);
check('Continue picks up the save', await page.evaluate(() => window.__univ.saveSlot === 'Party test'));

// File › Main Menu, confirmed, goes there too.
await page.locator('#game-menu-bar .menu-item', { hasText: 'File' }).first().click();
await page.locator('#game-menu-bar .dropdown li', { hasText: 'Main Menu' }).first().click();
await dialogUp('okay');
await page.keyboard.press('Enter');
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('File › Main Menu returns to the main menu', true);
await page.click('.startup-card[data-id="valleydy"]');
await inGame();
await introUp();
await page.keyboard.press('Enter');
await page.waitForTimeout(800);

const valley = await page.evaluate(() => ({
  town: window.__univ.party.townNum,
  names: window.__univ.party.pcs.map((p) => p.name),
  items: window.__univ.party.pcs.map((p) => p.items.filter((i) => i.variety !== 0).length),
}));
check('it walks into Valley of Dying Things', valley.town === 0
  && JSON.stringify(valley.names) === JSON.stringify(names), valley);
check('with one starting kit, not two', valley.items.every((n) => n === 2), valley.items);
await page.evaluate(() => {
  const univ = window.__univ;
  univ.party.gold = 777;
  univ.party.pcs[0].level = 9;
  const custom = { ...univ.party.pcs[0].items[0] };
  custom.graphicNum = 1003; // a picture from this scenario's own sheets
  univ.party.pcs[0].items[3] = custom;
  window.__session.specials.endScenario = true;
  window.__session.checkGameOver();
});
await dialogUp('save');
await page.screenshot({ path: `${SHOTS}/p4-congrats.png` });
await page.keyboard.press('Escape'); // no save, straight back
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('a win leaves the party in memory', (await panel()).includes('Level 9'));

await page.click('.startup-card[data-id="stealth"]');
await dialogUp('okay');
// removed-special-items.xml is the only okay-only dialog on this path (its
// neighbour, keep-stored-items, is yes/no).
check('special items are taken, with removed-special-items', await page.evaluate(
  () => [...window.__dialogs.active.def.byName.keys()].filter((k) => k !== 'okay').length <= 1));
await page.screenshot({ path: `${SHOTS}/p5-removed.png` });
await page.keyboard.press('Enter');
await introUp(); // then the intro
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const rebellion = await page.evaluate(() => ({
  scen: window.__univ.scenario.id,
  gold: window.__univ.party.gold,
  level: window.__univ.party.pcs[0].level,
  custom: window.__univ.party.pcs[0].items.some((i) => i.graphicNum >= 1000),
  age: window.__univ.party.age,
}));
check('it carries into A Small Rebellion', rebellion.scen === 'stealth' && rebellion.gold === 777
  && rebellion.level === 9 && !rebellion.custom, rebellion);
await page.screenshot({ path: `${SHOTS}/p6-rebellion.png` });

await page.goto(BASE);
await page.waitForSelector('.startup-party');
check('a reload keeps it', (await panel()).includes('Level 9'));
check('with HP and SP', /HP \d+\/\d+/.test(await panel()));

// Into a smaller world: the party in memory still stands in Valley's sector
// (2,2), which Bandit Busywork (one sector) doesn't have. Drawing the game
// screen before `enterScenario` moved it threw from the status bar and left
// the screen half drawn.
const beforeErrors = errors.length;
await page.click('.startup-card[data-id="busywork"]');
for (let i = 0; i < 20 && !(await page.evaluate(() => window.__session !== undefined
  && document.body.classList.contains('playing') && !window.__dialogs?.active)); i++) {
  if (await page.evaluate(() => !!window.__dialogs?.active)) await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
const busywork = await page.evaluate(() => ({
  scen: window.__univ?.scenario.id, sector: window.__univ?.party.sector,
}));
check('it enters a world smaller than the last one', busywork.scen === 'busywork'
  && busywork.sector?.x === 0 && errors.length === beforeErrors, { ...busywork, errors: errors.slice(beforeErrors) });
await page.screenshot({ path: `${SHOTS}/p7-busywork.png` });

await page.goto(BASE);
await page.waitForSelector('.startup-party');
await page.click('text=Forget Party');
await page.waitForFunction(() => document.querySelector('.startup-party')?.innerText.includes('No party in memory'));
check('Forget Party forgets it', true);

check('no console errors', errors.length === 0, errors);
await browser.close();
console.log(failures.length === 0 ? 'PASS' : `FAILED: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
