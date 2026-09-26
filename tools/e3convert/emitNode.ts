/**
 * `convertE3` (emit.ts) with the file system: reads a directory of Exile
 * III's files and writes the scenario tree to another.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { convertE3, type EmitSummary } from './emit';

export function emitScenario(e3Dir: string, outDir: string): EmitSummary {
  return convertE3(
    (name) => new Uint8Array(readFileSync(join(e3Dir, name))),
    (path, data) => {
      const full = join(outDir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    },
  );
}
