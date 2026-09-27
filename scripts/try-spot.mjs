// Tries one of a converted scenario's special spots in the real UI, through
// the test panel (`?debug=1`, src/platform/debugPanel.ts), and reports what
// happened: every dialog's text and the buttons pressed, the lines the game
// logged, and where the party ended up. Screenshots go to SHOTS_DIR.
//
//   node scripts/try-spot.mjs <town> <spot> [options]
//
//   <spot>          the spot's number as the panel lists it (`#18` → 18), or
//                   x,y for a square
//   --scenario id   default exile3
//   --flag r,c=v    set a flag first (repeatable); 0xNNN=v for a party offset
//   --gold n        the party's gold
//   --item k        give the party special item k first (repeatable)
//   --level n       every PC's level
//   --answer a,b    button labels to press, dialog by dialog; anything else
//                   is dismissed with Enter (default: Yes/Take/Climb/Pray…,
//                   whichever is there)
//   --number n      the answer to a number prompt (repeatable, in order)
//   --wait n        then pass n turns (Space), answering what comes up
//   --show where    print a flag's value at the end (r,c or 0xNNN; repeatable)
//   --use           use the square from beside it (the U key) instead
//   --run           run the spot's node instead of stepping onto it
//
// Needs `npx vite --port 5199` running.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const [town, spot] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (town === undefined || spot === undefined) {
  console.error('usage: node scripts/try-spot.mjs <town> <spot> [--flag r,c=v] [--gold n] [--answer Yes,OK] [--run]');
  process.exit(2);
}
const scenario = opt('scenario') ?? 'exile3';
const answers = (opt('answer') ?? '').split(',').filter(Boolean);
const DEFAULT_YES = ['Yes', 'Take', 'Climb', 'Pray', 'Get', 'Read', 'Pull', 'Push', 'Drink', 'Touch', 'Onward', 'Approach', 'Step In', 'Give', 'Pay'];
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => {
  try {
    localStorage.setItem('exile-js:prefs', JSON.stringify({ ShowInstantHelp: false, DisplayMode: 5, UIScale: 2 }));
  } catch { /* defaults */ }
});
await page.goto(`http://localhost:5199/?scenario=${scenario}&pace=1&debug=1`);
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => ({ up: window.__session !== undefined, dialog: !!window.__dialogs?.active }));
  if (s.up && !s.dialog) break;
  if (s.dialog) await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
await page.waitForSelector('#debug-panel li');

const dialog = () => page.evaluate(() => {
  const d = window.__dialogs.active;
  if (!d?.def) return null;
  const names = [...d.def.byName.keys()];
  return {
    text: names.filter((n) => !n.startsWith('btn') && d.getText(n)).map((n) => d.getText(n)),
    buttons: names.filter((n) => n.startsWith('btn')).map((n) => ({ name: n, label: d.getText(n) })),
  };
});
const press = async (name) => {
  const at = await page.evaluate((n) => {
    const d = window.__dialogs.active;
    const r = d.screenRect(d.def.byName.get(n));
    const c = document.querySelector('canvas');
    const b = c.getBoundingClientRect();
    return { x: b.left + ((r.left + r.right) / 2) * (b.width / c.width), y: b.top + ((r.top + r.bottom) / 2) * (b.height / c.height) };
  }, name);
  await page.mouse.click(at.x, at.y);
};

// Go there, and set things up.
await page.selectOption('#debug-panel select', String(town));
await page.click('#debug-panel button:text("Enter")');
await page.waitForTimeout(500);
for (const f of all('flag')) {
  const [where, value] = f.split('=');
  await page.fill('#debug-panel section:has(h3:text("Flags")) input:not([type=number])', where);
  await page.fill('#debug-panel section:has(h3:text("Flags")) input[type=number]', value);
  await page.click('#debug-panel button:text("Set")');
}
await page.evaluate(({ gold, items, level }) => {
  const p = window.__session.univ.party;
  if (gold !== null) p.gold = gold;
  for (const k of items) p.specItems.add(k);
  if (level !== null) for (const pc of p.pcs) pc.level = level;
}, {
  gold: opt('gold') === undefined ? null : Number(opt('gold')),
  items: all('item').map(Number),
  level: opt('level') === undefined ? null : Number(opt('level')),
});
const logStart = await page.evaluate(() => window.__session.univ.transcript.length);

const row = /^\d+$/.test(spot)
  ? page.locator('#debug-panel li', { hasText: new RegExp(`^#${spot} `) }).first()
  : page.locator('#debug-panel li', { hasText: `(${spot})` }).first();
if (await row.count() === 0) {
  console.error(`no spot ${spot} in town ${town}`);
  await browser.close();
  process.exit(1);
}
console.log('SPOT:', await row.locator('.what').textContent());
const how = args.includes('--run') ? 'Run' : args.includes('--use') ? 'Use' : 'Step';
await row.locator(`button:text("${how}")`).click();
await page.waitForTimeout(700);

// Answer whatever comes up.
const numbers = all('number');
let n = 0;
const answerAll = async () => {
for (let k = 0; k < 30; k++, n++) {
  const d = await dialog();
  if (!d) break;
  const isNum = await page.evaluate(() => window.__dialogs.active.def.byName.has('number'));
  if (isNum && numbers.length > 0) {
    const v = numbers.shift();
    await page.evaluate((v) => window.__dialogs.active.setNum('number', Number(v)), v);
    console.log(`DIALOG ${n}: ${d.text.join(' | ').slice(0, 300)}\n  -> ${v}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    continue;
  }
  await page.screenshot({ path: `${SHOTS}/try-${town}-${spot}-${n}.png` });
  const want = answers[0];
  // A select-PC prompt (select-pc.xml): the first PC's button.
  const isSelectPc = await page.evaluate(() => window.__dialogs.active.def.byName.has('pick1'));
  if (isSelectPc) {
    console.log(`DIALOG ${n}: ${d.text.join(' | ').slice(0, 300)}\n  -> pick1`);
    await press('pick1');
    await page.waitForTimeout(500);
    continue;
  }
  const pick = d.buttons.find((b) => b.label === want)
    ?? (answers.length === 0 ? d.buttons.find((b) => DEFAULT_YES.includes(b.label)) : undefined);
  if (pick && d.buttons.length > 1) {
    if (want === pick.label) answers.shift();
    console.log(`DIALOG ${n}: ${d.text.join(' | ').slice(0, 300)}\n  -> ${pick.label}`);
    await press(pick.name);
  } else {
    console.log(`DIALOG ${n}: ${d.text.join(' | ').slice(0, 300)}\n  -> ${d.buttons.map((b) => b.label).join('/') || 'Enter'}`);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
}
};
await answerAll();
for (let t = Number(opt('wait') ?? 0); t > 0; t--) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  if (await dialog()) await answerAll();
}
await page.screenshot({ path: `${SHOTS}/try-${town}-${spot}-end.png` });
const after = await page.evaluate((from) => {
  const s = window.__session;
  const p = s.univ.party;
  return {
    log: s.univ.transcript.slice(from),
    where: s.isOutdoors ? { sector: p.sector, at: p.locInSec } : { town: p.townNum, at: p.townLoc },
    place: s.locationName(), gold: p.gold, food: p.food,
  };
}, logStart);
console.log('LOG:', after.log.map((l) => l.trim()).filter(Boolean).join(' / '));
for (const where of all('show')) {
  const v = await page.evaluate((w) => {
    const p = window.__session.univ.party;
    const [r, c] = /^0x/i.test(w) ? (() => { const i = parseInt(w, 16) - 0x84; return [Math.floor(i / 10), i % 10]; })()
      : w.split(',').map(Number);
    return `${r},${c} = ${p.getSdf(r, c)}`;
  }, where);
  console.log(`FLAG ${where}: ${v}`);
}
console.log('NOW:', JSON.stringify({ place: after.place, ...after.where, gold: after.gold, food: after.food }));
console.log(`shots: ${SHOTS}/try-${town}-${spot}-*.png`);
await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
