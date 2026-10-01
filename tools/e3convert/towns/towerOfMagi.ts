/**
 * The Tower of Magi (towns 24 and 25): `FUN_1078_1e05` for the tower as the
 * party first finds it, message block 56, and `FUN_1078_222d` for the tower
 * overrun by demons, block 57, where Linda, the arch-mage, has become the
 * demon Grah-Hoth's gate.
 *
 * Cutting the gate is the end of E3's demon plot: flag 0xc91 goes to 3, the
 * plot's countdown stops (party+0x850f to 0; `towns/plot.ts`), and the four
 * saved towns are forgotten (party+0x29a6 + 0x1594k, set to 200).
 */

import { Skill } from '../../../src/universe/skills';
import { partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';

/**
 * What the party did at L1's tithe box: 1 gave, 2 stole, 3 has prayed at
 * the altar since. It is town 24's spot flag 8, which no spot uses.
 */
const TITHE = f(0x17c);
/** The Blessed Athame, which cuts Linda's gate. */
const ATHAME = partySpecItem(0x52);
/** E3's demon plot: 3 once the gate is cut. */
export const DEMON_PLOT = f(0xc91);
/**
 * Its countdown (party+0x850f, a word) as two converter flags, hundreds and
 * units (`SpecBuilder.turnCountdown`), in row 292, which E3 never uses.
 */
export const DEMON_COUNT_HI: [number, number] = [292, 10];
export const DEMON_COUNT_LO: [number, number] = [292, 11];

/** `FUN_10c0_4a61(40, 5, 41)`: through the portal to the Portal Fortress. */
function toPortalFortress(b: SpecBuilder): Step {
  return b.changeTown(40, 5, 0x29);
}

/**
 * The book on the pedestal (spot 15 on both levels; L2's code names block
 * 56 outright). It teaches Major Summoning to a party of 14 levels between
 * them, and takes 20 experience from each PC who has more than 20.
 */
function orvidsBook(b: SpecBuilder): Step[] {
  return [b.askDialog(0xcad, [b.ifMageLoreTotal(14, [
    b.msg(56, 0x51), b.teachSpell(0x3a),
    b.eachPc(() => [b.ifStat(Skill.CUR_XP, 21, [b.drainXp(20)])]),
  ], [b.msg(56, 0x52)])])];
}

export function towerOfMagi(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    if (town === 24) {
      const B = 56;
      /** `n` intelligence for every PC that passes `test`, as the altar gives it. */
      const eachInt = (n: number, test: (then: Step[]) => Step): Step =>
        b.eachPc(() => [test([b.addStat(Skill.INTELLIGENCE, n)])]);
      return new Map<number, Step[]>([
        [1, [b.onceMsg(spot(1), B, 0x48)]],
        // The silver amulet Denise told of; L2's spot 6 shares the flag.
        [2, [b.giveItemDialog(0xcaa, spot(2), 0, 330)]],
        [3, [b.giveItemDialog(0xcac, spot(3), 0xca)]],
        // The tithing box: Leave, Give 5 gold, or Steal, which takes nothing
        // but is remembered at the altar (spot 17). Every answer refuses
        // the step.
        [4, [b.choiceDialog(0xcae,
          [b.pay(5, [b.setFlag(TITHE, 1), b.msg(B, 0x5d)], [b.log(0x1078, 0x1dee)])],
          [b.msg(B, 0x5e), b.setFlag(spot(4), 20), b.ifFlagEq(TITHE, 0, [b.setFlag(TITHE, 2)])]),
        b.blockMove()]],
        [11, [b.askDialog(0xca8, [b.msg(B, 0x45), toPortalFortress(b)])]],
        [12, [b.msg(B, 0x47), b.blockMove()]],
        [14, [b.msg(B, 0x4b), b.blockMove()]],
        [15, orvidsBook(b)],
        [16, [b.askDialog(0xca9, [b.msg(B, 0x53), b.heal(200), b.restoreSp(0x96), b.addAge(500)])]],
        // The altar judges the tithe: a thief loses 2 intelligence (down to
        // 2), a giver gains 2 (up to 15), once.
        [17, [b.askDialog(0xcab, [b.ifFlagEq(TITHE, 2, [
          b.msg(B, 0x60), b.setFlag(TITHE, 3),
          eachInt(-2, (then) => b.ifStat(Skill.INTELLIGENCE, 3, then)),
        ], [b.ifFlagEq(TITHE, 1, [
          b.msg(B, 0x5a), b.setFlag(TITHE, 3),
          eachInt(2, (then) => b.ifStat(Skill.INTELLIGENCE, 15, [], then)),
        ], [b.msg(B, 0x5f)])])])]],
        [20, [b.msg(B, 0x49), b.blockMove()]],
      ]);
    }
    const B = 57;
    return new Map<number, Step[]>([
      [1, [b.dialog(0xcb2), b.bringIn(200, 1), b.setFlag(spot(1), 20)]],
      // Linda's gate: OK, Attack or Step In. Only the athame cuts it.
      [2, [b.choiceDialog(0xcb3,
        [b.ifSpecItem(ATHAME, [
          b.setTer(0xc, 0xb, 0), b.dialog(0xcb4), b.journal(0x13),
          b.xp(50), b.setFlag(DEMON_PLOT, 3), b.setFlag(DEMON_COUNT_HI, 0), b.setFlag(DEMON_COUNT_LO, 0),
          b.forgetTowns(), toPortalFortress(b),
        ], [b.msg(B, 0x17)])],
        [b.msg(B, 0x18), b.slayParty(0)],
        [b.blockMove()])]],
      // The altar: the athame first (flag (25,6)), which brings the demons
      // in, and afterwards one blessing.
      [3, [b.ifFlagEq(spot(6), 0, [
        b.giveItemDialog(0xcb6, spot(6), 0, 335),
        b.ifFlagAtLeast(spot(6), 1, [b.msg(B, 0x16), b.bringIn(201, 1)]),
      ], [b.askDialog(0xcb7, [b.ifFlagEq(spot(4), 0, [
        b.msg(B, 0x11), b.setFlag(spot(4), 1), b.restoreSp(0x28), b.heal(0x3c),
      ], [b.msg(B, 0x12)])])])]],
      [6, [b.giveItemDialog(0xcaa, townSpotFlag(24, 2), 0, 330)]],
      [11, [b.msg(B, 0xb), b.blockMove()]],
      [12, [b.askDialog(0xcb5, [b.msg(B, 0xe), b.slayParty(2)])]],
      [15, orvidsBook(b)],
      // 16 has no case in L2's switch: nothing happens.
      [16, []],
    ]);
  };
}
