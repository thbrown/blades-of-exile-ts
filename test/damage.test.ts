import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemAbil, ItemType } from '../src/data/item';
import { Attitude, DamageType } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import {
  boomType, explosionType, awardXp, damageMonst, damagePc, hitChance, hitParty, killMonst, killPc,
} from '../src/game/damage';
import { animClear, setAnimWaiter } from '../src/game/anim';
import { boomSpace, runBoomAnim, setBoomSink, startBoomAnim } from '../src/game/booms';
import { drawTerrain } from '../src/game/textBar';
import { Spell } from '../src/data/spell';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { assignCreature, Creature, CreatureStatus } from '../src/universe/creature';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, PartyStatus, Race, Skill, Status, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

function newGame(): { univ: Universe; session: GameSession } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  return { univ, session };
}

function monster(index: number, level?: number): Creature {
  const template = { ...scen.scenMonsters[index]!, resist: [...scen.scenMonsters[index]!.resist] };
  if (level !== undefined) template.level = level;
  const c = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: { x: 10, y: 10 },
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, template);
  return c;
}

/** A PC with nothing equipped, so the damage arithmetic is predictable. */
function bareFighter(univ: Universe): Player {
  const pc = univ.party.pcs[0]!;
  pc.items.forEach((_, i) => { pc.equip[i] = false; });
  pc.traits[Trait.TOUGHNESS] = false;
  pc.skills[Skill.LUCK] = 0;
  pc.skills[Skill.DEFENSE] = 0;
  pc.parry = 0;
  pc.maxHealth = 100;
  pc.curHealth = 100;
  return pc;
}

describe('damagePc', () => {
  it('takes unblockable damage straight off the health', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    expect(await damagePc(univ, pc, 10, DamageType.UNBLOCKABLE)).toBe(10);
    expect(pc.curHealth).toBe(90);
    expect(univ.party.totalDamTaken).toBe(10);
    expect(univ.transcript.at(-1)).toBe(`  ${pc.name} takes 10.`);
  });

  it('the dead take nothing', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.mainStatus = MainStatus.DEAD;
    expect(await damagePc(univ, pc, 50, DamageType.UNBLOCKABLE)).toBe(0);
  });

  it('reports "No damage" when the reductions eat it all', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.traits[Trait.TOUGHNESS] = true;
    expect(await damagePc(univ, pc, 1, DamageType.WEAPON)).toBe(0);
    expect(pc.curHealth).toBe(100);
    expect(univ.transcript.at(-1)).toBe('  No damage.');
  });

  it('invulnerability stops everything except assassination damage', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.INVULNERABLE] = 3;
    expect(await damagePc(univ, pc, 40, DamageType.FIRE)).toBe(0);
    expect(await damagePc(univ, pc, 40, DamageType.SPECIAL)).toBe(40);
  });

  it('magic resistance halves fire, and a curse on it doubles', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.MAGIC_RESISTANCE] = 4;
    expect(await damagePc(univ, pc, 20, DamageType.FIRE)).toBe(10);
    pc.status[Status.MAGIC_RESISTANCE] = -4;
    expect(await damagePc(univ, pc, 20, DamageType.COLD)).toBe(40);
  });

  it('a ring of full protection quarters it at strength 7', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.FULL_PROTECTION, abilStrength: 7,
    };
    pc.equip[0] = true;
    expect(await damagePc(univ, pc, 40, DamageType.MAGIC)).toBe(10);
    pc.items[0]!.abilStrength = 3;
    expect(await damagePc(univ, pc, 40, DamageType.MAGIC)).toBe(20);
    // It does nothing against a sword.
    expect(await damagePc(univ, pc, 40, DamageType.WEAPON)).toBe(40);
  });

  it('parry only helps against weapons', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.parry = 40; // a quarter of it comes off
    expect(await damagePc(univ, pc, 20, DamageType.WEAPON)).toBe(10);
    expect(await damagePc(univ, pc, 20, DamageType.FIRE)).toBe(20);
  });

  it('protection from a species halves it, and humanoids count twice over', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.PROTECT_FROM_SPECIES, abilData: Race.HUMANOID, abilStrength: 4,
    };
    pc.equip[0] = true;
    // A generic humanoid: one halving, from the exact match.
    expect(await damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.HUMANOID)).toBe(20);
    // A nephil is a humanoid *and* its own species, so it halves once here.
    expect(await damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.NEPHIL)).toBe(20);
    // Nothing at all against a beast.
    expect(await damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.BEAST)).toBe(40);
  });

  it('protection from undead also covers skeletons', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.PROTECT_FROM_SPECIES, abilData: Race.UNDEAD, abilStrength: 4,
    };
    pc.equip[0] = true;
    expect(await damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.SKELETAL)).toBe(20);
  });

  it('a hit stirs a sleeping PC toward waking', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.ASLEEP] = 3;
    await damagePc(univ, pc, 5, DamageType.UNBLOCKABLE);
    expect(pc.status[Status.ASLEEP]).toBe(2);
  });

  it('empties the health bar first and only kills on the next blow', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 4;
    await damagePc(univ, pc, 20, DamageType.UNBLOCKABLE);
    expect(pc.curHealth).toBe(0);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    await damagePc(univ, pc, 5, DamageType.UNBLOCKABLE);
    expect(pc.mainStatus).toBe(MainStatus.DEAD);
  });

  it('a big enough blow at zero health turns the PC to dust', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 0;
    await damagePc(univ, pc, 30, DamageType.UNBLOCKABLE);
    expect(pc.mainStatus).toBe(MainStatus.DUST);
    expect(univ.transcript).toContain(`  ${pc.name} is obliterated!`);
  });

  it('hitParty hits everyone still standing', async () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => {
      pc.maxHealth = 100;
      pc.curHealth = 100;
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
      // Toughness would take one off and make the arithmetic per-PC.
      pc.traits[Trait.TOUGHNESS] = false;
      pc.skills[Skill.LUCK] = 0;
    });
    univ.party.pcs[2]!.mainStatus = MainStatus.DEAD;
    const before = univ.party.pcs[2]!.curHealth;
    await hitParty(univ, 10, DamageType.UNBLOCKABLE);
    expect(univ.party.pcs[0]!.curHealth).toBe(90);
    expect(univ.party.pcs[1]!.curHealth).toBe(90);
    expect(univ.party.pcs[2]!.curHealth).toBe(before);
  });
});

describe('killPc', () => {
  it('luck can save you outright', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 20; // hit_chance 99, so it nearly always saves
    let saved = 0;
    for (let i = 0; i < 20; i++) {
      pc.mainStatus = MainStatus.ALIVE;
      killPc(univ, pc, MainStatus.DEAD);
      if (pc.mainStatus === MainStatus.ALIVE) saved++;
    }
    expect(saved).toBeGreaterThan(15);
    expect(univ.transcript).toContain('  But you luck out!');
  });

  it('spends a life-saving item instead of the life', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT, name: 'amulet',
      ability: ItemAbil.LIFE_SAVING, abilStrength: 1,
    };
    pc.equip[0] = true;
    killPc(univ, pc, MainStatus.DEAD);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    expect(pc.curHealth).toBe(pc.maxHealth);
    expect(pc.items[0]!.ability).not.toBe(ItemAbil.LIFE_SAVING);
    expect(univ.transcript).toContain('  Life saved!');
  });

  it('petrification is not something an amulet understands', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.LIFE_SAVING, abilStrength: 1,
    };
    pc.equip[0] = true;
    killPc(univ, pc, MainStatus.STONE);
    expect(pc.mainStatus).toBe(MainStatus.STONE);
  });

  it('drops the whole pack on the floor and leaves a stain', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.items[0] = { ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'sword' };
    pc.items[1] = { ...pc.items[1]!, variety: ItemType.POTION, name: 'potion' };
    const town = univ.town!;
    const itemsBefore = town.items.length;
    const where = univ.party.townLoc;

    killPc(univ, pc, MainStatus.DEAD);
    expect(pc.mainStatus).toBe(MainStatus.DEAD);
    expect(town.items.length).toBe(itemsBefore + 2);
    expect(pc.items[0]!.variety).toBe(ItemType.NO_ITEM);
    expect(town.hasField(where.x, where.y, FieldType.SFX_LARGE_BLOOD)).toBe(true);
    // The active PC moves on to someone alive.
    expect(univ.party.pcs[univ.curPc]!.isAlive).toBe(true);
  });

  it('a slith leaves slime, and dust leaves ash', async () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.race = Race.SLIME;
    killPc(univ, pc, MainStatus.DEAD);
    const { x, y } = univ.party.townLoc;
    expect(univ.town!.hasField(x, y, FieldType.SFX_LARGE_SLIME)).toBe(true);

    const other = univ.party.pcs[1]!;
    other.skills[Skill.LUCK] = 0;
    killPc(univ, other, MainStatus.DUST);
    expect(univ.town!.hasField(x, y, FieldType.SFX_ASH)).toBe(true);
  });
});

describe('damageMonst', () => {
  it('scales by the monster resistance for that damage type', async () => {
    const { univ } = newGame();
    const monst = monster(1, 40);
    monst.mon.armor = 0;
    monst.mon.resist[DamageType.FIRE] = 50;
    monst.health = 500;
    // Level 40 always makes the elemental saving throw, so 20 -> 10 -> 5.
    expect(await damageMonst(univ, monst, 0, 20, DamageType.FIRE)).toBe(5);
  });

  it('invulnerable monsters take a tenth, and it stacks with the status', async () => {
    const { univ } = newGame();
    const monst = monster(1, 1);
    monst.mon.armor = 0;
    monst.mon.invuln = true;
    monst.health = 5000;
    expect(await damageMonst(univ, monst, 0, 1000, DamageType.UNBLOCKABLE)).toBe(100);
    monst.status[Status.INVULNERABLE] = 3;
    expect(await damageMonst(univ, monst, 0, 1000, DamageType.UNBLOCKABLE)).toBe(10);
    // Assassination damage goes through regardless.
    expect(await damageMonst(univ, monst, 0, 100, DamageType.SPECIAL)).toBe(100);
  });

  it('a hit alerts the monster and costs it morale', async () => {
    const { univ } = newGame();
    const monst = monster(1, 10);
    monst.mon.armor = 0;
    monst.health = 500;
    monst.active = CreatureStatus.IDLE;
    const morale = monst.morale;
    await damageMonst(univ, monst, 0, 12, DamageType.UNBLOCKABLE);
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    // >0, >5 and >10 each cost one.
    expect(monst.morale).toBe(morale - 3);
  });

  it('dying runs kill_monst: the SDF, the mess, the count and the xp', async () => {
    const { univ } = newGame();
    const monst = monster(1, 5);
    monst.mon.armor = 0;
    monst.mon.race = Race.SKELETAL;
    monst.spec1 = 3;
    monst.spec2 = 4;
    monst.health = 1;
    const town = univ.town!;
    const killedBefore = town.record.monstersKilled;
    const xpBefore = univ.party.pcs[0]!.experience;

    await damageMonst(univ, monst, 0, 50, DamageType.UNBLOCKABLE);
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.party.getSdf(3, 4)).toBe(1);
    expect(monst.spec1).toBe(0); // so a summoned one can't come back
    expect(town.record.monstersKilled).toBe(killedBefore + 1);
    expect(town.hasField(monst.curLoc.x, monst.curLoc.y, FieldType.SFX_BONES)).toBe(true);
    expect(univ.party.pcs[0]!.experience).toBeGreaterThan(xpBefore);
    expect(univ.party.totalMKilled).toBe(1);
    expect(univ.transcript).toContain(`  ${monst.getName()} dies.`);
  });

  it('hurting a friendly is noticed', async () => {
    const { univ } = newGame();
    const monst = monster(1, 10);
    monst.mon.armor = 0;
    monst.health = 500;
    monst.attitude = Attitude.DOCILE;
    await damageMonst(univ, monst, 0, 20, DamageType.UNBLOCKABLE);
    expect(univ.transcript).toContain('Damaged an innocent.');
    expect(monst.attitude).toBe(Attitude.HOSTILE_A);
  });

  it('gives nothing for a monster the party summoned itself', async () => {
    const { univ } = newGame();
    const monst = monster(1, 5);
    monst.summonTime = 10;
    monst.partySummoned = true;
    const xpBefore = univ.party.pcs[0]!.experience;
    killMonst(univ, monst, 0);
    expect(univ.party.pcs[0]!.experience).toBe(xpBefore);
    expect(univ.party.totalMKilled).toBe(0);
  });
});

describe('debug mode', () => {
  /**
   * `univ.debug_mode` is not only a key gate. `damage_monst` sets the victim's
   * health to **-1** outright (boe.specials.cpp:1532), so any hit kills; and
   * `kill_monst` skips the experience, the glands and the treasure (:1628,
   * :1643), so a tester clearing a dungeon levels nobody up and picks nothing
   * up. All three of those draw, so a replay that flips the switch mid-run
   * diverges immediately if the flag is only a transcript line — which is what
   * it was here, and `VoDT_02-05-2025_16-42-15` turns it on at action 240.
   */
  it('kills whatever it touches, and pays nothing for it', async () => {
    const { univ } = newGame();
    const monst = monster(1, 10);
    monst.mon.armor = 0;
    monst.health = 500;
    univ.debugMode = true;
    const xpBefore = univ.party.pcs[0]!.experience;
    const killsBefore = univ.party.totalMKilled;

    await damageMonst(univ, monst, 0, 1, DamageType.UNBLOCKABLE);

    expect(monst.isAlive).toBe(false);
    // No experience, and the kill is not even counted — `total_m_killed` sits
    // inside the same `if(!univ.debug_mode)`.
    expect(univ.party.pcs[0]!.experience).toBe(xpBefore);
    expect(univ.party.totalMKilled).toBe(killsBefore);
  });
});

describe('awardXp', () => {
  it('scales the award by level and levels the PC up', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.level = 1;
    pc.experience = 0;
    pc.expAdj = 100;
    const hpBefore = pc.maxHealth;
    // xp_percent[0] = 150, so an award at level 1 is worth half again.
    awardXp(univ, 0, 100);
    expect(pc.experience).toBe(150);
    expect(pc.level).toBeGreaterThan(1);
    expect(pc.maxHealth).toBeGreaterThan(hpBefore);
    expect(pc.skillPts).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('is level'))).toBe(true);
  });

  it('caps at 15000 experience and level 50', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.experience = 14990;
    awardXp(univ, 0, 200);
    expect(pc.experience).toBe(15000);
    pc.level = 50;
    awardXp(univ, 0, 100);
    expect(pc.level).toBe(50);
  });

  it('gives the dead nothing, and refuses a negative award', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.mainStatus = MainStatus.DEAD;
    pc.experience = 0;
    awardXp(univ, 0, 100);
    expect(pc.experience).toBe(0);
    pc.mainStatus = MainStatus.ALIVE;
    awardXp(univ, 0, -50);
    expect(pc.experience).toBe(0);
  });
});

describe('hit_chance', () => {
  it('reads the table and flattens out at 99', async () => {
    expect(hitChance(0)).toBe(20);
    expect(hitChance(5)).toBe(55);
    expect(hitChance(20)).toBe(99);
    expect(hitChance(200)).toBe(99);
  });
});

describe('damaging terrain', () => {
  it('hurts the whole party when they walk into it', async () => {
    const { univ, session } = newGame();
    // Find a town with damaging terrain and stand the party on it.
    let found: { town: number; x: number; y: number } | null = null;
    for (let t = 0; t < scen.towns.length && !found; t++) {
      const town = scen.towns[t]!;
      for (let x = 0; x < town.maxDim && !found; x++) {
        for (let y = 0; y < town.maxDim; y++) {
          const ter = town.terrain[x]![y]!;
          if (scen.terTypes[ter]!.special === TerSpec.DAMAGING) {
            found = { town: t, x, y };
            break;
          }
        }
      }
    }
    if (!found) return; // valleydy may have none; nothing to assert then
    session.startTownMode(found.town, FORCED_ENTRY);
    univ.party.pcs.forEach((pc) => {
      pc.maxHealth = 200;
      pc.curHealth = 200;
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
    });
    await session.moveTo({ x: found.x, y: found.y });
    const hurt = univ.party.pcs.filter((pc) => pc.curHealth < 200).length;
    expect(hurt).toBeGreaterThan(0);
  });

  /**
   * `if(univ.party.status[ePartyStatus::FIREWALK] > 0) { … r1 = -1; }`
   * (boe.specials.cpp:342) — **and only for fire**: the C++'s own comment
   * beside it says it would be nice to have the same for the other damaging
   * terrains, and it does not.
   */
  it('firewalk makes burning ground harmless, and nothing else', async () => {
    const { univ, session } = newGame();
    let found: { town: number; x: number; y: number; fire: boolean } | null = null;
    for (let t = 0; t < scen.towns.length && !found; t++) {
      const town = scen.towns[t]!;
      for (let x = 0; x < town.maxDim && !found; x++) {
        for (let y = 0; y < town.maxDim; y++) {
          const spec = scen.terTypes[town.terrain[x]![y]!]!;
          if (spec.special !== TerSpec.DAMAGING) continue;
          found = { town: t, x, y, fire: spec.flag3 === DamageType.FIRE };
          break;
        }
      }
    }
    // valleydy has burning ground; if a future scenario swap removes it this
    // test would pass vacuously, so say so rather than quietly return.
    expect(found?.fire).toBe(true);
    if (!found) return;
    session.startTownMode(found.town, FORCED_ENTRY);
    univ.party.pcs.forEach((pc) => {
      pc.maxHealth = 200;
      pc.curHealth = 200;
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
    });
    univ.party.partyStatus[PartyStatus.FIREWALK] = 5;
    await session.moveTo({ x: found.x, y: found.y });
    expect(univ.party.pcs.every((pc) => pc.curHealth === 200)).toBe(true);
    expect(univ.transcript.join(' ')).toContain("It doesn't affect you.");
  });

  /**
   * Exile 3's swamps (`10c0:16a0`, the `swamp` = `exile3:cave,surface` flag):
   * `one_sound(17)` before any roll, then one `get_ran(1,1,3)` per PC that
   * isn't warded — Cave Lore in the cave swamp — and a boat spares the party
   * outright, sound and all. Any walkable square stands in for the swamp.
   */
  it("poisons and squelches in E3's swamps, and Cave Lore spends no roll", async () => {
    const saved = scen.featureFlags['swamp'];
    try {
      const walk = async (setUp: (univ: Universe) => void, swamp = true): Promise<{ univ: Universe; draws: number; played: number[] }> => {
        // Into the first square beside the start the party can enter, whose
        // terrain the flag names as the cave swamp.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          const { univ, session } = newGame();
          const at = { x: univ.party.townLoc.x + dx, y: univ.party.townLoc.y + dy };
          scen.featureFlags['swamp'] = swamp ? `exile3:${univ.town!.record.terrain[at.x]![at.y]!},9999` : 'exile3:9998,9999';
          const played: number[] = [];
          session.sound = { play: (n: number) => { played.push(n); } } as unknown as GameSession['sound'];
          setUp(univ);
          const before = univ.rng.gameCalls;
          if (await session.moveTo(at)) return { univ, draws: univ.rng.gameCalls - before, played };
        }
        throw new Error('nowhere to step');
      };
      const dry = await walk(() => undefined, false);
      expect(dry.played).not.toContain(17);
      const plain = await walk(() => undefined);
      expect(plain.played[0]).toBe(17);
      // The rolls shift every draw after them, so only "none at all" is exact:
      // the same count as the dry step.
      expect(plain.draws).not.toBe(dry.draws);
      expect(plain.univ.party.pcs.some((pc) => (pc.status[Status.POISON] ?? 0) > 0)).toBe(true);
      const warded = await walk((univ) => { univ.party.pcs.forEach((pc) => { pc.traits[Trait.CAVE_LORE] = true; }); });
      expect(warded.played[0]).toBe(17);
      expect(warded.draws).toBe(dry.draws);
      // Woodsman is the other swamp's: no help in this one.
      const woods = await walk((univ) => { univ.party.pcs.forEach((pc) => { pc.traits[Trait.WOODSMAN] = true; }); });
      expect(woods.draws).toBe(plain.draws);
      // A boat spares the party: no squelch, no rolls.
      const boat = await walk((univ) => { univ.party.inBoat = 0; });
      expect(boat.played).not.toContain(17);
      expect(boat.draws).toBe(dry.draws);
    } finally {
      if (saved === undefined) delete scen.featureFlags['swamp'];
      else scen.featureFlags['swamp'] = saved;
    }
  });

  /**
   * In combat E3's swamp arm rolls for the mover first (`10c0:1731`) and only
   * then asks after the ward (`10c0:1750`), so a warded mover spends a die
   * where out of combat they spend none.
   */
  it("rolls for a combat mover in E3's swamps before asking after the ward", () => {
    const { univ, session } = newGame();
    const swamp = (session as unknown as {
      e3Swamp(ter: number, swamps: { caveLore: number; woodsman: number }, inCombat: boolean): void;
    }).e3Swamp.bind(session);
    const pc = univ.currentPc;
    const asked: number[][] = [];
    univ.rng.getRan = (times: number, min: number, max: number): number => {
      asked.push([times, min, max]);
      return 2; // the bite, if nothing wards it off
    };
    pc.traits[Trait.CAVE_LORE] = true;
    swamp(88, { caveLore: 88, woodsman: 90 }, true);
    expect(asked).toEqual([[1, 1, 3]]);
    expect(pc.status[Status.POISON] ?? 0).toBe(0);
    // Out of combat the same PC rolls nothing, and the others are bitten.
    asked.length = 0;
    swamp(88, { caveLore: 88, woodsman: 90 }, false);
    expect(asked.filter(([t, lo, hi]) => t === 1 && lo === 1 && hi === 3).length)
      .toBe(univ.party.pcs.filter((p) => p.mainStatus === MainStatus.ALIVE && !p.traits[Trait.CAVE_LORE]).length);
    expect(pc.status[Status.POISON] ?? 0).toBe(0);
  });

  /**
   * Exile 3's lava (`10c0:15ab`, the `lava` = `exile3` flag): "  LAVA!" and
   * the terrain's dice, and firewalk is tested before the roll, so it spends
   * no draws and says "You walk over the lava." instead.
   */
  it("burns with E3's words under the lava flag, and firewalk spends no roll", async () => {
    let found: { town: number; x: number; y: number } | null = null;
    for (let t = 0; t < scen.towns.length && !found; t++) {
      const town = scen.towns[t]!;
      for (let x = 0; x < town.maxDim && !found; x++) {
        for (let y = 0; y < town.maxDim; y++) {
          const spec = scen.terTypes[town.terrain[x]![y]!]!;
          if (spec.special === TerSpec.DAMAGING && spec.flag3 === DamageType.FIRE) {
            found = { town: t, x, y };
            break;
          }
        }
      }
    }
    expect(found).not.toBeNull();
    if (!found) return;
    const saved = scen.featureFlags['lava'];
    scen.featureFlags['lava'] = 'exile3';
    try {
      const walk = async (firewalk: number): Promise<{ univ: Universe; draws: number }> => {
        const { univ, session } = newGame();
        session.startTownMode(found.town, FORCED_ENTRY);
        univ.party.pcs.forEach((pc) => {
          pc.maxHealth = 200;
          pc.curHealth = 200;
          pc.items.forEach((_, i) => { pc.equip[i] = false; });
        });
        univ.party.partyStatus[PartyStatus.FIREWALK] = firewalk;
        const before = univ.rng.gameCalls;
        await session.moveTo({ x: found.x, y: found.y });
        return { univ, draws: univ.rng.gameCalls - before };
      };
      const burnt = await walk(0);
      expect(burnt.univ.transcript.join(' ')).toContain('LAVA!');
      expect(burnt.univ.party.pcs.some((pc) => pc.curHealth < 200)).toBe(true);
      const safe = await walk(5);
      expect(safe.univ.transcript.join(' ')).toContain('You walk over the lava.');
      expect(safe.univ.party.pcs.every((pc) => pc.curHealth === 200)).toBe(true);
      expect(safe.draws).toBeLessThan(burnt.draws);
    } finally {
      if (saved === undefined) delete scen.featureFlags['lava'];
      else scen.featureFlags['lava'] = saved;
    }
  });
});

/**
 * `boom_space`'s own two `draw_terrain()`s (boe.graphics.cpp:1512 and :1525),
 * which in combat are dice: one encumbrance roll each for the acting PC. They
 * are what a Conflagration spends between one square it burns and the next,
 * and this port used to spend nothing there at all.
 */
describe("boom_space's redraws", () => {
  /** What one full redraw costs this party. See `src/game/textBar.ts`. */
  function redrawCost(session: GameSession): number {
    const before = session.univ.rng.gameCalls;
    drawTerrain(session);
    return session.univ.rng.gameCalls - before;
  }

  /** A fight with PC 0 acting and a recast hint, so the status bar rolls. */
  function fighting(): { univ: Universe; session: GameSession; pc: Player } {
    const { univ, session } = newGame();
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    const pc = univ.party.pcs[0]!;
    pc.lastCastType = Skill.MAGE_SPELLS;
    pc.lastCast[Skill.MAGE_SPELLS] = Spell.LIGHT;
    // …and one equipped awkward item, which is what `total_encumbrance`
    // actually rolls for.
    pc.items[0]!.variety = ItemType.ONE_HANDED;
    pc.items[0]!.awkward = 1;
    pc.equip[0] = true;
    // `pc_can_cast_spell` refuses above the encumbrance roll for no skill and
    // for no spell points, and a refusal makes no dice.
    pc.skills[Skill.MAGE_SPELLS] = 5;
    pc.curSp = 20;
    return { univ, session, pc };
  }

  it('a hit on screen costs two redraws, one off screen costs one', () => {
    const { univ, session, pc } = fighting();
    const per = redrawCost(session);
    expect(per).toBeGreaterThan(0);

    let before = univ.rng.gameCalls;
    boomSpace(pc.combatPos, 3, 5, 0, univ.rng);
    expect(univ.rng.gameCalls - before).toBe(2 * per);

    // Off screen in combat, `boom_space` plays the sound and returns after the
    // first redraw — so a blast the camera is not looking at is half the price.
    // "Off screen" is the *camera*, not the party: the PC standing on the
    // square still sees it.
    session.center = { x: pc.combatPos.x + 20, y: pc.combatPos.y };
    expect(session.partyCanSee(pc.combatPos)).toBeLessThan(6);
    before = univ.rng.gameCalls;
    boomSpace(pc.combatPos, 3, 5, 0, univ.rng);
    expect(univ.rng.gameCalls - before).toBe(per);
  });

  it('a hit nobody can see draws nothing at all', () => {
    const { univ, session, pc } = fighting();
    const per = redrawCost(session);
    expect(per).toBeGreaterThan(0);
    // `party_can_see(where) == 6` returns above everything (boe.graphics.cpp:1502).
    const unseen = { x: pc.combatPos.x + 40, y: pc.combatPos.y + 40 };
    expect(session.partyCanSee(unseen)).toBe(6);
    const before = univ.rng.gameCalls;
    boomSpace(unseen, 3, 5, 0, univ.rng);
    expect(univ.rng.gameCalls).toBe(before);
  });

  /**
   * `damage_monst`'s "no damage" arm (boe.specials.cpp:1520) is a
   * `draw_terrain(2)`, so it costs a die only when somebody is *acting*:
   * `current_working_monster` is the PC in a swing and -1 in `process_fields`.
   */
  it("damage_monst's bounced blow redraws only while someone is acting", async () => {
    const { univ, session, pc } = fighting();
    const per = redrawCost(session);
    expect(per).toBeGreaterThan(0);
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    monst.mon.armor = 100;
    monst.curLoc = { x: pc.combatPos.x + 1, y: pc.combatPos.y };

    // Nobody acting: free, as a blade wall in `process_fields` is.
    session.workingMonster = -1;
    let before = univ.rng.gameCalls;
    await damageMonst(univ, monst, 0, 1, DamageType.WEAPON, { session });
    const idle = univ.rng.gameCalls - before;

    session.workingMonster = 0;
    before = univ.rng.gameCalls;
    await damageMonst(univ, monst, 0, 1, DamageType.WEAPON, { session });
    expect(univ.rng.gameCalls - before).toBe(idle + per);
  });

  it('inside a volley it queues instead, and draws nothing', () => {
    const { univ, session, pc } = fighting();
    expect(redrawCost(session)).toBeGreaterThan(0);
    startBoomAnim();
    const before = univ.rng.gameCalls;
    boomSpace(pc.combatPos, 3, 5, 0, univ.rng);
    expect(univ.rng.gameCalls).toBe(before);
    runBoomAnim(univ.rng);
  });
});

/**
 * The blast comes first, then what it did. `boom_space` sleeps for the whole
 * explosion and `damage_pc`/`damage_monst` only take the health off *after* it
 * returns (boe.party.cpp:2660-2686) — which is why these functions are async
 * here. With no animation waiter installed the wait is a microtask rather than
 * real time, and that is enough to pin the order.
 */
describe('damage lands after its blast', () => {
  /** An anim waiter that logs, so the order of blast and state is visible. */
  function trace(): { log: string[]; done: () => void } {
    const log: string[] = [];
    setBoomSink((b) => { log.push(`boom:${b.damage}`); });
    setAnimWaiter(async () => { log.push('settled'); });
    return {
      log,
      done: () => { setBoomSink(null); setAnimWaiter(null); animClear(); },
    };
  }

  it('a PC keeps their health until the explosion is over', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.maxHealth = 100;
    pc.curHealth = 100;
    const { log, done } = trace();
    try {
      const hit = damagePc(univ, pc, 10, DamageType.UNBLOCKABLE);
      // The synchronous half is over: the blast is booked and on screen…
      expect(log.some((l) => l.startsWith('boom'))).toBe(true);
      // …and the health has not moved yet.
      expect(pc.curHealth).toBe(100);
      await hit;
      expect(pc.curHealth).toBe(90);
      expect(log).toEqual(['boom:10', 'settled']);
    } finally {
      done();
    }
  });

  it('a monster dies after its blast, not during it', async () => {
    const { univ, session } = newGame();
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    // Next to the party, because `boom_space` draws nothing for a square
    // `party_can_see` reports as unseen — and the rat this picks starts across
    // the fort.
    monst.curLoc = { x: univ.party.townLoc.x + 1, y: univ.party.townLoc.y };
    monst.mon.armor = 0;
    monst.mon.resist.fill(100);
    monst.maxHealth = 10;
    monst.health = 10;
    const { log, done } = trace();
    try {
      const hit = damageMonst(univ, monst, 0, 50, DamageType.UNBLOCKABLE, { session });
      expect(monst.isAlive).toBe(true);
      await hit;
      expect(monst.isAlive).toBe(false);
      expect(log[0]).toMatch(/^boom:/);
      expect(log).toContain('settled');
    } finally {
      done();
    }
  });
});

/**
 * The turn does not change hands until the swing has finished playing. In the
 * C++ that is automatic — `pc_attack` blocks all the way through `boom_space`,
 * and `combat_next_step` only runs afterwards. Here it is `attackAt` awaiting
 * `pcAttack` before it calls `afterCombatAction`.
 */
describe('the turn waits for the blow', () => {
  it('the active PC and the "Active:" line come after the blast', async () => {
    const { univ, session } = newGame();
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    monst.maxHealth = monst.health = 5000;
    monst.mon.armor = 0;
    monst.mon.resist.fill(100);
    session.startCombat(univ.party.direction);
    const startedAs = univ.curPc;
    const pc = univ.party.pcs[startedAs]!;
    pc.skills[Skill.DEXTERITY] = 20;
    pc.skills[Skill.EDGED_WEAPONS] = 20;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'sword', fullName: 'sword',
      itemLevel: 10, weapType: Skill.EDGED_WEAPONS, ability: ItemAbil.NONE,
    };
    pc.equip[0] = true;
    monst.curLoc = { x: pc.combatPos.x + 1, y: pc.combatPos.y };

    let booms = 0;
    const settled: string[] = [];
    setBoomSink(() => { booms++; });
    setAnimWaiter(async () => { settled.push('settled'); });
    try {
      // Swing until one connects — a miss draws no blast and so waits for
      // nothing, which is the case this is *not* about.
      let checked = false;
      for (let i = 0; i < 40 && !checked; i++) {
        pc.ap = 4;
        univ.curPc = startedAs;
        const lines = univ.transcript.length;
        const before = booms;
        const swing = session.attackAt(monst.curLoc);
        if (booms > before) {
          // Mid-swing: the blast is on screen, and the turn has *not* moved
          // on. Before the blast booked its own time, both the hand-over and
          // its announcement had already happened by this point.
          expect(univ.curPc).toBe(startedAs);
          expect(univ.transcript.slice(lines).some((l) => l.startsWith('Active:'))).toBe(false);
          checked = true;
        }
        await swing;
        await session.settled();
      }
      expect(checked).toBe(true);
      // And the swing really did wait on the timeline for its blast.
      expect(settled.length).toBeGreaterThan(0);
    } finally {
      setBoomSink(null);
      setAnimWaiter(null);
      animClear();
    }
  });
});

describe("a hit's burst, by 1997's tables", () => {
  it('queues the fire burst for fire, weapons and poison in a volley, else the magic one', () => {
    for (const t of [DamageType.WEAPON, DamageType.FIRE, DamageType.POISON]) expect(explosionType(t)).toBe(0);
    for (const t of [DamageType.MAGIC, DamageType.UNBLOCKABLE, DamageType.COLD, DamageType.UNDEAD, DamageType.DEMON])
      expect(explosionType(t)).toBe(2);
  });

  it("draws Wound's single hit as the magic burst, not OBoE's sprite 5", () => {
    expect(boomType(DamageType.UNBLOCKABLE)).toBe(1);
    expect(boomType(DamageType.COLD)).toBe(4);
  });
});
