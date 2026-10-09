/**
 * Scenario data — the subset of cScenario (scenario.hpp) needed so far.
 * Grows as milestones land: items/monsters/towns arrive with M1-M2,
 * quests/shops with M3+.
 */

import { Item } from './item';
import { Monster } from './monster';
import { Sector } from './outdoors';
import { Quest, SpecItem } from './quest';
import { Shop } from './shop';
import { SpecialNode } from './special';
import { Speech } from './talking';
import { Terrain } from './terrain';
import type { ScenarioState } from './scenarioState';
import { Timer, Town } from './town';
import { Vehicle } from './vehicle';

/**
 * One `<town-flag>`: entering town `spec` enters `spec + PSD[x][y]`.
 * `span` and `rehome` are this port's own, for Exile III (DIVERGENCES.md
 * #26): which vehicles follow the party's town — OBoE's, horses and boats
 * stabled in `spec` alone; E3's, horses from all `span` records and never
 * boats.
 */
export interface TownMod {
  spec: number;
  x: number;
  y: number;
  span?: number;
  rehome?: 'horses';
}

export interface Scenario {
  /**
   * The scenario's directory name (`ScenarioSource.id`) — the string a save
   * file records so it can find this scenario again on load. Not part of the
   * scenario data itself, which is why it isn't in the header.
   */
  id: string;
  title: string;
  teasers: string[];
  introMsgs: string[];
  /**
   * `intro_pic` — the scenario's own icon (`<icon>`), which doubles as
   * `intro_mess_pic`: the picture a message node without one of its own shows
   * (fileio_scen.cpp:801, handle_message's `pic == -1` arm).
   */
  introPic: number;
  /**
   * `intro_mess_pic` — the picture on the intro dialog, `<text><icon>` in the
   * XML; `intro_pic` when absent (fileio_scen.cpp:802), as in every legacy one.
   */
  introMessPic?: number;
  numTowns: number;
  outWidth: number;
  outHeight: number;
  startTown: number;
  /** 0-3, one lower than the 1-4 the file carries (fileio_scen.cpp:846). */
  difficulty: number;
  /** Whether monster health scales with the party's total level. */
  adjustDiff: boolean;
  /**
   * `cScenario::is_legacy` — the scenario came from a 1997 `.exs` and hasn't
   * been re-saved by OBoE's editor. A handful of rules keep their original
   * behaviour for it (`univ.scenario.is_legacy` in the C++). The four bundled
   * scenarios were re-saved and say `<legacy>false</legacy>`.
   */
  isLegacy: boolean;
  /**
   * `cScenario::feature_flags` (`<feature-flags>` in scenario.xml) — **the
   * scenario's own flags, not the replay's.** The C++ has two feature-flag maps
   * that are easy to confuse: the global one a recording replaces wholesale
   * (`has_feature_flag`, boe.global.hpp:38) and this one, which a *scenario*
   * ships and which `get_feature_version` prefers when a scenario is loaded.
   * `push_things` reads this one directly
   * (`univ.scenario.get_feature_flag("conveyor-belts") == "V2"`,
   * boe.specials.cpp:1743), so a recording that never mentions conveyor belts
   * still gets V2 belts when it is playing Za-Khazi.
   */
  featureFlags: Record<string, string>;
  townStart: { x: number; y: number };
  /**
   * `out_sec_start` — the *sector* the party starts in. The XML tag it is read
   * from is `<outdoor-start>`, and `<sector-start>` holds the square within it
   * (fileio_scen.cpp:907): the two names are the wrong way round in the format,
   * and both this port and the C++ read them as written.
   */
  outdoorStart: { x: number; y: number };
  /** `out_start` — the 0..47 square inside `outdoorStart`'s sector. */
  sectorStart: { x: number; y: number };
  terTypes: Terrain[];
  scenItems: Item[];
  scenMonsters: Monster[];
  towns: Town[];
  townTalk: Speech[];
  /** outdoors[x][y] — sector grid, x < outWidth, y < outHeight. */
  outdoors: Sector[][];
  scenSpecials: Map<number, SpecialNode>;
  shops: Shop[];
  /** cSpecItem definitions — the quest items, indexed by special-item number. */
  specialItems: SpecItem[];
  /** cQuest definitions; the party's own progress lives in Party.activeQuests. */
  quests: Quest[];
  /** scenario_timers — a node that fires every `time` days, scenario-wide. */
  scenarioTimers: Timer[];
  initSpec: number;
  specStrs: string[];
  /**
   * `cScenario::journal_strs` — the events journal's entries. OBoE reads them
   * and never adds one; the blades-of-exile-ts opcode `journal` (48) does.
   */
  journalStrs: string[];
  /**
   * `cScenario::town_mods` — up to ten `<town-flag>` entries, each redirecting
   * one town number by the value of a Stuff Done Flag (boe.town.cpp:99).
   */
  townMods: TownMod[];
  /**
   * `store_item_rects` by `store_item_towns`: each town's storage rects. BoE
   * gives a town one; a town may have more here (Exile III's Fort Emergence
   * keeps two corners), and an item in any of them is kept.
   */
  storeItemRects: Map<number, { top: number; left: number; bottom: number; right: number }[]>;
  /** The scenario's boat/horse templates, by vehicle number (fileio_scen.cpp). */
  boats: Vehicle[];
  horses: Vehicle[];
  /**
   * The record's mutable state exactly as it was parsed, so `applySave` can put
   * it back — the C++ gets the same thing by reloading the scenario from disk on
   * every load. `loadScenario` fills this in; see `data/scenarioState.ts`.
   */
  pristine?: ScenarioState;
}

/**
 * get_ter_from_ground (scenario.cpp:341) — the terrain type that represents a
 * ground type, preferring the one flagged as its archetype.
 */
export function terFromGround(scen: Scenario, ground: number): number {
  let fallback = -1;
  for (let i = 0; i < scen.terTypes.length; i++) {
    const ter = scen.terTypes[i]!;
    if (ter.groundType !== ground) continue;
    if (ter.isArchetype) return i;
    if (fallback < 0) fallback = i;
  }
  return Math.max(fallback, 0);
}

/** get_ground_from_ter (scenario.cpp:337). */
export function groundFromTer(scen: Scenario, ter: number): number {
  return terFromGround(scen, scen.terTypes[ter]!.groundType);
}
