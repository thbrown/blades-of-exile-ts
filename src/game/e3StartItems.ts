/**
 * Exile III's starting gear, in place of BoE's `finish_create` presets.
 *
 * E3's new game (`FUN_1010_6b20` at `1010:6bbe`) gives every living PC two
 * items from its own table by species, worn and identified; then, on
 * `get_ran(1,0,1) == 0`, a third, `get_ran(1,0,11)` into a pool of twelve
 * (weak poison, lockpicks, two scrolls, four weak potions, torches,
 * throwing knives, gauntlets, boots), identified and not worn. A PC made
 * mid-game (`10b0:12bf`) gets the two and no roll. The first two are BoE's
 * presets by another name (a bronze knife and crude buckler, a cavewood bow
 * and arrows, a stone spear and leather helm), but E3's own records.
 *
 * The tables are the `start-items` = `exile3:<six>;<twelve>` feature flag,
 * which the converter reads out of E3's data segment (`readE3StartItems`).
 */

import type { Item } from '../data/item';
import type { Scenario } from '../data/scenario';
import { BASIC_SPELLS, type Player } from '../universe/player';
import type { Universe } from '../universe/universe';

interface E3StartItems {
  /** Human, Nephil, Slith: slots 0 and 1. */
  bySpecies: [number, number][];
  bonus: number[];
}

function startItems(univ: Universe): E3StartItems | null {
  const m = /^exile3:([\d,]+);([\d,]+)$/.exec(univ.scenario.featureFlags['start-items'] ?? '');
  if (m === null) return null;
  const pairs = m[1]!.split(',').map(Number);
  return {
    bySpecies: [0, 2, 4].map((i) => [pairs[i] ?? -1, pairs[i + 1] ?? -1]),
    bonus: m[2]!.split(',').map(Number),
  };
}

/** The scenario's item `n`, a fresh copy, identified as E3 marks it. */
function e3Item(univ: Universe, n: number): Item | null {
  const template = univ.scenario.scenItems[n];
  return template ? { ...template, ident: true } : null;
}

/**
 * E3's gear for `pc`, who has just been through `finishCreate`: its two
 * items replace BoE's presets, and with `newGame` the bonus item is rolled
 * for. A species E3 hasn't (a Vahnatai brought in from Blades of Exile)
 * keeps BoE's pair, but still rolls, as E3 rolls for every living PC.
 * Does nothing outside Exile III.
 */
export function giveE3StartItems(univ: Universe, pc: Player, newGame: boolean): void {
  const table = startItems(univ);
  if (table === null) return;
  const pair = table.bySpecies[pc.race];
  if (pair) {
    pair.forEach((n, slot) => {
      const item = e3Item(univ, n);
      if (!item) return;
      pc.items[slot] = item;
      pc.equip[slot] = true;
    });
  }
  if (!newGame) return;
  if (univ.rng.getRan(1, 0, 1) !== 0) return;
  const item = e3Item(univ, table.bonus[univ.rng.getRan(1, 0, 11)] ?? -1);
  if (item) pc.items[2] = item;
}

/**
 * Exile III's starting spells: the first thirty of each school as E3's
 * template PC record has them (`DS:294e` mage, `DS:296c` priest, the record
 * a new PC is copied from), where BoE gives all thirty (`BASIC_SPELLS`).
 * E3's shops sell the rest (Velnas's True Sight, Identify…). The
 * `start-spells` = `exile3:<mage>;<priest>` feature flag lists those known,
 * which the converter reads out of E3's data segment. Null outside
 * Exile III.
 */
export function e3StartSpells(scenario: Scenario): { mage: Set<number>; priest: Set<number> } | null {
  const m = /^exile3:([\d,]*);([\d,]*)$/.exec(scenario.featureFlags['start-spells'] ?? '');
  if (m === null) return null;
  const set = (s: string) => new Set(s.split(',').filter((x) => x !== '').map(Number));
  return { mage: set(m[1]!), priest: set(m[2]!) };
}

/** `pc` knows E3's starting spells of the first thirty, as a new PC does there. Nothing elsewhere. */
export function giveE3StartSpells(univ: Universe, pc: Player): void {
  const known = e3StartSpells(univ.scenario);
  if (known === null) return;
  for (let i = 0; i < BASIC_SPELLS; i++) {
    pc.mageSpells[i] = known.mage.has(i);
    pc.priestSpells[i] = known.priest.has(i);
  }
}
