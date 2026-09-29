/**
 * Exile III's own item rules, for the abilities where its code and BoE's part.
 *
 * An E3 item carries E3's ability number (`Item.e3Ability`, -1 on anything
 * else) beside the BoE ability the converter gave it, and E3's code reads the
 * item's *level* where BoE reads an ability strength. Where the two rules give
 * different numbers, the callers here take E3's for E3's items and leave BoE's
 * rule to everything else (`hasAbilEquip`'s and `getProtLevel`'s `notE3`).
 * The BoE ability stays on the item so that its description still names it.
 *
 * `project/exile3.c` addresses are Ghidra's; see `tools/e3convert/FORMATS.md`.
 */
import { ItemType, type Item } from '../data/item';
import { DamageType } from '../data/monster';
import { e3AbilEquip } from '../universe/inventory';
import type { Player } from '../universe/player';
import type { Living } from '../universe/living';
import { Creature } from '../universe/creature';
import { Race, Status } from '../universe/skills';
import type { Universe } from '../universe/universe';

/** E3's ability numbers that the rules below read. */
export const E3Abil = {
  /** Poisoned blade: half the time, poison 2 on a melee hit. */
  VENOM: 32,
  FLAMING: 33,
  DEMON_BANE: 34,
  UNDEAD_BANE: 35,
  DEMONSLAYER: 50,
  GIANT_BANE: 51,
  ACCURACY: 70,
  OGRISH_GAUNTLETS: 96,
  GIANT_GAUNTLETS: 97,
  SKILL: 101,
  REPTILE_BANE: 131,
  BEAST_BANE: 134,
  /** Helm of Speed: now and then, haste 1. No action points. */
  OCCASIONAL_HASTE: 42,
  /** Fang Necklace: now and then, bless 1. */
  OCCASIONAL_BLESS: 47,
  RING_OF_SPEED: 74,
  BOOTS_OF_SPEED: 94,
  /** Dancing Boots: now and then, bless −2. No action points lost. */
  DANCING: 95,
  /** Asp Gloves: now and then, poison 2. */
  ASP_GLOVES: 98,
  /** Halves magic damage (the Onyx Charm). */
  MAGIC_RES: 2,
  /** Halves fire damage: the Ruby Charm, the Ring of Fire Res., Robes — and the Iceshield. */
  FIRE_RES: 16,
  /** Halves an undead creature's blows (the Silver Ankh). */
  UNDEAD_WARD: 48,
  /** Halves cold damage (the Ring of Warmth). */
  COLD_RES: 66,
  /** "Ring of Will glows.": a better roll against being dumbfounded. */
  WILL: 75,
  /** One off each dose of poison and of disease (the Amber Periapt, Steel Plate). */
  POISON_DISEASE: 77,
  /**
   * Halves fire, poison, magic and cold damage, takes one off a dose of
   * poison and two off a sleep (the Ring of Resistance, Pachtar's Plate).
   */
  RESISTANCE: 127,
} as const;

export { e3AbilEquip };

/**
 * The melee adjustments E3's attack (`1018:0edd`) makes for three rings and
 * gloves, in place of BoE's SKILL and GIANT_STRENGTH. `hit` is added to the
 * roll, where lower hits — so, as in 1997's `pc_attack`, a Skill Ring makes a
 * blow *harder* to land while the character sheet counts it as a bonus. E3
 * has the same slip; kept. 1997's own character sheet still tests these three
 * E3 numbers (INFODLGS.CPP:833–845), with these same sums.
 */
export function e3AttackAdj(pc: Player): { hit: number; dam: number } {
  let hit = 0;
  let dam = 0;
  const skill = e3AbilEquip(pc, E3Abil.SKILL);
  if (skill) {
    hit += (skill.itemLevel + 1) * 5;
    dam += skill.itemLevel;
  }
  if (e3AbilEquip(pc, E3Abil.OGRISH_GAUNTLETS)) {
    dam += 2;
    hit += 1;
  }
  if (e3AbilEquip(pc, E3Abil.GIANT_GAUNTLETS)) {
    hit += 5;
    dam += 3;
  }
  return { hit, dam };
}

/**
 * E3's missile accuracy (`1018:38ba`): the first Accuracy Ring worn adds its
 * level + 1 to the hit bonus, and nothing to the damage (BoE's ACCURACY adds
 * half its strength to both).
 */
export function e3MissileHitBonus(pc: Player): number {
  const ring = e3AbilEquip(pc, E3Abil.ACCURACY);
  return ring ? ring.itemLevel + 1 : 0;
}

/**
 * E3's `calc_spec_dam` (`1018:1915`, a table of eight cases): the extra damage
 * a weapon of E3 ability `code` adds to a hit, as special damage. It rolls
 * only when the target qualifies. The races are E3's monster types, which the
 * converter carries over as BoE's (`convertMonster`: type + 3).
 *
 * Case 128 (`FUN_1090_377a(monst, 3)`) is left out: no item of E3's has it.
 */
export function e3SpecDam(univ: Universe, code: number, target: Living): number {
  const race = target instanceof Creature ? target.mon.race : null;
  switch (code) {
    case E3Abil.FLAMING:
      // Not against demons — the only case that tests for *not* a type.
      return race === Race.DEMON ? 0 : univ.rng.getRan(1, 0, 5) + 8;
    case E3Abil.DEMON_BANE: case E3Abil.DEMONSLAYER:
      return race === Race.DEMON ? univ.rng.getRan(1, 0, 10) + 25 : 0;
    case E3Abil.UNDEAD_BANE:
      return race === Race.UNDEAD ? univ.rng.getRan(1, 0, 10) + 5 : 0;
    case E3Abil.GIANT_BANE:
      return race === Race.GIANT ? univ.rng.getRan(1, 0, 11) + 20 : 0;
    case E3Abil.REPTILE_BANE:
      return race === Race.REPTILE ? 50 : 0;
    case E3Abil.BEAST_BANE:
      // By monster, not type: the Alien Beast and its Pack Leader.
      return target instanceof Creature && (target.number === 166 || target.number === 167) ? 30 : 0;
    default:
      return 0;
  }
}

/**
 * What a landed melee blow does next with an E3 weapon (`1018:0edd`, after
 * the poisoned-weapon status): only a venomous blade does anything, and half
 * the time poisons by 2 whatever the blade. E3's missiles have no such step
 * at all.
 */
export function e3OnMeleeHit(univ: Universe, weap: Item, target: Living): void {
  if (weap.e3Ability !== E3Abil.VENOM) return;
  if (univ.rng.getRan(1, 0, 1) === 1) {
    univ.addStringToBuf('  Blade drips venom.');
    target.poison(2, univ.rng);
  }
}

/**
 * E3's action points (`10b0:a0ce`): a Ring of Speed and Boots of Speed add one
 * each, and nothing else worn changes them — not the Helm of Speed, and not
 * Dancing Boots. BoE's SPEED and SLOW_WEARER leave E3's items to this.
 */
export function e3ActionPoints(pc: Player): number {
  return (e3AbilEquip(pc, E3Abil.RING_OF_SPEED) ? 1 : 0) + (e3AbilEquip(pc, E3Abil.BOOTS_OF_SPEED) ? 1 : 0);
}

/**
 * What E3's worn items do to a living PC once a combat round (`1018:43f2`,
 * after the round's statuses wear down), in its order. Each rolls only when
 * worn, and each fires on a 5: one in eleven, the Asp Gloves one in thirteen.
 * BoE's OCCASIONAL_STATUS leaves E3's items to this.
 */
export function e3CombatRoundItems(univ: Universe, pc: Player): void {
  const rollFive = (max: number): boolean => univ.rng.getRan(1, 0, max) === 5;
  if (e3AbilEquip(pc, E3Abil.OCCASIONAL_HASTE) && rollFive(10)) {
    pc.status[Status.HASTE_SLOW] = (pc.status[Status.HASTE_SLOW] ?? 0) + 1;
    univ.addStringToBuf('Helm of speed glows.');
  }
  const fang = e3AbilEquip(pc, E3Abil.OCCASIONAL_BLESS);
  if (fang && rollFive(10)) {
    pc.status[Status.BLESS_CURSE] = (pc.status[Status.BLESS_CURSE] ?? 0) + 1;
    univ.addStringToBuf(fang.variety === ItemType.NECKLACE ? 'Necklace glows.' : 'Gauntlets glow.');
  }
  if (e3AbilEquip(pc, E3Abil.DANCING) && rollFive(10)) {
    pc.status[Status.BLESS_CURSE] = (pc.status[Status.BLESS_CURSE] ?? 0) - 2;
    univ.addStringToBuf(`${pc.name} starts dancing!`);
  }
  if (e3AbilEquip(pc, E3Abil.ASP_GLOVES) && rollFive(12)) {
    univ.addStringToBuf(`${pc.name} feels ill.`);
    pc.poison(2, univ.rng);
  }
}

/**
 * What E3's `damage_pc` (`10b0:9676`) does to a hit for the items it tests,
 * in place of BoE's DAMAGE_PROTECTION, PROTECT_FROM_SPECIES and
 * FULL_PROTECTION (which skip E3's items). Each only ever halves — E3 has
 * none of 1997's "strength 7 or more quarters it" — so the order among them
 * and against the magic-resistance status doesn't matter. The Demonslayer
 * wards off demons' blows while it is wielded. The Iceshield really is a
 * *fire* ward in E3 (code 16, as the Ruby Charm); bladbase made it cold's.
 *
 * Code 1 in `poison_pc` and the fire ×3/4 on party+0x4c are not items; they
 * are left to `Player.poison` and to nothing, respectively (no item carries
 * code 1, and nothing in the port sets the second).
 */
export function e3DamageResist(pc: Player, damType: DamageType, howMuch: number): number {
  const halve = (code: number, ...types: DamageType[]) => {
    if (types.includes(damType) && e3AbilEquip(pc, code)) howMuch = Math.trunc(howMuch / 2);
  };
  halve(E3Abil.UNDEAD_WARD, DamageType.UNDEAD);
  halve(E3Abil.DEMONSLAYER, DamageType.DEMON);
  halve(E3Abil.MAGIC_RES, DamageType.MAGIC);
  halve(E3Abil.FIRE_RES, DamageType.FIRE);
  halve(E3Abil.COLD_RES, DamageType.COLD);
  halve(E3Abil.RESISTANCE, DamageType.FIRE, DamageType.POISON, DamageType.MAGIC, DamageType.COLD);
  return howMuch;
}
