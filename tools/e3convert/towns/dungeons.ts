/**
 * Exile 3's smaller places, each a short switch of its own: one function
 * per town, named for it, with its E3 handler (FORMATS.md, "Town script
 * handlers") and message block.
 */

import type { PlaceScript } from '../specials';
import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

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

/**
 * Which end of the Great Walls the party came in by: 0 not yet known, 1 west,
 * 2 east. E3 reads the party's outdoor zone column (party+0x12e2) instead,
 * which no node can; the first end column crossed after entering says the
 * same, since each town entrance lies outside its end's column. The town's
 * entry script clears it (`towns/entry.ts`).
 */
export const WALLS_SIDE: Flag = [291, 23];

/** The Great Walls (town 37): `FUN_1078_52ae`, block 59. */
function greatWalls(b: SpecBuilder): Map<number, Step[]> {
  const B = 59, spot = (id: number) => townSpotFlag(37, id);
  /** Erika's amulets break the walls open, once, if the story is ready (flags 0x262 and 0x263). */
  const amuletsReady = (then: Step[], otherwise: Step[] = []): Step =>
    b.ifSpecItem(partySpecItem(0x54), [b.ifFlagAtLeast(f(0x262), 3, [b.ifFlagEq(f(0x263), 0, then, otherwise)], otherwise)], otherwise);
  return new Map<number, Step[]>([
    [1, [amuletsReady([b.onceMsg(spot(1), B, 0x20)], [b.onceMsg(spot(1), B, 0x21)])]],
    [2, [amuletsReady([
      b.msg(B, 0x22), b.setTer(0x17, 0x20, 0), b.setTer(0x17, 0x1f, 0x8f), b.setTer(0x17, 0x21, 0x8f),
      b.setFlag(spot(2), 20), b.setFlag(spot(4), 20),
    ])]],
    ...[3, 5, 6].map((id): [number, Step[]] => [id, [b.trap(0xd2a, spot(id), 0x14)]]),
    [4, [b.onceMsg(spot(4), B, 0x23), ...[0, 1, 2, 3].map(() => b.wanderingMonster())]],
    // The two ends of the tunnel: out the far side, if the party came in by the other.
    [11, [b.onceMsg(spot(0), B, 0x1e, 0x1f), b.ifFlagEq(WALLS_SIDE, 0, [b.setFlag(WALLS_SIDE, 1)],
      [b.ifFlagEq(WALLS_SIDE, 2, [b.exitTo(3, 0, 8, 9)])])]],
    [12, [b.ifFlagEq(WALLS_SIDE, 0, [b.setFlag(WALLS_SIDE, 2)],
      [b.ifFlagEq(WALLS_SIDE, 1, [b.exitTo(7, 0, 0xd, 3)])])]],
    [14, [b.askDialog(0xd2b, [b.msg(B, 0x26), b.drainXp(10)])]],
    [15, [b.askDialog(0xd2b, [b.msg(B, 0x27), b.teachSpell(0x24)])]],
    [16, [b.ifTer(0x37, 0x1f, 0x8c, [
      b.msg(B, 0x28), ...[0x1f, 0x20, 0x21, 0xd].map((y) => b.setTer(0x37, y, 0x8d)),
    ])]],
  ]);
}

export const DUNGEON_SCRIPTS = new Map<number, PlaceScript>([
  [34, blackcrag],
  [37, greatWalls],
]);
