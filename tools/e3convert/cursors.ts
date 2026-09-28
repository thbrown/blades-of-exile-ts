/**
 * Exile III's mouse cursors, which are Win16 cursor resources in EXILE3.EXE,
 * as the PNGs the engine shows in place of its own (the `cursors` scenario
 * flag, `src/platform/cursors.ts`).
 *
 * EXILE3.EXE has fourteen, numbered as 1997's `LoadCursor` calls number them
 * (BLADES.CPP): the arrows `100 + dx + 10 × dy`, so 89 to 111 with 100 the
 * middle, then sword 120, key 122, target 124, talk 126 and look 129. It has
 * no boot and no drop cursor; those two stay BoE's.
 */

import type { Rgba } from '../../src/fileio/legacy/bmp';
import type { NeResource } from './ne';

const RT_CURSOR = 1;
const RT_GROUP_CURSOR = 12;

/** Group cursor id → the engine's name for it (`CursorName`). */
const E3_CURSORS: ReadonlyMap<number, string> = new Map([
  [89, 'NW'], [90, 'N'], [91, 'NE'], [99, 'W'], [100, 'wait'], [101, 'E'],
  [109, 'SW'], [110, 'S'], [111, 'SE'],
  [120, 'sword'], [122, 'key'], [124, 'target'], [126, 'talk'], [129, 'look'],
]);

export interface E3Cursor {
  name: string;
  image: Rgba;
  hotspot: { x: number; y: number };
}

/**
 * Decode one `RT_CURSOR`: a hotspot (two words), a BITMAPINFOHEADER whose
 * height counts both masks, a two-colour palette, then the XOR mask and the
 * AND mask, each 1 bit a pixel, rows bottom up and padded to four bytes. AND
 * set is transparent (or, with XOR set too, the screen inverted, drawn here
 * as black); AND clear takes the palette colour XOR names.
 */
function decodeCursor(data: Uint8Array): { image: Rgba; hotspot: { x: number; y: number } } {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hotspot = { x: v.getUint16(0, true), y: v.getUint16(2, true) };
  const hdr = 4;
  const headerSize = v.getUint32(hdr, true);
  const w = v.getInt32(hdr + 4, true);
  const h = v.getInt32(hdr + 8, true) / 2;
  const bpp = v.getUint16(hdr + 14, true);
  if (bpp !== 1) throw new Error(`cursor with ${bpp} bits a pixel`);
  const palette = hdr + headerSize;
  const colour = (i: number): [number, number, number] =>
    [data[palette + 4 * i + 2]!, data[palette + 4 * i + 1]!, data[palette + 4 * i]!];
  const stride = Math.ceil(w / 32) * 4;
  const xor = palette + 8;
  const and = xor + stride * h;
  const bit = (base: number, x: number, y: number): number =>
    ((data[base + (h - 1 - y) * stride + (x >> 3)]! >> (7 - (x & 7))) & 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const a = bit(and, x, y), xo = bit(xor, x, y);
      if (a === 1 && xo === 0) continue;
      const [r, g, b] = a === 1 ? [0, 0, 0] : colour(xo);
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
    }
  }
  return { image: { width: w, height: h, data: out }, hotspot };
}

export function readE3Cursors(resources: NeResource[]): E3Cursor[] {
  const cursors = new Map(resources.filter((r) => r.type === RT_CURSOR).map((r) => [r.id, r.data]));
  const out: E3Cursor[] = [];
  for (const group of resources.filter((r) => r.type === RT_GROUP_CURSOR)) {
    const name = E3_CURSORS.get(group.id);
    if (name === undefined) continue;
    // One entry each: 32×64 (both masks), 1 bit; the cursor's id is the
    // entry's last word.
    const v = new DataView(group.data.buffer, group.data.byteOffset, group.data.byteLength);
    const data = cursors.get(v.getUint16(6 + 12, true));
    if (!data) throw new Error(`cursor group ${group.id} names a missing cursor`);
    out.push({ name, ...decodeCursor(data) });
  }
  return out;
}
