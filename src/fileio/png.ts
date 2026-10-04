/**
 * Just enough PNG for the party's export sheet (`save/export.png`) and the
 * converter's sheets: an RGBA writer, and a reader for the 8-bit truecolour
 * images either side writes. OBoE writes `export.png` through SFML (stb's
 * writer: 8-bit RGBA, any filter), this port with `encodePng` (filter 0).
 * Pure TypeScript rather than the browser's decoder, so a save loads the same
 * way headless as it does on the page — the save loader is synchronous.
 */

import { unzlibSync, zlibSync } from 'fflate';
import type { Rgba } from './legacy/bmp';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(img: Rgba): Uint8Array {
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, img.width);
  hv.setUint32(4, img.height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, no filter, no interlace
  const raw = new Uint8Array(img.height * (1 + img.width * 4));
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * (1 + img.width * 4) + 1);
  }
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit RGB or RGBA, non-interlaced PNG. Anything else throws with
 * the reason, which the save loader reports as OBoE does ("There was an error
 * loading the party custom graphics.") and carries on without the sheet.
 */
export function decodePng(bytes: Uint8Array): Rgba {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, colourType = -1;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= bytes.length;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      const depth = data[8], interlace = data[12];
      colourType = data[9] ?? -1;
      if (depth !== 8 || (colourType !== 6 && colourType !== 2) || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  if (width === 0 || height === 0) throw new Error('PNG has no IHDR');
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of idat) { joined.set(p, at); at += p.length; }
  const raw = unzlibSync(joined);

  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is short');
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x]!;
      const a = x >= bpp ? rows[dst + x - bpp]! : 0;
      const b = y > 0 ? rows[dst - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp]! : 0;
      let val: number;
      switch (filter) {
        case 0: val = cur; break;
        case 1: val = cur + a; break;
        case 2: val = cur + b; break;
        case 3: val = cur + ((a + b) >> 1); break;
        case 4: val = cur + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      rows[dst + x] = val & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
    data[i * 4] = rows[j]!;
    data[i * 4 + 1] = rows[j + 1]!;
    data[i * 4 + 2] = rows[j + 2]!;
    data[i * 4 + 3] = bpp === 4 ? rows[j + 3]! : 255;
  }
  return { width, height, data };
}
