/**
 * The Exile 3 readers (`tools/e3convert`), held against facts about the
 * shipped game files that were pinned by hand from the data and EXILE3.EXE's
 * own loaders (tools/e3convert/FORMATS.md).
 *
 * The files come from the committed installer (`vendor/exile3/`), unpacked on
 * first use; every case skips only if that is missing (`findE3Dir`).
 */

import { describe, expect, it } from 'vitest';
import { findE3Dir, readE3Files, type E3Files } from '../tools/e3convert/install';
import { readDialogs, readNeResources, readSounds, readStringTable } from '../tools/e3convert/ne';
import { readE3Outdoors } from '../tools/e3convert/outdoor';
import { E3_TOWN_COUNT, e3TownOffset, readE3Towns } from '../tools/e3convert/town';

const dir = findE3Dir();
const files: E3Files | null = dir ? readE3Files(dir) : null;

describe.skipIf(!files)('Exile 3 files', () => {
  const f = files as E3Files;

  describe('EXILE3.EXE resources', () => {
    const res = readNeResources(f.exe);

    it('has 12,472 strings, numbered in runs of 300', () => {
      const s = readStringTable(res);
      expect(s.size).toBe(12472);
      const ids = [...s.keys()];
      expect(Math.min(...ids)).toBe(301);
      expect(Math.max(...ids)).toBe(47697);
    });

    it('keeps each encounter as a dialog, text and button tags together', () => {
      const d = readDialogs(res);
      expect(d.size).toBe(624);
      const vilovsky = d.get(5051);
      expect(vilovsky?.controls.map((c) => c.text).slice(0, 3)).toEqual(['1_65', '0_64', '5_422']);
      expect(vilovsky?.controls[3]?.text).toMatch(/^An effusively friendly priest .* _I am Vilovsky!/);
    });

    it('has 100 sounds, each a whole RIFF WAVE file', () => {
      const s = readSounds(res);
      expect(s.size).toBe(100);
      for (const wav of s.values()) {
        expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12))).toBe('RIFFWAVE');
      }
    });
  });

  describe('OUTDOOR.DAT', () => {
    const zones = readE3Outdoors(f.outdoor);

    it('names its zones and areas inline', () => {
      expect(zones[0]?.name).toBe('Northwestern Valorim');
      expect(zones[0]?.areaNames.slice(0, 2)).toEqual(['Remote Swamp', 'By Quarantine Wall']);
      expect(zones[40]?.name).toBe('Central Valorim');
    });

    it('has specials, exits and wandering groups where BoE has them', () => {
      const z1 = zones[1];
      expect(z1?.specialId.slice(0, 11)).toEqual([1, 2, 2, 2, 4, 4, 4, 3, 3, 3, 0]);
      expect(z1?.exitLocs.slice(0, 3)).toEqual([{ x: 8, y: 13 }, { x: 32, y: 31 }, { x: 36, y: 29 }]);
      expect(z1?.exitDests.slice(0, 4)).toEqual([62, 63, 63, 0]);
      // A group from Valorim's centre, big-endian words and all.
      expect(zones[49]?.wandering[1]).toEqual({
        monst: [0, 0, 45, 155, 0, 0, 0], friendly: [0, 0, 0],
        words: [0, 307, 8, 0, 0, 0], gap: [1, 0],
      });
    });
  });

  describe('TOWN.DAT', () => {
    const towns = readE3Towns(f.town);

    it('is 200 records whose sizes add up to the file', () => {
      expect(e3TownOffset(E3_TOWN_COUNT)).toBe(f.town.length);
      expect(towns.map((t) => t.kind).filter((k) => k === 'village')).toHaveLength(80);
    });

    it('reads a large town: rooms, preset items and people', () => {
      const t = towns[0];
      expect(t?.roomNames.slice(0, 3)).toEqual(['The Rowdy Oar', 'Small Shrine', "Herron's Herring"]);
      expect(t?.inTownRect).toEqual({ top: 3, left: 3, bottom: 60, right: 60 });
      expect(t?.presetItems[0]).toEqual({
        loc: { x: 6, y: 19 }, itemCode: 9, ability: -1,
        charges: 0, alwaysThere: 1, property: 0, contained: 0,
      });
      expect(t?.startLocs).toEqual([{ x: 32, y: 4 }, { x: 59, y: 32 }, { x: 14, y: 59 }, { x: 4, y: 32 }]);
      // Named NPCs each have their own personality; the guards share one.
      const guards = t?.creatures.filter((c) => c.number === 12) ?? [];
      expect(new Set(guards.map((c) => c.personality))).toEqual(new Set([7]));
    });

    it('keeps a changed town as a second record with the same map', () => {
      expect(towns[1]?.roomNames[9]).toBe('Ruined Shipyard');
      expect(towns[0]?.roomNames[9]).toBe('Small Shipyard');
    });

    it('reads medium and small towns with their own room and creature counts', () => {
      expect(towns[45]?.roomNames[0]).toBe('Trash Pit');
      expect(towns[45]?.terrain).toHaveLength(48);
      expect(towns[45]?.lighting).toBe(1);
      expect(towns[80]?.terrain).toHaveLength(32);
      expect(towns[80]?.creatures).toHaveLength(30);
    });
  });
});

/**
 * The installer unpacker (`installer.ts`): Setup Factory 4 with PKWARE DCL
 * streams. Every one of the 50 files comes out, and the ones the converter
 * reads have the sizes the game's own loaders assume.
 */
describe("Exile III's installer", () => {
  it('unpacks all 50 files', async () => {
    const { readFileSync } = await import('node:fs');
    const { E3_INSTALLER, unpackE3Installer } = await import('../tools/e3convert/installer');
    const files = unpackE3Installer(new Uint8Array(readFileSync(E3_INSTALLER)));
    expect(files.size).toBe(50);
    expect(files.get('EXILE3.EXE')?.length).toBe(3972608);
    expect(files.get('TOWN.DAT')?.length).toBe(709200);
    expect(files.get('OUTDOOR.DAT')?.length).toBe(289800);
    expect(new TextDecoder().decode(files.get('GAMEINFO.TXT'))).toContain('All copies must');
  });
});
