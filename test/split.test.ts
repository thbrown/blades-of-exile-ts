/**
 * Splitting the party — `cParty::start_split` / `end_split` (party.cpp:1200,
 * :1219) and the two nodes that drive them.
 *
 * Exile 3 uses this, so it matters beyond the one replay that named it: a
 * scenario can send one character through a gap the others can't follow, and
 * the rest of the party stands where it was until they are reunited.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { PcChoice } from '../src/game/selectPc';
import { PartyPreset } from '../src/universe/player';
import {
  MainStatus, Status, exceptSplit, isAbsentStatus, isDeadStatus, isSplitStatus,
} from '../src/universe/skills';
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

/** Answers the "Which character goes?" prompt with a fixed PC. */
class SplitHost implements SpecialHost {
  sounds: number[] = [];
  constructor(private who: number) {}
  async message(): Promise<void> {}
  async choice(): Promise<number> { return 0; }
  async story(): Promise<void> {}
  async askText(): Promise<string> { return ''; }
  async selectPc(_rows: PcChoice[]): Promise<number> { return this.who; }
  async getNumOfItems(max: number): Promise<number> { return max; }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(which: number): void { this.sounds.push(which); }
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  endScenario(): void {}
}

let session: GameSession;

beforeEach(() => {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  session = new GameSession(univ);
  session.startNewGame();
});

/** Put a node of `type` in the town's list at index 90 and hand back its record. */
function node(type: SpecType, over: Record<string, number> = {}): void {
  const spec = { ...emptySpecialNode(), type, ...over };
  session.univ.town!.record.specials.set(90, spec);
}

describe('eMainStatus and its SPLIT offset', () => {
  it('SPLIT is added to the status, not substituted for it', () => {
    expect(MainStatus.SPLIT_DEAD).toBe(MainStatus.SPLIT + MainStatus.DEAD);
    expect(exceptSplit(MainStatus.SPLIT_STONE)).toBe(MainStatus.STONE);
    expect(exceptSplit(MainStatus.STONE)).toBe(MainStatus.STONE);
    expect(isSplitStatus(MainStatus.SPLIT_ABSENT)).toBe(true);
    expect(isSplitStatus(MainStatus.WON)).toBe(false);
  });

  /** `isAbsent` is `ABSENT || > 4`, so a corpse is still with you. */
  it('a dead PC is not absent, but a fled one is', () => {
    expect(isAbsentStatus(MainStatus.DEAD)).toBe(false);
    expect(isAbsentStatus(MainStatus.STONE)).toBe(false);
    expect(isAbsentStatus(MainStatus.FLED)).toBe(true);
    expect(isAbsentStatus(MainStatus.SPLIT_ALIVE)).toBe(true);
    expect(isDeadStatus(MainStatus.DUST)).toBe(true);
    expect(isDeadStatus(MainStatus.FLED)).toBe(false);
  });
});

describe('start_split and end_split', () => {
  it('sends one PC on and leaves the rest where they stood', () => {
    const { party } = session.univ;
    const stood = { ...party.townLoc };
    expect(party.startSplit(20, 21, 2)).toBe(true);
    expect(party.leftAt).toEqual(stood);
    expect(party.leftIn).toBe(party.townNum);
    expect(party.townLoc).toEqual({ x: 20, y: 21 });
    expect(party.pcPresent(2)).toBe(true);
    expect(party.pcPresent(0)).toBe(false);
    expect(party.pcs[0]!.mainStatus).toBe(MainStatus.SPLIT_ALIVE);
    expect(party.isSplit()).toBe(true);
  });

  it('refuses a second split, and reuniting puts everyone back', () => {
    const { party } = session.univ;
    party.startSplit(20, 21, 2);
    expect(party.startSplit(5, 5, 1)).toBe(false);
    expect(party.endSplit()).toBe(true);
    expect(party.isSplit()).toBe(false);
    expect(party.pcs[0]!.mainStatus).toBe(MainStatus.ALIVE);
    // Nothing left to do the second time.
    expect(party.endSplit()).toBe(false);
  });

  it('clears everyone out of a forcecage on the way out', () => {
    const { party } = session.univ;
    for (const pc of party.pcs) pc.status[Status.FORCECAGE] = 5;
    party.startSplit(20, 21, 2);
    expect(party.pcs.every((pc) => pc.status[Status.FORCECAGE] === 0)).toBe(true);
  });
});

describe('the two nodes', () => {
  it('TOWN_SPLIT_PARTY asks who goes, and plays its sound only on success', async () => {
    const host = new SplitHost(3);
    session.attachSpecials(host);
    node(SpecType.TOWN_SPLIT_PARTY, { ex1a: 12, ex1b: 13, ex2a: 42 });
    await session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 90, { x: 1, y: 1 });
    expect(session.univ.party.townLoc).toEqual({ x: 12, y: 13 });
    expect(session.univ.curPc).toBe(3);
    expect(host.sounds).toContain(42);
    expect(session.univ.party.isSplit()).toBe(true);
  });

  it('refuses when already split, and blocks the step that triggered it', async () => {
    session.attachSpecials(new SplitHost(3));
    session.univ.party.startSplit(20, 21, 2);
    node(SpecType.TOWN_SPLIT_PARTY, { ex1a: 12, ex1b: 13 });
    const { blocked } = await session.runSpecial(
      SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 90, { x: 1, y: 1 });
    expect(blocked).toBe(true);
    expect(session.univ.transcript.at(-1)).toContain('already split');
    expect(session.univ.party.townLoc).toEqual({ x: 20, y: 21 });
  });

  /**
   * The two lines are the wrong way round in the C++ — `end_split` returns
   * true when it *did* something — and that is kept.
   */
  it('TOWN_REUNITE_PARTY walks the lone PC back, with the messages swapped', async () => {
    const { party } = session.univ;
    session.attachSpecials(new SplitHost(3));
    const stood = { ...party.townLoc };
    party.startSplit(20, 21, 2);
    // ex2a **0**, not the -1 an empty node carries: the C++ tests it for
    // truth, so -1 takes the do-nothing branch just as 1 does.
    node(SpecType.TOWN_REUNITE_PARTY, { ex2a: 0 });
    await session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 90, { x: 1, y: 1 });
    expect(party.isSplit()).toBe(false);
    expect(party.townLoc).toEqual(stood);
    expect(session.univ.transcript.at(-1)).toBe('Party already together!');
  });

  it('ex2a does nothing at all, because the C++ guards an empty statement', async () => {
    const { party } = session.univ;
    session.attachSpecials(new SplitHost(3));
    party.startSplit(20, 21, 2);
    node(SpecType.TOWN_REUNITE_PARTY, { ex2a: 1 });
    await session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 90, { x: 1, y: 1 });
    // Reunited, but *not* moved: the party stays where the lone PC was.
    expect(party.isSplit()).toBe(false);
    expect(party.townLoc).toEqual({ x: 20, y: 21 });
  });
});

describe('a split PC dying', () => {
  /**
   * `check_death`'s tail (boe.actions.cpp:1442): the one who went on alone is
   * the only one who could have died, so the rest of the party takes over
   * rather than the game ending.
   */
  it('reunites the party instead of ending the game', () => {
    const { party } = session.univ;
    const stood = { ...party.townLoc };
    party.startSplit(20, 21, 2);
    party.pcs[2]!.mainStatus = MainStatus.DEAD;
    expect(party.isAlive()).toBe(false);

    session.checkGameOver();
    expect(party.isSplit()).toBe(false);
    expect(party.townLoc).toEqual(stood);
    expect(session.univ.transcript.some((l) => l.includes('scenario is over'))).toBe(false);
  });
});
