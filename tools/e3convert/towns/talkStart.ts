/**
 * Two personalities E3 swaps as a conversation starts (`FUN_1020_1484`,
 * DIVERGENCES.md #29). The engine's hook is the creature's HAIL special
 * (`<ontalk>`), which runs before the conversation opens and has it held as
 * another personality (`SpecBuilder.talkAs`).
 *
 * - **Seles** (41) is 46 once the portal plot has begun (0xc91): she stands
 *   before a portal that "flickers ominously". E3 changes the personality
 *   it was called with, so her name and opening words change too.
 * - **Anaximander** (20) grows weary (19) once any of 0xc85, 0xc87 or 0xc8a
 *   is set — the slime, the Filth Factory, the troglodyte war. E3 swaps its
 *   copy (`[0x499a]`) after taking the title and opening look from the
 *   personality it was called with (`1020:183c`, `18a6`), so the talk
 *   screen still opens on the plain "fidgety, nervous man"; Look, Name, Job
 *   and every keyword answer as the weary one. Personality 19 has no name
 *   of its own, which is why that matters.
 *
 * Numbers here are E3's, 1-based; the engine's are one less (neither is a
 * shopkeeper, so neither is cloned, `talk.ts`).
 */

import { partyFlag as f, type SpecBuilder, type Step } from '../script';

const SELES = 41;
const ANAXIMANDER = 20;

/** What a creature of E3 personality `p` does as a conversation starts, or null. */
export function e3TalkStart(b: SpecBuilder, p: number): Step[] | null {
  switch (p) {
    case SELES:
      return [b.ifFlagAtLeast(f(0xc91), 1, [b.talkAs(46 - 1, false)])];
    case ANAXIMANDER: {
      const weary = [b.talkAs(19 - 1, true)];
      return [b.ifFlagAtLeast(f(0xc85), 1, weary,
        [b.ifFlagAtLeast(f(0xc87), 1, weary, [b.ifFlagAtLeast(f(0xc8a), 1, weary)])])];
    }
    default:
      return null;
  }
}
