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
 * - **King Vothkaro** (268), until Castle Troglo's story reaches 4, asks
 *   whether the party has read the scroll (dialog 0xcd8, `FUN_10e0_0097`):
 *   yes moves the story to 4 and the conversation opens; no is a line of
 *   block 57 and no conversation (`1020:14bf`). E3 asks after its hostile
 *   test, so a hostile king (odd attitude) isn't asked.
 *
 * TODO(E3-talkstart): the rest of `FUN_1020_1484`'s cases (`1020:1512`–
 * `16a8`), none of them ported:
 * - 0x151 asks dialog 0xc60. Its first button: message (0x37, 0x18) and
 *   party+0x14b = 0x19 (not identified). Otherwise: message (0x37, 0x17)
 *   and a charge of 100 gold, or all the party's gold if it has less.
 * - 0x142 and 0x143 show dialog 0xc5c / 0xc5e while flag 0xc94 is clear,
 *   and 0xc5d / 0xc5f, with party+0x14b = 0x19, once it is set.
 * - 0x2f, once (flag 0xc09), if 0xc9e or party+0x44 is set: dialog 0xd55.
 * - 0x162, General Baziron, holding the Dervish's scroll (special item at
 *   party+0x6e): dialog 0x1217, takes the scroll, `FUN_10b0_1ff2(5)` (not
 *   identified) and 200 gold. E3-SUSPECTED-BUGS #5's fix goes here.
 * - 0x174, once (party+0x4cd): dialog 0xffc.
 *
 * Numbers here are E3's, 1-based; the engine's are one less (neither is a
 * shopkeeper, so neither is cloned, `talk.ts`).
 */

import { partyFlag as f, type SpecBuilder, type Step } from '../script';
import { TROGLO_STAGE } from './castleTroglo';

const SELES = 41;
const ANAXIMANDER = 20;
const VOTHKARO = 268;

/** What a creature of E3 personality `p`, in town slot `slot`, does as a conversation starts, or null. */
export function e3TalkStart(b: SpecBuilder, p: number, slot: number): Step[] | null {
  switch (p) {
    case VOTHKARO:
      return [b.ifCreature(slot, { attitude: 1 }, [], [b.ifCreature(slot, { attitude: 3 }, [], [
        b.ifFlagBelow(TROGLO_STAGE, 4, [b.askDialog(0xcd8, [b.setFlag(TROGLO_STAGE, 4)], [b.msg(57, 0x7b), b.blockMove()])]),
      ])])];
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
