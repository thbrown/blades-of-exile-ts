/**
 * A scenario's own graphics — `cCustomGraphics` (gfx/gfxsheets.cpp), the
 * `spec_scen_g` every drawing routine consults for a picture number of 1000
 * or more.
 *
 * `find_graphic(n)` is sheet `n / 100`, cell `n % 100`, ten 28×36 cells to a
 * row. A number past the last sheet, or a cell the sheet isn't big enough to
 * hold, draws the blank graphic — here, nothing (`null`). The party's own
 * sheet (pictures of 10000 and up, carried between scenarios) is campaign
 * state this port doesn't keep, so those are blank too.
 *
 * Like the other render lookups this is module state, set once when a
 * scenario loads: every caller is a synchronous draw with no session to hand.
 */

import { Rect } from '../core/location';
import { Scenario } from '../data/scenario';
import { ScenarioSource } from '../fileio/source';
import { SheetStore, calcRect } from './sheets';
import { Rgba } from '../fileio/legacy/bmp';

export interface CustomGraphic {
  sheetName: string;
  rect: Rect;
}

/** The store key for custom sheet `i` — kept apart from the game's own sheets. */
export function customSheetName(i: number): string {
  return `scen-sheet${i}`;
}

let sheetSizes: { w: number; h: number }[] = [];

/** Install the loaded sheets' sizes. An empty list means no custom graphics. */
export function setCustomSheets(sizes: { w: number; h: number }[]): void {
  sheetSizes = sizes;
}

/** `cCustomGraphics::find_graphic(which, party)`. */
export function customGraphic(which: number, party = false): CustomGraphic | null {
  if (party || which < 0) return null;
  const sheet = Math.floor(which / 100);
  const size = sheetSizes[sheet];
  if (!size) return null;
  const cell = which % 100;
  const rect = calcRect(cell % 10, Math.floor(cell / 10));
  // `if((store_rect & test) != store_rect) goto INVALID` — a cell the sheet
  // doesn't reach draws blank.
  if (rect.right > size.w || rect.bottom > size.h) return null;
  return { sheetName: customSheetName(sheet), rect };
}

/**
 * How many `graphics/sheetN.png` a scenario needs. The C++ counts the files in
 * the scenario's package; the web copy is unpacked and can't be listed, and
 * probing for a sheet that isn't there is a failed request the console
 * reports. So the count comes from the data instead: the highest custom
 * picture any terrain, monster or item uses. Animated terrain (2000+) uses
 * four cells from its base.
 */
export function customSheetCount(scen: Scenario): number {
  let max = -1;
  const note = (pic: number, span = 1): void => {
    if (pic >= 10000) return;
    if (pic >= 1000) max = Math.max(max, pic - 1000 + span - 1);
  };
  // Only a *terrain* of 2000 and up is animated (four cells from pic − 2000).
  // Anything else of 2000 and up is plain custom picture pic − 1000 on a
  // later sheet: Exile III's items are 2100–2199, sheet 11. Reading those as
  // animations under-counted E3's sheets, sheet 11 never loaded, and every
  // item drew blank.
  for (const ter of scen.terTypes) {
    if (ter.picture >= 2000 && ter.picture < 10000) max = Math.max(max, ter.picture - 2000 + 3);
    else note(ter.picture);
  }
  // A monster uses its width × height cells, twice over for its two facings
  // and twice again for the attack pose, from `pic % 1000` (`monsterGraphic`).
  for (const mon of scen.scenMonsters) {
    const pic = mon.pictureNum;
    if (pic >= 1000 && pic < 10000) note(1000 + (pic % 1000), 4 * mon.xWidth * mon.yWidth);
  }
  for (const item of scen.scenItems) note(item.graphicNum);
  return max < 0 ? 0 : Math.floor(max / 100) + 1;
}

/**
 * Load a scenario's sheets into the store and install their sizes. A sheet
 * that fails to load leaves the ones before it; a scenario with none clears
 * the registry, so one scenario's pictures never show in the next.
 */
export async function loadCustomSheets(
  store: SheetStore, scen: Scenario, src: ScenarioSource,
): Promise<void> {
  const count = customSheetCount(scen);
  const sizes: { w: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const img = await store.loadBytes(customSheetName(i), await src.getBinary(`graphics/sheet${i}.png`));
      sizes.push({ w: img.width, h: img.height });
    } catch {
      break;
    }
  }
  setCustomSheets(sizes);
}

/**
 * Install sheets a package brought with it: PNG bytes from a `.boes`, or the
 * pixels cut from a legacy `.bmp` (`legacySheets`). Same registry as
 * `loadCustomSheets`, so a scenario with none clears the last one's.
 */
export async function installCustomSheets(
  store: SheetStore, sheets: { png?: Uint8Array; rgba?: Rgba }[],
): Promise<void> {
  const sizes: { w: number; h: number }[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    try {
      const img = sheet.png
        ? await store.loadBytes(customSheetName(i), sheet.png)
        : store.put(customSheetName(i), await createImageBitmap(
          new ImageData(sheet.rgba!.data as Uint8ClampedArray<ArrayBuffer>, sheet.rgba!.width, sheet.rgba!.height)));
      sizes.push({ w: img.width, h: img.height });
    } catch {
      break;
    }
  }
  setCustomSheets(sizes);
}
