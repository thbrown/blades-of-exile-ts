// Aligns the two engines' *action* streams and names the first place they part.
//
//   node scripts/align-actions.mjs ASR_11-05-2025_07-55-19   # one file, with context
//   node scripts/align-actions.mjs --all                     # every cached file, ranked
//   node scripts/align-actions.mjs --all --drift             # only files that drifted
//
// ## Why this exists, next to diverge.mjs
//
// `diverge.mjs` compares the **draw** streams, which is the right meter for a
// rule: one side calls `get_ran` where the other doesn't, and the first
// differing draw is the rule itself. But two files in the queue have a
// divergence it structurally cannot see — the draws agree and the *action
// lists* have drifted, so this port runs `handle_combat_switch` where the C++
// runs `handle_pause`, one action apart. Something upstream consumed a
// different number of actions. That is a driver bug, not a rule, and the draw
// stream is the wrong instrument for it: both sides are faithfully replaying,
// just not the same recording position.
//
// ## Align by the recording's own arguments — not by index, and not by draws
//
// The two sides do not agree on action numbering at all:
//
//   - The C++ replays the recording's startup actions (`load_prefs`,
//     `feature_flags`, `srand`, the file picker, `load_party`) as actions; this
//     port's `replayStartup` consumes them before the driver starts counting,
//     so its action 7 is the C++'s action 9. A fixed offset, but not one worth
//     hard-coding — it differs per recording shape.
//   - This port **collapses a C++ move-plus-dialog into one action**, and the
//     replay host answers dialogs off the same stream without printing them, so
//     the offset is not even constant within a file.
//
// Cumulative draw count is the obvious anchor and it is **wrong here**, which
// cost an hour to learn. It is the one clock both sides agree on only *up to
// the first divergence* — and this tool exists to be used past that point, on
// files `diverge.mjs` has already reported. Past it the counts run apart
// (`VoDT_04-05-memory-dump-2` is at 9,777 on one side and 9,888 on the other
// while replaying the very same action), so a `type@draws` key stops matching
// and the LCS invents drift out of two streams that are in perfect step.
//
// The key that works is the action's **arguments**: the destination square of a
// `move`, the id of a `click_control`. Those come straight out of the recording
// and both engines print them verbatim, so they are identical no matter how far
// the rules have diverged. Draws are still parsed and shown, because *where the
// two draw counts separate* is exactly the context you want beside a drift —
// but they are display, not alignment.
//
// ## Reading the output
//
// The first unmatched pair is the answer, and it is nearly always *upstream* of
// where diverge.mjs points. A `-` line is an action the C++ ran and this port
// did not; a `+` is one this port ran alone. One of each at the same place is a
// substitution — the two sides are the same distance into the recording and
// disagree about what the next action *is*, which means the recording's action
// list was consumed differently, not that a rule fired wrong.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = dirname(fileURLToPath(new URL('.', import.meta.url)));
const CACHE = join(REPO, 'tools', 'cppharness', 'traces');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const ALL = flag('all');
const DRIFT_ONLY = flag('drift');
const CONTEXT = 4;
const target = args.find((a) => !a.startsWith('--'));

if (!ALL && !target) {
  console.error('usage: node scripts/align-actions.mjs <replay-name> | --all [--drift]');
  process.exit(2);
}
if (!existsSync(CACHE)) {
  console.error(`no cached traces at ${CACHE} — run scripts/diverge.mjs --all first`);
  process.exit(2);
}

// Same two line shapes diverge.mjs reads, and for the same reason: both engines
// stream actions and draws down one stdout, so position carries the join.
const DRAW = /\[ran\] (\d+) get_ran\((-?\d+),(-?\d+),(-?\d+)\) = (-?\d+)/;
const ACTION = /^ {2}\s*(\d+) ([a-z_]+)/;

/**
 * The action stream of one trace, each action tagged with the cumulative draw
 * count **as it finished**.
 *
 * The two engines print their action line at opposite ends of the action — the
 * C++ in `pop_next_action` before running it, this port in `onStep` after
 * `await session.settled()` — so "the draws that belong to this action" is read
 * off opposite sides of the line. Getting this backwards shifts one side by one
 * action and the alignment then drifts for the rest of the file, which reads
 * exactly like the bug this tool is meant to find.
 */
function parseActions(path, side) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const acts = [];
  let draws = 0;
  let open = null;
  let prevAt = null;
  for (const line of text.split('\n')) {
    const a = ACTION.exec(line);
    if (a) {
      const rec = { at: Number(a[1]), type: a[2], draws: 0, detail: detailOf(line) };
      // **A gap in this port's own numbering is not a missing action.** The
      // replay host pulls from the same action stream the driver is walking —
      // that is how a message raised mid-move eats the click that dismissed it
      // — and an action answered that way never reaches `onStep`, so it never
      // prints a line. The index still advances.
      //
      // So a jump in `at` is the trace saying "the host took these", and the
      // C++'s copies of them are answered, not skipped. They are put back into
      // the stream here as placeholders that match **anything** during
      // alignment: their position and count are known and their type is not, so
      // a wildcard is the honest representation. Classifying them after the
      // fact instead was not enough — where the host answers one of two
      // adjacent clicks, the LCS pairs the printed one with the wrong twin and
      // the leftover reads as drift, which is exactly what the last two
      // false positives in the corpus turned out to be.
      const gap = side === 'js' && prevAt !== null ? rec.at - prevAt - 1 : 0;
      for (let k = 0; k < gap; k++) {
        acts.push({ at: prevAt + 1 + k, type: '(answered)', draws, detail: '', answered: true });
      }
      prevAt = rec.at;
      if (side === 'cpp') {
        // Printed before it runs: the draws so far close the *previous* action.
        if (open) { open.draws = draws; acts.push(open); }
        open = rec;
      } else {
        rec.draws = draws;
        acts.push(rec);
      }
      continue;
    }
    const d = DRAW.exec(line);
    if (d) draws = Number(d[1]);
  }
  if (open) { open.draws = draws; acts.push(open); }
  return acts;
}

/**
 * The argument column both sides print after the type.
 *
 * **Truncated to the width the oracle prints**, which is ten characters. That
 * matters for `load_party`, whose argument is the whole gzipped save: the C++
 * shows `H4sIAAAAAA` and this port shows several hundred characters of it, so
 * comparing them in full makes every mid-run load look like a substitution.
 * Nothing wider than the oracle's column is comparable, so nothing wider is
 * compared. Ten is generous for every other type — a destination square is
 * seven characters and a control id is eight.
 */
const DETAIL_WIDTH = 10;

function detailOf(line) {
  const m = /^ {2}\s*\d+ [a-z_]+\s+(.*?)\s*(?:->|$)/.exec(line);
  // Trim **after** slicing as well as before: `arrow_button_click`'s argument is
  // a rectangle, and cutting `{(308,80) - (485,92)}` at ten characters leaves a
  // trailing space that the oracle's own ten-character `{(308,80)` does not
  // have. One space, one false substitution, and it was the last hunk standing.
  return (m?.[1] ?? '').trim().slice(0, DETAIL_WIDTH).trim();
}

/**
 * Longest common subsequence over `type@arguments`, returned as an edit script.
 *
 * The corpus's longest recording is ~2k actions a side, so the full O(n·m)
 * table is ~4M cells — big enough to be worth not doing twice, small enough
 * that none of the usual Myers cleverness earns its complexity here.
 */
function align(a, b) {
  // **Only compare an argument both sides actually print.** The harness prints
  // no argument column for `click_control` where this port prints the control
  // id (`spell12`, `cast`), so keying those on `type@detail` makes every
  // recorded click a substitution — two deletions against two additions — and
  // buries real drift under one false hunk per dialog in the file.
  //
  // Derived per file rather than from a list of type names: a type whose
  // argument is empty in *every* one of the oracle's lines is one the oracle
  // does not report, so it is compared on type alone. If the harness later
  // learns to print ids, this key sharpens on its own with nothing to update.
  const silent = new Set();
  const seen = new Set();
  for (const x of a) {
    seen.add(x.type);
    if (x.detail) silent.add(`!${x.type}`);
  }
  const typeOnly = (t) => seen.has(t) && !silent.has(`!${t}`);
  const key = (x) => (typeOnly(x.type) ? x.type : `${x.type}@${x.detail}`);
  const n = a.length;
  const m = b.length;
  // Int32Array rather than nested arrays: 4M numbers in a JS array of arrays is
  // ~200MB of boxed values and enough to make `--all` swap.
  const dp = new Int32Array((n + 1) * (m + 1));
  const ka = a.map(key);
  const kb = b.map(key);
  // A host-answered placeholder matches whatever the oracle ran at that spot.
  const same = (i, j) => ka[i] === kb[j] || b[j].answered === true;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = same(i, j)
        ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
        : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
    }
  }
  const script = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      script.push({ op: '=', cpp: a[i], js: b[j] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      script.push({ op: '-', cpp: a[i], js: null });
      i++;
    } else {
      script.push({ op: '+', cpp: null, js: b[j] });
      j++;
    }
  }
  for (; i < n; i++) script.push({ op: '-', cpp: a[i], js: null });
  for (; j < m; j++) script.push({ op: '+', cpp: null, js: b[j] });
  return script;
}

/**
 * The maximal runs of unmatched actions, and what each one is.
 *
 * Three shapes have to stay apart, because only one of them is a bug worth
 * opening:
 *
 *  - **the startup prefix.** The C++ replays `load_prefs`, `feature_flags`,
 *    `srand`, the file picker and `load_party` as actions; this port's
 *    `replayStartup` consumes them before the driver counts. That is the first
 *    hunk of nearly every file, it is deletions only, and every action in it
 *    drew nothing. Structural, expected, and not drift.
 *  - **the tail.** One side stopped — this port reaching an action the driver
 *    has no handler for, or the harness giving up. Every remaining action on
 *    the other side is unmatched, but the two were in step right up to the
 *    stop. `diverge.mjs` already reports that as `… @ the C++ draws on`.
 *  - **drift**: a hunk with matched actions on *both* sides of it. The streams
 *    parted and then re-converged, which only happens when the same recording
 *    was consumed at two different rates. That is the driver bug this tool is
 *    for.
 */
function hunks(script) {
  const out = [];
  for (let i = 0; i < script.length;) {
    if (script[i].op === '=') { i++; continue; }
    const start = i;
    while (i < script.length && script[i].op !== '=') i++;
    const run = script.slice(start, i);
    const matchedAfter = script.slice(i).some((s) => s.op === '=');
    const matchedBefore = start > 0;
    out.push({
      start,
      end: i,
      run,
      // **Nothing has drawn yet**, so the game has not started and this is
      // `replayStartup`'s bookkeeping rather than drift. Cumulative draws are
      // zero only before the first `get_ran`, so the test cannot catch a
      // mid-game hunk by accident. It deliberately covers more than the leading
      // block: a recording that loads a save and then opens the file picker
      // again has two startup hunks with a match between them, and the second
      // is no more a bug than the first.
      startup: run.every((s) => (s.cpp ?? s.js).draws === 0),
      tail: !matchedAfter,
      dels: run.filter((s) => s.op === '-').length,
      adds: run.filter((s) => s.op === '+').length,
      matchedBefore,
    });
  }
  for (const h of out) {
    h.drift = !h.startup && !h.tail;
  }
  return out;
}

const fmt = (n) => n.toLocaleString('en-US');

function side(rec) {
  if (!rec) return ' '.repeat(38);
  const at = String(rec.at).padStart(5);
  const type = rec.type.padEnd(20);
  return `${at} ${type} ${String(rec.draws).padStart(7)}`;
}

function report(name, cpp, js) {
  const script = align(cpp, js);
  const all = hunks(script);
  const drifts = all.filter((h) => h.drift);
  const matched = script.filter((s) => s.op === '=').length;

  console.log(`\n${name}`);
  console.log(`  the C++ ${fmt(cpp.length)} actions / ${fmt(cpp.at(-1)?.draws ?? 0)} draws`
    + `   this port ${fmt(js.length)} actions / ${fmt(js.at(-1)?.draws ?? 0)} draws`
    + `   aligned ${fmt(matched)}`);

  const startup = all.find((h) => h.startup);
  if (startup) console.log(`  (${startup.dels} startup actions consumed by replayStartup — structural)`);
  const tail = all.find((h) => h.tail);
  if (tail) {
    console.log(`  in step for ${fmt(tail.start)} actions, then `
      + `${tail.dels > tail.adds ? 'this port stopped' : 'the C++ stopped'}`
      + ` — ${fmt(tail.run.length)} unmatched tail actions.`);
  }

  const real = drifts;
  const answered = script.filter((s) => s.op === '=' && s.js?.answered).length;
  if (answered > 0) {
    console.log(`  (${answered} action(s) answered by the replay host, matched as wildcards — benign)`);
  }

  if (real.length === 0) {
    console.log('  no drift: every unmatched action is the startup prefix, a dialog answer, or the tail.');
    return { name, matched, drift: false };
  }

  const first = real[0];
  const anchor = first.run[0];
  const draw = (anchor.cpp ?? anchor.js).draws;
  console.log(`  **drifted** in ${real.length} place(s); first after ${fmt(first.start)}`
    + ` aligned actions, at draw ${fmt(draw)}`
    + ` (${first.dels} only in the C++, ${first.adds} only here).\n`);
  console.log(`      ${'the C++'.padEnd(38)}  ${'this port'}`);
  for (let k = Math.max(0, first.start - CONTEXT); k < Math.min(script.length, first.end + CONTEXT); k++) {
    const s = script[k];
    const mark = k >= first.start && k < first.end ? '  > ' : '    ';
    console.log(`${mark}${s.op} ${side(s.cpp)}  ${side(s.js)}`);
  }
  return { name, matched, drift: true, at: first.start, draw, places: real.length };
}

/** Every cached trace pair, by the directory name diverge.mjs writes. */
function cached() {
  return readdirSync(CACHE)
    .filter((d) => existsSync(join(CACHE, d, 'cpp.txt')) && existsSync(join(CACHE, d, 'js.txt')))
    .sort();
}

const dirs = ALL
  ? cached()
  : cached().filter((d) => d.includes(target));

if (dirs.length === 0) {
  console.error(target ? `no cached trace matching "${target}"` : 'no cached traces');
  process.exit(2);
}

const results = [];
for (const d of dirs) {
  const cpp = parseActions(join(CACHE, d, 'cpp.txt'), 'cpp');
  const js = parseActions(join(CACHE, d, 'js.txt'), 'js');
  // A side that ran no actions has not drifted from anything — it never started.
  // Saying so beats reporting every one of the other side's actions as unmatched.
  if (!cpp?.length || !js?.length) {
    if (!DRIFT_ONLY) {
      console.log(`\n${d}\n  no actions on ${!cpp?.length ? 'the C++' : 'this port'} — nothing to align.`);
    }
    continue;
  }
  const r = report(d, cpp, js);
  if (DRIFT_ONLY && !r.drift) continue;
  results.push(r);
}

if (ALL) {
  const drifted = results.filter((r) => r.drift);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${drifted.length} of ${results.length} files drifted.`);
  for (const r of drifted.sort((x, y) => y.at - x.at)) {
    console.log(`  ${String(r.at).padStart(6)} actions in, draw ${String(fmt(r.draw)).padStart(9)}  ${r.name}`);
  }
}
