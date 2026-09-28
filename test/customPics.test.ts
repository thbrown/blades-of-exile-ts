/**
 * A scenario's own graphics — `cCustomGraphics::find_graphic` and the
 * places that turn a picture number of 1000 or more into one of its cells.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  customGraphic, customSheetCount, customSheetName, setCustomSheets,
} from '../src/render/customPics';
import { itemGraphic } from '../src/render/itemPics';
import { monsterGraphic } from '../src/render/monsterPics';
import { pcGraphic } from '../src/render/pcPics';
import { terrainGraphic } from '../src/render/terrainPics';
import { Direction } from '../src/core/location';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

afterEach(() => setCustomSheets([]));

describe('find_graphic', () => {
  it('is sheet n / 100, cell n % 100, ten 28x36 cells to a row', () => {
    setCustomSheets([{ w: 280, h: 360 }, { w: 280, h: 360 }]);
    const g = customGraphic(113)!;
    expect(g.sheetName).toBe(customSheetName(1));
    expect([g.rect.left, g.rect.top]).toEqual([3 * 28, 1 * 36]);
  });

  it('draws blank past the last sheet, past the edge of one, and for the party', () => {
    setCustomSheets([{ w: 280, h: 72 }]);
    expect(customGraphic(100)).toBeNull();
    expect(customGraphic(25)).toBeNull(); // row 2 of a two-row sheet
    expect(customGraphic(19)).not.toBeNull();
    expect(customGraphic(0, true)).toBeNull();
  });
});

describe('the lookups that use it', () => {
  it('terrain: 1000 up is a cell, 2000 up animates over four', () => {
    setCustomSheets([{ w: 280, h: 360 }]);
    expect(terrainGraphic(1006)?.rect.left).toBe(6 * 28);
    expect(terrainGraphic(2000, 5)?.rect.left).toBe(1 * 28);
  });

  it('items are the whole cell, with no tiny-icon inset', () => {
    setCustomSheets([{ w: 280, h: 360 }]);
    expect(itemGraphic(1012)).toMatchObject({ sheetName: customSheetName(0), inset: { x: 0, y: 0 } });
  });

  it('a monster runs part, then facing, then attack pose', () => {
    setCustomSheets([{ w: 280, h: 360 }]);
    // A 2x1 monster at 1010: parts 10,11; facing right 12,13; posing +4.
    expect(monsterGraphic(1010, 0, 1, 2)?.rect.left).toBe(1 * 28);
    expect(monsterGraphic(1010, 1, 0, 2)?.rect.left).toBe(2 * 28);
    expect(monsterGraphic(1010, 11, 1, 2)?.rect.left).toBe(7 * 28);
  });

  it('a PC picture of 1000 up is a scenario cell, 10000 up the party sheet', () => {
    setCustomSheets([{ w: 280, h: 360 }]);
    expect(pcGraphic(1003, Direction.N)?.rect.left).toBe(3 * 28);
    expect(pcGraphic(10003, Direction.N)).toBeNull();
  });
});

describe('how many sheets a scenario needs', () => {
  it('is worked out from the pictures it uses', async () => {
    const scen = await loadScenario(
      new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
      opcodes,
    );
    // Terrain up to 1007 and a portcullis animating from 2000: one sheet.
    expect(customSheetCount(scen)).toBe(1);
    scen.terTypes[0]!.picture = 1250;
    expect(customSheetCount(scen)).toBe(3);
    // An item's 2000 is not an animation: 2126 is cell 26 of sheet 11.
    scen.terTypes[0]!.picture = 0;
    scen.scenItems[0]!.graphicNum = 2126;
    expect(customSheetCount(scen)).toBe(12);
  });
});
