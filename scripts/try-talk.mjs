// Talks to someone in a converted scenario's town in the real UI and asks
// about keywords, one after another, reporting each reply, any dialogs that
// came up (answered as try-spot.mjs answers them), and what changed.
//
//   node scripts/try-talk.mjs <town> <name> <keyword> [keyword…] [options]
//
//   <name>          the start of their name as the conversation titles them
//   --scenario id   default exile3
//   --flag r,c=v    set a flag first (repeatable); 0xNNN=v for a party offset
//   --gold n        the party's gold
//   --item k        give the party special item k first (repeatable)
//   --answer a,b    button labels to press, dialog by dialog
//
// Needs `npx vite --port 5199` running.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const [town, name, ...keywords] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (town === undefined || name === undefined || keywords.length === 0) {
  console.error('usage: node scripts/try-talk.mjs <town> <name> <keyword…> [--flag r,c=v] [--gold n] [--item k] [--answer Yes]');
  process.exit(2);
}
const answers = (opt('answer') ?? '').split(',').filter(Boolean);
const DEFAULT_YES = ['Yes', 'Take', 'Climb', 'Pray', 'Get', 'Read', 'Pull', 'Push', 'Drink', 'Touch', 'Onward', 'Approach', 'Step In', 'Give', 'Pay', 'Buy'];

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
await page.goto(`http://localhost:5199/?scenario=${opt('scenario') ?? 'exile3'}&pace=1&debug=1`);
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => ({ up: window.__session !== undefined, dialog: !!window.__dialogs?.active }));
  if (s.up && !s.dialog) break;
  if (s.dialog) await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
await page.waitForSelector('#debug-panel li');
await page.selectOption('#debug-panel select', String(town));
await page.click('#debug-panel button:text("Enter")');
await page.waitForTimeout(500);

const state = () => page.evaluate(() => {
  const u = window.__session.univ;
  const owned = (list) => list.flatMap((v, i) => (v.exists && !v.property ? [i] : []));
  return {
    gold: u.party.gold, food: u.party.food, specItems: [...u.party.specItems].sort((a, b) => a - b),
    horses: owned(u.party.horses), boats: owned(u.party.boats),
  };
});
const setup = await page.evaluate(({ flags, gold, items }) => {
  const u = window.__session.univ;
  for (const [r, c, v] of flags) u.party.setSdf(r, c, v);
  if (gold !== null) u.party.gold = gold;
  for (const k of items) u.party.specItems.add(k);
  return true;
}, {
  flags: all('flag').map((f) => {
    const [where, v] = f.split('=');
    if (/^0x/i.test(where)) { const idx = parseInt(where, 16) - 0x84; return [Math.floor(idx / 10), idx % 10, Number(v)]; }
    const [r, c] = where.split(',').map(Number);
    return [r, c, Number(v)];
  }),
  gold: opt('gold') === undefined ? null : Number(opt('gold')),
  items: all('item').map(Number),
});
void setup;
const before = await state();

const who = await page.evaluate(async (want) => {
  const s = window.__session;
  const u = s.univ;
  for (const m of u.town.monsters) {
    if (!m.isAlive || m.personality < 0) continue;
    const person = u.scenario.townTalk[Math.floor(m.personality / 10)]?.people[m.personality % 10];
    if (!person?.title?.toLowerCase().startsWith(want.toLowerCase())) continue;
    u.party.townLoc = { x: m.curLoc.x, y: m.curLoc.y + 1 };
    s.center = { ...u.party.townLoc };
    await s.talkTo(m.curLoc);
    window.__redraw();
    return { title: s.talk?.title, opening: s.talk?.str1 };
  }
  return null;
}, name);
if (!who) {
  console.error(`nobody called ${name} in town ${town}`);
  await browser.close();
  process.exit(1);
}
console.log(`TALK: ${who.title} ${who.opening?.slice(0, 200)}`);

const dialog = () => page.evaluate(() => {
  const d = window.__dialogs.active;
  if (!d?.def) return null;
  const names = [...d.def.byName.keys()];
  return {
    text: names.filter((n) => !n.startsWith('btn') && d.getText(n)).map((n) => d.getText(n)),
    buttons: names.filter((n) => n.startsWith('btn')).map((n) => ({ name: n, label: d.getText(n) })),
  };
});
const press = async (n) => {
  const at = await page.evaluate((nm) => {
    const d = window.__dialogs.active;
    const r = d.screenRect(d.def.byName.get(nm));
    const c = document.querySelector('canvas');
    const b = c.getBoundingClientRect();
    return { x: b.left + ((r.left + r.right) / 2) * (b.width / c.width), y: b.top + ((r.top + r.bottom) / 2) * (b.height / c.height) };
  }, n);
  await page.mouse.click(at.x, at.y);
};
const answerDialogs = async () => {
  for (let n = 0; n < 20; n++) {
    const d = await dialog();
    if (!d) return;
    const want = answers[0];
    const pick = d.buttons.find((b) => b.label === want)
      ?? (answers.length === 0 ? d.buttons.find((b) => DEFAULT_YES.includes(b.label)) : undefined);
    if (pick && d.buttons.length > 1) {
      if (want === pick.label) answers.shift();
      console.log(`  DIALOG: ${d.text.join(' | ').slice(0, 240)}\n    -> ${pick.label}`);
      await press(pick.name);
    } else {
      console.log(`  DIALOG: ${d.text.join(' | ').slice(0, 240)}\n    -> Enter`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(400);
  }
};

for (const kw of keywords) {
  // Ask as the Ask About... prompt does, without the prompt.
  void page.evaluate((k) => window.__session.talk?.askAbout(k), kw);
  await page.waitForTimeout(600);
  await answerDialogs();
  const reply = await page.evaluate(() => window.__session.talk?.str1 ?? '(conversation over)');
  console.log(`ASK ${kw}: ${reply.slice(0, 400)}`);
}
const after = await state();
console.log('BEFORE:', JSON.stringify(before));
console.log('AFTER: ', JSON.stringify(after));
await page.screenshot({ path: `${process.env.SHOTS_DIR ?? '/tmp/exile-shots'}/talk-${town}-${name}.png` });
await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
