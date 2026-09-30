/**
 * The keyboard's aim cursor (`game/aimCursor.ts`): where it starts, where the
 * arrows take it, and that finding the target never touches the dice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Direction } from '../src/core/location';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Aiming, autoAim, canAimAt, moveAim } from '../src/game/aimCursor';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
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
 * A fight in Fort Talrus's guest quarters: PC 3 acting at (7,8), and the
 * first three of the town's monsters made hostile on the given open squares.
 */
function fight(spots: { x: number; y: number }[]): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  s.startCombat(s.univ.party.direction);
  s.univ.curPc = 3;
  const mons = s.univ.town!.monsters.filter((m) => m.isAlive).slice(0, spots.length);
  mons.forEach((m, i) => { m.attitude = 1; m.curLoc = { ...spots[i]! }; });
  return s;
}

function aimFor(s: GameSession, range = 8, chosen: { x: number; y: number }[] = []): Aiming {
  return { from: s.univ.currentPc.combatPos, range, chosen, token: {}, picks: chosen.length };
}

describe('the aim cursor', () => {
  it('starts on the nearest hostile it can reach', () => {
    const s = fight([{ x: 9, y: 9 }, { x: 8, y: 8 }, { x: 9, y: 8 }]);
    expect(s.univ.currentPc.combatPos).toEqual({ x: 7, y: 8 });
    expect(autoAim(s, aimFor(s))).toEqual({ x: 8, y: 8 });
  });

  it("skips squares a multi-target spell has already picked, nearest first", () => {
    const s = fight([{ x: 9, y: 9 }, { x: 8, y: 8 }, { x: 9, y: 8 }]);
    expect(autoAim(s, aimFor(s, 8, [{ x: 8, y: 8 }]))).toEqual({ x: 9, y: 8 });
    expect(autoAim(s, aimFor(s, 8, [{ x: 8, y: 8 }, { x: 9, y: 8 }]))).toEqual({ x: 9, y: 9 });
  });

  it('falls back to the nearest out of reach, then to the caster', () => {
    const s = fight([{ x: 9, y: 9 }]);
    // Range 1: (9,9) is two away, so nothing is in reach — it's still shown.
    const short = aimFor(s, 1);
    expect(canAimAt(s, short, { x: 9, y: 9 })).toBe(false);
    expect(autoAim(s, short)).toEqual({ x: 9, y: 9 });
    // Every hostile picked already: the cursor sits on the caster.
    expect(autoAim(s, aimFor(s, 8, [{ x: 9, y: 9 }]))).toEqual({ x: 7, y: 8 });
  });

  it('ignores monsters that are not hostile', () => {
    const s = fight([{ x: 8, y: 8 }]);
    s.univ.town!.monsters.find((m) => m.curLoc.x === 8 && m.curLoc.y === 8)!.attitude = 0;
    expect(autoAim(s, aimFor(s))).toEqual({ x: 7, y: 8 });
  });

  it('moves a square at a time, and stops at the edge where the view cannot scroll', () => {
    const s = fight([]);
    s.mode = GameMode.TOWN_TARGET;
    const c = { ...s.center };
    expect(moveAim(s, { ...c }, Direction.NE)).toEqual({ x: c.x + 1, y: c.y - 1 });
    const edge = { x: c.x + 4, y: c.y };
    expect(moveAim(s, edge, Direction.E)).toEqual(edge);
    expect(s.center).toEqual(c);
  });

  it('takes the view with it past the edge while a spell or missile is aimed', () => {
    const s = fight([]);
    s.mode = GameMode.SPELL_TARGET;
    const c = { ...s.center };
    // One square past the east edge, and diagonally past the north-east corner.
    expect(moveAim(s, { x: c.x + 4, y: c.y }, Direction.E)).toEqual({ x: c.x + 5, y: c.y });
    expect(s.center).toEqual({ x: c.x + 1, y: c.y });
    expect(moveAim(s, { x: c.x + 5, y: c.y - 4 }, Direction.NE)).toEqual({ x: c.x + 6, y: c.y - 5 });
    expect(s.center).toEqual({ x: c.x + 2, y: c.y - 1 });
  });

  it("stops at the edge of the spell's range", () => {
    const s = fight([]);
    s.mode = GameMode.SPELL_TARGET;
    const from = s.univ.currentPc.combatPos;
    const aim = aimFor(s, 2);
    const edge = { x: from.x + 2, y: from.y };
    expect(moveAim(s, edge, Direction.E, aim)).toEqual(edge);
    // Along the edge is fine where it stays in reach; back in always is.
    expect(moveAim(s, edge, Direction.W, aim)).toEqual({ x: from.x + 1, y: from.y });
    // A cursor that started out of reach may still come closer.
    const far = { x: from.x + 4, y: from.y };
    expect(moveAim(s, far, Direction.W, aim)).toEqual({ x: from.x + 3, y: from.y });
    expect(moveAim(s, far, Direction.E, aim)).toEqual(far);
  });

  it('never draws from the RNG', () => {
    const s = fight([{ x: 9, y: 9 }, { x: 8, y: 8 }]);
    const { gameCalls, gameDraws, uniqueDraws } = s.univ.rng;
    autoAim(s, aimFor(s));
    autoAim(s, aimFor(s, 1));
    canAimAt(s, aimFor(s), { x: 9, y: 9 });
    expect([s.univ.rng.gameCalls, s.univ.rng.gameDraws, s.univ.rng.uniqueDraws])
      .toEqual([gameCalls, gameDraws, uniqueDraws]);
  });
});
