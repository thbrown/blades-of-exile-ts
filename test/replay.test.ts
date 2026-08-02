import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';
import { GameSession } from '../src/game/session';
import {
  ReplaySource, locationFromAction, numberFromAction, parseReplay, writeReplay,
} from '../src/replay/format';
import { rngForReplay, runReplay } from '../src/replay/driver';
import { ReplayRecorder } from '../src/replay/recorder';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await freshScenario();
});

/**
 * **A replay needs its own copy of the scenario.** A `Universe` doesn't own the
 * `Scenario` it plays — the scenario carries per-playthrough state that the
 * party writes back into it: each town's explored map, its unlocked doors, its
 * items-taken flags, its current terrain. That is not incidental; it is exactly
 * why a save file has `save/scenario.txt` and `save/townmaps.dat` in it. Two
 * sessions sharing one scenario object therefore do *not* start from the same
 * world, and the second one draws differently from the RNG on its first step.
 */
function freshScenario(): Promise<Scenario> {
  return loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
}

const SEED = 20260801;

function seeded(seed: number): GameRng {
  const rng = new GameRng();
  rng.seedGame(seed);
  return rng;
}

async function newGame(rng = seeded(SEED)): Promise<GameSession> {
  const session = new GameSession(new Universe(await freshScenario(), rng, PartyPreset.DEFAULT));
  session.startNewGame();
  // `startNewGame` launches the scenario's on-init chain fire-and-forget; a
  // game that starts acting before it settles is not reproducible. See the
  // note in `runReplay`.
  await session.settled();
  return session;
}

/**
 * Record an action the way the live UI produces one: do it, then let everything
 * it started finish before the next. `runReplay` plays back under the same
 * rule, and `verify-screen.mjs`'s `idle()` is the same rule again in the
 * browser.
 */
async function act(session: GameSession, what: () => unknown): Promise<void> {
  await what();
  await session.settled();
}

/**
 * Everything a replay has to reproduce: where the party is, what it has, what
 * the scenario remembers, and — the part that catches a divergence nothing else
 * would — how many numbers came out of the RNG.
 */
function fingerprint(session: GameSession) {
  const { party } = session.univ;
  let sdf = 0;
  for (let i = 0; i < party.stuffDone.length; i++) {
    for (let j = 0; j < party.stuffDone[i]!.length; j++) {
      if (party.stuffDone[i]![j]! > 0) sdf = (sdf * 31 + i * 97 + j * 7 + party.stuffDone[i]![j]!) | 0;
    }
  }
  return {
    mode: session.mode,
    townNum: party.townNum,
    townLoc: { ...party.townLoc },
    outLoc: { ...party.outLoc },
    gold: party.gold,
    food: party.food,
    age: party.age,
    sdf,
    hp: party.pcs.map((pc) => pc.curHealth),
    sp: party.pcs.map((pc) => pc.curSp),
    monsterHp: session.univ.town?.monsters.map((m) => (m.isAlive ? m.health : -1)) ?? [],
    gameDraws: session.univ.rng.gameDraws,
  };
}

describe('the replay format', () => {
  it('round-trips actions, their values and their children', async () => {
    const recorder = new ReplayRecorder(1234, 'valleydy');
    recorder.recordLoc('move', { x: 13, y: 40 });
    recorder.recordClick('done');
    recorder.record('handle_pause');
    recorder.recordValue('handle_switch_pc', 3);

    const back = parseReplay(await parseXmlDoc(recorder.serialise(), 'replay.xml'));
    expect(back.seed).toBe(1234);
    expect(back.scenario).toBe('valleydy');
    expect(back.actions.map((a) => a.type))
      .toEqual(['move', 'click_control', 'handle_pause', 'handle_switch_pc']);
    expect(locationFromAction(back.actions[0]!)).toEqual({ x: 13, y: 40 });
    expect(back.actions[1]!.info).toEqual({ id: 'done', mods: '0' });
    expect(numberFromAction(back.actions[3]!)).toBe(3);
    // And the document is stable, so a recording can be diffed against itself.
    expect(writeReplay(back)).toBe(recorder.serialise());
  });

  it('reads the C++ recorder\'s own location spelling', async () => {
    const doc = await parseXmlDoc('<actions><move>(13,40)</move></actions>', 'r.xml');
    expect(locationFromAction(parseReplay(doc).actions[0]!)).toEqual({ x: 13, y: 40 });
  });

  it('keeps an action it has never heard of, for the driver to judge', async () => {
    const doc = await parseXmlDoc('<actions><handle_victory/></actions>', 'r.xml');
    expect(parseReplay(doc).actions[0]!.type).toBe('handle_victory');
  });

  it('refuses a document that is not a replay', async () => {
    const root = await parseXmlDoc('<scenario/>', 'r.xml');
    expect(() => parseReplay(root)).toThrow(/<actions>/);
  });
});

describe('pop_next_action', () => {
  const source = () => new ReplaySource([
    { type: 'move', text: '(1,2)', info: {} },
    { type: 'click_control', text: '', info: { id: 'done' } },
  ]);

  it('hands actions back in order', () => {
    const s = source();
    expect(s.pop().type).toBe('move');
    expect(s.pop().type).toBe('click_control');
    expect(s.exhausted).toBe(true);
  });

  it('throws when the engine asks for a different action than was recorded', () => {
    expect(() => source().pop('click_control')).toThrow(/Expected 'click_control' action next/);
  });

  it('throws when it runs out', () => {
    const s = new ReplaySource([]);
    expect(() => s.pop()).toThrow(/No action left to pop/);
  });

  it('answers hasNext without consuming', () => {
    const s = source();
    expect(s.hasNext('move')).toBe(true);
    expect(s.hasNext('click_control')).toBe(false);
    expect(s.position).toBe(0);
  });
});

describe('recording and replaying a real game', () => {
  it('reproduces the session exactly, RNG draws included', async () => {
    // Record: walk out of the guest quarters, look around, wait a turn.
    const first = await newGame();
    first.recorder = new ReplayRecorder(SEED, scen.id);
    // A real path out of the guest quarters, one open square at a time. It has
    // to be legal *and* adjacent: a recorded `move` is always one step from
    // where the party is (`handle_terrain_screen_actions` builds it from a
    // direction), and the driver treats anything further as a desync.
    const walk = [
      { x: 8, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 7 }, { x: 10, y: 7 },
      { x: 10, y: 6 },
    ];
    for (const where of walk) await act(first, () => first.moveTo(where));
    await act(first, () => first.lookAt({ x: 11, y: 12 }));
    await act(first, () => first.pause());
    // Back the way we came.
    const back = [{ x: 9, y: 6 }, { x: 9, y: 7 }, { x: 8, y: 7 }];
    for (const where of back) await act(first, () => first.moveTo(where));

    const replay = parseReplay(await parseXmlDoc(first.recorder.serialise(), 'replay.xml'));
    expect(replay.actions).toHaveLength(walk.length + 2 + back.length);
    expect(replay.seed).toBe(SEED);

    // Replay into a game that knows nothing but the seed — and is *built* on
    // it, since starting a game draws thousands of numbers before the first
    // action.
    const second = await newGame(rngForReplay(replay));
    const result = await runReplay(second, replay);

    expect(result.error).toBeNull();
    expect(result.unsupported).toEqual({});
    expect(result.ran).toBe(replay.actions.length);
    expect(fingerprint(second)).toEqual(fingerprint(first));
    // The fingerprint is only worth something if the run actually moved the
    // RNG — a replay of nothing would match trivially.
    expect(second.univ.rng.gameDraws).toBeGreaterThan(0);
  });

  it('a different seed produces a different game, so the check has teeth', async () => {
    const first = await newGame();
    first.recorder = new ReplayRecorder(SEED, scen.id);
    for (let i = 0; i < 6; i++) await act(first, () => first.moveTo({ x: 7 + i, y: 9 }));

    const replay = parseReplay(await parseXmlDoc(first.recorder.serialise(), 'replay.xml'));
    const second = await newGame(seeded(SEED + 1));
    await runReplay(second, replay);
    expect(fingerprint(second)).not.toEqual(fingerprint(first));
  });

  it('stops at an action it cannot run, and says which', async () => {
    const session = await newGame();
    const result = await runReplay(session, {
      seed: null, scenario: null,
      actions: [
        { type: 'move', text: '(7,9)', info: {} },
        { type: 'handle_victory', text: '', info: {} },
        { type: 'move', text: '(8,9)', info: {} },
      ],
    });
    expect(result.ran).toBe(1);
    expect(result.error).toMatch(/handle_victory/);
    expect(result.errorAt).toBe(1);
    expect(result.unsupported).toEqual({ handle_victory: 1 });
  });

  it('surveys a file instead, when asked to skip', async () => {
    const session = await newGame();
    const result = await runReplay(session, {
      seed: null, scenario: null,
      actions: [
        { type: 'move', text: '(7,9)', info: {} },
        { type: 'handle_victory', text: '', info: {} },
        { type: 'move', text: '(8,9)', info: {} },
      ],
    }, { onUnsupported: 'skip' });
    expect(result.ran).toBe(2);
    expect(result.error).toBeNull();
    expect(result.unsupported).toEqual({ handle_victory: 1 });
  });
});
