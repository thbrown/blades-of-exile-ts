/**
 * Doors and locks — pick_lock and bash_door (boe.town.cpp:1156 and :1204),
 * plus the terrain-special cases that open a door when you walk into it.
 *
 * The RNG call order matters here: these are the first formulas in the port
 * that consume `get_ran`, and replays depend on the sequence, so the calls
 * stay exactly where the C++ makes them even when the result is unused.
 */

import { bugFixed } from './bugFixes';
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
import { hasFeatureFlag } from './featureFlags';

export type DoorResult = 'opened' | 'failed' | 'no-picks' | 'wrong-terrain';

/**
 * `PICK=1`, the pair to the harness's `BOE_TRACE_PICK`: every input
 * `pick_lock` weighs, in the same column order, so the two streams diff
 * line-for-line.
 *
 * Worth having because the draws cannot see this one. Both engines spend the
 * same two `get_ran` calls whatever the answer, so a pick that breaks here and
 * holds there costs a *charge* and no draw — invisible until, hundreds of
 * actions later, one side raises a "how many?" prompt over a stack the other
 * side never split.
 */
const TRACE_PICK = Boolean(
  typeof process !== 'undefined' ? process.env?.PICK : undefined);

/**
 * pick_lock (boe.town.cpp:1156).
 *
 * **`pick-lock` = `exile3`**, a scenario's flag, is Exile III's
 * (`10d8:3f67`), which is 1997's shape with its own numbers: the pick's
 * *level* counts, fifteen a point, where BoE's strength counts seven (and it
 * breaks under 55, not 75); the town's difficulty counts once, not seven
 * times; the skill is the raw one; a PC who is **not** nimble gets the 8 off,
 * as 1997's does (`traits[3] == FALSE`); thieving counts only from the first
 * sixteen slots; and a pickable door opens at 35 or under, whatever its
 * flag2 — a door beyond picking (flag2 5 and up) still never does. Both rolls
 * run 0–100.
 */
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

  const e3 = univ.scenario.featureFlags['pick-lock'] === 'exile3';
  const unlockAdjust = univ.terrainType(terrain).flag2;
  if (e3) {
    const level = picks.item.itemLevel;
    const willBreak = univ.rng.getRan(1, 0, 100) + level * 15 < 55;
    let r = univ.rng.getRan(1, 0, 100) - 5 * pc.statAdj(Skill.DEXTERITY) + town.record.difficulty
      - 5 * (pc.skills[Skill.LOCKPICKING] ?? 0) - level * 15;
    // Known bug 12 (E3-SUSPECTED-BUGS.md): the nimble are the ones helped, under "Fix known bugs".
    if (bugFixed(12) ? pc.traits[Trait.NIMBLE] : !pc.traits[Trait.NIMBLE]) r -= 8;
    const thief = hasAbilEquip(pc, ItemAbil.THIEVING);
    if (thief && thief.slot < 16) r -= 12;
    return pickResult(univ, where, terrain, pc, picks.slot, unlockAdjust >= 5 || r > 35, willBreak, sound);
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

  if (TRACE_PICK) {
    // eslint-disable-next-line no-console
    console.log(`      [pick] pc=${pcNum} at (${where.x},${where.y})`
      + ` ter=${terrain} r1=${r1} adj=${unlockAdjust}`
      + ` dex=${pc.statAdj(Skill.DEXTERITY)}`
      + ` diff=${town.record.difficulty}`
      + ` lock=${pc.skill(Skill.LOCKPICKING)}`
      + ` str=${picks.item.abilStrength}`
      + ` slot=${picks.slot}`
      + ` break=${willBreak ? 1 : 0}`);
  }
  return pickResult(univ, where, terrain, pc, picks.slot, unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 30,
    willBreak, sound);
}

/** The end of `pick_lock`, which BoE and Exile III share. */
function pickResult(
  univ: Universe, where: Location, terrain: number, pc: Player, slot: number,
  failed: boolean, willBreak: boolean, sound?: SoundPlayer | null,
): DoorResult {
  if (failed) {
    univ.addStringToBuf("  Didn't work.");
    if (willBreak) {
      univ.addStringToBuf('  Pick breaks.');
      // `remove_charge` (pc.cpp:940), not a hand-rolled decrement: a
      // **rechargeable** pick survives at zero charges, and one that doesn't
      // goes through `take_item`, which *compacts the pack*. Blanking the slot
      // in place left a hole where the C++ shifted everything below it up — and
      // pack order is observable, because a recording uses items by slot.
      removeCharge(pc, slot);
    }
    sound?.play(Snd.LOCK_FAILED);
    return 'failed';
  }
  univ.addStringToBuf('  Door unlocked.');
  sound?.play(Snd.LOCK_OPENED);
  unlockDoor(univ, where, terrain);
  return 'opened';
}

/**
 * bash_door (boe.town.cpp:1204).
 *
 * Two flags change it. **`bash-door` = `1997`** (DIVERGENCES.md §18) is 1997's
 * (TOWN.CPP): the roll runs 0–100 rather than 1–100, and a failure hurts with
 * damage type 4, unblockable, where OBoE's is SPECIAL. A player sees it: the
 * blast is the unblockable one and the sound is 5, not the thud. The draws
 * are the same. **`bash` = `exile3`** is Exile III's (`10d8:4224`), a
 * scenario's flag: the town's difficulty counts once, not four times, and a
 * door breaks when the roll comes in at or under the terrain's flag3 (25, or
 * 10 for basalt), not `flag2 × 15 + 40`. A door E3 won't let be bashed has
 * flag3 0 and always fails, still hurting.
 */
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
  const e3 = univ.scenario.featureFlags['bash'] === 'exile3';
  const original = e3 || hasFeatureFlag('bash-door', '1997');
  const r1 = univ.rng.getRan(1, original ? 0 : 1, 100) - 15 * pc.statAdj(Skill.STRENGTH)
    + town.record.difficulty * (e3 ? 1 : 4);

  if (spec.special !== TerSpec.UNLOCKABLE) {
    univ.addStringToBuf('  Wrong terrain type.');
    return 'wrong-terrain';
  }

  const unlockAdjust = spec.flag2;
  const fails = e3 ? r1 > spec.flag3
    : unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 40 || spec.flag3 !== 1;
  if (fails) {
    univ.addStringToBuf("  Didn't work.");
    // A failed bash hurts: 1d4 — and it goes through the **real**
    // `damage_pc` (boe.town.cpp:1218), which this used to short-circuit into a
    // subtraction with an M5 marker on it. M5 has been closed since July, and
    // the shortcut was not just missing the death and the animation: even for
    // `SPECIAL` damage `damage_pc` rolls the party's luck, so the bash was one
    // `get_ran(1,1,100)` short every time it failed.
    await damagePc(univ, pc, univ.rng.getRan(1, 1, 4),
      original ? DamageType.UNBLOCKABLE : DamageType.SPECIAL, Race.UNKNOWN);
    return 'failed';
  }
  univ.addStringToBuf(e3 ? '  lock breaks.' : '  Lock breaks.');
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
