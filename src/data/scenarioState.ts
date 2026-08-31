/**
 * The scenario's own mutable state, and how to put it back the way it was.
 *
 * **Why this exists.** A scenario record is not read-only while a game runs:
 * `alter_space` writes doors open in `town.terrain`, exploring writes `maps`,
 * picking a preset item writes `itemTaken`, a special writes `canFind`, and
 * killing things writes `monstersKilled`. The C++ gets away with that because
 * **`load_party_v2` reloads the whole scenario from disk** every time
 * (fileio_party.cpp:448, `load_scenario(path, univ.scenario, FULL)`) into a
 * scratch universe, so a load always starts from the file's own values and the
 * save's pages are then laid on top. This port parses a scenario once and hands
 * the same object to every game, so without this the *previous* game's changes
 * survive a load.
 *
 * That is not a theoretical leak. It cost a replay divergence found 2026-08-31:
 * a save made in Za-Khazi's town 15 carried a door at (14,21) already open
 * (terrain 146). Loading it wrote 146 into the shared record, and it stayed
 * there — so on the *next* visit this port walked straight through a doorway
 * the C++ still had shut (terrain 142, `step-change`). The C++ opened it on the
 * first step and refused the move, as `CHANGE_WHEN_STEP_ON` does for blocking
 * terrain, and walked through on the second. One turn's difference in the
 * party's position, and every `dist(monster, party) <= 8` notice check after it
 * disagreed.
 *
 * The snapshot is the pristine parse, taken by `loadScenario`; `applySave`
 * restores it before reading anything. Only the fields a *game* writes are
 * copied — the rest of the record is immutable content and sharing it is the
 * point.
 */

import { Scenario } from './scenario';

interface TownState {
  terrain: number[][];
  maps: Uint8Array[];
  itemTaken: boolean[];
  doorUnlocked: { x: number; y: number }[];
  canFind: boolean;
  monstersKilled: number;
  difficulty: number;
}

interface SectorState {
  terrain: number[][];
  maps: Uint8Array[];
}

export interface ScenarioState {
  towns: TownState[];
  /** sectors[x][y], matching `Scenario.outdoors`. */
  sectors: SectorState[][];
}

const copyGrid = (g: number[][]): number[][] => g.map((col) => col.slice());
const copyMaps = (m: Uint8Array[]): Uint8Array[] => m.map((col) => Uint8Array.from(col));

export function captureScenarioState(scen: Scenario): ScenarioState {
  return {
    towns: scen.towns.map((town) => ({
      terrain: copyGrid(town.terrain),
      maps: copyMaps(town.maps),
      itemTaken: town.itemTaken.slice(),
      doorUnlocked: town.doorUnlocked.map((d) => ({ ...d })),
      canFind: town.canFind,
      monstersKilled: town.monstersKilled,
      difficulty: town.difficulty,
    })),
    sectors: scen.outdoors.map((col) => col.map((sector) => ({
      terrain: copyGrid(sector.terrain),
      maps: copyMaps(sector.maps),
    }))),
  };
}

/**
 * Put the record back to `state`. **In place**, because everything already
 * holds references into it — `CurTown.record`, the renderer, the specials VM.
 */
export function restoreScenarioState(scen: Scenario, state: ScenarioState): void {
  for (let i = 0; i < scen.towns.length; i++) {
    const town = scen.towns[i];
    const saved = state.towns[i];
    if (!town || !saved) continue;
    for (let x = 0; x < town.terrain.length; x++) {
      const col = saved.terrain[x];
      if (col) town.terrain[x] = col.slice();
      const map = saved.maps[x];
      if (map) town.maps[x] = Uint8Array.from(map);
    }
    town.itemTaken = saved.itemTaken.slice();
    town.doorUnlocked = saved.doorUnlocked.map((d) => ({ ...d }));
    town.canFind = saved.canFind;
    town.monstersKilled = saved.monstersKilled;
    town.difficulty = saved.difficulty;
  }
  for (let x = 0; x < scen.outdoors.length; x++) {
    for (let y = 0; y < (scen.outdoors[x]?.length ?? 0); y++) {
      const sector = scen.outdoors[x]![y];
      const saved = state.sectors[x]?.[y];
      if (!sector || !saved) continue;
      for (let i = 0; i < sector.terrain.length; i++) {
        const col = saved.terrain[i];
        if (col) sector.terrain[i] = col.slice();
        const map = saved.maps[i];
        if (map) sector.maps[i] = Uint8Array.from(map);
      }
    }
  }
}
