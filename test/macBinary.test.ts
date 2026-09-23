/**
 * MacBinary-wrapped files in a scenario package. Echoes: Pawns ships its
 * custom graphics as a wrapped `.bmp`, which used to be passed over, so every
 * custom terrain in it drew as a blank square.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { identifyScenarioFiles, loadScenarioPackage, macBinaryDataFork } from '../src/fileio/scenarioPackage';
import { buildOpcodeTable } from '../src/fileio/specialParse';

/** A MacBinary header around `fork`, named `name`, with a resource fork after it. */
function wrap(name: string, fork: Uint8Array, resource = 20): Uint8Array {
  const out = new Uint8Array(128 + fork.length + resource);
  out[1] = name.length;
  for (let i = 0; i < name.length; i++) out[2 + i] = name.charCodeAt(i);
  new DataView(out.buffer).setUint32(83, fork.length);
  out.set(fork, 128);
  return out;
}

describe('macBinaryDataFork', () => {
  it('returns the data fork of a wrapped file', () => {
    const fork = new Uint8Array([0x42, 0x4d, 1, 2, 3]);
    expect([...macBinaryDataFork(wrap('pic.bmp', fork))!]).toEqual([...fork]);
  });

  it('leaves plain files alone', () => {
    const bmp = new Uint8Array(200);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    expect(macBinaryDataFork(bmp)).toBeNull();
    // A resource-fork-only file (the archive's `.meg`s) has nothing to unwrap.
    expect(macBinaryDataFork(wrap('x.meg', new Uint8Array(0), 300))).toBeNull();
  });

  it('refuses a data fork longer than the file', () => {
    const bad = wrap('pic.bmp', new Uint8Array(10));
    new DataView(bad.buffer).setUint32(83, 10_000);
    expect(macBinaryDataFork(bad)).toBeNull();
  });
});

const PAWNS = fileURLToPath(new URL('../library/unzipped/amovie', import.meta.url));
describe.skipIf(!existsSync(PAWNS))('Echoes: Pawns', () => {
  it('loads its wrapped custom graphics', async () => {
    const files = ['amovie.exs', 'amovie.bmp'].map((name) => ({ name, data: readFileSync(`${PAWNS}/${name}`) }));
    const [pkg] = identifyScenarioFiles(files);
    expect(pkg?.graphics).toBeDefined();
    const opcodes = buildOpcodeTable(
      readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
    );
    const loaded = await loadScenarioPackage(pkg!, opcodes);
    expect(loaded.sheets.length).toBeGreaterThan(0);
    expect(loaded.warnings.filter((w) => w.includes('custom graphics'))).toEqual([]);
  });
});
