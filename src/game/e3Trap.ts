/**
 * Exile III's `run_trap` (`FUN_10e0_03ae`), for a scenario with the flag
 * `trap` = `exile3`. 1997's `run_trap` grew out of it and keeps its shape —
 * the random kind, the disarming roll, one case per kind with the same
 * messages — but the numbers are E3's own:
 *
 * - **Disarming**: the skill is Disarm Traps + Luck / 2 + 3 − the town's
 *   difficulty / 10 + 2 × the dexterity adjustment, which a Thieving item
 *   (E3 code 61, the Nimble Gloves) raises by 2. BoE's is + 1 − the whole
 *   difficulty, and half the item's strength. E3's difficulty runs 0–150
 *   (the converter's `townDifficulty`), BoE's small, hence the tenth. Both
 *   read the raw skills, as E3 keeps no boosts. The roll is 0–100 (BoE's
 *   1–100), and, as in lock picking, **E3 takes 6 off for a PC *without*
 *   Nimble Fingers** (E3-SUSPECTED-BUGS.md #12; fixed under the preference).
 * - **The effects** take a "strong" trap (E3's kind 20 on, which the
 *   converter hands over as level 2) as three blades or blasts, as BoE's
 *   level does, but a dart and gas add 3 and 2 (BoE: 2 × level), the drain
 *   takes 40 or 80 (BoE: 40 + 30 × level), flames are always 15d8 (BoE:
 *   10 + 5 × level) and disorientation always 2 (BoE: 2 + 2 × level).
 *
 * The kinds are the converter's mapping of E3's (`SpecBuilder.trap`): E3's 5
 * and 6 do nothing and arrive as FALSE_ALARM, 8 as a scenario node
 * (CUSTOM), 11 as ALERT; the + 10 on the roll for 8 and 11 is the node's
 * `diff`.
 */

import { DamageType } from '../data/monster';
import { Race, Skill, Trait } from '../universe/skills';
import { hasE3AbilEquip } from '../universe/inventory';
import { bugFixed } from './bugFixes';
import { damagePc, hitParty } from './damage';
import type { GameSession } from './session';
import { TrapType } from './trap';
import { makeTownHostile } from './townAttitude';

/** `DS:3cd8`: the chance of disarming by the capped skill — the same as BoE's. */
const E3_TRAP_ODDS = [5, 30, 35, 42, 48, 55, 63, 69, 75, 77, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98];

/** E3's Thieving code (the Nimble Gloves). */
const E3_THIEVING = 61;

export async function e3RunTrap(
  session: GameSession, pcNum: number, trapType: TrapType, trapLevel: number, diff: number,
): Promise<boolean> {
  const univ = session.univ;
  const rng = univ.rng;
  const strong = trapLevel > 0;
  const hits = strong ? 3 : 1;
  const difficulty = univ.town?.record.difficulty ?? 0;
  const say = (line: string): void => univ.addStringToBuf(line);

  let type = trapType;
  if (type === TrapType.RANDOM) type = rng.getRan(1, 1, 4) as TrapType;
  if (type === TrapType.FALSE_ALARM || type === TrapType.SLEEP_RAY) return true;

  const pc = univ.party.pcs[pcNum] ?? univ.currentPc;
  if (pcNum < 6) {
    let adj = pc.statAdj(Skill.DEXTERITY);
    if (hasE3AbilEquip(pc, E3_THIEVING)) adj += 2;
    const skill = Math.max(0, Math.min(20, (pc.skills[Skill.DISARM_TRAPS] ?? 0)
      + Math.trunc((pc.skills[Skill.LUCK] ?? 0) / 2) + 3 - Math.trunc(difficulty / 10) + 2 * adj));
    let r1 = rng.getRan(1, 0, 100) + diff;
    // Known bug 12: E3 helps everyone but the nimble.
    if (bugFixed(12) ? pc.traits[Trait.NIMBLE] : !pc.traits[Trait.NIMBLE]) r1 -= 6;
    if (r1 < E3_TRAP_ODDS[skill]!) {
      say('  Trap disarmed.');
      return true;
    }
    say('  Disarm failed.');
  }

  const d14 = Math.trunc(difficulty / 14);
  switch (type) {
    case TrapType.BLADE:
      for (let i = 0; i < hits; i++) {
        say('  A knife flies out!');
        await damagePc(univ, pc, rng.getRan(2 + d14, 1, 10), DamageType.WEAPON, Race.UNKNOWN);
      }
      break;
    case TrapType.DART:
      say('  A dart flies out.');
      pc.poison(3 + d14 + (strong ? 3 : 0), rng);
      break;
    case TrapType.GAS:
      say('  Poison gas pours out.');
      for (const p of univ.party.pcs) p.poison(2 + d14 + (strong ? 2 : 0), rng);
      break;
    case TrapType.EXPLOSION:
      for (let i = 0; i < hits; i++) {
        say('  There is an explosion.');
        await hitParty(univ, rng.getRan(3 + Math.trunc(difficulty / 13), 1, 8), DamageType.FIRE);
      }
      break;
    case TrapType.DRAIN_XP:
      say('  You feel weak.');
      pc.experience = Math.max(0, pc.experience - (strong ? 80 : 40));
      break;
    case TrapType.ALERT:
      say('  An alarm goes off!!!');
      makeTownHostile(session);
      break;
    case TrapType.FLAMES:
      say('  Flames shoot from the walls.');
      await hitParty(univ, rng.getRan(15, 1, 8), DamageType.FIRE);
      break;
    case TrapType.DUMBFOUND:
      say('  You feel disoriented.');
      for (const p of univ.party.pcs) p.dumbfound(2, rng);
      break;
    case TrapType.CUSTOM:
      // The node's own chain does the work (E3's 8, the alarm that wakes
      // the town), as in BoE's.
      univ.party.forcePtr(15, trapLevel);
      break;
    default:
      say('TRAP ERROR! REPORT!');
      break;
  }
  return false;
}
