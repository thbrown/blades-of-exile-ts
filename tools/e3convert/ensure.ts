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

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitScenario } from './emitNode';
import { findE3Dir } from './install';
import { exile3ConversionVersion } from './version';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'public/scenarios/exile3');
const STAMP = join(OUT, '.stamp');

const want = exile3ConversionVersion();
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
