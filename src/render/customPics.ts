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
import { SheetStore, calcRect } from './sheets';

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
    if (pic >= 2000) max = Math.max(max, pic - 2000 + 3);
    else if (pic >= 1000) max = Math.max(max, pic - 1000 + span - 1);
  };
  for (const ter of scen.terTypes) note(ter.picture);
  // A monster uses its width × height cells, twice over for its two facings
  // and twice again for the attack pose.
  for (const mon of scen.scenMonsters) note(mon.pictureNum, 4 * mon.xWidth * mon.yWidth);
  for (const item of scen.scenItems) note(item.graphicNum);
  return max < 0 ? 0 : Math.floor(max / 100) + 1;
}

/**
 * Load a scenario's sheets into the store and install their sizes. A sheet
 * that fails to load leaves the ones before it; a scenario with none clears
 * the registry, so one scenario's pictures never show in the next.
 */
export async function loadCustomSheets(
  store: SheetStore, scen: Scenario, baseUrl: string,
): Promise<void> {
  const count = customSheetCount(scen);
  const sizes: { w: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const img = await store.load(customSheetName(i), baseUrl, `sheet${i}`);
      sizes.push({ w: img.width, h: img.height });
    } catch {
      break;
    }
  }
  setCustomSheets(sizes);
}
