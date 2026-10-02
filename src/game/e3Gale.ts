/**
 * Gale's guards, from `FUN_10c0_61c4` (`10c0:6e4b`), E3's per-tick code.
 * Three people in Gale send for them (`tools/e3convert/towns/talkStart.ts`):
 * a townsperson the party won't pay off, and the mayor and the garrison
 * commander once the party is known there. Each sets party+0x14b, a flag
 * byte, to 25, and every tick after that:
 *
 * - in a town (`is_town()`, `FUN_1038_0147`: the town modes, so not a
 *   fight) and in one of Gale's four records, it falls by one, and at 0
 *   comes the scenario's `escort` node: the guards' two messages and the
 *   cell (`FUN_10c0_46a4(0x12, 0x2f, 1)`);
 * - in any other town it goes back to 0, and the guards forget;
 * - outdoors, or in a fight, it waits.
 *
 * So leaving Gale only helps if the party then goes into another town.
 *
 * The node is named by the feature flag `escort` =
 * `exile3:<node>:<town>,<town>…`, an blades-of-exile-ts extension; without it
 * nothing ticks. The countdown spends no dice.
 */

import type { GameSession } from './session';

/** party+0x14b, flag (19, 9) by party+0x84+10a+b. */
export const GALE_ESCORT: [number, number] = [19, 9];

function escortFlag(session: GameSession): { node: number; towns: number[] } | null {
  const flag = session.univ.scenario.featureFlags['escort'];
  const m = flag === undefined ? null : /^exile3:(\d+):([\d,]+)$/.exec(flag);
  if (!m) return null;
  return { node: Number(m[1]), towns: m[2]!.split(',').map(Number) };
}

/**
 * Each tick from `ageBefore + 1` to now, as `e3WithdrawalTick` steps its
 * clock: this port's clock can jump several ticks at once. `fire` runs the
 * guards' node, as a scenario timer's.
 */
export function e3GaleTick(session: GameSession, ageBefore: number, fire: (node: number, at: number) => void): void {
  const escort = escortFlag(session);
  if (!escort) return;
  const party = session.univ.party;
  // Read once: a queued `fire` winds `party.age` back to `j`.
  const age = party.age;
  for (let j = ageBefore + 1; j <= age; j++) {
    if (!session.inTown) continue;
    const left = party.getSdf(...GALE_ESCORT);
    if (left === 0 || !escort.towns.includes(party.townNum)) {
      party.setSdf(...GALE_ESCORT, 0);
      continue;
    }
    party.setSdf(...GALE_ESCORT, left - 1);
    if (left === 1) fire(escort.node, j);
  }
}
