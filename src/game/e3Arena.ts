/**
 * Exile III's outdoor combat arena: `FUN_10d8_342b` in EXILE3.EXE, which is
 * BoE's `create_out_combat_terrain` (`outCombat.ts`) as it stood before
 * Blades of Exile, with E3's own terrain numbers and tables.
 *
 * An exile-js extension, not in BoE or OBoE: a scenario with the feature flag
 * `outdoor-arena` set to `exile3` builds its arenas here. Each terrain's
 * `<arena>` is E3's arena kind for it (the table at `DS:3850`, which the
 * converter writes); everything else is below. The tables are E3's, copied
 * from its data segment at the addresses given, and
 * `test/e3convert.test.ts` reads them back out of the EXE to check them.
 *
 * Where it differs from BoE's: fourteen arena kinds, no fumaroles, camps or
 * crops; the road strip is a walkway (245) whatever the ground; a wall on the
 * east side stands at x = 32, not 35; walls get corner pieces; and a last pass
 * leaves the odd rock or stick lying about.
 */

import { loc, type Location } from '../core/location';
import type { Town } from '../data/town';
import type { Universe } from '../universe/universe';

const ARENA_DIM = 48;

/** The border: "Pit/Combat Border". */
const BORDER = 86;
/** What the road and bridge strips are paved with: "Walkway". */
const WALKWAY = 245;
/** E3's road terrains (cave, grass and hills); the test is on the party's terrain. */
const ROAD_FIRST = 232;
const ROAD_LAST = 234;

/** `DS:3a50` — the ground each arena kind is floored with. */
export const E3_ARENA_GROUND = [2, 0, 36, 50, 71, 0, 0, 0, 0, 2, 2, 2, 2, 0];

/**
 * `DS:3a6c` — the kind of wall an arena grows: 0 cave walls, 36 mountains,
 * anything else none. In EXILE3.EXE it is the same fourteen numbers as the
 * ground table.
 */
export const E3_ARENA_WALLS = [2, 0, 36, 50, 71, 0, 0, 0, 0, 2, 2, 2, 2, 0];

/** `DS:3ae6` — terrain, odds-in-a-thousand, five pairs per arena kind. */
export const E3_ARENA_ODDS: number[][] = [
  [3, 80, 4, 40, 94, 20, 93, 10, 91, 1], // grass: grass, shrubs, small trees, a tree
  [1, 50, 84, 25, 85, 5, 96, 10, 87, 1], // cave
  [37, 20, 0, 0, 0, 0, 0, 0, 0, 0], // hills
  [64, 3, 63, 1, 0, 0, 0, 0, 0, 0], // surface bridge
  [74, 1, 0, 0, 0, 0, 0, 0, 0, 0], // cave bridge
  [79, 700, 95, 30, 96, 20, 83, 4, 87, 1], // rubble
  [84, 280, 82, 300, 83, 270, 87, 7, 96, 10], // cave forest
  [1, 800, 84, 600, 85, 10, 83, 10, 87, 4], // mushrooms
  [1, 700, 88, 200, 87, 100, 83, 10, 82, 5], // cave swamp
  [3, 600, 97, 90, 89, 20, 93, 6, 92, 2], // rocky ground
  [3, 200, 4, 400, 90, 250, 0, 0, 0, 0], // surface swamp
  [3, 200, 4, 300, 91, 50, 92, 60, 93, 100], // woods
  [3, 100, 4, 250, 94, 120, 93, 30, 91, 2], // shrubbery
  [1, 25, 79, 15, 96, 300, 95, 280, 0, 0], // stalagmites
];

/** `DS:3a88` — where a stamp can be dropped. */
export const E3_ARENA_STAMP_LOCS: [number, number][] = [
  [11, 10], [11, 14], [10, 20], [11, 26], [9, 30], [15, 19], [23, 19], [19, 29],
  [20, 11], [28, 16], [28, 24], [27, 19], [27, 29], [15, 28], [19, 19],
];

/** The four 4×4 stamps, row by row: `DS:3aa6`, `3ab6`, `3ac6` and `3ad6`. */
export const E3_CAVE_PILLAR = [0, 14, 11, 1, 14, 19, 20, 11, 17, 18, 21, 8, 1, 17, 8, 0];
export const E3_MNTN_PILLAR = [37, 29, 27, 36, 29, 33, 34, 27, 31, 32, 35, 25, 36, 31, 25, 37];
export const E3_SURF_LAKE = [56, 55, 54, 90, 57, 50, 61, 54, 58, 51, 59, 53, 90, 90, 58, 52];
export const E3_CAVE_LAKE = [84, 88, 71, 71, 88, 71, 71, 71, 71, 71, 71, 88, 71, 71, 71, 88];

/**
 * The last pass (`10d8:3bb8`, its table at `cs:3d23`): a square of one of
 * these terrains may get a rock (items 9 and 10) or a stick (item 11). Each
 * roll is `get_ran(1, 0, n) == 5`, and a later hit replaces an earlier one.
 */
const LOOT: [terrains: number[], rolls: [n: number, item: number][]][] = [
  [[0, 1, 84, 85], [[200, 9], [200, 10]]],
  [[2, 3, 4], [[240, 9], [240, 10], [350, 11]]],
  [[83, 93, 94], [[20, 11]]],
];

/**
 * Builds the arena into `arena.terrain`, and returns the items E3 scatters
 * over it, for the caller to place once the arena is the current town.
 * `terType` is the outdoor terrain the party stood on; `numWalls` is BoE's
 * `count_walls`, as for `createOutCombatTerrain`.
 * TODO(E3-3): E3's caller (`1018:0111`) passes its own wall count, not
 * checked against BoE's.
 */
export function createE3OutCombatTerrain(
  univ: Universe, arena: Town, terType: number, numWalls: number,
): { item: number; where: Location }[] {
  const ter = arena.terrain;
  const rng = univ.rng;
  const kind = univ.terrainType(terType).combatArena;
  const ground = E3_ARENA_GROUND[kind] ?? 0;

  for (let x = 0; x < ARENA_DIM; x++) {
    for (let y = 0; y < ARENA_DIM; y++) {
      ter[x]![y] = (y <= 8 || y >= 35 || x <= 8 || x >= 35) ? BORDER : ground;
    }
  }
  const odds = E3_ARENA_ODDS[kind] ?? [];
  for (let x = 0; x < ARENA_DIM; x++) {
    for (let y = 0; y < ARENA_DIM; y++) {
      for (let k = 0; k < 5; k++) {
        if (ter[x]![y] !== BORDER && rng.getRan(1, 1, 1000) < odds[k * 2 + 1]!) ter[x]![y] = odds[k * 2]!;
      }
    }
  }
  // The corner is what a blocked square is cleared to when the party lands.
  ter[0]![0] = ground;

  const strip = (x0: number, x1: number): void => {
    ter[0]![0] = WALKWAY;
    for (let x = x0; x < x1; x++) for (let y = 9; y < 35; y++) ter[x]![y] = WALKWAY;
  };
  if (kind === 3 || kind === 4) strip(15, 26);
  if (terType >= ROAD_FIRST && terType <= ROAD_LAST) strip(19, 23);

  const stamp = (pattern: number[], at: [number, number]): void => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) ter[at[0] + j]![at[1] + i] = pattern[i * 4 + j]!;
  };
  const scatter = (oneIn: number, pattern: number[]): void => {
    for (const at of E3_ARENA_STAMP_LOCS) if (rng.getRan(1, 0, oneIn) === 1) stamp(pattern, at);
  };
  // As in BoE, the tests are on the corner, so a road or bridge strip rules
  // out the cave and lake stamps.
  if (kind === 2) scatter(5, E3_MNTN_PILLAR);
  if (ter[0]![0] === 0) scatter(25, E3_CAVE_PILLAR);
  if (ter[0]![0] === 0) scatter(40, E3_CAVE_LAKE);
  if (ter[0]![0] === 2) scatter(40, E3_SURF_LAKE);

  const walls = E3_ARENA_WALLS[kind];
  if (walls === 0) growWalls(univ, ter, numWalls, [6, 9, 12, 15], [21, 19, 32, 20]);
  // Mountain walls test for their corners with the *cave* wall pieces, as
  // EXILE3.EXE does (`10d8:3ad3`). A mountain arena has none of those, so
  // its walls never get corners. Looks like a copy-and-paste slip; kept.
  if (walls === 36) growWalls(univ, ter, numWalls, [24, 26, 28, 30], [35, 33, 32, 34], [6, 9, 12, 15]);

  const loot: { item: number; where: Location }[] = [];
  for (let x = 0; x < ARENA_DIM; x++) {
    for (let y = 0; y < ARENA_DIM; y++) {
      const rolls = LOOT.find(([terrains]) => terrains.includes(ter[x]![y]!))?.[1];
      if (!rolls) continue;
      let item = -1;
      for (const [n, which] of rolls) if (rng.getRan(1, 0, n) === 5) item = which;
      if (item >= 0) loot.push({ item, where: loc(x, y) });
    }
  }
  return loot;
}

/**
 * The walls along the arena's sides: `numWalls` times, one side picked at
 * random is walled from 9 to 34 — north (y = 8), west (x = 8), south
 * (y = 35) and east (x = **32**, not 35 as in BoE: `es:[j + 0x32be]` is
 * column 32). Then a corner piece goes where two walls meet, tested by one
 * square of each (`10d8:39a2`). `test` is the four pieces the corner tests
 * look for, which EXILE3.EXE gives as the cave ones in both branches.
 */
function growWalls(
  univ: Universe, ter: number[][], numWalls: number,
  pieces: [n: number, w: number, s: number, e: number],
  corners: [nw: number, se: number, ne: number, sw: number],
  test: [n: number, w: number, s: number, e: number] = pieces,
): void {
  for (let i = 0; i < numWalls; i++) {
    const side = univ.rng.getRan(1, 0, 3);
    for (let j = 9; j < 35; j++) {
      if (side === 0) ter[j]![8] = pieces[0];
      else if (side === 1) ter[8]![j] = pieces[1];
      else if (side === 2) ter[j]![35] = pieces[2];
      else if (side === 3) ter[32]![j] = pieces[3];
    }
  }
  const [n, w, s, e] = test;
  if (ter[17]![8] === n && ter[8]![20] === w) ter[8]![8] = corners[0];
  if (ter[32]![20] === e && ter[17]![35] === s) ter[32]![35] = corners[1];
  if (ter[17]![8] === n && ter[32]![20] === e) ter[32]![8] = corners[2];
  if (ter[8]![20] === w && ter[17]![35] === s) ter[8]![35] = corners[3];
}
