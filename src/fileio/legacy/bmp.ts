/**
 * Just enough of the Windows BMP format for a legacy scenario's custom
 * graphics — `<scenario>.bmp` beside the `.exs`, which the C++ hands to
 * `sf::Image::loadFromFile`.
 *
 * The community archive uses two variants only (surveyed 2026-09-23): a
 * 40-byte `BITMAPINFOHEADER`, uncompressed, at 8 bits with a palette (90
 * files) or 24 bits (25 files). 1-, 4- and 32-bit uncompressed are decoded too
 * since they cost nothing; RLE and anything else is refused with a reason.
 * Pure TypeScript rather than the browser's decoder, so the same code runs
 * in Node for the publishing pipeline.
 */

export interface Rgba {
  width: number;
  height: number;
  /** Four bytes a pixel, rows top to bottom. */
  data: Uint8ClampedArray;
}

export function decodeBmp(bytes: Uint8Array): Rgba {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('not a BMP file');
  const dataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  if (headerSize < 40) throw new Error(`unsupported BMP header (${headerSize} bytes)`);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  // BI_RGB, or BI_BITFIELDS at 32 bits with the usual masks.
  if (compression !== 0 && !(compression === 3 && bpp === 32)) {
    throw new Error(`unsupported BMP compression (${compression})`);
  }
  const bottomUp = rawHeight > 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height === 0 || width * height > 1 << 24) throw new Error('bad BMP size');

  let palette: Uint8Array | null = null;
  if (bpp <= 8) {
    const used = view.getUint32(46, true) || 1 << bpp;
    const at = 14 + headerSize;
    palette = bytes.subarray(at, at + used * 4); // B, G, R, reserved
  }
  const stride = Math.ceil((width * bpp) / 32) * 4;
  if (dataOffset + stride * height > bytes.length) throw new Error('BMP file ends early');

  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const src = dataOffset + (bottomUp ? height - 1 - row : row) * stride;
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      if (bpp === 24 || bpp === 32) {
        const p = src + x * (bpp / 8);
        b = bytes[p]!; g = bytes[p + 1]!; r = bytes[p + 2]!;
      } else if (palette !== null && (bpp === 8 || bpp === 4 || bpp === 1)) {
        const bit = x * bpp;
        const byte = bytes[src + (bit >> 3)]!;
        const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        b = palette[index * 4] ?? 0; g = palette[index * 4 + 1] ?? 0; r = palette[index * 4 + 2] ?? 0;
      } else {
        throw new Error(`unsupported BMP depth (${bpp} bits)`);
      }
      const o = (row * width + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
