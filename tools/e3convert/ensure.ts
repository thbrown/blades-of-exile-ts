/**
 * Converts Exile III into `public/scenarios/exile3/` if the converted copy is
 * missing or stale: run before `npm run dev`, so the bundled scenario is
 * always there without being committed (it is generated, from the committed
 * installer). The published site's build leaves it out (vite.config.ts).
 *
 *   npx vite-node tools/e3convert/ensure.ts [--force]
 *
 * Stale means the installer, or any of the code the conversion runs
 * (`tools/e3convert/`, `src/`), has changed since the stamp was written.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitScenario } from './emit';
import { findE3Dir } from './install';
import { E3_INSTALLER_SHA256 } from './installer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'public/scenarios/exile3');
const STAMP = join(OUT, '.stamp');

function sources(dir: string, into: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'project' || e === 'node_modules') continue;
    if (statSync(p).isDirectory()) sources(p, into);
    else if (/\.(ts|txt|xml)$/.test(e)) into.push(p);
  }
  return into;
}

const hash = createHash('sha256').update(E3_INSTALLER_SHA256);
for (const f of [...sources(join(ROOT, 'tools/e3convert')), ...sources(join(ROOT, 'src'))].sort()) {
  hash.update(relative(ROOT, f)).update(readFileSync(f));
}
const want = hash.digest('hex');
if (!process.argv.includes('--force') && existsSync(STAMP) && readFileSync(STAMP, 'utf8') === want) {
  console.log('Exile III is converted and up to date.');
} else {
  const e3Dir = findE3Dir();
  if (!e3Dir) throw new Error('vendor/exile3/EXL3INST.EXE is missing');
  console.log('Converting Exile III…');
  rmSync(OUT, { recursive: true, force: true });
  const s = emitScenario(e3Dir, OUT);
  writeFileSync(STAMP, want);
  console.log(`Wrote ${relative(ROOT, OUT)}: ${s.sectors} sectors, ${s.towns} towns, ${s.sheets} graphics sheets.`);
}
