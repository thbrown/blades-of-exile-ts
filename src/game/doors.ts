/**
 * Doors and locks — pick_lock and bash_door (boe.town.cpp:1156 and :1204),
 * plus the terrain-special cases that open a door when you walk into it.
 *
 * The RNG call order matters here: these are the first formulas in the port
 * that consume `get_ran`, and replays depend on the sequence, so the calls
 * stay exactly where the C++ makes them even when the result is unused.
 */

import { Location } from '../core/location';
import { ItemAbil } from '../data/item';
import { TerSpec } from '../data/terrain';
import { Snd, SoundPlayer } from '../platform/sound';
import { hasAbilEquip, removeCharge } from '../universe/inventory';
import { Race, Skill, Trait } from '../universe/skills';
import { Player } from '../universe/player';
import { Universe } from '../universe/universe';
import { DamageType } from '../data/monster';
import { damagePc } from './damage';

export type DoorResult = 'opened' | 'failed' | 'no-picks' | 'wrong-terrain';

/** pick_lock (boe.town.cpp:1156). */
export function pickLock(
  univ: Universe,
  where: Location,
  pcNum: number,
  sound?: SoundPlayer | null,
): DoorResult {
  const town = univ.town;
  if (!town) return 'wrong-terrain';
  const pc = univ.party.pcs[pcNum];
  if (!pc) return 'wrong-terrain';
  const terrain = town.record.terrain[where.x]![where.y]!;
  const picks = hasAbilEquip(pc, ItemAbil.LOCKPICKS);
  if (!picks) {
    univ.addStringToBuf('  Need lockpick equipped.');
    return 'no-picks';
  }

  let r1 = univ.rng.getRan(1, 1, 100) + picks.item.abilStrength * 7;
  const willBreak = r1 < 75;

  r1 =
    univ.rng.getRan(1, 1, 100) -
    5 * pc.statAdj(Skill.DEXTERITY) +
    town.record.difficulty * 7 -
    // **`skill()`, not `skills[]`** (boe.town.cpp:1186): the effective
    // lockpicking, with whatever an equipped item boosts it by. Reading the raw
    // array made every pick 5 points harder per boost — and the visible form was
    // not a failed lock but a *broken pick*, since the break roll happens first
    // and only the failure branch spends it.
    5 * pc.skill(Skill.LOCKPICKING) -
    picks.item.abilStrength * 7;
  if (pc.traits[Trait.NIMBLE]) r1 -= 8;
  if (hasAbilEquip(pc, ItemAbil.THIEVING)) r1 -= 12;

  const unlockAdjust = univ.terrainType(terrain).flag2;
  if (unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 30) {
    univ.addStringToBuf("  Didn't work.");
    if (willBreak) {
      univ.addStringToBuf('  Pick breaks.');
      // `remove_charge` (pc.cpp:940), not a hand-rolled decrement: a
      // **rechargeable** pick survives at zero charges, and one that doesn't
      // goes through `take_item`, which *compacts the pack*. Blanking the slot
      // in place left a hole where the C++ shifted everything below it up — and
      // pack order is observable, because a recording uses items by slot.
      removeCharge(pc, picks.slot);
    }
    sound?.play(Snd.LOCK_FAILED);
    return 'failed';
  }
  univ.addStringToBuf('  Door unlocked.');
  sound?.play(Snd.LOCK_OPENED);
  unlockDoor(univ, where, terrain);
  return 'opened';
}

/** bash_door (boe.town.cpp:1204). */
export async function bashDoor(
  univ: Universe,
  where: Location,
  pcNum: number,
  sound?: SoundPlayer | null,
): Promise<DoorResult> {
  const town = univ.town;
  if (!town) return 'wrong-terrain';
  const pc = univ.party.pcs[pcNum];
  if (!pc) return 'wrong-terrain';
  const terrain = town.record.terrain[where.x]![where.y]!;
  const spec = univ.terrainType(terrain);
  const r1 =
    univ.rng.getRan(1, 1, 100) - 15 * pc.statAdj(Skill.STRENGTH) + town.record.difficulty * 4;

  if (spec.special !== TerSpec.UNLOCKABLE) {
    univ.addStringToBuf('  Wrong terrain type.');
    return 'wrong-terrain';
  }

  const unlockAdjust = spec.flag2;
  if (unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 40 || spec.flag3 !== 1) {
    univ.addStringToBuf("  Didn't work.");
    // A failed bash hurts: 1d4, unblockable — and it goes through the **real**
    // `damage_pc` (boe.town.cpp:1218), which this used to short-circuit into a
    // subtraction with a `TODO(M5)` on it. M5 has been closed since July, and
    // the shortcut was not just missing the death and the animation: even for
    // `SPECIAL` damage `damage_pc` rolls the party's luck, so the bash was one
    // `get_ran(1,1,100)` short every time it failed.
    await damagePc(univ, pc, univ.rng.getRan(1, 1, 4), DamageType.SPECIAL, Race.UNKNOWN);
    return 'failed';
  }
  univ.addStringToBuf('  Lock breaks.');
  sound?.play(Snd.LOCK_OPENED);
  unlockDoor(univ, where, terrain);
  return 'opened';
}

/**
 * Swap a locked door for its unlocked form and remember it, so re-entering the
 * town doesn't re-lock it (start_town_mode replays door_unlocked).
 */
export function unlockDoor(univ: Universe, where: Location, terrain: number): void {
  const town = univ.town!;
  town.record.terrain[where.x]![where.y] = univ.terrainType(terrain).flag1;
  town.record.doorUnlocked.push({ ...where });
}
