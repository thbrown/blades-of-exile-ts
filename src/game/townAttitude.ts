/**
 * `set_town_attitude` and `make_town_hostile` (boe.items.cpp:304) — the one
 * place a town's creatures change side. Every caller in the original goes
 * through here: robbing a shop in front of a witness, an END_ALARM talk node,
 * the MAKE_TOWN_HOSTILE special, and swinging at someone who wasn't hostile.
 */

import { toShort } from '../core/location';
import { Attitude } from '../data/monster';
import { CreatureStatus } from '../universe/creature';
import { Status } from '../universe/skills';
import { GameMode } from './modes';
import type { GameSession } from './session';
import { SpecCtx, SpecCtxType } from './specials/context';

const HOSTILE = new Set<Attitude>([Attitude.HOSTILE_A, Attitude.HOSTILE_B]);

/**
 * The `hostile-movers` feature flag, an exile-js extension: a list of monster
 * numbers and ranges (`12-20,91-98`). When a scenario has it, a creature
 * turned hostile gets moving, and is alerted, only if its monster is listed;
 * the rest turn where they stand. That is Exile III's `make_town_hostile`
 * (`FUN_1070_23b9`), where BoE makes everyone mobile and alerts only guards.
 * Without the flag, null: BoE's rule.
 */
export function hostileMovers(flag: string | undefined): Set<number> | null {
  if (flag === undefined) return null;
  const movers = new Set<number>();
  for (const part of flag.split(',')) {
    const [lo, hi] = part.split('-').map((s) => Number(s.trim()));
    if (lo === undefined || !Number.isInteger(lo)) continue;
    const last = hi ?? lo;
    if (!Number.isInteger(last)) continue;
    for (let m = lo; m <= last; m++) movers.add(m);
  }
  return movers;
}

/**
 * Set the attitude of the town creatures in slots `lo`..`hi` inclusive.
 * Negative indices count back from the end, Python-style, and are clamped to 0
 * rather than wrapping; `hi < lo` swaps them. `make_town_hostile` is
 * `setTownAttitude(session, 0, -1, HOSTILE_A)`, which is "everyone".
 *
 * The C++ blocks on `run_special` for `spec_on_hostile`; here the chain is
 * started and left to run, which is the same ordering every other non-movement
 * trigger in this port uses.
 */
export function setTownAttitude(
  session: GameSession, lo: number, hi: number, att: Attitude,
): void {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  // An arena fight (which_combat_type 0) has no town population to turn.
  if (session.mode === GameMode.COMBAT && session.whichCombatType === 0) return;

  const count = town.monsters.length;
  town.monstHostile = HOSTILE.has(att);
  const movers = hostileMovers(univ.scenario.featureFlags['hostile-movers']);

  if (lo <= -count) lo = 0;
  if (lo < 0) lo = count + lo;
  if (hi <= -count) hi = 0;
  if (hi < 0) hi = count + hi;
  if (hi < lo) [lo, hi] = [hi, lo];

  for (let i = lo; i <= hi && i < count; i++) {
    const monst = town.monsters[i];
    // A summoned creature keeps whatever side summoned it.
    if (!monst || !monst.isAlive || monst.summonTime !== 0) continue;
    monst.attitude = att;
    if (monst.isFriendly) continue;
    // Anything turned hostile gets up and moves, and a creature flagged as a
    // guard in the scenario becomes a serious problem.
    if (movers) {
      // Exile III's rule: only the listed monsters move, and they are alerted.
      if (movers.has(monst.number)) {
        monst.mobile = true;
        monst.active = CreatureStatus.ALERTED;
      }
    } else monst.mobile = true;
    if (univ.scenario.scenMonsters[monst.number]?.guard) {
      monst.active = CreatureStatus.ALERTED;
      // **A `short`** (creature.hpp:31), and this is the multiply that
      // overflows it: anger the same town six times and 140 becomes 34,020,
      // which stores as -31,516. `AllMageSpells` does exactly that, and the
      // sign then flips `guts += health / 20` in
      // `monst_check_one_special_terrain` — the guard that walked into a web
      // here would not go near it there.
      monst.health = toShort(monst.health * 3);
      monst.status[Status.HASTE_SLOW] = 8;
      monst.status[Status.BLESS_CURSE] = 8;
    }
  }

  // In some towns, doing this will get you killed — that's up to the node.
  if (town.monstHostile && town.record.specOnHostile >= 0) {
    void session.runSpecial(
      SpecCtx.TOWN_HOSTILE, SpecCtxType.TOWN, town.record.specOnHostile,
      univ.party.townLoc);
  }
}

/** make_town_hostile — the whole population turns on the party. */
export function makeTownHostile(session: GameSession): void {
  setTownAttitude(session, 0, -1, Attitude.HOSTILE_A);
}
