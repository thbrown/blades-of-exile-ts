/**
 * The pop-out map's grid: the whole continent as the party knows it, and
 * nothing more. Also `enter_scenario`'s `can_find = !is_hidden`, which the
 * map made visible: without it every town entrance was erased outdoors.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { SECTOR_SIZE } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { buildMapGrid } from '../src/render/worldMap';
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

function newGame(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

/** Every square explored, in every sector and in the live window. */
function exploreEverything(s: GameSession): void {
  for (const col of s.univ.scenario.outdoors) for (const sec of col) for (const row of sec.maps) row.fill(1);
  for (const row of s.univ.out.explored) row.fill(1);
}

describe('enter_scenario', () => {
  it('makes a town findable unless the scenario hides it', () => {
    const s = newGame();
    const town = (name: string) => s.univ.scenario.towns.find((t) => t.name === name)!;
    expect(town('Fort Talrus').canFind).toBe(true);
    expect(town('Small Cave').isHidden).toBe(true);
    expect(town('Small Cave').canFind).toBe(false);
  });
});

describe('buildMapGrid', () => {
  it('shows the town the game starts in, with the party on it', () => {
    const grid = buildMapGrid(newGame());
    expect(grid.place).toBe('Fort Talrus');
    expect(grid.note).toBeNull();
    expect(grid.party).not.toBeNull();
    const explored = grid.terrain.filter((t) => t >= 0).length;
    expect(explored).toBeGreaterThan(0);
    expect(explored).toBeLessThan(grid.w * grid.h);
  });

  it('shows the whole continent outdoors, dark where unexplored', () => {
    const s = newGame();
    s.debugLeaveTown();
    const grid = buildMapGrid(s);
    expect(grid.place).toBe('Outdoors');
    expect([grid.w, grid.h]).toEqual([scen.outWidth * SECTOR_SIZE, scen.outHeight * SECTOR_SIZE]);
    const p = grid.party!;
    expect(grid.terrain[p.y * grid.w + p.x]).toBeGreaterThanOrEqual(0);
    expect(grid.terrain.filter((t) => t < 0).length).toBeGreaterThan(grid.w * grid.h / 2);
    expect(grid.labels.map((l) => l.text)).toContain('Fort Talrus');
    expect(grid.labels.map((l) => l.text)).not.toContain('Marralis');
  });

  it('labels each findable town once and never gives a hidden one away', () => {
    const s = newGame();
    s.debugLeaveTown();
    exploreEverything(s);
    const grid = buildMapGrid(s);
    const towns = grid.labels.filter((l) => l.kind === 'town').map((l) => l.text);
    expect(towns.filter((t) => t === 'School Entry')).toHaveLength(1);
    expect(towns).not.toContain('Small Cave');
    // Every entrance square of a hidden town reads as its flag1 terrain,
    // whether its sector is in the live window or not.
    for (let sx = 0; sx < scen.outWidth; sx++) {
      for (let sy = 0; sy < scen.outHeight; sy++) {
        for (const city of scen.outdoors[sx]![sy]!.cityLocs) {
          const town = scen.towns[city.spec];
          if (!town) continue;
          const ter = grid.terrain[(sy * SECTOR_SIZE + city.y) * grid.w + sx * SECTOR_SIZE + city.x]!;
          const isEntrance = s.univ.terrainType(ter).special === TerSpec.TOWN_ENTRANCE;
          if (!town.canFind) expect(isEntrance, town.name).toBe(false);
        }
      }
    }
  });

  it('has nothing to show in an outdoor fight', () => {
    const s = newGame();
    s.debugLeaveTown();
    s.mode = GameMode.COMBAT;
    s.whichCombatType = 0;
    expect(buildMapGrid(s).note).toBe('No map in combat.');
  });
});
