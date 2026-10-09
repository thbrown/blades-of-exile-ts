import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { defaultItem, ItemAbil, ItemType } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { DamageType } from '../src/data/monster';
import { Enchant, enchantOfName, enchantWeapon } from '../src/data/enchant';
import { E3Abil, e3ActionPoints, e3AttackAdj, e3CombatRoundItems, e3DamageResist, e3MissileHitBonus, e3OnMeleeHit, e3SpecDam } from '../src/game/e3Items';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature } from '../src/universe/creature';
import { curWeight, getProtLevel, giveItem, hasAbilEquip, uncurse } from '../src/universe/inventory';
import { PartyPreset, Player } from '../src/universe/player';
import { Race, Skill, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;
beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
});

/** A universe whose every roll is the lowest the call allows, plus `plus`. */
const low = (plus = 0, log: string[] = []) => ({
  rng: { getRan: (_n: number, min: number) => min + plus },
  addStringToBuf: (line: string) => log.push(line),
}) as unknown as Universe;

function setup(): { univ: Universe; pc: Player } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  return { univ, pc: univ.party.pcs[0]! };
}

function wear(pc: Player, slot: number, e3Ability: number, itemLevel: number, ability = ItemAbil.NONE): void {
  pc.items[slot] = { ...pc.items[slot]!, variety: ItemType.RING, itemLevel, ability, abilStrength: itemLevel, e3Ability };
  pc.equip[slot] = true;
}

function creature(race: Race, number = 1): Creature {
  const c = new Creature();
  c.number = number;
  c.mon = { ...c.mon, race };
  return c;
}

describe("Exile III's item rules (src/game/e3Items.ts)", () => {
  it('rings and gauntlets add E3\'s sums to a blow, not BoE\'s', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    // A Gold Skill Ring (level 2): (2+1)*5 to the roll, 2 to the damage.
    wear(pc, 20, E3Abil.SKILL, 2, ItemAbil.SKILL);
    expect(e3AttackAdj(pc)).toEqual({ hit: 15, dam: 2 });
    // ... which BoE's own SKILL rule no longer also counts.
    expect(hasAbilEquip(pc, ItemAbil.SKILL, -1, true)).toBeNull();
    wear(pc, 21, E3Abil.OGRISH_GAUNTLETS, 3, ItemAbil.GIANT_STRENGTH);
    wear(pc, 22, E3Abil.GIANT_GAUNTLETS, 3, ItemAbil.GIANT_STRENGTH);
    expect(e3AttackAdj(pc)).toEqual({ hit: 15 + 1 + 5, dam: 2 + 2 + 3 });
  });

  it('an Accuracy Ring adds its level + 1 to a shot', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    expect(e3MissileHitBonus(pc)).toBe(0);
    wear(pc, 20, E3Abil.ACCURACY, 1, ItemAbil.ACCURACY);
    expect(e3MissileHitBonus(pc)).toBe(2);
  });

  it("weapons' extra damage is E3's table", () => {
    const univ = low();
    expect(e3SpecDam(univ, E3Abil.FLAMING, creature(Race.HUMAN))).toBe(8);
    expect(e3SpecDam(univ, E3Abil.FLAMING, creature(Race.DEMON))).toBe(0);
    expect(e3SpecDam(univ, E3Abil.DEMONSLAYER, creature(Race.DEMON))).toBe(25);
    expect(e3SpecDam(univ, E3Abil.UNDEAD_BANE, creature(Race.UNDEAD))).toBe(5);
    expect(e3SpecDam(univ, E3Abil.GIANT_BANE, creature(Race.GIANT))).toBe(20);
    expect(e3SpecDam(univ, E3Abil.GIANT_BANE, creature(Race.HUMAN))).toBe(0);
    expect(e3SpecDam(univ, E3Abil.REPTILE_BANE, creature(Race.REPTILE))).toBe(50);
    expect(e3SpecDam(univ, E3Abil.BEAST_BANE, creature(Race.BEAST, 166))).toBe(30);
    expect(e3SpecDam(univ, E3Abil.BEAST_BANE, creature(Race.BEAST, 168))).toBe(0);
  });

  it('a venomous blade poisons by 2 half the time', () => {
    const { pc } = setup();
    const weap = { ...pc.items[0]!, e3Ability: E3Abil.VENOM, abilStrength: 8 };
    const target = creature(Race.HUMAN);
    e3OnMeleeHit(low(1), weap, target);
    expect(target.status[Status.POISON]).toBeGreaterThan(0);
    const missed = creature(Race.HUMAN);
    e3OnMeleeHit(low(), weap, missed);
    expect(missed.status[Status.POISON] ?? 0).toBe(0);
  });

  it('speed items give E3\'s action points, and worn items act once a round', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    wear(pc, 20, E3Abil.OCCASIONAL_HASTE, 4, ItemAbil.SPEED);
    wear(pc, 21, E3Abil.DANCING, 1, ItemAbil.SLOW_WEARER);
    expect(e3ActionPoints(pc)).toBe(0);
    wear(pc, 22, E3Abil.RING_OF_SPEED, 0, ItemAbil.SPEED);
    wear(pc, 23, E3Abil.BOOTS_OF_SPEED, 2, ItemAbil.SPEED);
    expect(e3ActionPoints(pc)).toBe(2);
    // Every roll a 5: the helm hastes by 1 and the boots curse by 2.
    pc.status[Status.HASTE_SLOW] = 0;
    pc.status[Status.BLESS_CURSE] = 0;
    const log: string[] = [];
    e3CombatRoundItems(low(5, log), pc);
    expect(pc.status[Status.HASTE_SLOW]).toBe(1);
    expect(pc.status[Status.BLESS_CURSE]).toBe(-2);
    expect(log).toEqual(['Helm of speed glows.', `${pc.name} starts dancing!`]);
  });

  it('resistances halve once, whatever the strength, and only for their own kind', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    // Pachtar's Plate: BoE's FULL_PROTECTION 11 would quarter a fireball.
    wear(pc, 20, E3Abil.RESISTANCE, 11, ItemAbil.FULL_PROTECTION);
    expect(getProtLevel(pc, ItemAbil.FULL_PROTECTION, -1, true)).toBe(0);
    expect(e3DamageResist(pc, DamageType.FIRE, 40)).toBe(20);
    expect(e3DamageResist(pc, DamageType.WEAPON, 40)).toBe(40);
    // The Iceshield is a fire ward in E3, and stacks with Resistance.
    wear(pc, 21, E3Abil.FIRE_RES, 6, ItemAbil.DAMAGE_PROTECTION);
    expect(e3DamageResist(pc, DamageType.FIRE, 40)).toBe(10);
    expect(e3DamageResist(pc, DamageType.COLD, 40)).toBe(20);
    // The Silver Ankh against the undead, the Demonslayer against demons.
    wear(pc, 22, E3Abil.UNDEAD_WARD, 0, ItemAbil.DAMAGE_PROTECTION);
    wear(pc, 23, E3Abil.DEMONSLAYER, 18, ItemAbil.SLAYER_WEAPON);
    expect(e3DamageResist(pc, DamageType.UNDEAD, 9)).toBe(4);
    expect(e3DamageResist(pc, DamageType.DEMON, 9)).toBe(4);
  });

  it('poison, disease and dumbfounding go by E3\'s codes', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    pc.traits.fill(false);
    const high = { getRan: (_n: number, _min: number, max: number) => max } as unknown as GameRng;
    // Steel Plate (77): one off, where BoE's STATUS_PROTECTION 9 took four.
    wear(pc, 20, E3Abil.POISON_DISEASE, 9, ItemAbil.STATUS_PROTECTION);
    pc.items[20]!.abilData = Status.POISON;
    pc.status[Status.POISON] = 0;
    pc.poison(4, high);
    expect(pc.status[Status.POISON]).toBe(3);
    pc.status[Status.DISEASE] = 0;
    pc.disease(4, high);
    expect(pc.status[Status.DISEASE]).toBe(3);
    // Resistance (127) takes one more off a dose of poison.
    wear(pc, 21, E3Abil.RESISTANCE, 11, ItemAbil.FULL_PROTECTION);
    pc.status[Status.POISON] = 0;
    pc.poison(4, high);
    expect(pc.status[Status.POISON]).toBe(2);
    // E3's Ring of Will is its 75, with 1997's roll: 90 − 10 against level.
    pc.equip.fill(false);
    wear(pc, 22, E3Abil.WILL, 0, ItemAbil.WILL);
    pc.level = 81;
    pc.status[Status.DUMB] = 0;
    pc.dumbfound(2, high);
    expect(pc.status[Status.DUMB] ?? 0).toBe(0);
  });

  it('Micah\'s Gloves add to intelligence\'s adjustment, not to the skill', () => {
    const { pc } = setup();
    pc.equip.fill(false);
    const before = pc.statAdj(Skill.INTELLIGENCE);
    const dex = pc.statAdj(Skill.DEXTERITY);
    const skill = pc.skill(Skill.INTELLIGENCE);
    wear(pc, 10, 99, 1, ItemAbil.BOOST_STAT);
    pc.items[10]!.abilData = Skill.INTELLIGENCE;
    expect(pc.statAdj(Skill.INTELLIGENCE)).toBe(before + 1);
    expect(pc.skill(Skill.INTELLIGENCE)).toBe(skill);
    // Not dexterity's: `10b0:87e2` is `if (which == 2)`.
    expect(pc.statAdj(Skill.DEXTERITY)).toBe(dex);
    // Past the sixteenth slot E3 doesn't look.
    pc.items[20] = pc.items[10]!;
    pc.equip[20] = true;
    pc.items[10] = { ...pc.items[10]!, variety: ItemType.NO_ITEM };
    pc.equip[10] = false;
    expect(pc.statAdj(Skill.INTELLIGENCE)).toBe(before);
  });

  it('lifting a curse zeroes E3\'s curse code, so Dancing Boots stop dancing', () => {
    const { pc } = setup();
    wear(pc, 20, E3Abil.DANCING, 1, ItemAbil.SLOW_WEARER);
    pc.items[20]!.cursed = true;
    uncurse(pc.items[20]!);
    expect(pc.items[20]!.cursed).toBe(false);
    expect(pc.items[20]!.e3Ability).toBe(0);
  });

  it("the Lodestone and Airy Stone change as they are taken (give_to_pc, 1070:01d1)", () => {
    const { univ, pc } = setup();
    for (let i = 0; i < pc.items.length; i++) pc.items[i] = defaultItem();
    pc.equip.fill(false);
    const rock = (e3Ability: number, ability: ItemAbil) => ({
      ...defaultItem(), variety: ItemType.NON_USE_OBJECT, weight: 5, e3Ability, ability,
    });

    // The Lodestone: cursed, worn, identified, 20 — and no BoE +30 on top.
    const lode = giveItem(pc, univ.party, rock(129, ItemAbil.HEAVIER_OBJECT));
    const l = pc.items[lode.slot]!;
    expect([l.e3Ability, l.weight, l.ident, l.cursed, pc.equip[lode.slot]]).toEqual([14, 20, true, true, true]);
    expect(curWeight(pc)).toBe(20);

    // The Airy Stone: E3 reads its -20 unsigned, so it weighs 236, and with
    // its code gone the -30 is lost too.
    const airy = giveItem(pc, univ.party, rock(117, ItemAbil.LIGHTER_OBJECT));
    const a = pc.items[airy.slot]!;
    expect([a.e3Ability, a.weight, a.ident, a.cursed, pc.equip[airy.slot]]).toEqual([0, 236, true, false, false]);
    expect(curWeight(pc)).toBe(256);

    // One that arrived some other way keeps E3's -30, and the total stops at 0.
    for (let i = 0; i < pc.items.length; i++) pc.items[i] = defaultItem();
    pc.items[0] = rock(117, ItemAbil.LIGHTER_OBJECT);
    expect(curWeight(pc)).toBe(0);
  });
});

describe("Exile III's enchanting (1070:0e2e)", () => {
  const sword = (e3Ability: number) => ({ ...defaultItem(), variety: ItemType.ONE_HANDED, fullName: 'Iron Sword', value: 10, e3Ability });

  it("puts E3's ability on an E3 item, beside BoE's", () => {
    const flaming = sword(0);
    enchantWeapon(flaming, Enchant.FLAMING);
    expect([flaming.fullName, flaming.ability, flaming.e3Ability]).toEqual(['Iron Sword (F!)', ItemAbil.DAMAGING_WEAPON, E3Abil.FLAMING]);
    // The blessed blade is E3's healing potion, 8 charges of it; the shooting one a bolt of flame.
    const blessed = sword(0);
    enchantWeapon(blessed, Enchant.BLESSED);
    expect([blessed.bonus, blessed.e3Ability, blessed.charges]).toEqual([1, 3, 8]);
    const shooting = sword(0);
    enchantWeapon(shooting, Enchant.SHOOT_FLAME);
    expect([shooting.e3Ability, shooting.charges]).toEqual([5, 8]);
    // A plus is only the bonus, and a BoE item keeps no E3 number.
    const plus = sword(0);
    enchantWeapon(plus, Enchant.PLUS_TWO);
    expect([plus.bonus, plus.e3Ability]).toEqual([2, 0]);
    const boe = sword(-1);
    enchantWeapon(boe, Enchant.BLESSED);
    expect([boe.e3Ability, boe.charges]).toEqual([-1, 0]);
  });

  it('reads the enchantment back from the name', () => {
    expect(enchantOfName('Iron Rapier (B)')).toBe(Enchant.BLESSED);
    expect(enchantOfName('Iron Halberd (+1)')).toBe(Enchant.PLUS_ONE);
    expect(enchantOfName('Bronze Knife')).toBe(Enchant.NONE);
  });
});
