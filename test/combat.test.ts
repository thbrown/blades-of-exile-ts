import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction, loc, locsEqual } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemAbil, ItemType } from '../src/data/item';
import { Attitude } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import {
  NO_ONE, getWeapons, pcAttack, pickNextPc, placeParty, setPcMoves, takeAp, totalEncumbrance,
} from '../src/game/combat';
import { checkParryOpportunity } from '../src/game/monsterTurn';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature, CreatureStatus, assignCreature } from '../src/universe/creature';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../src/universe/skills';
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

function newGame(town = 0): { univ: Universe; session: GameSession } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(town, FORCED_ENTRY);
  return { univ, session };
}

/**
 * Put a hostile monster on a free square next to the party and return it.
 * Fort Talrus has its own guards standing about, so the square has to be
 * checked rather than assumed.
 */
function hostileBeside(univ: Universe, session: GameSession, index = 1): Creature {
  const from = univ.party.townLoc;
  const candidates = [
    loc(from.x + 1, from.y), loc(from.x - 1, from.y),
    loc(from.x, from.y + 1), loc(from.x, from.y - 1),
  ];
  const where = candidates.find((c) =>
    !univ.town!.monsterAt(c) && !session.townIsBlocked(c)) ?? candidates[0]!;
  const monst = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: where,
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, scen.scenMonsters[index]!);
  monst.mon.armor = 0;
  monst.health = monst.maxHealth = 500;
  univ.town!.monsters.push(monst);
  return monst;
}

describe('a combat move by a PC with no action points', () => {
  /**
   * `pc_combat_move` (boe.combat.cpp:216) has **no action-point guard**: it is
   * `pick_next_pc` that keeps a spent PC from being the one you are driving,
   * and a recording can still hand a move to one. The C++ lets the step
   * through, `take_ap(1)` clamps at zero, and `did_something` is set — so
   * `advance_time` runs `combat_next_step`, finds nobody with points left, and
   * **turns the round over**.
   *
   * This port refused the move outright, so the round never ended:
   * `ZKR_15-05-2025_16-09-51` sat on a PC with no moves and refused every
   * action after it, for three hundred actions.
   */
  it('goes through, and turns the round over', async () => {
    const { univ, session } = newGame();
    expect(session.startCombat(Direction.N)).toBe(true);
    const pc = univ.currentPc;
    const from = { ...pc.combatPos };
    const dest = [
      loc(from.x + 1, from.y), loc(from.x - 1, from.y),
      loc(from.x, from.y + 1), loc(from.x, from.y - 1),
    ].find((c) => !univ.town!.monsterAt(c) && !session.townIsBlocked(c)
      && !univ.party.pcs.some((p) => p.isAlive && locsEqual(p.combatPos, c)))!;
    // Everybody spent, which is what makes `combat_next_step` start a round.
    for (const p of univ.party.pcs) p.ap = 0;

    expect(await session.combatMove(dest)).toBe(true);

    expect(pc.combatPos).toEqual(dest);
    // The monster round is queued rather than awaited (see `afterCombatAction`).
    await session.settled();
    // A fresh round was handed out rather than the fight sticking.
    expect(univ.party.pcs.some((p) => p.isAlive && p.ap > 0)).toBe(true);
  });
});

describe('the stand-ready volley', () => {
  /**
   * `do_monster_turn`'s parry check is one `&&` chain re-evaluated per PC
   * (boe.combat.cpp:2471), and `cur_monst->is_alive()` is *inside* it: the
   * first stand-ready PC to kill the creature ends the volley, and the rest
   * keep both their parry and their swing. This port tested aliveness once
   * before the loop, so a second and third PC swung at a corpse — four wasted
   * `get_ran(1,1,100)`s each, which is what parted `ASR_19-05-2025_19-38-44`
   * eleven thousand draws from the end.
   */
  it('stops as soon as the creature dies, and the later PCs keep their parry', async () => {
    let checked = 0;
    // Deterministic, but which seed lands the killing blow is not something to
    // hard-code: search a few and assert on the first that kills.
    for (let seed = 1; seed <= 200 && checked === 0; seed++) {
      const rng = new GameRng();
      rng.seedGame(seed);
      const univ = new Universe(scen, rng, PartyPreset.DEFAULT);
      const session = new GameSession(univ);
      session.startTownMode(0, FORCED_ENTRY);
      expect(session.startCombat(Direction.N)).toBe(true);

      const monst = hostileBeside(univ, session);
      monst.health = 1;
      // Two PCs standing ready, both within reach of it.
      const [first, second] = [univ.party.pcs[0]!, univ.party.pcs[1]!];
      for (const pc of univ.party.pcs) pc.parry = 0;
      for (const pc of [first, second]) {
        pc.combatPos = loc(monst.curLoc.x, monst.curLoc.y + 1);
        pc.parry = 100;
      }

      await checkParryOpportunity(session, monst);
      if (monst.isAlive) continue;   // first swing missed; try another seed

      checked++;
      expect(first.parry).toBe(0);
      // The kill ended the volley before PC 1 was reached.
      expect(second.parry).toBe(100);
    }
    expect(checked).toBe(1);
  });
});

describe('the fields a step walks into', () => {
  /**
   * `handle_pause` in combat ends with `check_fields(univ.current_pc()
   * .combat_pos, COMBAT_MOVE, univ.current_pc())` (boe.actions.cpp:627):
   * standing still in a fire still burns you. Only the combat branch has it —
   * a town pause does not.
   */
  it('burns a PC who stands ready in a fire', async () => {
    const { univ, session } = newGame();
    expect(session.startCombat(Direction.N)).toBe(true);
    const pc = univ.currentPc;
    univ.town!.setField(pc.combatPos.x, pc.combatPos.y, FieldType.WALL_FIRE, true);
    const before = pc.curHealth;

    await session.pause();

    expect(pc.curHealth).toBeLessThan(before);
    expect(univ.transcript).toContain('  Fire wall!');
  });

  /**
   * A swap walks *two* people onto new squares, so `pc_combat_move` checks the
   * vacated one as well — `check_special_terrain(store_loc, COMBAT_MOVE,
   * switch_pc)` (boe.combat.cpp:292), and note the third argument: the fields
   * hurt **the PC who was swapped in**, not the one whose turn it is.
   */
  it('checks the square a swap vacates, for the PC swapped into it', async () => {
    const { univ, session } = newGame();
    expect(session.startCombat(Direction.N)).toBe(true);
    const mover = univ.currentPc;
    const other = univ.party.pcs.find(
      (p) => p !== mover && p.isAlive && p.ap > 0)!;
    expect(other).toBeTruthy();
    // Stand them next to each other with a fire under the one about to move.
    const here = { ...mover.combatPos };
    const there = [
      loc(here.x + 1, here.y), loc(here.x - 1, here.y),
      loc(here.x, here.y + 1), loc(here.x, here.y - 1),
    ].find((c) => !univ.town!.monsterAt(c) && !session.townIsBlocked(c)
      && !univ.party.pcs.some((p) => p.isAlive && locsEqual(p.combatPos, c)))!;
    expect(there).toBeTruthy();
    other.combatPos = { ...there };
    univ.town!.setField(here.x, here.y, FieldType.WALL_FIRE, true);
    const moverBefore = mover.curHealth;
    const otherBefore = other.curHealth;

    await session.combatMove(there);

    expect(univ.transcript).toContain('Move: Switch places.');
    // The mover left the fire and took nothing; the PC swapped onto it burns.
    expect(mover.curHealth).toBe(moverBefore);
    expect(other.curHealth).toBeLessThan(otherBefore);
  });
});

describe('a combat move that kills the PC making it', () => {
  /**
   * `pc_combat_move` reads `univ.current_pc()` afresh at every use, and
   * `check_special_terrain` can change who that is: a field at the destination
   * kills the acting PC, `kill_pc` parks `cur_pc` on `first_active_pc()`, and
   * the rest of the function — the back-shots and the step itself — belongs to
   * **the next PC**. Binding the PC once at the top left this port walking a
   * corpse and refusing the move outright.
   */
  it('hands the back-shots and the step to whoever cur_pc becomes', async () => {
    const { univ, session } = newGame();
    expect(session.startCombat(Direction.N)).toBe(true);
    const town = univ.town!;

    const acting = univ.curPc;
    const from = univ.currentPc.combatPos;
    const dest = [
      loc(from.x + 1, from.y), loc(from.x - 1, from.y),
      loc(from.x, from.y + 1), loc(from.x, from.y - 1),
    ].find((c) => !town.monsterAt(c) && !session.townIsBlocked(c)
      && !univ.party.pcs.some((p) => p.isAlive && locsEqual(p.combatPos, c)))!;
    expect(dest).toBeTruthy();

    // A wall of fire on the destination, and an acting PC who cannot survive
    // walking into it. **Zero health, not one**: a PC on 0 is still ALIVE in
    // BoE — that is the `s1/h0` the harness's `pcs:` column prints — and only
    // the next hit finishes them.
    town.setField(dest.x, dest.y, FieldType.WALL_FIRE, true);
    univ.currentPc.curHealth = 0;

    await session.combatMove(dest);

    expect(univ.party.pcs[acting]!.isAlive).toBe(false);
    expect(univ.curPc).not.toBe(acting);
    // The step went through — for the PC who inherited it.
    expect(univ.currentPc.combatPos).toEqual(dest);
  });
});

describe('action points', () => {
  it('gives four a round, three to the sluggish', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    setPcMoves(univ);
    expect(pc.ap).toBe(4);
    pc.traits[Trait.SLUGGISH] = true;
    setPcMoves(univ);
    expect(pc.ap).toBe(3);
  });

  it('haste doubles them, and a strong haste triples', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.status[Status.HASTE_SLOW] = 4;
    setPcMoves(univ);
    expect(pc.ap).toBe(8);
    pc.status[Status.HASTE_SLOW] = 8;
    setPcMoves(univ);
    expect(pc.ap).toBe(12);
  });

  it('being slowed costs every other round outright', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.HASTE_SLOW] = -4;
    univ.party.age = 1;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    univ.party.age = 2;
    setPcMoves(univ);
    expect(pc.ap).toBeGreaterThan(0);
  });

  it('webs eat the round and get torn at', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.status[Status.WEBS] = 8;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    expect(pc.status[Status.WEBS]).toBe(5);
    expect(univ.transcript.some((l) => l.includes('must clean webs'))).toBe(true);
  });

  it('sleep and paralysis leave nothing, and the dead get nothing', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.PARALYZED] = 20;
    univ.party.pcs[1]!.mainStatus = MainStatus.DEAD;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    expect(univ.party.pcs[1]!.ap).toBe(0);
  });

  it('a speed item adds and a heavy item takes away', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.SPEED, abilStrength: 2,
    };
    pc.equip[0] = true;
    setPcMoves(univ);
    expect(pc.ap).toBe(6);
    pc.items[0]!.ability = ItemAbil.SLOW_WEARER;
    setPcMoves(univ);
    expect(pc.ap).toBe(2);
  });

  it('takeAp never goes below zero', async () => {
    const { univ } = newGame();
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 3;
    takeAp(univ, 4);
    expect(univ.party.pcs[0]!.ap).toBe(0);
  });

  it('awkward gear costs action points', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.skills[Skill.DEFENSE] = 0;
    pc.items[0] = { ...pc.items[0]!, variety: ItemType.SHIELD, awkward: 9 };
    pc.equip[0] = true;
    expect(totalEncumbrance(univ, pc)).toBeGreaterThanOrEqual(8);
    pc.traits[Trait.SLUGGISH] = false;
    setPcMoves(univ);
    expect(pc.ap).toBeLessThan(4);
  });
});

describe('turn order', () => {
  it('walks to the next PC with moves and reports the end of the round', async () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.party.pcs[3]!.ap = 4;
    univ.curPc = 0;
    expect(pickNextPc(univ)).toBe(false);
    expect(univ.curPc).toBe(3);

    univ.party.pcs[3]!.ap = 0;
    expect(pickNextPc(univ)).toBe(true);
    expect(univ.curPc).toBe(0);
  });

  it('wraps back around to an earlier PC', async () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.party.pcs[1]!.ap = 4;
    univ.curPc = 4;
    expect(pickNextPc(univ)).toBe(false);
    expect(univ.curPc).toBe(1);
  });

  it('burns everyone else’s moves while one PC is mid-action', async () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 4; });
    univ.curPc = 0;
    pickNextPc(univ, 2);
    expect(univ.curPc).toBe(2);
    expect(univ.party.pcs[0]!.ap).toBe(0);
    expect(univ.party.pcs[1]!.ap).toBe(0);
    expect(univ.party.pcs[2]!.ap).toBe(4);
  });
});

describe('starting and ending combat', () => {
  /**
   * **Walking into a monster does not start a fight**, hostile or not. This
   * port used to do that, and it was an invention: `start_town_combat` has
   * three callers in the C++ — `handle_combat_switch` and two specials — and
   * walking is not one of them. `is_blocked` (boe.locutils.cpp:261) counts a
   * creature as blockage like any other, so you read "Blocked: <direction>"
   * and press **C** if you want the fight.
   */
  it('walking into something hostile just blocks, and does not start a fight', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    expect(session.mode).toBe(GameMode.TOWN);
    await session.moveTo(monst.curLoc);
    expect(session.mode).toBe(GameMode.TOWN);
    expect(univ.transcript.at(-1)).toMatch(/^Blocked: /);
  });

  it('walking into a friendly blocks the same way', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    monst.attitude = Attitude.FRIENDLY;
    await session.moveTo(monst.curLoc);
    expect(session.mode).toBe(GameMode.TOWN);
    expect(univ.transcript.at(-1)).toMatch(/^Blocked: /);
  });

  it('starts a fight from the Combat command, which is the only way in', async () => {
    const { univ, session } = newGame();
    hostileBeside(univ, session);
    session.startCombat(univ.party.direction);
    expect(session.mode).toBe(GameMode.COMBAT);
    expect(session.whichCombatType).toBe(1);
    // Everyone has been placed and has moves.
    expect(univ.party.pcs[0]!.combatPos.x).toBeGreaterThanOrEqual(0);
    expect(univ.currentPc.ap).toBeGreaterThan(0);
  });

  it('placeParty spreads the party out on open ground', async () => {
    const { univ, session } = newGame();
    placeParty(session, Direction.N);
    const spots = univ.party.pcs.filter((pc) => pc.isAlive).map((pc) => `${pc.combatPos.x},${pc.combatPos.y}`);
    // The first PC stands where the party stood.
    expect(univ.party.pcs[0]!.combatPos).toEqual(univ.party.townLoc);
    // At least some of the others got their own square.
    expect(new Set(spots).size).toBeGreaterThan(1);
  });

  it('a caged party all lands on the one square', async () => {
    const { univ, session } = newGame();
    univ.party.pcs[0]!.status[Status.FORCECAGE] = 20;
    placeParty(session, Direction.N);
    for (const pc of univ.party.pcs) expect(pc.combatPos).toEqual(univ.party.townLoc);
  });

  it('ending combat regroups on a survivor and restores town mode', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    expect(session.mode).toBe(GameMode.COMBAT);

    expect(session.endCombat()).toBe(true);
    expect(session.mode).toBe(GameMode.TOWN);
    // The party stands where one of them was.
    const positions = univ.party.pcs.map((pc) => pc.combatPos);
    for (const p of positions) expect(p).toEqual(loc(-1, -1));
    expect(univ.party.townLoc.x).toBeGreaterThanOrEqual(0);
  });

  it('refuses to end combat with only some of the party caged', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    univ.party.pcs[0]!.status[Status.FORCECAGE] = 20;
    univ.party.pcs[0]!.combatPos = loc(1, 1);
    univ.party.pcs[1]!.combatPos = loc(9, 9);
    expect(session.endCombat()).toBe(false);
    expect(session.mode).toBe(GameMode.COMBAT);
    expect(univ.transcript.at(-1)).toContain('Someone trapped.');
  });
});

describe('the melee attack', () => {
  function armedFighter(univ: Universe): Player {
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.PACIFIST] = false;
    pc.skills[Skill.EDGED_WEAPONS] = 20;
    pc.skills[Skill.DEXTERITY] = 20;
    pc.skills[Skill.ASSASSINATION] = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'sword',
      itemLevel: 8, weapType: Skill.EDGED_WEAPONS, ability: ItemAbil.NONE,
    };
    pc.equip[0] = true;
    pc.ap = 4;
    return pc;
  }

  it('a swing that lands takes health off the monster', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    const before = monst.health;
    // Twenty swings: with skill 20 against armour 0 some must connect.
    for (let i = 0; i < 20; i++) {
      pc.ap = 4;
      await pcAttack(univ, 0, monst, session);
    }
    expect(monst.health).toBeLessThan(before);
    expect(univ.transcript.some((l) => l.includes('swings.'))).toBe(true);
  });

  it('costs four action points whether it connects or not', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pc.ap = 4;
    await pcAttack(univ, 0, monst, session);
    expect(pc.ap).toBe(0);
  });

it('a slayer weapon adds its bonus only against the race it names', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.items[0]!.ability = ItemAbil.SLAYER_WEAPON;
    pc.items[0]!.abilStrength = 4;
    pc.items[0]!.abilData = Race.BEAST;
    univ.curPc = 0;

    const wrongRace = hostileBeside(univ, session);
    wrongRace.mon.race = Race.HUMAN;
    wrongRace.maxHealth = 4000;
    wrongRace.health = 4000;
    for (let i = 0; i < 15; i++) { pc.ap = 4; await pcAttack(univ, 0, wrongRace, session); }
    const plainDamage = 4000 - wrongRace.health;

    const rightRace = hostileBeside(univ, session);
    rightRace.mon.race = Race.BEAST;
    rightRace.maxHealth = 4000;
    rightRace.health = 4000;
    for (let i = 0; i < 15; i++) { pc.ap = 4; await pcAttack(univ, 0, rightRace, session); }
    const slainDamage = 4000 - rightRace.health;

    // Four points times five for a beast, on top of every blow that landed.
    expect(slainDamage).toBeGreaterThan(plainDamage);
  });

  it('a poisoned blade ticks down twice per swing, not by the augmented amount', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pc.status[Status.POISONED_WEAPON] = 5;
    pc.weapPoisoned = pc.items[0]!;
    // Something that lands: twenty swings, and the first hit spends the poison.
    for (let i = 0; i < 20 && (pc.status[Status.POISONED_WEAPON] ?? 0) === 5; i++) {
      pc.ap = 4;
      await pcAttack(univ, 0, monst, session);
    }
    // pc_attack_weapon decrements it when the poison lands and pc_attack
    // decrements it again on the way out, so a landed blow costs two — but
    // never the POISON_AUGMENT bonus, which is what this pins.
    expect(pc.status[Status.POISONED_WEAPON]).toBe(3);
  });

  it('an unarmed PC punches', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    await pcAttack(univ, 0, monst, session);
    expect(univ.transcript.some((l) => l.includes('punches.'))).toBe(true);
  });

  it('a pacifist refuses', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.traits[Trait.PACIFIST] = true;
    const monst = hostileBeside(univ, session);
    const before = monst.health;
    await pcAttack(univ, 0, monst, session);
    expect(monst.health).toBe(before);
    expect(univ.transcript.at(-1)).toBe("Attack: You're a pacifist!");
  });

  it('a sleeping or paralysed PC cannot attack at all', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.ASLEEP] = 4;
    const monst = hostileBeside(univ, session);
    const before = univ.transcript.length;
    await pcAttack(univ, 0, monst, session);
    expect(univ.transcript.length).toBe(before);
  });

  it('attacking gives away invisibility', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.INVISIBLE] = 4;
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    await pcAttack(univ, 0, monst, session);
    expect(pc.status[Status.INVISIBLE]).toBe(0);
    expect(univ.transcript).toContain('You become visible!');
  });

  it('remembers who it hit, for the repeat', async () => {
    const { univ, session } = newGame();
    armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    await pcAttack(univ, 0, monst, session);
    expect(univ.party.pcs[0]!.lastAttacked).toBe(monst);
  });

  it('a martyr sends some of the damage back', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.maxHealth = 100;
    pc.curHealth = 100;
    const monst = hostileBeside(univ, session);
    monst.status[Status.MARTYRS_SHIELD] = 8;
    univ.curPc = 0;
    for (let i = 0; i < 20 && pc.curHealth === 100; i++) {
      pc.ap = 4;
      await pcAttack(univ, 0, monst, session);
    }
    expect(pc.curHealth).toBeLessThan(100);
    expect(univ.transcript).toContain('  Shares damage!');
  });

  it('killing the monster in melee ends it', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    monst.health = 1;
    univ.curPc = 0;
    for (let i = 0; i < 30 && monst.isAlive; i++) {
      pc.ap = 4;
      await pcAttack(univ, 0, monst, session);
    }
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.party.totalMKilled).toBe(1);
  });

  it('a poisoned blade poisons what it hits, once', async () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.POISONED_WEAPON] = 4;
    pc.weapPoisoned = pc.items[0]!;
    const monst = hostileBeside(univ, session);
    monst.mon.resist[2] = 100; // no poison resistance
    univ.curPc = 0;
    for (let i = 0; i < 20 && (monst.status[Status.POISON] ?? 0) === 0; i++) {
      pc.ap = 4;
      pc.status[Status.POISONED_WEAPON] = 4;
      await pcAttack(univ, 0, monst, session);
    }
    expect(monst.status[Status.POISON]).toBeGreaterThan(0);
  });

  it('session.attackAt hits whatever is on the square', async () => {
    const { univ, session } = newGame();
    armedFighter(univ);
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 4;
    expect(await session.attackAt(monst.curLoc)).toBe(true);
    expect(await session.attackAt(loc(1, 1))).toBe(false);
  });
});

describe('placement, parry and holding a turn', () => {
  it('never places a PC in a wall or on top of a monster', async () => {
    const { univ, session } = newGame();
    // Ring the party with monsters so a naive placement would overlap one.
    const from = univ.party.townLoc;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const at = loc(from.x + d[0]!, from.y + d[1]!);
      if (session.townIsBlocked(at) || univ.town!.monsterAt(at)) continue;
      const m = hostileBeside(univ, session);
      m.curLoc = at;
    }
    const leader = univ.party.pcs[univ.firstActivePc()]!;
    placeParty(session, Direction.N);
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive || pc === leader) continue; // index 0 is forced through
      expect(univ.town!.monsterAt(pc.combatPos)).toBeNull();
      expect(session.townIsBlocked(pc.combatPos)).toBe(false);
    }
  });

  it('never places a PC through a wall', async () => {
    const { univ, session } = newGame();
    // place_party's spots have to be reachable in a straight, unobstructed
    // line from the party (can_see_light with combat_obscurity), which is what
    // keeps the party on one side of a wall when a fight starts in a doorway.
    placeParty(session, Direction.N);
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive) continue;
      if (locsEqual(pc.combatPos, univ.party.townLoc)) continue; // index 0 is forced
      expect(session.canSeeLight(
        univ.party.townLoc, pc.combatPos, session.combatObscurity)).toBe(0);
    }
  });

  it('combat_obscurity blocks on anything that blocks movement', async () => {
    const { univ, session } = newGame();
    const from = univ.party.townLoc;
    // Find a wall square somewhere in the town and check the two obscurity
    // functions disagree the way the C++'s do: sight may pass, movement not.
    const town = univ.town!;
    let wall: ReturnType<typeof loc> | null = null;
    for (let x = from.x - 8; x < from.x + 8 && !wall; x++)
      for (let y = from.y - 8; y < from.y + 8 && !wall; y++)
        if (town.isOnMap(x, y) && session.townIsBlocked(loc(x, y))
          && session.sightObscurity(x, y) === 0) wall = loc(x, y);
    if (!wall) return; // no such square in this town; nothing to assert
    expect(session.combatObscurity(wall.x, wall.y)).toBe(5);
  });

  it('isBlocked counts creatures, the party and barriers, not just terrain', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    expect(session.isBlocked(monst.curLoc)).toBe(true);
    expect(session.townIsBlocked(monst.curLoc)).toBe(false); // terrain is clear
    // The party's own square blocks in town mode.
    expect(session.isBlocked(univ.party.townLoc)).toBe(true);
    // And a force barrier blocks even open floor.
    const open = loc(univ.party.townLoc.x, univ.party.townLoc.y + 1);
    if (!session.townIsBlocked(open) && !univ.town!.monsterAt(open)) {
      expect(session.isBlocked(open)).toBe(false);
      univ.town!.setField(open.x, open.y, FieldType.BARRIER_FORCE);
      expect(session.isBlocked(open)).toBe(true);
    }
  });

  it('parry spends the turn and scales with the moves given up', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    const pc = univ.currentPc;
    pc.skills[Skill.DEFENSE] = 8;
    pc.ap = 8;
    // `handle_parry` has no return value and no guards — see `session.parry`.
    await session.parry();
    expect(pc.parry).toBeGreaterThan(0);
    expect(pc.ap).toBe(0);
    expect(univ.transcript).toContain('Parry.');
  });

  it('parry has no guards: it works out of combat, and on a PC with no points',
    async () => {
      // `handle_parry` (boe.actions.cpp:529) tests neither the mode nor the
      // action points — the `d` key and the SHIELD button do that for it, and
      // the replay dispatcher does not. So a recording made in a fight can
      // parry after the fight has ended, and the C++ charges the turn.
      const { univ, session } = newGame();
      const before = univ.party.age;
      await session.parry();
      expect(univ.transcript).toContain('Parry.');
      // A town turn: `advance_time` ran `handle_monster_actions`, whose
      // non-combat arm is `increase_age`.
      expect(univ.party.age).toBe(before + 1);

      // And in combat with nothing left to spend: parry is zero, and the turn
      // still passes rather than leaving the PC holding it.
      const { univ: u2, session: s2 } = newGame();
      hostileBeside(u2, s2);
      s2.startCombat(u2.party.direction);
      const pc = u2.currentPc;
      pc.ap = 0;
      await s2.parry();
      expect(pc.parry).toBe(0);
      expect(u2.transcript).toContain('Parry.');
    });

  it('standing ready is parry pinned at 100, and clears webs', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    const pc = univ.currentPc;
    pc.status[Status.WEBS] = 5;
    pc.ap = 4;
    await session.pause();
    expect(pc.parry).toBe(100);
    expect(pc.status[Status.WEBS]).toBe(3);
    expect(univ.transcript).toContain('Stand ready.');
  });

  it('pausing outside combat is a plain pause', async () => {
    const { univ, session } = newGame();
    univ.party.pcs[0]!.status[Status.WEBS] = 4;
    await session.pause();
    expect(univ.transcript).toContain('Pause.');
    expect(univ.party.pcs[0]!.status[Status.WEBS]).toBe(2);
  });

  /**
   * **Every `return true` out of `pc_combat_move` owes a `combat_next_step`.**
   * The C++ never calls it inside the move: `handle_move` sets
   * `did_something` from the return and `handle_monster_actions` runs it off
   * that (boe.actions.cpp:751 and :1959). This port called it inline at each
   * successful branch and missed the two that leave early — and the back-shot
   * one is the expensive miss, because `kill_pc` parks `cur_pc` on
   * `first_active_pc()` and only `pick_next_pc` moves it off again. The fight
   * is then held by a PC with no moves, every later step is refused, and it
   * never ends.
   */
  it('a back-shot that kills the mover still hands the turn on', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction);
    // Make the swing certain and lethal, and stand the creature next to the
    // PC who is about to step away from it.
    monst.mon.attacks = [{ dice: 20, sides: 20, type: 0 }];
    monst.mon.skill = 100;
    monst.attitude = Attitude.HOSTILE_A;
    monst.active = CreatureStatus.ALERTED;
    univ.curPc = 0;
    const pc = univ.party.pcs[0]!;
    // A PC only dies from a blow taken while *already* at zero (damage.ts's
    // own note), so they start there.
    pc.curHealth = 0;
    pc.combatPos = { x: monst.curLoc.x + 1, y: monst.curLoc.y };
    // Only PC 4 can take over — and crucially they are **not**
    // `first_active_pc()`, which is where `kill_pc` parks `cur_pc`. Without
    // `pick_next_pc` running afterwards the fight is left on PC 2, who has no
    // moves, and every later step is refused.
    setPcMoves(univ);
    for (const p of univ.party.pcs) p.ap = 0;
    univ.party.pcs[3]!.ap = 4;
    pc.ap = 4;

    // Step out of reach: the back-shot lands, kills the mover, and the move
    // is abandoned.
    const away = { x: monst.curLoc.x + 3, y: monst.curLoc.y };
    await session.combatMove(away);
    await session.settled();

    expect(pc.mainStatus).not.toBe(MainStatus.ALIVE);
    // The turn moved on to somebody who can actually act.
    expect(univ.curPc).toBe(3);
    expect(univ.currentPc.ap).toBeGreaterThan(0);
  });

  it('X holds the turn on one PC and gives it back', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    session.startCombat(univ.party.direction); // the Combat command, not a bump
    univ.curPc = 2;
    session.toggleActivePc();
    expect(session.combatActivePc).toBe(2);
    expect(univ.transcript).toContain('This PC now active.');
    session.toggleActivePc();
    expect(session.combatActivePc).toBe(NO_ONE);
    expect(univ.curPc).toBe(2);
  });
});

describe('weapon selection', () => {
  it('finds one two-handed weapon, or a pair of one-handed', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    expect(getWeapons(pc)).toEqual([null, null]);

    pc.items[0] = { ...pc.items[0]!, variety: ItemType.TWO_HANDED, name: 'greatsword' };
    pc.equip[0] = true;
    expect(getWeapons(pc)[0]!.name).toBe('greatsword');
    expect(getWeapons(pc)[1]).toBeNull();

    pc.items[0] = { ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'left' };
    pc.items[1] = { ...pc.items[1]!, variety: ItemType.ONE_HANDED, name: 'right' };
    pc.equip[1] = true;
    const [a, b] = getWeapons(pc);
    expect(a!.name).toBe('left');
    expect(b!.name).toBe('right');
  });

  it('a slith with a pole arm is more accurate, in the roll', async () => {
    // The bonus is a -10 on the to-hit roll, so over many swings a slith with a
    // spear should connect more often than a human with the same skill.
    const { univ, session } = newGame();
    const spear = (pc: Player): void => {
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
      pc.skills[Skill.POLE_WEAPONS] = 4;
      pc.skills[Skill.DEXTERITY] = 4;
      pc.skills[Skill.ASSASSINATION] = 0;
      pc.items[0] = {
        ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'spear',
        itemLevel: 6, weapType: Skill.POLE_WEAPONS, ability: ItemAbil.NONE,
      };
      pc.equip[0] = true;
    };
    const hits = async (race: Race): Promise<number> => {
      const pc = univ.party.pcs[0]!;
      pc.race = race;
      spear(pc);
      const monst = hostileBeside(univ, session);
      monst.health = 100000;
      const before = monst.health;
      for (let i = 0; i < 200; i++) {
        pc.ap = 4;
        await pcAttack(univ, 0, monst, session);
      }
      univ.town!.monsters.pop();
      return before - monst.health;
    };
    const human = await hits(Race.HUMAN);
    const slith = await hits(Race.SLITH);
    expect(slith).toBeGreaterThan(human);
  });
});
