import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '../src/core/location';
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
import { NO_TARGET } from '../src/game/spellPick';
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
    // `feature_flags` is an action like any other — the C++ pops it off this
    // same stream during startup (`replay_feature_flags`, boe.main.cpp:1087) —
    // so a recording leads with the flag set it was made under.
    expect(back.actions.map((a) => a.type))
      .toEqual(['feature_flags', 'move', 'click_control', 'handle_pause', 'handle_switch_pc']);
    expect(back.featureFlags?.['target-lock']).toEqual(['V1', 'V2']);
    expect(locationFromAction(back.actions[1]!)).toEqual({ x: 13, y: 40 });
    expect(back.actions[2]!.info).toEqual({ id: 'done', mods: '0' });
    expect(numberFromAction(back.actions[4]!)).toBe(3);
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
    // A real path out of the guest quarters, one open square at a time. The
    // recorder writes whatever destination `moveTo` was given, and a *recorded*
    // move is always one step from the party because
    // `handle_terrain_screen_actions` builds it from a direction — but see the
    // test below: the driver no longer insists on that when replaying.
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
    // +1 for the leading `feature_flags`, which the recorder writes so the file
    // can be replayed against a build with a different set.
    expect(replay.actions).toHaveLength(1 + walk.length + 2 + back.length);
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

  /**
   * **A replayed `move` is not required to be adjacent.** The recorder only
   * ever writes single steps, so it is tempting to enforce that on the way back
   * in — and this driver used to, throwing "replay desync" on anything longer.
   * The C++ does not: a replayed `move` reaches `handle_move` directly
   * (boe.main.cpp:758), which hands the destination to `town_move_party`
   * (boe.actions.cpp:4165) with no adjacency test anywhere in between, so the
   * party simply arrives. `VoDT_04-05-memory-dump-2` action 583 is the corpus's
   * proof: the C++'s own `BOE_TRACE_CENTER` prints `center=(24,28)` and the
   * recording's next move is `(23,26)`, two squares off.
   */
  it('replays a town move two squares away, as the C++ does', async () => {
    const session = await newGame();
    const from = { ...session.univ.party.townLoc };
    // Two squares east of the start, along the corridor the walk above uses —
    // not adjacent, and not a square the party could have stepped to in one
    // action.
    const far = { x: from.x + 2, y: from.y };
    const doc = await parseXmlDoc(
      `<actions><move>(${far.x},${far.y})</move></actions>`, 'far.xml',
    );
    const result = await runReplay(session, parseReplay(doc));

    expect(result.error).toBeNull();
    expect(result.ran).toBe(1);
    expect(session.univ.party.townLoc).toEqual(far);
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
      seed: null, scenario: null, featureFlags: null,
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
      seed: null, scenario: null, featureFlags: null,
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

describe('a spell picker the recording walks away from', () => {
  /**
   * The C++'s picker is a modal `cDialog`, so a player's only ways out are Cast
   * and Cancel — but a recording can hold `handle_spellcast` followed by
   * something that is not a click, and the oracle's replay driver dismisses the
   * dialog when that happens. Dismissal runs `finish_pick_spell` with
   * `spell_toast` set, which **writes `store_last_cast_mage`**
   * (boe.party.cpp:2041) — and the next `pick_spell` opens on *that* caster
   * rather than on `univ.cur_pc`.
   *
   * This port used to drop the picker on the floor, so the caster memory was
   * never written and the next cast was paid for by whoever happened to be
   * active. In `VoDT_20-04-2025_16-01-17` that put a PC three spell points
   * short, three hundred actions later, of a spell the C++ refuses outright.
   */
  it('is cancelled, which is what writes the caster memory', async () => {
    const session = await newGame();
    expect(session.lastCaster[0]).toBe(NO_TARGET);

    await runReplay(session, {
      seed: null, scenario: null, featureFlags: null,
      actions: [
        { type: 'handle_spellcast', text: '', info: {} },
        { type: 'handle_switch_pc', text: '4', info: {} },
      ],
    });

    // Written, and to whoever `pick_spell` settled on — not left unset.
    expect(session.lastCaster[0]).not.toBe(NO_TARGET);
  });
});

describe('a targeted square with nothing armed, in combat', () => {
  /**
   * `handle_target_space` sets `did_something = true` for **every** targeting
   * mode but FANCY, and it does so whether or not any of its four branches
   * fired (boe.actions.cpp:888). Plain `MODE_COMBAT` is none of the four — it
   * is what a player gets for clicking a square after a shot that never armed —
   * so the click does nothing *and costs the turn anyway*.
   *
   * In combat that turn goes to `combat_next_step`, which is what hands the
   * round to the next PC. This port only charged it in town, so a PC who
   * clicked a square with no action points left kept the turn: in `VoDT-5-11`
   * Lenny armed a missile on 0 AP, the C++ moved on to Bart, and from there
   * every PC was one behind — eighteen actions later the spells the recording
   * meant for Kat were being cast by Adrianna, who could not afford them.
   */
  it('costs the turn, so a spent PC does not keep it', async () => {
    const session = await newGame();
    const univ = session.univ;
    expect(session.startCombat(Direction.N)).toBe(true);

    // Spent, but not the whole party: `pick_next_pc` has to have somewhere to
    // go, or it starts a fresh round and the assertion below passes for the
    // wrong reason.
    const spent = univ.curPc;
    univ.currentPc.ap = 0;
    expect(univ.party.pcs.some((p, i) => i !== spent && p.isAlive && p.ap > 0)).toBe(true);

    const target = univ.currentPc.combatPos;
    await runReplay(session, {
      seed: null, scenario: null, featureFlags: null,
      actions: [{
        type: 'handle_target_space',
        text: '',
        info: { destination: `(${target.x},${target.y})`, num_targets_left: '0' },
      }],
    });
    await session.settled();

    expect(univ.curPc).not.toBe(spent);
  });
});
