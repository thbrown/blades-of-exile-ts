/**
 * Where the user's Exile 3 install is. The game's files are commercial and are
 * never committed, so everything in `tools/e3convert` takes the directory from
 * outside: `E3_DIR` if set, else the gitignored `e3data/` in the repo, else
 * `../exile3-mapping/Exile3` beside it. Returns null when none of them has
 * EXILE3.EXE, and tests skip.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function findE3Dir(): string | null {
  const candidates = [
    process.env['E3_DIR'],
    join(ROOT, 'e3data'),
    join(ROOT, '../exile3-mapping/Exile3'),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'EXILE3.EXE'))) return dir;
  }
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
