/**
 * What Exile 3 does as the party enters a town: the per-town cases of its
 * town loader, `FUN_10d8_0107` (`ghidra/project/townentry.s`), which become
 * each town's `<onenter>` node. Literal strings are in segment 10d8.
 *
 * The loader's cases, and which are here:
 * - "Area has been cleaned out." (10d8:003c): a town counts as dead once a
 *   flag says so: 22 and 23 (0xc85), 50 (0x281), 52 (0x295), 46 and 90
 *   (0x257 and 0x259), 36 (0x1f3), 200 (0x1d5). Dead, E3 removes the
 *   ordinary creatures and brings in the after-death ones; here only the
 *   first. TODO(E3-3): the rest of the list, and after-death creatures.
 * - Towns 4–7 turn on a party the Anama caught robbing them (flag 0xac 2).
 * - Town 23 opens the portcullis the Slime Pit's pedestal chose.
 * - Castle Troglo (28) turns on the party past stage 6 of Vothkaro's story
 *   (10d8:1b32), when it also closes two squares unless the troglodytes are
 *   already at war; past stage 1 it opens a door by the cell.
 *   TODO(E3-3): E3 also makes everyone docile below stage 7.
 * - The Tower of Shifting Floors turns its belts as its control panel left
 *   them (10d8:1d0f): level 2 (33) by Belt Alpha and Belt Star, the
 *   basement (108) by Belt Beta.
 * - Under Tinraya (36), after the Crystal Souls, has every door of the
 *   cell panel and both rune doors open (10d8:1ec4).
 * - Rentar-Ihrno's keep: level 2 (64) opens the channels whose levers are
 *   pulled (10d8:1eb2, `FUN_10d8_239b`); level 1 (38) opens the portcullis
 *   at (41,1) for a party that came up stair 14 (E3 sets it just after the
 *   move, which ends a chain here). TODO(E3-3): E3 also scatters something
 *   at four squares of 38 (`FUN_1038_1185(x, y, 3)`, 10d8:1f2a).
 * - Guhkbar's Pit (89) keeps the dryad's cell open once she is free
 *   (10d8:1bf0), and Fort Emergence (21) changes (19,12) once 0xc92 is set
 *   (10d8:1c20).
 * - The 26-town table at 10d8:2333 runs before the record is loaded, on the
 *   town asked for. Its cases:
 *   - 0, 4, 8, 12, 16 swap in a later record by day (`towns/townStates.ts`);
 *     12 also marks Lorelei visited (below);
 *   - 22–33, 38, 46, 54, 60, 63, 92, 103, 104, 108 set terrain 255's
 *     blockage (emit.ts, `withTer255`);
 *   - 71, Zkal's level 2, zeroes its maze state (`zkal2Entry`);
 *   - 37, the Great Walls, sets party+0x138a/b to (0x39, 5). Nothing reads
 *     either byte directly, so what it is is **open**.
 * - TODO(E3-3): the others — towns 31, 41, 46, 57,
 *   78/79, 82, 90, 103–105, 107 — as those towns are transcribed.
 */

import type { EntryScript } from '../specials';
import { partyFlag as f, type SpecBuilder, type Step } from '../script';
import { ANAMA } from './shayder';
import { PEDESTAL } from './slimePit';
import { TROGLO_STAGE, TROGLO_WAR } from './castleTroglo';
import { BELT_ALPHA, BELT_BETA, BELT_STAR } from './shiftingFloors';
import { PANEL_DOORS, SOULS_FOUGHT } from './tinraya';
import { WALLS_SIDE, zkal2Entry } from './dungeons';
import { UP_STAIR_14, openChannels } from './rentarKeep';

const SEG = 0x10d8;
const LORELEI_SEEN = f(0x105);

/** The town is cleared once `flag` is set. */
const clearedBy = (flag: number) => (b: SpecBuilder): Step[] =>
  [b.ifFlagAtLeast(f(flag), 1, [b.log(SEG, 0x3c), b.removeCreatures()])];

/** The squares the Slime Pit's pedestal buttons open on level 2 (DGROUP 0x37e8). */
const PORTCULLISES: [number, number][] = [[5, 60], [10, 60], [33, 43], [48, 30], [54, 5]];

const shayder: EntryScript = (b) =>
  [b.ifFlagEq(ANAMA, 2, [b.log(SEG, 0x57), b.log(SEG, 0x77), b.makeTownHostile()])];

/**
 * Lorelei marks itself visited (10d8:0354), for Anaximander's report
 * (`towns/town21.ts`), which moves the flag on to 2. E3 does this before the
 * state swap, so for record 12 as asked for; here each of the four records
 * does it, which differs only if a script sent the party straight into a
 * later record.
 */
const lorelei: EntryScript = (b) => [b.ifFlagBelow(LORELEI_SEEN, 2, [b.setFlag(LORELEI_SEEN, 1)])];

export const ENTRY_SCRIPTS = new Map<number, EntryScript>([
  ...[4, 5, 6, 7].map((t): [number, EntryScript] => [t, shayder]),
  ...[12, 13, 14, 15].map((t): [number, EntryScript] => [t, lorelei]),
  [22, clearedBy(0xc85)],
  [23, (b) => [
    ...clearedBy(0xc85)(b),
    b.switchFlag(PEDESTAL, PORTCULLISES.map(([x, y]) => [b.setTer(x, y, 109)])),
  ]],
  [33, (b) => [BELT_ALPHA, BELT_STAR].map((belt) =>
    b.ifFlagAtLeast(belt.flag, 1, belt.squares.map(([x, y]) => b.setTer(x, y, 249))))],
  [108, (b) => [b.ifFlagAtLeast(BELT_BETA, 1, [7, 8, 9, 10, 11, 12].flatMap((y) => [b.setTer(12, y, 248), b.setTer(13, y, 250)]))]],
  // Not E3's: the Great Walls forget which end the party came in by.
  [37, (b) => [b.setFlag(WALLS_SIDE, 0)]],
  [64, (b) => openChannels(b)],
  [71, zkal2Entry],
  [89, (b) => [b.ifFlagAtLeast(f(0x406), 1, [b.setTer(0xe, 3, 0x67), b.setTer(0x16, 0x13, 0x6d)])]],
  [21, (b) => [b.ifFlagAtLeast(f(0xc92), 1, [b.setTer(0x13, 0xc, 0x4f)])]],
  [38, (b) => [b.ifFlagAtLeast(UP_STAIR_14, 1, [b.setTer(41, 1, 141), b.setFlag(UP_STAIR_14, 0)])]],
  [36, (b) => [...clearedBy(0x1f3)(b), b.ifFlagAtLeast(SOULS_FOUGHT, 1, [
    ...PANEL_DOORS.map(([x, y]) => b.setTer(x, y, 141)), b.setTer(28, 7, 0x87), b.setTer(12, 32, 0x87),
  ])]],
  [28, (b) => [
    b.ifFlagAtLeast(TROGLO_STAGE, 7, [b.makeTownHostile(), b.ifFlagEq(TROGLO_WAR, 0, [b.setTer(37, 53, 108), b.setTer(38, 53, 108)])]),
    b.ifFlagAtLeast(TROGLO_STAGE, 2, [b.setTer(52, 51, 101)]),
  ]],
]);
