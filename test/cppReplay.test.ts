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
  // A whole session of Za-Khazi — sailing, resting, conversations, shops,
  // giving items around the party. Back here from `PARTIAL` now that
  // `sortItems` puts each pack in the order the C++ keeps it in: the recording
  // uses items *by slot number*, so an unsorted pack used the wrong one.
  'ZKR_15-05-2025_18-04-58.xml',
];

/**
 * Exactly how much RNG a finished file draws. Dispatching every action was
 * never the same as agreeing with the C++ — `ZKR_15-05-2025_18-04-58` once ran
 * all of its actions while its stream had parted 4,000 draws earlier.
 *
 * **A pin, not a floor, and that distinction was learned the hard way.** This
 * started as `toBeGreaterThanOrEqual`, on the theory that more draws is more
 * progress. It isn't: half of M8's fixes *remove* draws this port should never
 * have made, so a floor fails on a good change and passes on a bad one that
 * happens to add draws. Total draws is simply not the axis progress lives on —
 * **matching** draws is, and this test has no oracle to compute those.
 *
 * So it pins the number and makes any change deliberate. When it fails, run
 * `node scripts/diverge.mjs <file>` and read the *matching* count: if that went
 * up or held, update the pin and say so in the commit; if it went down, the
 * change is a regression whatever this number did.
 */
const DRAW_PIN: Record<string, number> = {
  // **This file now agrees with the C++ on all 6,676 of its draws** (2026-08-31)
  // — `diverge.mjs` reports "No divergence". The last two were the generic
  // portal's decline path: this port blocked the move and the C++ does not, so
  // the recording's final step was a real move there and a no-op here, and the
  // `play_ambient_sound` pair it costs never happened. See
  // `src/game/specials/town.ts` and DIVERGENCES.md.
  //
  // It was 6,674 of 6,676 on 2026-08-23 and 6,223 on 2026-08-21; `targ_space`
  // in town closed that gap. Six fixes have moved the total here
  // (6,480 -> 6,562 -> 6,765 -> 6,602 -> 6,724 -> 6,726).
  //
  // **This number is not the one `diverge.mjs` prints, and that is correct.**
  // They are different units. `diverge.mjs` counts `[ran]` lines, which are
  // `get_ran` *calls* — one per call, matching the C++'s `trace_ran`. This pin
  // is `gameDraws`, which counts the *numbers* those calls consumed:
  // `get_ran(3,1,6)` is one line and three numbers.
  //
  //     6,676 calls + 49 extra numbers from calls with times > 1
  //           + 1 for `seedLoadedReplay`'s `init_boe` draw  =  6,726
  //
  // The 50 was recorded in PROGRESS.md for weeks as "the two runners disagree,
  // one of them is not reproducing the recording faithfully". Neither is:
  // both runners and the C++ agree on all 6,676 calls. `CALL_PIN` below pins
  // the directly comparable number so the confusion cannot come back.
  'ZKR_15-05-2025_18-04-58.xml': 6726,
};

/**
 * `get_ran` **calls** on the game stream — the number `diverge.mjs` and the
 * C++ harness both report, so unlike `DRAW_PIN` this one is comparable across
 * engines. `ZKR_15-05-2025_18-04-58` agrees with the C++ on every one of them.
 */
const CALL_PIN: Record<string, number> = {
  'ZKR_15-05-2025_18-04-58.xml': 6676,
};

/**
 * Files that do **not** run to the end, guarded on how far they get instead.
 *
 * This is not a weaker gate, it is a gate on the right axis. Dispatching every
 * action was never the same as agreeing with the C++:
 * `ZKR_15-05-2025_18-04-58` used to run all 1,033 of its actions while its RNG
 * stream had parted from the C++'s at draw 6,080 — it finished by being wrong
 * in a way that happened not to stop it. Making `handle_give_item` and
 * `handle_use_item` spend a turn, and `do_monsters` pick targets properly, took
 * it *further* into the C++'s stream and *less* far through its own action list.
 *
 * So the floor is on both numbers, and both may only go up. `scripts/diverge.mjs`
 * is what says where the remaining gap is.
 */
const PARTIAL: Record<string, { actions: number; draws: number }> = {
  // Empty at the moment: the file that lived here now dispatches every action
  // and has moved up to FILES with a DRAW_PIN. The machinery stays because
  // the next fix will put a different recording here — a file usually arrives
  // by matching *further* and finishing *less*.
};

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
    /** `get_ran` *calls* — see `CALL_PIN`. Not the same unit as `draws`. */
    calls: number;
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
  // Every file in this curated set opens by loading a save; a `debug_launch_scen`
  // recording is the corpus runner's business.
  if (start.kind !== 'load') {
    throw new Error(`${file}: ${start.kind === 'new' ? 'starts a new game' : start.why}`);
  }

  const scen = await loadScen(start.scenarioId);
  // **Seeded after `startNewGame`, not before** — see `seedLoadedReplay`. The
  // C++ never starts a game for a recording that loads a save, so the draws
  // that setup makes are this port's alone and would put the stream thousands
  // of numbers out of step.
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  seedLoadedReplay(univ.rng, replay);
  applySave(start.save, univ, { oboeIdleOnLoad: true });
  session.resumeLoadedGame();

  const result = await runReplay(session, replay, {
    from: start.consumed,
    // A mid-run load: the recording opened a saved game partway through, which
    // one of these files does twice in a row at the start.
    onLoadParty: (save) => {
      const other = scenarioDirOf(readSavePreview(save).scenarioId);
      if (other !== start.scenarioId) throw new Error(`mid-run load of another scenario: ${other}`);
      applySave(save, univ, { oboeIdleOnLoad: true });
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
      calls: univ.rng.gameCalls,
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
      const pin = DRAW_PIN[file];
      if (pin !== undefined) expect(out.end.draws).toBe(pin);
      const callPin = CALL_PIN[file];
      if (callPin !== undefined) expect(out.end.calls).toBe(callPin);
    }, 120000);
  }

  for (const [file, floor] of Object.entries(PARTIAL)) {
    it(`${file} gets at least as far as it did`, async () => {
      const out = await play(file);
      expect(out.unsupported).toEqual({});
      // Never fewer actions and never fewer draws than the last time. Draws are
      // the one that matters — see the note on PARTIAL.
      expect(out.ran + out.answered).toBeGreaterThanOrEqual(floor.actions);
      expect(out.end.draws).toBeGreaterThanOrEqual(floor.draws);
      // And it must still be a *partial* run: if it starts finishing, move it
      // up into FILES rather than leaving a floor here that can never fail.
      expect(out.ran + out.answered).toBeLessThan(out.total);
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
