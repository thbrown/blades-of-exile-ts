/**
 * An MCP server that lets a Claude Code session play Blades of Exile.
 *
 * It opens the real game in a Chromium window you can watch (Playwright,
 * headed), loads `ai-player/bridge/bridge.ts` into the page, and offers tools
 * to look at the game as text, take a screenshot, and act: keys, the
 * toolbar, dialog choices, clicks on map squares and inventory buttons.
 * Every action waits until the game is waiting for the player again, then
 * answers with what changed.
 *
 * Started by Claude Code from `ai-player/.mcp.json`; see `ai-player/README.md`.
 * Environment:
 *   EXILE_URL       the game (default http://localhost:5199/); started with
 *                   `npx vite` from the repo root if nothing answers there.
 *   EXILE_HEADLESS  1 to run without a window.
 *   EXILE_PROFILE   the browser profile, which holds the save games
 *                   (default ai-player/runs/profile).
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const URL_BASE = process.env.EXILE_URL ?? 'http://localhost:5199/';
const PROFILE = process.env.EXILE_PROFILE ?? join(HERE, '..', 'runs', 'profile');
const RUN_DIR = join(HERE, '..', 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(RUN_DIR, { recursive: true });
const SCENARIOS = readdirSync(join(ROOT, 'public', 'scenarios'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

/** What happened, for a person reading the run afterwards. stdout is the MCP channel, so never print. */
function record(entry) {
  appendFileSync(join(RUN_DIR, 'actions.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// ------------------------------------------------------------- the browser

let vite = null;
let context = null;
let page = null;

async function reachable() {
  try {
    const res = await fetch(URL_BASE);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureGameServer() {
  if (await reachable()) return;
  const port = new URL(URL_BASE).port || '5199';
  vite = spawn('npx', ['vite', '--port', port, '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The game did not come up at ${URL_BASE}`);
}

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  await ensureGameServer();
  context = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.EXILE_HEADLESS === '1',
    viewport: { width: 1240, height: 900 },
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  // The classic single window, so map squares and buttons are where the
  // bridge expects them; no instant-help pop-ups between moves.
  await context.addInitScript(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('exile-js:prefs') ?? '{}');
      Object.assign(prefs, { DisplayMode: 5, ShowInstantHelp: false });
      localStorage.setItem('exile-js:prefs', JSON.stringify(prefs));
    } catch { /* the defaults will do */ }
  });
  page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', (e) => record({ pageerror: String(e) }));
  page.on('console', (m) => { if (m.type() === 'error') record({ consoleError: m.text() }); });
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto(URL_BASE);
  return page;
}

/** The page, with the game (or its main menu) loaded and the bridge in it. */
async function bridgePage() {
  const p = await ensurePage();
  // The game, or the main menu once its cards are drawn.
  await p.waitForFunction(
    () => window.__touchHost !== undefined
      || (document.body.classList.contains('starting') && document.querySelector('.startup-card') !== null),
    undefined, { timeout: 60000 },
  );
  await p.evaluate(async () => {
    if (!window.__aiBridge) await import('/ai-player/bridge/bridge.ts');
  });
  return p;
}

/** Wait until the game is waiting for the player again. */
async function settle(p, ms = 20000) {
  await p.waitForTimeout(80);
  try {
    await p.waitForFunction(() => window.__aiBridge?.settled() ?? true, undefined, { timeout: ms, polling: 50 });
  } catch {
    return '(The game was still busy after 20 seconds.)';
  }
  // Let the redraw that follows a settle happen before anyone looks.
  await p.waitForTimeout(60);
  return '';
}

async function observe(p, full = true) {
  return p.evaluate((f) => window.__aiBridge.observe(f), full);
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

/** Run an action, wait for the game, and answer with the result and what the game looks like now. */
async function act(name, args, fn) {
  const p = await bridgePage();
  let result;
  try {
    result = await fn(p);
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const busy = await settle(p);
  const view = await observe(p);
  record({ tool: name, args, result });
  return text([result && result !== 'ok' ? result : '', busy, view].filter(Boolean).join('\n'));
}

// ------------------------------------------------------------- keys

const KEY_ALIASES = {
  n: 'ArrowUp', north: 'ArrowUp', up: 'ArrowUp',
  s: 'ArrowDown', south: 'ArrowDown', down: 'ArrowDown',
  e: 'ArrowRight', east: 'ArrowRight', right: 'ArrowRight',
  w: 'ArrowLeft', west: 'ArrowLeft', left: 'ArrowLeft',
  ne: 'PageUp', 'north-east': 'PageUp', northeast: 'PageUp',
  nw: 'Home', 'north-west': 'Home', northwest: 'Home',
  se: 'PageDown', 'south-east': 'PageDown', southeast: 'PageDown',
  sw: 'End', 'south-west': 'End', southwest: 'End',
  space: 'Space', ' ': 'Space', enter: 'Enter', escape: 'Escape', esc: 'Escape',
};
const DIRECTION_KEYS = {
  north: 'ArrowUp', south: 'ArrowDown', east: 'ArrowRight', west: 'ArrowLeft',
  'north-east': 'PageUp', 'north-west': 'Home', 'south-east': 'PageDown', 'south-west': 'End',
};
const keyName = (k) => KEY_ALIASES[k] ?? KEY_ALIASES[k.toLowerCase()] ?? k;

/** Where the party stands and what's up, to tell when a walk should stop. */
const snapshot = (p) => p.evaluate(() => {
  const s = window.__session;
  const u = window.__univ;
  if (!s || !u) return null;
  // In combat, the PC whose turn it is; otherwise the party.
  const combat = window.__aiBridge?.inCombat() ?? false;
  const pc = u.party.pcs[u.curPc];
  const where = combat ? pc.combatPos : s.inTown ? u.party.townLoc : u.party.outLoc;
  return {
    at: `${where.x},${where.y}`, pc: combat ? u.curPc : -1,
    mode: s.mode, dialog: !!window.__dialogs?.active, talk: !!s.talk, shop: !!s.shop,
    lines: window.__aiBridge?.linesSince(0).end ?? 0,
  };
});

// ------------------------------------------------------------- tools

const server = new McpServer({ name: 'exile', version: '1.0.0' });

server.registerTool('observe', {
  description: 'Describe the game as text: what mode it is in, new messages, the party, the 9×9 map view with '
    + 'a legend, creatures and items in view, the toolbar, the current PC\'s pack, and any dialog\'s text and choices. '
    + 'Every action tool already ends with this, so call it only to look again.',
  inputSchema: {},
}, async () => {
  const p = await bridgePage();
  return text(await observe(p));
});

server.registerTool('screenshot', {
  description: 'A picture of the game screen as it is drawn (605×430 game pixels; the click tool takes '
    + 'coordinates in these pixels). Use it to check what the text view leaves out or when something looks wrong.',
  inputSchema: {},
}, async () => {
  const p = await bridgePage();
  await settle(p, 5000);
  const url = await p.evaluate(() => window.__aiBridge.screenshot());
  const data = url.slice(url.indexOf(',') + 1);
  const file = join(RUN_DIR, `shot-${Date.now()}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  record({ tool: 'screenshot', file });
  return { content: [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: `Saved as ${file}` }] };
});

server.registerTool('press', {
  description: 'Press keys, one after another, waiting for the game after each. Directions: north, south, east, '
    + 'west, north-east, north-west, south-east, south-west (or ArrowUp, Home, PageUp…). Game keys: t talk, l look, '
    + 'g get items, u use, b bash, L pick lock, r rest, m mage spell, p priest spell, s shoot, f start/end combat '
    + '(in town), e end combat, d defend (combat), w wait (town), Space pause/stand ready, a map, 1-6 show a PC\'s '
    + 'pack, 9 special items, 0 quests, A alchemy, Escape cancel, Enter confirm. Stops early if a dialog, '
    + 'conversation or shop opens.',
  inputSchema: { keys: z.array(z.string()).min(1).describe('e.g. ["north","north","t"]') },
}, async ({ keys }) => act('press', { keys }, async (p) => {
  let done = 0;
  for (const k of keys) {
    const before = await snapshot(p);
    await p.keyboard.press(keyName(k));
    done++;
    await settle(p);
    const after = await snapshot(p);
    if (after && before && done < keys.length
      && ((after.dialog && !before.dialog) || (after.talk && !before.talk) || (after.shop && !before.shop))) {
      return `Stopped after ${done} of ${keys.length} keys: something opened.`;
    }
  }
  return 'ok';
}));

server.registerTool('move', {
  description: 'Walk the party (or, in combat, the current PC) up to `steps` squares in one direction. '
    + 'Stops early when the party is blocked, a dialog, conversation or shop opens, combat starts, or a new '
    + 'message appears — so read the result.',
  inputSchema: {
    direction: z.enum(Object.keys(DIRECTION_KEYS)),
    steps: z.number().int().min(1).max(20).default(1),
  },
}, async ({ direction, steps }) => act('move', { direction, steps }, async (p) => {
  const now = await snapshot(p);
  if (now?.dialog || now?.talk || now?.shop) {
    return 'Not moving: a dialog, conversation or shop is open — answer it with choose (or press Escape) first.';
  }
  let taken = 0;
  for (; taken < steps; taken++) {
    const before = await snapshot(p);
    await p.keyboard.press(DIRECTION_KEYS[direction]);
    await settle(p);
    const after = await snapshot(p);
    if (!before || !after) break;
    if (after.dialog || after.talk || after.shop || after.mode !== before.mode) { taken++; break; }
    if (after.pc !== before.pc) { taken++; return `Moved ${taken} step(s); now it is another PC's turn.`; }
    if (after.at === before.at) {
      return `Did not move on step ${taken + 1}: blocked, or something (a door) changed instead — see the map.`;
    }
    // Each step says "Moved: east"; anything else is worth stopping to read.
    const said = await p.evaluate((n) => window.__aiBridge.linesSince(n).lines, before.lines);
    if (said.some((l) => !/^\s*Moved/.test(l))) { taken++; break; }
  }
  return taken < steps ? `Stopped after ${taken} of ${steps} step(s).` : 'ok';
}));

server.registerTool('toolbar', {
  description: 'Press a button on the game\'s toolbar by name — the observation lists the ones showing '
    + '(e.g. MAGE PRIEST LOOK TALK HAND USE MAP SWORD in town; CAMP SCROLL SAVE outdoors; SHIELD BAG WAIT SHOOT '
    + 'END ACT in combat).',
  inputSchema: { button: z.string() },
}, async ({ button }) => act('toolbar', { button }, (p) => p.evaluate((b) => window.__aiBridge.toolbar(b), button)));

server.registerTool('choose', {
  description: 'Answer the dialog, conversation or spell picker on top with one of the [names] the '
    + 'observation lists (a button, a talk word like talk:3, a spell like spell2, a caster like caster1, cast, cancel…).',
  inputSchema: { name: z.string() },
}, async ({ name }) => act('choose', { name }, (p) => p.evaluate((n) => window.__aiBridge.choose(n), name)));

server.registerTool('type', {
  description: 'Type into the dialog\'s text field (a name, a word to ask about, a number), then press Enter.',
  inputSchema: { text: z.string(), enter: z.boolean().default(true) },
}, async ({ text: t, enter }) => act('type', { text: t, enter },
  (p) => p.evaluate(([v, e]) => window.__aiBridge.typeText(v, e), [t, enter])));

server.registerTool('click_tile', {
  description: 'Click a map square by its map coordinates (x, y), as shown in the view. Use it to pick a target '
    + 'after t (talk), l (look), u (use), b (bash), L (pick lock), a spell or s (shoot). Right-click looks at it.',
  inputSchema: { x: z.number().int(), y: z.number().int(), right: z.boolean().default(false) },
}, async ({ x, y, right }) => act('click_tile', { x, y, right }, async (p) => {
  const at = await p.evaluate(([a, b]) => window.__aiBridge.tilePoint(a, b), [x, y]);
  if (typeof at === 'string') return at;
  await p.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  return 'ok';
}));

server.registerTool('item', {
  description: 'Press a button on an inventory row: use (equip/unequip a weapon or armour, drink, read…), give, '
    + 'drop, info, or name (clicking the name equips or unequips). `pc` (1-6) picks whose pack first.',
  inputSchema: {
    slot: z.number().int().min(1).max(24),
    button: z.enum(['use', 'give', 'drop', 'info', 'name']),
    pc: z.number().int().min(1).max(6).optional(),
  },
}, async ({ slot, button, pc }) => act('item', { slot, button, pc }, async (p) => {
  if (pc !== undefined) {
    await p.keyboard.press(String(pc));
    await settle(p);
  }
  const at = await p.evaluate(([s, b]) => window.__aiBridge.itemButtonPoint(s, b), [slot, button]);
  if (typeof at === 'string') return at;
  await p.waitForTimeout(50);
  await p.mouse.click(at.x, at.y);
  return 'ok';
}));

server.registerTool('click', {
  description: 'Click a point on the game screen, in game pixels (0-604 across, 0-429 down — the screenshot\'s '
    + 'own coordinates). For anything the other tools can\'t reach.',
  inputSchema: { x: z.number(), y: z.number(), right: z.boolean().default(false) },
}, async ({ x, y, right }) => act('click', { x, y, right }, async (p) => {
  const at = await p.evaluate(([a, b]) => window.__aiBridge.gamePoint(a, b), [x, y]);
  await p.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  return 'ok';
}));

server.registerTool('menu', {
  description: 'Press a main-menu button by the number the observation lists.',
  inputSchema: { index: z.number().int().min(0) },
}, async ({ index }) => act('menu', { index }, async (p) => {
  const said = await p.evaluate((i) => window.__aiBridge.menu(i), index);
  await p.waitForTimeout(500);
  return said;
}));

server.registerTool('start_game', {
  description: `Start a new game of a scenario with the ready-made party, leaving any game in progress (its saves `
    + `are kept). Scenarios here: ${SCENARIOS.join(', ')}. A seed makes the dice repeatable.`,
  inputSchema: { scenario: z.enum(SCENARIOS), seed: z.number().int().optional() },
}, async ({ scenario, seed }) => {
  const p = await ensurePage();
  const url = new URL(URL_BASE);
  url.searchParams.set('scenario', scenario);
  if (seed !== undefined) url.searchParams.set('seed', String(seed));
  await p.goto(url.toString());
  await p.waitForFunction(() => window.__session !== undefined, undefined, { timeout: 60000 });
  return act('start_game', { scenario, seed }, async () => 'ok');
});

server.registerTool('checkpoint', {
  description: 'Save the game now as a save of your own (a blue star in the File → Restore tree), with a note '
    + 'for the run log saying why — before a risky fight, a choice, or when you have made progress.',
  inputSchema: { note: z.string() },
}, async ({ note }) => act('checkpoint', { note }, async (p) => {
  const ok = await p.evaluate(async () => {
    if (!window.__scheduler) return false;
    await window.__scheduler.saveNow('Manual', 'manual');
    return true;
  });
  return ok ? `Saved. (${note})` : 'Could not save here.';
}));

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  try { await context?.close(); } catch { /* closing anyway */ }
  vite?.kill();
  process.exit(0);
};
process.stdin.on('close', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
