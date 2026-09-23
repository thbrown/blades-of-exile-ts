/**
 * A legacy scenario's custom graphics, made into the sheets a v2 scenario has.
 *
 * The old format is one picture, `<scenario>.bmp`, ten 28×36 cells across and
 * as many rows as it needs; custom picture *n* is the cell at column n % 10,
 * row n / 10 of the whole image (`find_graphic` with `is_old` set,
 * gfxsheets.cpp:24). White is the transparent colour
 * (`createMaskFromColor(sf::Color::White)`, fileio_scen.cpp:2717).
 *
 * The v2 layout is the same grid cut into sheets of a hundred — 280×360 each —
 * so slicing the old picture every 360 rows gives sheets that index exactly as
 * it did. (`cCustomGraphics::convert_sheets`, the editor's version of this,
 * steps by 280 rows instead of 360 and so misplaces every sheet after the
 * first; the game never calls it, and neither does this.)
 */

import { Rgba } from './bmp';

const SHEET_W = 280;
const SHEET_H = 360;

export function legacySheets(image: Rgba): Rgba[] {
  const count = Math.max(1, Math.ceil(image.height / SHEET_H));
  const sheets: Rgba[] = [];
  for (let s = 0; s < count; s++) {
    const top = s * SHEET_H;
    const height = Math.min(SHEET_H, image.height - top);
    const width = Math.min(SHEET_W, image.width);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = ((top + y) * image.width + x) * 4;
        const to = (y * width + x) * 4;
        const r = image.data[from]!;
        const g = image.data[from + 1]!;
        const b = image.data[from + 2]!;
        const white = r === 255 && g === 255 && b === 255;
        data[to] = r; data[to + 1] = g; data[to + 2] = b;
        data[to + 3] = white ? 0 : 255;
      }
    }
    sheets.push({ width, height, data });
  }
  return sheets;
}
