/**
 * The Ritual of Sanctification (spell 108): `FUN_10b0_682f`, called from
 * `cast_town_spell`. E3 hard-codes a dozen squares, each in a town or a
 * range of towns; the spell answers on one of them and says "Nothing
 * happens." anywhere else (the engine's own `RITUAL_SANCTIFY` arm).
 *
 * Here each square is a spot of its own, `SANCTIFY_SPOT` on, whose first
 * node is IF_CONTEXT's TARGET arm for spell 108 alone. A case E3 answered
 * ends with a block, which intercepts the spell (so no "Nothing happens."
 * follows); a case whose flag has already been spent falls through to it,
 * as E3's `else` chain does.
 *
 * The squares are altars, which no step reaches, so none needs a guard
 * against being walked on. The third argument of E3's message calls is the
 * sound (57), as everywhere; the screen flashes before the Troglo Temple's
 * hordlings (`FUN_1098_6e9c`, three times) aren't ported, as elsewhere.
 */

import { Spell } from '../../../src/data/spell';
import type { PlaceScript } from '../specials';
import { partyFlag as f, townSpotFlag, type SpecBuilder, type Step } from '../script';
import { greatCircleSmash } from './dungeons';

/** The spot ids the Ritual's squares take (E3's own go up to 26, the slime pools' from 80). */
export const SANCTIFY_SPOT = 70;

interface Sanctified {
  towns: number[];
  at: [number, number][];
  steps: (b: SpecBuilder) => Step[];
}

/** Answered: the steps, and the block that stops "Nothing happens." */
const done = (b: SpecBuilder, steps: Step[]): Step[] => [...steps, b.blockMove()];

/** E3's cases, in its order. */
const CASES: Sanctified[] = [
  { towns: [44], at: [[44, 2]], steps: (b) => done(b, [b.msg(60, 0x1b)]) },
  { towns: [45], at: [[22, 2]], steps: (b) => done(b, [b.msg(60, 0x1b)]) },
  // The Agate Tower's dark altar, cracked (spot 3's flag to 2).
  {
    towns: [46], at: [[12, 19]],
    steps: (b) => [b.ifFlagBelow(f(0x253), 2, done(b, [b.msg(60, 0x67), b.setFlag(f(0x253), 2), b.xp(6)]))],
  },
  // Shayder's Anama altar: blasphemy, and every PC is struck from the party
  // (main status 0, 1070's slot word).
  { towns: [4, 5, 6, 7], at: [[20, 14]], steps: (b) => done(b, [b.msg(0x34, 0x15), b.slayParty(0)]) },
  // The spiders' altar. E3 writes 0 to the flag it tested for 0 (10b0:6990),
  // so it answers every time and the demon comes every time
  // (E3-SUSPECTED-BUGS.md #18); fixed, it spends the flag as its neighbours do.
  {
    towns: [48], at: [[11, 15]],
    steps: (b) => [b.ifFlagEq(f(0x26c), 0, done(b, [
      b.msg(60, 0x55), b.ifFixed(18, [b.setFlag(f(0x26c), 20)], [b.setFlag(f(0x26c), 0)]), b.xp(6), b.bringIn(200, 1),
    ]))],
  },
  { towns: [51], at: [[43, 3], [43, 4]], steps: (b) => done(b, [b.msg(61, 0xd)]) },
  // The Troglo Temple's upper level: the dark altar (the hordlings come),
  // and the inner altar (the haakai). Each kills its deadly altar spot
  // beside it (5 and 6).
  {
    towns: [101], at: [[25, 13]],
    steps: (b) => [b.ifFlagEq(townSpotFlag(101, 9), 0, done(b, [
      b.msg(66, 6, 7), b.setFlag(townSpotFlag(101, 9), 1), b.setFlag(townSpotFlag(101, 5), 20),
      b.xp(10), b.bringIn(200, 3),
    ]))],
  },
  {
    towns: [101], at: [[28, 25]],
    steps: (b) => [b.ifFlagEq(townSpotFlag(101, 8), 0, done(b, [
      b.bringIn(201, 3), b.msg(66, 8), b.setFlag(townSpotFlag(101, 8), 1), b.setFlag(townSpotFlag(101, 6), 20),
      b.xp(10),
    ]))],
  },
  // Castle Troglo's altar (spot 1's, which drains spell points) and the
  // caves' (spot 2's fire): each quieted.
  {
    towns: [28], at: [[14, 38]],
    steps: (b) => [b.ifFlagEq(townSpotFlag(28, 1), 0, done(b, [b.msg(57, 0x3f), b.setFlag(townSpotFlag(28, 1), 20), b.xp(8)]))],
  },
  {
    towns: [29], at: [[7, 56]],
    steps: (b) => [b.ifFlagEq(townSpotFlag(29, 2), 0, done(b, [b.msg(57, 0x55), b.setFlag(townSpotFlag(29, 2), 20), b.xp(8)]))],
  },
  { towns: [78], at: [[24, 5]], steps: (b) => done(b, [b.msg(63, 1)]) },
  // The Great Circle's altar: its smashing, and only the haakai's bargain
  // taken ends it; refused, "Nothing happens." follows the haakai (10b0:6d6a).
  {
    towns: [62], at: [[23, 24]],
    steps: (b) => [b.ifFlagEq(townSpotFlag(62, 1), 0, greatCircleSmash(b, [b.blockMove()]))],
  },
];

/** The Ritual's squares in `town`, as spots to add after E3's own. */
export function sanctifySpots(town: number): { loc: { x: number; y: number }; id: number }[] {
  return CASES.flatMap((c) => (c.towns.includes(town) ? c.at : []))
    .map(([x, y], k) => ({ loc: { x, y }, id: SANCTIFY_SPOT + k }));
}

/** `script` with the Ritual's spots of `town` added, if it has any. */
export function withSanctify(town: number, script: PlaceScript | undefined): PlaceScript | undefined {
  const here = CASES.filter((c) => c.towns.includes(town));
  if (!here.length) return script;
  return (b) => {
    const m = new Map(script?.(b) ?? []);
    let k = 0;
    for (const c of here) {
      for (const _ of c.at) {
        m.set(SANCTIFY_SPOT + k++, [b.ifSpellTargeted(Spell.RITUAL_SANCTIFY, c.steps(b))]);
      }
    }
    return m;
  };
}
