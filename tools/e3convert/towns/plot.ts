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
 *   plot starts (0xc91 = 1) and its countdown with it (`demonCountdown`).
 * - As 0xc90 is set, the four saved towns are forgotten (`forget-towns`).
 *
 * The job boards' deadlines and their daily 1-in-51 forgiveness
 * (party+0x847f + i) are the engine's, `e3JobsTick`.
 */

import { partyFlag as f, type SpecBuilder, type Step } from '../script';
import { DEMON_COUNT_HI, DEMON_COUNT_LO, DEMON_PLOT } from './towerOfMagi';
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

/**
 * The demon plot's countdown (party+0x850f, `FUN_10c0_61c4` from
 * `10c0:63e8`): 2000 turns from the plot's start. At seven of its values
 * Anaximander's reports (block 14, "Disturbing event.") tell of Grah-Hoth
 * drawing nearer, the fourth only away from the overrun Tower (town 25); at
 * 1, away from the Tower, it is over (dialog 0x80a, and the party is lost).
 * In the Tower, every 220 turns Grah-Hoth speaks (block 57, flag 0x183
 * counting), and the second and third time the party is hurt.
 */
function demonCountdown(b: SpecBuilder): Step {
  const TOWER = 25;
  const report = (a: number): Step[] => [b.titledMsg(0xe, a, 0x10c0, 0x6025, 0x2c9)];
  const at = new Map<number, Step[]>([
    [1997, report(0x41)], [1697, report(0x42)], [1497, report(0x43)],
    [1197, [b.ifTown(TOWER, [], report(0x44))]],
    [997, report(0x45)], [697, report(0x46)], [397, report(0x47)],
    [1, [b.ifTown(TOWER, [], [b.dialog(0x80a), b.slayParty(0)])]],
  ]);
  const tally = f(0x183);
  const speaks = (a: number, off: number, hurt: Step[]): Step[] => [b.titledMsg(0x39, a, 0x10c0, off, 0x2c9), ...hurt];
  for (let v = 0; v < 2000; v += 220) {
    at.set(v, [b.ifTown(TOWER, [b.incFlag(tally),
      b.ifFlagEq(tally, 1, speaks(0x13, 0x60a3, [])),
      b.ifFlagEq(tally, 2, speaks(0x14, 0x60b5, [b.damageAll(25, 3)])),
      b.ifFlagEq(tally, 3, speaks(0x15, 0x60c7, [b.damageAll(40, 1)])),
    ])]);
  }
  return b.turnCountdown(DEMON_COUNT_HI, DEMON_COUNT_LO, 2000, at);
}

export function dailyPlot(b: SpecBuilder): Step[] {
  return [
    b.ifFlagEq(ROACHES_DONE, 0, [afterDayOr(b, 74, FACTORY_BURNED, [b.forgetTowns(), b.setFlag(ROACHES_DONE, 1)])]),
    b.ifFlagAtLeast(ROACHES_DONE, 1, [b.setFlag(f(0x23b), 1), b.townVisible(86)]),
    b.ifFlagEq(LATE_WAR, 0, [afterDayOr(b, 109, TROGLO_WAR, [b.setFlag(LATE_WAR, 1)])]),
    b.ifFlagEq(DEMON_PLOT, 0, [b.ifDayReached(160, [b.ifTown(24, [], [b.setFlag(DEMON_PLOT, 1), demonCountdown(b)])])]),
    // Not E3's own: the converter's day counts (`towns/newCotra.ts`).
    ostothDay(b),
    // Not the turn code's: E3's town loader tests these as the party enters
    // (`towns/townStates.ts`).
    ...townStatesPlot(b),
  ];
}
