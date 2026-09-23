/** `text_bar_text`'s right-hand half — the recast hint. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { drawTerrain } from '../src/game/textBar';
import { PartyPreset } from '../src/universe/player';
import { Skill } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);
let scen: Scenario;
beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
});

function inCombat(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  s.startCombat(s.univ.party.direction);
  s.univ.curPc = 3;
  return s;
}

describe('the recast hint', () => {
  it('is empty for someone who has never cast, and outside combat', () => {
    const s = inCombat();
    drawTerrain(s);
    expect(s.recastHint).toBe('');
    s.endCombat();
    drawTerrain(s);
    expect(s.recastHint).toBe('');
  });

  it('names the last spell of the last kind cast, or says why not', () => {
    const s = inCombat();
    const pc = s.univ.currentPc;
    pc.lastCastType = Skill.MAGE_SPELLS;
    drawTerrain(s);
    expect(s.recastHint).toBe('M: No spell to recast');
    pc.lastCast[Skill.MAGE_SPELLS] = Spell.LIGHT;
    pc.curSp = 10;
    drawTerrain(s);
    expect(s.recastHint).toMatch(/^M: Recast /);
    pc.curSp = 0;
    drawTerrain(s);
    expect(s.recastHint).toBe('M: Cannot recast');
  });
});
