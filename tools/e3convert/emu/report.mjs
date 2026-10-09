// Reads a sweep's report (`E3EMU_REPORT` from `test/e3emu.test.ts`) and
// prints what differs, grouped: first by kind (the difference with its
// numbers taken out, so a hundred spots that differ the same way are one
// line), then spot by spot, with what each side showed.
//
//   node tools/e3convert/emu/report.mjs REPORT.json           # kinds, then spots
//   node tools/e3convert/emu/report.mjs REPORT.json --kinds   # kinds only
//   node tools/e3convert/emu/report.mjs REPORT.json --zone 2  # one zone's spots

import { readFileSync } from 'node:fs';

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.error('usage: report.mjs REPORT.json [--kinds] [--zone N]');
  process.exit(1);
}
const results = JSON.parse(readFileSync(file, 'utf8'));
const zoneArg = args.includes('--zone') ? Number(args[args.indexOf('--zone') + 1]) : null;

// A difference with its numbers taken out (offsets, PCs, values), except the
// values a flag is set to, which are often the point (E3's 20, the engine's 250).
const kind = (d) => d.replace(/\s+/g, ' ').replace(/ \[\+?0x[0-9a-f]+\]/g, '')
  .replace(/\[msg\] (.{0,40})[^\]]*?(?= port |$)/g, '[msg] $1… ')
  .replace(/(flag)\(\d+,\d+\)/, '$1')
  .replace(/(?<!→)\b\d+\b(?!$)/g, 'N');
const agree = results.filter((r) => !r.error && !r.diffs.length).length;
const errors = results.filter((r) => r.error);
console.log(`${results.length} runs: ${agree} agree, ${errors.length} errors, ${results.length - agree - errors.length} differ.\n`);

const known = new Map();
for (const r of results) for (const k of r.known ?? []) known.set(k, (known.get(k) ?? 0) + 1);
if (known.size) {
  console.log('Known (runs), not counted as differing:');
  for (const [k, n] of known) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log();
}

const kinds = new Map();
for (const r of results) {
  for (const d of new Set(r.diffs.map(kind))) {
    const k = kinds.get(d) ?? { n: 0, spots: new Set() };
    k.n++;
    k.spots.add(`${r.case.zone}:${r.case.x},${r.case.y}`);
    kinds.set(d, k);
  }
}
console.log('By kind (runs, spots):');
for (const [d, k] of [...kinds].sort((a, b) => b[1].spots.size - a[1].spots.size))
  console.log(`  ${String(k.n).padStart(4)} ${String(k.spots.size).padStart(4)}  ${d}`);
for (const r of errors) console.log(`  error at zone ${r.case.zone} (${r.case.x},${r.case.y}): ${r.error}`);
if (args.includes('--kinds')) process.exit(0);

console.log('\nBy spot:');
const bySpot = new Map();
for (const r of results) {
  if (!r.diffs.length || (zoneArg !== null && r.case.zone !== zoneArg)) continue;
  const key = `zone ${r.case.zone} (${r.case.x},${r.case.y})`;
  if (!bySpot.has(key)) bySpot.set(key, []);
  bySpot.get(key).push(r);
}
for (const [key, runs] of bySpot) {
  console.log(`\n== ${key}`);
  for (const r of runs) {
    console.log(`  -- buttons ${r.case.answers}, dice ${r.case.dice}`);
    for (const d of r.diffs) console.log(`     ${d.slice(0, 240)}`);
    console.log(`     E3:   ${r.e3.map((s) => s.slice(0, 70)).join(' // ')}`);
    console.log(`     port: ${r.port.map((s) => s.slice(0, 70)).join(' // ')}`);
  }
}
