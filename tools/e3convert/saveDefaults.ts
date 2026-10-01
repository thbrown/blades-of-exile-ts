/**
 * EXILE3.EXE's tables a saved game needs (`src/fileio/e3SaveDefaults.ts`),
 * copied out of the EXE. The converter writes them as `e3save.json`.
 */

import type { E3SaveDefaults } from '../../src/fileio/e3SaveDefaults';
import { E3_TABLE_ITEM_SIZE } from '../../src/fileio/e3SaveDefaults';
import { neAutoDataSegment, readNeSegment } from './ne';
import { E3_ITEM_COUNT } from './tables';

export function readE3SaveDefaults(exe: Uint8Array): E3SaveDefaults {
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
  };
}
