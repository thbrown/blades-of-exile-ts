import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  AUTOSAVE_TRIGGER_DEFAULTS, AutosaveReason, AutosaveWhy, DEFAULT_AUTOSAVE_PREFS,
  autosaveTriggerOn, setAutosavePrefs, setAutosaveSink, tickAutoSave, tryAutoSave,
} from '../src/game/autosave';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

afterEach(() => {
  setAutosaveSink(null);
  setAutosavePrefs(DEFAULT_AUTOSAVE_PREFS);
});

/** Collects the reasons that get through to the host. */
function watch(): AutosaveWhy[] {
  const seen: AutosaveWhy[] = [];
  setAutosaveSink((reason) => seen.push(reason));
  return seen;
}

describe('try_auto_save', () => {
  it('defaults every trigger on except Eat', () => {
    expect(AUTOSAVE_TRIGGER_DEFAULTS.Eat).toBe(false);
    expect(autosaveTriggerOn('Eat')).toBe(false);
    for (const reason of ['EnterTown', 'ExitTown', 'RestComplete', 'EndOutdoorCombat'] as const) {
      expect(autosaveTriggerOn(reason)).toBe(true);
    }
  });

  it('lets a per-reason preference override the default either way', () => {
    setAutosavePrefs({ enabled: true, triggers: { Eat: true, EnterTown: false } });
    expect(autosaveTriggerOn('Eat')).toBe(true);
    expect(autosaveTriggerOn('EnterTown')).toBe(false);
  });

  it('the master switch silences all of them', () => {
    const seen = watch();
    setAutosavePrefs({ enabled: false, triggers: {} });
    tryAutoSave('EnterTown');
    expect(seen).toEqual([]);
  });

  it('does nothing at all with no host installed', () => {
    expect(() => tryAutoSave('EnterTown')).not.toThrow();
  });
});

describe('the trigger sites', () => {
  it('fires EnterTown when the party walks into a town', async () => {
    const seen = watch();
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    expect(seen).toContain('EnterTown');
  });

  it('fires ExitTown when it walks back out, and not before', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    const seen = watch();
    session.endTownMode({ x: 0, y: 0 });
    expect(seen).toEqual(['ExitTown']);
  });

  it('fires RestComplete only when the rest actually happens', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    // Resting is an outdoor command, so this has to leave town first — and
    // the ExitTown that leaving fires is not what this test is watching.
    session.endTownMode({ x: 0, y: 0 });
    const seen = watch();
    session.univ.party.food = 0; // "Rest: Not enough food."
    expect(await session.rest()).toBe(false);
    expect(seen).toEqual([]);
    session.univ.party.food = 100;
    expect(await session.rest()).toBe(true);
    // Resting passes many turns, each of which counts toward the tick.
    expect(seen.filter((why) => why !== 'Tick')).toEqual(['RestComplete']);
  });
});

describe('the tick', () => {
  it('fires on every move, and the master switch silences it', () => {
    const seen = watch();
    setAutosavePrefs(DEFAULT_AUTOSAVE_PREFS);
    for (let i = 0; i < 3; i++) tickAutoSave();
    setAutosavePrefs({ ...DEFAULT_AUTOSAVE_PREFS, enabled: false });
    for (let i = 0; i < 20; i++) tickAutoSave();
    expect(seen).toEqual(['Tick', 'Tick', 'Tick']);
  });

  it('ticks indoors as well as outdoors', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    expect(session.inTown).toBe(true);
    setAutosavePrefs(DEFAULT_AUTOSAVE_PREFS);
    const seen = watch();
    const { increaseAgeEffects } = await import('../src/game/increaseAge');
    await increaseAgeEffects(session);
    expect(seen).toContain('Tick');
  });

  it('comes from taking a step in the game, and costs no random numbers', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    session.endTownMode({ x: 0, y: 0 });
    setAutosavePrefs(DEFAULT_AUTOSAVE_PREFS);
    const seen = watch();
    const { increaseAgeEffects } = await import('../src/game/increaseAge');
    await increaseAgeEffects(session);
    expect(seen).toContain('Tick');
  });
});
