import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../src/fileio/loadScenario';
import { PackedSource, scenarioIdFromFileName } from '../src/fileio/packedSource';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { TarEntry, writeTar } from '../src/fileio/tarball';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

const scenarioDir = (id: string): string =>
  fileURLToPath(new URL(`../public/scenarios/${id}`, import.meta.url));

/** Pack an unpacked scenario tree the way the desktop build does: `scenario/<relpath>`, gzipped. */
function pack(dir: string): Uint8Array {
  const entries: TarEntry[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push({ name: `scenario/${relative(dir, full)}`, data: readFileSync(full) });
    }
  };
  walk(dir);
  return gzipSync(writeTar(entries));
}

describe('PackedSource', () => {
  it('loads a packed scenario exactly as the unpacked tree loads', async () => {
    const dir = scenarioDir('valleydy');
    const fromDir = await loadScenario(new FsSource(dir), opcodes);
    const fromPack = await loadScenario(new PackedSource('valleydy', pack(dir)), opcodes);
    expect(fromPack).toEqual(fromDir);
  });

  it('serves the custom graphics sheets as bytes', async () => {
    const dir = scenarioDir('valleydy');
    const src = new PackedSource('valleydy', pack(dir));
    const png = await src.getBinary('graphics/sheet0.png');
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    await expect(src.getBinary('graphics/sheet99.png')).rejects.toThrow(/no graphics\/sheet99.png/);
  });

  it.each(['big-creatures', 'ranged-out-of-sight'])(
    'opens %s.boes, a package written by Open Blades of Exile',
    async (name) => {
      const data = readFileSync(new URL(`fixtures/boes/${name}.boes`, import.meta.url));
      const scen = await loadScenario(new PackedSource(name, data), opcodes);
      expect(scen.id).toBe(name);
      expect(scen.numTowns).toBe(1);
      expect(scen.towns).toHaveLength(1);
      expect(scen.outdoors.flat()).toHaveLength(1);
    },
  );

  it('refuses something that is not a scenario', () => {
    const notScen = gzipSync(writeTar([{ name: 'save/party.txt', data: new Uint8Array(4) }]));
    expect(() => new PackedSource('x', notScen)).toThrow(/not a Blades of Exile scenario/);
  });
});

describe('scenarioIdFromFileName', () => {
  it.each([
    ['valleydy.boes', 'valleydy'],
    ['Valley Of Dying Things.boes', 'valley-of-dying-things'],
    ['3AdvClub.EXS', '3advclub'],
    ['  !!.boes', 'scenario'],
  ])('%s → %s', (file, id) => {
    expect(scenarioIdFromFileName(file)).toBe(id);
  });
});
