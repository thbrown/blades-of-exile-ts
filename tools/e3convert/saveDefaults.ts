/**
 * EXILE3.EXE's tables a saved game needs (`src/fileio/e3SaveDefaults.ts`),
 * copied out of the EXE. The converter writes them as `e3save.json`.
 */

import type { E3SaveDefaults } from '../../src/fileio/e3SaveDefaults';
import { E3_TABLE_ITEM_SIZE } from '../../src/fileio/e3SaveDefaults';
import { neAutoDataSegment, readNeResources, readNeSegment, readStringTable } from './ne';
import { E3_ITEM_COUNT } from './tables';
import { readE3Outdoors, type E3OutWandering } from './outdoor';

/** The monsters' parallel arrays (`FUN_1090_0000` reads up to +0x1518 + 200). */
const MONSTER_TABLE_SIZE = 0x15e0;

/**
 * A zone group as E3 holds it in memory once the zone loader has swapped its
 * words (`out_c`'s `what_monst`): `monst[7]`, `friendly[3]`, the script at
 * +10, the two bytes at +12, the five words from +14, little-endian.
 */
function groupBytes(g: E3OutWandering): Uint8Array {
  const b = new Uint8Array(24);
  const v = new DataView(b.buffer);
  b.set(g.monst.slice(0, 7), 0);
  b.set(g.friendly.slice(0, 3), 7);
  v.setInt16(10, g.words[0] ?? 0, true);
  b.set(g.gap.slice(0, 2), 12);
  for (let k = 1; k < 6; k++) v.setInt16(12 + 2 * k, g.words[k] ?? 0, true);
  return b;
}

export function readE3SaveDefaults(exe: Uint8Array, townDat?: Uint8Array, outdoorDat?: Uint8Array): E3SaveDefaults {
  const strings = new Map([...readStringTable(readNeResources(exe))].sort((x, y) => x[0] - y[0]));
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const slice = (at: number, n: number) => ds.slice(at, at + n);
  return {
    itemTable: readNeSegment(exe, 38).slice(0, E3_ITEM_COUNT * E3_TABLE_ITEM_SIZE),
    boats: slice(0x2be0, 300),
    horses: slice(0x2d0c, 300),
    canFind: slice(0x29b2, 120),
    // A new PC's priest spells then its mage spells: `FUN_10b0_0c2d` copies
    // 0x296c into the lower of its two stack arrays, and a PC's priest
    // spells come first. A new game's save (2026-10-01) confirms it.
    priestSpells: slice(0x296c, 30),
    mageSpells: slice(0x294e, 30),
    ...(townDat ? { townDat } : {}),
    monsterTable: readNeSegment(exe, 39).slice(0, MONSTER_TABLE_SIZE),
    strings,
    ...(outdoorDat ? {
      zoneGroups: Uint8Array.from(readE3Outdoors(outdoorDat).flatMap((z) => [...z.wandering, ...z.specialEnc].flatMap((g) => [...groupBytes(g)]))),
    } : {}),
  };
}
