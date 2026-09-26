/**
 * Where Exile 3's files are: `E3_DIR` if set (another copy, for comparing),
 * else the committed installer unpacked into the gitignored `e3data/`
 * (`installer.ts`). Returns null only if neither can be had.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E3_INSTALLER, ensureE3Unpacked } from './installer';

export function findE3Dir(): string | null {
  const env = process.env['E3_DIR'];
  if (env && existsSync(join(env, 'EXILE3.EXE'))) return env;
  if (existsSync(E3_INSTALLER)) return ensureE3Unpacked();
  return null;
}

export interface E3Files {
  exe: Uint8Array;
  outdoor: Uint8Array;
  town: Uint8Array;
}

export function readE3Files(dir: string): E3Files {
  const read = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
  return { exe: read('EXILE3.EXE'), outdoor: read('OUTDOOR.DAT'), town: read('TOWN.DAT') };
}
