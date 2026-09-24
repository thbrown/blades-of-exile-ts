/**
 * Exile 3's terrain art as the engine's custom sheets (`graphics/sheetN.png`,
 * 10 × 10 cells of 28×36, picture `1000 + sheet*100 + cell`).
 *
 * The sheets are laid out so that E3's own picture numbers survive:
 * E3 picture `p` < 240 is custom picture `1000 + p` (TER1 above TER2 in sheet
 * 0, TER3 above TER4 in sheet 1, TER5 in sheet 2), and E3 animation `300 + k`
 * is animated custom picture `2000 + 300 + 4k`: sheet 3 holds its four frames
 * in consecutive cells, where the engine looks for them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBmp, type Rgba } from '../../src/fileio/legacy/bmp';

const W = 28;
const H = 36;

/** E3 terrain picture → the engine's picture number. */
export function e3TerrainPic(pic: number): number {
  if (pic >= 300) return 2000 + 300 + 4 * (pic - 300);
  return 1000 + pic;
}

function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function blit(src: Rgba, sx: number, sy: number, dst: Rgba, dx: number, dy: number, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const from = ((sy + y) * src.width + sx) * 4;
    dst.data.set(src.data.subarray(from, from + w * 4), ((dy + y) * dst.width + dx) * 4);
  }
}

/** Sheets 0–3, in order. */
export function buildTerrainSheets(e3Dir: string): Rgba[] {
  const bmp = (name: string) => decodeBmp(new Uint8Array(readFileSync(join(e3Dir, `${name}.BMP`))));
  const stack = (top: Rgba, bottom: Rgba | null): Rgba => {
    const out = blank(10 * W, top.height + (bottom?.height ?? 0));
    blit(top, 0, 0, out, 0, 0, top.width, top.height);
    if (bottom) blit(bottom, 0, 0, out, 0, top.height, bottom.width, bottom.height);
    return out;
  };
  // TERANIM: 12×5 cells. Animation k is row k % 5, frames in columns
  // 4*floor(k/5) … +3 — the layout BoE's teranim kept.
  const anim = bmp('TERANIM');
  const animCount = (anim.width / W / 4) * (anim.height / H);
  const sheet3 = blank(10 * W, Math.ceil((animCount * 4) / 10) * H);
  for (let k = 0; k < animCount; k++) {
    for (let f = 0; f < 4; f++) {
      const cell = 4 * k + f;
      blit(anim, (4 * Math.floor(k / 5) + f) * W, (k % 5) * H, sheet3, (cell % 10) * W, Math.floor(cell / 10) * H, W, H);
    }
  }
  return [stack(bmp('TER1'), bmp('TER2')), stack(bmp('TER3'), bmp('TER4')), stack(bmp('TER5'), null), sheet3];
}

/**
 * Cuts every monster's frames out of MONST1–9 into custom sheets, from sheet
 * `firstSheet` on, in the order the engine reads a custom monster (the parts
 * facing left, then facing right, then the attack pose each way:
 * `monsterGraphic`). Returns the sheets and each monster's new picture number.
 *
 * MONST sheets use BoE's layout (`get_monster_template_rect`): 20 sprites a
 * sheet, sprite `r` at row `r % 10`, columns `2*floor((r%20)/10)` (facing
 * right) and `+1` (facing left), attack pose 4 columns on. White is the
 * background and becomes transparent.
 */
export function buildMonsterSheets(
  e3Dir: string, monsters: { pic: number; w: number; h: number }[], firstSheet: number,
): { sheets: Rgba[]; pics: number[] } {
  const src = Array.from({ length: 9 }, (_, i) => decodeBmp(new Uint8Array(readFileSync(join(e3Dir, `MONST${i + 1}.BMP`)))));
  const cells: { sheet: Rgba; x: number; y: number }[] = [];
  const pics: number[] = [];
  const byPic = new Map<string, number>();
  for (const m of monsters) {
    const key = `${m.pic}:${m.w}x${m.h}`;
    const seen = byPic.get(key);
    if (seen !== undefined) { pics.push(seen); continue; }
    const base = cells.length;
    const size = m.w * m.h;
    // left, right, attack-left, attack-right (monsterGraphic: +size, +2*size).
    for (const [adj] of [[1], [0], [5], [4]] as const) {
      for (let part = 0; part < size; part++) {
        const r = m.pic + part;
        const sheet = src[Math.floor(r / 20)];
        const idx = r % 20;
        if (!sheet) { cells.push({ sheet: blank(W, H), x: 0, y: 0 }); continue; }
        cells.push({ sheet, x: (2 * Math.floor(idx / 10) + adj) * W, y: (idx % 10) * H });
      }
    }
    const pic = 1000 + firstSheet * 100 + base;
    byPic.set(key, pic);
    pics.push(pic);
  }
  const sheets: Rgba[] = [];
  for (let s = 0; s * 100 < cells.length; s++) {
    const n = Math.min(100, cells.length - s * 100);
    const out = blank(10 * W, Math.ceil(n / 10) * H);
    for (let c = 0; c < n; c++) {
      const cell = cells[s * 100 + c]!;
      blit(cell.sheet, cell.x, cell.y, out, (c % 10) * W, Math.floor(c / 10) * H, W, H);
    }
    // White background → transparent.
    for (let p = 0; p < out.data.length; p += 4) {
      if (out.data[p] === 255 && out.data[p + 1] === 255 && out.data[p + 2] === 255) out.data[p + 3] = 0;
    }
    sheets.push(out);
  }
  return { sheets, pics };
}
