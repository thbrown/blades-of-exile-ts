// Port of src/fileio/tarball.cpp — the ustar container a `.exg` save (and a
// `.boes` scenario) is packed into.
//
// Two quirks of the C++ writer are kept, because its own reader depends on
// them and saves in the wild were written by it:
//   - it writes **no end-of-archive marker** (the two zero blocks a standard
//     tar ends with), so the reader has to stop at the end of the data or at
//     the first all-zero header rather than looking for the marker;
//   - the header checksum is written with `%o` rather than `%06o\0 `, i.e. no
//     zero padding and no NUL. We write it the same way and accept either.

const BLOCK = 512;

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, '0');
}

function writeString(buf: Uint8Array, offset: number, len: number, str: string): void {
  // snprintf truncates to len - 1 and NUL-terminates. The terminator matters:
  // the checksum field is pre-filled with spaces, so it reads "7262\0   ".
  let i = 0;
  for (; i < len - 1 && i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0xff;
  buf[offset + i] = 0;
}

/** `generateTarHeader` (tarball.cpp:19). */
export function tarHeader(name: string, size: number): Uint8Array {
  if (name.length >= 100) throw new Error(`tar: file name longer than 99 characters: ${name}`);
  const h = new Uint8Array(BLOCK);
  writeString(h, 0, 100, name);
  writeString(h, 100, 8, octal(0o600, 7));
  writeString(h, 124, 12, octal(size, 11));
  writeString(h, 136, 12, octal(Math.floor(Date.now() / 1000), 11));
  h.fill(0x20, 148, 156); // checksum field is spaces while it is computed
  h[156] = '0'.charCodeAt(0); // typeflag: regular file
  writeString(h, 257, 6, 'ustar');
  writeString(h, 263, 2, ' ');
  let sum = 0;
  for (const b of h) sum += b;
  writeString(h, 148, 8, sum.toString(8));
  return h;
}

/** `tarball::writeTo` — headers and 512-byte-padded contents, nothing else. */
export function writeTar(entries: readonly TarEntry[]): Uint8Array {
  let total = 0;
  for (const e of entries) {
    total += BLOCK;
    if (e.data.length > 0) total += Math.ceil(e.data.length / BLOCK) * BLOCK;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const e of entries) {
    out.set(tarHeader(e.name, e.data.length), at);
    at += BLOCK;
    if (e.data.length === 0) continue;
    out.set(e.data, at);
    at += Math.ceil(e.data.length / BLOCK) * BLOCK;
  }
  return out;
}

/** `tarball::readFrom`. Stops at the end of the data or at a zeroed header. */
export function readTar(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let at = 0;
  while (at + BLOCK <= data.length) {
    const header = data.subarray(at, at + BLOCK);
    if (header[0] === 0) break; // padding or an end-of-archive marker
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    let name = '';
    for (let i = 0; i < nameEnd; i++) name += String.fromCharCode(header[i]!);
    let sizeStr = '';
    for (let i = 124; i < 136 && header[i] !== 0 && header[i] !== 0x20; i++) {
      sizeStr += String.fromCharCode(header[i]!);
    }
    const size = parseInt(sizeStr, 8) || 0;
    at += BLOCK;
    entries.push({ name, data: data.subarray(at, at + size) });
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

export class Tarball {
  private readonly entries: TarEntry[] = [];

  static read(data: Uint8Array): Tarball {
    const ball = new Tarball();
    for (const e of readTar(data)) ball.entries.push(e);
    return ball;
  }

  /** `newFile` — text goes in as UTF-8. */
  addText(name: string, text: string): void {
    this.entries.push({ name, data: new TextEncoder().encode(text) });
  }

  add(name: string, data: Uint8Array): void {
    this.entries.push({ name, data });
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name);
  }

  /** `getFile` — undefined rather than the C++'s bad stream. */
  get(name: string): Uint8Array | undefined {
    return this.entries.find((e) => e.name === name)?.data;
  }

  text(name: string): string | undefined {
    const data = this.get(name);
    return data === undefined ? undefined : new TextDecoder().decode(data);
  }

  get files(): readonly TarEntry[] {
    return this.entries;
  }

  serialise(): Uint8Array {
    return writeTar(this.entries);
  }
}
