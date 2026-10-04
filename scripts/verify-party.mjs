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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
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
await page.evaluate(() => window.__scheduler.settled());
check('a new game is saved as it starts', await page.evaluate(() => window.__univ.treeId !== null));

// Reload goes back into the game where it was, not to the main menu.
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
}
await page.evaluate(() => { window.__univ.party.gold = 4321; });
const before = await page.evaluate(() => ({
  loc: { ...window.__univ.party.townLoc }, age: window.__univ.party.age, gold: window.__univ.party.gold,
}));
await page.evaluate(() => window.__scheduler.saveNow('Test', 'auto')); // what leaving the page does
await page.reload();
await inGame();
await page.waitForTimeout(1000);
const after = await page.evaluate(() => ({
  loc: { ...window.__univ.party.townLoc }, age: window.__univ.party.age, gold: window.__univ.party.gold,
  dialog: !!window.__dialogs?.active,
}));
check('Reload picks the game back up', JSON.stringify(before.loc) === JSON.stringify(after.loc)
  && before.age === after.age && after.gold === 4321 && !after.dialog, { before, after });
check('and keeps its URL', new URL(page.url()).searchParams.get('play') === 'valleydy', page.url());

// Back leaves the game for the main menu, which says where the party is.
// A save made in the scenario is offered from there, with its picture.
await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  const io = await import('/src/fileio/saveIo.ts');
  const { captureSaveThumb } = await import('/src/render/preview.ts');
  const bytes = window.__saveGame();
  await store.createTree('Party test', {
    data: bytes, preview: io.readSavePreview(bytes), kind: 'manual', reason: 'Test',
    thumb: await captureSaveThumb(document.querySelector('canvas')),
  });
});
await page.goBack();
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('Back returns to the main menu', new URL(page.url()).searchParams.get('play') === null, page.url());
check('it says where the party is', (await panel()).includes('Now adventuring in Valley of Dying Things'));
check('the save shows its picture', await page.evaluate(
  () => [...document.querySelectorAll('.startup-save')].some((e) => e.textContent.includes('Party test') && e.querySelector('img') !== null)));
await page.screenshot({ path: `${SHOTS}/p3c-menu-in-scenario.png` });
await page.click('text=Continue Valley of Dying Things');
await inGame();
await page.waitForTimeout(800);
check('Continue picks up the save', await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  return (await store.getTree(window.__univ.treeId))?.name === 'Party test';
}));

// File › Main Menu goes there too, with no question: the game is saved first.
await page.evaluate(() => { window.__univ.party.gold = 999; });
await page.locator('#game-menu-bar .menu-item', { hasText: 'File' }).first().click();
await page.locator('#game-menu-bar .dropdown li', { hasText: 'Main Menu' }).first().click();
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('File › Main Menu returns to the main menu', true);
check('having saved the game on the way', await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  return (await store.listTrees()).find((t) => t.name === 'Party test')?.cover.preview.gold === 999;
}));
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
  // The win exports that picture to the party's sheet, so it stays; an item
  // that calls one of this scenario's nodes still goes at the next door.
  const caller = { ...univ.party.pcs[0].items[0] };
  caller.ability = 81; // CALL_SPECIAL
  univ.party.pcs[0].items[4] = caller;
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
  exported: window.__univ.party.pcs[0].items.filter((i) => i.variety !== 0 && i.graphicNum >= 10000).length,
  stale: window.__univ.party.pcs[0].items.some((i) => i.variety !== 0 && i.graphicNum >= 1000 && i.graphicNum < 10000),
  caller: window.__univ.party.pcs[0].items.some((i) => i.variety !== 0 && i.ability === 81),
  sheet: window.__univ.party.exportSheet && [window.__univ.party.exportSheet.width, window.__univ.party.exportSheet.height],
  age: window.__univ.party.age,
}));
check('it carries into A Small Rebellion', rebellion.scen === 'stealth' && rebellion.gold === 777
  && rebellion.level === 9 && !rebellion.caller, rebellion);
check('with its custom-pictured item on the party sheet', rebellion.exported === 1 && !rebellion.stale
  && JSON.stringify(rebellion.sheet) === '[280,180]', rebellion);
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

// Into Exile III and back out: the party in memory takes Exile III's door
// like any other, and what it wins there comes out with it. Exile III's items
// are all custom pictures, so this is `exportGraphics` end to end.
const playThrough = async () => {
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__session !== undefined
    && document.body.classList.contains('playing') && !window.__dialogs?.active)); i++) {
    // Exile III's opening movie is skipped scene by scene with Escape.
    const open = await page.evaluate(() => window.__dialogs?.active
      && (window.__dialogs.active.kind === 'e3-movie' ? 'movie' : 'dialog'));
    if (open) await page.keyboard.press(open === 'movie' ? 'Escape' : 'Enter');
    await page.waitForTimeout(500);
  }
};
await page.goto(BASE);
await page.waitForSelector('.startup-party');
await page.click('.startup-card[data-id="exile3"]');
await page.waitForFunction(() => window.__univ?.scenario.id === 'exile3', null, { timeout: 120000 });
await playThrough();
const intoE3 = await page.evaluate(() => ({
  scen: window.__univ.scenario.id,
  town: window.__univ.town?.record.name,
  level: window.__univ.party.pcs[0].level,
  gold: window.__univ.party.gold,
}));
check('it walks into Exile III, in Fort Emergence', intoE3.scen === 'exile3'
  && intoE3.town === 'Fort Emergence' && intoE3.level === 9, intoE3);
await page.screenshot({ path: `${SHOTS}/p8-exile3.png` });
const e3Item = await page.evaluate(() => {
  const univ = window.__univ;
  // An E3 item with rules of its own (an `e3Ability`), as the party might win.
  const item = univ.scenario.scenItems.find((it) => it.variety !== 0 && it.e3Ability > 0);
  univ.party.pcs[0].items[5] = { ...item };
  window.__session.specials.endScenario = true;
  window.__session.checkGameOver();
  return { name: item.fullName, e3: item.e3Ability, pic: item.graphicNum };
});
// Exile III's ending movie comes first, with the party in it; Escape skips it.
const ending = await page.waitForFunction(() => window.__dialogs?.active?.kind === 'e3-movie'
  && window.__dialogs.active.scene, null, { timeout: 30000 }).then((h) => h.jsonValue(), () => null);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/p8b-exile3-ending.png` });
check('winning Exile III plays its ending', ending === 'ending', { ending });
await page.keyboard.press('Escape');
await dialogUp('save');
await page.keyboard.press('Escape');
await page.waitForSelector('.startup-party li', { timeout: 30000 });
check('winning Exile III leaves the party in memory', (await panel()).includes('Level 9'));
await page.click('.startup-card[data-id="stealth"]');
await page.waitForFunction(() => window.__univ?.scenario.id === 'stealth', null, { timeout: 60000 });
await playThrough();
const outOfE3 = await page.evaluate((want) => {
  const it = window.__univ.party.pcs[0].items.find((i) => i.variety !== 0 && i.fullName === want.name);
  return it && { name: it.fullName, e3: it.e3Ability, pic: it.graphicNum,
    sheet: window.__univ.party.exportSheet && window.__univ.party.exportSheet.width };
}, e3Item);
check('its Exile III item comes too, with its E3 rules and its picture', outOfE3 !== undefined
  && outOfE3.e3 === e3Item.e3 && outOfE3.pic >= 10000 && outOfE3.sheet === 280, { e3Item, outOfE3 });
await page.screenshot({ path: `${SHOTS}/p9-e3-item-in-stealth.png` });

await page.goto(BASE);
await page.waitForSelector('.startup-party');
await page.click('text=Forget Party');
await page.waitForFunction(() => document.querySelector('.startup-party')?.innerText.includes('No party in memory'));
check('Forget Party forgets it', true);

check('no console errors', errors.length === 0, errors);
await browser.close();
console.log(failures.length === 0 ? 'PASS' : `FAILED: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
