/**
 * Shayder (towns 4–7, one city in four states): `FUN_1078_01af`
 * (`ghidra/project/shayder.s`). Its message block is Krizsan's, 52: the town
 * dispatcher's `(t - t % 4) / 5 + 52` is 52 for all of towns 0–7.
 *
 * Most one-shot flags are town 4's whichever state is loaded (the code names
 * them by address), so each fires once for the city, not once per state.
 * Items and trapped chests use the loaded town's own, as the helpers do.
 */

import { partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';

const BLOCK = 52;
/** The Anama rings, and the parcel Irvine sends the party for. */
export const ANAMA_RINGS = partySpecItem(0x5a);
export const IRVINE_PARCEL = partySpecItem(0x5c);
/** 3 once the party has joined the Anama (talk script 130). */
export const ANAMA = f(0xac);
/** Set to 1 by Irvine (talk script 132) when he asks for the parcel. */
export const IRVINE_ASKED = f(0xc0);

export function shayder(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    /** `if (flag == 0) { steps; flag = 20 }`, E3's once-only pattern. */
    const once = (flag: [number, number], steps: Step[]): Step[] =>
      [b.ifFlagEq(flag, 0, [...steps, b.setFlag(flag, 20)])];
    /** A stair (`FUN_10c0_4a61` behind a Leave/Climb dialog); the step is refused either way. */
    const stair = (dlg: number, t: number, x: number, y: number): Step[] =>
      [b.askDialog(dlg, [b.changeTown(t, x, y)]), b.blockMove()];
    return new Map<number, Step[]>([
      // Arriving in the city.
      [1, once(f(0xad), [b.dialog(0xbe5)])],
      // A scroll tube on a bookshelf. The item is the town number + 198.
      [2, [b.giveItemDialog(0xbe6, spot(2), town + 0xc6)]],
      [3, [b.trap(0xd7a, spot(3), 0)]],
      // Breaking into the thugs' quarters brings them in, hostile.
      [7, once(f(0xb3), [b.msg(BLOCK, 0x17), b.bringIn(0xc9, 1)])],
      // Irvine's chest: the parcel, once he has asked for it.
      [8, [b.ifFlagEq(IRVINE_ASKED, 1, [b.askDialog(0xbe3, [
        b.msg(BLOCK, 0x14), b.giveSpecItem(IRVINE_PARCEL), b.setFlag(IRVINE_ASKED, 0),
      ])])]],
      // Anama members only: the ring lets you by.
      [9, [b.ifSpecItem(ANAMA_RINGS, [b.msg(BLOCK, 0xc)], [b.msg(BLOCK, 0xb), b.blockMove()])]],
      // Down to the sewers (town 96) and up from Shayder's own cellars (91).
      [11, stair(0xbe0, 0x60, 9, 0x1e)],
      [12, stair(0xbe0, 0x60, 0x19, 1)],
      [14, stair(0xd7f, 0x5b, 5, 0x18)],
      [15, stair(0xd7f, 0x5b, 0xb, 4)],
      // The ferry to Marish (village 128) for 10 gold, a day's sail. The
      // party comes out of Marish into zone (0,5).
      [18, [b.askDialog(0xbe1, [b.pay(10, [
        b.msg(BLOCK, 0xe), b.exitTo(0, 5, 0x10, 0x21), b.addAge(800), b.changeTown(0x80, 0x18, 0x2a),
      ], [b.msg(BLOCK, 0xf)])]), b.blockMove()]],
      // The tithe box: 5 gold does nothing, good or bad.
      [20, [b.askDialog(0xbe2, [b.pay(5, [b.msg(BLOCK, 0x12)], [b.log(0x1078, 0x181)])], [b.msg(BLOCK, 0x13)])]],
      // The altar heals and cures disease, for members.
      [21, [b.askDialog(0xbe4, [b.ifFlagEq(ANAMA, 3, [
        b.msg(BLOCK, 0x1b), b.heal(200), b.cureDiseaseAll(),
      ], [b.msg(BLOCK, 0x16)])])]],
      // The plague: everyone is diseased, once.
      [22, once(f(0xb6), [b.msg(BLOCK, 0x1f), b.diseaseAll(5)])],
    ]);
  };
}
