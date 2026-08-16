/**
 * The whole C++ replay corpus, run and reported on — M8's progress meter.
 *
 * `scripts/survey-replays.mjs` answers "which action types does the driver not
 * handle?" by reading the files as text. This answers the harder question:
 * **what actually happens when they run?** A file can use nothing but handled
 * actions and still stop three steps in, because the rules diverged rather than
 * the vocabulary.
 *
 * It is **opt-in** (`CORPUS=1 npx vitest run test/corpus.test.ts`) for two
 * reasons: it needs `../exile-wasm` beside this repo, which not every checkout
 * has, and it takes long enough that it would be a tax on the ordinary suite.
 * `test/cppReplay.test.ts` is the part that runs every time — the handful of
 * files that pass today, guarded against regression.
 *
 * `ONLY=<substring>` narrows it to one file, and `VERBOSE=1` adds, for each
 * desync, what `inferMoves` makes of the recording's own path around the
 * failure. That pairing is the diagnostic: the driver says where *this* port
 * ended up, and the inference says where the recording was, which between them
 * name the square and the rule.
 *
 * `TAIL=n` is the same trace kept as a ring buffer and printed only for files
 * that stopped — the whole corpus's failures with the last n actions that led
 * into each, which is how a list of fifty desyncs gets sorted into the three or
 * four rules actually behind them.
 *
 * `TRACE=1` (with `ONLY=`) prints every action as it is dispatched, with the
 * party's square and whatever the turn printed to the transcript — which is how
 * a "the party stopped one square short" report gets turned into "this square,
 * this refusal, silently".
 *
 * `MONST=1` adds the town's whole creature list to each traced line. That is
 * the pair to `BOE_TRACE_MONST=1 tools/cppharness/run.sh <same file>`, which
 * prints the same thing from the C++: a divergence in how the townspeople
 * wander shows up here, on the first turn, hundreds of actions before one of
 * them ends up standing where the party wanted to walk.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { applySave, readSavePreview } from '../src/fileio/saveIo';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';
import { runReplay, seedLoadedReplay } from '../src/replay/driver';
import { parseReplay } from '../src/replay/format';
import { inferMoves } from '../src/replay/inferMoves';
import { replayStartup, scenarioDirOf } from '../src/replay/startup';
import { PartyPreset } from '../src/universe/player';
import { GameRng } from '../src/core/rng';
import { Universe } from '../src/universe/universe';

const ROOT = fileURLToPath(new URL('../../exile-wasm/test/replays', import.meta.url));
const SCENARIOS = fileURLToPath(new URL('../public/scenarios', import.meta.url));

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

/**
 * Every `.xml` under the replay tree — except `scenarios/`, which holds
 * scenario *data* a couple of the recordings ship beside them, not recordings.
 */
function replayFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'scenarios') replayFiles(path, out);
    } else if (entry.endsWith('.xml')) out.push(path);
  }
  return out;
}

interface Row {
  name: string;
  /** `ok` finished the file; `stop` hit something; `skip` could not start. */
  kind: 'ok' | 'stop' | 'skip';
  ran: number;
  total: number;
  why: string;
  detail: string[];
}

async function play(path: string): Promise<Row> {
  const name = path.slice(ROOT.length + 1);
  const base: Row = { name, kind: 'skip', ran: 0, total: 0, why: '', detail: [] };

  const replay = parseReplay(await parseXmlDoc(readFileSync(path, 'utf8'), name));
  const start = replayStartup(replay);
  if (start.kind !== 'load') return { ...base, why: start.why };

  const scen = await loadScenario(new FsSource(join(SCENARIOS, start.scenarioId)), opcodes);
  // **Seeded after `startNewGame`, not before** — see `seedLoadedReplay`. The
  // C++ never starts a game for a recording that loads a save, so the draws
  // that setup makes are this port's alone and would put the stream thousands
  // of numbers out of step.
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  seedLoadedReplay(univ.rng, replay);
  applySave(start.save, univ);
  session.resumeLoadedGame();
  const startedAt = { ...univ.party.getLoc() };

  const total = replay.actions.length - start.consumed;
  const trace: string[] = [];
  const tail = Number(process.env.TAIL ?? 0);
  let mark = univ.transcript.length;
  const result = await runReplay(session, replay, {
    from: start.consumed,
    onStep: process.env.TRACE || tail
      ? (at, action) => {
        // In combat the square that matters is the **acting PC's**, not the
        // party's — the party's town location does not move during a fight, so
        // printing it makes every combat trace look frozen.
        const inFight = session.mode === GameMode.COMBAT;
        const l = inFight ? univ.currentPc.combatPos : univ.party.getLoc();
        const who = inFight
          ? ` pc${univ.curPc}:${univ.currentPc.name}(${univ.currentPc.ap}ap)` : '';
        const said = univ.transcript.slice(mark).join(' | ');
        mark = univ.transcript.length;
        trace.push(`  ${String(at).padStart(5)} ${action.type.padEnd(20)} `
          + `${(action.text || action.info.id || '').padEnd(10)} -> (${l.x},${l.y})${who} `
          + `mode=${session.mode} age=${univ.party.age} draws=${univ.rng.gameDraws} `
          + `${said.slice(0, 110)}`);
        // The creature list, in `BOE_TRACE_MONST`'s format so the two traces
        // diff. Only the living ones, and by `slot` rather than array index:
        // this port's list is compacted and the C++'s is not, so the index
        // spaces differ and the slot is what the two sides agree on.
        if (process.env.MONST && univ.town) {
          trace.push('      monst:' + univ.town.monsters
            .filter((m) => m.isAlive)
            .map((m) => ` ${m.slot}:(${m.curLoc.x},${m.curLoc.y})`
              + (process.env.TARG ? `->(${m.targLoc.x},${m.targLoc.y})` : '')).join(''));
        } else if (process.env.WINDOW) {
          trace.push(`      corner=(${univ.party.outdoorCorner.x},${univ.party.outdoorCorner.y})`
            + ` iwc=(${univ.party.iwc.x},${univ.party.iwc.y})`);
        } else if (process.env.MONST) {
          // Outdoors the same line lists the ten encounter slots. A group one
          // square off is what turns `seek_party` into its random fallback,
          // which costs two draws and parts the streams.
          trace.push('      outmonst:' + univ.party.outC
            .map((g, i) => (g.exists ? ` ${i}:(${g.mLoc.x},${g.mLoc.y})` : ''))
            .join(''));
        }
        // `TAIL=n` keeps only the last n lines: over the whole corpus the full
        // trace is tens of thousands of strings, and the interesting part of a
        // desync is always the handful of actions that led into it.
        if (!process.env.TRACE && trace.length > tail) trace.shift();
      }
      : undefined,
    onLoadParty: (save) => {
      const other = scenarioDirOf(readSavePreview(save).scenarioId);
      if (other !== start.scenarioId) throw new Error(`mid-run load of another scenario: ${other}`);
      applySave(save, univ);
      session.resumeLoadedGame();
    },
  });

  // A finished file is `ran + answered`: the dialogs pull from the same stream.
  const done = result.ran + result.answered;
  const row: Row = {
    name,
    kind: result.error === null ? 'ok' : 'stop',
    ran: done,
    total,
    why: result.error ?? '',
    detail: [],
  };

  if (process.env.TRACE) row.detail.push(...trace);
  else if (tail && result.error !== null) row.detail.push(...trace);
  if (process.env.VERBOSE && result.error?.includes('desync')) {
    const here = univ.party.getLoc();
    row.detail.push(`this port ended at (${here.x},${here.y}) `
      + `mode=${session.mode} town=${univ.party.townNum}`);
    // What the *recording* was doing around the failure, inferred from its own
    // destinations — see src/replay/inferMoves.ts.
    const inferred = inferMoves(replay.actions, startedAt, start.consumed);
    const idx = inferred.moves.findIndex((m) => m.at >= result.errorAt);
    for (const m of inferred.moves.slice(Math.max(0, idx - 6), idx + 1)) {
      row.detail.push(`  ${String(m.at).padStart(5)} aimed (${m.dest.x},${m.dest.y})`
        + ` from ${m.from ? `(${m.from.x},${m.from.y})` : '?'} — ${m.outcome}`);
    }
  }
  return row;
}

const enabled = process.env.CORPUS === '1' && existsSync(ROOT);

describe.skipIf(!enabled)("the whole C++ replay corpus", () => {
  it('runs, and reports how far each file gets', async () => {
    const files = replayFiles(ROOT).sort()
      .filter((f) => !process.env.ONLY || f.includes(process.env.ONLY));

    const rows: Row[] = [];
    for (const path of files) {
      try {
        rows.push(await play(path));
      } catch (err) {
        rows.push({
          name: path.slice(ROOT.length + 1), kind: 'stop',
          ran: 0, total: 0, why: `threw: ${String(err)}`, detail: [],
        });
      }
    }

    const lines: string[] = [];
    for (const r of rows) {
      const tag = r.kind === 'ok' ? 'OK  ' : r.kind === 'skip' ? 'SKIP' : 'STOP';
      const count = r.kind === 'skip' ? '' : `${r.ran}/${r.total}`;
      lines.push(`${tag} ${count.padStart(12)}  ${r.name}  ${r.why}`);
      for (const d of r.detail) lines.push(`         ${d}`);
    }

    // The two numbers that measure the milestone.
    const ok = rows.filter((r) => r.kind === 'ok').length;
    const dispatched = rows.reduce((n, r) => n + r.ran, 0);
    lines.push('');
    lines.push(`${ok} of ${rows.length} ran to the end; ${dispatched} actions dispatched`);

    // Why the rest stopped, most common first — the queue of work.
    const reasons = new Map<string, number>();
    for (const r of rows) {
      if (r.kind === 'ok' || r.why === '') continue;
      // Collapse the parts that differ per file so the classes group.
      const cls = r.why
        .replace(/\(-?\d+,-?\d+\)/g, '(x,y)')
        .replace(/— \d+ squares/, '— N squares')
        .replace(/"[^"]*"/g, '"…"');
      reasons.set(cls, (reasons.get(cls) ?? 0) + 1);
    }
    lines.push('');
    for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
      lines.push(`${String(n).padStart(4)}  ${why}`);
    }
    console.log(`\n${lines.join('\n')}`);
  }, 3_600_000);
});
