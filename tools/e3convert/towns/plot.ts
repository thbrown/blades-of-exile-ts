/**
 * Exile 3's plot clock: what its turn code (`FUN_1010_5889`, near
 * `exile3.c:6290`) does when the day changes. Run by the converter's daily
 * timer (`SpecBuilder.dailyReset`), at the start of each day.
 *
 * - Past day 74, or once the Filth Factory has burned (0xc87), 0xc90 is set
 *   (the roaches' plague is over, or the time for it); from then on flag
 *   0x23b is set and the Murder Cave (town 86) is on the map.
 * - Past day 109, or at war with the troglodytes (0xc8a), 0xc92 is set.
 * - Past day 159, unless the party is in the Tower of Magi (24), the demon
 *   plot starts (0xc91 = 1).
 *
 * TODO(E3-3): what else it does — forgetting the four saved towns when 0xc90
 * is set, the demon plot's countdown (party+0x850f from 2000, with events at
 * eight of its values, `exile3.c` near line 61540), the job bank's deadlines
 * (party+0x832f, four of them), and a daily 1-in-50 chance per PC of clearing
 * party+0x847f + i.
 */

import { partyFlag as f, type SpecBuilder, type Step } from '../script';
import { DEMON_PLOT } from './towerOfMagi';
import { ostothDay } from './newCotra';
import { townStatesPlot } from './townStates';

export const ROACHES_DONE = f(0xc90);
export const LATE_WAR = f(0xc92);
const FACTORY_BURNED = f(0xc87);
const TROGLO_WAR = f(0xc8a);

/** `if (calc_day() > day || flag)`: `calc_day()` itself, without day_reached's 20. */
function afterDayOr(b: SpecBuilder, day: number, flag: [number, number], then: Step[]): Step {
  return b.ifDayReached(day + 1, then, [b.ifFlagAtLeast(flag, 1, then)]);
}

export function dailyPlot(b: SpecBuilder): Step[] {
  return [
    b.ifFlagEq(ROACHES_DONE, 0, [afterDayOr(b, 74, FACTORY_BURNED, [b.setFlag(ROACHES_DONE, 1)])]),
    b.ifFlagAtLeast(ROACHES_DONE, 1, [b.setFlag(f(0x23b), 1), b.townVisible(86)]),
    b.ifFlagEq(LATE_WAR, 0, [afterDayOr(b, 109, TROGLO_WAR, [b.setFlag(LATE_WAR, 1)])]),
    b.ifFlagEq(DEMON_PLOT, 0, [b.ifDayReached(160, [b.ifTown(24, [], [b.setFlag(DEMON_PLOT, 1)])])]),
    // Not E3's own: the converter's day counts (`towns/newCotra.ts`).
    ostothDay(b),
    // Not the turn code's: E3's town loader tests these as the party enters
    // (`towns/townStates.ts`).
    ...townStatesPlot(b),
  ];
}
