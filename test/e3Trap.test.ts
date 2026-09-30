/**
 * Exile III's `run_trap` (`FUN_10e0_03ae`, src/game/e3Trap.ts): its
 * disarming sum and the kinds whose numbers are E3's own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { setBugFixes } from '../src/game/bugFixes';
import { e3RunTrap } from '../src/game/e3Trap';
import { GameSession } from '../src/game/session';
import { TrapType } from '../src/game/trap';
import { PartyPreset, Player } from '../src/universe/player';
import { Skill, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;
beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
});

/**
 * PC 0 at a trap in a town of difficulty 30, with the dice pinned: every
 * `get_ran(1,0,100)` returns `roll`, and every draw is logged.
 */
function atTrap(roll: number): { s: GameSession; pc: Player; draws: [number, number, number][] } {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  s.univ.town!.record.difficulty = 30;
  const pc = s.univ.party.pcs[0]!;
  pc.items = pc.items.map(() => defaultItem());
  pc.equip.fill(false);
  pc.skills[Skill.DISARM_TRAPS] = 4;
  pc.skills[Skill.LUCK] = 4;
  pc.traits[Trait.NIMBLE] = false;
  const draws: [number, number, number][] = [];
  s.univ.rng.getRan = (n, lo, hi) => {
    draws.push([n, lo, hi]);
    return lo === 0 && hi === 100 ? roll : lo;
  };
  return { s, pc, draws };
}

describe("Exile III's traps", () => {
  it('disarms on E3’s sum: skill + luck / 2 + 3 − difficulty / 10 + 2 × dexterity, less 6 for the clumsy', async () => {
    // 4 + 2 + 3 − 3 = 6 before the dexterity; `DS:3cd8`[6] is 63.
    const { pc: probe } = atTrap(0);
    const skill = 6 + 2 * probe.statAdj(Skill.DEXTERITY);
    const odds = [5, 30, 35, 42, 48, 55, 63, 69, 75, 77, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98][skill]!;
    // Not nimble, so 6 comes off (E3's inverted test, bug #12): a roll of
    // odds + 5 still disarms, odds + 6 does not.
    for (const [roll, disarmed] of [[odds + 5, true], [odds + 6, false]] as const) {
      const { s } = atTrap(roll);
      expect(await e3RunTrap(s, 0, TrapType.BLADE, 0, 0)).toBe(disarmed);
    }
    // With bug #12 fixed, it's the nimble who get the 6.
    setBugFixes(true);
    try {
      const { s } = atTrap(odds + 5);
      expect(await e3RunTrap(s, 0, TrapType.BLADE, 0, 0)).toBe(false);
    } finally {
      setBugFixes(false);
    }
  });

  it('a strong dart poisons 3 more, by E3’s rule rather than 2 × level', async () => {
    for (const [level, expected] of [[0, 3 + 2], [2, 3 + 2 + 3]] as const) {
      const { s, pc } = atTrap(100);
      const doses: number[] = [];
      pc.poison = (n) => { doses.push(n); };
      await e3RunTrap(s, 0, TrapType.DART, level, 0);
      // 3 + difficulty / 14 (30 → 2), and 3 more for a strong trap.
      expect(doses).toEqual([expected]);
    }
  });

  it('flames are always 15d8, whatever the level', async () => {
    for (const level of [0, 2]) {
      const { s, draws } = atTrap(100);
      await e3RunTrap(s, 0, TrapType.FLAMES, level, 0);
      expect(draws).toContainEqual([15, 1, 8]);
    }
  });
});
