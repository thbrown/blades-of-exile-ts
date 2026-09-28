/**
 * What Exile 3 does as the party enters a town: the per-town cases of its
 * town loader, `FUN_10d8_0107` (`ghidra/project/townentry.s`), which become
 * each town's `<onenter>` nodes (`townEntryScript`). Literal strings are in
 * segment 10d8. In E3's order:
 *
 * - **Cleared out** ("Area has been cleaned out.", 10d8:003c): BoE's kill
 *   count and chop, which the engine does itself and answers with the
 *   `dead` node, or a flag: 22 and 23 (0xc85), 50 (0x281), 52 (0x295), 46
 *   and 90 (0x257 and 0x259 both), 36 (0x1f3), and 200, which no entrance
 *   names. A cleared town loses its creatures. E3 keeps the ones its chop
 *   spared (`active` 10 and up), which is the engine's own thrash
 *   (DIVERGENCES.md §14): no town a flag clears has a chop day, and a
 *   chopped one has already run the `dead` node, so the flag's
 *   `nuke-monsts` never meets a spared creature.
 * - **Plagues' creatures** (`FUN_10d8_3d5b`, 10d8:18b4): once the Alien Slime
 *   is dead (0xc85) the slimes, kinds 138–141, are gone from every town but
 *   the Tower of Magi (24); in 46 and 90 also once 0x259 is set. Once the
 *   Filth Factory burns (0xc87) the roaches, 143–147, are gone everywhere;
 *   once the golems' crystal breaks (0xc8c), kinds 159–163 from the Tower of
 *   Shifting Floors (32, 33, 60). Each living slime first leaves a small
 *   slime decal where it stands (10d8:17a2). 46 also opens (24,41) at 0x259.
 * - Wolfrider Warren (82) opens (4,20) to a party that came in by entrance
 *   3 (10d8:1a05).
 * - Towns 4–7 turn on a party the Anama caught robbing them (flag 0xac 2).
 * - The dragons (10d8:1a85): in 57, 104 and 105, a party that killed one
 *   (0x2c6, 0x49c or 0x4a6) finds the lair hostile; in Athron's (104), so does
 *   one that angered him (0x49d). Either way Athron's drake goes (kind 83).
 * - Castle Troglo (28) is docile and still below stage 7 of Vothkaro's story
 *   and hostile from it (10d8:1b32), when it also closes two squares unless
 *   the troglodytes are already at war; past stage 1 it opens a door by the
 *   cell.
 * - Guhkbar's Pit (89) keeps the dryad's cell open once she is free
 *   (10d8:1bf0), and Fort Emergence (21) changes (19,12) once 0xc92 is set
 *   (10d8:1c20).
 * - Once 0xc8a is set, terrain 255 is ground in 29, 31 and 103 (10d8:1c45).
 * - Decals scattered over the ground (`FUN_1038_1270`): slime in the Slime
 *   Pit (22, 23), blood in the Monastery of Madness (78, 79).
 * - The Tower of Shifting Floors turns its belts as its control panel left
 *   them (10d8:1d0f): level 2 (33) by Belt Alpha and Belt Star, the
 *   basement (108) by Belt Beta. Level 1 (32) has lost each of its sixteen
 *   golem generators whose flag is set (10d8:1dff), which nothing in E3
 *   ever sets (`shiftingFloors.ts`).
 * - Rentar-Ihrno's keep: level 2 (64) opens the channels whose levers are
 *   pulled (10d8:1eb2, `FUN_10d8_239b`); level 1 (38) has four blood decals
 *   (10d8:1f2a), and opens the portcullis at (41,1) for a party that came up
 *   stair 14 (E3 sets it just after the move, which ends a chain here).
 * - Under Tinraya (36), after the Crystal Souls, has every door of the
 *   cell panel and both rune doors open (10d8:1ec4).
 * - **The greeting** (10d8:2281): a party that walks in (`entry_dir < 9`)
 *   gets the town record's message, or its cleared-out one (`E3Town`).
 * - Ghikra (41) and the Lower Caves of the Giants (31) each have a line
 *   more once a flag is set (10d8:22c6).
 * - The 26-town table at 10d8:2333 runs before the record is loaded, on the
 *   town asked for. Its cases:
 *   - 0, 4, 8, 12, 16 swap in a later record by day (`towns/townStates.ts`);
 *     12 also marks Lorelei visited (below);
 *   - 22–33, 38, 46, 54, 60, 63, 92, 103, 104, 108 set terrain 255's
 *     blockage (emit.ts, `withTer255`);
 *   - 71, Zkal's level 2, zeroes its maze state (`zkal2Entry`);
 *   - 37, the Great Walls, sets party+0x138a/b to (0x39, 5). Nothing reads
 *     either byte directly, so what it is is **open**.
 */

import type { EntryScript, TownEntryScript } from '../specials';
import { partyFlag as f, type Flag, type SpecBuilder, type Step } from '../script';
import { ANAMA } from './shayder';
import { PEDESTAL } from './slimePit';
import { TROGLO_STAGE, TROGLO_WAR } from './castleTroglo';
import { BELT_ALPHA, BELT_BETA, BELT_STAR, GENERATORS } from './shiftingFloors';
import { PANEL_DOORS, SOULS_FOUGHT } from './tinraya';
import { WALLS_SIDE, zkal2Entry } from './dungeons';
import { UP_STAIR_14, openChannels } from './rentarKeep';

const SEG = 0x10d8;
const LORELEI_SEEN = f(0x105);

/** The squares the Slime Pit's pedestal buttons open on level 2 (DGROUP 0x37e8). */
const PORTCULLISES: [number, number][] = [[5, 60], [10, 60], [33, 43], [48, 30], [54, 5]];

/** Athron's drake, gone once Athron is angered (flag (104, 9)). */
const ATHRON_ANGRY = f(0x49d);

/**
 * The dragons' lairs (10d8:1a85): Sulfras's (57), Athron's (104) and
 * Khoth's (105) turn on a party that killed a dragon, and Athron's on one
 * that angered him.
 */
function dragons(b: SpecBuilder, t: number): Step[] {
  const hostile = (line: number): Step[] => [
    b.log(SEG, line), b.makeTownHostile(), b.ifFlagAtLeast(ATHRON_ANGRY, 1, [b.removeCreatures(0x53)]),
  ];
  const angry: Step[] = t === 104 ? [b.ifFlagAtLeast(ATHRON_ANGRY, 1, hostile(0xb5))] : [];
  return [b.ifFlagAtLeast(f(0x2c6), 1, hostile(0x8c), [
    b.ifFlagAtLeast(f(0x49c), 1, hostile(0x8c), [b.ifFlagAtLeast(f(0x4a6), 1, hostile(0x8c), angry)]),
  ])];
}

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

/** Each town's own cases, between the plagues' creatures and the greeting. */
const TOWN_CASES = new Map<number, EntryScript>([
  ...[4, 5, 6, 7].map((t): [number, EntryScript] => [t, shayder]),
  ...[12, 13, 14, 15].map((t): [number, EntryScript] => [t, lorelei]),
  [22, (b) => [b.scatterDecals(4, 20)]],
  [23, (b) => [b.switchFlag(PEDESTAL, PORTCULLISES.map(([x, y]) => [b.setTer(x, y, 109)])), b.scatterDecals(4, 20)]],
  [33, (b) => [BELT_ALPHA, BELT_STAR].map((belt) =>
    b.ifFlagAtLeast(belt.flag, 1, belt.squares.map(([x, y]) => b.setTer(x, y, 249))))],
  [108, (b) => [b.ifFlagAtLeast(BELT_BETA, 1, [7, 8, 9, 10, 11, 12].flatMap((y) => [b.setTer(12, y, 248), b.setTer(13, y, 250)]))]],
  // Not E3's: the Great Walls forget which end the party came in by.
  [37, (b) => [b.setFlag(WALLS_SIDE, 0)]],
  [64, (b) => openChannels(b)],
  [71, zkal2Entry],
  [89, (b) => [b.ifFlagAtLeast(f(0x406), 1, [b.setTer(0xe, 3, 0x67), b.setTer(0x16, 0x13, 0x6d)])]],
  [21, (b) => [b.ifFlagAtLeast(f(0xc92), 1, [b.setTer(0x13, 0xc, 0x4f)])]],
  [38, (b) => [
    ...[[0x38, 4], [0x3a, 6], [0x36, 7], [0x3b, 8]].map(([x, y]) => b.decal(x!, y!, 3)),
    b.ifFlagAtLeast(UP_STAIR_14, 1, [b.setTer(41, 1, 141), b.setFlag(UP_STAIR_14, 0)]),
  ]],
  [36, (b) => [b.ifFlagAtLeast(SOULS_FOUGHT, 1, [
    ...PANEL_DOORS.map(([x, y]) => b.setTer(x, y, 141)), b.setTer(28, 7, 0x87), b.setTer(12, 32, 0x87),
  ])]],
  [28, (b) => [
    b.ifFlagAtLeast(TROGLO_STAGE, 7, [
      b.setAttitudes(3, 'record'),
      b.ifFlagEq(TROGLO_WAR, 0, [b.setTer(37, 53, 108), b.setTer(38, 53, 108)]),
    ], [b.setAttitudes(0, false)]),
    b.ifFlagAtLeast(TROGLO_STAGE, 2, [b.setTer(52, 51, 101)]),
  ]],
  ...[29, 31, 103].map((t): [number, EntryScript] => [t, (b) =>
    [b.ifFlagAtLeast(f(0xc8a), 1, [b.replaceTerrain(255, 0), b.replaceTerrain(256, 0)])]]),
  ...[78, 79].map((t): [number, EntryScript] => [t, (b) => [b.scatterDecals(1, 5)]]),
  [32, (b) => GENERATORS.map(({ flag, x, y }) => b.ifFlagAtLeast(flag, 1, [b.setTer(x, y, 0)]))],
  [82, (b) => [b.ifEntryDir(3, 3, [b.setTer(4, 20, 0x8d)])]],
  ...[57, 104, 105].map((t): [number, EntryScript] => [t, (b) => dragons(b, t)]),
]);

/**
 * The flags that clear a town out, by town (10d8:107b): every one of a
 * town's must be set. The engine's own clearing (kill count, chop) runs the
 * `dead` node instead.
 */
const CLEARED_BY = new Map<number, number[]>([
  [22, [0xc85]], [23, [0xc85]], [50, [0x281]], [52, [0x295]],
  [46, [0x257, 0x259]], [90, [0x257, 0x259]], [36, [0x1f3]],
]);

/** Kinds of creature a flag removes (`FUN_10d8_3d5b`), and the towns it spares or is limited to. */
const PLAGUES: { flag: number; kinds: number[]; towns?: number[]; spares?: number }[] = [
  { flag: 0xc85, kinds: [138, 139, 140, 141], spares: 24 },
  { flag: 0x259, kinds: [138, 139, 140, 141], towns: [46, 90] },
  { flag: 0xc87, kinds: [143, 144, 145, 146, 147] },
  { flag: 0xc8c, kinds: [159, 160, 161, 162, 163], towns: [32, 33, 60] },
];

/** `flags` all set: `then`, else `otherwise`. */
function ifAll(b: SpecBuilder, flags: Flag[], then: Step[], otherwise: Step[] = []): Step[] {
  return flags.reduceRight<Step[]>((inner, flag) => [b.ifFlagAtLeast(flag, 1, inner, otherwise)], then);
}

/**
 * Town `t`'s entry script, or undefined if E3 does nothing there. `kinds`
 * and `slimes` are the town's creatures: which kinds live there, and where
 * each slime (138–141) starts. `greeting` and `cleared` are the town
 * record's messages, (0, 0) for none.
 */
export function townEntryScript(
  t: number, kinds: Set<number>, slimes: { x: number; y: number }[],
  greeting: [number, number], cleared: [number, number],
): TownEntryScript | undefined {
  const flags = (CLEARED_BY.get(t) ?? []).map((k) => f(k));
  const plagues = PLAGUES.filter((p) => (p.towns ? p.towns.includes(t) : p.spares !== t)
    && p.kinds.some((k) => kinds.has(k)));
  const own = TOWN_CASES.get(t);
  const shown = (m: [number, number]) => m[0] > 0 && m[1] > 0;
  const after: [Flag, number, number] | undefined =
    t === 41 ? [f(0x225), 0x3c, 0x32] : t === 31 ? [f(0x1c1), 0x3a, 0xa] : undefined;
  if (!flags.length && !plagues.length && !slimes.length && !own && !shown(greeting) && !shown(cleared) && !after) return undefined;
  return (b, dead) => {
    const say = (m: [number, number]): Step[] => (shown(m) ? [b.msg(m[0], m[1])] : []);
    // The engine has already said so, and emptied the town, for its own clearing.
    // Each living slime leaves slime where it stands: none in a cleared town.
    const decals = slimes.map((l) => b.decal(l.x, l.y, 4));
    const clearing = dead ? [] : flags.length ? ifAll(b, flags, [b.log(SEG, 0x3c), b.removeCreatures()], decals) : decals;
    const greet = dead ? say(cleared) : flags.length ? ifAll(b, flags, say(cleared), say(greeting)) : say(greeting);
    return [
      ...clearing,
      ...plagues.map((p) => b.ifFlagAtLeast(f(p.flag), 1, p.kinds.filter((k) => kinds.has(k)).map((k) => b.removeCreatures(k)))),
      ...(own?.(b) ?? []),
      ...(greet.length ? [b.ifWalkedIn(greet)] : []),
      ...(after ? [b.ifFlagAtLeast(after[0], 1, [b.msg(after[1], after[2])])] : []),
    ];
  };
}
