/**
 * A hash of everything the Exile III conversion runs: the installer's
 * checksum and the code under `tools/e3convert/` and `src/`. It says when a
 * converted copy is stale — on disk (`ensure.ts`) and in the player's browser
 * (vite.config.ts builds it in as `__EXILE3_VERSION__`; `src/platform/exile3.ts`).
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E3_INSTALLER_SHA256 } from './unpack';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string, into: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'project' || e === 'node_modules') continue;
    if (statSync(p).isDirectory()) sources(p, into);
    else if (/\.(ts|txt|xml)$/.test(e)) into.push(p);
  }
  return into;
}

export function exile3ConversionVersion(): string {
  const hash = createHash('sha256').update(E3_INSTALLER_SHA256);
  for (const f of [...sources(join(ROOT, 'tools/e3convert')), ...sources(join(ROOT, 'src'))].sort()) {
    hash.update(relative(ROOT, f)).update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, 16);
}
