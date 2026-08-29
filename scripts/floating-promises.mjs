// Finds `async` calls that nobody waits for.
//
// ## Why this exists
//
// `get_ran`'s **call order** is part of the spec (PLAN.md §6), and this port
// replaced the C++'s blocking dialogs and animations with `async` (§2.3). Those
// two facts meet badly in one place: a call site that forgets to `await`.
// Nothing goes wrong with the rules — every draw is still made and every answer
// is still right — but the rest of the turn runs *underneath* the call, and the
// draws come out interleaved. `scripts/diverge.mjs` then reports a divergence
// in whichever function happened to be holding the RNG, which is never the one
// at fault.
//
// That is not hypothetical: it cost a day on `ASR_05-05-2025_12-50-38`, where
// `checkSpecialTerrain` dropped `damagingTerrain`'s promise and the turn's
// upkeep landed in the middle of the party's luck saves. See PROGRESS.md.
//
// There is no ESLint in this repo, so this is the cheap standing check:
//
//   node scripts/floating-promises.mjs      # exits non-zero if it finds any
//
// ## What it is and isn't
//
// A **name-based heuristic**, deliberately. It collects every identifier
// declared `async` anywhere in `src/`, then flags bare expression statements
// that call one. So it over-reports where a sync function shares a name with an
// async one (`seekParty` exists in both `wandering.ts` and `monsterTurn.ts`),
// and it under-reports a promise stored and dropped later. Read every hit; a
// deliberate fire-and-forget should be written `void foo()`, which this skips
// and which says so to the next reader.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(new URL('.', import.meta.url))), 'src');

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.ts')) files.push(path);
  }
})(SRC);

const asyncNames = new Set();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // `async foo(`, `async function foo(`, and `foo = async (` / `foo: async (`.
  for (const m of src.matchAll(/\basync\s+(?:function\s+)?([A-Za-z_$][\w$]*)\s*[(<]/g)) {
    asyncNames.add(m[1]);
  }
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*[:=]\s*async\s*[(<]/g)) {
    asyncNames.add(m[1]);
  }
}
asyncNames.delete('function');

// Names that are *also* declared without `async` somewhere — `seekParty` is a
// local sync helper in `wandering.ts` and an async one in `monsterTurn.ts`, and
// `moveTo` is a GameSession method and a Canvas 2D one. A name-based check
// cannot tell those apart, so it reports them separately instead of crying
// wolf. If one of these ever turns out to matter, it will be because the call
// really was the async one.
const ambiguous = new Set();
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // A declaration at the start of a line — `function foo(`, `foo(` as a
    // method, with the optional modifiers — that is *not* marked async.
    const m = /^\s*(?:export\s+)?(?:private\s+|public\s+|protected\s+|static\s+)*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (!m || /\basync\b/.test(line)) continue;
    if (asyncNames.has(m[1])) ambiguous.add(m[1]);
  }
}
// Canvas 2D and other host objects: never ours.
for (const n of ['moveTo', 'lineTo', 'get', 'set', 'run']) ambiguous.add(n);

const hits = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    // A whole statement, starting with the call and ending with `);` — which is
    // what rules out interface members, declarations and arrow-function bodies.
    const m = /^(\s*)(?:this\.|[A-Za-z_$][\w$]*[.?]\.?)?([A-Za-z_$][\w$]*)\(.*\);$/.exec(line);
    if (!m || !asyncNames.has(m[2]) || ambiguous.has(m[2])) return;
    if (/^\s*(await|void|return|const|let|var|if|for|while|switch|else|\/\/|\*)/.test(line)) return;
    hits.push(`${file.slice(SRC.length - 3)}:${i + 1}: ${line.trim()}`);
  });
}

console.log(`${asyncNames.size} async names (${ambiguous.size} also declared sync,`
  + ` skipped), ${hits.length} unawaited call site(s)`);
for (const hit of hits) console.log(`  ${hit}`);
if (hits.length > 0) {
  console.log('\nEach is either a bug (add `await`) or deliberate (write `void f()`).');
  process.exit(1);
}
