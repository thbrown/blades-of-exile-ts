/**
 * PKWARE Data Compression Library "explode", the format Setup Factory 4
 * compresses its files with. A port of Mark Adler's `blast.c` (zlib's
 * contrib/blast, version 1.3, zlib licence: "Permission is granted to anyone
 * to use this software for any purpose… subject to the following
 * restrictions: the origin must not be misrepresented…").
 */

const MAXBITS = 13;

interface Huffman { count: Int16Array; symbol: Int16Array }

/** Builds a decoding table from `blast.c`'s compact run-length form. */
function construct(rep: number[]): Huffman {
  const length: number[] = [];
  for (const r of rep) {
    const len = r & 15;
    for (let left = (r >> 4) + 1; left > 0; left--) length.push(len);
  }
  const n = length.length;
  const count = new Int16Array(MAXBITS + 1);
  const symbol = new Int16Array(n);
  for (const l of length) count[l]!++;
  const offs = new Int16Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len]! + count[len]!;
  for (let s = 0; s < n; s++) if (length[s] !== 0) symbol[offs[length[s]!]!++] = s;
  return { count, symbol };
}

// The fixed tables of blast.c.
const LITLEN = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24,
  12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12,
  8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252,
  13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
];
const LENLEN = [2, 35, 36, 53, 38, 23];
const DISTLEN = [2, 20, 53, 230, 247, 151, 248];
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

const litcode = construct(LITLEN);
const lencode = construct(LENLEN);
const distcode = construct(DISTLEN);

/** Decompresses one DCL stream; throws on a malformed one. */
export function explode(input: Uint8Array): Uint8Array {
  return explodeStream(input).data;
}

/** The same, also saying how many input bytes the stream took. */
export function explodeStream(input: Uint8Array): { data: Uint8Array; used: number } {
  let pos = 0;
  let bitbuf = 0;
  let bitcnt = 0;
  const out: number[] = [];

  const bits = (need: number): number => {
    let val = bitbuf;
    while (bitcnt < need) {
      if (pos >= input.length) throw new Error('explode: out of input');
      val |= input[pos++]! << bitcnt;
      bitcnt += 8;
    }
    bitbuf = val >>> need;
    bitcnt -= need;
    return val & ((1 << need) - 1);
  };

  /** blast.c's `decode`: the codes are stored bit-reversed. */
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAXBITS; len++) {
      code |= bits(1) ^ 1;
      const count = h.count[len]!;
      if (code < first + count) return h.symbol[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('explode: bad code');
  };

  const lit = bits(8);
  if (lit > 1) throw new Error('explode: bad literal flag');
  const dict = bits(8);
  if (dict < 4 || dict > 6) throw new Error('explode: bad dictionary size');

  for (;;) {
    if (bits(1)) {
      const symbol = decode(lencode);
      const len = BASE[symbol]! + bits(EXTRA[symbol]!);
      if (len === 519) break; // end of stream
      const symbolBits = len === 2 ? 2 : dict;
      let dist = decode(distcode) << symbolBits;
      dist += bits(symbolBits);
      dist++;
      if (dist > out.length) throw new Error('explode: distance too far back');
      for (let i = 0; i < len; i++) out.push(out[out.length - dist]!);
    } else {
      out.push(lit ? decode(litcode) : bits(8));
    }
  }
  return { data: Uint8Array.from(out), used: pos };
}
