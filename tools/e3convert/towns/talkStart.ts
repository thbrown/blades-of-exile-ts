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
 * The rest of `FUN_1020_1484`'s cases (`1020:1512`–`16a8`), also behind
 * the hostile test. Three are in Gale, and never open a conversation (each
 * ends at `1020:1b6e`, the function's return):
 * - **A townsperson** (337, whose talk record is placeholder text for that
 *   reason) wants hush money, dialog 0xc60. Paying is 0x37:0x17 and 100 gold,
 *   or all the party has when it has less (`FUN_1070_0623` again with the
 *   gold); refusing is 0x37:0x18, and the guards come (`GALE_ESCORT`).
 * - **Mayor Rali** (322) and **Leona** (323) brush the party off (0xc5c,
 *   0xc5e) until it is known (0xc94, set by the plot that hands over
 *   Prazac's scroll); then each says leave (0xc5d, 0xc5f), and the guards
 *   come.
 *
 * `GALE_ESCORT` (party+0x14b) is the guards' countdown, 25 turns: the
 * engine runs it (`e3GaleTick`, from `FUN_10c0_61c4`), and its end is the
 * `escort` feature flag's node (emit.ts).
 *
 * The other three open their conversation after a dialog:
 * - **Rentar-Ihrno** (47), once (0xc09), once the party has handed in the
 *   crystal's shards (0xc9e, `talkScripts.ts`) or holds special item 28:
 *   dialog 0xd55, asking her about the crystal.
 * - **General Baziron** (354), given the Dervish's scroll (special item 49):
 *   dialog 0x1217, the scroll taken, 5 experience each (`FUN_10b0_1ff2`,
 *   `award_xp` for every PC whose status is 1) and 200 gold. E3 never marks
 *   the Dervish's camp delivered, so its welcome back can't be reached
 *   (E3-SUSPECTED-BUGS.md #5); the fix marks it here.
 * - **Bon-Ihrno** (372), once (party+0x4cd): dialog 0xffc.
 *
 * Numbers here are E3's, 1-based; the engine's are one less (none is a
 * shopkeeper, so none is cloned, `talk.ts`).
 */

import { partyFlag as f, partySpecItem, zoneSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';
import { TROGLO_STAGE } from './castleTroglo';

const SELES = 41;
const ANAXIMANDER = 20;
const VOTHKARO = 268;
const RENTAR_IHRNO = 0x2f;
const RALI = 0x142;
const LEONA = 0x143;
const EXTORTIONER = 0x151;
const BAZIRON = 0x162;
const BON_IHRNO = 0x174;

/** Gale's guards' countdown, in turns (party+0x14b): `e3GaleTick`. */
export const GALE_ESCORT: Flag = f(0x14b);
/** The plot has made the party known in Gale (`talkScripts.ts`, `town21.ts`). */
const KNOWN_IN_GALE = f(0xc94);
/** The Dervish's scroll for Baziron (`zones.ts`, zone 23). */
const DERVISH_SCROLL = partySpecItem(0x6e);
/** The Dervish's camp: 1 carrying the scroll, 2 delivered, 3 refused. */
const DERVISH_CAMP = zoneSpotFlag(23, 5);

/** What a creature of E3 personality `p`, in town slot `slot`, does as a conversation starts, or null. */
export function e3TalkStart(b: SpecBuilder, p: number, slot: number): Step[] | null {
  /** After E3's hostile test: a hostile creature (odd attitude) skips it all. */
  const friendly = (steps: Step[]): Step[] =>
    [b.ifCreature(slot, { attitude: 1 }, [], [b.ifCreature(slot, { attitude: 3 }, [], steps)])];
  const guardsCome = b.setFlag(GALE_ESCORT, 25);
  switch (p) {
    case VOTHKARO:
      return friendly([
        b.ifFlagBelow(TROGLO_STAGE, 4, [b.askDialog(0xcd8, [b.setFlag(TROGLO_STAGE, 4)], [b.msg(57, 0x7b), b.blockMove()])]),
      ]);
    case EXTORTIONER:
      // Not `pay`: that says "You give up 100 gold.", and E3 doesn't. A
      // take stops at nothing, which is E3's second `FUN_1070_0623`.
      return friendly([b.askDialog(0xc60, [b.msg(0x37, 0x17), b.takeGold(100)], [b.msg(0x37, 0x18), guardsCome]),
        b.blockMove()]);
    case RALI:
    case LEONA: {
      const [stranger, known] = p === RALI ? [0xc5c, 0xc5d] : [0xc5e, 0xc5f];
      return friendly([b.ifFlagEq(KNOWN_IN_GALE, 0, [b.dialog(stranger)], [b.dialog(known), guardsCome]), b.blockMove()]);
    }
    case RENTAR_IHRNO: {
      const tell = [b.dialog(0xd55), b.setFlag(f(0xc09), 1)];
      return friendly([b.ifFlagEq(f(0xc09), 0, [b.ifFlagAtLeast(f(0xc9e), 1, tell, [b.ifSpecItem(partySpecItem(0x44), tell)])])]);
    }
    case BAZIRON:
      return friendly([b.ifSpecItem(DERVISH_SCROLL, [
        b.dialog(0x1217), b.takeSpecItem(DERVISH_SCROLL), b.wholeParty(), b.xp(5), b.gold(200),
        b.ifFixed(5, [b.setFlag(DERVISH_CAMP, 2)], []),
      ])]);
    case BON_IHRNO:
      return friendly([b.ifFlagEq(f(0x4cd), 0, [b.dialog(0xffc), b.setFlag(f(0x4cd), 1)])]);
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
