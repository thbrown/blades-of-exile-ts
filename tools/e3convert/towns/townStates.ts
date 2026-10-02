/**
 * The five towns that decline as the plague spreads: Krizsan (records 0–3),
 * Shayder (4–7), Sharimik (8–11), Lorelei (12–15) and Gale (16–19). Each is
 * one town in four records, and every entrance names the first. E3's town
 * loader (`FUN_10d8_0107`, its 26-town table at 10d8:2333) swaps the record
 * before loading it: three `day_reached(day, event)` tests in order, each
 * passing one choosing the next record. It also re-homes the party's horses
 * stabled in any of the four records to the one it chose.
 *
 * Here the daily plot (`towns/plot.ts`) runs the same tests into a state
 * flag, and a scenario `<town-flag>` adds that flag to the first record's
 * number, as OBoE's town replacement does. The tests are monotone (a later
 * day implies an earlier one, and so does the event), so testing at the start
 * of each day is testing on entry.
 *
 * E3 re-homes the horses from all four records and never the boats, where
 * OBoE's town replacement moves horses and boats from the first record
 * alone; the `<town-flag>`'s `span="4" rehome="horses"` (this port's own,
 * DIVERGENCES.md #26) ask for E3's. So Krizsan's two boats stay in record 0's
 * shipyard, which the later records show ruined, and a horse left in a
 * middle state follows the town on.
 */

import { e3TownState } from '../flags';
import type { SpecBuilder, Step } from '../script';

export interface TownStates {
  /** The first record, which every entrance names. */
  town: number;
  /** The plot event that halts the decline (`key_times`, `setEvent`). */
  event: number;
  /** E3's days (`day_reached` adds 20) for records `town + 1`, `+ 2`, `+ 3`. */
  days: [number, number, number];
}

/** The cases at 10d8:018a, 0222, 02ba, 0354 and 0406. */
export const TOWN_STATES: TownStates[] = [
  { town: 0, event: 0, days: [10, 25, 55] },
  { town: 4, event: 1, days: [50, 70, 105] },
  { town: 8, event: 2, days: [95, 130, 170] },
  { town: 12, event: 2, days: [120, 165, 210] },
  { town: 16, event: 3, days: [140, 200, 250] },
];

/** Gale's four records (`e3GaleTick`'s towns): E3 tests `c_town`'s number, 16 to 19. */
export const GALE_TOWNS: readonly number[] = [16, 17, 18, 19];

/** The daily plot's part: each group's state, from its three tests in E3's order. */
export function townStatesPlot(b: SpecBuilder): Step[] {
  return TOWN_STATES.flatMap((g, k) => g.days.map((day, i) =>
    b.ifE3DayReached(day, g.event, [b.setFlag(e3TownState(k), i + 1)])));
}

/** `<town-flag>` entries for scenario.xml. */
export function townStatesXml(): string {
  return TOWN_STATES.map((g, k) => {
    const [x, y] = e3TownState(k);
    return `        <town-flag town="${g.town}" add-x="${x}" add-y="${y}" span="4" rehome="horses" />\n`;
  }).join('');
}
