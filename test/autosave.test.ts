import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { AutosaveWhy, setAutosaveSink, tickAutoSave, tryAutoSave } from '../src/game/autosave';
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
});

/** Collects the reasons that get through to the host. */
function watch(): AutosaveWhy[] {
  const seen: AutosaveWhy[] = [];
  setAutosaveSink((reason) => seen.push(reason));
  return seen;
}

describe('milestones', () => {
  it('passes a milestone straight to the host', () => {
    const seen = watch();
    tryAutoSave('QuestComplete');
    tryAutoSave('Journal');
    expect(seen).toEqual(['QuestComplete', 'Journal']);
  });

  it('does nothing at all with no host installed', () => {
    expect(() => tryAutoSave('Journal')).not.toThrow();
  });

  it("doesn't make a milestone of walking into a town, or out", async () => {
    const seen = watch();
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    session.endTownMode({ x: 0, y: 0 });
    expect(seen.filter((why) => why !== 'Tick')).toEqual([]);
  });
});

describe('the tick', () => {
  it('fires on every move: there is no switch', () => {
    const seen = watch();
    for (let i = 0; i < 3; i++) tickAutoSave();
    expect(seen).toEqual(['Tick', 'Tick', 'Tick']);
  });

  it('ticks indoors as well as outdoors', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    expect(session.inTown).toBe(true);
    const seen = watch();
    const { increaseAgeEffects } = await import('../src/game/increaseAge');
    await increaseAgeEffects(session);
    expect(seen).toContain('Tick');
  });

  it('comes from taking a step in the game, and costs no random numbers', async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    await session.startNewGame();
    session.endTownMode({ x: 0, y: 0 });
    const seen = watch();
    const { increaseAgeEffects } = await import('../src/game/increaseAge');
    await increaseAgeEffects(session);
    expect(seen).toContain('Tick');
  });
});
