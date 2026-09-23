/**
 * Terrain picture → sheet/cell resolution, from place_road/draw code in
 * ../exile-wasm/src/game/boe.graphutil.cpp:79-103:
 *   pic <  960: sheet ter(1 + pic/50), cell pic%50
 *   pic >= 960 && < 1000: teranim, col 4*((pic-960)/5) + frame, row (pic-960)%5
 *   pic >= 1000: the scenario's own sheets (`customPics.ts`), and from 2000
 *   the same four-frame animation from a custom base cell
 */

import { Rect } from '../core/location';
import { customGraphic } from './customPics';
import { calcRect } from './sheets';

export interface TerGraphic {
  sheetName: string;
  rect: Rect;
}

export function terrainGraphic(pic: number, animFrame = 0): TerGraphic | null {
  // `draw_one_terrain_spot` (boe.graphutil.cpp:86).
  if (pic >= 2000) return customGraphic(pic - 2000 + (animFrame % 4));
  if (pic >= 1000) return customGraphic(pic - 1000);
  if (pic >= 960) {
    const n = pic - 960;
    return {
      sheetName: 'teranim',
      rect: calcRect(4 * Math.floor(n / 5) + (animFrame % 4), n % 5),
    };
  }
  const sheet = 1 + Math.floor(pic / 50);
  const cell = pic % 50;
  return { sheetName: `ter${sheet}`, rect: calcRect(cell % 10, Math.floor(cell / 10)) };
}
