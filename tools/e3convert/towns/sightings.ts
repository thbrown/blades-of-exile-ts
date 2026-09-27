/**
 * First sightings (`FUN_1060_0a1e`): the first time the party sees one of the
 * monster plagues, E3 says what it is and sets the flag Anaximander's reports
 * wait for (`towns/town21.ts`). E3 calls it from `draw_monsters`
 * (`FUN_1060_032d`) for every creature drawn in town or combat, and guards
 * each with its own flag.
 *
 * The engine's hook is the monster's `<onsight>` special (OBoE's
 * `see_spec`), which fires once per kind of monster; the scenario flag
 * `monster-sightings` = `exile3` makes it fire in combat too, as E3's does.
 * BoE 1997's `check_if_monst_seen` (GUTILS.CPP:1034) is this function with
 * its cases taken out.
 */

import { partyFlag as f, type SpecBuilder, type Step } from '../script';

interface Sighting {
  /** E3's monster numbers, inclusive. */
  first: number;
  last: number;
  /** The flag that makes it once only. */
  once: number;
  /** A report flag set as well, where it is not `once` itself. */
  also?: number;
  /** The message: block and string (`FUN_1008_37de`). */
  msg: [number, number];
  /** The events-journal entry, added before the message; the giant has none. */
  journal?: number;
}

/** In the order E3 tests them. */
const SIGHTINGS: Sighting[] = [
  { first: 0x8a, last: 0x8d, once: 0x371, also: 0xc83, msg: [0x57, 0x1f], journal: 4 }, // the slimes
  { first: 0x95, last: 0x9a, once: 0xc88, msg: [0x56, 0xc], journal: 9 }, // troglodytes
  { first: 0x8f, last: 0x94, once: 0xc86, msg: [0x44, 0x11], journal: 7 }, // cockroaches
  { first: 0x9b, last: 0x9e, once: 0xc89, msg: [0x54, 1], journal: 0xa }, // hill giants
  { first: 0x9f, last: 0xa3, once: 0xc8b, msg: [0x3d, 0x50], journal: 0xc }, // golems
  { first: 0xa6, last: 0xa7, once: 0xc8d, msg: [0x3d, 0x51], journal: 0xe }, // the alien beasts
  { first: 0x39, last: 0x39, once: 0x385, msg: [0x3f, 0x29] }, // the mutant giant
];

/** Each monster's sighting script, by E3 monster number. */
export function sightingScripts(b: SpecBuilder): Map<number, Step[]> {
  const out = new Map<number, Step[]>();
  for (const s of SIGHTINGS) {
    const steps: Step[] = [b.ifFlagEq(f(s.once), 0, [
      b.setFlag(f(s.once), 1),
      ...(s.also !== undefined ? [b.setFlag(f(s.also), 1)] : []),
      ...(s.journal !== undefined ? [b.journal(s.journal)] : []),
      b.msg(s.msg[0], s.msg[1]),
    ])];
    for (let m = s.first; m <= s.last; m++) out.set(m, steps);
  }
  return out;
}
