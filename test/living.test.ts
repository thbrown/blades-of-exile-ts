import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemAbil, ItemType } from '../src/data/item';
import { Attitude, DamageType } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { resetFeatureFlags, setFeatureFlags } from '../src/game/featureFlags';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { assignCreature, Creature, CHARM_ODDS } from '../src/universe/creature';
import { Living, SpellNote, setGiveHelp, setPrintResult } from '../src/universe/living';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, Race, Skill, Status, Trait, statusInfo } from '../src/universe/skills';
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

/** A creature built from a named monster in the scenario, for the tests below. */
function monster(index: number): Creature {
  const template = scen.scenMonsters[index]!;
  return assignCreature(0, {
    number: index,
    startAttitude: Attitude.HOSTILE_A,
    startLoc: { x: 10, y: 10 },
    mobility: 1,
    timeFlag: 0,
    timeCode: 0,
    monsterTime: 0,
    spec1: -1,
    spec2: -1,
    specEncCode: 0,
    personality: -1,
    facialPic: -1,
    specialOnTalk: -1,
    specialOnKill: -1,
  } as never, template);
}

describe('the iLiving seam', () => {
  it('is shared by both a PC and a monster', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    const monst = monster(1);
    expect(pc).toBeInstanceOf(Living);
    expect(monst).toBeInstanceOf(Living);
    // The same code can read either of them.
    const both: Living[] = [pc, monst];
    for (const who of both) {
      expect(who.getName().length).toBeGreaterThan(0);
      expect(who.getHealth()).toBeGreaterThan(0);
      expect(who.isAlive).toBe(true);
    }
  });

  it('clamps a status to its bounds, and refuses to wrap sleep through zero', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.applyStatus(Status.BLESS_CURSE, 100);
    expect(pc.status[Status.BLESS_CURSE]).toBe(8);
    pc.applyStatus(Status.BLESS_CURSE, -100);
    expect(pc.status[Status.BLESS_CURSE]).toBe(-8);
    // Resisting sleep (a negative value) can be spent but not overshot.
    pc.status[Status.ASLEEP] = -4;
    pc.applyStatus(Status.ASLEEP, 6);
    expect(pc.status[Status.ASLEEP]).toBe(0);
  });

  it('the dead take no statuses at all', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.mainStatus = MainStatus.DEAD;
    pc.applyStatus(Status.POISON, 5);
    expect(pc.status[Status.POISON]).toBe(0);
  });

  it('clearBadStatus keeps the blessings and drops the afflictions', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.BLESS_CURSE] = 4; // a blessing on a positive status
    pc.status[Status.POISON] = 3; // an affliction on a negative one
    pc.status[Status.HASTE_SLOW] = -2; // slowed: bad, on a positive status
    pc.status[Status.ASLEEP] = -3; // alertness: good, on a negative one
    pc.clearBadStatus();
    expect(pc.status[Status.BLESS_CURSE]).toBe(4);
    expect(pc.status[Status.POISON]).toBe(0);
    expect(pc.status[Status.HASTE_SLOW]).toBe(0);
    expect(pc.status[Status.ASLEEP]).toBe(-3);
    // The table those decisions come from.
    expect(statusInfo(Status.POISON).isNegative).toBe(true);
    expect(statusInfo(Status.BLESS_CURSE).isNegative).toBe(false);
  });

  it('clearBriefStatus keeps poison, disease, dumbness and bad acid', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.POISON] = 3;
    pc.status[Status.DISEASE] = 2;
    pc.status[Status.DUMB] = 1;
    pc.status[Status.WEBS] = 5;
    pc.status[Status.ACID] = 1;
    pc.clearBriefStatus();
    expect(pc.status[Status.POISON]).toBe(3);
    expect(pc.status[Status.DISEASE]).toBe(2);
    expect(pc.status[Status.DUMB]).toBe(1);
    expect(pc.status[Status.WEBS]).toBe(0);
    expect(pc.status[Status.ACID]).toBe(0); // a light case washes off
    pc.status[Status.ACID] = 4;
    pc.clearBriefStatus();
    expect(pc.status[Status.ACID]).toBe(4); // a bad one doesn't
  });

  it('spellNote formats through the print_result hook', async () => {
    const lines: string[] = [];
    const monst = monster(1);
    setPrintResult((line) => lines.push(line));
    try {
      monst.spellNote(SpellNote.ASLEEP);
      monst.damagedMsg(7, 2);
      monst.printAttacks(monst);
    } finally {
      setPrintResult(null);
    }
    expect(lines[0]).toBe(`  ${monst.getName()} falls asleep.`);
    expect(lines[1]).toBe(`  ${monst.getName()} takes 7+2`);
    expect(lines[2]).toBe(`${monst.getName()} attacks themself`);
    // With no hook installed the effects are simply silent.
    monst.spellNote(SpellNote.DIES);
    expect(lines.length).toBe(3);
  });
});

describe('a PC taking effects', () => {
  it('poison is worse for the frail and blunted by protection', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.FRAIL] = false;
    pc.poison(3, univ.rng);
    expect(pc.status[Status.POISON]).toBe(3);

    pc.status[Status.POISON] = 0;
    pc.traits[Trait.FRAIL] = true;
    pc.poison(3, univ.rng);
    expect(pc.status[Status.POISON]).toBe(4);

    // A ring of poison protection with strength 6 takes 3 off the dose.
    pc.status[Status.POISON] = 0;
    pc.traits[Trait.FRAIL] = false;
    pc.items[0] = {
      ...pc.items[0]!,
      variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.STATUS_PROTECTION,
      abilData: Status.POISON,
      abilStrength: 6,
    };
    pc.equip[0] = true;
    pc.poison(3, univ.rng);
    expect(pc.status[Status.POISON]).toBe(0);
  });

  it('curse and bless are the same call with opposite signs', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.curse(3);
    expect(pc.status[Status.BLESS_CURSE]).toBe(-3);
    pc.curse(-5);
    expect(pc.status[Status.BLESS_CURSE]).toBe(2);
    expect(univ.transcript.at(-1)).toBe(`  ${pc.name} blessed.`);
  });

  it('acid ignores the usual bounds but a ring stops it dead', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    // Straight assignment in the C++, so it can exceed the 0..8 range.
    pc.acid(12);
    expect(pc.status[Status.ACID]).toBe(12);

    const other = univ.party.pcs[1]!;
    other.items[0] = {
      ...other.items[0]!,
      variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.STATUS_PROTECTION,
      abilData: Status.ACID,
      abilStrength: 1,
    };
    other.equip[0] = true;
    other.acid(5);
    expect(other.status[Status.ACID]).toBe(0);
    expect(univ.transcript.at(-1)).toBe(`  ${other.name} resists acid.`);
  });

  it('the unliving never sleep, and free action makes paralysis hopeless', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.race = Race.SKELETAL;
    pc.sleep(Status.ASLEEP, 5, 0, univ.rng);
    expect(pc.status[Status.ASLEEP]).toBe(0);

    const other = univ.party.pcs[1]!;
    other.items[0] = {
      ...other.items[0]!,
      variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.FREE_ACTION,
      abilStrength: 1,
    };
    other.equip[0] = true;
    // Free action costs paralysis 300 per point, so nothing lands.
    other.sleep(Status.PARALYZED, 100, 0, univ.rng);
    expect(other.status[Status.PARALYZED]).toBe(0);
  });

  it("saves against sleep by the PC's level, as 1997 does, but by free action in a replay", async () => {
    const roll = (n: number) => ({ getRan: () => n }) as unknown as GameRng;
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.HIGHLY_ALERT] = false;
    pc.level = 20;
    try {
      // 1997: 30 + 2 × 20 = 70, so a 69 saves and a 70 doesn't.
      pc.sleep(Status.ASLEEP, 5, 0, roll(69));
      expect(pc.status[Status.ASLEEP]).toBe(0);
      pc.sleep(Status.PARALYZED, 5, 0, roll(69));
      expect(pc.status[Status.PARALYZED]).toBe(0);
      pc.sleep(Status.ASLEEP, 5, 0, roll(70));
      expect(pc.status[Status.ASLEEP]).toBe(5);
      // OBoE, whose recordings never list the flag: 30 + 2 × free action.
      pc.status[Status.ASLEEP] = 0;
      setFeatureFlags({});
      pc.sleep(Status.ASLEEP, 5, 0, roll(30));
      expect(pc.status[Status.ASLEEP]).toBe(5);
    } finally {
      resetFeatureFlags();
    }
  });

  it("judges Exile III's items by its own rule (DIVERGENCES.md #23)", async () => {
    const roll = (n: number) => ({ getRan: () => n }) as unknown as GameRng;
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.HIGHLY_ALERT] = false;
    pc.level = 1;
    // What the converter makes: BoE's free action (strength 3 or 7), and E3's own code.
    const wear = (e3Ability: number, ability: ItemAbil, abilStrength: number) => {
      pc.items[0] = { ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT, ability, abilStrength, e3Ability };
      pc.equip[0] = true;
      pc.status[Status.ASLEEP] = 0;
      pc.status[Status.PARALYZED] = 0;
    };
    // The Helm of Alertness (118): no sleep at all; paralysis as usual.
    wear(118, ItemAbil.FREE_ACTION, 3);
    pc.sleep(Status.ASLEEP, 5, 0, roll(99));
    expect(pc.status[Status.ASLEEP]).toBe(0);
    pc.sleep(Status.PARALYZED, 5, 0, roll(99));
    expect(pc.status[Status.PARALYZED]).toBe(5);
    // The Ring of Free Action (120): no paralysis, and 2 off a sleep (not 7).
    wear(120, ItemAbil.FREE_ACTION, 7);
    pc.sleep(Status.PARALYZED, 5, 0, roll(99));
    expect(pc.status[Status.PARALYZED]).toBe(0);
    pc.sleep(Status.ASLEEP, 5, 0, roll(99));
    expect(pc.status[Status.ASLEEP]).toBe(3);
    // Resistance (127): 2 off a sleep.
    wear(127, ItemAbil.FULL_PROTECTION, 6);
    pc.sleep(Status.ASLEEP, 5, 0, roll(99));
    expect(pc.status[Status.ASLEEP]).toBe(3);
  });

  it('being highly alert is total immunity to sleep', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.HIGHLY_ALERT] = true;
    // 200 is what the specials pass when the effect is meant to be unavoidable.
    for (let i = 0; i < 20; i++) pc.sleep(Status.ASLEEP, 8, 200, univ.rng);
    expect(pc.status[Status.ASLEEP]).toBe(0);
  });

  it('sleep costs the turn but a forcecage does not', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.HIGHLY_ALERT] = false;
    pc.ap = 4;
    // The saving roll is `get_ran(1,1,100) + adjust`, and a *low* result is the
    // save, so a big positive adjustment is what guarantees the effect lands.
    pc.sleep(Status.ASLEEP, 5, 200, univ.rng);
    expect(pc.status[Status.ASLEEP]).toBe(5);
    expect(pc.ap).toBe(0);

    pc.ap = 4;
    pc.sleep(Status.FORCECAGE, 20, 200, univ.rng);
    expect(pc.status[Status.FORCECAGE]).toBe(19); // a cage always loses one
    expect(pc.ap).toBe(4);
  });

  it('drainSp is mostly shrugged off by a caster', async () => {
    const { univ } = newGame();
    const mage = univ.party.pcs[3]!; // Adrianna has mage spells
    mage.skills[Skill.MAGE_SPELLS] = 3;
    mage.curSp = 20;
    mage.drainSp(9, true);
    expect(mage.curSp).toBe(17); // a third of the drain

    const fighter = univ.party.pcs[0]!;
    fighter.skills[Skill.MAGE_SPELLS] = 0;
    fighter.skills[Skill.PRIEST_SPELLS] = 0;
    fighter.maxSp = 20;
    fighter.curSp = 20;
    fighter.drainSp(9, true);
    expect(fighter.curSp).toBe(11); // all of it
  });

  it('avatar tops the PC up and clears the bad statuses', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.curHealth = 1;
    pc.status[Status.POISON] = 6;
    pc.status[Status.DISEASE] = 4;
    pc.status[Status.WEBS] = 3;
    pc.avatar();
    expect(pc.curHealth).toBe(pc.maxHealth);
    expect(pc.status[Status.POISON]).toBe(0);
    expect(pc.status[Status.DISEASE]).toBe(0);
    expect(pc.status[Status.WEBS]).toBe(0);
    expect(pc.status[Status.INVULNERABLE]).toBe(3);
    expect(pc.status[Status.MARTYRS_SHIELD]).toBe(8);
  });

  it('void_sanctuary tells you when it drops your invisibility', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.INVISIBLE] = 4;
    pc.voidSanctuary();
    expect(pc.status[Status.INVISIBLE]).toBe(0);
    expect(univ.transcript).toContain('You become visible!');
  });

  it('getLoc falls back to the party square until the PC is placed', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    expect(pc.getLoc()).toEqual(univ.party.townLoc);
    pc.combatPos = { x: 7, y: 9 };
    expect(pc.getLoc()).toEqual({ x: 7, y: 9 });
  });

  it('only a charm turns a PC hostile', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    const monst = monster(1); // hostile
    expect(pc.isFriendly).toBe(true);
    expect(pc.isFriendlyTo(monst)).toBe(false);
    pc.status[Status.CHARM] = 1;
    expect(pc.isFriendly).toBe(false);
    expect(pc.isFriendlyTo(monst)).toBe(true);
    expect(pc.isFriendlyTo(univ.party.pcs[1]!)).toBe(false);
  });

  it('a martyr shares damage back only with the shield up', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    expect(pc.isShielded()).toBe(false);
    expect(pc.getSharedDmg(10, univ.rng)).toBe(0);
    pc.status[Status.MARTYRS_SHIELD] = 4;
    expect(pc.isShielded()).toBe(true);
    expect(pc.getSharedDmg(10, univ.rng)).toBe(10);
  });
});

/**
 * `give_help` (strdlog.cpp:182) — the instant-help box a status effect raises
 * the first time it happens to you. It matters here because it is **modal**:
 * in a replay it eats the recording's next click, and a click let through
 * instead becomes a main-loop iteration of its own, which in combat is a
 * `draw_terrain` and therefore a die.
 */
describe('the instant-help boxes the status effects raise', () => {
  function withHelp(fn: (pc: Player, univ: Universe) => void): number[] {
    const { univ } = newGame();
    const seen: number[] = [];
    setGiveHelp((h1) => seen.push(h1));
    try {
      fn(univ.party.pcs[0]!, univ);
    } finally {
      setGiveHelp(null);
    }
    return seen;
  }

  it('web, poison, disease, dumbfound, slow and sleep each raise their own', () => {
    expect(withHelp((pc) => { pc.web(4); })).toEqual([31]);
    expect(withHelp((pc, univ) => { pc.poison(3, univ.rng); })).toEqual([33]);
    expect(withHelp((pc, univ) => { pc.disease(9, univ.rng); })).toEqual([29]);
    expect(withHelp((pc, univ) => { pc.dumbfound(20, univ.rng); })).toEqual([28]);
    expect(withHelp((pc) => { pc.slow(4); })).toEqual([35]);
    // A *high* `adjust` is what lands it: `r1 = get_ran(1,1,100) + adjust`, and
    // anything under 30 is shrugged off.
    expect(withHelp((pc, univ) => {
      pc.traits[Trait.HIGHLY_ALERT] = false;
      pc.sleep(Status.ASLEEP, 50, 100, univ.rng);
    })).toEqual([30]);
    expect(withHelp((pc, univ) => { pc.sleep(Status.PARALYZED, 50, 100, univ.rng); }))
      .toEqual([32]);
  });

  it('a blessing raises none, and a curse raises 59', () => {
    // The C++'s second arm is `else if(how_much > 0)` under the first
    // `if(how_much > 0)` — dead code, so help 34 can never fire.
    expect(withHelp((pc) => { pc.curse(-3); })).toEqual([]);
    expect(withHelp((pc) => { pc.curse(3); })).toEqual([59]);
  });

  it('a saving throw that shrugs the effect off raises nothing', () => {
    // `disease` prints "saved." and returns above the `give_help`.
    expect(withHelp((pc, univ) => {
      pc.level = 50;
      pc.disease(1, univ.rng);
    })).toEqual([]);
  });
});

describe('a monster taking effects', () => {
  it('scales effects by its magic resistance', async () => {
    const monst = monster(1);
    monst.mon.resist[DamageType.MAGIC] = 50;
    monst.curse(4);
    expect(monst.status[Status.BLESS_CURSE]).toBe(-2);
    // Poison goes by the poison resistance instead.
    monst.mon.resist[DamageType.POISON] = 0;
    monst.poison(6);
    expect(monst.status[Status.POISON]).toBe(0);
  });

  it('fear works on morale, not on a status', async () => {
    const monst = monster(1);
    const before = monst.morale;
    monst.scare(5);
    expect(monst.morale).toBe(before - 5);
    monst.scare(-3);
    expect(monst.morale).toBe(before - 2);
  });

  it('charm sets the attitude rather than a duration', async () => {
    const monst = monster(1);
    monst.mon.level = 1; // charm_odds[0] = 90, so a low roll lands
    const rng = new GameRng();
    for (let i = 0; i < 40 && monst.attitude === Attitude.HOSTILE_A; i++) {
      monst.sleep(Status.CHARM, 2, -80, rng);
    }
    expect(monst.attitude).toBe(Attitude.FRIENDLY);
  });

  it('nothing high-level can be charmed, because charm_odds runs out', async () => {
    const monst = monster(1);
    monst.mon.level = 40; // CHARM_ODDS[20] = 0, so no roll can beat it
    expect(CHARM_ODDS[20]).toBe(0);
    const rng = new GameRng();
    for (let i = 0; i < 30; i++) monst.sleep(Status.CHARM, 2, 0, rng);
    expect(monst.attitude).toBe(Attitude.HOSTILE_A);
  });

  it('sleep still lands on a high-level monster a quarter of the time', async () => {
    // ASLEEP subtracts 25 from the roll *before* the charm_odds comparison, so
    // any roll of 1-25 comes out at or below zero and beats even a 0 threshold.
    // Paralysis gets the same treatment with 15. This is why sleep is worth
    // casting on things nothing else will stick to.
    const rng = new GameRng();
    let slept = 0;
    for (let i = 0; i < 200; i++) {
      const monst = monster(1);
      monst.mon.level = 40;
      monst.sleep(Status.ASLEEP, 5, 0, rng);
      if ((monst.status[Status.ASLEEP] ?? 0) > 0) slept++;
    }
    expect(slept).toBeGreaterThan(20);
    expect(slept).toBeLessThan(80);
  });

  it('immunity to magic is immunity to sleep as well', async () => {
    const monst = monster(1);
    monst.mon.level = 2;
    monst.mon.resist[DamageType.MAGIC] = 0;
    const rng = new GameRng();
    for (let i = 0; i < 20; i++) monst.sleep(Status.PARALYZED, 5, 0, rng);
    expect(monst.status[Status.PARALYZED]).toBe(0);
  });

  it('a negative amount takes the no-roll branch, quirk and all', async () => {
    // creature.cpp's early return is `status[which] -= amount`, so a negative
    // amount *raises* the status rather than curing it. It reads like a sign
    // slip in the original — the branch even reports "alert" further down — but
    // it is what the C++ does, and a port that quietly fixed it would drift.
    const monst = monster(1);
    monst.status[Status.PARALYZED] = 6;
    monst.sleep(Status.PARALYZED, -10, 0, new GameRng());
    expect(monst.status[Status.PARALYZED]).toBe(16);
  });

  it('two hostiles are only allies within the same faction', async () => {
    const a = monster(1);
    const b = monster(1);
    a.attitude = Attitude.HOSTILE_A;
    b.attitude = Attitude.HOSTILE_A;
    expect(a.isFriendlyTo(b)).toBe(true);
    b.attitude = Attitude.HOSTILE_B;
    expect(a.isFriendlyTo(b)).toBe(false);
    // Both friendly to the party, so allies whatever the exact attitude.
    a.attitude = Attitude.DOCILE;
    b.attitude = Attitude.FRIENDLY;
    expect(a.isFriendlyTo(b)).toBe(true);
  });

  it('owns its stats rather than sharing the scenario definition', async () => {
    const a = monster(1);
    const b = monster(1);
    a.mon.level = 99;
    a.mon.resist[DamageType.MAGIC] = 5;
    expect(b.mon.level).not.toBe(99);
    expect(scen.scenMonsters[1]!.resist[DamageType.MAGIC]).not.toBe(5);
  });

  it('a spellcaster gets mp and everything gets morale', async () => {
    const caster = scen.scenMonsters.findIndex((m) => m.mu > 0 || m.cl > 0);
    expect(caster).toBeGreaterThanOrEqual(0);
    const monst = monster(caster);
    expect(monst.maxMp).toBe(12 * monst.mon.level);
    expect(monst.morale).toBe(monst.mMorale);
    expect(monst.mMorale).toBeGreaterThan(0);
  });

  it('easy mode halves health and the difficulty adjustment multiplies it', async () => {
    const template = scen.scenMonsters.find((m) => m.health > 10)!;
    const index = scen.scenMonsters.indexOf(template);
    const normal = monster(index);
    expect(normal.maxHealth).toBe(template.health);
    const preset = { ...(normal as unknown as { slot: number }) };
    void preset;
    const easy = assignCreature(0, {
      number: index, startAttitude: Attitude.HOSTILE_A, startLoc: { x: 0, y: 0 },
      mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
      specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
    } as never, template, true, 2);
    expect(easy.maxHealth).toBe(Math.trunc(template.health / 2) * 2);
  });

  it('the party level drives difficultyAdjust only when the scenario allows it', async () => {
    const { univ } = newGame();
    expect(univ.difficultyAdjust()).toBe(1);
    for (const pc of univ.party.pcs) pc.level = 20; // 120 total
    const expected = scen.adjustDiff && scen.difficulty <= 0 ? 2 : 1;
    expect(univ.difficultyAdjust()).toBe(expected);
  });
});

describe('Player is still a plain enough object', () => {
  it('constructs standalone with the base stats at one', async () => {
    const pc = new Player();
    expect(pc.skills[Skill.STRENGTH]).toBe(1);
    expect(pc.getLoc()).toEqual({ x: -1, y: -1 });
    expect(pc.isAlive).toBe(false);
  });
});
