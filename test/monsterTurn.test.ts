import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { dist, loc } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { Attitude } from '../src/data/monster';
import { MonstAbil, MonstGen, MonstMissile } from '../src/data/monsterAbility';
import { monsterBasicAbil } from '../src/game/monsterAbilities';
import { Boom, setBoomSink } from '../src/game/booms';
import { Scenario } from '../src/data/scenario';
import { animClear, animPending } from '../src/game/anim';
import { NO_ONE } from '../src/game/combat';
import {
  closestPc, combatRunMonst, doMonsterTurn, doMonsters, monstAdjacent, monsterAttack,
  monstPickTarget,
} from '../src/game/monsterTurn';
import { activateMonsters } from '../src/game/monsterPlace';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { statusBarText } from '../src/render/screen';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature, CreatureStatus, assignCreature } from '../src/universe/creature';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, PartyStatus, Status, Trait } from '../src/universe/skills';
import { MAX_FOOD, MAX_GOLD } from '../src/universe/party';
import { ItemAbil, ItemType, ItemUse, defaultItem } from '../src/data/item';
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

/**
 * A game already in combat with a single hostile monster, everything else
 * cleared out so the turn under test is the only thing happening.
 */
function combatWithOne(index = 1): {
  univ: Universe; session: GameSession; monst: Creature;
} {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  univ.town!.monsters.length = 0;

  const at = loc(univ.party.townLoc.x + 2, univ.party.townLoc.y);
  const template = { ...scen.scenMonsters[index]!, resist: [...scen.scenMonsters[index]!.resist] };
  template.attacks = [{ dice: 3, sides: 6, type: 0 }];
  template.skill = 20;
  template.speed = 12;
  template.armor = 0;
  const monst = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: at,
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, template);
  monst.health = monst.maxHealth = 500;
  univ.town!.monsters.push(monst);

  session.startCombat(univ.party.direction);
  // Put the party somewhere predictable: everyone bare, plenty of health.
  univ.party.pcs.forEach((pc, i) => {
    pc.items.forEach((_, s) => { pc.equip[s] = false; });
    pc.maxHealth = 200;
    pc.curHealth = 200;
    pc.combatPos = loc(univ.party.townLoc.x, univ.party.townLoc.y + i);
  });
  return { univ, session, monst };
}

describe('a monster taking its turn', () => {
  it('notices the party, gets action points and closes the distance', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.IDLE;
    const before = { ...monst.curLoc };
    // Give it enough chances that the notice roll lands.
    for (let i = 0; i < 10 && monst.active === CreatureStatus.IDLE; i++) {
      await doMonsterTurn(session);
    }
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    expect(monst.curLoc).not.toEqual(before);
    expect(univ.party.pcs.some((pc) => pc.isAlive)).toBe(true);
  });

  it('does nothing at all while debug mode is on', async () => {
    // `if(univ.debug_mode) cur_monst->ap = 0;` (boe.combat.cpp:2142) — the
    // fourth rule that reads the flag, after `damage_monst`'s instant kill,
    // `kill_monst`'s skipped rewards and the movement override. Nothing moves
    // and nothing rolls, which is what a tester walking through walls wants.
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    univ.debugMode = true;
    const where = { ...monst.curLoc };
    const drawsBefore = univ.rng.gameDraws;

    for (let i = 0; i < 5; i++) {
      monst.active = CreatureStatus.ALERTED;
      await doMonsterTurn(session);
    }

    expect(monst.ap).toBe(0);
    expect(monst.curLoc).toEqual(where);
    expect(univ.party.pcs.every((p) => p.curHealth === 200)).toBe(true);
    // And it is free: an alerted creature that never spends a point never
    // reaches `monst_pick_target`, so the round costs no draws either.
    expect(univ.rng.gameDraws).toBe(drawsBefore);
  });

  it('attacks a PC once it is adjacent, and the PC feels it', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    expect(monstAdjacent(monst, pc.combatPos)).toBe(true);

    let hurt = false;
    for (let i = 0; i < 15 && !hurt; i++) {
      monst.active = CreatureStatus.ALERTED;
      monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
      await doMonsterTurn(session);
      hurt = univ.party.pcs.some((p) => p.curHealth < 200);
    }
    expect(hurt).toBe(true);
    expect(univ.party.totalDamTaken).toBeGreaterThan(0);
  });

  /**
   * do_monster_turn's `print_buf(); pause(8);` (boe.combat.cpp:2428) runs
   * after any action that "acted" — flee, a spell, a ranged shot or a melee
   * swing — and unlike the camera-dwell pause it isn't gated by GameSpeed at
   * all. This port had nothing booking that beat, which was most of why
   * combat read faster than the original regardless of any speed setting.
   */
  it('a landed melee swing books the post-action pause on the timeline', async () => {
    const { univ, session, monst } = combatWithOne();
    animClear();
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    monst.active = CreatureStatus.ALERTED;
    await doMonsterTurn(session);
    // `focusOn` alone (the pre-existing camera dwell, MONSTER_PAUSE_MS=16)
    // would only ever push this a little past zero; asserting a much bigger
    // number is what actually pins ACTION_PAUSE_MS's ~133ms landing too.
    expect(animPending()).toBeGreaterThan(100);
    animClear();
    expect(univ.party.totalDamTaken).toBeGreaterThanOrEqual(0); // sanity: ran without throwing
  });

  /**
   * combat_move_monster (boe.monster.cpp:721) plays a footstep on the way,
   * same as the party's own movement — this port had never wired it up, so
   * monsters closing the distance in a fight moved in total silence.
   */
  it('plays a footstep when a monster moves on screen', async () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    // Two squares off, in the open, so the only thing that can happen this
    // turn is a step toward the party.
    monst.curLoc = loc(monst.curLoc.x + 5, monst.curLoc.y);
    session.center = { ...monst.curLoc };
    const played: number[] = [];
    session.sound = { play: (n: number) => { played.push(n); } } as never;
    const before = { ...monst.curLoc };
    await doMonsterTurn(session);
    expect(monst.curLoc).not.toEqual(before);
    expect(played.length).toBeGreaterThan(0);
  });

  /**
   * do_monster_turn's opportunity-attack check (boe.combat.cpp:2445): a PC
   * standing ready (`parry > 99`, from Space/W or the SHIELD toolbar button)
   * gets a free swing the instant a monster closes to melee range of them,
   * spending the stand-ready to do it. This port had `char_parry`/`char_stand_ready`
   * themselves right, but nothing on the monster's-turn side ever checked
   * `parry` at all.
   */
  it('a PC standing ready swings for free when a monster closes on them', async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.parry = 100;
    monst.active = CreatureStatus.ALERTED;
    // Two squares off — seek_party's first step should land it adjacent.
    monst.curLoc = loc(pc.combatPos.x + 2, pc.combatPos.y);

    await doMonsterTurn(session);

    expect(monstAdjacent(monst, pc.combatPos)).toBe(true);
    // The stand-ready is spent whether or not the free swing actually landed.
    expect(pc.parry).toBe(0);
  });

  it('does not trigger the opportunity attack for a pacifist', async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.parry = 100;
    pc.traits[Trait.PACIFIST] = true;
    monst.active = CreatureStatus.ALERTED;
    monst.curLoc = loc(pc.combatPos.x + 2, pc.combatPos.y);
    const before = monst.health;

    await doMonsterTurn(session);

    // It walked up to them and took nothing for it. (Parry itself is *not*
    // what to assert on here: the turn ends with everyone's guard cleared,
    // which is `do_monster_turn`'s own last act.)
    expect(monstAdjacent(monst, pc.combatPos)).toBe(true);
    expect(monst.health).toBe(before);
    expect(univ.transcript.some((l) => l.includes(`${pc.name} swings`))).toBe(false);
  });

  it('a guard lasts one round: the monsters\' turn clears it', async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.parry = 40;
    monst.active = CreatureStatus.ALERTED;

    await doMonsterTurn(session);

    // `for(cPlayer& pc : univ.party) pc.parry = 0` — without it a parry's
    // damage reduction and to-hit bonus stayed up for the whole fight.
    expect(pc.parry).toBe(0);
  });

  it('monsterAttack rolls each of its attacks', async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    monst.mon.attacks = [
      { dice: 2, sides: 4, type: 0 },
      { dice: 2, sides: 4, type: 1 },
      { dice: 2, sides: 4, type: 0 },
    ];
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    let landed = 0;
    for (let i = 0; i < 10; i++) {
      pc.curHealth = 200;
      await monsterAttack(session, monst, pc);
      if (pc.curHealth < 200) landed++;
    }
    expect(landed).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('attacks'))).toBe(true);
  });

  it("says a blow as 1997's damaged_message does: \"  Claws for 5\", not \"takes 5\"", async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    monst.mon.attacks = [{ dice: 2, sides: 4, type: 1 }];
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    for (let i = 0; i < 20 && pc.curHealth === 200; i++) {
      pc.curHealth = 200;
      await monsterAttack(session, monst, pc);
    }
    expect(pc.curHealth).toBeLessThan(200);
    expect(univ.transcript).toContain(`  Claws for ${200 - pc.curHealth}`);
    expect(univ.transcript.some((l) => l.includes(`${pc.name} takes`))).toBe(false);
  });

  it('a peaceful monster will not touch the party', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.attitude = Attitude.DOCILE;
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    await monsterAttack(session, monst, pc);
    expect(pc.curHealth).toBe(200);
  });

  it('sleep and paralysis cost a monster its whole turn', async () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.status[Status.ASLEEP] = 5;
    const before = { ...monst.curLoc };
    await doMonsterTurn(session);
    expect(monst.ap).toBe(0);
    expect(monst.curLoc).toEqual(before);
  });

  it('flees once its morale has gone', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.morale = 0;
    monst.health = 10; // under 50, so it does not steady itself
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    const distBefore = Math.abs(monst.curLoc.x - pc.combatPos.x);
    await doMonsterTurn(session);
    // It either backed off or was hemmed in; what it must not do is attack.
    const distAfter = Math.abs(monst.curLoc.x - pc.combatPos.x);
    expect(distAfter).toBeGreaterThanOrEqual(distBefore);
    expect(univ.party.pcs.every((p) => p.curHealth === 200)).toBe(true);
  });

  it('the unliving never flee', async () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.morale = -100;
    monst.mon.race = 11; // UNDEAD
    const pc = session.univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    let hurt = false;
    for (let i = 0; i < 15 && !hurt; i++) {
      monst.active = CreatureStatus.ALERTED;
      monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
      await doMonsterTurn(session);
      hurt = pc.curHealth < 200;
    }
    expect(hurt).toBe(true);
  });

  it('a summon runs out and vanishes', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.summonTime = 1;
    await doMonsterTurn(session);
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.transcript.some((l) => l.includes('disappears'))).toBe(true);
  });

  it('two monsters alert each other', async () => {
    const { univ, session, monst } = combatWithOne();
    const second = Object.assign(Object.create(Object.getPrototypeOf(monst)) as Creature, monst);
    second.status = [...monst.status];
    second.curLoc = loc(monst.curLoc.x + 1, monst.curLoc.y);
    second.active = CreatureStatus.IDLE;
    univ.town!.monsters.push(second);
    monst.active = CreatureStatus.ALERTED;
    await doMonsterTurn(session);
    expect(second.active).toBe(CreatureStatus.ALERTED);
  });

  it('does nothing once the whole party is down', async () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    const before = { ...monst.curLoc };
    await doMonsterTurn(session);
    expect(monst.curLoc).toEqual(before);
  });

  it('closestPc finds the nearest survivor', async () => {
    const { univ } = combatWithOne();
    univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;
    const near = closestPc(univ, univ.party.pcs[1]!.combatPos);
    expect(near).toBe(1);
    univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    expect(closestPc(univ, loc(0, 0))).toBe(NO_ONE);
  });
});

describe('a charmed monster fights its former allies', () => {
  /**
   * charm_odds's success arm (Creature.sleep, boe.combat.cpp/creature.cpp)
   * flips `attitude` to FRIENDLY — it never touches `status[CHARM]`, so the
   * only way charm does anything is through `attitude`. `doMonsterTurn` used
   * to gate every attack (melee, and the wake-up checks) on `!isFriendly`
   * unconditionally, which is right for "don't attack the party" but wrong
   * for "don't attack another monster" — a FRIENDLY creature should still
   * fight a HOSTILE one, and vice versa.
   */
  function twoMonstersAdjacent(): {
    univ: Universe; session: GameSession; charmed: Creature; hostile: Creature;
  } {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(0, FORCED_ENTRY);
    univ.town!.monsters.length = 0;

    const makeMonst = (index: number, attitude: Attitude, at: ReturnType<typeof loc>): Creature => {
      const template = { ...scen.scenMonsters[index]!, resist: [...scen.scenMonsters[index]!.resist] };
      template.attacks = [{ dice: 3, sides: 6, type: 0 }];
      template.skill = 20;
      template.speed = 12;
      template.armor = 0;
      const m = assignCreature(0, {
        number: index, startAttitude: attitude, startLoc: at,
        mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
        specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
      } as never, template);
      m.health = m.maxHealth = 500;
      m.active = CreatureStatus.ALERTED;
      m.mobile = true;
      return m;
    };

    const base = univ.party.townLoc;
    const charmed = makeMonst(1, Attitude.FRIENDLY, loc(base.x + 2, base.y));
    const hostile = makeMonst(2, Attitude.HOSTILE_A, loc(base.x + 3, base.y));
    univ.town!.monsters.push(charmed, hostile);

    session.startCombat(univ.party.direction);
    // Move the party well out of the way so nobody targets a PC instead.
    univ.party.pcs.forEach((pc, i) => {
      pc.combatPos = loc(base.x - 10, base.y + i);
    });
    return { univ, session, charmed, hostile };
  }

  it('picks the other side as a target', async () => {
    const { session, charmed, hostile } = twoMonstersAdjacent();
    // A friendly creature never targets a PC at all (pickTargetPc refuses
    // outright), so this alone proves it falls back to the hostile monster.
    const target = monstPickTarget(session, charmed);
    expect(target).toBe(100 + session.univ.town!.monsters.indexOf(hostile));

    // A hostile monster still prefers a reachable PC over a friendly
    // creature — sideline the party so this checks the fallback specifically.
    for (const pc of session.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    const backTarget = monstPickTarget(session, hostile);
    expect(backTarget).toBe(100 + session.univ.town!.monsters.indexOf(charmed));
  });

  it('a charmed creature attacks the hostile one next to it', async () => {
    const { session, charmed, hostile } = twoMonstersAdjacent();
    const before = hostile.health;
    await doMonsterTurn(session);
    expect(hostile.health).toBeLessThan(before);
    // And the party, which was never in reach, took nothing.
    expect(session.univ.party.pcs.every((pc) => pc.curHealth === pc.maxHealth)).toBe(true);
  });
});

describe('encounters in town mode', () => {
  /** A town-mode game with one hostile monster a few squares off. */
  function townWithOne(): { univ: Universe; session: GameSession; monst: Creature } {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(0, FORCED_ENTRY);
    univ.town!.monsters.length = 0;
    const template = { ...scen.scenMonsters[1]!, resist: [...scen.scenMonsters[1]!.resist] };
    template.attacks = [{ dice: 3, sides: 6, type: 0 }];
    template.skill = 20;
    template.speed = 12;
    template.armor = 0;
    const monst = assignCreature(0, {
      number: 1, startAttitude: Attitude.HOSTILE_A,
      startLoc: loc(univ.party.townLoc.x + 3, univ.party.townLoc.y),
      mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
      specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
    } as never, template);
    monst.health = monst.maxHealth = 500;
    univ.town!.monsters.push(monst);
    univ.party.pcs.forEach((pc) => {
      pc.items.forEach((_, s2) => { pc.equip[s2] = false; });
      pc.maxHealth = 300;
      pc.curHealth = 300;
    });
    return { univ, session, monst };
  }

  it('a hostile monster notices the party and says so', async () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.IDLE;
    for (let i = 0; i < 30 && monst.active === CreatureStatus.IDLE; i++) doMonsters(session);
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    expect(univ.transcript).toContain('Monster saw you!');
  });

  it('and then walks over to the party', async () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    const before = Math.abs(monst.curLoc.x - univ.party.townLoc.x);
    for (let i = 0; i < 5; i++) doMonsters(session);
    const after = Math.abs(monst.curLoc.x - univ.party.townLoc.x);
    expect(after).toBeLessThan(before);
  });

  it('attacks a PC in town mode, without any combat mode', async () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    let hurt = false;
    for (let i = 0; i < 30 && !hurt; i++) {
      doMonsters(session);
      await doMonsterTurn(session);
      hurt = univ.party.pcs.some((pc) => pc.curHealth < 300);
    }
    expect(hurt).toBe(true);
    expect(univ.party.pcs.some((pc) => pc.combatPos.x >= 0)).toBe(false);
  });

  it('walking about is what gives the monsters their turn', async () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    const home = { ...univ.party.townLoc };
    // Find a neighbour the party can actually step onto and still be in town:
    // a *blocked* move costs no turn, and Fort Talrus's entrance is close
    // enough to the boundary that a step the wrong way leaves the town.
    const free = [
      loc(home.x, home.y - 1), loc(home.x, home.y + 1),
      loc(home.x - 1, home.y), loc(home.x + 1, home.y),
    ].find((c) => !session.townIsBlocked(c) && !univ.town!.monsterAt(c)
      && !session.locOffActiveArea(c));
    expect(free).toBeDefined();

    const startedAt = { ...monst.curLoc };
    let moves = 0;
    for (let i = 0; i < 6; i++) {
      if (await session.moveTo(free!)) moves++;
      if (await session.moveTo(home)) moves++;
    }
    expect(moves).toBeGreaterThan(0);
    // The monster had a turn of its own, which it spent coming after us.
    expect(monst.curLoc).not.toEqual(startedAt);
    expect(dist(monst.curLoc, univ.party.townLoc))
      .toBeLessThanOrEqual(dist(startedAt, home));
  });

  it('a sleeping monster stays put', async () => {
    const { session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.status[Status.ASLEEP] = 6;
    const before = { ...monst.curLoc };
    for (let i = 0; i < 5; i++) doMonsters(session);
    expect(monst.curLoc).toEqual(before);
  });
  /**
   * `do_monster_turn` guards the **melee** block with `who.is_alive()`
   * (boe.combat.cpp:2432) and the **ranged** one with nothing at all: a
   * creature whose shot has just killed its target goes on rolling for another
   * ability against the corpse. In town it keeps the target it was given, so
   * there is nothing to re-pick it onto someone living.
   *
   * This port had the guard on both, so the moment something died it stopped
   * spending the `get_ran(1,1,1000)`s the C++ still spends — one per ability
   * per remaining action point, for the rest of the fight.
   * `ASR_11-05-2025_07-55-19` parted from the oracle on exactly one of them.
   */
  it('still rolls a ranged ability at a target that is already dead', async () => {
    const { univ, session, monst } = townWithOne();
    // Nothing to do in melee, and a sure-fire missile with reach.
    monst.mon.attacks = [{ dice: 0, sides: 0, type: 0 }];
    const missile = monst.mon.abil[MonstAbil.MISSILE]!;
    missile.active = true;
    missile.missile.type = MonstMissile.ARROW;
    missile.missile.range = 12;
    missile.missile.odds = 1000;
    missile.missile.dice = 1;
    missile.missile.sides = 2;
    missile.missile.pic = 0;
    monst.active = CreatureStatus.ALERTED;
    monst.target = 0;
    univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;

    await doMonsterTurn(session);

    // `print_monst_name(cur_monst->number)` (boe.combat.cpp:2406) is the first
    // thing the ranged branch does once an ability has been picked, so its line
    // in the transcript is the branch having been taken — one per action point
    // the creature spends on it.
    const announced = univ.transcript.filter((l) => l === `${monst.mon.name}:`).length;
    expect(announced).toBeGreaterThan(0);
  });
});

/**
 * `monst_basic_abil`'s DAMAGE arm (boe.combat.cpp:3094) and `monst_breathe`
 * (:3229) both wrap their damage in `start_missile_anim()` …
 * `do_explosion_anim(5,0)` … `end_missile_anim()` … `handle_marked_damage()`.
 * Without the volley `add_explosion` makes no roll and `do_explosion_anim`
 * spends none of its eleven redraws, so a breath cost this port a dozen fewer
 * draws than the oracle's.
 */
describe('a monster ability that explodes', () => {
  it('collects its blast into a volley', async () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.curHealth = pc.maxHealth = 300;
    monst.curLoc = { x: pc.combatPos.x + 1, y: pc.combatPos.y };
    const abil = {
      gen: {
        type: MonstGen.BREATH, strength: 4, extra: 2, pic: -1, odds: 1000,
      },
    } as never;

    const booms: Boom[] = [];
    setBoomSink((b) => { booms.push({ ...b }); });
    try {
      await monsterBasicAbil(session, monst, MonstAbil.DAMAGE, abil, pc);
      await session.settled();
    } finally {
      setBoomSink(null);
      animClear();
    }
    expect(pc.curHealth).toBeLessThan(300);
    expect(booms.length).toBeGreaterThan(0);
    expect(booms.every((b) => b.animated)).toBe(true);
  });
});

describe('the round between rounds', () => {
  it('advances the clock and decays the brief statuses', async () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.INVULNERABLE] = 3;
    pc.status[Status.MARTYRS_SHIELD] = 2;
    const ageBefore = univ.party.age;
    await combatRunMonst(session);
    expect(univ.party.age).toBe(ageBefore + 1);
    expect(pc.status[Status.INVULNERABLE]).toBe(2);
    expect(pc.status[Status.MARTYRS_SHIELD]).toBe(1);
  });

  it('blessings tick only every fourth turn', async () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.BLESS_CURSE] = 8;
    univ.party.age = 0;
    await combatRunMonst(session); // age becomes 1
    expect(pc.status[Status.BLESS_CURSE]).toBe(8);
    univ.party.age = 3;
    await combatRunMonst(session); // age becomes 4
    expect(pc.status[Status.BLESS_CURSE]).toBe(7);
  });

  /**
   * `move_to_zero(univ.party.status[STEALTH])` sits *inside* the per-PC loop
   * (boe.combat.cpp:1916), so a combat round spends six points of Stealth
   * rather than one. Kept, and this is what would notice a tidy-up.
   */
  it('a combat round burns six points of Stealth, not one', async () => {
    const { univ, session } = combatWithOne();
    univ.party.partyStatus[PartyStatus.STEALTH] = 20;
    univ.party.age = 3;
    await combatRunMonst(session); // age becomes 4
    expect(univ.party.partyStatus[PartyStatus.STEALTH]).toBe(14);
  });

  it('detect life, firewalk and the hostile counter tick every round', async () => {
    const { univ, session } = combatWithOne();
    univ.party.partyStatus[PartyStatus.DETECT_LIFE] = 5;
    univ.party.partyStatus[PartyStatus.FIREWALK] = 3;
    univ.party.hostilesPresent = 30;
    await combatRunMonst(session);
    expect(univ.party.partyStatus[PartyStatus.DETECT_LIFE]).toBe(4);
    expect(univ.party.partyStatus[PartyStatus.FIREWALK]).toBe(2);
    expect(univ.party.hostilesPresent).toBe(29);
  });

  /**
   * `dump_gold(1)` — the ceiling is enforced once a round rather than at every
   * place that hands gold out.
   */
  it('trims gold and food back to the ceiling', async () => {
    const { univ, session } = combatWithOne();
    univ.party.gold = MAX_GOLD + 500;
    univ.party.food = MAX_FOOD + 500;
    await combatRunMonst(session);
    expect(univ.party.gold).toBe(MAX_GOLD);
    expect(univ.party.food).toBe(MAX_FOOD);
    expect(univ.transcript).toContain('Excess gold dropped.');
    expect(univ.transcript).toContain('Excess food dropped.');
  });

  /**
   * **A regeneration item heals in combat off `item_level`, not
   * `abil_strength / 3`** — `increase_age`'s copy of this uses the other field
   * — and there is no "only if hurt" guard, so the draw is spent either way.
   */
  it('a regeneration item heals every fourth round, off item_level', async () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.items[0] = {
      ...defaultItem(), variety: ItemType.RING, name: 'Ring',
      ability: ItemAbil.REGENERATE, abilStrength: 3, itemLevel: 8, weight: 0,
    };
    pc.equip[0] = true;
    pc.curHealth = 10;
    univ.party.age = 3;
    await combatRunMonst(session);
    expect(pc.curHealth).toBeGreaterThanOrEqual(10);
    // The roll is `get_ran(1, 0, item_level + 1)`, so at most nine points.
    expect(pc.curHealth).toBeLessThanOrEqual(19);
  });

  /**
   * The per-PC half of OCCASIONAL_STATUS (boe.combat.cpp:1935) — a one in
   * eleven per candidate item per round, and it walks the whole pack rather
   * than what is worn.
   */
  it('an OCCASIONAL_STATUS item eventually fires, and says so', async () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.items[0] = {
      ...defaultItem(), variety: ItemType.RING, name: 'Ring',
      ability: ItemAbil.OCCASIONAL_STATUS, abilStrength: 4,
      abilData: Status.BLESS_CURSE, weight: 0,
    };
    // Not equipped: the sweep does not care.
    pc.equip[0] = false;
    for (let i = 0; i < 200 && (pc.status[Status.BLESS_CURSE] ?? 0) === 0; i++) {
      await combatRunMonst(session);
    }
    expect(pc.status[Status.BLESS_CURSE]).toBeGreaterThan(0);
    expect(univ.transcript).toContain('An item blesses you!');
  });

  /**
   * Two sign flips in a row: `abil_harms` negates, and a status that is
   * *itself* negative negates again. So a HELP item carrying POISON cures and
   * a HARM one poisons — the two cancel, and the item's use type is what a
   * scenario actually steers with.
   */
  it.each([
    [ItemUse.HELP_ONE, 'An item cures you!'],
    [ItemUse.HARM_ONE, 'An item poisons you!'],
  ])('a %i-use item carrying POISON says "%s"', async (use, line) => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.items[0] = {
      ...defaultItem(), variety: ItemType.RING, name: 'Ring',
      ability: ItemAbil.OCCASIONAL_STATUS, abilStrength: 2,
      abilData: Status.POISON, magicUseType: use, weight: 0,
    };
    pc.equip[0] = false;
    for (let i = 0; i < 200 && !univ.transcript.includes(line); i++) {
      // Kept topped up: the "cures" message only appears when there is poison
      // to cure, and do_poison burns it off between rounds.
      pc.status[Status.POISON] = 6;
      await combatRunMonst(session);
    }
    expect(univ.transcript).toContain(line);
  });

  /**
   * The POISONED_WEAPON arm looks for a poisonable weapon **anywhere in the
   * pack**, not an equipped one — unlike `poison_weapon`, which insists. With
   * none at all it `continue`s, so the roll is spent and nothing is applied.
   */
  it('a weapon-poisoning item finds an unequipped weapon', async () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.items[0] = {
      ...defaultItem(), variety: ItemType.ONE_HANDED, name: 'Dagger', weight: 0,
    };
    pc.items[1] = {
      ...defaultItem(), variety: ItemType.RING, name: 'Ring',
      ability: ItemAbil.OCCASIONAL_STATUS, abilStrength: 3,
      abilData: Status.POISONED_WEAPON, weight: 0,
    };
    pc.equip[0] = false;
    pc.equip[1] = false;
    for (let i = 0; i < 200 && pc.weapPoisoned === null; i++) {
      await combatRunMonst(session);
    }
    expect(pc.weapPoisoned).toBe(pc.items[0]);
    expect(univ.transcript).toContain('An item poisons your weapon!');
  });

  it('a party that runs out of moves gets a fresh round automatically', async () => {
    const { univ, session } = combatWithOne();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.curPc = 0;
    await session.startCombatRound();
    expect(univ.party.pcs.some((pc) => pc.ap > 0)).toBe(true);
  });
});

/**
 * combat_next_step (boe.combat.cpp:1782) is a **loop** — `while(pick_next_pc())
 * { combat_run_monst(); set_pc_moves(); ... }` — and running it once, as this
 * port did, deadlocks whenever a round hands out no moves at all.
 */
describe('combat_next_step runs the monsters until somebody can act', () => {
  it('a fully slowed party is not frozen on the round it gets no moves', async () => {
    const { univ, session } = combatWithOne();
    // set_pc_moves zeroes a slowed PC's AP on every odd `party.age`. Starting
    // at 0 means the first round's tick lands on 1 — the round nobody can act
    // — so the monsters have to go a second time before the party gets a turn.
    univ.party.age = 0;
    univ.party.pcs.forEach((pc) => {
      pc.status[Status.HASTE_SLOW] = -8;
      pc.ap = 0;
    });
    univ.curPc = 0;

    session.afterCombatAction();
    await session.settled();

    expect(univ.party.pcs.some((pc) => pc.ap > 0)).toBe(true);
    // Two monster rounds, not one: the round on the odd age plus the one after.
    expect(univ.party.age).toBe(2);
  });

  it('releases a pinned PC who cannot act, instead of burning every turn', async () => {
    const { univ, session } = combatWithOne();
    const pinned = univ.party.pcs[0]!;
    // Asleep for long enough to survive the round's own tick toward zero.
    pinned.status[Status.ASLEEP] = 5;
    session.combatActivePc = 0;
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.curPc = 0;

    session.afterCombatAction();
    await session.settled();

    expect(session.combatActivePc).toBe(NO_ONE);
    expect(univ.transcript.some((l) => l.includes('unable to act'))).toBe(true);
    // And the rest of the party has its moves back, rather than having them
    // burnt by a pin nobody could clear.
    expect(univ.party.pcs.slice(1).some((pc) => pc.ap > 0)).toBe(true);
  });

  it('says who is up when the turn changes hands', async () => {
    const { univ, session } = combatWithOne();
    univ.party.pcs.forEach((pc) => { pc.ap = 4; });
    univ.party.pcs[0]!.ap = 0;
    univ.curPc = 0;

    session.afterCombatAction();
    await session.settled();

    // No monsters needed to run — someone else still had moves.
    expect(univ.curPc).toBe(1);
    const line = univ.transcript.find((l) => l.startsWith('Active:'));
    expect(line).toBe(`Active: ${univ.party.pcs[1]!.name} (#2, 4 ap.)`);
  });

  it('stays quiet about the active PC while one is pinned', async () => {
    const { univ, session } = combatWithOne();
    univ.party.pcs.forEach((pc) => { pc.ap = 4; });
    session.combatActivePc = 1;
    univ.curPc = 1;

    session.afterCombatAction();
    await session.settled();

    expect(univ.transcript.some((l) => l.startsWith('Active:'))).toBe(false);
  });
});

/**
 * `monsters_going` (boe.combat.cpp:2065) exists for the *drawing* code, so what
 * matters is that it is true for exactly the span of the turn — the window in
 * which the camera is off following monsters — and false either side of it.
 */
describe('monsters_going', () => {
  it('is set for the length of the turn and cleared after it', async () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    expect(session.monstersGoing).toBe(false);
    const turn = doMonsterTurn(session);
    expect(session.monstersGoing).toBe(true);
    await turn;
    expect(session.monstersGoing).toBe(false);
  });

  it('is cleared even when the turn bails out early', async () => {
    const { univ, session } = combatWithOne();
    // A dead party is `do_monster_turn`'s early return. A flag left set here
    // would keep the explored map bypassed for the rest of the game.
    univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    await doMonsterTurn(session);
    expect(session.monstersGoing).toBe(false);
  });
});

describe('the status bar text', () => {
  it('names the monster that is going, and the PC otherwise', async () => {
    const { univ, session, monst } = combatWithOne();
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 4;
    expect(statusBarText(session)).toBe(`${univ.party.pcs[0]!.name} (ap: 4)`);

    session.monstersGoing = true;
    monst.ap = 3;
    expect(statusBarText(session)).toBe(`${monst.getName()} (ap: 3)`);

    // "the 1st monster with >0 ap - that is monster that is going": one that
    // has spent everything is no longer the one acting.
    monst.ap = 0;
    expect(statusBarText(session)).toBe(session.locationName());
  });
});

describe('activate_monsters wakes a group by its preset', () => {
  /**
   * `activate_monsters` (boe.monster.cpp:1230) walks the **town record's
   * presets** and asks the *preset's* `spec_enc_code`, then assigns into that
   * slot whatever is standing in it. This port used to scan the live
   * population for a live `spec_enc_code` — a leftover from when the two lists
   * were not index-aligned — so a slot whose occupant had been replaced never
   * woke, and a scripted ambush stayed asleep for the rest of the game.
   */
  function townWithSleeper(): { univ: Universe; session: GameSession; slot: number } {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(0, FORCED_ENTRY);
    const town = univ.town!;
    // Give a preset a group code, then re-enter so `populateTown` puts it in
    // the population as a sleeper.
    const slot = town.record.creatures.findIndex((c) => c.number > 0);
    town.record.creatures[slot]!.specEncCode = 4;
    session.startTownMode(0, FORCED_ENTRY);
    return { univ, session: session, slot };
  }

  it('brings the group in alerted, on its start square', () => {
    const { univ, slot } = townWithSleeper();
    const town = univ.town!;
    expect(town.monsters[slot]!.isAlive).toBe(false);
    activateMonsters(univ, 4);
    const woken = town.monsters[slot]!;
    expect(woken.active).toBe(CreatureStatus.ALERTED);
    expect(woken.specEncCode).toBe(0);
    expect(woken.curLoc).toEqual(town.record.creatures[slot]!.startLoc);
  });

  it('overwrites a slot some other creature has taken over', () => {
    const { univ, slot } = townWithSleeper();
    const town = univ.town!;
    // Something else moved into the slot and cleared its own code — which is
    // what a summon or a wandering group does. The preset still says 4.
    const squatter = town.monsters[slot]!;
    squatter.active = CreatureStatus.ALERTED;
    squatter.specEncCode = 0;
    squatter.curLoc = loc(1, 1);
    activateMonsters(univ, 4);
    expect(town.monsters[slot]!.curLoc).toEqual(town.record.creatures[slot]!.startLoc);
    expect(town.monsters[slot]!.active).toBe(CreatureStatus.ALERTED);
  });

  it('wakes nobody for group 0', () => {
    const { univ, slot } = townWithSleeper();
    activateMonsters(univ, 0);
    expect(univ.town!.monsters[slot]!.isAlive).toBe(false);
  });
});
