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

// Kept in step with the switch in src/replay/driver.ts. Listed rather than
// imported because this script is plain Node and the driver is TypeScript.
const HANDLED = new Set([
  'move', 'handle_pause', 'handle_rest', 'handle_combat_switch', 'handle_look',
  'handle_use_space', 'handle_switch_pc', 'click_control', 'handle_parry',
  'handle_toggle_active', 'handle_missile', 'handle_target_space', 'screen_shift',
  'handle_begin_look', 'handle_begin_talk', 'handle_talk', 'click_talk_rect',
  'load_prefs', 'feature_flags', 'srand', 'scenario', 'change_fps',
  // The startup preamble, which `replayStartup` reads before the session exists.
  'startup_button_click', 'fancy_file_picker', 'load_party',
  // Views: they read the universe and paint, and change nothing in it.
  'display_map', 'close_map', 'close_window', 'set_stat_window', 'show_inventory',
  'print_party_stats', 'debug_print_location',
]);

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
