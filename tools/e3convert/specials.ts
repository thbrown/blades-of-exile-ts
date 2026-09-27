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
 * | 50–59 | nothing |
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
 * TODO(E3-3): E3 plays sound 57 with each message, and never erases a spot
 * while flag (306, 3) is set.
 */

import { BASIC_BUTTONS } from '../../src/game/specials/oneshot';
import { e3SpotFlag } from './flags';
import { SpecBuilder, townSpotFlag, zoneSpotFlag, type ScriptSource, type Step } from './script';

export interface E3Spot { loc: { x: number; y: number }; id: number }

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
  /** The town's entry node (`<onenter>`), or -1. */
  entry: number;
}

/** A place's own encounters, transcribed (`towns/`): steps by encounter number. */
export type PlaceScript = (b: SpecBuilder) => Map<number, Step[]>;

/** What a town does as the party enters it (`towns/entry.ts`). */
export type EntryScript = (b: SpecBuilder) => Step[];

/** Blocked terrains a town spot still runs on (water, and three walls). */
const WALK_INTO = new Set([71, 101, 118, 133]);

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
  src: ScriptSource, terrainAt: (x: number, y: number) => number, own?: PlaceScript, onEntry?: EntryScript,
): SpotScript {
  const isTown = 'town' in place;
  const block = isTown ? e3TownMessageBlock(place.town) : e3ZoneMessageBlock(place.zone);
  const repeatsFrom = isTown ? 237 : 209;
  const spotLoc = (id: number) => spots.find((s) => s.id === id && !(s.loc.x === 0 && s.loc.y === 0))?.loc;
  const b = new SpecBuilder({ ...src, spotLoc }, (label) => Math.max(0, BASIC_BUTTONS.indexOf(label)));
  const scripts = own?.(b) ?? new Map<number, Step[]>();
  const compiled = new Map<number, number>();
  const marks: SpotScript['marks'] = [];
  const listed: SpotScript['spots'] = [];
  spots.forEach((s, k) => {
    if (s.loc.x === 0 && s.loc.y === 0) return;
    if (isTown && s.id === 255) return;
    // 50–59 are markers, which do nothing when stepped on.
    if (s.id >= 50 && s.id < 60) return;
    let n: number;
    if (s.id < 100) {
      const steps = scripts.get(s.id);
      if (!steps) {
        listed.push({ x: s.loc.x, y: s.loc.y, id: s.id, node: -1 });
        return;
      }
      // A spot below 10 whose flag is 20, the value E3's one-shot helpers
      // leave, is dead: the town dispatcher skips it (`FUN_10c0_0000`), and
      // outdoors it is moved off the map (`exile3.c` near line 67048).
      const flag = isTown ? townSpotFlag(place.town, s.id) : zoneSpotFlag(place.zone, s.id);
      const guarded: Step[] = s.id < 10 ? [b.ifFlagEq(flag, 20, [], steps)] : steps;
      n = compiled.get(s.id) ?? b.compile(guarded);
      compiled.set(s.id, n);
    } else {
      const msg: [number, number] = s.id >= 200
        ? [b.e3(block, s.id - 200), b.e3(block, s.id - 199)]
        : [b.e3(block, s.id - 100), -1];
      n = terrainAt(s.loc.x, s.loc.y) >= repeatsFrom
        ? b.node('disp-msg', { msg }, -1)
        : b.node('once-disp-msg', { sdf: e3SpotFlag(place, k), msg }, -1);
    }
    // E3 runs a town spot only on a square the party could stand on, or on
    // one of four blocked terrains — water and three walls — which it runs
    // on walking into (`FUN_10c0_0c97`). The engine runs a chain on a blocked
    // square when its first node is a CANT_ENTER with `ex2a` set, and that
    // node's refusal stands unless the chain changes it. Spots on other
    // blocked terrain are for Use (`use-special-spots`).
    if (isTown && WALK_INTO.has(terrainAt(s.loc.x, s.loc.y))) {
      n = b.node('block-move', { ex1: [1], ex2: [1] }, n);
    }
    marks.push({ x: s.loc.x, y: s.loc.y, node: n });
    listed.push({ x: s.loc.x, y: s.loc.y, id: s.id, node: n });
  });
  const entry = onEntry ? b.compile(onEntry(b)) : -1;
  return { spec: b.spec, strings: b.strings, marks, spots: listed, entry };
}
