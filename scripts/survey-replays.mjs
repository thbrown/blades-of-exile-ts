// Surveys a directory of the C++ build's own replay files and reports what
// would be needed to run them here — which action types appear, how often, and
// how far each file gets before hitting one this port has no handler for.
//
// This is the curation step M8 needs: the C++ ships 92 replays, they open with
// a startup flow (preferences, the file picker, the scenario list) that has no
// equivalent here, and there is no point guessing which ones are within reach.
//
//   node scripts/survey-replays.mjs ../exile-wasm/test/replays
//
// Reads the files as XML text only — it does not run the engine, so it is safe
// to point at anything and it needs no scenario data.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// **Read out of the driver rather than listed here.** This used to be a
// hand-kept copy of the switch in src/replay/driver.ts, which meant the survey
// could quietly disagree with the thing it is surveying — and it did: two
// handlers were added and the report still called them gaps, which is exactly
// the wrong direction for a tool whose job is deciding what to write next.
// Scraping the `case '...':` labels is crude, but it cannot drift, and a
// mistake here shows up immediately as a file that "should" run and doesn't.
// The startup preamble is added separately: `replayStartup` consumes those
// before the session exists, so they never reach the driver's switch.
const driverSrc = readFileSync(
  new URL('../src/replay/driver.ts', import.meta.url), 'utf8');
const HANDLED = new Set(
  [...driverSrc.matchAll(/^\s*case '([a-z_]+)':/gm)].map((m) => m[1]));
for (const n of ['startup_button_click']) HANDLED.add(n);
if (HANDLED.size < 20) {
  throw new Error(`only ${HANDLED.size} handlers scraped from driver.ts — the shape changed`);
}

const root = process.argv[2] ?? '../exile-wasm/test/replays';
// Extra action names to treat as handled, comma-separated — for asking "if I
// wrote these next, how much further would the corpus get?" before writing
// them. `--assume load_party,fancy_file_picker`.
const assumeArg = process.argv.find((a) => a.startsWith('--assume='));
if (assumeArg) for (const n of assumeArg.slice('--assume='.length).split(',')) HANDLED.add(n);

/** Every .xml under `dir`, recursively. */
function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (entry.endsWith('.xml')) out.push(path);
  }
  return out;
}

/**
 * The action element names, in order. The document is a flat list of children
 * of <actions>, so the top-level tags are what matters — nested ones (<mods>,
 * <id>, <version>) are an action's own fields and must not be counted. Matching
 * on the indentation the recorder writes is enough and avoids pulling in a
 * parser: `record_action` indents every action by exactly four spaces.
 */
function actionsOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^ {4}<([a-z_][a-z0-9_]*)/i.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

const all = files(root).sort();
const totals = new Map();
const perFile = [];

for (const path of all) {
  const acts = actionsOf(readFileSync(path, 'utf8'));
  const counts = new Map();
  let reach = acts.length;
  for (const [i, a] of acts.entries()) {
    counts.set(a, (counts.get(a) ?? 0) + 1);
    totals.set(a, (totals.get(a) ?? 0) + 1);
    if (reach === acts.length && !HANDLED.has(a)) reach = i;
  }
  const missing = [...counts.keys()].filter((a) => !HANDLED.has(a));
  perFile.push({
    path: path.slice(root.length + 1),
    actions: acts.length,
    reach,
    missing,
    firstMissing: acts.find((a) => !HANDLED.has(a)) ?? null,
  });
}

console.log(`${all.length} replays under ${root}\n`);

console.log('=== action types, most common first (✓ = the driver handles it)');
const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
for (const [name, n] of sorted) {
  console.log(`  ${HANDLED.has(name) ? '✓' : ' '} ${String(n).padStart(6)}  ${name}`);
}

const runnable = perFile.filter((f) => f.missing.length === 0);
console.log(`\n=== ${runnable.length} of ${all.length} files use only handled actions`);
for (const f of runnable) console.log(`  ${f.actions.toString().padStart(5)}  ${f.path}`);

console.log('\n=== the rest, by how far they get before the first gap');
const blocked = perFile.filter((f) => f.missing.length > 0)
  .sort((a, b) => b.reach - a.reach || a.actions - b.actions);
for (const f of blocked.slice(0, 30)) {
  console.log(`  ${String(f.reach).padStart(5)}/${String(f.actions).padEnd(5)} `
    + `${f.path.padEnd(46)} first gap: ${f.firstMissing}`);
}
if (blocked.length > 30) console.log(`  … and ${blocked.length - 30} more`);

// Which unhandled action blocks the most files first — the one worth writing
// next, as opposed to the one that merely appears most often.
const blockers = new Map();
for (const f of blocked) blockers.set(f.firstMissing, (blockers.get(f.firstMissing) ?? 0) + 1);
console.log('\n=== first gap, by how many files it blocks');
for (const [name, n] of [...blockers.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}
