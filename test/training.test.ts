import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SelectPcMode, selectPcOptions } from '../src/game/selectPc';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { TalkNodeType } from '../src/data/talking';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { doRest } from '../src/game/rest';
import { SpendXp, XpMode } from '../src/game/createPc';
import { SKILL_GOLD_COST, SKILL_POINT_COST } from '../src/data/shop';
import { setGiveHelp } from '../src/universe/living';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Skill, Status, Trait } from '../src/universe/skills';
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

describe('training', () => {
  /** spend_xp in mode 1, on the first PC, with the party holding `gold`. */
  function train(univ: Universe, gold: number): SpendXp {
    univ.party.gold = gold;
    return new SpendXp(univ, 0, XpMode.TRAIN);
  }

  it('charges both skill points and gold', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 20;
    const state = train(univ, 1000);
    const before = pc.skills[Skill.LOCKPICKING]!;

    state.click('lockpick-p');
    expect(state.skp).toBe(20 - SKILL_POINT_COST[Skill.LOCKPICKING]!);
    expect(state.gold).toBe(1000 - SKILL_GOLD_COST[Skill.LOCKPICKING]!);
    // Nothing is committed until keep().
    expect(pc.skills[Skill.LOCKPICKING]).toBe(before);
    state.keep();
    expect(univ.party.gold).toBe(1000 - SKILL_GOLD_COST[Skill.LOCKPICKING]!);
    expect(pc.skills[Skill.LOCKPICKING]).toBe(before + 1);
    expect(pc.skillPts).toBe(20 - SKILL_POINT_COST[Skill.LOCKPICKING]!);
  });

  it('refuses without the skill points or the gold, and says which', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    const helps: number[] = [];
    setGiveHelp((h) => { helps.push(h); });
    try {
      pc.skillPts = 0;
      const broke = train(univ, 10000);
      expect(broke.canChange(Skill.LUCK, true)).toBe(false);
      broke.click('luck-p');
      pc.skillPts = 100;
      const poor = train(univ, 0);
      expect(poor.canChange(Skill.STRENGTH, true)).toBe(false);
      poor.click('str-p');
      expect(train(univ, 10000).canChange(Skill.STRENGTH, true)).toBe(true);
      // give_help(25) for skill points, give_help(24) for gold.
      expect(helps).toEqual([25, 24]);
    } finally {
      setGiveHelp(null);
    }
  });

  it('stops at the skill cap', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 1000;
    pc.skills[Skill.MAGE_SPELLS] = 7; // the mage-spell cap
    const state = train(univ, 100000);
    expect(state.canChange(Skill.MAGE_SPELLS, true)).toBe(false);
    expect(state.canChange(Skill.MAGE_LORE, true)).toBe(true);
  });

  it("won't refund a level the PC came in with, but will refund this session's", async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 100;
    pc.skills[Skill.LOCKPICKING] = 3;
    const state = train(univ, 10000);
    expect(state.canChange(Skill.LOCKPICKING, false)).toBe(false);
    state.click('lockpick-p');
    expect(state.canChange(Skill.LOCKPICKING, false)).toBe(true);
    state.click('lockpick-m');
    expect(state.cur(Skill.LOCKPICKING)).toBe(3);
    expect(state.skp).toBe(100);
    expect(state.gold).toBe(10000);
  });

  it('buys health two at a time, already filled', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 10;
    pc.curHealth = pc.maxHealth;
    const maxBefore = pc.maxHealth;
    const state = train(univ, 1000);
    state.click('hp-p');
    state.keep();
    expect(pc.maxHealth).toBe(maxBefore + 2);
    expect(pc.curHealth).toBe(pc.maxHealth);
    expect(univ.party.gold).toBe(990);
  });

  it('warns an Anama member off mage magic, and curses one who keeps it', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.ANAMA] = true;
    pc.skills[Skill.MAGE_SPELLS] = 0;
    pc.skills[Skill.STRENGTH] = 10;
    pc.skills[Skill.DEXTERITY] = 10;
    pc.skills[Skill.INTELLIGENCE] = 10;
    pc.skills[Skill.LUCK] = 5;
    pc.skillPts = 100;
    const state = train(univ, 10000);
    state.click('mage-p');
    expect(state.anamaWarning).toBe(true);
    // Once the working copy has a mage level, the warning has been given.
    state.click('mage-p');
    expect(state.anamaWarning).toBe(false);
    state.keep();
    expect(pc.skills[Skill.STRENGTH]).toBe(8);
    expect(pc.skills[Skill.DEXTERITY]).toBe(8);
    expect(pc.skills[Skill.INTELLIGENCE]).toBe(6);
    expect(pc.skills[Skill.LUCK]).toBe(0);
    expect(pc.traits[Trait.ANAMA]).toBe(false);
  });

  it('steps between living PCs, and knows when it has something to lose', async () => {
    const { univ } = newGame();
    univ.party.pcs[1]!.mainStatus = MainStatus.DEAD;
    univ.party.pcs.forEach((pc) => { pc.skillPts = 10; });
    const state = train(univ, 1000);
    expect(state.needsConfirm).toBe(false);
    state.click('luck-p');
    expect(state.needsConfirm).toBe(true);
    expect(state.click('right')).toBe('right');
    state.switchPc('right');
    expect(state.who).toBe(2);
    expect(state.needsConfirm).toBe(false);
    state.switchPc('left');
    state.switchPc('left');
    expect(state.who).toBe(5);
  });

  it('only offers PCs with skill points to spend', async () => {
    const { univ, session } = newGame();
    univ.party.pcs.forEach((pc) => { pc.skillPts = 0; });
    univ.party.pcs[2]!.skillPts = 5;
    const options = selectPcOptions(univ, SelectPcMode.ONLY_CAN_TRAIN);
    expect(options.filter((o) => o.canPick).map((o) => o.index)).toEqual([2]);
    expect(options[2]!.label).toContain('5 skill points');
    expect(options[0]!.label).toContain('no skill points');
  });
});

describe('the Rest command', () => {
  /** handle_rest is outdoors-only, so every case has to leave town first. */
  async function outdoorGame(): Promise<{ univ: Universe; session: GameSession }> {
    const { univ, session } = newGame();
    session.endTownMode({ x: 0, y: 0 });
    return { univ, session };
  }

  it('rests, costs food, and plays its sound', async () => {
    const { univ, session } = await outdoorGame();
    const sounds: number[] = [];
    session.sound = { play: (n: number) => sounds.push(n) } as never;
    univ.party.food = 100;
    univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
    const ageBefore = univ.party.age;

    expect(await session.rest()).toBe(true);
    expect(univ.party.food).toBe(94);
    // Fifty turns of the outdoor clock (ten ticks each) *and then* do_rest's
    // 1200 — the loop is not free.
    expect(univ.party.age).toBe(ageBefore + 500 + 1200);
    expect(univ.party.pcs[0]!.curHealth).toBeGreaterThan(1);
    // Sound 20, negative meaning "asynchronously".
    expect(sounds).toContain(-20);
    expect(univ.transcript).toContain('Resting...');
    expect(univ.transcript.at(-1)).toBe('  Rest successful.');
  });

  it('refuses when poisoned, hungry, in a boat, or in town', async () => {
    const cases: [string, (u: Universe) => void, string][] = [
      ['poison', (u) => { u.party.pcs[0]!.status[Status.POISON] = 3; }, 'Someone poisoned'],
      ['food', (u) => { u.party.food = 5; }, 'Not enough food'],
      ['boat', (u) => { u.party.inBoat = 0; }, 'Not in boat'],
    ];
    for (const [, setup, expected] of cases) {
      const { univ, session } = await outdoorGame();
      setup(univ);
      expect(await session.rest()).toBe(false);
      expect(univ.transcript.at(-1)).toContain(expected);
    }
    // In town the command does not exist at all: the C++ tests the mode before
    // it ever calls handle_rest, so there is no refusal message either.
    const { session } = newGame();
    expect(await session.rest()).toBe(false);
  });
});

describe('resting', () => {
  it('heals and restores, capped at the maximum', async () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[3]!;
    pc.curHealth = 1;
    pc.curSp = 0;
    pc.heal(5);
    expect(pc.curHealth).toBe(6);
    pc.heal(1000);
    expect(pc.curHealth).toBe(pc.maxHealth);
    pc.restoreSp(1000);
    expect(pc.curSp).toBe(pc.maxSp);
    // The dead don't recover.
    pc.mainStatus = MainStatus.DEAD;
    pc.curHealth = 1;
    pc.heal(10);
    expect(pc.curHealth).toBe(1);
  });

  it('advances the clock, clears statuses, and heals the party', async () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => {
      pc.curHealth = 1;
      pc.status[Status.POISON] = 4;
    });
    const ageBefore = univ.party.age;
    doRest(univ, 700, 30, 25);
    expect(univ.party.age).toBe(ageBefore + 700);
    for (const pc of univ.party.pcs) {
      expect(pc.status[Status.POISON]).toBe(0);
      expect(pc.curHealth).toBeGreaterThan(1);
    }
  });

  it('restocks the random shops on a long rest', async () => {
    const { univ } = newGame();
    const which = scen.shops.findIndex((s) => s.type === 2);
    const before = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    doRest(univ, 700, 10, 10);
    const short = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    expect(short).toEqual(before);
    // A rest past the 4000-tick mark rolls new stock.
    doRest(univ, 5000, 10, 10);
    const after = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    expect(after.length).toBe(before.length);
  });

  it('an INN node charges, rests, and moves the party to its bed', async () => {
    for (let t = 0; t < scen.townTalk.length; t++) {
      const index = scen.townTalk[t]!.talkNodes.findIndex(
        (n) => n.type === TalkNodeType.INN && n.personality >= 0);
      if (index < 0) continue;
      const node = scen.townTalk[t]!.talkNodes[index]!;
      const [price, , x, y] = node.extras;
      const { univ, session } = newGame();
      session.startTownMode(t, FORCED_ENTRY);
      session.startTalkMode(-1, node.personality, 0, -1);
      univ.party.gold = price! + 100;
      univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
      const ageBefore = univ.party.age;

      session.chooseTalkNode(index);
      expect(univ.party.gold).toBe(100);
      expect(univ.party.age).toBeGreaterThan(ageBefore);
      expect(univ.party.townLoc).toEqual({ x, y });
      expect(univ.party.pcs[0]!.curHealth).toBeGreaterThan(1);
      // The innkeeper shows you out.
      expect(session.talk!.endForced).toBe(true);

      // Too poor to stay: the node's second string is the refusal.
      const poor = newGame();
      poor.session.startTownMode(t, FORCED_ENTRY);
      poor.session.startTalkMode(-1, node.personality, 0, -1);
      poor.univ.party.gold = Math.max(0, price! - 1);
      poor.session.chooseTalkNode(index);
      expect(poor.session.talk!.str1).toBe(node.str2);
      expect(poor.univ.party.gold).toBe(Math.max(0, price! - 1));
      return;
    }
  });
});
