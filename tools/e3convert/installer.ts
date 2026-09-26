/**
 * The committed installer on disk: its path, and unpacking it into the
 * gitignored `e3data/` for the Node tools (`unpack.ts` does the work).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E3_INSTALLER_SHA256, unpackE3Installer as unpack } from './unpack';

export { E3_INSTALLER_SHA256 };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const E3_INSTALLER = join(ROOT, 'vendor/exile3/EXL3INST.EXE');

/** The installer's game files by name, after checking it is the expected download. */
export function unpackE3Installer(exe: Uint8Array): Map<string, Uint8Array> {
  const sha = createHash('sha256').update(exe).digest('hex');
  if (sha !== E3_INSTALLER_SHA256) throw new Error(`EXL3INST.EXE is not the expected download (sha256 ${sha})`);
  return unpack(exe);
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
