// Finds the first draw where this port and the C++ disagree, and names the
// action it happened under — for one recording, or for the whole corpus at once.
//
//   node scripts/diverge.mjs ZKR_15-05-2025_18-04-58   # one file, with the stack
//   node scripts/diverge.mjs --all                     # every file, ranked buckets
//   node scripts/diverge.mjs --all --stacks            # bucket by rule, not by draw args
//   node scripts/diverge.mjs --all --refresh           # ignore the trace cache
//
// ## Why
//
// `tools/cppharness/` is an oracle: the same recordings, run by the C++ this
// port is a rewrite of. Its `BOE_TRACE_RAN=n` prints game-stream draws in a
// format byte-identical to this port's `RAN=n`, and the README's recipe has been
// to dump both to /tmp and `diff` them by eye. That works, and it is how every
// fidelity bug since 2026-08-03 was found — but it answers for one file at a
// time, and it leaves the two halves of the answer unjoined: `diff` says "they
// part at draw 4,912" and says nothing about *which action* was being replayed
// when they did.
//
// This joins them. Both engines stream their action lines and their draw lines
// down one stdout, so the last action line before a draw is the action that made
// it. That turns a draw index into `handle_pause @ get_ran(1,0,5)` — a
// **signature**, and signatures group. `--all` groups all 87 files by theirs and
// sorts by how many files each accounts for, which is the difference between
// picking the next fix by what it unblocks and picking it by which file happened
// to be open.
//
// ## Why draws rather than actions
//
// A file that stops is reporting a symptom: the party ended up somewhere the
// recording didn't expect, usually many turns after the rule actually went
// wrong. The draw streams part *at* the rule — one side calls `get_ran` where
// the other doesn't — so the first differing draw is the cause and the stop is
// the consequence. It is also the honest progress meter: fixing a rule often
// moves some other file's divergence *earlier*, so actions-dispatched goes flat
// while ground is genuinely being taken.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = dirname(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = process.env.BOE_REPLAYS ?? join(REPO, '..', 'exile-wasm', 'test', 'replays');
const CACHE = join(REPO, 'tools', 'cppharness', 'traces');
const HARNESS = join(REPO, 'tools', 'cppharness', 'run.sh');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};

// Deliberately generous: the longest recording in the corpus reaches ~6k draws,
// and a budget that runs out mid-file reads exactly like a divergence.
const BUDGET = Number(opt('ran', 200000));
// Per side, per file. Both engines finish a long recording in seconds, so this
// is a hang guard rather than a budget — and it needs to be one: the harness
// hangs outright on `long/VoDT_03-05-2025_17-10-03.xml`, which is its own bug
// and not something a corpus run should stall on for a quarter of an hour.
const TIMEOUT = Number(opt('timeout', 300)) * 1000;
const REFRESH = flag('refresh');
const ALL = flag('all');
const target = args.find((a) => !a.startsWith('--'));

if (!ALL && !target) {
  console.error('usage: node scripts/diverge.mjs <replay-name> | --all [--refresh] [--ran=N]');
  process.exit(2);
}
if (!existsSync(ROOT)) {
  console.error(`no replay corpus at ${ROOT} — this needs ../exile-wasm beside the repo`);
  process.exit(2);
}
if (!existsSync(HARNESS)) {
  console.error(`no harness at ${HARNESS} — see tools/cppharness/README.md`);
  process.exit(2);
}

/** Every recording under the corpus. `scenarios/` holds scenario data, not replays. */
function replayFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'scenarios') replayFiles(path, out);
    } else if (entry.endsWith('.xml')) out.push(path);
  }
  return out;
}

/**
 * Run a command, streaming its output straight to `outPath`.
 *
 * Streamed rather than collected because a long recording at this draw budget
 * is ~10^5 lines a side, and both sides of the whole corpus will not fit in
 * memory at once.
 */
function run(cmd, cmdArgs, env, outPath) {
  return new Promise((resolve) => {
    const sink = createWriteStream(outPath);
    const child = spawn(cmd, cmdArgs, {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so the timeout can kill the **whole tree**.
      // `run.sh` is a wrapper that execs `boe-native`, and signalling the
      // wrapper alone leaves the binary running: a recording that hangs would
      // otherwise leave an orphan behind per attempt, still holding a CPU, and
      // nothing in a later run would explain where it came from.
      detached: true,
    });
    child.stdout.pipe(sink, { end: false });
    child.stderr.pipe(sink, { end: false });
    let settled = false;
    // Leave a marker in the trace itself. A killed run's output is a
    // *truncated* stream that ends mid-file with nothing to say so, and
    // comparing it would report the truncation as a divergence — the tool would
    // blame a rule for the timeout. `sideFailure` reads this back.
    const finish = (result, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.unpipe(sink);
      child.stderr.unpipe(sink);
      if (note) sink.write(`\n${note}\n`);
      sink.end(() => resolve(result));
    };
    // **Do not wait for `close` after a timeout.** `run.sh` is a wrapper, and if
    // the group kill doesn't take the grandchild with it, `boe-native` stays
    // alive holding the stdout pipe — `close` never fires and the runner blocks
    // for ever on a file it has already given up on. That is not hypothetical:
    // it is what stalled the first corpus run twice. So the timeout resolves the
    // promise itself and lets the corpus move on, orphan or no orphan.
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish('timeout', `[CRASH] killed after ${TIMEOUT / 1000}s — it hung`);
    }, TIMEOUT);
    child.on('close', (code) => finish(code, null));
    child.on('error', (err) => {
      clearTimeout(timer);
      sink.end(() => resolve(`spawn failed: ${err.message}`));
    });
  });
}

const DRAW = /\[ran\] (\d+) get_ran\((-?\d+),(-?\d+),(-?\d+)\) = (-?\d+)/;
// The action line both sides print: two spaces, a right-aligned index, the type.
// Anchored at the start so a transcript quoted at the end of another line can't
// masquerade as one, and so vitest's `stdout | …` banners are ignored for free.
const ACTION = /^ {2}\s*(\d+) ([a-z_]+)/;

/**
 * Pull the draw stream out of a trace, each draw tagged with the action line it
 * fell under. **This is the whole point of the file**: the two engines emit
 * actions and draws down one stream, so position carries the join.
 */
function parseTrace(path, side) {
  const draws = [];
  const pending = [];
  let action = null;
  let actions = 0;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { draws, actions: 0, action: null };
  }
  for (const line of text.split('\n')) {
    const a = ACTION.exec(line);
    if (a) {
      action = { at: Number(a[1]), type: a[2] };
      actions = Math.max(actions, action.at);
      // **The two engines print their action line at opposite ends of the
      // action.** The C++ prints in `pop_next_action`, *before* running it, so
      // a draw appears after the line of the action that made it. This port's
      // `onStep` fires after `await session.settled()`, *after* running it, so
      // a draw appears *before* that line. Attributing by "the last line seen"
      // would therefore blame the previous action on this side only — and since
      // the bucket signature reads the action name, the queue would be labelled
      // with the wrong rule wherever the C++ side is missing.
      //
      // Each JS line carries `draws=N`, which is what proved the direction:
      // action 7's line reports the count *including* the draws printed above
      // it. So on this side the draws waiting are claimed by the line that
      // closes them.
      if (side === 'js') {
        for (const d of pending) d.action = action;
        pending.length = 0;
      }
      continue;
    }
    const d = DRAW.exec(line);
    if (d) {
      const draw = {
        n: Number(d[1]),
        args: `${d[2]},${d[3]},${d[4]}`,
        value: Number(d[5]),
        action: side === 'js' ? null : action,
      };
      draws.push(draw);
      if (side === 'js') pending.push(draw);
    }
  }
  return { draws, actions, action };
}

/**
 * Why a side produced nothing, when it produced nothing.
 *
 * Three outcomes have to stay apart from a real divergence, because none of
 * them is a rule this port got wrong:
 *  - the **harness** crashed or refused the file. `survey.sh` says it plainly —
 *    a file the C++ cannot finish is a harness gap, and has to be fixed there
 *    before the run is worth diffing at all.
 *  - **this port skipped** it: `replayStartup` returned something other than a
 *    load, which is the `pick_a_scen` shape (a recording that builds a fresh
 *    party from the scenario picker) that no session here can start yet.
 *  - the file legitimately drew nothing.
 */
function sideFailure(path, side) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return `no ${side} trace was written`;
  }
  if (side === 'cpp') {
    const err = /^\[(?:FATAL ERROR|ERROR|CRASH)\].*$/m.exec(text);
    if (err) return `harness: ${err[0].slice(0, 90)}`;
    if (/libsystem_c\.dylib.*abort/.test(text)) return 'harness: crashed (abort)';
  } else {
    const skip = /^SKIP\s+(.*)$/m.exec(text);
    if (skip) return `this port skipped it: ${skip[1].trim().slice(0, 80)}`;
  }
  return null;
}

const show = (d) => (d
  ? `${String(d.n).padStart(6)}  get_ran(${d.args}) = ${String(d.value).padStart(6)}`
    + `   ${d.action ? `${d.action.at} ${d.action.type}` : '<before the first action>'}`
  : '       —');

/** Ensure both traces for `path` exist on disk, and return where they are. */
async function traces(path) {
  const rel = path.slice(ROOT.length + 1);
  const dir = join(CACHE, rel.replace(/[/\\]/g, '_').replace(/\.xml$/, ''));
  mkdirSync(dir, { recursive: true });
  const cpp = join(dir, 'cpp.txt');
  const js = join(dir, 'js.txt');

  if (REFRESH || !existsSync(cpp)) {
    await run('bash', [HARNESS, path],
      { BOE_TRACE: '1', BOE_TRACE_RAN: String(BUDGET) }, cpp);
  }
  if (REFRESH || !existsSync(js)) {
    // `ONLY` is a substring match against the full path, so the corpus-relative
    // path is both sufficient and unambiguous where a bare basename might not be.
    // The file filter goes **before** the flags: vitest's CLI treats
    // `--disable-console-intercept` as taking a value and swallows a positional
    // that follows it, which silently runs the whole suite — and then every
    // other test's `[ran]` lines land in the trace as if this file had drawn
    // them. Without the flag, vitest's console interception adds a banner per
    // line and turns a 14-second file into a 15-minute one.
    await run('npx', ['vitest', 'run', 'test/corpus.test.ts', '--disable-console-intercept'],
      { CORPUS: '1', TRACE: '1', RAN: String(BUDGET), ONLY: rel }, js);
  }
  return { cpp, js, rel };
}

/**
 * Compare the two draw streams and describe the first place they part.
 *
 * Three outcomes worth telling apart: they agree the whole way (`match`), one
 * side stopped drawing while the other kept going (`short` — a stop, not a
 * disagreement about a value), or a draw differs (`differ` — the rule).
 */
function compare(a, b) {
  const n = Math.min(a.draws.length, b.draws.length);
  for (let i = 0; i < n; i++) {
    const x = a.draws[i];
    const y = b.draws[i];
    // Both engines number their draws from 1 and print every one, so position
    // and number must agree. If they ever don't, a trace lost a line and every
    // comparison past here would be off by one — which would read as a
    // divergence at exactly the wrong place. Say so instead of guessing.
    if (x.n !== i + 1 || y.n !== i + 1) {
      return { kind: 'blocked', at: i, why: `trace is missing draws around ${i + 1}` };
    }
    if (x.args !== y.args || x.value !== y.value) {
      return { kind: 'differ', at: i, cpp: x, js: y };
    }
  }
  if (a.draws.length !== b.draws.length) {
    return {
      kind: 'short',
      at: n,
      cpp: a.draws[n] ?? null,
      js: b.draws[n] ?? null,
      longer: a.draws.length > b.draws.length ? 'the C++' : 'this port',
      by: Math.abs(a.draws.length - b.draws.length),
    };
  }
  return { kind: 'match', at: n };
}

/**
 * The bucket key: what rule was running, and what it asked the RNG for. Files
 * that part on the same rule share it, which is what makes the corpus report a
 * queue rather than a list. Taken from the **C++** side — it is the oracle, and
 * when the port skips a draw entirely its own side names the wrong action.
 */
/**
 * Collapse the parts of a message that differ per file — line numbers, control
 * ids, coordinates — so two files stopped by the same gap land in one bucket.
 * The same trick `test/corpus.test.ts` plays on its stop reasons.
 */
const collapse = (s) => s
  .replace(/'[^']*'/g, "'…'")
  .replace(/<[^>]*>/g, '<…>')
  .replace(/\bline \d+/g, 'line N')
  .replace(/\d+/g, 'N');

function signature(cmp) {
  if (cmp.kind === 'match') return null;
  if (cmp.kind === 'blocked') return collapse(cmp.why);
  // With `--stacks`, the function this port was in beats the draw's arguments as
  // a key. The arguments over-split: `rand_move`'s range depends on the monster
  // and the town, so one rule scatters across `get_ran(1,1,70)`,
  // `get_ran(1,1,100)`, `get_ran(1,0,24)` … and a queue of twenty-nine buckets
  // of one file each is barely a ranking at all.
  if (cmp.frame) return `${cmp.kind === 'short' ? 'ends in' : 'parts in'} ${cmp.frame}`;
  // A stream that ended because the *other engine* fell over is bucketed by
  // that reason: the actionable thing is the gap, not the square it stopped on.
  if (cmp.kind === 'short' && cmp.why) return collapse(cmp.why);
  const d = cmp.cpp ?? cmp.js;
  if (!d) return 'no draws on either side';
  const where = d.action ? d.action.type : '<startup>';
  return cmp.kind === 'short'
    ? `${where} @ ${cmp.longer} draws on`
    : `${where} @ get_ran(${d.args})`;
}

/** Whether a file's outcome is a rule this port gets wrong, or a gap elsewhere. */
const isRule = (cmp) => cmp.kind === 'differ' || (cmp.kind === 'short' && !cmp.why);

/** Re-run this port asking for the stack at draw `n`, and pull out its own frames. */
async function stackAt(rel, n) {
  const out = join(CACHE, '_stack.txt');
  await run('npx', ['vitest', 'run', 'test/corpus.test.ts'],
    { CORPUS: '1', RAN: String(n), RANSTACK: String(n), ONLY: rel }, out);
  const lines = readFileSync(out, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes('Error: here'));
  if (start < 0) return [];
  return lines.slice(start + 1)
    .filter((l) => l.includes('/src/') && !l.includes('node_modules'))
    .slice(0, 8)
    .map((l) => l.trim());
}

/**
 * The name of the rule that made a draw: the first frame below `getRan` itself,
 * as `function (file:line)`. `at GameRng.getRan (…)` is always the top and says
 * nothing.
 */
function frameOf(frames) {
  const f = frames.find((l) => !l.includes('GameRng.getRan'));
  if (!f) return null;
  const m = /^at ([\w.<>]+) .*\/src\/(.+?):(\d+):/.exec(f);
  return m ? `${m[1]} (${m[2]})` : null;
}

async function one(path, { verbose, stacks }) {
  const { cpp, js, rel } = await traces(path);
  const a = parseTrace(cpp, 'cpp');
  const b = parseTrace(js, 'js');
  // A side that never drew anything hasn't disagreed about anything: comparing
  // its empty stream would report a divergence at draw 0 and bury the real queue
  // under files that never ran.
  //
  // A side that drew and *then* died is a different matter, and worth being
  // careful about. The harness giving up at its own gap — a dialog control it
  // has no stub for — says nothing about this port, but the thousands of draws
  // it made first still do: if they all agree, the blocker is purely the
  // harness's, and if they part at draw 300 that is a genuine bug this port
  // would otherwise not have heard about for want of an oracle. So the prefix
  // is always compared, and the failure is carried along to explain the end of
  // the stream rather than to suppress it.
  const why = sideFailure(cpp, 'cpp') ?? sideFailure(js, 'js');
  const blocked = a.draws.length === 0 || b.draws.length === 0
    ? (why ?? `no draws on ${a.draws.length === 0 ? 'the C++' : 'this port'}`)
    : null;
  const cmp = blocked
    ? { kind: 'blocked', at: 0, why: blocked }
    : { ...compare(a, b), why };

  // One extra run of this port, to key the bucket on the rule rather than on the
  // draw's arguments. Only worth it for files that actually part on a rule.
  if (stacks && isRule(cmp)) {
    cmp.frame = frameOf(await stackAt(rel, cmp.at + 1));
  }

  if (verbose) {
    console.log(`\n${rel}`);
    console.log(`  C++ : ${a.actions} actions, ${a.draws.length} draws`);
    console.log(`  here: ${b.actions} actions, ${b.draws.length} draws`);
    // `compare` can also come back blocked, when a trace turns out to have lost
    // lines — so test the verdict, not the pre-check.
    if (cmp.kind === 'blocked') {
      console.log(`\n  Not comparable — ${cmp.why}`);
      console.log(`\n  traces: ${cpp}\n          ${js}`);
      return { rel, cmp, matched: 0, a, b };
    }
    console.log('');
    if (cmp.kind === 'match') {
      console.log(`  No divergence: all ${cmp.at} draws agree.`);
    } else {
      const label = cmp.kind === 'short'
        ? `They part after draw ${cmp.at}: ${cmp.longer} drew ${cmp.by} more.`
        : `They part at draw ${cmp.at + 1}.`;
      console.log(`  ${label}`);
      console.log(`  ${signature(cmp)}\n`);
      const lo = Math.max(0, cmp.at - 5);
      const hi = cmp.at + 5;
      console.log('         C++');
      for (let i = lo; i <= hi; i++) {
        if (i >= a.draws.length && i >= b.draws.length) break;
        console.log(`  ${i === cmp.at ? '>>' : '  '} ${show(a.draws[i])}`);
      }
      console.log('\n         here');
      for (let i = lo; i <= hi; i++) {
        if (i >= a.draws.length && i >= b.draws.length) break;
        console.log(`  ${i === cmp.at ? '>>' : '  '} ${show(b.draws[i])}`);
      }
      // The other half of the answer: "they part at draw k" is the where, and
      // the stack is the which-rule.
      const frames = await stackAt(rel, cmp.at + 1);
      if (frames.length) {
        console.log(`\n  this port's stack at draw ${cmp.at + 1}:`);
        for (const f of frames) console.log(`    ${f}`);
      }
      console.log(`\n  traces: ${cpp}\n          ${js}`);
    }
  }
  return { rel, cmp, matched: cmp.at, a, b };
}

if (!ALL) {
  const matches = replayFiles(ROOT).filter((f) => f.includes(target));
  if (matches.length === 0) {
    console.error(`no replay under ${ROOT} matching "${target}"`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.error(`"${target}" matches ${matches.length} replays — be more specific:`);
    for (const m of matches) console.error(`  ${m.slice(ROOT.length + 1)}`);
    process.exit(2);
  }
  await one(matches[0], { verbose: true, stacks: false });
} else {
  const files = replayFiles(ROOT).sort();
  const limit = Number(opt('limit', files.length));
  const rows = [];
  for (const [i, path] of files.slice(0, limit).entries()) {
    process.stderr.write(`[${i + 1}/${Math.min(limit, files.length)}] ${path.slice(ROOT.length + 1)}\n`);
    // One at a time: run.sh stages a shared progDir of symlinks under $TMPDIR,
    // so two harness runs at once would race over it.
    rows.push(await one(path, { verbose: false, stacks: flag('stacks') }));
  }

  console.log('\n  draws     actions (c++/here)   first divergence');
  for (const r of rows.sort((x, y) => y.matched - x.matched)) {
    console.log(`  ${String(r.matched).padStart(7)}  ${String(r.a.actions).padStart(6)}/`
      + `${String(r.b.actions).padEnd(6)}  ${r.rel.padEnd(44)} ${signature(r.cmp) ?? '—'}`);
  }

  // Two tables, deliberately. The first is the queue — rules this port gets
  // wrong, ranked by how many recordings each one accounts for. The second is
  // everything that never got as far as disagreeing, which is real work too but
  // belongs to the harness and to the startup flow, not to the game rules.
  const bucketise = (pred) => {
    const m = new Map();
    for (const r of rows.filter(pred)) {
      const sig = signature(r.cmp);
      if (sig === null) continue;
      if (!m.has(sig)) m.set(sig, []);
      m.get(sig).push(r.rel);
    }
    return [...m].sort((a, b) => b[1].length - a[1].length);
  };
  const report = (title, entries) => {
    if (entries.length === 0) return;
    console.log(`\n${title}`);
    for (const [sig, list] of entries) {
      console.log(`  ${String(list.length).padStart(4)} files  ${sig}`);
      for (const f of list.slice(0, 4)) console.log(`               ${f}`);
      if (list.length > 4) console.log(`               … and ${list.length - 4} more`);
    }
  };
  report('=== by bucket, most files first — this is the queue',
    bucketise((r) => isRule(r.cmp)));
  report('=== everything else: harness gaps and recordings that never started',
    bucketise((r) => !isRule(r.cmp) && r.cmp.kind !== 'match'));

  const clean = rows.filter((r) => r.cmp.kind === 'match').length;
  const blocked = rows.filter((r) => !isRule(r.cmp) && r.cmp.kind !== 'match').length;
  const drawn = rows.reduce((n, r) => n + r.matched, 0);
  console.log(`\n${clean} of ${rows.length} agree all the way; ${drawn} draws matched; `
    + `${blocked} blocked outside the rules`);
}
