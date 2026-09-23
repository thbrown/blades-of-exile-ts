/**
 * The party sprite on the terrain view — draw_party_symbol
 * (boe.graphutil.cpp:446). Pics under 100 come from pcs.png in a 2-column-per
 * -graphic layout; 100..999 borrow a monster graphic; 1000+ are the
 * scenario's own (`customPics.ts`), and from 10000 the party's.
 */

import { Direction, Rect } from '../core/location';
import { monsterGraphic } from './monsterPics';
import { customGraphic } from './customPics';
import { calcRect } from './sheets';

export interface PcGraphic {
  sheetName: string;
  rect: Rect;
}

/**
 * `attacking` is `draw_combat_pc`'s third argument (boe.graphutil.cpp:221) —
 * `combat_posing_monster == get_target_i(pc)`, i.e. this PC is mid-swing.
 *
 * The two layouts move it differently. A borrowed monster graphic adds **10 to
 * the mode**, which `monsterGraphic` turns into four columns along; the pcs
 * sheet offsets the source rect by **(0, 288)** — eight rows of 36 — because
 * its attack poses sit in a second block below the standing ones.
 */
export function pcGraphic(
  pic: number, direction: Direction, attacking = false,
): PcGraphic | null {
  // Facing: directions S and beyond (>= 4) use the mirrored column.
  const facingRight = direction >= Direction.S;
  if (pic >= 1000) return customGraphic(pic % 1000, pic >= 10000);
  if (pic >= 100) {
    return monsterGraphic(pic - 100, (facingRight ? 1 : 0) + (attacking ? 10 : 0), 0);
  }
  const rect = calcRect(2 * Math.floor(pic / 8) + (facingRight ? 1 : 0), pic % 8);
  if (!attacking) return { sheetName: 'pcs', rect };
  return {
    sheetName: 'pcs',
    rect: new Rect(rect.top + 288, rect.left, rect.bottom + 288, rect.right),
  };
}
