/**
 * Monster graphic resolution — get_monster_template_rect
 * (boe.graphutil.cpp:514) + the monst-sheet split (20 sprites per sheet,
 * sheet = monst{1 + (i+part)/20}).
 *
 * mode: 0 = facing left(default pose, adj+1), 1 = facing right; +10 = attack pose.
 */

import { Rect } from '../core/location';
import { M_PIC_INDEX } from './mPicIndex';
import { customGraphic } from './customPics';
import { calcRect } from './sheets';

export interface MonstGraphic {
  sheetName: string;
  rect: Rect;
}

export function monsterDims(pic: number): { w: number; h: number } {
  const entry = M_PIC_INDEX[pic];
  if (!entry) return { w: 1, h: 1 };
  return { w: entry[1], h: entry[2] };
}

/**
 * `size` is the monster's width × height in squares. It only matters for a
 * custom picture (1000 and up), whose cells run part by part, then the other
 * facing, then the attack pose (boe.graphutil.cpp:188): `pic % 1000 + part`,
 * plus `size` facing right, plus `2 * size` mid-swing. From 10000 it would
 * be the party's own sheet, which this port doesn't carry.
 */
export function monsterGraphic(pic: number, mode = 0, part = 0, size = 1): MonstGraphic | null {
  if (pic >= 1000) {
    let need = (pic % 1000) + part;
    if (mode % 10 === 1) need += size;
    if (mode >= 10) need += 2 * size;
    return customGraphic(need, pic >= 10000);
  }
  const entry = M_PIC_INDEX[pic];
  if (!entry) return null;
  let adj = 0;
  if (mode >= 10) {
    adj += 4;
    mode -= 10;
  }
  if (mode === 0) adj++;
  const raw = entry[0] + part;
  const idx = raw % 20;
  return {
    sheetName: `monst${1 + Math.floor(raw / 20)}`,
    rect: calcRect(2 * Math.floor(idx / 10) + adj, idx % 10),
  };
}
