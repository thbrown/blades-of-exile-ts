/** `do_look` (boe.text.cpp:695) — what a look lists on a square. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
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

describe('looking at a square', () => {
  it('names its fields and decals, in the C++ order', () => {
    const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    s.startNewGame();
    const at = { ...s.univ.party.townLoc };
    const town = s.univ.town!;
    town.setField(at.x, at.y, FieldType.SFX_ASH, true);
    town.setField(at.x, at.y, FieldType.FIELD_WEB, true);
    const before = s.univ.transcript.length;
    s.lookAt(at);
    const said = s.univ.transcript.slice(before);
    expect(said).toContain('    Your party');
    expect(said.indexOf('    Web')).toBeGreaterThan(-1);
    expect(said.indexOf('    Ashes')).toBeGreaterThan(said.indexOf('    Web'));
  });
});
