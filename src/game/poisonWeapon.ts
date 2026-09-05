/**
 * `poison_weapon` (boe.party.cpp:450) — smearing a dose on an equipped weapon.
 *
 * It lives in a module of its own because three unrelated callers need it —
 * a poison item (`itemUse.ts`), the `AFFECT_POISON` special (`specials/`) and
 * the Envenom/Major Blessing casts (`spellCombat.ts`) — and the last of those
 * is imported *by* `itemUse.ts`, so keeping it there made a cycle.
 */

import { Item, ItemType } from '../data/item';
import { Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';

/** is_poisonable_weap (boe.party.cpp:485) — melee weapons and ammunition. */
export function isPoisonableWeap(item: Item): boolean {
  return item.variety === ItemType.ONE_HANDED || item.variety === ItemType.TWO_HANDED
    || item.variety === ItemType.ARROW || item.variety === ItemType.BOLTS;
}

/**
 * p_chance (boe.party.cpp:444) — the odds of applying poison cleanly, indexed
 * by the PC's Poison skill. Note the table only reaches 21 entries because the
 * skill is capped at 20.
 */
const POISON_CHANCE = [
  40, 72, 81, 85, 88, 89, 90,
  91, 92, 93, 94, 94, 95, 95, 96, 97, 98, 100, 100, 100, 100,
];

/**
 * poison_weapon (boe.party.cpp:442) — smear a dose on the first *equipped*
 * poisonable weapon. `safe` skips both the botch roll and the sound, which is
 * how a group-use item applies poison without anyone nicking themselves.
 *
 * The C++ walks the pack with `find_if` and, when the match isn't equipped,
 * steps past it and searches again — so an unequipped dagger in slot 0 doesn't
 * stop it finding the equipped sword in slot 3. (Its loop reads `equip[...]`
 * one past the end when nothing matches at all, which is undefined there; here
 * the search simply runs out and reports no weapon.)
 */
export function poisonWeapon(
  univ: Universe, pcNum: number, howMuch: number, safe: boolean,
  sound?: (which: number) => void,
): boolean {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return false;

  for (let slot = 0; slot < pc.items.length; slot++) {
    const item = pc.items[slot]!;
    if (!isPoisonableWeap(item)) continue;
    if (!pc.equip[slot]) continue;

    let pLevel = howMuch;
    univ.addStringToBuf('  You poison your weapon.');
    let r1 = univ.rng.getRan(1, 1, 100);
    if (pc.traits[Trait.NIMBLE]) r1 -= 6;
    const skill = POISON_CHANCE[pc.skill(Skill.POISON)] ?? 100;
    if (r1 > skill && !safe) {
      univ.addStringToBuf('  Poison put on badly.');
      pLevel = Math.trunc(pLevel / 2);
      r1 = univ.rng.getRan(1, 1, 100);
      if (r1 > skill + 10) {
        univ.addStringToBuf('  You nick yourself.');
        // Written straight into the status, not through poison() — so this
        // dose ignores resistances and the frailty trait alike.
        pc.status[Status.POISON] = (pc.status[Status.POISON] ?? 0) + pLevel;
      }
    }
    if (!safe) sound?.(55);
    // The C++ records the slot; this port records the item itself, which is
    // what `pc_attack_weapon` and `fire_missile` already compare against.
    pc.weapPoisoned = item;
    pc.status[Status.POISONED_WEAPON] = Math.max(
      pc.status[Status.POISONED_WEAPON] ?? 0, pLevel);
    return true;
  }

  univ.addStringToBuf('  No weapon equipped.');
  return false;
}
