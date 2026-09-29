/**
 * Exile 3's villages (town records 120–199) store no terrain. Their maps are
 * built whenever one is entered, by `FUN_1040_1600`
 * (`ghidra/project/village.s`), from the record's 15 building placements and
 * 10 rects:
 *
 * 1. Fill 48×48 with grass (2), or cave floor (0) when the party is in the
 *    caves (outdoor zone column 7 or more).
 * 2. Rects of kind 0–3: fill with the rect's terrain. Kind 1 draws only the
 *    frame. The chance of each square is `[20, 20, 1, 8][kind]` in 20.
 * 3. Buildings: block `b` (under 70) is the 8×8 square at `(b%8*8, b/8*8)` of
 *    the template, **town record 20**, a 64×64 sheet of buildings with each
 *    one's ruin beside it (read into `1168:0000`). It is mirrored if its rotation is 4 or
 *    more, then turned a quarter `rotation % 4` times. Wall and door
 *    terrains are swapped for their turned counterparts on each step, and
 *    every square above 4 is stamped at `(x, y)`.
 * 4. Rects of kind 10–13: the same as 0–3, over the buildings.
 * 5. Scatter variants at random: grass 2 → 3 or 4, cave floor 0 → 1, and
 *    84 → 85, 91 → 92, 36 → 37.
 *
 * E3 rolls steps 2, 4 and 5 again on every visit, so a village's grass and
 * its sparser rects change each time. The converter rolls them once, from a
 * fixed seed per town. That is cosmetic, and the engine's own dice are
 * untouched.
 *
 * A placement with a day (`cond >= 0`, event `+5`) shows block `b + 1`, the
 * same building ruined, once that day comes, as does every one once the
 * village has been overrun (its chop day, `1040:162e`) — if its block has a
 * ruin: even, and below 52 or from 56 to 61 (`1040:17c3`). The engine's map
 * is fixed, so the converter builds the village a second time with every
 * such building ruined, as a hidden town record of its own, and the
 * village's entry copies each building's square in from it when its day has
 * come (`copy-ter`, DIVERGENCES.md #24; `villageRuinSteps` in emit.ts).
 */

import { MT19937 } from '../../src/core/rng';
import type { E3Town, E3Village } from './town';

export const VILLAGE_SIZE = 48;
/** The town record whose map is the building sheet. */
export const VILLAGE_TEMPLATE_TOWN = 20;
const TEMPLATE_SIZE = 64;
const NO_BLOCK = 70;
/** Per rect kind (`% 10`): the chance in 20 that a square is filled (DS:0x1308). */
const RECT_CHANCE = [20, 20, 1, 8];
const GRASS = 2;
const CAVE_FLOOR = 0;

/** Mirroring swaps these pairs (`1040:191b`). */
const MIRROR_SWAPS: [number, number][] = [[169, 171], [156, 158], [65, 67]];
/** A quarter turn cycles these (`1040:1a4e`, a → b → c → d → a)… */
const TURN_CYCLES: [number, number, number, number][] = [
  [171, 170, 169, 168], [181, 158, 179, 156], [70, 65, 68, 67], [51, 57, 55, 53],
];
/** …and swaps these. */
const TURN_SWAPS: [number, number][] = [[175, 176], [177, 178], [157, 180], [66, 69], [228, 229], [253, 254]];

/** The building sheet, `[x * 64 + y]` as E3 holds it. */
export function villageTemplate(towns: E3Town[]): Uint8Array {
  const t = towns[VILLAGE_TEMPLATE_TOWN];
  if (!t || t.terrain.length !== TEMPLATE_SIZE) throw new Error('town 20 is not the 64×64 village template');
  return Uint8Array.from(t.terrain.flat());
}

function swap(t: number, [a, b]: [number, number]): number {
  return t === a ? b : t === b ? a : t;
}

function cycle(t: number, [a, b, c, d]: [number, number, number, number]): number {
  return t === a ? b : t === b ? c : t === c ? d : t === d ? a : t;
}

/** Whether block `b` has its ruin beside it on the sheet (`1040:17c3`). */
export function hasRuin(b: number): boolean {
  return b % 2 === 0 && (b < 52 || (b > 55 && b < 62));
}

/** A building that can fall to ruin: its 8×8 square's corner, and its own day and event (day -1: none). */
export interface RuinableBuilding { x: number; y: number; day: number; event: number }

export function ruinableBuildings(v: E3Village): RuinableBuilding[] {
  return v.entries.flatMap((e) => {
    const block = e.words[0] ?? NO_BLOCK;
    if (block < 0 || block >= NO_BLOCK || !hasRuin(block)) return [];
    const cond = e.words[1] ?? -1;
    return [{ x: e.bytes[2] ?? 0, y: e.bytes[3] ?? 0, day: cond >= 0 ? cond & 0xff : -1, event: e.bytes[1] ?? 8 }];
  });
}

/** The village's map, `[x][y]`; `ruined`, with every building that can be in ruins. */
export function buildE3Village(
  template: Uint8Array, v: E3Village, underground: boolean, seed: number, ruined = false,
): number[][] {
  const rng = new MT19937(seed);
  /** `get_ran(1, 1, n)`. */
  const roll = (n: number) => 1 + (rng.next() % n);
  const t = Array.from({ length: VILLAGE_SIZE }, () => Array<number>(VILLAGE_SIZE).fill(underground ? CAVE_FLOOR : GRASS));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < VILLAGE_SIZE && y < VILLAGE_SIZE;

  // FUN_1040_1440, over x from the rect's left to its right and y from its
  // top to its bottom. (In memory the loader has turned the file's Mac rect
  // into a Windows one, left first, as BoE 1997's `port_rect` does.)
  const fillRect = (r: E3Village['rects'][number]) => {
    const [terrain = 0, rawKind = 0] = r.bytes;
    const kind = rawKind % 10;
    const frame = kind === 1;
    const chance = RECT_CHANCE[kind] ?? 20;
    const { left: x0, top: y0, right: x1, bottom: y1 } = r.rect;
    for (let x = 0; x < VILLAGE_SIZE; x++) {
      for (let y = 0; y < VILLAGE_SIZE; y++) {
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        if (frame && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
        if (!frame && roll(20) > chance) continue;
        t[x]![y] = terrain;
      }
    }
  };

  for (const r of v.rects) if ((r.bytes[0] ?? 0) !== 0 && (r.bytes[1] ?? 0) < 10) fillRect(r);

  for (const e of v.entries) {
    const placed = e.words[0] ?? NO_BLOCK;
    if (placed < 0 || placed >= NO_BLOCK) continue;
    const block = ruined && hasRuin(placed) ? placed + 1 : placed;
    const [rotation = 0, , x0 = 0, y0 = 0] = e.bytes;
    let square: number[][] = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) =>
      template[((block % 8) * 8 + i) * TEMPLATE_SIZE + Math.floor(block / 8) * 8 + j] ?? 0));
    if (rotation >= 4) {
      square = square.map((_, i) => square[7 - i]!.map((tile) => MIRROR_SWAPS.reduce(swap, tile)));
    }
    for (let turn = 0; turn < rotation % 4; turn++) {
      const turned = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) turned[7 - j]![i] = square[i]![j]!;
      square = turned.map((col) => col.map((tile) => TURN_SWAPS.reduce(swap, TURN_CYCLES.reduce(cycle, tile))));
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const tile = square[i]![j]!;
        if (tile > 4 && inside(x0 + i, y0 + j)) t[x0 + i]![y0 + j] = tile;
      }
    }
  }

  for (const r of v.rects) if ((r.bytes[0] ?? 0) !== 0 && (r.bytes[1] ?? 0) >= 10) fillRect(r);

  for (let x = 0; x < VILLAGE_SIZE; x++) {
    for (let y = 0; y < VILLAGE_SIZE; y++) {
      let tile = t[x]![y]!;
      if (tile === 84 && roll(100) < 3) tile = 85;
      if (tile === 91 && roll(20) < 6) tile = 92;
      if (tile === 2 && roll(20) < 3) tile = 3;
      if (tile === 2 && roll(20) < 2) tile = 4;
      if (tile === 0 && roll(20) < 2) tile = 1;
      if (tile === 36 && roll(20) < 7) tile = 37;
      if (tile === 100 && (y % 51) + x === 0) tile = 112;
      t[x]![y] = tile;
    }
  }
  return t;
}
