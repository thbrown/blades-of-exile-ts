/**
 * Every scenario in the community archive, played a little: load it, start a
 * new game, walk around the start town, then enter every other town. This
 * port's engine was built against four scenarios; the archive's 168 use
 * corners of it those four never did, and a throw here names one.
 *
 * Needs `scripts/fetch-archive.mjs` to have filled `library/`, and runs only
 * with `LEGACY_ARCHIVE=1`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { identifyScenarioFiles, loadScenarioPackage } from '../src/fileio/scenarioPackage';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const ARCHIVE = fileURLToPath(new URL('../library/unzipped', import.meta.url));
const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

function scenarioDirs(): string[] {
  if (!process.env['LEGACY_ARCHIVE'] || !existsSync(ARCHIVE)) return [];
  return readdirSync(ARCHIVE).filter((d) => statSync(join(ARCHIVE, d)).isDirectory()).sort();
}

function filesIn(dir: string): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else out.push({ name: relative(ARCHIVE, full), data: readFileSync(full) });
  }
  return out;
}

const dirs = scenarioDirs();

describe.skipIf(dirs.length === 0)('community archive smoke test', () => {
  it.each(dirs)('%s', async (dir) => {
    const packages = identifyScenarioFiles(filesIn(join(ARCHIVE, dir)));
    for (const pkg of packages) {
      const { scenario } = await loadScenarioPackage(pkg, opcodes);
      const session = new GameSession(new Universe(scenario, new GameRng(), PartyPreset.DEFAULT));
      session.startNewGame();
      // A few steps in each direction from where the game starts.
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1]] as const) {
        const at = session.univ.party.townLoc;
        await session.moveTo({ x: at.x + dx, y: at.y + dy });
      }
      for (let t = 0; t < scenario.towns.length; t++) {
        session.startTownMode(t, FORCED_ENTRY, true);
        expect(session.univ.town?.record).toBe(scenario.towns[t]);
      }
    }
  });
});
