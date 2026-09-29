/**
 * Gale (towns 16–19, one city in four states): `FUN_1078_07f1`. Its
 * message block is 55.
 */

import { partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';

const BLOCK = 55;
/** The electrum key, which opens a door in the city. */
export const ELECTRUM_KEY = partySpecItem(0x32);

export function gale(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    /** A book in the library that needs `levels` between the PCs to read. */
    const book = (levels: number, read: Step[]): Step[] =>
      [b.ifLevelTotal(levels, read, [b.msg(BLOCK, 0x1c)])];
    return new Map<number, Step[]>([
      // The closed gates. The spot's own flag goes to 20, so it says this
      // once a state.
      [1, [b.msg(BLOCK, 1, 2), b.setFlag(spot(1), 20)]],
      [2, [b.trap(0x107e, spot(2), 11)]],
      [3, [b.trap(0x107e, spot(3), 11)]],
      [4, [b.trap(0x107e, spot(4), 11)]],
      [5, [b.trap(0x107c, spot(5), 11)]],
      [6, [b.ifFlagEq(f(0x12a), 0, [b.dialog(0xc5a), b.setFlag(f(0x12a), 1)])]],
      [7, [b.ifFlagEq(f(0x12b), 0, [b.giveItemDialog(0xc5b, f(0x12b), 0x17c)])]],
      // A door with a keyhole: the electrum key opens it (terrain 106 to 103).
      [11, [b.ifTer(0x1b, 0x33, 0x6a, [
        b.ifSpecItem(ELECTRUM_KEY, [b.msg(BLOCK, 0x20), b.setTer(0x1b, 0x33, 0x67)], [b.msg(BLOCK, 0x1f)]),
      ])]],
      // A secret door with an alarm on it.
      [12, [b.msg(BLOCK, 0xe), b.makeTownHostile()]],
      // The tunnel under the walls, and back.
      [14, [b.askDialog(0xc58, [b.msg(BLOCK, 7), b.moveParty(8, 0x38)]), b.blockMove()]],
      [15, [b.askDialog(0xc58, [b.moveParty(0x38, 8)]), b.blockMove()]],
      // A concealed door, once flag 0x136 says where; not on horseback.
      [16, [b.ifFlagEq(f(0x136), 0, [b.msg(BLOCK, 0x1d)], [b.askDialog(0xc58, [
        b.ifOnHorse([b.log(0x1078, 0x7d9)], [
          b.ifFlagAtLeast(f(0xc8c), 1, [b.msg(BLOCK, 0x1b)]), b.moveParty(0x34, 0xe),
        ]),
      ])]), b.blockMove()]],
      // Gale's library: books for parties of enough experience.
      [20, book(15, [b.msg(BLOCK, 9), b.learnAlchemy(13)])],
      [21, book(12, [b.msg(BLOCK, 10), b.teachSpell(0x33)])],
      // E3 shows string 12 here, the start of Pachtar's book (spot 23),
      // rather than a spell book's; kept (E3-SUSPECTED-BUGS.md #2), and
      // string 11, Mass Paralysis's own, under "Fix known bugs".
      [22, book(17, [b.ifFixed(2, [b.msg(BLOCK, 0xb)], [b.msg(BLOCK, 0xc)]), b.teachSpell(0x38)])],
      // Pachtar's book puts the drake lair (town 74) on the map.
      [23, book(17, [b.msg(BLOCK, 0xc, 0xd), b.townVisible(74)])],
      // The skiff to the ruined island (village 164), once its owner agrees.
      [24, [b.ifFlagEq(f(0x12c), 0, [b.msg(BLOCK, 0x10)], [b.askDialog(0xc59, [
        b.msg(BLOCK, 0x11), b.exitTo(5, 2, 0x4a, 0x42), b.changeTown(0xa4, 0x18, 6),
      ])])]],
    ]);
  };
}
