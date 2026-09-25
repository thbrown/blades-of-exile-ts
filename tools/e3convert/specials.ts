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
import { SpecBuilder, townSpotFlag, type ScriptSource, type Step } from './script';

export interface E3Spot { loc: { x: number; y: number }; id: number }

export interface SpotScript {
  /** The `.spec` file. */
  spec: string;
  /** The special strings the nodes' `msg` fields index. */
  strings: string[];
  /** Where each spot's node goes on the map. */
  marks: { x: number; y: number; node: number }[];
}

/** A place's own encounters, transcribed (`towns/`): steps by encounter number. */
export type PlaceScript = (b: SpecBuilder) => Map<number, Step[]>;

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
  src: ScriptSource, terrainAt: (x: number, y: number) => number, own?: PlaceScript,
): SpotScript {
  const isTown = 'town' in place;
  const block = isTown ? e3TownMessageBlock(place.town) : e3ZoneMessageBlock(place.zone);
  const repeatsFrom = isTown ? 237 : 209;
  const b = new SpecBuilder(src, (label) => Math.max(0, BASIC_BUTTONS.indexOf(label)));
  const scripts = own?.(b) ?? new Map<number, Step[]>();
  const compiled = new Map<number, number>();
  const marks: SpotScript['marks'] = [];
  spots.forEach((s, k) => {
    if (s.loc.x === 0 && s.loc.y === 0) return;
    if (isTown && s.id === 255) return;
    let n: number;
    if (s.id < 100) {
      const steps = scripts.get(s.id);
      if (!steps) return;
      // The town dispatcher skips a spot below 10 whose flag `(t, id)` is 20,
      // the value E3's one-shot helpers leave (`FUN_10c0_0000`).
      const guarded: Step[] = isTown && s.id < 10
        ? [b.ifFlagEq(townSpotFlag(place.town, s.id), 20, [], steps)]
        : steps;
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
    marks.push({ x: s.loc.x, y: s.loc.y, node: n });
  });
  return { spec: b.spec, strings: b.strings, marks };
}
