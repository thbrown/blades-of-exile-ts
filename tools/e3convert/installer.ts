/**
 * Exile III's own installer, `vendor/exile3/EXL3INST.EXE`: Spiderweb's
 * freeware download, committed byte for byte (README.md, "Licence"). It is a
 * Setup Factory 4.01 self-extractor, and this unpacks it without running it.
 *
 * The layout, worked out from the file itself:
 * - the NE setup program, then the setup's own files, each a 16-byte
 *   NUL-padded name, a u32 compressed size, a u32 checksum, and the data;
 *   the first is `irsetup.dat`, the install script;
 * - then the game's files as PKWARE DCL streams back to back, with no
 *   headers, in the order the script lists them as
 *   `d:\tcwin45\exile3\exile3\NAME`.
 * Every stream is DCL "implode" (`blast.ts`).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explode, explodeStream } from './blast';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const E3_INSTALLER = join(ROOT, 'vendor/exile3/EXL3INST.EXE');
/** The download as fetched from spiderwebsoftware.com on 2026-09-25. */
export const E3_INSTALLER_SHA256 = '1a03ede845ba69cb3fffe75bdfd0c9525a6f2004769d6754ff12fb5e9101e71c';

const SCRIPT = 'irsetup.dat';

/** The installer's game files, by name (upper case, as the script has them). */
export function unpackE3Installer(exe: Uint8Array): Map<string, Uint8Array> {
  const sha = createHash('sha256').update(exe).digest('hex');
  if (sha !== E3_INSTALLER_SHA256) throw new Error(`EXL3INST.EXE is not the expected download (sha256 ${sha})`);
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const name = (p: number) => new TextDecoder('latin1').decode(exe.subarray(p, p + 16)).replace(/\0.*$/s, '');

  // The setup's own files: find the script's header, then walk them.
  const tag = new TextEncoder().encode(SCRIPT);
  let p = -1;
  for (let i = 0; i + 24 < exe.length; i++) {
    if (tag.every((c, k) => exe[i + k] === c) && exe[i + tag.length] === 0 && name(i) === SCRIPT
      && view.getUint16(i + 24, false) === 0x0006) { p = i; break; }
  }
  if (p < 0) throw new Error('EXL3INST.EXE: no install script');
  let script: Uint8Array | null = null;
  while (p + 24 <= exe.length && /^[\w.]+$/.test(name(p)) && view.getUint16(p + 24, false) === 0x0006) {
    const size = view.getUint32(p + 16, true);
    if (name(p) === SCRIPT) script = explode(exe.subarray(p + 24, p + 24 + size));
    p += 24 + size;
  }
  if (!script) throw new Error('EXL3INST.EXE: no install script');

  const names = [...new TextDecoder('latin1').decode(script).matchAll(/d:\\tcwin45\\exile3\\exile3\\([A-Z0-9_]+\.[A-Z0-9]+)/g)]
    .map((m) => m[1]!);
  const files = new Map<string, Uint8Array>();
  for (const n of names) {
    const { data, used } = explodeStream(exe.subarray(p));
    files.set(n, data);
    p += used;
  }
  if (p !== exe.length) throw new Error(`EXL3INST.EXE: ${exe.length - p} bytes left over`);
  return files;
}

/**
 * Unpacks the committed installer into `dir` (the gitignored `e3data/`)
 * unless it is there already. Returns the directory.
 */
export function ensureE3Unpacked(dir = join(ROOT, 'e3data')): string {
  const stamp = join(dir, '.from-installer');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === E3_INSTALLER_SHA256) return dir;
  const files = unpackE3Installer(new Uint8Array(readFileSync(E3_INSTALLER)));
  mkdirSync(dir, { recursive: true });
  for (const [n, data] of files) writeFileSync(join(dir, n), data);
  writeFileSync(stamp, E3_INSTALLER_SHA256);
  return dir;
}
