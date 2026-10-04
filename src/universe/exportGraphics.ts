/**
 * `cUniverse::exportGraphics` (universe.cpp:1207) — what `handle_victory`
 * does so that a party's custom-pictured gear survives the trip to the next
 * scenario. Every picture of 1000+ (a cell of *this* scenario's sheets) that a
 * carried item, stored item or PC uses is copied into the party's own sheet,
 * `party.exportSheet`, and renumbered 10000 + its cell there. Pictures already
 * 10000+ were exported by an earlier scenario and keep their cells. The sheet
 * travels in the save as `save/export.png` (fileio_party.cpp:625).
 *
 * The 1997 game had no party sheet and took such items away at the door
 * instead; DIVERGENCES.md #7 records why this port now follows OBoE.
 *
 * Pixels are plain RGBA so this runs headless: the caller hands over the
 * scenario's sheets (`scenarioSheet`), which on the page come out of the
 * `SheetStore` and in tests from the scenario's PNGs.
 */

import { Item, ItemType } from '../data/item';
import type { Rgba } from '../fileio/legacy/bmp';
import { MainStatus } from './skills';
import type { Universe } from './universe';

const CELL_W = 28;
const CELL_H = 36;
const ROW = 10;

/** One of the scenario's custom sheets, `n` being `pic / 100`; null if it has none. */
export type ScenarioSheet = (n: number) => Rgba | null;

/** `cCustomGraphics::count(true)` — how many cells the party sheet holds. */
export function partySheetCells(sheet: Rgba | null): number {
  if (sheet === null) return 0;
  if (sheet.width < CELL_W * ROW) return Math.floor(sheet.width / CELL_W);
  return ROW * Math.floor(sheet.height / CELL_H);
}

/** The top-left of cell `n` on a 10-across sheet (`find_graphic`'s rect). */
function cellAt(n: number): { x: number; y: number } {
  return { x: CELL_W * (n % ROW), y: CELL_H * Math.floor(n / ROW) };
}

/**
 * `cCustomGraphics::copy_graphic` (gfxsheets.cpp:67): `slots` cells from
 * scenario picture `src` on into party cells `dest` on, growing the sheet by
 * whole rows as it needs to — it starts 280×180 (50 cells), transparent.
 * A source cell off the edge of its sheet is the blank graphic (transparent).
 */
function copyGraphic(
  party: Rgba | null, dest: number, src: number, slots: number, scenarioSheet: ScenarioSheet,
): Rgba {
  let sheet = party ?? { width: CELL_W * ROW, height: 180, data: new Uint8ClampedArray(CELL_W * ROW * 180 * 4) };
  const have = partySheetCells(sheet);
  if (have < dest + slots) {
    let addRows = 1;
    while (have + ROW * addRows < dest + slots) addRows++;
    const grown = {
      width: CELL_W * ROW, height: sheet.height + CELL_H * addRows,
      data: new Uint8ClampedArray(CELL_W * ROW * (sheet.height + CELL_H * addRows) * 4),
    };
    // The C++ draws the old sheet into the top-left of the new one.
    const w = Math.min(sheet.width, grown.width);
    for (let y = 0; y < sheet.height; y++) {
      grown.data.set(sheet.data.subarray(y * sheet.width * 4, (y * sheet.width + w) * 4), y * grown.width * 4);
    }
    sheet = grown;
  } else {
    sheet = { ...sheet, data: new Uint8ClampedArray(sheet.data) };
  }
  for (let i = 0; i < slots; i++) {
    const from = scenarioSheet(Math.floor((src + i) / 100));
    const f = cellAt((src + i) % 100);
    const t = cellAt(dest + i);
    const inside = from !== null && f.x + CELL_W <= from.width && f.y + CELL_H <= from.height;
    for (let y = 0; y < CELL_H; y++) {
      const to = ((t.y + y) * sheet.width + t.x) * 4;
      if (inside) {
        const at = ((f.y + y) * from.width + f.x) * 4;
        sheet.data.set(from.data.subarray(at, at + CELL_W * 4), to);
      } else {
        sheet.data.fill(0, to, to + CELL_W * 4);
      }
    }
  }
  return sheet;
}

/** `cUniverse::exportGraphics` — see the file comment. */
export function exportGraphics(univ: Universe, sheetOf: ScenarioSheet): void {
  const { party } = univ;
  const sheets = new Map<number, Rgba | null>();
  const scenarioSheet: ScenarioSheet = (n) => {
    if (!sheets.has(n)) sheets.set(n, sheetOf(n));
    return sheets.get(n) ?? null;
  };
  const used = new Set<number>();
  // Scenario picture (minus 1000) → what needs renumbering once it has a cell.
  const updatePcs = new Map<number, ((pos: number) => void)[]>();
  const updateItems = new Map<number, ((pos: number) => void)[]>();
  const updateMissiles = new Map<number, ((pos: number) => void)[]>();
  const note = (into: Map<number, ((pos: number) => void)[]>, pic: number, set: (pos: number) => void): void => {
    const list = into.get(pic);
    if (list) list.push(set);
    else into.set(pic, [set]);
  };

  // `cUniverse::check_item` (universe.cpp:1098).
  const checkItem = (item: Item): void => {
    if (item.variety === ItemType.NO_ITEM) return;
    if (item.graphicNum >= 10000) used.add(item.graphicNum - 10000);
    else if (item.graphicNum >= 1000) note(updateItems, item.graphicNum - 1000, (pos) => { item.graphicNum = 10000 + pos; });
    // TODO(campaign): a summoning item's monster (`check_monst`) goes with
    // `exportSummons`. Until that is ported, `enterWithParty` takes summoning
    // items away at the door as 1997 did, so their monsters' pictures are moot.
    if (item.variety === ItemType.ARROW || item.variety === ItemType.BOLTS
      || item.variety === ItemType.MISSILE_NO_AMMO || item.variety === ItemType.THROWN_MISSILE) {
      if (item.missile >= 10000) for (let i = 0; i < 4; i++) used.add(item.missile - 10000 + i);
      else if (item.missile >= 1000) note(updateMissiles, item.missile - 1000, (pos) => { item.missile = 10000 + pos; });
    }
  };

  for (const pc of party.pcs) {
    if (pc.mainStatus === MainStatus.ABSENT) continue;
    if (pc.whichGraphic >= 10000) {
      for (let j = 0; j < 4; j++) used.add(pc.whichGraphic - 10000 + j);
    } else if (pc.whichGraphic >= 1000) {
      note(updatePcs, pc.whichGraphic - 1000, (pos) => { pc.whichGraphic = 10000 + pos; });
    }
    for (const item of pc.items) checkItem(item);
  }
  for (const list of party.storedItems.values()) for (const item of list) checkItem(item);
  // The soul crystal's monsters (`check_monst` on `imprisoned_monst`) would go
  // here; `enterScenario` empties the crystal as 1997 did (DIVERGENCES.md #7).

  // `cUniverse::addGraphic` (universe.cpp:1173): the first run of free cells
  // long enough, then copy.
  const addGraphic = (pic: number, slots: number): number => {
    let pos = -1;
    for (;;) {
      while (used.has(++pos));
      let fits = true;
      for (let i = 1; i < slots; i++) if (used.has(pos + i)) fits = false;
      if (fits) break;
    }
    party.exportSheet = copyGraphic(party.exportSheet, pos, pic, slots, scenarioSheet);
    // **Divergence from OBoE (DIVERGENCES.md #48):** the C++ marks
    // `pos + 1 .. pos + slots - 1` used and never `pos` itself, so every
    // one-cell picture lands in the same free cell and the last copied wins —
    // a party's custom items would all wear one picture. This marks `pos` too.
    for (let i = 0; i < slots; i++) used.add(pos + i);
    return pos;
  };

  for (const [pic, sets] of updatePcs) {
    const pos = addGraphic(pic, 4);
    for (const set of sets) set(pos);
  }
  for (const [pic, sets] of updateItems) {
    const pos = addGraphic(pic, 1);
    for (const set of sets) set(pos);
  }
  for (const [pic, sets] of updateMissiles) {
    const pos = addGraphic(pic, 4);
    for (const set of sets) set(pos);
  }
}
