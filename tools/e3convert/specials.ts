/**
 * Exile 3's scripted spots, as far as they are data. A zone has 18 and a town
 * 40, each a location and an encounter number. Stepping on one runs the
 * encounter: the outdoor handler is `FUN_10a0_0062` and the town one
 * `FUN_10c0_0000`. Both start with the same generic cases before switching
 * to per-zone or per-town code:
 *
 * | number | what it does |
 * |---|---|
 * | 100–199 | shows one string, `block*300 + (n - 100)` |
 * | 200 and up | shows two, `n - 200` and `n - 199` (the town's 255 is an empty slot) |
 * | 50 | walks the party onto the square even if it's blocked: a ford, a secret passage |
 * | 51–59 | nothing |
 * | below 100 | that zone's or town's own code: E3-3 |
 *
 * The string block is `zone / 10 + 80` outdoors. In a town it is
 * `(t - t % 4) / 5 + 52` below town 20, `t / 5 + 52` below 40, and
 * `(t - 40) / 10 + 60` above.
 *
 * A message runs once: the spot is erased afterwards (`FUN_1038_0282`),
 * unless the terrain under it is 209 or more outdoors, or 237 or more in a
 * town. In the engine a one-shot message is `once-disp-msg` with a flag of its
 * own (`spotFlag`).
 *
 * E3 plays sound 57 with each message, as the engine's message box does.
 *
 * E3 never erases a spot while flag (306, 3) is set: the preference "Show
 * room descriptions more than once" (dialog 1099's LED 24; 1997 stores it
 * there too and never reads it). The engine keeps it there as well, under
 * the `room-descriptions` = `exile3` flag (`ROOM_DESCRIPTIONS`).
 */

import { BASIC_BUTTONS } from '../../src/game/specials/oneshot';
import { e3SpotFlag } from './flags';
import { MSG_PIC, SpecBuilder, townSpotFlag, zoneSpotFlag, type Flag, type ScriptSource, type Step } from './script';

export interface E3Spot { loc: { x: number; y: number }; id: number }

/** Flag (306, 3): "Show room descriptions more than once" (party+0xc7b). */
export const ROOM_DESCRIPTIONS: Flag = [306, 3];

export interface SpotScript {
  /** The `.spec` file. */
  spec: string;
  /** The special strings the nodes' `msg` fields index. */
  strings: string[];
  /** Where each spot's node goes on the map. */
  marks: { x: number; y: number; node: number }[];
  /**
   * Every spot E3 has here with its encounter number, and its node, or -1
   * where the place's code is not transcribed yet: for the browser's test
   * panel (`debug.json`, `src/platform/debugPanel.ts`).
   */
  spots: { x: number; y: number; id: number; node: number }[];
  /** The town's entry node (`<onenter condition="alive">`), or -1. */
  entry: number;
  /** The same for a town cleared out (`<onenter condition="dead">`), or -1. */
  entryDead: number;
  /** The node run as the town turns hostile (`<onoffend>`), or -1. */
  hostile: number;
  /** Each creature slot's `<onkill>` node, or -1 (`KillScript`). */
  kills: number[];
  /** Each creature slot's `<ontalk>` node, or -1 (`KillScript`'s shape too). */
  talks: number[];
  /** Each outdoor group's `<onmeet>`, `<onwin>` and `<onflee>` nodes, or -1 (`GroupScript`). */
  groups: GroupNodes[];
  /** The town's `<timer>`s: every `freq` ticks, `node` (`TimerScript`). */
  timers: { freq: number; node: number }[];
}

export interface GroupNodes { meet: number; win: number; flee: number }

/** A place's own encounters, transcribed (`towns/`): steps by encounter number. */
export type PlaceScript = (b: SpecBuilder) => Map<number, Step[]>;

/**
 * A spot the converter adds on a zone's town entrance, setting `flag` to
 * `value` as the party steps onto it. It stands in where E3 tests the party's
 * outdoor position from inside a town (party+0x12e2 on), which no node can
 * read: a tunnel whose far end leads out on the side the party didn't come
 * in by. Outdoor specials run before the town-entrance check
 * (`session.ts`, `outdMoveParty`), so the flag is set by the time the town's
 * scripts can read it.
 *
 * A mark with `steps` runs those instead, and its flag and value go unused.
 */
export interface EntranceMark {
  zone: number;
  loc: { x: number; y: number };
  flag: Flag;
  value: number;
  steps?: (b: SpecBuilder) => Step[];
}

/**
 * The spot ids entrance marks take, one after another in each zone. No E3
 * zone uses them: its ids under 100 go up to 24, and one 72.
 */
export const ENTRANCE_MARK_SPOT = 90;

/** A script with no arguments: what a town does as it turns hostile (`towns/hostile.ts`), or a town's own entry case. */
export type EntryScript = (b: SpecBuilder) => Step[];

/**
 * What a town does as the party enters it (`towns/entry.ts`): `dead` is
 * the engine's "cleared out", which runs a node of its own.
 */
export type TownEntryScript = (b: SpecBuilder, dead: boolean) => Step[];

/**
 * What killing the creature in a slot does. Creatures with the same key
 * share a node; a key of null means no `<onkill>`.
 */
export type KillScript = (b: SpecBuilder, slot: number) => { key: string; steps: Step[] } | null;

/** What talking to the creature in a slot does first (its HAIL special), in the same shape. */
export type TalkScript = KillScript;

/**
 * What meeting, beating and running from each of a zone's outdoor groups
 * does (`towns/encounters.ts`): one entry a group, null where nothing
 * happens. Entries with the same key share nodes.
 */
export type GroupScript = (b: SpecBuilder) => ({ key: string; meet: Step[] | null; win: Step[] | null; flee: Step[] | null })[];

/**
 * What a town does on a clock of its own, every `freq` ticks while the party
 * is there. The scenario's `town-timers` flag makes the engine's town timers
 * repeat, as E3's clock does.
 */
export type TimerScript = (b: SpecBuilder) => { freq: number; steps: Step[] }[];

/** Blocked terrains a town spot still runs on (water, and three walls). */
const WALK_INTO = new Set([71, 101, 118, 133]);
/** E3's water, the one of `WALK_INTO` a boat sails over. */
const WATER = 71;

/**
 * The three walls of `WALK_INTO` are doors: the town move code's terrain
 * table (`10c0:186a`) turns 101 into 102 (`10c0:14df`), 118 into 119 and 133
 * into 134 as the party walks into them. The table is reached only after
 * the square's spots have run and said yes (`10c0:124d`), so a message on a
 * secret door shows and the door still opens. Sixteen town spots sit on one,
 * eleven of them messages, and none of the five scripts says no.
 */
const DOOR_OPENS = new Map([[101, 102], [118, 119], [133, 134]]);

export function e3TownMessageBlock(t: number): number {
  if (t < 20) return Math.floor((t - (t % 4)) / 5) + 52;
  if (t < 40) return Math.floor(t / 5) + 52;
  return Math.floor((t - 40) / 10) + 60;
}

export function e3ZoneMessageBlock(zone: number): number {
  return Math.floor(zone / 10) + 80;
}

/**
 * The generic message spots of a zone (`place` = `{ zone }`) or a town
 * (`{ town }`). `terrainAt` gives the terrain under a spot, which decides
 * whether its message repeats.
 */
export function e3SpotScript(
  spots: E3Spot[], place: { zone: number } | { town: number },
  src: ScriptSource, terrainAt: (x: number, y: number) => number, own?: PlaceScript, onEntry?: TownEntryScript,
  onKill?: KillScript, onGroups?: GroupScript, onHostile?: EntryScript, onTimers?: TimerScript,
  onTalk?: TalkScript,
): SpotScript {
  const isTown = 'town' in place;
  const block = isTown ? e3TownMessageBlock(place.town) : e3ZoneMessageBlock(place.zone);
  const repeatsFrom = isTown ? 237 : 209;
  const spotLoc = (id: number) => spots.find((s) => s.id === id && !(s.loc.x === 0 && s.loc.y === 0))?.loc;
  // A spot's own converter flag, as the generic message spots use: for E3's
  // scripts that erase the spot they ran from (`FUN_1038_0282`).
  const spotFlag = (id: number) => e3SpotFlag(place, spots.findIndex((s) => s.id === id));
  const b = new SpecBuilder({ ...src, spotLoc, spotFlag }, (label) => Math.max(0, BASIC_BUTTONS.indexOf(label)));
  const scripts = own?.(b) ?? new Map<number, Step[]>();
  const compiled = new Map<number, number>();
  const marks: SpotScript['marks'] = [];
  const listed: SpotScript['spots'] = [];
  spots.forEach((s, k) => {
    if (s.loc.x === 0 && s.loc.y === 0) return;
    if (isTown && s.id === 255) return;
    // 50 is a way through. Both move codes force the step when the spot at
    // the destination is 50 — outdoors `1010:71aa`, BoE 1997's `if (spec_num
    // == 50) forced = TRUE` (ACTIONS.CPP:2683); in town `1010:807c`, where
    // the forced flag lets `1010:83a3` past a blocked square — so the party
    // walks onto water, walls and pillars that otherwise stop it. 128 squares
    // in the zones carry it, among them the three water squares between
    // Delan's "FORD HERE" signs (a player confirmed E3 crosses there), and
    // 102 in the towns, mostly cave walls, pillars and water. The engine's
    // way to say "forced" is a CANT_ENTER that allows (ex1a 0) with ex2a
    // set, which also makes a town run it on a blocked square. Until
    // 2026-09-30 this was dropped with the markers, and nothing could be
    // crossed.
    if (s.id === 50) {
      const n = b.node('block-move', { ex1: [0], ex2: [1] }, -1);
      marks.push({ x: s.loc.x, y: s.loc.y, node: n });
      listed.push({ x: s.loc.x, y: s.loc.y, id: s.id, node: n });
      return;
    }
    // The rest of 50–59 are markers, which do nothing when stepped on.
    if (s.id >= 50 && s.id < 60) return;
    let n: number;
    const shut = terrainAt(s.loc.x, s.loc.y);
    const opens = isTown ? DOOR_OPENS.get(shut) : undefined;
    /**
     * A spot on a secret door says yes, ahead of its steps (a one-shot
     * message already shown ends the chain, and the door must still open
     * behind it: E3 has erased the spot by then). The terrain's own
     * step-change then opens it and, under `secret-doors`, takes the party
     * through on the same step, as E3's terrain table does after the spots
     * (`10c0:124d`, `:14df`). Until 2026-10-01 the chain opened the door
     * itself and refused the step, so the door showed from outside.
     */
    const thenOpen = (steps: Step[]): Step[] => (opens === undefined ? steps
      : [(next) => b.node('block-move', { ex1: [0], ex2: [0] }, next), ...steps]);
    if (s.id < 100) {
      const steps = scripts.get(s.id);
      if (!steps) {
        listed.push({ x: s.loc.x, y: s.loc.y, id: s.id, node: -1 });
        return;
      }
      // A spot below 10 whose flag is 20, the value E3's one-shot helpers
      // leave, is dead: the town dispatcher skips it (`FUN_10c0_0000`), and
      // outdoors it is moved off the map (`exile3.c` near line 67048). It
      // answers yes, so a door under it still opens.
      const flag = isTown ? townSpotFlag(place.town, s.id) : zoneSpotFlag(place.zone, s.id);
      const guarded: Step[] = s.id < 10 ? [b.ifFlagEq(flag, 20, [], steps)] : steps;
      // A door's node names its own square, so it isn't shared.
      if (opens !== undefined) n = b.compile(thenOpen(guarded));
      else {
        n = compiled.get(s.id) ?? b.compile(guarded);
        compiled.set(s.id, n);
      }
    } else {
      const msg: [number, number] = s.id >= 200
        ? [b.e3(block, s.id - 200), b.e3(block, s.id - 199)]
        : [b.e3(block, s.id - 100), -1];
      // E3 shows these through `FUN_1008_37de`/`3812` (`FUN_10c0_0000`), so
      // with their dialog picture 8.
      const pic = src.dialogPic?.(MSG_PIC);
      const once = e3SpotFlag(place, k);
      n = b.compile(thenOpen(terrainAt(s.loc.x, s.loc.y) >= repeatsFrom
        ? [(next) => b.node('disp-msg', { msg, pic }, next)]
        // Once, unless room descriptions repeat — and then only while the
        // spot is still there (a one-shot node leaves its flag set: 20, `e3Once`).
        : [b.ifFlagEq(ROOM_DESCRIPTIONS, 0,
          [(next) => b.node('once-disp-msg', { sdf: once, msg, pic }, next)],
          [b.ifFlagEq(once, 0, [(next) => b.node('disp-msg', { msg, pic }, next)])])]));
    }
    // E3 runs a town spot only on a square the party could stand on, or on
    // one of four blocked terrains — water and three walls — which it runs
    // on walking into (`FUN_10c0_0c97`). The engine runs a chain on a blocked
    // square when its first node is a CANT_ENTER with `ex2a` set, and that
    // node's refusal stands unless the chain changes it. Spots on other
    // blocked terrain are for Use (`use-special-spots`).
    //
    // The refusal stands in for the terrain's own: E3's spots answer yes and
    // its move code then stops a party on foot at the water's edge. A party
    // in a boat sails on (the engine runs the chain for a boat over water
    // anyway), so on water a boat has the refusal lifted. Until 2026-10-07
    // it didn't, and the Slime Pit's level 2 had a spot-2 square of water
    // at (20,21), the boat's only way to the western landing, that silently
    // refused every boat.
    const ter = terrainAt(s.loc.x, s.loc.y);
    if (isTown && WALK_INTO.has(ter)) {
      if (ter === WATER) n = b.node('if-boat', { ex1: [-1, -1, b.node('block-move', { ex1: [0], ex2: [0] }, n)] }, n);
      n = b.node('block-move', { ex1: [1], ex2: [1] }, n);
    }
    marks.push({ x: s.loc.x, y: s.loc.y, node: n });
    listed.push({ x: s.loc.x, y: s.loc.y, id: s.id, node: n });
  });
  const entry = onEntry ? b.compile(onEntry(b, false)) : -1;
  const entryDead = onEntry ? b.compile(onEntry(b, true)) : -1;
  const hostile = onHostile ? b.compile(onHostile(b)) : -1;
  const perSlot = (script: KillScript | undefined) => {
    const nodes = new Map<string, number>();
    return (src.creatures ?? []).map((_, slot) => {
      const k = script?.(b, slot);
      if (!k) return -1;
      const n = nodes.get(k.key) ?? b.compile(k.steps);
      nodes.set(k.key, n);
      return n;
    });
  };
  const kills = perSlot(onKill);
  const talks = perSlot(onTalk);
  const groupNodes = new Map<string, GroupNodes>();
  const groups = (onGroups?.(b) ?? []).map((g) => {
    const compile = (steps: Step[] | null) => (steps ? b.compile(steps) : -1);
    const n = groupNodes.get(g.key) ?? { meet: compile(g.meet), win: compile(g.win), flee: compile(g.flee) };
    groupNodes.set(g.key, n);
    return n;
  });
  const timers = (onTimers?.(b) ?? []).map((t) => ({ freq: t.freq, node: b.compile(t.steps) }));
  return { spec: b.spec, strings: b.strings, marks, spots: listed, entry, entryDead, hostile, kills, talks, groups, timers };
}
