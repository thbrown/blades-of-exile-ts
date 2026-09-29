import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemAbil, ItemType } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { E3Abil, e3ActionPoints, e3AttackAdj, e3CombatRoundItems, e3MissileHitBonus, e3OnMeleeHit, e3SpecDam } from '../src/game/e3Items';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature } from '../src/universe/creature';
import { hasAbilEquip } from '../src/universe/inventory';
import { PartyPreset, Player } from '../src/universe/player';
import { Race, Status } from '../src/universe/skills';
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
});
