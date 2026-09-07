/**
 * Which special-node opcodes are still unported.
 *
 * Walks `CATEGORY_RANGES` from `src/game/specials/context.ts`, expands each
 * range against the `SpecType` enum, and reports every opcode with no
 * `case SpecType.NAME:` label anywhere in `src/`.
 *
 * **Match case labels, not bare mentions.** The obvious version of this sweep
 * subtracts every `SpecType.NAME` that appears anywhere in the tree — but
 * `CATEGORY_RANGES` writes each range as its two endpoints, so that table
 * vouches for its own endpoints and they look implemented forever. That is
 * exactly how `UNSTORE_PC` and `TOWN_PLACE_LABEL` hid: both are range ends.
 *
 * The ranges and the enum are both parsed rather than copied, so this cannot
 * go stale against either.
 *
 * Usage: node scripts/opcode-sweep.mjs   (exit 1 if anything real is missing)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8');

// `NAME = 123,` out of the SpecType enum.
const names = new Map();
for (const m of read('src/data/special.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*=\s*(\d+),/gm))
  names.set(Number(m[2]), m[1]);
const valueOf = new Map([...names].map(([v, n]) => [n, v]));

// `[SpecCat.X, SpecType.FIRST, SpecType.LAST],` out of CATEGORY_RANGES.
const ranges = [...read('src/game/specials/context.ts')
  .matchAll(/\[SpecCat\.(\w+),\s*SpecType\.(\w+),\s*SpecType\.(\w+)\]/g)]
  .map((m) => [m[1], m[2], m[3]]);
if (ranges.length === 0) {
  console.error('opcode-sweep: found no CATEGORY_RANGES entries — has the table moved?');
  process.exit(2);
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})('src');
const handled = new Set(
  [...files.map(read).join('\n').matchAll(/case\s+SpecType\.([A-Z][A-Z0-9_]*)\s*:/g)]
    .map((m) => m[1]));

let real = 0;
for (const [cat, first, last] of ranges) {
  const lo = valueOf.get(first);
  const hi = valueOf.get(last);
  if (lo === undefined || hi === undefined) {
    console.error(`opcode-sweep: ${cat} names an unknown SpecType (${first}..${last})`);
    process.exit(2);
  }
  const missing = [];
  for (let v = lo; v <= hi; v++) {
    const name = names.get(v);
    // UNUSED* are holes in the C++'s own enum with no arm there either.
    if (name && !handled.has(name) && !name.startsWith('UNUSED')) missing.push(`${name}(${v})`);
  }
  real += missing.length;
  console.log(`${cat.padEnd(8)} ${String(missing.length).padStart(2)} unported`
    + (missing.length ? `: ${missing.join(', ')}` : ''));
}

console.log(`\n${real} opcode(s) unported.`);
process.exit(real === 0 ? 0 : 1);
