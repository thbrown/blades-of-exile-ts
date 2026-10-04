/**
 * The AI player's side of the page: what the game looks like as text, and
 * where on the canvas a named thing is, so the MCP server
 * (`ai-player/server/server.mjs`) can play through the real UI.
 *
 * Loaded into the running game by the server (`import('/ai-player/bridge/bridge.ts')`
 * on the Vite dev server) — the game itself never imports it. It reads what
 * the page already exposes for verification (`__session`, `__univ`,
 * `__dialogs`, `__desktop`, and `__touchHost`, the phone controls' view of
 * the toolbar, dialogs and talk words), and acts through those or through
 * real mouse clicks and key presses that the server sends. Nothing here
 * changes a rule: a choice goes through the same path a finger or a click
 * takes.
 */

import { Attitude } from '../../src/data/monster';
import { ItemType } from '../../src/data/item';
import { TerObstruct, TerSpec } from '../../src/data/terrain';
import type { CastDialog } from '../../src/dialogs/castDialog';
import type { DialogHost, TouchChoice, TouchView } from '../../src/dialogs/dialog';
import { GameMode, isCombat } from '../../src/game/modes';
import type { GameSession } from '../../src/game/session';
import { ItemWinMode } from '../../src/game/itemWindow';
import type { TouchPadHost } from '../../src/platform/touchControls';
import type { Desktop } from '../../src/render/desktop';
import {
  ITEM_ROWS, LINES_IN_ITEM_WIN, TER_VIEW_CENTER, TER_VIEW_TILES, ToolbarButton, WIN_RECTS, terrainSpotPos,
} from '../../src/render/layout';
import type { Screen } from '../../src/render/screen';
import { canDrawTerrainSpot, inventoryLabel, statusBarText } from '../../src/render/screen';
import { shopRowRects } from '../../src/render/shopScreen';
import type { Universe } from '../../src/universe/universe';
import { MainStatus } from '../../src/universe/skills';

interface Hooks {
  __session?: GameSession;
  __univ?: Universe;
  __screen?: Screen;
  __dialogs?: DialogHost;
  __desktop?: Desktop;
  __touchHost?: TouchPadHost;
  __animPending?: () => number;
  __pendingSquare?: () => 'talk' | 'look' | 'use' | 'bash' | 'pick' | null;
}
const w = window as unknown as Hooks;

/** A point on the page, in CSS pixels, for the server's mouse. */
export interface PagePoint { x: number; y: number }

// ---------------------------------------------------------------- messages

/**
 * Every transcript line since the bridge started, numbered, so each look
 * can say what's new. The transcript itself keeps only the last few dozen,
 * so the bridge listens to `addStringToBuf` rather than diffing it.
 */
const log: string[] = [];
let shownUpTo = 0;
const TAPPED = Symbol('ai-bridge-tapped');

function tapTranscript(): void {
  const univ = w.__univ as (Universe & { [TAPPED]?: boolean }) | undefined;
  if (!univ || univ[TAPPED]) return;
  univ[TAPPED] = true;
  // What was said before the bridge arrived (a new game's welcome) counts as new.
  log.push(...univ.transcript);
  const original = univ.addStringToBuf.bind(univ);
  univ.addStringToBuf = (line: string) => {
    log.push(line);
    original(line);
  };
}

// ---------------------------------------------------------------- the map

const DIRS: [number, number, string][] = [
  [0, -1, 'north'], [1, -1, 'north-east'], [1, 0, 'east'], [1, 1, 'south-east'],
  [0, 1, 'south'], [-1, 1, 'south-west'], [-1, 0, 'west'], [-1, -1, 'north-west'],
];

/** "3 east, 1 north" — where a square is from the party. */
function offsetWords(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here';
  const parts: string[] = [];
  if (dx !== 0) parts.push(`${Math.abs(dx)} ${dx > 0 ? 'east' : 'west'}`);
  if (dy !== 0) parts.push(`${Math.abs(dy)} ${dy > 0 ? 'south' : 'north'}`);
  return parts.join(', ');
}

function terrainNote(session: GameSession, ter: number): string {
  const t = session.univ.scenario.terTypes[ter];
  if (!t) return `terrain ${ter}`;
  const bits: string[] = [];
  switch (t.blockage) {
    case TerObstruct.BLOCK_SIGHT: bits.push('blocks sight'); break;
    case TerObstruct.BLOCK_MONSTERS: bits.push('blocks monsters'); break;
    case TerObstruct.BLOCK_MOVE: bits.push('impassable'); break;
    case TerObstruct.BLOCK_MOVE_AND_SHOOT: bits.push('impassable, blocks missiles'); break;
    case TerObstruct.BLOCK_MOVE_AND_SIGHT: bits.push('blocks movement and sight'); break;
    default: break;
  }
  switch (t.special) {
    case TerSpec.DAMAGING: case TerSpec.DANGEROUS: bits.push('dangerous'); break;
    case TerSpec.LOCKABLE: bits.push('door, can be locked'); break;
    case TerSpec.UNLOCKABLE: bits.push('locked: pick or bash it'); break;
    case TerSpec.IS_A_SIGN: bits.push('a sign: look at it'); break;
    case TerSpec.IS_A_CONTAINER: bits.push('container: may hold items'); break;
    case TerSpec.TOWN_ENTRANCE: bits.push('town entrance'); break;
    case TerSpec.CHANGE_WHEN_USED: case TerSpec.CALL_SPECIAL_WHEN_USED: bits.push('can be used (u)'); break;
    case TerSpec.BED: bits.push('bed'); break;
    case TerSpec.BRIDGE: bits.push('bridge'); break;
    case TerSpec.CRUMBLING: bits.push('crumbling'); break;
    case TerSpec.CONVEYOR: bits.push('conveyor'); break;
    default: break;
  }
  return bits.length ? `${t.name} (${bits.join('; ')})` : t.name;
}

/** Letters for the terrain kinds that aren't plain floor or wall. */
const SYMBOL_POOL = 'ghjkmnpqrstuvwxyzGHJKMNPQRSTUVWXYZ%&+<>^'.split('');
/** What a square is → its letter, kept for the session so a door stays `j`. */
const symbols = new Map<string, string>();

/** The 9×9 terrain view as text, with a legend, creatures and items. */
function describeView(session: GameSession): string[] {
  const { univ } = session;
  const town = univ.town;
  const center = session.center;
  const maxDim = town ? town.record.maxDim : Math.min(96, 48 * univ.scenario.outWidth);
  const maxDimY = town ? town.record.maxDim : Math.min(96, 48 * univ.scenario.outHeight);
  const partyAt = isCombat(session.mode)
    ? univ.party.pcs[univ.curPc]?.combatPos ?? center
    : town ? univ.party.townLoc : univ.party.outLoc;

  // Creatures and items first: they take their squares on the map.
  const marks = new Map<string, string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const creatures: string[] = [];
  const inView = (x: number, y: number) =>
    Math.abs(x - center.x) <= TER_VIEW_CENTER && Math.abs(y - center.y) <= TER_VIEW_CENTER;
  let n = 0;
  if (town) {
    for (const m of town.monsters) {
      if (!m.isAlive || !inView(m.curLoc.x, m.curLoc.y) || !session.partyCanSeeMonst(m)) continue;
      const tag = n < 9 ? String(n + 1) : String.fromCharCode(65 + n - 9);
      n++;
      marks.set(key(m.curLoc.x, m.curLoc.y), tag);
      const hostile = m.attitude === Attitude.HOSTILE_A || m.attitude === Attitude.HOSTILE_B;
      creatures.push(`  ${tag} ${m.getName()} at (${m.curLoc.x},${m.curLoc.y}) — `
        + `${offsetWords(m.curLoc.x - partyAt.x, m.curLoc.y - partyAt.y)}; `
        + `${hostile ? 'HOSTILE' : 'friendly'}, health ${m.health}`);
    }
  } else {
    for (const enc of univ.party.outC) {
      if (!enc.exists || !inView(enc.mLoc.x, enc.mLoc.y)) continue;
      if (session.canSeeLight(univ.party.outLoc, enc.mLoc) >= 5) continue;
      const which = enc.whatMonst.monst.find((m) => m > 0);
      const name = which === undefined ? 'creatures' : univ.scenario.scenMonsters[which]?.name ?? 'creatures';
      const tag = n < 9 ? String(n + 1) : String.fromCharCode(65 + n - 9);
      n++;
      marks.set(key(enc.mLoc.x, enc.mLoc.y), tag);
      creatures.push(`  ${tag} a group of ${name} at (${enc.mLoc.x},${enc.mLoc.y}) — `
        + `${offsetWords(enc.mLoc.x - partyAt.x, enc.mLoc.y - partyAt.y)}`);
    }
  }
  const items: string[] = [];
  if (town) {
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || item.contained) continue;
      const { x, y } = item.itemLoc;
      if (!inView(x, y) || !town.isExplored(x, y) || !session.ptInLight(univ.party.townLoc, item.itemLoc)) continue;
      if (!marks.has(key(x, y))) marks.set(key(x, y), '*');
      const under = univ.scenario.terTypes[town.record.terrain[x]?.[y] ?? 0]?.name ?? '';
      items.push(`  ${inventoryLabel(item)} at (${x},${y})${under ? ` on ${under}` : ''} — `
        + `${offsetWords(x - partyAt.x, y - partyAt.y)}`);
    }
  }
  if (isCombat(session.mode)) {
    univ.party.pcs.forEach((pc, i) => {
      if (pc.mainStatus === MainStatus.ALIVE) marks.set(key(pc.combatPos.x, pc.combatPos.y), 'abcdef'[i]!);
    });
  } else {
    marks.set(key(partyAt.x, partyAt.y), '@');
  }

  // Terrain: '.' for open ground, '#' for walls, a letter per other kind —
  // each kind keeping its letter from one look to the next (`symbols`).
  // Keyed by what the square *is* (name and properties), so the four facings
  // of a chair are one letter.
  const legend = new Map<string, string>();
  const symbol = (ter: number): string => {
    const note = terrainNote(session, ter);
    let s = symbols.get(note);
    if (s === undefined) {
      s = newSymbol(ter);
      symbols.set(note, s);
    }
    legend.set(note, s);
    return s;
  };
  const newSymbol = (ter: number): string => {
    let s: string;
    const t = univ.scenario.terTypes[ter];
    const open = t && t.blockage === TerObstruct.CLEAR && t.special === TerSpec.NONE;
    const wall = t && t.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT && t.special === TerSpec.NONE;
    if (symbols.size >= SYMBOL_POOL.length + 4) symbols.clear();
    const taken = new Set(symbols.values());
    if (open && !taken.has('.')) s = '.';
    else if (open && !taken.has(',')) s = ',';
    else if (wall && !taken.has('#')) s = '#';
    else if (wall && !taken.has('=')) s = '=';
    else s = SYMBOL_POOL.find((c) => !taken.has(c)) ?? '?';
    return s;
  };

  const lines: string[] = [];
  const xs = Array.from({ length: TER_VIEW_TILES }, (_, q) => center.x + q - TER_VIEW_CENTER);
  lines.push(`      ${xs.map((x) => String(x).padStart(3)).join('')}   (x)`);
  for (let row = 0; row < TER_VIEW_TILES; row++) {
    const y = center.y + row - TER_VIEW_CENTER;
    let line = `y=${String(y).padStart(3)} `;
    for (const x of xs) {
      let c = ' ';
      if (canDrawTerrainSpot(session, x, y, maxDim, maxDimY)) {
        const ter = town ? town.record.terrain[x]?.[y] ?? 0 : univ.out.at(x, y);
        c = symbol(ter);
        c = marks.get(key(x, y)) ?? c;
      } else if (x < 0 || y < 0 || x >= maxDim || y >= maxDimY) {
        c = '~';
      }
      line += `  ${c}`;
    }
    lines.push(line);
  }
  const legendLines = [...legend.entries()].map(([note, s]) => `  ${s} ${note}`);
  const out: string[] = [];
  out.push(`View (9×9, north up, centred on (${center.x},${center.y})). `
    + `${isCombat(session.mode) ? 'a-f: your PCs' : '@: your party'}; digits: creatures; *: items; `
    + 'blank: unseen; ~: off the map edge.');
  out.push(...lines);
  out.push('Legend:', ...legendLines);
  if (creatures.length) out.push('Creatures in view:', ...creatures);
  if (items.length) out.push('Items on the ground in view:', ...items);
  return out;
}

// ---------------------------------------------------------------- the rest

function choiceLines(choices: TouchChoice[] | undefined): string[] {
  return (choices ?? []).map((c) => {
    const flags = [c.on ? 'selected' : '', c.disabled ? 'unavailable' : ''].filter(Boolean).join(', ');
    return `  [${c.name}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}${flags ? ` (${flags})` : ''}`;
  });
}

function describeDialogView(view: TouchView): string[] {
  const out: string[] = [];
  if (view.left?.length) out.push(`${view.leftHeading ?? 'List'}:`, ...choiceLines(view.left));
  out.push(`${view.rightHeading ?? 'Choices'}:`, ...choiceLines(view.right));
  if (view.field) out.push(`Text field "${view.field.name}": "${view.field.text}" (use the type tool)`);
  return out;
}

/** The words of the dialog on top: an XML dialog's text controls, or a plain dialog's text. */
function dialogText(dialogs: DialogHost): string[] {
  const d = dialogs.active as unknown as {
    spec?: { text?: string; title?: string };
    def?: { controls: { name: string; kind: string }[] };
    getText?: (name: string) => string;
  } | null;
  if (!d) return [];
  const out: string[] = [];
  if (d.spec) {
    if (d.spec.title) out.push(`Title: ${d.spec.title}`);
    if (d.spec.text) out.push(d.spec.text);
  }
  if (d.def && d.getText) {
    for (const c of d.def.controls) {
      if (c.kind !== 'text') continue;
      const text = d.getText(c.name).trim();
      if (text) out.push(text);
    }
  }
  return out;
}

function describeCast(dialog: CastDialog): string[] {
  const v = dialog.view;
  const out = [`Casting ${v.priest ? 'a priest' : 'a mage'} spell (page ${v.page + 1}).`];
  if (v.feedback) out.push(`Says: ${v.feedback}`);
  out.push('Casters (choose with [casterN]):');
  for (const p of v.party) {
    if (!p.present) continue;
    out.push(`  [caster${p.index + 1}] ${p.name} SP ${p.sp}${p.index === v.caster ? ' (casting)' : ''}`
      + `${p.canCast ? '' : ' (cannot cast)'}`);
  }
  out.push('Spells (choose with [spellN]; only "known" ones can be cast):');
  for (const s of v.slots) {
    out.push(`  [spell${s.slot + 1}] ${s.name} — level ${s.level}, cost ${s.cost}`
      + `${s.known ? '' : ', not known'}${s.castable ? '' : ', cannot cast now'}`
      + `${s.spell === v.spell ? ' (chosen)' : ''}`);
  }
  if (v.needsTarget) {
    out.push('This spell needs a PC target: choose with [targetN] (N = 1-6).');
  }
  out.push('Then [cast], or [cancel]. Higher levels are on the other page: press the Space key to flip.');
  return out;
}

function describeShop(session: GameSession): string[] {
  const shop = session.shop!;
  const out = [`Shop: ${shop.name} — ${shop.title}. You have ${session.univ.party.gold} gold.`,
    'Buy by pressing the row\'s letter key (a-h). Scroll with ArrowUp/ArrowDown; leave with Escape.'];
  for (let row = 0; row < 8; row++) {
    const target = shop.rowEntry(row);
    if (!target) break;
    out.push(`  ${'abcdefgh'[row]}) ${target.entry.item.fullName} — ${shop.cost(target.entry)} gold`);
  }
  if (shop.maxScroll > 0) out.push(`  (rows ${shop.scroll + 1}-${shop.scroll + 8} shown; more by scrolling)`);
  return out;
}

function describeParty(session: GameSession): string[] {
  const { univ } = session;
  const combat = isCombat(session.mode);
  const out = [`Party (day ${Math.floor(univ.party.age / 3700) + 1}, ${univ.party.gold} gold, ${univ.party.food} food):`];
  univ.party.pcs.forEach((pc, i) => {
    if (pc.mainStatus === MainStatus.ABSENT) return;
    const status = MainStatus[pc.mainStatus] ?? String(pc.mainStatus);
    const ap = combat ? `, ${pc.ap} AP` : '';
    const here = combat ? ` at (${pc.combatPos.x},${pc.combatPos.y})` : '';
    out.push(`  ${i + 1}. ${pc.name}: level ${pc.level}, HP ${pc.curHealth}/${pc.maxHealth}, `
      + `SP ${pc.curSp}/${pc.maxSp}${ap}${here}${status === 'ALIVE' ? '' : ` — ${status}`}`
      + `${i === univ.curPc ? '  <- current' : ''}`);
  });
  return out;
}

function describeInventory(session: GameSession, screen: Screen): string[] {
  const { univ } = session;
  const win = screen.itemWindow;
  if (win.mode >= ItemWinMode.SPECIAL) {
    return ['Inventory panel is showing special items or quests; press a digit 1-6 to see a PC\'s pack.'];
  }
  const pc = univ.party.pcs[screen.itemPage] ?? univ.currentPc;
  const out = [`${pc.name}'s pack (item tool: slot number, button use/give/drop/info):`];
  let any = false;
  pc.items.forEach((item, i) => {
    if (!item || item.variety === ItemType.NO_ITEM) return;
    any = true;
    out.push(`  ${i + 1}. ${inventoryLabel(item)}${pc.equip[i] ? ' [equipped]' : ''}`);
  });
  if (!any) out.push('  (empty)');
  return out;
}

/** Runs of the same line as one: "Moved: south (×10)". */
function collapse(lines: string[]): string[] {
  const out: string[] = [];
  let run = 0;
  lines.forEach((line, i) => {
    run++;
    if (lines[i + 1] === line) return;
    out.push(run > 1 ? `${line.trimEnd()} (×${run})` : line);
    run = 0;
  });
  return out;
}

/** The modes that wait for the player to pick a square, and what for. */
const PICKING: Partial<Record<GameMode, string>> = {
  [GameMode.TALK_TOWN]: 'who to talk to',
  [GameMode.TOWN_TARGET]: 'where to aim the spell',
  [GameMode.ITEM_TARGET]: 'where to use the item',
  [GameMode.USE_TOWN]: 'what to use (an adjacent square)',
  [GameMode.DROP_TOWN]: 'where to drop it',
  [GameMode.BASH_TOWN]: 'which door to bash',
  [GameMode.PICK_TOWN]: 'which lock to pick',
  [GameMode.SPELL_TARGET]: 'the spell\'s target',
  [GameMode.FIRING]: 'what to shoot',
  [GameMode.THROWING]: 'what to throw at',
  [GameMode.FANCY_TARGET]: 'the spell\'s targets',
  [GameMode.DROP_COMBAT]: 'where to drop it',
  [GameMode.LOOK_OUTDOORS]: 'what to look at',
  [GameMode.LOOK_TOWN]: 'what to look at',
  [GameMode.LOOK_COMBAT]: 'what to look at',
};

/** The town commands that wait for a square without a mode of their own. */
const PENDING = {
  talk: 'who to talk to', use: 'what to use (an adjacent square)', bash: 'which door to bash',
  pick: 'which lock to pick',
} as const;

/** Everything the player can see and do right now, as text. */
export function observe(full = true): string {
  tapTranscript();
  const session = w.__session;
  const dialogs = w.__dialogs;
  const screen = w.__screen;
  const host = w.__touchHost;
  const out: string[] = [];

  if (document.body.classList.contains('starting') || !session || !dialogs || !screen || !host) {
    out.push('MAIN MENU (no game running). Buttons:');
    menuButtons().forEach((b, i) => out.push(`  [${i}] ${b.label}`));
    out.push('Use the menu tool with a number, or start_game.');
    return out.join('\n');
  }

  const fresh = log.slice(shownUpTo);
  shownUpTo = log.length;

  const castDialog = host.spells.dialog();
  const view = host.dialog.view();
  let what: string;
  if (castDialog) what = 'CHOOSING A SPELL';
  else if (dialogs.active) what = 'DIALOG';
  else if (session.talk) what = 'TALKING';
  else if (session.shop) what = 'SHOP';
  else if (isCombat(session.mode)) what = 'COMBAT';
  else if (session.inTown) what = 'TOWN';
  else what = 'OUTDOORS';
  out.push(`== ${what} — ${statusBarText(session)} ==`);

  if (fresh.length) out.push('New messages:', ...collapse(fresh).map((l) => `  ${l}`));

  if (castDialog) {
    out.push(...describeCast(castDialog));
  } else if (dialogs.active || session.talk) {
    if (session.talk && !dialogs.active) {
      const t = session.talk;
      out.push(`${t.title}`, t.str1, ...(t.str2 ? [t.str2] : []));
    } else {
      out.push(...dialogText(dialogs));
    }
    if (view) out.push(...describeDialogView(view));
    else out.push('(This dialog has no listed choices: use a screenshot and click, or press keys.)');
    out.push('Answer with the choose tool and a [name].');
  } else if (session.shop) {
    out.push(...describeShop(session));
  }

  if (full && !session.shop) {
    out.push(...describeParty(session));
    if (!castDialog && !dialogs.active && !session.talk) {
      out.push(...describeView(session));
      const mode = host.mode();
      if (mode) {
        const names = host.buttons(mode).map((b) => ToolbarButton[b]).filter(Boolean);
        out.push(`Toolbar: ${names.join(' ')}`);
      }
      const pendingSquare = w.__pendingSquare?.() ?? null;
      const picking = pendingSquare && pendingSquare !== 'look' ? PENDING[pendingSquare] : PICKING[session.mode];
      if (host.aiming()) {
        out.push('AIMING: choose a target square with click_tile (x,y), Space to cast/rotate, Escape to cancel.');
      } else if (picking) {
        out.push(`WAITING FOR A SQUARE: ${picking} — pick one with click_tile (x,y), or Escape to cancel.`);
      }
      out.push(...describeInventory(session, screen));
    }
  }
  return out.join('\n');
}

/**
 * Transcript lines since line `from` of the bridge's log, and where the log
 * ends — for a walk to tell "Moved: east" from something worth stopping for.
 */
export function linesSince(from: number): { lines: string[]; end: number } {
  tapTranscript();
  return { lines: log.slice(from), end: log.length };
}

export function inCombat(): boolean {
  const session = w.__session;
  return session !== undefined && isCombat(session.mode);
}

/** Whether the game is waiting for the player — nothing animating or running. */
export function settled(): boolean {
  const session = w.__session;
  if (!session || document.body.classList.contains('starting')) return true;
  if (w.__dialogs?.active) return true;
  const anim = w.__animPending?.() ?? 0;
  return !session.busy && anim === 0;
}

// ---------------------------------------------------------------- acting

function toPage(x: number, y: number): PagePoint {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  const d = w.__desktop ?? { gameX: 0, gameY: 0 };
  return {
    x: box.left + (d.gameX + x + 0.5) * (box.width / canvas.width),
    y: box.top + (d.gameY + y + 0.5) * (box.height / canvas.height),
  };
}

/** A point given in game pixels (the 605×430 screen), as the server's mouse wants it. */
export function gamePoint(x: number, y: number): PagePoint {
  return toPage(x, y);
}

/** The middle of a map square, if it's in the 9×9 view. */
export function tilePoint(x: number, y: number): PagePoint | string {
  const session = w.__session;
  if (!session) return 'no game running';
  const q = x - session.center.x + TER_VIEW_CENTER;
  const row = y - session.center.y + TER_VIEW_CENTER;
  if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) {
    return `(${x},${y}) is not in the view, which is centred on (${session.center.x},${session.center.y}) `
      + `and reaches ${TER_VIEW_CENTER} squares each way`;
  }
  const pos = terrainSpotPos(q, row);
  return toPage(pos.x + 14, pos.y + 18);
}

/** The button of an inventory row, scrolling the pack so the slot shows. */
export function itemButtonPoint(slot: number, button: 'use' | 'give' | 'drop' | 'info' | 'name'): PagePoint | string {
  const screen = w.__screen;
  if (!screen) return 'no game running';
  const win = screen.itemWindow;
  const index = slot - 1;
  if (index < 0 || index >= 24) return 'slots are 1-24';
  if (index < win.scroll || index >= win.scroll + LINES_IN_ITEM_WIN) {
    win.scroll = Math.max(0, Math.min(win.scrollMax, index - LINES_IN_ITEM_WIN + 1));
    screen.itemSbar.setPosition(win.scroll);
  }
  const row = ITEM_ROWS[index - win.scroll];
  if (!row) return 'that slot is not showing';
  const r = row[button];
  const panel = WIN_RECTS.inven;
  return toPage(panel.left + (r.left + r.right) / 2, panel.top + (r.top + r.bottom) / 2);
}

/** A shop row's name, to click instead of pressing its letter. */
export function shopRowPoint(row: number): PagePoint | string {
  const shop = w.__session?.shop;
  if (!shop) return 'not in a shop';
  const r = shopRowRects(row, shop.maxScroll > 0).name;
  return toPage((r.left + r.right) / 2, (r.top + r.bottom) / 2);
}

/** Press a toolbar button by name (MAGE, LOOK, TALK, …). */
export function toolbar(name: string): string {
  const host = w.__touchHost;
  const mode = host?.mode();
  if (!host || !mode) return 'The toolbar is not available right now (a dialog, a shop or a conversation is up).';
  const which = ToolbarButton[name.toUpperCase() as keyof typeof ToolbarButton];
  if (which === undefined || !host.buttons(mode).includes(which)) {
    return `No ${name} button here; the toolbar has ${host.buttons(mode).map((b) => ToolbarButton[b]).join(' ')}`;
  }
  host.press(which);
  return 'ok';
}

/** Answer the dialog, conversation or spell picker on top with a choice's name. */
export function choose(name: string): string {
  const host = w.__touchHost;
  if (!host) return 'no game running';
  const cast = host.spells.dialog();
  if (cast) {
    const answer = cast.pressControl(name);
    host.spells.answer(cast, answer);
    return 'ok';
  }
  const view = host.dialog.view();
  if (!view) return 'Nothing to choose from right now.';
  const all = [...view.right, ...(view.left ?? [])];
  const choice = all.find((c) => c.name === name) ?? all.find((c) => c.label.toLowerCase() === name.toLowerCase());
  if (!choice) return `No choice "${name}". The choices are: ${all.map((c) => c.name).join(', ')}`;
  if (choice.disabled) return `"${choice.label}" is unavailable.`;
  host.dialog.press(choice.name);
  return 'ok';
}

/** Type into the dialog's text field, then press Enter if asked. */
export function typeText(text: string, enter: boolean): string {
  const host = w.__touchHost;
  const field = host?.dialog.view()?.field;
  if (!host || !field) return 'There is no text field up.';
  host.dialog.type(field.name, text);
  if (enter) host.dialog.enter();
  return 'ok';
}

// ---------------------------------------------------------------- main menu

/**
 * The main menu, cut down to what the AI player needs: carry on with a saved
 * game, start an official scenario, or make a party. (The menu also lists the
 * whole scenario library — hundreds of cards — which would drown the rest.)
 */
function menuButtons(): { label: string; el: HTMLElement }[] {
  const root = document.getElementById('startup-host');
  if (!root) return [];
  const words = (el: Element | null): string => ((el as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const out: { label: string; el: HTMLElement }[] = [];
  for (const card of root.querySelectorAll<HTMLElement>('.startup-save')) {
    out.push({ label: `Continue: ${words(card.querySelector('.startup-words'))}`, el: card });
  }
  for (const card of root.querySelectorAll<HTMLElement>('button.startup-card:not(.startup-save-import)')) {
    const text = words(card);
    if (text.startsWith('Official ')) out.push({ label: `New game: ${text.slice('Official '.length)}`, el: card });
  }
  const party = root.querySelector<HTMLElement>('.startup-party-button');
  if (party) out.push({ label: words(party), el: party });
  return out.filter((b) => b.el.offsetParent !== null);
}

export function menu(index: number): string {
  const b = menuButtons()[index];
  if (!b) return 'No such menu button.';
  b.el.click();
  return `pressed: ${b.label}`;
}

/** The game screen as a PNG data URL. */
export function screenshot(): string {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  return canvas.toDataURL('image/png');
}

Object.assign(window, {
  __aiBridge: {
    observe, settled, linesSince, inCombat, gamePoint, tilePoint, itemButtonPoint, shopRowPoint, toolbar, choose, typeText, menu, screenshot,
  },
});
