/**
 * Pack an unpacked scenario tree into a `.boes` — the gzipped ustar tar the
 * desktop build writes, every file under `scenario/`.
 *
 * It is how a scenario gets onto the startup screen's "Add a scenario…", and
 * how scenarios will be published to the library bucket.
 *
 * Usage: node scripts/pack-boes.mjs <scenario-dir> [out.boes]
 *   node scripts/pack-boes.mjs public/scenarios/stealth /tmp/stealth.boes
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { gzipSync } from 'fflate';
import { writeTar } from '../src/fileio/tarball.ts';

const [dir, out = `${basename(process.argv[2] ?? 'scenario')}.boes`] = process.argv.slice(2);
if (dir === undefined) {
  console.error('usage: node scripts/pack-boes.mjs <scenario-dir> [out.boes]');
  process.exit(2);
}
for (const required of ['header.exs', 'scenario.xml']) {
  if (!statSync(join(dir, required), { throwIfNoEntry: false })?.isFile()) {
    console.error(`${dir}: no ${required} — not an unpacked scenario`);
    process.exit(1);
  }
}

const entries = [];
const walk = (at) => {
  for (const name of readdirSync(at).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(at, name);
    if (statSync(full).isDirectory()) walk(full);
    // Forward slashes whatever the host, since the reader matches on them.
    else entries.push({ name: `scenario/${relative(dir, full).split(/[\\/]/).join('/')}`, data: readFileSync(full) });
  }
};
walk(dir);
const packed = gzipSync(writeTar(entries));
writeFileSync(out, packed);
console.log(`${out}: ${entries.length} files, ${packed.length} bytes`);
