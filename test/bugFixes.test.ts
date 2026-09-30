/**
 * The "Fix known bugs" preference (src/game/bugFixes.ts): off, the originals'
 * bugs play as they shipped; on, each wired one plays fixed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemAbil, ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { KNOWN_BUGS, bugFixed, setBugFixes } from '../src/game/bugFixes';
import { GameSession } from '../src/game/session';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { handleDisease } from '../src/game/increaseAge';
import { curWeight, giveItem } from '../src/universe/inventory';
import { Status, Trait } from '../src/universe/skills';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;
beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
});
afterEach(() => setBugFixes(false));

class QuietHost implements SpecialHost {
  async message(): Promise<void> {}
  async choice(): Promise<number> { return 0; }
  async story(): Promise<void> {}
  async askText(): Promise<string> { return ''; }
  async askNum(min: number): Promise<number> { return min; }
  async selectPc(): Promise<number> { return 0; }
  async getNumOfItems(max: number): Promise<number> { return max; }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(): void {}
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  forceTown(): void {}
  endScenario(): void {}
}

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  s.attachSpecials(new QuietHost());
  return s;
}

describe('bugFixed', () => {
  it('is off until the preference turns it on, and never for an unwired bug', () => {
    expect(bugFixed(7)).toBe(false);
    setBugFixes(true);
    expect(bugFixed(7)).toBe(true);
    expect(KNOWN_BUGS[5]!.unwired).toBeDefined();
    expect(bugFixed(5)).toBe(false);
    expect(bugFixed(999)).toBe(false);
  });
});

describe('if-fixed', () => {
  /** 90: if-fixed 7 → 91, else 92; each sets SDF (5,5) to its own number. */
  async function run(on: boolean): Promise<number> {
    setBugFixes(on);
    const s = inTown();
    const specials = s.univ.town!.record.specials;
    specials.set(90, { ...emptySpecialNode(), type: SpecType.IF_FIXED, ex1a: 7, ex1b: 91, jumpto: 92 });
    specials.set(91, { ...emptySpecialNode(), type: SpecType.SET_SDF, sd1: 5, sd2: 5, ex1a: 1 });
    specials.set(92, { ...emptySpecialNode(), type: SpecType.SET_SDF, sd1: 5, sd2: 5, ex1a: 2 });
    await s.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 90, { x: 1, y: 1 });
    return s.univ.party.getSdf(5, 5);
  }

  it('takes the original branch by default, and the fixed one under the preference', async () => {
    expect(await run(false)).toBe(2);
    expect(await run(true)).toBe(1);
  });
});

describe('the Airy Stone (E3-SUSPECTED-BUGS.md #11)', () => {
  it('weighs -20 once taken under the preference, not 236', () => {
    setBugFixes(true);
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    for (let i = 0; i < pc.items.length; i++) pc.items[i] = defaultItem();
    pc.equip.fill(false);
    const at = giveItem(pc, s.univ.party, {
      ...defaultItem(), variety: ItemType.NON_USE_OBJECT, weight: 5, e3Ability: 117, ability: ItemAbil.LIGHTER_OBJECT,
    });
    expect(pc.items[at.slot]!.weight).toBe(-20);
    pc.items[1] = { ...defaultItem(), variety: ItemType.NON_USE_OBJECT, weight: 50 };
    expect(curWeight(pc)).toBe(30);
  });
});

describe("Exile III's disease end-roll (E3-SUSPECTED-BUGS.md #13)", () => {
  /** How often, in 800 goes, a Good Constitution PC shakes a one-point disease. */
  function cures(fixed: boolean): number {
    setBugFixes(fixed);
    const s = inTown();
    scen.featureFlags['disease'] = 'exile3';
    try {
      const pc = s.univ.party.pcs[0]!;
      pc.traits[Trait.GOOD_CONST] = true;
      for (const p of s.univ.party.pcs.slice(1)) p.status[Status.DISEASE] = 0;
      let n = 0;
      for (let i = 0; i < 800; i++) {
        pc.status[Status.DISEASE] = 1;
        handleDisease(s);
        if (pc.status[Status.DISEASE] === 0) n++;
      }
      return n;
    } finally {
      delete scen.featureFlags['disease'];
    }
  }

  it('ignores Good Constitution as E3 shipped (1 in 8), and uses it when fixed (3 in 8)', () => {
    const shipped = cures(false);
    const fixed = cures(true);
    expect(shipped).toBeGreaterThan(50);
    expect(shipped).toBeLessThan(150);
    expect(fixed).toBeGreaterThan(240);
    expect(fixed).toBeLessThan(360);
  });
});
