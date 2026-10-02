/**
 * Exile III's draining towns. An blades-of-exile-ts extension, not in BoE or OBoE: a
 * scenario with the feature flag `sp-drain` set to `exile3:<towns>` runs
 * this at the end of every turn and every combat round (DIVERGENCES.md #38).
 * In Exile III the towns are the Tower of Zkal's two levels, 70 and 71,
 * whose first message says so: "You feel the magical energy slowly leaking
 * out of your minds."
 *
 * E3's per-turn code (`FUN_10c0_61c4`, `10c0:7100`), after the moving
 * walls: in one of the towns, in town mode or a fight there, on a turn
 * whose age is a multiple of 5 (the whole long, `idiv` by 5), every one of
 * the six PCs, alive or not, loses 5 spell points, or all of them if 5 or
 * fewer are left. No message, and no draw.
 */

import type { GameSession } from './session';

function drainTowns(session: GameSession): Set<number> | null {
  const flag = session.univ.scenario.featureFlags['sp-drain'];
  const m = flag?.match(/^exile3:([\d,]+)$/);
  return m ? new Set(m[1]!.split(',').map(Number)) : null;
}

export function e3SpDrainTick(session: GameSession): void {
  const { univ } = session;
  const towns = drainTowns(session);
  if (!towns || session.isOutdoors || !towns.has(univ.party.townNum)) return;
  if (univ.party.age % 5 !== 0) return;
  for (const pc of univ.party.pcs) pc.curSp = pc.curSp > 5 ? pc.curSp - 5 : 0;
}
