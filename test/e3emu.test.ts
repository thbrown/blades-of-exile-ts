/**
 * Exile III's own code against the converted scripts.
 *
 * The scripts in `tools/e3convert/towns/` were copied out of EXILE3.EXE's
 * disassembly by hand. Here the EXE itself runs the same step, in an x86
 * emulator (`tools/e3convert/emu/`), from the same saved game, with the same
 * buttons pressed, and the port is given E3's own dice. Then the two are
 * compared: what the player was shown, the `get_ran` calls asked (bounds and
 * order are part of the spec), and every byte of the party record and the PCs
 * that either side changed, read back through `exportE3Save`.
 *
 * Needs the E3 files (`findE3Dir`) and a Python with `unicorn` and
 * `capstone`: `E3EMU_PYTHON`, else `tools/e3convert/emu/.venv` if there is
 * one (its README says how to make it), else `python3`. It skips without them.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import { E3ITEM, E3P, E3PC, E3_PARTY_SIZE, E3_PC_SIZE, readE3Save } from '../src/fileio/e3save';
import { e3SaveDefaultsFromJson, type E3SaveDefaults } from '../src/fileio/e3SaveDefaults';
import { exportE3Save } from '../src/fileio/e3SaveExport';
import { applyE3Save, applyE3TownCreatures, applyE3TownDecals, applyE3TownItems, applyE3TownTerrain } from '../src/fileio/e3SaveImport';
import type { Location } from '../src/core/location';
import type { Player } from '../src/universe/player';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir } from '../tools/e3convert/install';
import { QuestRunner, loadExile3 } from './support/e3Quest';

const dir = findE3Dir();
const VENV_PY = new URL('../tools/e3convert/emu/.venv/bin/python', import.meta.url).pathname;
const PY = process.env.E3EMU_PYTHON ?? (existsSync(VENV_PY) ? VENV_PY : 'python3');
const hasEmu = !!dir && spawnSync(PY, ['-c', 'import unicorn, capstone']).status === 0;
const SPOT_PY = new URL('../tools/e3convert/emu/spot.py', import.meta.url).pathname;

export interface SpotCase {
  save: string;
  /** An outdoor spot: its zone, and (x, y) in it. */
  zone?: number;
  /**
   * Or a town step: the town an in-town `save` is in, the square the party
   * steps from (put back on it before each visit), and (x, y) the square
   * stepped onto, by E3's whole town move (`FUN_1010_8001`).
   */
  town?: number;
  from?: [number, number];
  x: number;
  y: number;
  /** Buttons by index, or every dialog's first or last. */
  answers: number[] | 'first' | 'last';
  /** How many times the step is taken (default 1); the second shows what the first left. */
  visits?: number;
  /** Every roll its least or its most, on both sides. */
  dice: 'low' | 'high';
}

interface E3Event { kind: 'dialog' | 'msg' | 'line' | 'visit'; id?: number | number[]; text?: string | (string | null)[]; button?: number; title?: string }
interface E3Result {
  events: E3Event[];
  draws: [number, number, number, number][];
  moved: number | null;
  /** A town case: where the party stands after the last visit, `[town, x, y]`. */
  at: [number, number, number] | null;
  error: string | null;
  answersLeft: number;
  before: { party: string; pcs: string };
  after: { party: string; pcs: string };
}

/** `spot.py` on `cases`, asynchronously: a long batch must not block vitest's worker. */
function runE3(cases: SpotCase[], dialogButtons: Record<number, number>): Promise<E3Result[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [SPOT_PY]);
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`spot.py exited ${code}: ${err}`));
      else resolve(JSON.parse(Buffer.concat(out).toString('utf8')) as E3Result[]);
    });
    child.stdin.end(JSON.stringify({ dialogButtons, cases }));
  });
}

/**
 * E3 copies a whole 63-byte table record into a pack, junk after each name's
 * NUL included, where the port writes a clean string. Zero what follows the
 * NUL in each item's two names (and each PC's own), so only the names compare.
 */
function clearNameTails(pcs: Uint8Array): Uint8Array {
  const out = pcs.slice();
  const clear = (at: number, len: number) => {
    const nul = out.subarray(at, at + len).indexOf(0);
    if (nul >= 0) out.fill(0, at + nul, at + len);
  };
  for (let pc = 0; pc < 6; pc++) {
    const base = pc * E3_PC_SIZE;
    clear(base + E3PC.NAME, E3PC.NAME_LEN);
    for (let i = 0; i < 24; i++) {
      const it = base + E3PC.ITEMS + i * E3ITEM.SIZE;
      clear(it + E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN);
      clear(it + E3ITEM.NAME, E3ITEM.NAME_LEN);
    }
  }
  return out;
}

/**
 * Differences already understood, and why: kept out of `diffs` so that a sweep
 * shows what is new. Each is a finding in PROGRESS.md ("EXILE3.EXE run as an
 * oracle"); take an entry out when its cause is fixed.
 */
const KNOWN: [RegExp, string][] = [
  [/^party OUT_C/, 'an encounter group is placed by the party, not on E3\'s marker spot (script.ts, onceEncounter), and exported as its zone\'s first group'],
  [/^party DIRECTION/, 'a refused town step turns the party in the port (OBoE sets `direction` before its blocked test); 1997 and E3 turn it only on a step that goes through'],
];

/** How long one case may take on the port's side before it's reported and skipped. */
const PORT_CASE_MS = 20_000;

const GONE = 'a PC slain "gone" keeps its spells in E3; the export writes an absent slot\'s new-PC spells';
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Party-record bytes neither side's play decides: E3's help tips, which the port doesn't keep. */
const IGNORED: [number, number, string][] = [
  [E3P.HELP_RECEIVED, E3P.HELP_RECEIVED + 120, 'help tips'],
];

/**
 * A PC's `weap_poisoned`, the slot last poisoned, means nothing while no
 * weapon is (status 0 is 0). E3's `sort_pc_items` moves it along with the item
 * in that slot regardless (1997's ITEMS.CPP:99), and the port, which keeps the
 * weapon itself, writes 0; so it's compared only while a weapon is poisoned.
 */
function ignorePoisonSlot(e3After: Uint8Array): (o: number) => boolean {
  return (o) => {
    const pc = Math.floor(o / E3_PC_SIZE), f = o % E3_PC_SIZE;
    if (f !== E3PC.WEAP_POISONED && f !== E3PC.WEAP_POISONED + 1) return false;
    const st = pc * E3_PC_SIZE + E3PC.STATUS;
    return e3After[st] === 0 && e3After[st + 1] === 0;
  };
}

/** A name for party byte `o`, for a report a person reads. */
export function partyByteName(o: number): string {
  if (o >= E3P.FLAGS && o < E3P.FLAGS + E3P.FLAG_ROWS * 10) {
    const f = o - E3P.FLAGS;
    return `flag(${Math.floor(f / 10)},${f % 10}) [0x${o.toString(16)}]`;
  }
  if (o >= E3P.SPEC_ITEMS && o < E3P.FLAGS) return `special item ${(o - E3P.SPEC_ITEMS) >> 1}`;
  let best: [string, number] = ['?', 0];
  for (const [k, v] of Object.entries(E3P)) if (typeof v === 'number' && v <= o && v >= best[1] && !k.endsWith('SIZE') && !k.endsWith('ROWS') && !k.endsWith('TOWNS') && k !== 'KEY_TIME_NEVER') best = [k, v];
  return `${best[0]}+${o - best[1]} [0x${o.toString(16)}]`;
}

export function pcByteName(o: number): string {
  const pc = Math.floor(o / E3_PC_SIZE), f = o % E3_PC_SIZE;
  if (f >= E3PC.SKILLS && f < E3PC.SKILLS + 60) return `pc${pc} skill ${(f - E3PC.SKILLS) >> 1}`;
  let best: [string, number] = ['?', 0];
  for (const [k, v] of Object.entries(E3PC)) if (typeof v === 'number' && v <= f && v >= best[1] && !k.endsWith('_LEN')) best = [k, v];
  return `pc${pc} ${best[0]}+${f - best[1]} [+0x${f.toString(16)}]`;
}

export interface Comparison {
  /** Things that differ: the findings. */
  diffs: string[];
  /** Differences of a kind already understood (`KNOWN`), with the reason. */
  known: string[];
  /** The `get_ran` calls, when they differ: by design, often, as the engines roll differently. */
  dice: string[];
  /** E3 changed it and the port has no field for it: worth knowing, not a mismatch. */
  unmodeled: string[];
}

/**
 * Bytes either side changed. A byte only E3 changed counts against the port if
 * the port's export reproduces its value before the step (so the port does
 * keep it); otherwise it's listed as unmodeled.
 */
function compareBytes(
  label: string, name: (o: number) => string,
  e3Before: Uint8Array, e3After: Uint8Array, pBefore: Uint8Array, pAfter: Uint8Array,
  ignore: (o: number) => boolean, out: Comparison,
): void {
  for (let o = 0; o < e3Before.length; o++) {
    if (ignore(o)) continue;
    const e3Changed = e3Before[o] !== e3After[o], pChanged = pBefore[o] !== pAfter[o];
    if (!e3Changed && !pChanged) continue;
    const what = `${label} ${name(o)}: E3 ${e3Before[o]}→${e3After[o]}, port ${pBefore[o]}→${pAfter[o]}`;
    if (e3Changed && !pChanged && pBefore[o] !== e3Before[o]) out.unmodeled.push(what);
    else if (e3After[o] !== pAfter[o]) out.diffs.push(what);
  }
}

describe.skipIf(!hasEmu)("Exile III's own code against the converted scripts", () => {
  const out = mkdtempSync(join(tmpdir(), 'e3emu-'));
  let scen: Scenario;
  let defaults: E3SaveDefaults;
  let debug: { dialogPages: Record<number, number>; dialogButtons: Record<number, number> };

  beforeAll(async () => {
    emitScenario(dir as string, out);
    scen = await loadExile3(out);
    defaults = e3SaveDefaultsFromJson(readFileSync(join(out, 'e3save.json'), 'utf8'));
    debug = JSON.parse(readFileSync(join(out, 'debug.json'), 'utf8')) as typeof debug;
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  interface PortResult {
    q: QuestRunner; asked: string[]; moved: boolean | null; at: [number, number, number] | null; before: Uint8Array[]; after: Uint8Array[];
    /** `exportE3Save`'s, after the step, and each PC's items by name: for reading a case in full. */
    warnings: string[]; pack: string[][];
    /** The lines the step put in the text area, as E3's `FUN_10d0_4c8d` lines. */
    lines: string[];
  }

  async function runPort(c: SpotCase, answers: number[]): Promise<PortResult> {
    const q = new QuestRunner(scen);
    const res = applyE3Save(new Uint8Array(readFileSync(c.save)), q.univ, defaults);
    // As File > Open does (`loadE3Save` in main.ts): the mode is the save's,
    // and an in-town save brings its town back as it was.
    q.session.resumeLoadedGame();
    if (res.town) {
      q.session.resumeInSavedTown(res.town.num, res.town.loc);
      applyE3TownDecals(q.univ, res.town.decals);
      applyE3TownTerrain(q.univ, res.town.data);
      applyE3TownCreatures(q.univ, res.town.cTown);
      applyE3TownItems(q.univ, res.town.items, defaults);
    }
    await q.settle();
    if (c.town !== undefined) {
      if (!q.session.inTown || q.townNum !== c.town) throw new Error(`${c.save} isn't saved in town ${c.town}`);
    } else {
      // An outdoor spot needs an outdoor party: in town mode the engine refuses
      // every outdoor node (`outdoorSpec`), which hides half of what a spot does.
      if (!q.session.isOutdoors) throw new Error(`${c.save} is saved in town: use an outdoor save`);
      const zx = c.zone! % 9, zy = Math.floor(c.zone! / 9);
      q.session.positionParty(zx, zy, c.x, c.y);
      await q.settle();
    }
    const exported = () => {
      const s = readE3Save(exportE3Save(q.univ, defaults).bytes);
      const pcs = new Uint8Array(E3_PC_SIZE * 6);
      s.pcs.forEach((p, i) => pcs.set(p, i * E3_PC_SIZE));
      return [s.party.slice(0, E3_PARTY_SIZE), pcs];
    };
    const before = exported();
    // The same extreme dice as E3's side. The port's engine rolls its own way
    // (a BoE `if-rand` is `get_ran(1,1,100) < n` where E3 flips
    // `get_ran(1,0,1)`), so the calls themselves are only noted.
    const rng = q.univ.rng;
    const real = rng.getRan.bind(rng);
    const asked: string[] = [];
    rng.getRan = (times: number, min: number, max: number, useUnique = false) => {
      if (useUnique) return real(times, min, max, true);
      asked.push(`${times},${min},${max}`);
      return times * (c.dice === 'low' ? min : max);
    };
    q.log.length = 0;
    const linesBefore = q.univ.transcriptAdded;
    // E3's buttons, then the first button for any dialog E3 didn't show.
    q.answer(...answers, ...Array<number>(40).fill(0));
    const where = { ...q.party.outLoc };
    let moved: boolean | null = null;
    let at: [number, number, number] | null = null;
    try {
      // `check_special_terrain`, E3's `FUN_10c0_0c97`: the square's special
      // and its terrain's effects together. In town, the whole of
      // `town_move_party`, as E3's `FUN_1010_8001` is: no turn passes after.
      const session = q.session as unknown as {
        checkSpecialTerrain(where: Location, who: Player): Promise<{ canEnter: boolean }>;
        townMoveParty(destination: Location): Promise<boolean>;
      };
      for (let v = 0; v < (c.visits ?? 1); v++) {
        if (v) q.log.push('[visit]');
        if (c.town !== undefined) {
          q.place({ x: c.from![0], y: c.from![1] });
          moved = await session.townMoveParty({ x: c.x, y: c.y });
          await q.settle();
          // Stairs or a way out end the case in the other town, as E3's side does.
          at = q.session.inTown ? [q.townNum, q.party.townLoc.x, q.party.townLoc.y] : null;
          if (!q.session.inTown || q.townNum !== c.town) break;
          // Split, as E3's side stops: no second visit for the lone PC.
          if (q.party.isSplit()) break;
        } else {
          moved = (await session.checkSpecialTerrain(where, q.party.pcs[0]!)).canEnter;
        }
        await q.settle();
      }
    } finally {
      rng.getRan = real;
    }
    const warnings = exportE3Save(q.univ, defaults).warnings;
    const pack = q.party.pcs.map((pc) => pc.items.filter((it) => it && it.variety !== 0).map((it) => it.fullName ?? it.name));
    pack.push([`outdoors ${q.session.isOutdoors}, mode ${q.session.mode}, town ${q.univ.town?.record.name ?? "-"}, gold ${q.party.gold}, outLoc ${JSON.stringify(q.party.outLoc)}, sector ${JSON.stringify(q.party.sector)}`]);
    const lines = q.univ.transcript.slice(q.univ.transcript.length - (q.univ.transcriptAdded - linesBefore)).map((l) => l.trim());
    return { q, asked, moved, at, before, after: exported(), warnings, pack, lines };
  }

  /** How many of the engine's dialogs E3's dialog `id` is shown as (`e3DialogPageTexts`). */
  const pages = (id: number) => debug.dialogPages[id] ?? 1;

  /** The buttons the port presses for E3's: an OK for each lead page, then E3's. */
  function portAnswers(e3: E3Result): number[] {
    return e3.events.flatMap((ev) => (ev.kind === 'dialog'
      ? [...Array<number>(pages(ev.id as number) - 1).fill(0), ev.button!] : []));
  }

  /** E3's events as the port's log writes them, a long dialog as its pages. */
  function e3Log(e3: E3Result): string[] {
    return e3.events.flatMap((ev) => {
      // E3's "Instant help" tips, which the port doesn't have (`IGNORED`).
      if (ev.kind === 'msg' && ev.title?.startsWith('Instant help')) return [];
      // A message slot of 0 is an empty string, which the box doesn't show.
      if (ev.kind === 'msg' && !(ev.text as (string | null)[]).some(Boolean)) return [];
      // E3's strings write a double quote as `_`, and often end in a space;
      // the converter turns the one back and trims the other.
      if (ev.kind === 'msg') return [`[msg] ${(ev.text as (string | null)[]).filter(Boolean).map((t) => t!.trim()).join(' | ').replaceAll('_', '"')}`];
      if (ev.kind === 'visit') return ['[visit]'];
      if (ev.kind === 'dialog') {
        return [...Array<string>(pages(ev.id as number) - 1).fill(`[choice] dialog ${ev.id as number} (lead page) -> button 0`),
          `[choice] dialog ${ev.id as number} -> button ${ev.button}`];
      }
      return [];
    });
  }

  /** The port's log in the same terms: a choice by its button's index. */
  function portLog(q: QuestRunner): string[] {
    return q.log.flatMap((l) => {
      if (l.startsWith('[msg]') || l === '[visit]') return [l];
      const m = /^\[choice\] .* \[(.*)\] -> (.*)$/.exec(l);
      if (m) return [`[choice] -> button ${m[1]!.split('/').indexOf(m[2]!)}`];
      return [];
    });
  }

  type Compared = Comparison & { case: SpotCase; e3: string[]; port: string[]; error?: string; portLog?: string[]; e3Events?: E3Event[] };

  /**
   * E3 first, all in one batch (`first`/`last` by each dialog's own count of
   * buttons); then the port, pressing the buttons E3 pressed.
   */
  async function compareAll(cases: SpotCase[]): Promise<Compared[]> {
    const e3s = await runE3(cases, debug.dialogButtons);
    const ports: (PortResult | string)[] = [];
    for (const [i, c] of cases.entries()) {
      // A step that never settles (a fight waiting on a player) is a finding
      // too, not a reason to stop the sweep.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no end after ${PORT_CASE_MS / 1000} s`)), PORT_CASE_MS);
      });
      try { ports.push(await Promise.race([runPort(c, portAnswers(e3s[i]!)), limit])); } catch (err) { ports.push(`port: ${(err as Error).message.split('\n')[0]}`); } finally { clearTimeout(timer); }
      if (cases.length > 50 && (i + 1) % 100 === 0) console.log(`port: ${i + 1}/${cases.length}`);
      await new Promise((r) => setImmediate(r));   // let vitest's worker talk
    }
    return cases.map((c, i) => {
      const port = ports[i]!, e3 = e3s[i]!;
      const res: Compared = { case: c, diffs: [], known: [], dice: [], unmodeled: [], e3: e3Log(e3), port: [] };
      if (typeof port === 'string') return { ...res, error: port };
      if (e3.error) return { ...res, error: `E3: ${e3.error}` };
      res.port = portLog(port.q);
      res.portLog = [...port.q.log, ...port.warnings.map((w) => `[export] ${w}`), ...port.pack.map((p, i) => `[pc${i}] ${p.join(', ')}`)];
      res.e3Events = e3.events;
      const e3Asked = e3.draws.map((d) => `${d[0]},${d[1]},${d[2]}`);
      if (e3Asked.join(' ') !== port.asked.join(' '))
        res.dice.push(`E3 get_ran(${e3Asked.join(') (')}), port get_ran(${port.asked.join(') (')})`);
      // Messages and choices, in order; a dialog is matched by its place and button.
      const a = res.e3.map((l) => l.replace(/dialog \d+ (\(lead page\) )?/, '')), b = res.port;
      for (let k = 0; k < Math.max(a.length, b.length); k++) {
        if (a[k] !== b[k]) {
          res.diffs.push(`shown #${k}: E3 ${a[k] ?? '(nothing)'}\n            port ${b[k] ?? '(nothing)'}`);
          break;
        }
      }
      // The text area's lines, on their own: the two engines interleave them
      // with dialogs differently, but each line should be there.
      const e3Lines = e3.events.filter((ev) => ev.kind === 'line').map((ev) => (ev.text as string).trim()).filter(Boolean);
      // Moves on the world map: the two keep the 2×2 window at different
      // corners, so the window's bytes only compare as a move.
      const world = (p: Uint8Array) => [p[E3P.OUTDOOR_CORNER]! * 48 + p[E3P.P_LOC]!, p[E3P.OUTDOOR_CORNER + 1]! * 48 + p[E3P.P_LOC + 1]!];
      const [e3b, e3a, pb, pa] = [b64(e3.before.party), b64(e3.after.party), port.before[0]!, port.after[0]!].map(world);
      const e3Move = [e3a![0]! - e3b![0]!, e3a![1]! - e3b![1]!], pMove = [pa![0]! - pb![0]!, pa![1]! - pb![1]!];
      if (e3Move.join() !== pMove.join()) res.diffs.push(`the party moves: E3 by (${e3Move.join(',')}), port by (${pMove.join(',')})`);
      let portLines = port.lines.filter(Boolean);
      const drop = (re: RegExp, why: string) => {
        const kept = portLines.filter((l) => !re.test(l));
        if (kept.length !== portLines.length) res.known.push(why);
        portLines = kept;
      };
      // Lava outdoors is E3's move (`outd_move_party`), not this check; the port's step does both.
      const lava = portLines.includes('LAVA!') && !e3Lines.includes('LAVA!');
      if (lava) drop(/^LAVA!$| takes \d+\.$/, 'lava: outdoors E3 burns in its move function, which this check doesn\'t run');
      // BoE's town move says "Moved: north" (boe.actions.cpp); EXILE3.EXE has
      // no such string (its only "Moved:" lines are landing and fleeing), so
      // E3 walks in silence. A divergence a player sees, not yet decided.
      if (c.town !== undefined) drop(/^Moved: (North|South|East|West)/i, 'E3 prints no "Moved: <direction>" line on a step: EXILE3.EXE has no such string');
      // Two lines 1997 and E3 word alike and the port as OBoE does: the
      // direction capitalised ("Blocked: North"), and a town's name under
      // "Now entering:" where the port says "You enter Lorelei.". Not yet decided.
      const reworded = (from: string[], to: string[]) => {
        if (from.join('\n') !== to.join('\n')) res.known.push('wording: OBoE\'s "Blocked: north" and "You enter <town>.", where 1997 and E3 say "Blocked: North" and "Now entering:" / <town>');
        return to;
      };
      portLines = reworded(portLines, portLines.flatMap((l) => {
        const m = /^You enter (.*)\.$/.exec(l);
        return m ? ['Now entering:', m[1]!] : [l.replace(/^Blocked: (\w)/, (_, ch: string) => `Blocked: ${ch.toUpperCase()}`)
          .replace(/^(Blocked: \w+)(east|west)$/, (_, a: string, b: string) => a + b[0]!.toUpperCase() + b.slice(1))];
      }));
      if (e3Lines.join('\n') !== portLines.join('\n'))
        res.diffs.push(`lines: E3 ${JSON.stringify(e3Lines)}, port ${JSON.stringify(portLines)}`);
      const e3Moved = e3.moved !== 0;
      if (c.town !== undefined) {
        // Where the party ends up is the step's whole answer: an invisible
        // wall, or a hole in a real one, shows here.
        if (JSON.stringify(e3.at) !== JSON.stringify(port.at))
          res.diffs.push(`the party ends at: E3 ${JSON.stringify(e3.at)}, port ${JSON.stringify(port.at)}`);
      } else if (port.moved !== null && port.moved !== e3Moved)
        res.diffs.push(`the step: E3 ${e3Moved ? 'goes through' : 'is blocked'}, port ${port.moved ? 'goes through' : 'is blocked'}`);
      const ignoreParty = (o: number) => IGNORED.some(([lo, hi]) => o >= lo && o < hi)
        || (o >= E3P.OUTDOOR_CORNER && o < E3P.LOC_IN_SEC + 2);
      compareBytes('party', partyByteName, b64(e3.before.party), b64(e3.after.party), port.before[0]!, port.after[0]!, ignoreParty, res);
      // A PC slain "gone" (main status 0, `slay_party(0)`) keeps its record in
      // E3; the export writes an absent slot's new-PC spells (`e3SaveExport.ts`),
      // which only a save made after the whole party is gone would show.
      const e3PcsAfter = b64(e3.after.pcs);
      const goneSpells = (o: number) => {
        const pc = Math.floor(o / E3_PC_SIZE), f = o % E3_PC_SIZE;
        if (f < E3PC.PRIEST_SPELLS || f >= E3PC.MAGE_SPELLS + 62) return false;
        const st = pc * E3_PC_SIZE + E3PC.MAIN_STATUS;
        const gone = e3PcsAfter[st] === 0 && e3PcsAfter[st + 1] === 0 && b64(e3.before.pcs)[st] !== 0;
        if (gone && !res.known.includes(GONE)) res.known.push(GONE);
        return gone;
      };
      compareBytes('pcs', pcByteName, clearNameTails(b64(e3.before.pcs)), clearNameTails(b64(e3.after.pcs)),
        clearNameTails(port.before[1]!), clearNameTails(port.after[1]!), (o) => ignorePoisonSlot(b64(e3.after.pcs))(o) || goneSpells(o), res);
      if (lava) {
        for (const d of res.diffs.filter((d) => /CUR_HEALTH|TOTAL_DAM_TAKEN|MAIN_STATUS/.test(d))) res.diffs.splice(res.diffs.indexOf(d), 1);
      }
      for (const d of [...res.diffs]) {
        const k = KNOWN.find(([re]) => re.test(d));
        if (k) {
          res.diffs.splice(res.diffs.indexOf(d), 1);
          if (!res.known.includes(k[1])) res.known.push(k[1]);
        }
      }
      return res;
    });
  }

  async function compare(c: SpotCase): Promise<Compared> {
    const [r] = await compareAll([c]);
    if (r!.error) throw new Error(r!.error);
    return r!;
  }

  /** An outdoor save (the party at the Remote Aerie, level 25, every spell): `check-saves/README.TXT`. */
  const Q12 = () => join(dir as string, 'check-saves', 'Q12.SAV');

  it.each([
    { label: 'walks on', answers: [0] },
    { label: 'goes in, and declines the lessons', answers: [1, 0] },
    { label: 'goes in, and pays for the lessons', answers: [1, 1] },
  ].flatMap((t) => (['low', 'high'] as const).map((dice) => ({ ...t, dice }))))(
    "Vilovsky's temple (zone 5, spot 1): $label, dice $dice", async ({ answers, dice }) => {
    const r = await compare({ save: Q12(), zone: 5, x: 14, y: 37, answers, dice });
    expect(r.diffs, [...r.diffs, 'E3:', ...r.e3, 'port:', ...r.port].join('\n')).toEqual([]);
  }, 60000);

  /**
   * Spots the sweep found different, fixed since (PROGRESS.md, "EXILE3.EXE run
   * as an oracle"), each taken twice: what the first visit leaves shows on the
   * second.
   */
  it.each([
    { label: 'zone 0, the ember flowers left: the swamp denizens still come', zone: 0, x: 16, y: 17, answers: 'first' as const },
    { label: 'zone 27, the campsite left: the bandits still come', zone: 27, x: 15, y: 6, answers: 'first' as const },
    { label: 'zone 42, the cairns\' loot, once under slot 8', zone: 42, x: 21, y: 33, answers: 'last' as const },
    { label: 'zone 65, forty bars by weight', zone: 65, x: 10, y: 11, answers: 'last' as const },
    { label: 'zone 32, ore that stacks: "(items combined)"', zone: 32, x: 28, y: 19, answers: 'last' as const },
    { label: 'zone 32, 1500 gold and herbs, the gold without a word', zone: 32, x: 22, y: 7, answers: 'last' as const },
    { label: 'zone 67, ore given silently, combined aloud', zone: 67, x: 26, y: 16, answers: 'last' as const },
    { label: 'zone 48, 400 gold without a word', zone: 48, x: 18, y: 45, answers: 'last' as const },
  ])('$label', async ({ zone, x, y, answers }) => {
    const r = await compare({ save: Q12(), zone, x, y, answers, dice: 'low', visits: 2 });
    expect(r.diffs, [...r.diffs, 'E3:', ...r.e3, 'port:', ...r.port].join('\n')).toEqual([]);
  }, 60000);

  /**
   * An in-town save of `town`, made here as `test/e3checkSaves.test.ts` makes
   * its own: Q12's party walked in (the entry scripts run) and exported whole.
   * Returns its path and the runner it was made from, standing where E3 will.
   */
  const townSaves = new Map<number, string>();
  async function townSave(town: number): Promise<{ save: string; q: QuestRunner }> {
    const q = new QuestRunner(scen);
    applyE3Save(new Uint8Array(readFileSync(Q12())), q.univ, defaults);
    q.session.resumeLoadedGame();
    await q.settle();
    await q.enter(town);
    let save = townSaves.get(town);
    if (!save) {
      // `E3EMU_SAVES_DIR` keeps them, to run E3 on by hand (`tools/e3convert/emu/`).
      save = join(process.env.E3EMU_SAVES_DIR ?? out, `T${town}.SAV`);
      writeFileSync(save, exportE3Save(q.univ, defaults).bytes);
      townSaves.set(town, save);
    }
    return { save, q };
  }

  /**
   * Squares to step onto `(x, y)` from in the port's town: open, on the map,
   * with no creature and no spot of their own (so only the step's square
   * runs). The first is the one a case uses.
   */
  function stepFrom(q: QuestRunner, x: number, y: number): [number, number] | null {
    const spots = new Set(q.town.record.specialLocs.map((l) => `${l.x},${l.y}`));
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const p = { x: x + dx, y: y + dy };
      if (!q.town.isOnMap(p.x, p.y) || q.session.townIsBlocked(p) || q.town.monsterAt(p) !== null || spots.has(`${p.x},${p.y}`)) continue;
      return [p.x, p.y];
    }
    return null;
  }

  /** One town step, everything printed: `E3EMU_TOWN_CASE=town,x,y,answers,dice[,visits]` (answers `first`, `last` or `1/0/2`). */
  it.skipIf(!process.env.E3EMU_TOWN_CASE)('one town case, in full', async () => {
    const [t, x, y, a, d, v] = process.env.E3EMU_TOWN_CASE!.split(',');
    const answers = a === 'first' || a === 'last' ? a : (a ?? '0').split('/').map(Number);
    const { save, q } = await townSave(+t!);
    const from = stepFrom(q, +x!, +y!);
    if (!from) throw new Error(`nowhere to step onto (${x},${y}) from`);
    const [r] = await compareAll([{ save, town: +t!, from, x: +x!, y: +y!, answers, dice: (d ?? 'low') as 'low' | 'high', visits: +(v ?? 2) }]);
    console.log(JSON.stringify(r, null, 1));
  }, 120000);

  /**
   * Every town spot of every town (or `E3EMU_TOWNS`, comma-separated): the
   * party walked into the town from Q12, saved there, and stepped onto each
   * spot from an open square beside it by E3's whole town move and the
   * port's, with every dialog's first button and then its last, under low
   * and high dice. Where the party ends up is compared, so an invisible wall
   * (or a hole in a real one) shows. `E3EMU_TOWN_SWEEP=1`; the report goes to
   * `E3EMU_REPORT` (default `e3emu-town-report.json` in the temp dir).
   */
  it.skipIf(!process.env.E3EMU_TOWN_SWEEP)('sweep: every town spot', async () => {
    const only = process.env.E3EMU_TOWNS?.split(',').map(Number);
    const spots = (JSON.parse(readFileSync(join(out, 'debug.json'), 'utf8')) as { towns: Record<string, { id: number; x: number; y: number }[]> }).towns;
    const cases: SpotCase[] = [];
    const unreachable: string[] = [];
    for (let t = 0; t < scen.towns.length; t++) {
      if (only && !only.includes(t)) continue;
      const squares = [...new Map((spots[t] ?? []).map((s) => [`${s.x},${s.y}`, s])).values()];
      if (!squares.length) continue;
      const { save, q } = await townSave(t);
      for (const s of squares) {
        const from = stepFrom(q, s.x, s.y);
        if (!from) { unreachable.push(`town ${t} (${s.x},${s.y}) spot ${s.id}`); continue; }
        for (const answers of ['first', 'last'] as const)
          for (const dice of ['low', 'high'] as const) cases.push({ save, town: t, from, x: s.x, y: s.y, answers, dice, visits: 2 });
      }
    }
    const results = await compareAll(cases);
    const report = join(process.env.E3EMU_REPORT ?? join(tmpdir(), 'e3emu-town-report.json'));
    writeFileSync(report, JSON.stringify(results, null, 1));
    const bad = results.filter((r) => r.error || r.diffs.length);
    console.log(`${cases.length} runs: ${results.length - bad.length} agree, ${bad.filter((r) => r.error).length} errors, ${bad.filter((r) => !r.error).length} differ; ${unreachable.length} spots with no open square beside them. Report: ${report}`);
  }, 8 * 3_600_000);

  /** One case, everything printed: `E3EMU_CASE=zone,x,y,answers,dice` (answers `first`, `last` or `1/0/2`). */
  it.skipIf(!process.env.E3EMU_CASE)('one case, in full', async () => {
    const [z, x, y, a, d] = process.env.E3EMU_CASE!.split(',');
    const answers = a === 'first' || a === 'last' ? a : a!.split('/').map(Number);
    const [r] = await compareAll([{
      save: process.env.E3EMU_SAVE ?? Q12(), zone: +z!, x: +x!, y: +y!, answers, dice: (d ?? 'low') as 'low' | 'high', visits: 2,
    }]);
    console.log(JSON.stringify(r, null, 1));
  }, 120000);

  /**
   * Every outdoor spot of every zone, from each of `E3EMU_SAVE` (outdoor
   * saves, comma-separated; default Q12), with
   * every dialog's first button and then its last, under low and high dice.
   * Slow (minutes), so only with `E3EMU_SWEEP=1`; the report goes to
   * `E3EMU_REPORT` (default `e3emu-report.json` in the temp dir).
   */
  it.skipIf(!process.env.E3EMU_SWEEP)('sweep: every outdoor spot', async () => {
    const saves = process.env.E3EMU_SAVE?.split(',') ?? [Q12()];
    const outdoor = readFileSync(join(dir as string, 'OUTDOOR.DAT'));
    const only = process.env.E3EMU_ZONES?.split(',').map(Number);
    const cases: SpotCase[] = [];
    for (let z = 0; z < 90; z++) {
      if (only && !only.includes(z)) continue;
      const o = z * 0xc94;
      for (let k = 0; k < 18; k++) {
        if (!outdoor[o + 2340 + k]) continue;
        const x = outdoor[o + 2304 + 2 * k]!, y = outdoor[o + 2305 + 2 * k]!;
        for (const save of saves)
          for (const answers of ['first', 'last'] as const)
            for (const dice of ['low', 'high'] as const) cases.push({ save, zone: z, x, y, answers, dice, visits: 2 });
      }
    }
    const results = await compareAll(cases);
    const report = join(process.env.E3EMU_REPORT ?? join(tmpdir(), 'e3emu-report.json'));
    writeFileSync(report, JSON.stringify(results, null, 1));
    const bad = results.filter((r) => r.error || r.diffs.length);
    console.log(`${cases.length} runs: ${results.length - bad.length} agree, ${bad.filter((r) => r.error).length} errors, ${bad.filter((r) => !r.error).length} differ. Report: ${report}`);
  }, 4 * 3_600_000);
});
