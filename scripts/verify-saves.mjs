/**
 * Save trees end to end in Chromium: autosave ticks into one tree, a restore
 * from the tree makes a branch, the startup card and the tree look right, a
 * tree zips out and back in, and an Exile III save imported on the main menu
 * becomes a game with a tree of its own.
 *
 * Needs `npx vite --port 5199`. `SHOTS_DIR=...` chooses where the screenshots
 * land; `CHROMIUM_PATH=...` an already-installed Chromium. Exits non-zero on a
 * failed check or any console error other than the library catalog's 404.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-saves-shots';
mkdirSync(SHOTS, { recursive: true });
const BASE = process.argv[2] ?? 'http://localhost:5199/';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => { errors.push(String(e)); });
page.on('dialog', (d) => { void d.accept(); });
await page.addInitScript(() => {
  try {
    localStorage.setItem('exile-js:prefs', JSON.stringify({
      ShowInstantHelp: false, DisplayMode: 5, UIScale: 2, Autosave_Every: 1,
    }));
  } catch { /* the default will do */ }
});

const failures = [];
const check = (what, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(what);
};
const inGame = () => page.waitForFunction(() => window.__session !== undefined, { timeout: 30000 });
const snapsOf = () => page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  return (await store.listSnaps(window.__univ.treeId)).map((s) => ({
    seq: s.seq, parent: s.parent, kind: s.kind, age: s.gameAge, place: s.place, thumb: !!s.thumb,
  }));
});

// ---- play: a direct link autosaves only once the player has saved
await page.goto(`${BASE}?scenario=valleydy&pace=1`);
await inGame();
await page.waitForTimeout(800);
while (await page.evaluate(() => !!window.__dialogs?.active)) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(600);
await page.evaluate(() => window.__scheduler.settled());
check('a direct link makes no tree by itself', await page.evaluate(() => window.__univ.treeId === null));

await page.evaluate(() => window.__scheduler.saveNow('Manual', 'manual'));
check('Save makes the game a tree', await page.evaluate(() => window.__univ.treeId !== null));
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowUp']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1500);
await page.evaluate(() => window.__scheduler.settled());
let snaps = await snapsOf();
check('moving autosaves into the same tree', snaps.length >= 4, snaps.length);
check('the first is the manual root', snaps[0].kind === 'manual' && snaps[0].parent === null);
check('each is a child of the one before', snaps.every((s, i) => i === 0 || s.parent === snaps[i - 1].seq));
check('each has a picture and a place', snaps.every((s) => s.thumb && s.place !== ''), snaps.map((s) => s.place));

// Give it some history to look at: a milestone, more ticks, then a branch.
await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  const id = window.__univ.treeId;
  for (let i = 0; i < 6; i++) {
    window.__univ.party.age += 700;
    window.__univ.party.gold += 5;
    await window.__scheduler.saveNow(i === 3 ? 'EnterTown' : 'Tick', i === 3 ? 'milestone' : 'auto');
  }
  const all = await store.listSnaps(id);
  const fork = all[Math.floor(all.length / 2)].seq;
  await store.setHead(id, fork);
  for (let i = 0; i < 3; i++) {
    window.__univ.party.age += 300;
    window.__univ.party.gold += 100;
    await window.__scheduler.saveNow('Tick', 'auto');
  }
});
snaps = await snapsOf();
const forks = snaps.filter((s) => snaps.filter((c) => c.parent === s.seq).length > 1);
check('restoring then saving made a branch', forks.length === 1, { forks: forks.map((f) => f.seq), n: snaps.length });
const total = snaps.length;
const treeId = await page.evaluate(() => window.__univ.treeId);

// ---- the startup screen: one card for the whole game
await page.goto(BASE);
await page.waitForSelector('.startup-save', { timeout: 30000 });
const cards = await page.$$eval('.startup-save', (els) => els.map((e) => e.innerText));
check('one card for the tree', cards.length === 1, cards);
check('it counts its saves', cards[0].includes(`${total} saves`), cards[0]);
check('the card has a picture', await page.evaluate(() => document.querySelector('.startup-save img') !== null));
await page.screenshot({ path: `${SHOTS}/s1-startup-card.png` });

check('the card has Resume, Rename and Delete',
  await page.evaluate(() => ['resume', 'rename', 'delete'].every((a) => document.querySelector(`.startup-save [data-action="${a}"]`))));
check('and no Older saves or Export', !cards[0].includes('Older saves') && !cards[0].includes('Export'), cards[0]);
const lines = await page.$$eval('.startup-save .startup-save-line', (els) => els.map((e) => e.scrollWidth <= e.clientWidth));
check('where and when each fit on one line', lines.length === 2 && lines.every(Boolean), lines);

// ---- the tree: a click on the card itself
await page.click('.startup-save .startup-words strong');
await page.waitForSelector('.stree .stree-node');
const nodes = await page.$$eval('.stree-node', (els) => els.length);
check('the tree draws every save', nodes === total, { nodes, total });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/s2-tree.png` });
const lanes = await page.evaluate(() => new Set([...document.querySelectorAll('.stree-node')]
  .map((g) => g.getAttribute('transform').split(',')[1])).size);
check('the branch sits on its own row', lanes === 2, lanes);
check('the newest save needs no callout', await page.evaluate(() => document.querySelector('.stree-callout') === null));

// Click an old node that has children: the callout warns about the branch.
await page.hover(`.stree-node[data-seq="${snaps[2].seq}"]`);
check('hovering a node shows its picture', await page.evaluate(() => { const t = document.querySelector('.stree-tip'); return !t.hidden && t.querySelector('img') !== null; }));
await page.screenshot({ path: `${SHOTS}/s2b-tree-hover.png` });
const oldSeq = snaps[1].seq;
await page.click(`.stree-node[data-seq="${oldSeq}"]`);
const callout = await page.$eval('.stree-callout', (e) => e.textContent);
check('restoring an older save warns that it branches', callout.includes('new branch'), callout);
check('the detail panel has its picture', await page.evaluate(() => document.querySelector('.stree-shot')?.tagName === 'IMG'));
await page.screenshot({ path: `${SHOTS}/s3-tree-selected.png` });
const wantAge = snaps[1].age;
await page.click('.stree .primary');
await inGame();
await page.waitForTimeout(1200);
const loaded = await page.evaluate(() => ({ age: window.__univ.party.age, id: window.__univ.treeId }));
check('Restore loads that save', loaded.age === wantAge && loaded.id === treeId, { loaded, wantAge });
await page.evaluate(() => window.__scheduler.saveNow('Tick', 'auto'));
const after = await snapsOf();
const forked = after.filter((s) => after.filter((c) => c.parent === s.seq).length > 1);
check('playing on from it branches the tree further', forked.length === 2 && after.length === total + 1, { forks: forked.map((f) => f.seq) });

// ---- the autosave preferences: how often, and how much to keep
const canvasPoint = (x, y) => page.evaluate(({ x, y }) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { x: r.left + (x + 0.5) * (r.width / c.width), y: r.top + (y + 0.5) * (r.height / c.height) };
}, { x, y });
const clickDialogButton = async (name) => {
  const rect = await page.evaluate((n) => {
    const d = window.__dialogs.active;
    const c = d?.def?.controls.find((k) => k.name === n);
    return c ? d.screenRect(c) : null;
  }, name);
  if (!rect) throw new Error(`no dialog control named ${name}`);
  const at = await canvasPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(250);
};
await page.locator('#game-menu-bar .menu-item', { hasText: 'File' }).first().click();
await page.locator('#game-menu-bar .menu-item.open .dropdown li', { hasText: 'Preferences' }).first().click();
await page.waitForTimeout(300);
await clickDialogButton('autosave-details');
const prefNames = await page.evaluate(() => [...window.__dialogs.active.def.byName.keys()]);
check('the autosave dialog asks how often and how much', prefNames.includes('every') && prefNames.includes('budget'), prefNames.slice(0, 8));
await page.screenshot({ path: `${SHOTS}/s3b-autosave-prefs.png` });
await page.keyboard.press('Enter'); // OK on the autosave dialog
await page.waitForTimeout(250);
await page.keyboard.press('Enter'); // OK on preferences
await page.waitForTimeout(300);
check('the dialogs close', await page.evaluate(() => window.__dialogs.active === null));

// ---- a zip out and back in
const zipped = await page.evaluate(async (id) => {
  const store = await import('/src/platform/saveStore.ts');
  const zip = await import('/src/platform/saveZip.ts');
  const actions = await import('/src/platform/saveActions.ts');
  const tree = await store.getTree(id);
  const bytes = zip.treeToZip(tree, await store.listSnaps(id), await store.getAllSnapshots(id));
  const out = await actions.importAsTree({ name: 'Copy', data: bytes });
  const copy = await store.listSnaps(out.treeId);
  const orig = await store.listSnaps(id);
  return {
    kb: Math.round(bytes.length / 1024),
    same: JSON.stringify(copy.map((s) => [s.seq, s.parent, s.kind])) === JSON.stringify(orig.map((s) => [s.seq, s.parent, s.kind])),
    n: copy.length,
  };
}, treeId);
check('a zip imports back as the same tree', zipped.same, zipped);

await page.goto(BASE);
await page.waitForSelector('.startup-save');
check('the imported copy is a second card', (await page.$$('.startup-save')).length === 2);
const importCard = await page.evaluate(() => {
  const list = document.querySelector('.startup-saves');
  const last = list.lastElementChild;
  const game = list.querySelector('.startup-save').getBoundingClientRect();
  const imp = last.getBoundingClientRect();
  return { last: last.dataset.action, w: [game.width, imp.width], h: [game.height, imp.height] };
});
check('Import is a card, last, the size of a game card', importCard.last === 'import'
  && Math.abs(importCard.w[0] - importCard.w[1]) < 1 && Math.abs(importCard.h[0] - importCard.h[1]) < 1, importCard);
await page.screenshot({ path: `${SHOTS}/s4-two-cards.png` });
const before = (await page.$$('.startup-save')).length;
await page.locator('.startup-save').first().locator('[data-action="delete"]').click(); // the newest: the import
await page.waitForTimeout(500);
check('Delete removes a game', (await page.$$('.startup-save')).length === before - 1);

// ---- an Exile III save, imported on the main menu, becomes a game with a tree
await page.goto(`${BASE}?scenario=exile3&pace=1`);
await inGame();
await page.waitForTimeout(1000);
const e3bytes = await page.evaluate(async () => {
  const { exportE3Save } = await import('/src/fileio/e3SaveExport.ts');
  const { e3SaveDefaultsFromJson } = await import('/src/fileio/e3SaveDefaults.ts');
  const json = await (await fetch('/scenarios/exile3/e3save.json')).text();
  window.__univ.party.gold = 4242;
  return Array.from(exportE3Save(window.__univ, e3SaveDefaultsFromJson(json)).bytes);
});
await page.goto(BASE);
await page.waitForSelector('.startup-save');
const treesBefore = (await page.$$('.startup-save')).length;
page.once('filechooser', (fc) => {
  void fc.setFiles({ name: 'EXILE3.SAV', mimeType: 'application/octet-stream', buffer: Buffer.from(e3bytes) });
});
await page.click('[data-action="import"]');
await inGame();
for (let i = 0; i < 20 && await page.evaluate(() => window.__univ?.treeId == null); i++) {
  if (await page.evaluate(() => !!window.__dialogs?.active)) await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
await page.evaluate(() => window.__scheduler.settled());
const e3game = await page.evaluate(async () => {
  const store = await import('/src/platform/saveStore.ts');
  const tree = window.__univ.treeId === null ? null : await store.getTree(window.__univ.treeId);
  return { scen: window.__univ.scenario.id, gold: window.__univ.party.gold, name: tree?.name, play: new URL(location.href).searchParams.get('play') };
});
check('an Exile III save opens Exile III, saved as a tree of its own',
  e3game.scen === 'exile3' && e3game.gold === 4242 && e3game.name === 'EXILE3' && e3game.play === 'exile3', e3game);
await page.goto(BASE);
await page.waitForSelector('.startup-save');
check('and it is on the main menu', (await page.$$('.startup-save')).length === treesBefore + 1);
await page.screenshot({ path: `${SHOTS}/s5-e3-imported.png` });

check('no console errors', errors.length === 0, errors);
await browser.close();
console.log(failures.length === 0 ? 'PASS' : `FAILED: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
