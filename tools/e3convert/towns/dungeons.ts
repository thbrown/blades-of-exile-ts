/**
 * Exile 3's smaller places, each a short switch of its own: one function
 * per town, named for it, with its E3 handler (FORMATS.md, "Town script
 * handlers") and message block.
 */

import type { PlaceScript } from '../specials';
import { townSpotFlag, type SpecBuilder, type Step } from '../script';

/** Blackcrag Fortress (town 34): `FUN_1078_4918`, block 58. */
function blackcrag(b: SpecBuilder): Map<number, Step[]> {
  const B = 58, spot = (id: number) => townSpotFlag(34, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x23)]],
    [2, [b.onceMsg(spot(2), B, 0x24, 0x25)]],
    // The guards who let the party in were an ambush.
    [3, [b.msg(B, 0x28), b.bringIn(200, 1), b.setFlag(spot(3), 20)]],
    [11, [b.ifFlagEq(spot(9), 0, [b.setFlag(spot(9), 1), b.dialog(0xd0c)])]],
    [12, [b.msg(B, 0x22), b.blockMove()]],
    [14, [b.askDialog(0xd0d, [b.changeTown(0x3d, 5, 4)]), b.blockMove()]],
  ]);
}

export const DUNGEON_SCRIPTS = new Map<number, PlaceScript>([
  [34, blackcrag],
]);
