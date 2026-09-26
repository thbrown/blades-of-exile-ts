/**
 * Lorelei (towns 12–15, one city in four states): `FUN_1078_0561`. Its
 * message block is 54. Every flag is town 12's by address, so each spot
 * fires once for the city.
 */

import { partyFlag as f, partySpecItem, type SpecBuilder, type Step } from '../script';
import { ANAMA_RINGS } from './shayder';

const BLOCK = 54;
/** The deed to Hawke's Manse (town 102), the party's house. */
export const MANSE_DEED = partySpecItem(0x2a);

export function lorelei(_town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    /** `if (flag == 0) { steps; flag = 20 }`. */
    const once = (flag: [number, number], steps: Step[]): Step[] =>
      [b.ifFlagEq(flag, 0, [...steps, b.setFlag(flag, 20)])];
    const trap = (flag: [number, number], dlg: number): Step[] => [b.ifFlagEq(flag, 0, [b.trap(dlg, flag, 20)])];
    return new Map<number, Step[]>([
      // The gates, as Sharimik's: turned away until a mission for the fort is
      // reported (flags 0xc85, 0xc87), then the greeting once.
      [1, [b.ifFlagEq(f(0xfd), 0, [b.ifFlagEq(f(0xc85), 0, [
        b.ifFlagEq(f(0xc87), 0, [b.dialog(0xc30), b.blockMove()], [b.dialog(0xc31), b.setFlag(f(0xfd), 1)]),
      ], [b.dialog(0xc31), b.setFlag(f(0xfd), 1)])])]],
      [2, trap(f(0xfe), 0x107c)],
      [3, trap(f(0xff), 0x107d)],
      [4, [b.onceMsg(f(0x100), BLOCK, 10)]],
      [5, trap(f(0x101), 0x107d)],
      // Giants in the ruined corners of town.
      [6, once(f(0x102), [b.msg(BLOCK, 0xd), b.bringIn(200, 1)])],
      [7, once(f(0x103), [b.msg(BLOCK, 0xf), b.bringIn(0xc9, 1)])],
      // A dead soldier's greatsword; afterwards, only the body.
      [8, [b.ifFlagEq(f(0x104), 0, [b.giveItemDialog(0xc33, f(0x104), 0x42)], [b.log(0x1078, 0x526)])]],
      // Hawke's Manse: locked, until the party holds the deed.
      // TODO(E3-3): in combat E3 says "Can't enter manse while in combat."
      // (1078:053e); the engine's stair refuses with its own words.
      [11, [b.ifSpecItem(MANSE_DEED, [b.askDialog(0xc32, [b.changeTown(0x66, 0x1a, 0x10)])], [b.msg(BLOCK, 1, 2)]),
        b.blockMove()]],
      // The Anama temple lets in members only.
      [12, [b.ifSpecItem(ANAMA_RINGS, [b.msg(BLOCK, 4)], [b.msg(BLOCK, 3), b.blockMove()])]],
      [14, [b.dialog(0xc34)]],
    ]);
  };
}
