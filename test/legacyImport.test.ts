/**
 * The legacy `.exs` import, held against the C++ loading the same file.
 *
 * `tools/cppharness/dump-scen.sh` prints what OBoE builds from a scenario
 * (`load_scenario_v1`), and `scenarioDump` reshapes this port's import to the
 * same JSON. They must match field for field.
 *
 * The files come from outside the repo — the 1997 originals in
 * `../boe-source-1997`, and the community archive `scripts/fetch-archive.mjs`
 * downloads into `library/` — and the oracle needs the harness built, so each
 * case skips when its piece is missing. The archive is a few minutes on a cold
 * cache, so it only runs with `LEGACY_ARCHIVE=1`; the C++'s dumps are cached in
 * `tools/cppharness/scendumps/`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLegacyScenario } from '../src/fileio/legacy/loadLegacy';
import { deepDiff } from './support/deepDiff';
import { scenarioDump } from './support/scenarioDump';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HARNESS = join(ROOT, 'tools/cppharness');
const BIN = join(HARNESS, 'build/boe-native');
const CACHE = join(HARNESS, 'scendumps');
const ORIGINALS = join(ROOT, '../boe-source-1997/Macintosh Code Release 3/Blades of Exile Scenarios');
const ARCHIVE = join(ROOT, 'library/unzipped');

function findExs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '__MACOSX') continue;
    if (statSync(full).isDirectory()) out.push(...findExs(full));
    else if (/\.exs$/i.test(name)) out.push(full);
  }
  return out.sort();
}

/** The C++'s dump of a file, or null if the C++ can't load it. */
function cppDump(file: string): unknown {
  mkdirSync(CACHE, { recursive: true });
  const key = relative(join(ROOT, '..'), file).replace(/[^A-Za-z0-9._-]+/g, '_');
  const cached = join(CACHE, `${key}.json`);
  if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(BIN).mtimeMs) {
    let text: string;
    try {
      text = execFileSync(join(HARNESS, 'dump-scen.sh'), [file], {
        encoding: 'latin1', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      text = '';
    }
    const at = text.indexOf('@@SCENDUMP@@\n');
    writeFileSync(cached, at < 0 ? 'null' : text.slice(at + 13), 'latin1');
  }
  return JSON.parse(readFileSync(cached, 'latin1')) as unknown;
}

/**
 * `cTown::import_legacy` converts each preset field into a `cField temp`
 * that is never initialised, so a field of a type the old game didn't have
 * keeps whatever that stack slot held — 32 in this build, possibly the last
 * field's type in another. Nothing places such a field either way
 * (`place_preset_fields` ignores it), so every type it ignores compares equal.
 */
const PLACEABLE_FIELDS = new Set([8, 9, 25, 10, 11, 12, 13, 14, 24, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

function ignoreUnplaceableFields(dump: unknown): void {
  for (const town of (dump as { towns: { presetFields: { type: number }[] }[] }).towns) {
    for (const f of town.presetFields) if (!PLACEABLE_FIELDS.has(f.type)) f.type = -1;
  }
}

/**
 * `cShop(eShopPreset)` (shop.cpp:61) never sets `cost_adj`, so the five junk
 * shops and the healer carry stack garbage there in the C++. This port gives
 * them 0, the normal price, which is what an XML scenario's shop gets.
 */
function ignorePresetShopCost(dump: unknown): void {
  const shops = (dump as { shops: { costAdj: number }[] }).shops;
  for (let i = 0; i < 6 && i < shops.length; i++) shops[i]!.costAdj = 0;
}

/**
 * Differences that are uninitialised memory on the C++ side, by file. Shadow's
 * size table runs past the end of the file, so its last town's first strings
 * are read from nothing: `fread` copies no bytes and the C++ keeps whatever
 * its `temp_str` held before the first read. This port reads them as empty.
 */
const UNINITIALISED: Record<string, string[]> = {
  'Shadow.exs': ['.towns[70].name:', '.towns[70].areaDesc[0].descr:'],
};

function compare(file: string): void {
  const expected = cppDump(file);
  const data = readFileSync(file);
  if (expected === null) {
    // What the C++ can't load, this port doesn't claim to either.
    expect(() => loadLegacyScenario(data, 'x')).toThrow();
    return;
  }
  const { scenario } = loadLegacyScenario(data, basename(file), { charset: 'latin1' });
  const actual = scenarioDump(scenario);
  ignoreUnplaceableFields(actual);
  ignoreUnplaceableFields(expected);
  ignorePresetShopCost(expected);
  const known = UNINITIALISED[basename(file)] ?? [];
  const diffs = deepDiff(actual, expected, '', [], 1000)
    .filter((d) => !known.some((k) => d.startsWith(k)))
    .slice(0, 40);
  expect(diffs).toEqual([]);
}

const haveHarness = existsSync(BIN);
const originals = findExs(ORIGINALS);

describe.skipIf(!haveHarness || originals.length === 0)('legacy .exs import vs the C++ (1997 originals)', () => {
  it.each(originals.map((f) => [basename(f), f]))('%s', (_name, file) => { compare(file); });
});

const archive = process.env['LEGACY_ARCHIVE'] ? findExs(ARCHIVE) : [];

describe.skipIf(!haveHarness || archive.length === 0)('legacy .exs import vs the C++ (community archive)', () => {
  it.each(archive.map((f) => [relative(ARCHIVE, f), f]))('%s', (_name, file) => { compare(file); });
});
