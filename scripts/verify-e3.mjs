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

// A conversation: someone in the fort who talks, and a keyword followed.
const talk = await page.evaluate(async () => {
  const s = window.__session;
  const sc = window.__screen;
  const who = s.univ.town.monsters.find((m) => m.isAlive && m.personality >= 0 && m.isFriendly);
  if (!who) return { error: 'no one in the fort will talk' };
  const home = { ...s.univ.party.townLoc };
  s.univ.party.townLoc = { x: who.curLoc.x, y: who.curLoc.y + 1 };
  s.center = { ...s.univ.party.townLoc };
  await s.talkTo(who.curLoc);
  window.__redraw();
  const opening = s.talk?.str1;
  // Ask about the job, as a player would: the greeting often names no topics.
  const job = s.talk?.words.find((w) => w.preset && /job/i.test(w.word));
  if (job) s.chooseTalkNode(job.node);
  window.__redraw();
  const kw = s.talk?.words.find((w) => !w.preset && w.rect);
  let followed = null;
  if (kw) {
    const hit = sc.talkScreen.wordAt(s.talk, (kw.rect.left + kw.rect.right) / 2, (kw.rect.top + kw.rect.bottom) / 2);
    const before = s.talk?.str1;
    if (hit) s.chooseTalkNode(hit.node);
    window.__redraw();
    if (hit) followed = { word: kw.word, reply: s.talk?.str1?.slice(0, 60), changed: s.talk?.str1 !== before };
  }
  const result = { title: s.talk?.title, opening: opening?.slice(0, 60), keywords: s.talk?.words.filter((w) => !w.preset).length, followed };
  return { result, home };
});
console.log('TALK:', JSON.stringify(talk.result ?? talk));
await shot('01c-talk');
if (!talk.result?.title || !talk.result.followed?.changed) errors.push(`talking in the fort failed: ${JSON.stringify(talk)}`);
await page.evaluate((home) => {
  const s = window.__session;
  s.chooseTalkNode(-14); // Done
  s.univ.party.townLoc = home; s.center = { ...home };
  window.__redraw();
}, talk.home);

// A sign in the fort, read from beside it.
const sign = await page.evaluate(() => {
  const s = window.__session;
  const rec = s.univ.town.record;
  const at = rec.signLocs.find((l) => l.text);
  if (!at) return { error: 'no sign in the fort' };
  const home = { ...s.univ.party.townLoc };
  const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const stand = dirs.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
    .find((p) => s.univ.terrainType(rec.terrain[p.x]?.[p.y] ?? 5).blockage < 3);
  if (stand) s.univ.party.townLoc = stand;
  const text = s.signAt({ x: at.x, y: at.y });
  s.univ.party.townLoc = home;
  return { at: { x: at.x, y: at.y }, stand, text };
});
console.log('SIGN:', JSON.stringify(sign));
if (!sign.text) errors.push(`could not read a sign in the fort: ${JSON.stringify(sign)}`);

// Shops: E3 stocks them from the shopkeeper, so a converted shop should show
// real goods at E3's prices. Jinx's is in Krizsan; open it from here.
const shop = await page.evaluate(() => {
  const s = window.__session;
  const which = s.univ.scenario.shops.findIndex((sh) => sh.name === "Jinx's Weaponry");
  if (which < 0 || !s.startShopMode(which, 3, "Jinx's Weaponry")) return { error: 'no shop' };
  window.__redraw();
  const rows = [0, 1, 2].map((r) => s.shop.rowEntry(r)).filter(Boolean)
    .map(({ entry }) => ({ name: entry.item.fullName, cost: s.shop.cost(entry) }));
  return { which, rows };
});
console.log('SHOP:', JSON.stringify(shop));
await shot('01d-shop');
if (!shop.rows?.length || shop.rows.some((r) => !r.name || !(r.cost > 0))) errors.push(`Jinx's shop is empty or free: ${JSON.stringify(shop)}`);
await page.evaluate(() => { window.__session.endShopMode(); window.__redraw(); });

// E3's job boards (src/game/e3Jobs.ts): a board opens with E3's generated
// jobs; Take moves one to the party, and the Quests page lists it.
const canvasPoint = async (x, y) => page.evaluate(({ x, y }) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { x: r.left + (x + 0.5) * (r.width / c.width), y: r.top + (y + 0.5) * (r.height / c.height) };
}, { x, y });
const clickDialogButton = async (name) => {
  const rect = await page.evaluate((n) => {
    const d = window.__dialogs.active;
    const c = d?.def?.controls.find((x) => x.name === n);
    return c && d.isVisible(n) ? d.screenRect(c) : null;
  }, name);
  if (!rect) return false;
  const at = await canvasPoint((rect.left + rect.right) / 2 - 0.5, (rect.top + rect.bottom) / 2 - 0.5);
  await page.mouse.click(at.x, at.y);
  return true;
};
let boardBefore = { job1: null };
for (let bank = 0; bank < 6; bank++) {
  await page.evaluate((b) => window.__session.onJobBank(b, '', 0), bank);
  await page.waitForTimeout(200);
  boardBefore = await page.evaluate(() => {
    const d = window.__dialogs.active;
    return { job1: ['job1', 'job2', 'job3', 'job4'].map((n) => d?.getText?.(n) ?? '').find((t) => t) ?? null };
  });
  // The jobs are random: a board with none on it is rare, but try the next.
  if (boardBefore.job1) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
await shot('08-job-board');
let took = false;
for (const n of ['take1', 'take2', 'take3', 'take4']) if (!took) took = await clickDialogButton(n);
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.keyboard.press('0');
await page.waitForTimeout(200);
const jobs = await page.evaluate(() => {
  const held = window.__univ.party.e3Jobs?.held.filter((j) => j.kind > 0) ?? [];
  return { held: held.length, page: window.__screen.itemWindow.specItemArray };
});
console.log('JOBS:', JSON.stringify({ boardBefore, took, jobs }));
await shot('09-jobs-panel');
if (!/Pay is \d+ gold/.test(boardBefore.job1 ?? '') && !took) errors.push(`the job board showed no jobs: ${JSON.stringify(boardBefore)}`);
if (took && jobs.held !== 1) errors.push(`taking a job did not give the party one: ${JSON.stringify(jobs)}`);

// The events journal (the exile-js opcode `journal`): Anaximander's first
// briefing (the fort's spot 1, at (5,7)) adds entry 2, and Options > Journal
// shows it with its day. The party goes back afterwards, for the walk out.
const beforeJournal = await page.evaluate(() => ({ ...window.__univ.party.townLoc }));
await page.evaluate(() => {
  const s = window.__session;
  s.univ.party.townLoc = { x: 5, y: 8 }; s.center = { x: 5, y: 8 };
  window.__redraw();
  void s.move(0);
});
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => !!window.__dialogs?.active))) break;
  await page.keyboard.press('Enter');
}
await page.click('#game-menu-bar .menu-item:nth-child(3)'); // Options
await page.locator('#game-menu-bar .menu-item:nth-child(3) .dropdown li', { hasText: 'Journal' }).click();
await page.waitForTimeout(300);
const journal = await page.evaluate(() => ({
  entries: window.__univ.party.journal.length,
  day: window.__dialogs.active?.getText?.('day1') ?? null,
  text: window.__dialogs.active?.getText?.('str1') ?? null,
}));
console.log('JOURNAL:', JSON.stringify(journal));
await shot('10-journal');
if (journal.entries < 1 || !journal.day?.startsWith('Day: ') || !journal.text)
  errors.push(`Anaximander's briefing left no journal entry on screen: ${JSON.stringify(journal)}`);
await clickDialogButton('done');
await page.waitForTimeout(200);
if (await page.evaluate(() => !!window.__dialogs?.active)) errors.push('Done did not close the journal');
await page.evaluate((at) => {
  window.__univ.party.townLoc = at; window.__session.center = { ...at }; window.__redraw();
}, beforeJournal);

// Walk out of the fort: a breadth-first path to the nearest square off the
// town's active area, through doors (moving into one opens it, and the step is
// then taken again).
const walkOut = (maxSteps = 1000) => page.evaluate(async (maxSteps) => {
  const s = window.__session;
  const STALLED = Symbol('stalled');
  // A step can put up a message (E3's spots); read it and go on, as a player would.
  const step = async (d) => {
    const moving = s.move(d);
    for (let i = 0; i < 10; i++) {
      const res = await Promise.race([moving, new Promise((r) => setTimeout(() => r(STALLED), 400))]);
      if (res !== STALLED) return res;
      if (!window.__dialogs.active) return STALLED;
      window.__dialogs.handleKey('Enter');
    }
    return STALLED;
  };
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const plan = () => {
    const rec = s.univ.town.record;
    const r = rec.inTownRect;
    const size = rec.terrain.length;
    // Blocked squares a step can open: doors (step-change 1, unlock 9).
    // Not every special: a dresser is a blocked `box`.
    // Not damaging ground (special 2): E3's lava is 8d10 fire, and a player
    // walks around it.
    const passable = (x, y) => {
      const t = s.univ.terrainType(rec.terrain[x][y]);
      return (t.blockage < 3 && t.special !== 2) || t.special === 1 || t.special === 9;
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
    if (!s.inTown || steps >= maxSteps) break;
    if (window.__dialogs.active) return { steps, stalled: 'dialog' };
    let res = await step(d);
    if (res === STALLED) return { steps, stalled: 'move' };
    if (!res && s.inTown) res = await step(d); // a door opened; walk through it
    // Someone standing in the way: wait a turn for them to move on.
    for (let wait = 0; wait < 10 && !res && s.inTown; wait++) {
      const at = s.univ.party.townLoc, [dx, dy] = DIRS[d];
      const there = { x: at.x + dx, y: at.y + dy };
      if (!s.univ.town.monsters.some((m) => m.isAlive && m.curLoc.x === there.x && m.curLoc.y === there.y)) break;
      await s.pause();
      res = await step(d);
    }
    if (!res && s.inTown) return { steps, stalled: `blocked at ${JSON.stringify(s.univ.party.townLoc)}` };
    steps++;
  }
  return { steps, planned: path.length };
}, maxSteps);
// Halfway out, a look at the fort and its people.
await walkOut(25);
await page.evaluate(() => window.__redraw());
await shot('01b-fort');
const peopleSeen = await page.evaluate(() => window.__session.univ.town.monsters.filter((m) => m.isAlive).length);
console.log('FORT CREATURES:', peopleSeen);
if (peopleSeen === 0) errors.push('Fort Emergence has no creatures');
const exit = await walkOut();
const outside = await where();
console.log('LEFT TOWN:', JSON.stringify(exit), JSON.stringify(outside));
await shot('02-outdoors');
if (outside.inTown) errors.push(`could not walk out of Fort Emergence: ${JSON.stringify(exit)}`);

// A stroll on the world map: count the steps the terrain allows. Each step
// the first open direction, round lava rather than into it (damaging ground,
// special 2), as a player would, and not back into the fort (a town entrance,
// special 21), nor straight back. Messages on the way (leaving by the north
// passage says "You emerge from Fort Emergence...") are read and closed.
const closeDialogs = async () => {
  for (let k = 0; k < 10 && await page.evaluate(() => !!window.__dialogs.active); k++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
};
await closeDialogs();
const tried = [];
let last = -1;
for (let i = 0; i < 8; i++) {
  const d = await page.evaluate((last) => {
    const s = window.__session;
    const step = { 0: [0, -1], 2: [1, 0], 4: [0, 1], 6: [-1, 0] };
    const back = { 0: 4, 2: 6, 4: 0, 6: 2 };
    const at = s.univ.party.outLoc;
    const d = [4, 2, 0, 6].find((k) => {
      if (k === back[last]) return false;
      const t = s.univ.terrainType(s.univ.out.at(at.x + step[k][0], at.y + step[k][1]));
      return t.blockage < 3 && ![2, 21].includes(t.special);
    });
    if (d === undefined || s.inTown) return null;
    window.__strollFrom = { ...at };
    window.__strollMove = s.move(d);
    return d;
  }, last);
  if (d === null) break;
  last = d;
  await page.waitForTimeout(200);
  await closeDialogs();
  tried.push(await page.evaluate(async () => {
    await Promise.race([window.__strollMove, new Promise((r) => setTimeout(r, 400))]);
    const at = window.__univ.party.outLoc, was = window.__strollFrom;
    return at.x !== was.x || at.y !== was.y;
  }));
}
const stroll = await page.evaluate((tried) => {
  window.__redraw();
  return { moved: tried.filter(Boolean).length, tried: tried.length, place: window.__session.locationName() };
}, tried);
console.log('STROLL:', JSON.stringify(stroll));
await shot('03-stroll');
if (stroll.moved === 0) errors.push('no outdoor step moved the party');
if (await page.evaluate(() => window.__univ.transcript.some((l) => l.includes('LAVA!'))))
  errors.push('the walk went through lava');

// A message spot in Krizsan: the inn's common room tells you about itself,
// once.
const spot = await page.evaluate(() => {
  const s = window.__session;
  s.startTownMode(0, 0);
  s.univ.party.townLoc = { x: 24, y: 8 }; s.center = { x: 24, y: 8 };
  window.__redraw();
  void s.move(0);
});
await page.waitForTimeout(800);
const spotDialog = await page.evaluate(() => !!window.__dialogs?.active);
console.log('SPOT:', JSON.stringify({ dialog: spotDialog }));
await shot('04-spot');
if (!spotDialog) errors.push('stepping on the common room showed no message');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

// Shayder (towns/shayder.ts). The ferry at the end of the dock: Yes pays ten
// gold, sets where the party will come out, and sails for Marish (town 128).
const clickButton = async (label) => {
  const at = await page.evaluate((text) => {
    const d = window.__dialogs.active;
    const name = d && [...d.def.byName.keys()].find((n) => n.startsWith('btn') && d.getText(n) === text);
    if (!name) return null;
    const r = d.screenRect(d.def.byName.get(name));
    const c = document.querySelector('canvas');
    const b = c.getBoundingClientRect();
    return { x: b.left + ((r.left + r.right) / 2) * (b.width / c.width), y: b.top + ((r.top + r.bottom) / 2) * (b.height / c.height) };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y);
  return true;
};
const dismissDialogs = async () => {
  for (let i = 0; i < 10 && await page.evaluate(() => !!window.__dialogs?.active); i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
};
const stepOnto = (town, x, y) => page.evaluate(({ town, x, y }) => {
  const s = window.__session;
  s.startTownMode(town, 0);
  // From the square below, stepping north.
  s.univ.party.townLoc = { x, y: y + 1 }; s.center = { x, y: y + 1 };
  window.__redraw();
  void s.move(0);
}, { town, x, y });
await dismissDialogs();
await page.evaluate(() => { window.__session.univ.party.gold = 100; });
await stepOnto(4, 8, 49);
await page.waitForTimeout(800);
await shot('05-ferry-asks');
const ferryAsked = await clickButton('Yes');
await page.waitForTimeout(800);
await dismissDialogs();
const ferry = { asked: ferryAsked, ...(await where()), gold: await page.evaluate(() => window.__session.univ.party.gold) };
console.log('FERRY:', JSON.stringify(ferry));
await shot('05-ferry');
if (!ferry.asked || ferry.townNum !== 128 || ferry.gold !== 90) errors.push(`the ferry did not take the party to Marish for 10 gold: ${JSON.stringify(ferry)}`);

// Breaking into the thugs' quarters brings in four hidden creatures, hostile.
// The spot is on their locked door; the floor goes there instead, since the
// lock is not what is being tested.
const thugsBefore = await page.evaluate(() => { window.__session.startTownMode(4, 0); return window.__session.univ.town.monsters.filter((m) => m.isAlive).length; });
await stepOnto(4, 20, 53);
await page.waitForTimeout(500);
await page.keyboard.press('Escape'); // the lock dialog: Leave
await page.waitForTimeout(300);
await page.evaluate(() => {
  const s = window.__session;
  const t = s.univ.town.record.terrain;
  t[20][53] = t[20][54];
  s.univ.party.townLoc = { x: 20, y: 54 };
  void s.move(0);
});
await page.waitForTimeout(800);
await dismissDialogs();
const thugs = await page.evaluate(() => {
  const ms = window.__session.univ.town.monsters;
  return { alive: ms.filter((m) => m.isAlive).length, hostile: [43, 44, 45, 46].map((i) => ms[i]?.isAlive && !ms[i].isFriendly) };
});
console.log('THUGS:', JSON.stringify({ before: thugsBefore, ...thugs }));
await shot('06-thugs');
if (thugs.alive !== thugsBefore + 4 || !thugs.hostile.every(Boolean)) errors.push(`the thugs did not come in hostile: ${JSON.stringify({ thugsBefore, thugs })}`);

// The Orb of Thralni (src/game/e3Flight.ts): used below the Remote Aerie's
// peaks, (315,106), then over them by the arrow keys to the clearing at (318,106).
const orb = await page.evaluate(async () => {
  const s = window.__session;
  s.univ.party.specItems.add(6);
  s.debugLeaveTown();
  s.positionParty(6, 2, 27, 10);
  await s.useSpecItem(6);
  window.__redraw?.();
  return { flight: s.univ.party.partyStatus[1], said: s.univ.transcript.slice(-1)[0] };
});
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
}
const flown = await page.evaluate(() => {
  const p = window.__session.univ.party;
  return { x: p.sector.x * 48 + p.locInSec.x, y: p.sector.y * 48 + p.locInSec.y, flight: p.partyStatus[1] };
});
console.log('ORB:', JSON.stringify({ ...orb, flown }));
await shot('07-orb');
if (orb.flight !== 6 || flown.x !== 318 || flown.y !== 106) errors.push(`the orb did not fly the party over the peaks: ${JSON.stringify({ orb, flown })}`);

// The test panel (`?debug=1`, src/platform/debugPanel.ts): into Shayder, and
// Step onto spot #18, the ferry, which should ask.
await page.goto('http://localhost:5199/?scenario=exile3&pace=1&debug=1');
await page.waitForFunction(() => window.__session !== undefined, { timeout: 30000 });
await dismissDialogs();
await page.waitForSelector('#debug-panel li');
await page.selectOption('#debug-panel select', '4');
await page.click('#debug-panel button:text("Enter")');
await page.waitForTimeout(600);
const ferryRow = page.locator('#debug-panel li', { hasText: '#18 ' });
const panelRow = await ferryRow.textContent().catch(() => null);
await ferryRow.locator('button:text("Step")').click().catch(() => {});
await page.waitForTimeout(800);
const panelAsked = await page.evaluate(() => window.__dialogs.active?.getText?.('str1') ?? null);
console.log('PANEL:', JSON.stringify({ row: panelRow, asked: panelAsked?.slice(0, 40) }));
await shot('08-panel');
if (!panelRow || !/ferry/.test(panelAsked ?? '')) errors.push(`the test panel did not step onto the ferry: ${JSON.stringify({ panelRow, panelAsked })}`);

await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK');
