/**
 * Krizsan (towns 0–3, one town in four states): `FUN_1078_0000`
 * (`ghidra/project/krizsan.s`). Every state shares the code; the spots each
 * state has decide which parts run.
 */

import { townSpotFlag, type SpecBuilder, type Step } from '../script';

/** Krizsan's message block, `(t - t % 4) / 5 + 52`. */
const BLOCK = 52;

export function krizsan(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    // Spots 1, 2 and 5 read and write **town 0's** flags (party+0x85, 0x86,
    // 0x89, constants in the code) whichever state Krizsan is in; the
    // chests (3, 4, 6) use the state's own, `town * 10 + id`. So the
    // welcome and the 300 gold are once for all four states.
    const k0 = (id: number) => townSpotFlag(0, id);
    const done0 = (id: number) => b.setFlag(k0(id), 20);
    return new Map<number, Step[]>([
      [1, [b.ifFlagEq(k0(1), 0, [b.dialog(3000), done0(1)])]],
      // A dialog whose second choice burns everyone for 25 (FUN_10b0_958e, type 1).
      [2, [b.askDialog(3001, [b.msg(BLOCK, 1), done0(2), b.damageAll(25, 1)])]],
      // Trapped chests: kind 31 is a strong kind 11.
      [3, [b.trap(0xbba, spot(3), 31)]],
      [4, [b.trap(0xbba, spot(4), 31)]],
      [5, [b.ifFlagEq(k0(5), 0, [b.askDialog(0xbbb, [b.msg(BLOCK, 0x26), b.gold(300), done0(5)])])]],
      [6, [b.giveItemDialog(0xbbd, spot(6), 0x142)]],
      [11, [b.dialog(0xbbc)]],
    ]);
  };
}
