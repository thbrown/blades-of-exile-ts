/**
 * Taking damage and dying — `damage_pc` (boe.party.cpp), `damage_monst` and
 * `kill_monst` (boe.specials.cpp:1442 and :1599), `kill_pc` (boe.party.cpp:2713)
 * and `hit_party`. This is the layer everything in combat funnels through, so
 * the order of the reductions and of the `get_ran` calls is the spec: a replay
 * that matches C++ has to make the same rolls in the same sequence.
 *
 * Both damage functions return the damage actually dealt (0 for none), which is
 * what the C++'s `short` return means at every call site.
 */

import { e3JobKill } from './e3Jobs';
import { e3DamageResist } from './e3Items';
import { Location, dist } from '../core/location';
import { SIGHT_BLOCKED } from '../core/sight';
import { FieldType } from '../data/fields';
import { ItemAbil, ItemType } from '../data/item';
import { variety } from '../data/itemVariety';
import { Attitude, DamageType, Monster } from '../data/monster';
import { Creature, CreatureStatus } from '../universe/creature';
import { getProtLevel, hasAbilEquip, takeItem } from '../universe/inventory';
import { SpellNote, livingSound } from '../universe/living';
import { MonstAbil } from '../data/monsterAbility';
import { animSettle } from './anim';
import { drawTerrain, drawTerrain2 } from './textBar';
import { isCombat, isTown } from './modes';
import { boomAnimActive, boomSpace, endBoomAnim, runBoomAnim, startBoomAnim } from './booms';
import { findClearSpot, placeMonster } from './monsterPlace';
import { placeGlands, placeItem, placeTreasure } from './loot';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { MainStatus, Race, Skill, Status, Trait, isHuman, isHumanoid } from '../universe/skills';
import { Universe } from '../universe/universe';
import { SpecCtx, SpecCtxType } from './specials/context';
import type { GameSession } from './session';
import { makeTownHostile } from './townAttitude';

/**
 * hit_chance (boe.combat.cpp:66) — the percentage a skill level buys, indexed
 * by that level. It flattens out at 99 from level 20 on.
 */
export const HIT_CHANCE = [
  20, 30, 40, 45, 50, 55, 60, 65, 69, 73,
  77, 81, 84, 87, 90, 92, 94, 96, 97, 98, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

export function hitChance(level: number): number {
  return HIT_CHANCE[Math.max(0, Math.min(HIT_CHANCE.length - 1, level))] ?? 99;
}

/**
 * boom_gr (boe.specials.cpp:61) — which hit sprite a damage type uses. 1997's
 * (SPECIALS.CPP:65, `{3,0,2,1,1,4,3,3}`) but for acid, which 1997 hasn't got:
 * **unblockable damage is the magic burst, 1**, where OBoE drew a sprite of
 * its own, 5 (DIVERGENCES.md §50). Exile III's Wound is the one a player meets.
 */
const BOOM_GR: Partial<Record<DamageType, number>> = {
  [DamageType.WEAPON]: 3,
  [DamageType.FIRE]: 0,
  [DamageType.POISON]: 2,
  [DamageType.MAGIC]: 1,
  [DamageType.ACID]: 6,
  [DamageType.UNBLOCKABLE]: 1,
  [DamageType.COLD]: 4,
  [DamageType.UNDEAD]: 3,
  [DamageType.DEMON]: 3,
  [DamageType.SPECIAL]: 1,
};

/**
 * get_sound_type — the hit sound for a damage type. -1 means "the default for
 * this type"; passing 0 explicitly is how a caller forces the plain thud.
 */
export function getSoundType(damType: DamageType, forced = -1): number {
  if (forced !== -1) return forced;
  switch (damType) {
    case DamageType.FIRE: case DamageType.UNBLOCKABLE: return 5;
    case DamageType.ACID: return 8;
    case DamageType.COLD: return 7;
    case DamageType.MAGIC: return 12;
    case DamageType.POISON: return 11;
    default: return 0;
  }
}

/** Damage types a shield and a suit of armour actually stop. */
const ARMOUR_RESISTS = new Set([
  DamageType.WEAPON, DamageType.UNDEAD, DamageType.DEMON,
]);
/** Damage types the magic-resistance status halves (or doubles, if cursed). */
const MAGIC_RESISTS = new Set([DamageType.FIRE, DamageType.COLD]);
/** Damage types a ring of full protection blunts. */
const MAJOR_RESISTS = new Set([
  DamageType.FIRE, DamageType.POISON, DamageType.MAGIC, DamageType.ACID, DamageType.COLD,
]);

export interface DamageOptions {
  /** Forced hit sound; -1 takes the damage type's default. */
  soundType?: number;
  /** Whether to print the "takes N" line. */
  doPrint?: boolean;
  /** Whether to run the hit animation (the C++'s `boom`). */
  boom?: boolean;
}

/**
 * damage_pc — run `howMuch` through everything that might reduce it and apply
 * what's left. `attackerRace` drives the protect-from-species items.
 *
 * **Async because `boom_space` blocks.** The C++ prints the line, draws the
 * blast, *sleeps through it*, and only then takes the health off, decides the
 * death and calls `kill_pc` (boe.party.cpp:2660-2686). Everything after the
 * blast in this function is therefore behind an `animSettle`, which is this
 * port's version of that sleep. Every caller has to await it or the health
 * comes off while the explosion is still on screen — which is the bug this
 * shape exists to prevent.
 */
export async function damagePc(
  univ: Universe,
  pc: Player,
  howMuch: number,
  damType: DamageType,
  attackerRace: Race = Race.UNKNOWN,
  options: DamageOptions = {},
): Promise<number> {
  if (pc.mainStatus !== MainStatus.ALIVE) return 0;
  const { doPrint = true, boom = true } = options;

  // Armour, and the shield-and-blessing bonus that comes with it.
  if (ARMOUR_RESISTS.has(damType)) {
    howMuch -= Math.max(-5, Math.min(5, pc.status[Status.BLESS_CURSE] ?? 0));
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
      const item = pc.items[i]!;
      if (item.variety === ItemType.NO_ITEM || !pc.equip[i]) continue;
      if (variety(item.variety).isArmour) {
        let defense = 0;
        if (item.itemLevel > 0) defense = univ.rng.getRan(1, 1, item.itemLevel);
        // An enchantment helps; a cursed item hurts by its full amount.
        if (item.bonus > 0) defense += univ.rng.getRan(1, 1, item.bonus) + Math.trunc(item.bonus / 2);
        else if (item.bonus < 0) defense -= item.bonus;
        howMuch -= defense;
        // A defence skill high enough to matter shaves one more off.
        const roll = univ.rng.getRan(1, 1, 100);
        if (roll < hitChance(pc.skill(Skill.DEFENSE)) - 20) howMuch -= 1;
      }
      if (item.protection > 0) howMuch -= univ.rng.getRan(1, 1, item.protection);
      else if (item.protection < 0) howMuch += univ.rng.getRan(1, 1, -item.protection);
    }
  }

  // Parry — only against weapons, and only while it's under 100.
  if (damType === DamageType.WEAPON && pc.parry < 100) howMuch -= Math.trunc(pc.parry / 4);

  if (damType !== DamageType.MARKED) {
    if (univ.party.easyMode) howMuch -= 3;
    if (pc.traits[Trait.TOUGHNESS]) howMuch--;
    if (univ.rng.getRan(1, 1, 100) < 2 * (hitChance(pc.skill(Skill.LUCK)) - 20)) howMuch -= 1;
  }

  // Exile III's items leave these three to `e3DamageResist` (DIVERGENCES.md #23).
  let protFromDmg = getProtLevel(pc, ItemAbil.DAMAGE_PROTECTION, damType, true);
  // Acid used to be a kind of magic damage, so magic protection still counts.
  if (damType === DamageType.ACID) {
    protFromDmg += getProtLevel(pc, ItemAbil.DAMAGE_PROTECTION, DamageType.MAGIC, true);
  }
  if (protFromDmg > 0) {
    // Against weapons it subtracts; against anything else it halves, which
    // means the ability's strength stops mattering. That asymmetry is in the
    // original, flagged there with a TODO of its own.
    if (damType === DamageType.WEAPON) howMuch -= protFromDmg;
    else howMuch = Math.trunc(howMuch / 2);
  }

  if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, attackerRace, true) > 0) {
    howMuch = Math.trunc(howMuch / 2);
  }
  // Protection from humanoids also covers the specific humanoid races — but not
  // HUMANOID itself, or it would count twice.
  if (isHumanoid(attackerRace) && !isHuman(attackerRace) && attackerRace !== Race.HUMANOID) {
    if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, Race.HUMANOID, true) > 0) {
      howMuch = Math.trunc(howMuch / 2);
    }
  }
  // Protection from undead covers skeletons too.
  if (attackerRace === Race.SKELETAL) {
    if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, Race.UNDEAD, true) > 0) {
      howMuch = Math.trunc(howMuch / 2);
    }
  }

  // Invulnerability stops everything but assassination damage.
  if (damType !== DamageType.SPECIAL && (pc.status[Status.INVULNERABLE] ?? 0) > 0) howMuch = 0;

  if (MAGIC_RESISTS.has(damType)) {
    const magicRes = pc.status[Status.MAGIC_RESISTANCE] ?? 0;
    if (magicRes > 0) howMuch = Math.trunc(howMuch / 2);
    else if (magicRes < 0) howMuch *= 2;
  }

  const fullProt = getProtLevel(pc, ItemAbil.FULL_PROTECTION, -1, true);
  if (MAJOR_RESISTS.has(damType) && fullProt > 0) {
    howMuch = Math.trunc(howMuch / (fullProt >= 7 ? 4 : 2));
  }
  howMuch = e3DamageResist(pc, damType, howMuch);

  // The PC half of the same marked-damage branch (boe.party.cpp:2634). Note it
  // booms at the *party's* square in town rather than the PC's, which only
  // differs outside combat.
  if (boomAnimActive()) {
    if (howMuch < 0) howMuch = 0;
    pc.markedDamage += howMuch;
    boomSpace(hitLocation(univ, pc), explosionType(damType), howMuch,
      getSoundType(damType, options.soundType ?? -1), univ.rng);
    return howMuch;
  }

  if (howMuch <= 0) {
    // The "clang off the armour" sound, which really is file 2.
    if (ARMOUR_RESISTS.has(damType)) livingSound(2);
    univ.addStringToBuf('  No damage.');
    return 0;
  }

  // Being hit stirs a sleeping PC toward waking.
  if ((pc.status[Status.ASLEEP] ?? 0) > 0) pc.status[Status.ASLEEP]!--;
  if (doPrint) univ.addStringToBuf(`  ${pc.name} takes ${howMuch}.`);
  if (damType !== DamageType.MARKED && boom) {
    boomSpace(hitLocation(univ, pc), boomType(damType), howMuch,
      getSoundType(damType, options.soundType ?? -1), univ.rng);
    // `boom_space`'s sleep. Nothing below here — the health, the death, the
    // "is dead" line — happens until the blast has been seen.
    await animSettle();
  }
  univ.party.totalDamTaken += howMuch;

  if (pc.curHealth >= howMuch) pc.curHealth -= howMuch;
  else if (pc.curHealth > 0) pc.curHealth = 0;
  // Note the PC only dies from a hit taken while *already* at zero: a blow that
  // empties the health bar leaves them standing, and the next one kills.
  else if (howMuch > 25) {
    pc.spellNote(SpellNote.OBLITERATED);
    killPc(univ, pc, MainStatus.DUST);
  } else {
    pc.spellNote(SpellNote.KILLED);
    killPc(univ, pc, MainStatus.DEAD);
  }
  if (pc.curHealth === 0 && pc.mainStatus === MainStatus.ALIVE) livingSound(3);

  return howMuch;
}

/** The gore a death leaves behind, by race (kill_pc / kill_monst). */
function goreField(race: Race, big: boolean): FieldType | null {
  switch (race) {
    case Race.DEMON: return FieldType.SFX_ASH;
    case Race.UNDEAD: return null; // undead leave nothing
    case Race.SKELETAL: return FieldType.SFX_BONES;
    case Race.SLIME: case Race.PLANT: case Race.BUG:
      return big ? FieldType.SFX_LARGE_SLIME : FieldType.SFX_SMALL_SLIME;
    case Race.STONE: return FieldType.SFX_RUBBLE;
    default:
      return big ? FieldType.SFX_LARGE_BLOOD : FieldType.SFX_SMALL_BLOOD;
  }
}

/**
 * petrify_pc (boe.party.cpp:2694) — the gaze that turns a PC to stone. The
 * saving roll is the PC's level and blessing against the effect's strength,
 * and an item that protects from petrification simply wins.
 *
 * Note stone is *not* death: `kill_pc(STONE)` skips the life-saving item (the
 * C++ says so in as many words) but the luck save still applies, so a lucky PC
 * can shrug it off inside `kill_pc`.
 */
export function petrifyPc(univ: Universe, pc: Player, strength: number): void {
  let r1 = univ.rng.getRan(1, 0, 20);
  r1 += Math.trunc(pc.level / 4);
  r1 += pc.status[Status.BLESS_CURSE] ?? 0;
  r1 -= strength;
  if (hasAbilEquip(pc, ItemAbil.PROTECT_FROM_PETRIFY)) r1 = 20;
  if (r1 > 14) {
    univ.addStringToBuf(`  ${pc.name} resists.`);
    return;
  }
  univ.addStringToBuf(`  ${pc.name} is turned to stone.`);
  killPc(univ, pc, MainStatus.STONE);
}

/**
 * petrify_monst (boe.specials.cpp:1583) — the same, aimed the other way.
 *
 * *Gotcha*: the resist test is `r1 > 14 || resist[MAGIC] === 0`, and a
 * resistance of 0 means the monster takes *no* magic damage at all (the
 * resistances are percentages, 100 being normal). So an ordinary monster is
 * petrified on a low roll and only a magic-proof one is safe. The C++ has its own TODO
 * wondering whether it should handle magic resistance the way `charm_monst`
 * does; kept as written.
 */
export function petrifyMonst(univ: Universe, monst: Creature, strength: number, session?: GameSession): void {
  monst.spellNote(SpellNote.GAZES);
  let r1 = univ.rng.getRan(1, 0, 20);
  r1 += Math.trunc(monst.mon.level / 4);
  r1 += monst.status[Status.BLESS_CURSE] ?? 0;
  r1 -= strength;
  if (r1 > 14 || monst.mon.resist[DamageType.MAGIC] === 0) {
    monst.spellNote(SpellNote.RESISTS);
    return;
  }
  monst.spellNote(SpellNote.STONED);
  killMonst(univ, monst, 7, MainStatus.STONE, session);
}

/**
 * kill_pc (boe.party.cpp:2713) — with two ways out of it: luck can save you
 * outright, and a life-saving item is spent instead of your life. Otherwise the
 * PC's gear falls on the floor where they stood.
 *
 * A `MainStatus` of SPLIT + something means "no saving throw" (a split-off
 * duplicate dying), which is how the C++ smuggles the flag through.
 */
export function killPc(univ: Universe, pc: Player, type: MainStatus): void {
  let noSave = false;
  if (type >= MainStatus.SPLIT) {
    type -= MainStatus.SPLIT;
    noSave = true;
  }

  // Petrification isn't a death a life-saving amulet understands.
  const lifeSaver = type === MainStatus.STONE
    ? null : hasAbilEquip(pc, ItemAbil.LIFE_SAVING);

  const luck = pc.skill(Skill.LUCK);
  if (!noSave && type !== MainStatus.ABSENT && luck > 0
    && univ.rng.getRan(1, 1, 100) < hitChance(luck)) {
    univ.addStringToBuf('  But you luck out!');
    pc.curHealth = 0;
    return;
  }

  if (!lifeSaver || type === MainStatus.ABSENT) {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) pc.equip[i] = false;
    const where = pc.combatPos.x >= 0 ? pc.combatPos : univ.party.townLoc;
    const town = univ.town;

    if (town) {
      const field = type === MainStatus.DUST
        ? FieldType.SFX_ASH
        : type === MainStatus.ABSENT ? null : goreField(pc.race, true);
      if (field !== null) town.setField(where.x, where.y, field);

      // Everything they carried drops where they fell — but not outdoors,
      // where there is nowhere to drop it.
      // **`place_item`, not a push** (boe.party.cpp:2768): the town's item list
      // is a vector with holes in it, and a new item fills the *first* hole. A
      // list that appends instead ends up in a different order from the C++'s,
      // and the get-items screen indexes into that order — so a recording that
      // clicks row 3 picks up a different object.
      for (const item of pc.items) {
        if (item.variety === ItemType.NO_ITEM) continue;
        placeItem(univ, { ...item, isSpecial: 0 }, where);
        item.variety = ItemType.NO_ITEM;
      }
    }
    if (type === MainStatus.DEAD || type === MainStatus.DUST) livingSound(21);
    pc.mainStatus = type;
    pc.ap = 0;
  } else {
    univ.addStringToBuf('  Life saved!');
    takeItem(pc, lifeSaver.slot);
    pc.heal(200);
  }

  if (!univ.currentPc.isAlive) univ.curPc = univ.firstActivePc();
}

/**
 * damage_monst (boe.specials.cpp:1442). `whoHit` is the PC slot responsible,
 * 6 for "the party as a whole" and 7+ for another monster — it decides who gets
 * the experience and whether hurting a friendly counts as a crime.
 */
export async function damageMonst(
  univ: Universe,
  victim: Creature,
  whoHit: number,
  howMuch: number,
  damType: DamageType,
  options: DamageOptions & { session?: GameSession } = {},
): Promise<number> {
  if (victim.active === CreatureStatus.DEAD) return 0;
  const { doPrint = true } = options;

  // Resistances only apply below SPECIAL: assassination damage can't be stopped.
  if (damType < DamageType.SPECIAL) {
    howMuch = Math.trunc((howMuch * (victim.mon.resist[damType] ?? 100)) / 100);
  }
  // **ABSORB_SPELLS is here as well as in `magic_adjust`.** The note that used
  // to sit in its place said it belonged only to the latter, which reads
  // sensibly — that one catches spell *effects*, drain and acid and webbing —
  // and is wrong: `damage_monst` (boe.specials.cpp:1467) has its own copy, on
  // the four elemental damage types, and it **heals the victim by the damage
  // it just swallowed** and returns before the saving throw. So a monster with
  // the ability turns a fireball into a heal, and rolls `get_ran(1,1,1000)`
  // deciding whether to, every single time it is hit by one.
  const absorb = victim.mon.abil[MonstAbil.ABSORB_SPELLS];
  const absorbable = damType === DamageType.FIRE || damType === DamageType.MAGIC
    || damType === DamageType.COLD || damType === DamageType.ACID;
  if (absorbable && (absorb?.active ?? false)
    && univ.rng.getRan(1, 1, 1000) <= (absorb?.special.extra1 ?? 0)) {
    // `add_check_overflow` clamps at SHRT_MAX rather than wrapping.
    victim.health = Math.min(32767, victim.health + howMuch);
    univ.addStringToBuf('  Magic absorbed.');
    return 0;
  }

  // Saving throw — a tough monster shrugs off half of an elemental hit.
  if ((damType === DamageType.FIRE || damType === DamageType.COLD)
    && univ.rng.getRan(1, 0, 20) <= victim.mon.level) howMuch = Math.trunc(howMuch / 2);
  if ((damType === DamageType.MAGIC || damType === DamageType.ACID)
    && univ.rng.getRan(1, 0, 24) <= victim.mon.level) howMuch = Math.trunc(howMuch / 2);

  // Invulnerability divides by ten rather than zeroing, and both sources stack.
  if (damType !== DamageType.SPECIAL && victim.mon.invuln) howMuch = Math.trunc(howMuch / 10);
  if (damType !== DamageType.SPECIAL && (victim.status[Status.INVULNERABLE] ?? 0) > 0) {
    howMuch = Math.trunc(howMuch / 10);
  }

  if (MAGIC_RESISTS.has(damType)) {
    const magicRes = victim.status[Status.MAGIC_RESISTANCE] ?? 0;
    if (magicRes > 0) howMuch = Math.trunc(howMuch / 2);
    else if (magicRes < 0) howMuch *= 2;
  }

  // Monster armour only stops weapons — unlike a PC's, which also blunts
  // undead and demon damage.
  if (damType === DamageType.WEAPON) {
    let r1 = univ.rng.getRan(1, 0, Math.trunc((victim.mon.armor * 5) / 4));
    r1 += Math.trunc(victim.mon.level / 4);
    howMuch -= r1;
  }

  // Inside a volley (boe.specials.cpp:1503) the damage is *marked*, not dealt:
  // it accumulates on the victim, the explosion is queued, and nothing is
  // printed. `handleMarkedDamage` applies the total once the projectiles have
  // landed, which is what keeps "Guard takes 4" from beating the fireball.
  if (boomAnimActive()) {
    if (howMuch < 0) howMuch = 0;
    victim.markedDamage += howMuch;
    boomSpace(victim.curLoc, explosionType(damType), howMuch, getSoundType(damType), univ.rng,
      bigCreatureAdj(victim));
    return howMuch;
  }

  if (howMuch <= 0) {
    // `if(is_combat()) victim.spell_note(UNDAMAGED)` (boe.specials.cpp:1517) —
    // a blow that bounces off says so only in a fight.
    if (options.session && isCombat(options.session.mode)) {
      victim.spellNote(SpellNote.UNDAMAGED);
    }
    // …and **a weapon that bounces redraws** (:1520), which in combat is a die.
    // `draw_terrain(2)`, so it costs nothing unless somebody is acting: a PC's
    // swing sets `current_working_monster`, a blade wall in `process_fields`
    // does not. See `drawTerrain2`.
    if (ARMOUR_RESISTS.has(damType)) {
      if (options.session) drawTerrain2(options.session);
      livingSound(2);
    }
    return 0;
  }

  if (doPrint) victim.damagedMsg(howMuch, 0);
  if (damType !== DamageType.MARKED) {
    // `if(party_can_see_monst(...)) boom_space(…,100,…) else boom_space(…,
    // overall_mode,…)` (boe.specials.cpp:1552). Mode 100 skips `party_can_see`,
    // which asks about one square — and a creature two squares wide can be in
    // view without its top-left corner being.
    boomSpace(victim.curLoc, boomType(damType), howMuch,
      getSoundType(damType, options.soundType ?? -1), univ.rng,
      { ...bigCreatureAdj(victim),
        always: options.session ? options.session.partyCanSeeMonst(victim) : true });
    // The blast blocks here in the C++, so the health only comes off — and
    // the thing only dies — once it has played. See `damagePc`.
    await animSettle();
  }
  victim.health -= howMuch;
  // **Debug mode kills whatever it touches** (boe.specials.cpp:1532): one point
  // of damage takes the health straight to -1. It is the shift-D "clear the
  // room" switch, and a recording can turn it on mid-run —
  // `VoDT_02-05-2025_16-42-15` does, and the goblin the C++ kills with a
  // nine-point arrow survived here on one hit point for the rest of the file.
  if (univ.debugMode) victim.health = -1;

  // Splitting monsters. The copy takes the *current* health of the original,
  // so hacking a slime apart gives you two weakened slimes, not two fresh
  // ones — and it only splits while it is still standing.
  const splits = victim.mon.abil[MonstAbil.SPLITS]!;
  if (splits.active && victim.health > 0
    && univ.rng.getRan(1, 1, 1000) < splits.special.extra1 && options.session) {
    const wherePut = findClearSpot(options.session, victim.curLoc, 1);
    if (wherePut.x > 0) {
      const slot = placeMonster(options.session, victim.number, wherePut);
      const copy = univ.town?.monsters[slot];
      if (copy) {
        copy.health = victim.health;
        victim.spellNote(SpellNote.SPLITS);
      }
    }
  }
  if (whoHit < 7) univ.party.totalDamDone += howMuch;

  // Anything that gets hurt notices.
  victim.active = CreatureStatus.ALERTED;

  if (victim.health < 0) {
    victim.spellNote(SpellNote.DIES);
    killMonst(univ, victim, whoHit, MainStatus.DEAD, options.session);
    // The death cry blocks (`livingSound`), so the next thing — the next
    // creature a fireball killed, with its own cry — waits for it.
    await animSettle();
  } else {
    // Morale falls further the harder the hit was; the steps are cumulative.
    if (howMuch > 0) victim.morale -= 1;
    if (howMuch > 5) victim.morale -= 1;
    if (howMuch > 10) victim.morale -= 1;
    if (howMuch > 20) victim.morale -= 2;
  }

  // Attacking a townsperson turns **the whole town** against you
  // (boe.specials.cpp:1576), not just the one you hit.
  //
  // The C++ guards this with `(!processing_fields && !monsters_going) ||
  // (processing_fields && !hostiles_present)`, its two globals for "who is this
  // damage really from".
  //
  // Half of that really is unreachable here: inside `process_fields` a monster
  // is only ever hurt by `monst_inflict_fields`, whose `who_hit` is 7, so
  // `whoHit < 7` disposes of the `processing_fields` arm on its own (see the
  // note at the top of `processFields.ts`).
  //
  // **`monsters_going` is not.** This used to say `whoHit < 7` covered that arm
  // too, on the grounds that a monster's blow arrives as 7 — true of melee
  // (boe.combat.cpp:2743) and of `hit_space`, which this port hands an explicit
  // `whoHit` where the C++ reads the global (boe.combat.cpp:4364). It is false
  // of `handleMarkedDamage`, which blames `univ.curPc` because
  // boe.combat.cpp:1453 does, and which fires from inside a *monster's* spell.
  // So a monster casting at a marked, *charmed* creature turned the party's own
  // charmed ally hostile — and turned the whole town on the party for a blow it
  // never struck.
  //
  // It matters far past the fight it happens in: `monst.hostile` switches off
  // `do_monsters`' whole drift block, so once a town has turned, its idle
  // creatures stop wandering and stop spending `get_ran(1,0,1)` +
  // `rand_move`'s draws every turn. Leaving it out was worth two draws a turn
  // for the rest of the visit.
  if (victim.isFriendly && whoHit < 7 && !options.session?.monstersGoing) {
    univ.addStringToBuf('Damaged an innocent.');
    victim.attitude = Attitude.HOSTILE_A;
    if (options.session) makeTownHostile(options.session);
  }

  return howMuch;
}

/**
 * kill_monst (boe.specials.cpp:1599) — the death rattle, the SDF a scenario
 * watches for, the kill special, the experience, the loot and the mess left on
 * the floor. `spec1` is zeroed so a specially-summoned monster can't come back.
 */
export function killMonst(
  univ: Universe,
  monst: Creature,
  whoKilled: number,
  type: MainStatus = MainStatus.DEAD,
  session?: GameSession,
): void {
  deathSound(univ, monst.mon.race);

  // The flag a scenario watches to know this one is gone.
  if (univ.party.sdLegit(monst.spec1, monst.spec2)) {
    univ.party.setSdf(monst.spec1, monst.spec2, 1);
  }
  // **The dying creature is still the chain's target.** `kill_monst` runs its
  // specials at boe.specials.cpp:1623 and only writes
  // `which_m.active = eCreatureStatus::DEAD` at :1677, so
  // `current_pc_picked_in_spec_enc`'s `KILL_MONST` arm finds it alive on the
  // trigger square and `get_target_i` numbers it `100 + slot`. This port's
  // chains are queued, not synchronous, so by the time one runs the creature is
  // dead — hence the seed, which pins what the C++ would have resolved.
  const dying = univ.town ? univ.town.monsters.indexOf(monst) : -1;
  const seed = dying >= 0 ? 100 + dying : null;
  if (monst.specialOnKill >= 0 && session) {
    // Fire and forget: the VM serialises chains through its own queue, which is
    // how the rest of this port launches a special from inside a sync path.
    void session.runSpecial(
      SpecCtx.KILL_MONST, SpecCtxType.TOWN, monst.specialOnKill, monst.curLoc, seed);
  }
  // A DEATH_TRIGGER ability runs a *scenario* special, where special_on_kill
  // above runs a town one.
  const trigger = monst.mon.abil[MonstAbil.DEATH_TRIGGER]!;
  if (trigger.active && session) {
    void session.runSpecial(
      SpecCtx.KILL_MONST, SpecCtxType.SCEN, trigger.special.extra1, monst.curLoc, seed);
  }

  // **Debug mode buys nothing** (boe.specials.cpp:1628 and :1643): no
  // experience, no glands, no treasure — the shift-D kill is for testing, and
  // paying for it would let a tester level the party up by walking through a
  // dungeon. All three of those *draw*, so this is not cosmetic.
  //
  // No experience for something the party summoned itself, either.
  if (!univ.debugMode && (monst.summonTime === 0 || !monst.partySummoned)) {
    const xp = monst.mon.level * 2;
    if (whoKilled < 6) awardXp(univ, whoKilled, xp);
    else if (whoKilled === 6) awardPartyXp(univ, Math.trunc(xp / 6) + 1);
    if (whoKilled < 7) {
      univ.party.totalMKilled++;
      awardPartyXp(univ, Math.max(Math.trunc(xp / 6), 1));
    }
    // Glands hang off the experience check, so something the party summoned
    // leaves no body part either.
    placeGlands(univ, monst.curLoc, monsterDef(univ, monst));
  }
  // Treasure has its own condition: a summoned creature carries nothing,
  // whoever called it up — and debug mode again buys none of it.
  if (!univ.debugMode && monst.summonTime === 0) {
    placeTreasure(univ, monst.curLoc, Math.trunc(monst.mon.level / 2), monst.mon.treasure, 0);
  }

  const town = univ.town;
  if (town) {
    const field = type === MainStatus.DUST
      ? FieldType.SFX_ASH
      : (type === MainStatus.ABSENT || type === MainStatus.STONE)
        ? null : goreField(monst.mon.race, false);
    // The stain builds up, as 1997's `make_sfx` has it (DIVERGENCES.md #56).
    if (field !== null) town.makeSfx(monst.curLoc.x, monst.curLoc.y, field);
    if (monst.summonTime === 0) town.record.monstersKilled++;
  }

  // Exile III's "magical supplies" jobs want the body (e3Jobs.ts).
  e3JobKill(session, monst.number);

  monst.spec1 = 0;
  monst.active = CreatureStatus.DEAD;
}

/**
 * place_glands looks its monster up by number (`scen_monsters[m_type]`, or
 * `party.summons` for a summoned one) rather than using the creature in hand.
 * A Creature here owns a copy of that same record, so the copy is the fallback
 * — but the scenario's original is preferred, since `set_town_attitude` and the
 * like mutate the copy.
 *
 * **A number of 10000 or more indexes `party.summons`** — the creatures a
 * scenario's summoning abilities added at run time, which have no entry in
 * `scen_monsters` at all.
 */
function monsterDef(univ: Universe, monst: Creature): Monster {
  const def = monst.number >= 10000
    ? univ.party.summons[monst.number - 10000]
    : univ.scenario.scenMonsters[monst.number];
  return def ?? monst.mon;
}

/** The dying sound, which depends on what kind of thing it was. */
function deathSound(univ: Universe, race: Race): void {
  if (isHumanoid(race)) {
    livingSound(29 + (race === Race.GOBLIN ? 4 : univ.rng.getRan(1, 0, 1)));
    return;
  }
  switch (race) {
    case Race.GIANT:
      livingSound(29);
      break;
    case Race.REPTILE: case Race.BEAST: case Race.DEMON:
    case Race.UNDEAD: case Race.SKELETAL: case Race.STONE:
      livingSound(31 + univ.rng.getRan(1, 0, 1));
      break;
    default:
      livingSound(33);
      break;
  }
}

/**
 * xp_percent (award_xp) — the percentage of an award a PC actually banks,
 * indexed by half their level. Levelling gets steeply less rewarding.
 */
const XP_PERCENT = [
  150, 120, 100, 90, 80, 70, 60, 50, 50, 50,
  45, 40, 40, 40, 40, 35, 30, 25, 23, 20,
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
];

/**
 * award_xp (boe.party.cpp) — give one PC experience and level them up as far
 * as it takes them. Note the level-up loop can run more than once.
 */
export function awardXp(
  univ: Universe, pcNum: number, amount: number, force = false,
): void {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;
  if (pc.level > 49) {
    pc.level = 50;
    return;
  }
  // **`force` skips the sanity check** (boe.party.cpp:323): more than 200
  // experience at once is a bug everywhere it can come from *play*, and the
  // C++ beeps, says "Oops! Too much xp! Report this!" and refuses. The one
  // caller that passes `force` is the `AFFECT_XP` special, where a scenario
  // means it.
  if (!force && amount > 200) {
    univ.addStringToBuf('Oops! Too much xp!');
    univ.addStringToBuf('Report this!');
    return;
  }
  if (amount < 0) {
    univ.addStringToBuf('Oops! Negative xp!');
    univ.addStringToBuf('Report this!');
    return;
  }
  if (!pc.isAlive) return;

  const bracket = XP_PERCENT[Math.min(Math.trunc(pc.level / 2), XP_PERCENT.length - 1)] ?? 15;
  const adjust = pc.level >= 40 ? 15 : bracket;
  // Past level 7 there's a chance a point simply evaporates before the scaling.
  if (amount > 0 && pc.level > 7 && univ.rng.getRan(1, 1, 100) < bracket) amount--;
  if (amount <= 0) return;

  amount = Math.trunc((amount * adjust) / 100);
  amount = Math.max(amount, 0);
  amount = Math.trunc((amount * pc.expAdj) / 100);
  pc.experience += amount;
  univ.party.totalXpGained += amount;

  if (pc.experience > 15000) {
    pc.experience = 15000;
    return;
  }

  while (pc.experience >= pc.level * pc.getTnl()) {
    livingSound(7);
    pc.level++;
    univ.addStringToBuf(`  ${pc.name} is level ${pc.level}!`);
    pc.skillPts += pc.level < 20 ? 5 : 4;
    // Health stops growing on its own at 26; after that only a strength bonus
    // adds anything.
    const strBonus = pc.statAdj(Skill.STRENGTH);
    let addHp = pc.level < 26
      ? univ.rng.getRan(1, 2, 6) + strBonus
      : Math.max(strBonus, 0);
    if (addHp < 0) addHp = 0;
    pc.maxHealth = Math.min(250, pc.maxHealth + addHp);
    pc.curHealth = Math.min(250, pc.curHealth + addHp);
  }
}

/** award_party_xp — the same award to everyone still standing. */
export function awardPartyXp(univ: Universe, amount: number): void {
  for (let i = 0; i < univ.party.pcs.length; i++) {
    if (univ.party.pcs[i]!.isAlive) awardXp(univ, i, amount);
  }
}

/** hit_party (boe.party.cpp:2489) — the same blow to every living PC. */
export async function hitParty(
  univ: Universe,
  howMuch: number,
  damType: DamageType,
  soundType = -1,
): Promise<void> {
  // One PC at a time, each waiting for its own blast: the C++ loops over the
  // party calling `damage_pc`, and every one of those blocks.
  for (const pc of univ.party.pcs) {
    if (!pc.isAlive) continue;
    await damagePc(univ, pc, howMuch, damType, Race.UNKNOWN, { soundType });
  }
}

/**
 * handle_marked_damage (boe.combat.cpp:1445) — apply what a volley marked up,
 * now that its projectiles and explosions have played. `MARKED` is a damage
 * type of its own so the second pass skips the reductions already taken (easy
 * mode, toughness, luck) and doesn't boom again — the explosion has been seen.
 */
export async function handleMarkedDamage(
  univ: Universe, session?: GameSession,
): Promise<void> {
  // MARKED damage draws no blast of its own — the volley already played it —
  // so these awaits cost nothing; they are here because the damage functions
  // are async, not because anything waits.
  for (const pc of univ.party.pcs) {
    if (pc.markedDamage > 0) {
      const marked = pc.markedDamage;
      pc.markedDamage = 0;
      await damagePc(univ, pc, marked, DamageType.MARKED, Race.UNKNOWN);
    }
  }
  for (const monst of univ.town?.monsters ?? []) {
    if (monst.markedDamage > 0) {
      const marked = monst.markedDamage;
      monst.markedDamage = 0;
      await damageMonst(univ, monst, univ.curPc, marked, DamageType.MARKED, { session });
    }
  }
}

/**
 * `radius_damage` (boe.combat.cpp:4308) — the only thing `TOWN_EXPLODE_SPACE`
 * does: everything within `radius` of a square takes `dam`, whatever is
 * between them.
 *
 * **The town branch has no volley**, with the C++'s own "TODO: Why no booms in
 * town mode?" over it, so out of combat the hits show one at a time as
 * `boom_space` sprites and the eleven redraws are never spent. Kept.
 *
 * **And in town the PC test measures from `party.town_loc`, not from the PC**
 * (:4312) — outside combat the party is one square, so the loop's `pc` is only
 * used to check that it is alive. Every living PC is hit or none is. The combat
 * branch below reads each PC's own `combat_pos`, as you would expect.
 *
 * The `dist(...) > 0` on both branches means **the square itself is spared**:
 * a creature standing exactly on the blast takes nothing.
 */
export async function radiusDamage(
  session: GameSession, target: Location, radius: number,
  dam: number, damType: DamageType,
): Promise<void> {
  const univ = session.univ;
  const monsters = univ.town?.monsters ?? [];
  const hitMonsters = async (from: (m: Creature) => number): Promise<void> => {
    for (const monst of monsters) {
      if (!monst.isAlive) continue;
      const d = from(monst);
      if (d <= 0 || d > radius) continue;
      if (session.canSeeLight(target, monst.curLoc) >= SIGHT_BLOCKED) continue;
      await damageMonst(univ, monst, univ.curPc, dam, damType, { session });
    }
  };

  if (isTown(session.mode)) {
    const partyDist = dist(target, univ.party.townLoc);
    for (const pc of univ.party.pcs) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      if (partyDist <= 0 || partyDist > radius) continue;
      await damagePc(univ, pc, dam, damType, Race.UNKNOWN);
    }
    await hitMonsters((m) => dist(target, m.curLoc));
    return;
  }

  startBoomAnim();
  try {
    for (const pc of univ.party.pcs) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      const d = dist(target, pc.combatPos);
      if (d <= 0 || d > radius) continue;
      await damagePc(univ, pc, dam, damType, Race.UNKNOWN);
    }
    await hitMonsters((m) => dist(target, m.curLoc));
  } finally {
    runBoomAnim(univ.rng, () => drawTerrain(session));
    endBoomAnim();
    await animSettle();
    await handleMarkedDamage(univ, session);
  }
}

/**
 * Where a blast sits on a creature bigger than one square. `boom_space` looks
 * up whatever monster is on the square it was handed and shifts the sprite by
 * `14 * (x_width - 1)` / `18 * (y_width - 1)` (boe.graphics.cpp:1541), which
 * is half a tile per extra column and row — i.e. onto the creature's middle.
 * `add_explosion` is passed the same thing (boe.specials.cpp:1507).
 *
 * Done at the call site rather than inside `boomSpace`, which has no way to
 * ask what is standing there; every caller that could be aiming at a big
 * creature has the creature in hand. Without it a bear takes its damage
 * number on its top-left square, which reads as "to the left of the bear".
 */
function bigCreatureAdj(victim: Creature): { xAdj: number; yAdj: number } {
  return { xAdj: 14 * (victim.xWidth - 1), yAdj: 18 * (victim.yWidth - 1) };
}

/** The explosion graphic a damage type uses, for whoever draws it. */
export function boomType(damType: DamageType): number {
  return BOOM_GR[damType] ?? 3;
}

/**
 * The explosion a hit inside a volley queues — 1997's `(dam_type > 2) ? 2 : 0`
 * (SPECIALS.CPP:1239, PARTY.CPP:3489): fire, weapons and poison the fire
 * burst, everything else the magic one; Exile III has the same three-kind
 * table (`boom_type_sound` `{5,10,53}`, EXE offset 0x5df32). OBoE's
 * `get_boom_type` gives unblockable 4 and cold 5, and this port used to take
 * the single-hit sprite (`boomType`) instead, so a Wound landed with
 * explosion 5 and sound 75, which neither original plays (DIVERGENCES.md §50).
 */
export function explosionType(damType: DamageType): number {
  return damType === DamageType.WEAPON || damType === DamageType.FIRE || damType === DamageType.POISON ? 0 : 2;
}

/** Where a hit should be drawn, for the animation the host will own. */
export function hitLocation(univ: Universe, pc: Player): Location {
  return pc.combatPos.x >= 0 ? pc.combatPos : univ.party.getLoc();
}
