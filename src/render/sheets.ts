/**
 * Graphics-sheet tile indexing.
 * Ported from ../exile-wasm/src/gfx/gfxsheets.cpp: tiles are 28×36 px in
 * 10-per-row grids, 100 per sheet; pic number N lives on sheet N/100 at
 * cell N%100.
 */

import { Rect } from '../core/location';

export const TILE_W = 28;
export const TILE_H = 36;
export const TILES_PER_ROW = 10;
export const TILES_PER_SHEET = 100;

export interface SheetPos {
  sheet: number;
  rect: Rect;
}

/** Source rect for cell (col i, row j) within a sheet — calc_rect(i, j). */
export function calcRect(i: number, j: number): Rect {
  const left = i * TILE_W;
  const top = j * TILE_H;
  return new Rect(top, left, top + TILE_H, left + TILE_W);
}

/** Sheet index + source rect for a pic number — find_graphic(). */
export function findGraphic(pic: number): SheetPos {
  const sheet = Math.floor(pic / TILES_PER_SHEET);
  const cell = pic % TILES_PER_SHEET;
  return { sheet, rect: calcRect(cell % TILES_PER_ROW, Math.floor(cell / TILES_PER_ROW)) };
}

/** Cache of decoded sheet images keyed by resource name (e.g. "ter1"). */
export class SheetStore {
  private images = new Map<string, ImageBitmap>();

  /**
   * Load `<baseUrl><file>.png` and keep it as `name`. `file` defaults to the
   * name; a scenario's own `sheet0` is kept under a name of its own so it can
   * never be mistaken for one of the game's sheets.
   */
  async load(
    name: string, baseUrl = `${import.meta.env.BASE_URL}data/graphics/`, file = name,
  ): Promise<ImageBitmap> {
    const existing = this.images.get(name);
    if (existing) return existing;
    const resp = await fetch(`${baseUrl}${file}.png`);
    if (!resp.ok) throw new Error(`failed to load sheet ${name}: ${resp.status}`);
    const bmp = await createImageBitmap(await resp.blob());
    this.images.set(name, bmp);
    return bmp;
  }

  /** Keep already-fetched PNG bytes as `name` — a packed scenario's own sheets. */
  async loadBytes(name: string, png: Uint8Array): Promise<ImageBitmap> {
    const existing = this.images.get(name);
    if (existing) return existing;
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    this.images.set(name, bmp);
    return bmp;
  }

  get(name: string): ImageBitmap | undefined {
    return this.images.get(name);
  }

  drawTile(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    cell: number,
    dx: number,
    dy: number,
  ): void {
    const img = this.images.get(sheetName);
    if (!img) return;
    const r = calcRect(cell % TILES_PER_ROW, Math.floor(cell / TILES_PER_ROW));
    ctx.drawImage(img, r.left, r.top, r.width, r.height, dx, dy, r.width, r.height);
  }
}
