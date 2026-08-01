import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  AUTOSAVE_TRIGGER_DEFAULTS, AutosaveReason, DEFAULT_AUTOSAVE_PREFS,
  autosaveTriggerOn, setAutosavePrefs, setAutosaveSink, tryAutoSave,
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
function watch(): AutosaveReason[] {
  const seen: AutosaveReason[] = [];
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
    setAutosavePrefs({ enabled: true, triggers: { Eat: true, EnterTown: false }, max: 5 });
    expect(autosaveTriggerOn('Eat')).toBe(true);
    expect(autosaveTriggerOn('EnterTown')).toBe(false);
  });

  it('the master switch silences all of them', () => {
    const seen = watch();
    setAutosavePrefs({ enabled: false, triggers: {}, max: 5 });
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
    const seen = watch();
    session.univ.party.food = 0; // "Rest: Not enough food."
    expect(session.rest()).toBe(false);
    expect(seen).toEqual([]);
    session.univ.party.food = 100;
    expect(session.rest()).toBe(true);
    expect(seen).toEqual(['RestComplete']);
  });
});
