/**
 * Converts Exile 3 into a scenario tree the engine loads (`ensure.ts` does
 * this automatically before dev and build, when anything has changed):
 *
 *   npx vite-node tools/e3convert/convert.ts [e3-dir] [out-dir]
 *
 * `e3-dir` defaults to `findE3Dir()` (the committed installer, unpacked),
 * `out-dir` to `public/scenarios/exile3` (gitignored: a modified copy of the
 * game, which its licence does not let us commit).
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitScenario } from './emitNode';
import { findE3Dir } from './install';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const e3Dir = process.argv[2] ?? findE3Dir();
if (!e3Dir) {
  console.error('No Exile 3 install found: pass its directory, or set E3_DIR.');
  process.exit(1);
}
const outDir = process.argv[3] ?? join(ROOT, 'public/scenarios/exile3');
rmSync(outDir, { recursive: true, force: true });
const s = emitScenario(e3Dir, outDir);
console.log(`Wrote ${outDir}: ${s.sectors} sectors, ${s.towns} towns, ${s.sheets} graphics sheets.`);
