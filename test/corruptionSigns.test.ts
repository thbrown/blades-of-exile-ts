/**
 * `corruptionSigns`, which tags a library scenario that loads but was
 * misread. The originals always; the archive with `LEGACY_ARCHIVE=1`, where
 * Masks v. 1.0.3 must be the one and only scenario it tags.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { corruptionSigns } from '../src/fileio/libraryCatalog';
import { loadLegacyScenario } from '../src/fileio/legacy/loadLegacy';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGINALS = join(ROOT, '../boe-source-1997/Macintosh Code Release 3/Blades of Exile Scenarios');
const ARCHIVE = join(ROOT, 'library/unzipped');

function exsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...exsFiles(full));
    else if (/\.exs$/i.test(name)) out.push(full);
  }
  return out;
}

/** The files that load at all; the rest never reach the library. */
function signs(file: string): string | null | undefined {
  try {
    return corruptionSigns(loadLegacyScenario(readFileSync(file), 'test').scenario);
  } catch {
    return undefined;
  }
}

describe('corruptionSigns', () => {
  it('passes a sound scenario and fails one with garbage names', () => {
    const named = (name: string): { name: string } => ({ name });
    const sound = {
      terTypes: Array.from({ length: 20 }, () => named('Cave Floor')),
      scenMonsters: Array.from({ length: 30 }, () => named('Goblin')),
    };
    expect(corruptionSigns(sound as never)).toBeNull();
    const garbage = {
      terTypes: sound.terTypes.map((t, i) => (i % 2 ? named('ˇˇˇ') : t)),
      scenMonsters: sound.scenMonsters.map(() => named('')),
    };
    expect(corruptionSigns(garbage as never)).toMatch(/10 of the first 20 terrain.*29 of the first 29 monster/);
  });

  const originals = exsFiles(ORIGINALS);
  it.skipIf(originals.length === 0).each(originals)('passes original %s', (file) => {
    expect(signs(file)).toBeNull();
  });

  const archive = process.env['LEGACY_ARCHIVE'] ? exsFiles(ARCHIVE) : [];
  it.skipIf(archive.length === 0)('tags only Masks in the archive', () => {
    const tagged = archive.filter((f) => typeof signs(f) === 'string').map((f) => f.split('/').pop());
    expect(tagged).toEqual(['masks.exs']);
  });
});
