// Drives Exile 3 (converted by tools/e3convert/convert.ts into
// public/scenarios/exile3, gitignored) in the real UI: a new game starts in
// Fort Emergence, the party walks out onto the world, walks about, and the
// screen and map are shot for a person to look at. Skips (exit 0) when there is
// no converted Exile 3. Needs `npx vite --port 5199` running.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

if (!existsSync(new URL('../public/scenarios/exile3/scenario.xml', import.meta.url))) {
  console.log('No converted Exile 3 (run tools/e3convert/convert.ts): skipped.');
  process.exit(0);
}

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('exile-js:prefs', JSON.stringify({ ShowInstantHelp: false, DisplayMode: 5, UIScale: 2 }));
  } catch { /* no storage: defaults */ }
});
const shot = (name) => page.screenshot({ path: `${SHOTS}/e3-${name}.png` });

await page.goto('http://localhost:5199/?scenario=exile3&pace=1');
// The party editor, then the intro: answer dialogs until the game is running.
for (let i = 0; i < 20; i++) {
  const state = await page.evaluate(() => ({ session: window.__session !== undefined, dialog: !!window.__dialogs?.active }));
  if (state.session && !state.dialog) break;
  if (state.dialog) await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}
await page.waitForFunction(() => window.__session !== undefined, { timeout: 30000 });
await page.waitForTimeout(500);

const where = () => page.evaluate(() => {
  const s = window.__session;
  return {
    inTown: s.inTown, townNum: s.univ.party.townNum, townLoc: s.univ.party.townLoc,
    sector: s.univ.party.sector, outLoc: s.univ.party.outLoc, place: s.locationName(),
  };
});
const start = await where();
console.log('START:', JSON.stringify(start));
await shot('01-start');
if (start.townNum !== 21 || start.townLoc.x !== 59 || start.townLoc.y !== 6) {
  errors.push(`a new game should start in Fort Emergence (21) at 59,6: ${JSON.stringify(start)}`);
}

// Walk out of the fort: a breadth-first path to the nearest square off the
// town's active area, through doors (moving into one opens it, and the step is
// then taken again).
const walkOut = () => page.evaluate(async () => {
  const s = window.__session;
  const STALLED = Symbol('stalled');
  const step = (d) => Promise.race([s.move(d), new Promise((r) => setTimeout(() => r(STALLED), 400))]);
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const plan = () => {
    const rec = s.univ.town.record;
    const r = rec.inTownRect;
    const size = rec.terrain.length;
    const passable = (x, y) => {
      const t = s.univ.terrainType(rec.terrain[x][y]);
      return t.blockage < 3 || t.special !== 0;
    };
    const start = s.univ.party.townLoc;
    const prev = new Map([[`${start.x},${start.y}`, null]]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      if (at.x <= r.left || at.x >= r.right || at.y <= r.top || at.y >= r.bottom) {
        const path = [];
        for (let k = `${at.x},${at.y}`; prev.get(k); k = prev.get(k).from) path.unshift(prev.get(k).dir);
        return path;
      }
      DIRS.forEach(([dx, dy], dir) => {
        const x = at.x + dx, y = at.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size || prev.has(`${x},${y}`) || !passable(x, y)) return;
        prev.set(`${x},${y}`, { from: `${at.x},${at.y}`, dir });
        queue.push({ x, y });
      });
    }
    return null;
  };
  const path = plan();
  if (!path) return { stalled: 'no path out' };
  let steps = 0;
  for (const d of path) {
    if (!s.inTown) break;
    if (window.__dialogs.active) return { steps, stalled: 'dialog' };
    let res = await step(d);
    if (res === STALLED) return { steps, stalled: 'move' };
    if (!res && s.inTown) res = await step(d); // a door opened; walk through it
    if (!res && s.inTown) return { steps, stalled: `blocked at ${JSON.stringify(s.univ.party.townLoc)}` };
    steps++;
  }
  return { steps, planned: path.length };
});
const exit = await walkOut();
const outside = await where();
console.log('LEFT TOWN:', JSON.stringify(exit), JSON.stringify(outside));
await shot('02-outdoors');
if (outside.inTown) errors.push(`could not walk out of Fort Emergence: ${JSON.stringify(exit)}`);

// A stroll on the world map: count the steps the terrain allows.
const stroll = await page.evaluate(async () => {
  const s = window.__session;
  const tried = [];
  for (const d of [4, 4, 4, 4, 2, 2, 2, 2, 0, 0, 6, 6]) {
    const before = { ...s.univ.party.outLoc };
    const ok = await Promise.race([s.move(d), new Promise((r) => setTimeout(() => r('stalled'), 400))]);
    if (ok === 'stalled' || window.__dialogs.active) break;
    tried.push(before.x !== s.univ.party.outLoc.x || before.y !== s.univ.party.outLoc.y);
  }
  window.__redraw();
  return { moved: tried.filter(Boolean).length, tried: tried.length, place: s.locationName() };
});
console.log('STROLL:', JSON.stringify(stroll));
await shot('03-stroll');
if (stroll.moved === 0) errors.push('no outdoor step moved the party');

await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK');
