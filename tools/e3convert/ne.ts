/**
 * EXILE3.EXE's resources. The game is a 16-bit Windows 3.1 program (NE, not
 * PE), and everything it shows in words lives in its resource table:
 * `RT_STRING` for short text, one `RT_DIALOG` per encounter for the prose, and
 * custom type 100 for the sounds. See FORMATS.md.
 *
 * NE headers are little-endian, unlike the game's data files.
 */

export const RT_DIALOG = 5;
export const RT_STRING = 6;
/** Custom type 100: RIFF WAVE sound effects. */
export const RT_E3_SOUND = 100;

export interface NeResource {
  type: number;
  id: number;
  data: Uint8Array;
}

/**
 * Every numeric-typed, numeric-id resource. Named types and ids are skipped;
 * EXILE3.EXE has none that the converter needs.
 */
export function readNeResources(exe: Uint8Array): NeResource[] {
  const v = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  if (v.getUint16(0, true) !== 0x5a4d) throw new Error('not an MZ executable');
  const ne = v.getUint16(0x3c, true);
  if (v.getUint16(ne, true) !== 0x454e) throw new Error('not an NE executable');
  const table = ne + v.getUint16(ne + 0x24, true);
  const shift = v.getUint16(table, true);
  const out: NeResource[] = [];
  let p = table + 2;
  for (;;) {
    const type = v.getUint16(p, true);
    if (type === 0) break;
    const count = v.getUint16(p + 2, true);
    p += 8;
    for (let i = 0; i < count; i++, p += 12) {
      const off = v.getUint16(p, true) << shift;
      const len = v.getUint16(p + 2, true) << shift;
      const id = v.getUint16(p + 6, true);
      if ((type & 0x8000) === 0 || (id & 0x8000) === 0) continue;
      out.push({ type: type & 0x7fff, id: id & 0x7fff, data: exe.subarray(off, off + len) });
    }
  }
  return out;
}

const win1252 = new TextDecoder('windows-1252');

/**
 * `RT_STRING`: block `b` holds string ids `(b-1)*16` to `+15`, each a length
 * byte and that many bytes of text. Empty strings are left out. The ids come
 * in runs of 300 (`n*300 + k`), the Mac `STR#` numbering carried over.
 */
export function readStringTable(resources: NeResource[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of resources) {
    if (r.type !== RT_STRING) continue;
    let q = 0;
    const base = (r.id - 1) * 16;
    for (let k = 0; k < 16; k++) {
      const n = r.data[q++] ?? 0;
      if (n > 0) out.set(base + k, win1252.decode(r.data.subarray(q, q + n)));
      q += n;
    }
  }
  return out;
}

export interface E3DialogControl {
  id: number;
  /** Predefined class byte (0x80 button, 0x82 static …) or a class name. */
  kind: number | string;
  /**
   * Prose, or a BoE-style `kind_num` tag: `1_65` and `0_64` are buttons,
   * `5_422` a picture. E3 writes a quotation mark as `_`.
   */
  text: string;
  x: number; y: number; w: number; h: number;
}

export interface E3Dialog {
  id: number;
  caption: string;
  controls: E3DialogControl[];
}

/** `RT_DIALOG` in the Win16 `DLGTEMPLATE` layout. */
export function readDialogs(resources: NeResource[]): Map<number, E3Dialog> {
  const out = new Map<number, E3Dialog>();
  for (const r of resources) {
    if (r.type !== RT_DIALOG) continue;
    const b = r.data;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const cstr = (): string => {
      const end = b.indexOf(0, q);
      const s = win1252.decode(b.subarray(q, end));
      q = end + 1;
      return s;
    };
    const style = v.getUint32(0, true);
    const nControls = b[4] ?? 0;
    let q = 13; // style, count, x, y, cx, cy
    if (b[q] === 0xff) q += 3; else cstr(); // menu: ordinal or name
    cstr(); // class
    const caption = cstr();
    if (style & 0x40) { q += 2; cstr(); } // DS_SETFONT: point size, face
    const controls: E3DialogControl[] = [];
    for (let c = 0; c < nControls; c++) {
      const x = v.getInt16(q, true), y = v.getInt16(q + 2, true);
      const w = v.getInt16(q + 4, true), h = v.getInt16(q + 6, true);
      const id = v.getUint16(q + 8, true);
      q += 14; // + style (u32)
      let kind: number | string;
      if ((b[q] ?? 0) & 0x80) kind = b[q++] ?? 0; else kind = cstr();
      const text = cstr();
      q += 1 + (b[q] ?? 0); // extra bytes
      controls.push({ id, kind, text, x, y, w, h });
    }
    out.set(r.id, { id: r.id, caption, controls });
  }
  return out;
}

/** Type 100: the sound effects, as complete `.wav` files, by id. */
export function readSounds(resources: NeResource[]): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const r of resources) {
    if (r.type !== RT_E3_SOUND) continue;
    // The resource is padded to the alignment unit; the RIFF header knows the
    // real length.
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const len = Math.min(r.data.length, 8 + v.getUint32(4, true));
    out.set(r.id, r.data.subarray(0, len));
  }
  return out;
}

/**
 * NE segment `n` (1-based, as the segment table numbers them), as loaded.
 * Ghidra names segment n `0x1000 + (n-1)*8`, so segment 33 is `1100:` and the
 * automatic data segment (DGROUP, `DS`) is 48, `1178:`.
 */
export function readNeSegment(exe: Uint8Array, n: number): Uint8Array {
  const v = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const ne = v.getUint16(0x3c, true);
  const count = v.getUint16(ne + 0x1c, true);
  if (n < 1 || n > count) throw new Error(`no NE segment ${n} (the file has ${count})`);
  const table = ne + v.getUint16(ne + 0x22, true);
  const align = v.getUint16(ne + 0x32, true);
  const entry = table + 8 * (n - 1);
  const off = v.getUint16(entry, true) << align;
  const len = v.getUint16(entry + 2, true) || 0x10000;
  return exe.subarray(off, off + len);
}

/** The automatic data segment's number (DGROUP, what `DS` points at). */
export function neAutoDataSegment(exe: Uint8Array): number {
  const v = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return v.getUint16(v.getUint16(0x3c, true) + 0x0e, true);
}
