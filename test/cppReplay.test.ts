/**
 * M8: the C++ build's own replays, run against this port.
 *
 * These files were recorded by the desktop game, not by this port, so they are
 * the strongest fidelity check available short of a captured end state: the
 * format is *pulled*, and `pop_next_action` throws when the next recorded
 * action isn't the kind being asked for. A rule that diverges changes what the
 * player did next, and the run fails at that action rather than quietly
 * producing a different game.
 *
 * What this does **not** yet check is that the end state matches the C++'s.
 * That needs reference snapshots captured from a run of the desktop build, and
 * is the next thing after the driver can get through more of the corpus. What
 * it checks today: every action dispatches, nothing throws, and the run is
 * deterministic — the same file twice gives the same RNG draw counts and the
 * same party.
 *
 * `scripts/survey-replays.mjs` is how the set in `test/replays/cpp` was chosen;
 * see the README there.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Scenario } from '../src/data/scenario';
import { GameSession } from '../src/game/session';
import { applySave, readSavePreview } from '../src/fileio/saveIo';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';
import { runReplay, seedLoadedReplay } from '../src/replay/driver';
import { parseReplay } from '../src/replay/format';
import { replayStartup, scenarioDirOf } from '../src/replay/startup';
import { PartyPreset } from '../src/universe/player';
import { GameRng } from '../src/core/rng';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

/** The ones that run end to end today. Adding to this list is the progress. */
const FILES = [
  'VoDT_02-05-2025_13-51-24.xml',
  'bg-flicker-boom-space.xml',
  // Casts a spell through the picker: handle_spellcast, then `other` to reach
  // the second page of the list, `spell21`, `cast`.
  'Shockwave.xml',
  // Three actions, and all three are the point: this is the desktop build's own
  // regression for the **long wait**, which is eighty turns of clock, monsters
  // and RNG behind a single `handle_wait`.
  'VoDT_28-03-2025_11-09-25.xml',
  // 152 actions through Za-Khazi, and the longest run here that exercises
  // scripting: it only completes because the driver answers the specials'
  // dialogs from the recording now.
  'ZKR_14-05-2025_13-29-14.xml',
];

/**
 * A scenario is loaded fresh per run and never shared. A `Universe` does not
 * own its `Scenario`: the party writes per-playthrough state back into it (each
 * town's explored map, its unlocked doors, its items-taken flags), which is
 * exactly why a save file carries `save/scenario.txt`. Two sessions sharing one
 * scenario object are not playing the same world.
 */
function loadScen(id: string): Promise<Scenario> {
  return loadScenario(
    new FsSource(fileURLToPath(new URL(`../public/scenarios/${id}`, import.meta.url))), opcodes);
}

interface RunOutcome {
  ran: number;
  /** Actions consumed by dialogs rather than by the driver's switch. */
  answered: number;
  total: number;
  error: string | null;
  errorAt: number;
  unsupported: Record<string, number>;
  /** The fingerprint: where everyone ended up, and how much RNG was drawn. */
  end: {
    draws: number;
    age: number;
    gold: number;
    town: number;
    loc: { x: number; y: number };
    health: number[];
  };
}

async function play(file: string): Promise<RunOutcome> {
  const xml = readFileSync(new URL(`./replays/cpp/${file}`, import.meta.url), 'utf8');
  const replay = parseReplay(await parseXmlDoc(xml, file));

  // The startup half runs before the session exists, because that is when the
  // C++ answers it: the splash screen, the file picker and the save it chose.
  const start = replayStartup(replay);
  if (start.kind !== 'load') throw new Error(`${file}: ${start.why}`);

  const scen = await loadScen(start.scenarioId);
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

  const result = await runReplay(session, replay, {
    from: start.consumed,
    // A mid-run load: the recording opened a saved game partway through, which
    // one of these files does twice in a row at the start.
    onLoadParty: (save) => {
      const other = scenarioDirOf(readSavePreview(save).scenarioId);
      if (other !== start.scenarioId) throw new Error(`mid-run load of another scenario: ${other}`);
      applySave(save, univ);
      session.resumeLoadedGame();
    },
  });

  return {
    ran: result.ran,
    answered: result.answered,
    total: replay.actions.length - start.consumed,
    error: result.error,
    errorAt: result.errorAt,
    unsupported: result.unsupported,
    end: {
      draws: univ.rng.gameDraws,
      age: univ.party.age,
      gold: univ.party.gold,
      town: univ.party.townNum,
      loc: { ...univ.party.getLoc() },
      health: univ.party.pcs.map((pc) => pc.curHealth),
    },
  };
}

describe("the C++ build's own replays", () => {
  for (const file of FILES) {
    it(`${file} runs to the end without desyncing`, async () => {
      const out = await play(file);
      // The error message is in the assertion so a failure names the action
      // that diverged rather than just the count.
      expect(`${out.error ?? 'ok'} at ${out.errorAt}`).toBe('ok at -1');
      expect(out.unsupported).toEqual({});
      // The dialogs pull from the same stream, so a finished file is the two
      // counts together — see `ReplayResult.answered`.
      expect(out.ran + out.answered).toBe(out.total);
    }, 120000);
  }

  /**
   * The property the whole exercise rests on. `get_ran`'s *call order* is part
   * of the spec, and two runs can agree on every visible value while having
   * diverged somewhere that hasn't surfaced yet — so the draw count is checked
   * as well as the state.
   */
  it('is deterministic: the same file twice gives the same game', async () => {
    const a = await play(FILES[0]!);
    const b = await play(FILES[0]!);
    expect(b.end).toEqual(a.end);
    expect(a.end.draws).toBeGreaterThan(0);
  }, 240000);

  it('refuses a replay it cannot start, rather than starting the wrong game', async () => {
    // No <load_party>: nothing in the file says which game was being played.
    const replay = await parseReplay(await parseXmlDoc(
      '<actions><srand>1</srand><move>(1,1)</move></actions>', 'x.xml'));
    const start = replayStartup(replay);
    expect(start.kind).toBe('unsupported');
    if (start.kind === 'unsupported') expect(start.why).toContain('load_party');
  });
});
