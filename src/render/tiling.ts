/**
 * The 21 tiled background patterns cut out of pixpats.png — port of
 * init_tiling (gfx/tiling.cpp:76). Scenarios pick their outdoor/town/dungeon/
 * fight background by index into this table.
 */

import { UiRect } from './layout';

const PAT_OFFS: [number, number][] = [
  [0, 3], [1, 1], [2, 1], [2, 0],
  [3, 0], [3, 1], [1, 3], [0, 0],
  [0, 2], [1, 2], [0, 1], [2, 2],
  [2, 3], [3, 2], [1, 0], [4, 0], [3, 3],
];
const PAT_I = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20];

/** bg_rects[0..20]: source rect in pixpats.png for each background pattern. */
export const BG_RECTS: UiRect[] = (() => {
  const rects: UiRect[] = Array.from({ length: 21 }, () => ({
    top: 0,
    left: 0,
    bottom: 64,
    right: 64,
  }));
  for (let i = 0; i < 17; i++) {
    const [ox, oy] = PAT_OFFS[i]!;
    rects[PAT_I[i]!] = { top: 64 * oy, left: 64 * ox, bottom: 64 * oy + 64, right: 64 * ox + 64 };
  }
  // 0, 1, 18 and 7 are the four 32x32 quadrants of the tile below bg_rects[19].
  const base = rects[19]!;
  const tmp = { top: base.top + 64, left: base.left, bottom: base.bottom + 64, right: base.right };
  rects[0] = { ...tmp, right: tmp.right - 32, bottom: tmp.bottom - 32 };
  rects[1] = { ...tmp, left: tmp.left + 32, bottom: tmp.bottom - 32 };
  rects[18] = { ...tmp, right: tmp.right - 32, top: tmp.top + 32 };
  rects[7] = { ...tmp, left: tmp.left + 32, top: tmp.top + 32 };
  return rects;
})();

/**
 * Where Exile III's ten background patterns sit in the `pixpats` it ships
 * (tools/e3convert): E3 pattern `k` is `BG_RECTS[E3_PATTERN_SLOTS[k]]`. E3's
 * dialog pattern, 2, takes slot 16, OBoE's `BG_LIGHT`, which a scenario with
 * `backgrounds` = `exile3` makes the dialogs' default (black text, as 1997's
 * and E3's dialogs have). The rest take slots nothing else reads under that
 * flag, so the dark dialog (5), startup/map (4), panel (6) and talk/shop
 * (12) patterns stay the game's.
 */
export const E3_PATTERN_SLOTS = [8, 9, 16, 10, 11, 13, 14, 15, 17, 19];

/**
 * Exile III's window background (`1050:1e81`), for the scenario flag
 * `backgrounds` = `exile3`: by whether the party's outdoor window is in the
 * world's eastern, cave columns (party+0x12e2, the window's column, 7 and
 * up; E3's zone is `(0x12e3 + 0x12e5) × 9 + 0x12e2 + 0x12e4`). Outdoors
 * 0 in the caves and 7 above; in a fight 9 and 6; in town 5 in the caves, 4
 * above and in Fort Emergence (21) wherever it is.
 */
export function e3Background(where: 'out' | 'fight' | 'town', caves: boolean, town: number): number {
  const k = where === 'out' ? (caves ? 0 : 7)
    : where === 'fight' ? (caves ? 9 : 6)
    : caves && town !== 21 ? 5 : 4;
  return E3_PATTERN_SLOTS[k]!;
}

/** cDialog::BG_DARK and BG_LIGHT (dialog.cpp:50). */
export const BG_DARK = 5;
export const BG_LIGHT = 16;

let defaultDialogBg = BG_DARK;

/**
 * `cDialog::defaultBackground` (dialog.cpp:51): what a dialog tiles with, and
 * so whether its text is white (dark) or black (dialog.cpp:406).
 */
export function setDefaultDialogBackground(bg: number): void {
  defaultDialogBg = bg;
}

export function dialogBackground(): number {
  return defaultDialogBg;
}

/** The default text colour on the default dialog background. */
export function dialogTextIsWhite(): boolean {
  return defaultDialogBg === BG_DARK;
}

/** cScenario defaults (scenario.cpp:67) — used when no area overrides them. */
export const DEFAULT_BG = {
  out: 10,
  fight: 4,
  town: 13,
  dungeon: 9,
} as const;

/** The pattern used to fill panel interiors before drawing text (bg[6]). */
export const PANEL_BG = 6;

/**
 * Fill `dest` with pattern `index`, aligning the pattern to the destination
 * origin the way tileImage does.
 *
 * `anchor` is the corner of the window the pattern belongs to. OBoE's
 * dialogs and map are windows of their own, each tiling from its own (0,0),
 * so the pattern goes where the window goes; left out, it is the canvas's.
 */
export function tilePattern(
  ctx: CanvasRenderingContext2D,
  pixpats: CanvasImageSource,
  index: number,
  dest: UiRect,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const src = BG_RECTS[index] ?? BG_RECTS[0]!;
  const pw = src.right - src.left;
  const ph = src.bottom - src.top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top);
  ctx.clip();
  // Rounded down, so a rect that starts off the canvas (the desktop around the
  // game screen, drawn in the game screen's coordinates) still lines up.
  const startX = anchor.x + Math.floor((dest.left - anchor.x) / pw) * pw;
  const startY = anchor.y + Math.floor((dest.top - anchor.y) / ph) * ph;
  for (let y = startY; y < dest.bottom; y += ph)
    for (let x = startX; x < dest.right; x += pw)
      ctx.drawImage(pixpats, src.left, src.top, pw, ph, x, y, pw, ph);
  ctx.restore();
}

/**
 * `bw_pats` (gfx/tiling.cpp:104) — six 8x8 dither patterns in a row across
 * bwpats.png, sparse to dense. Only the mask over unexplored ground uses them.
 */
export const BW_PAT_W = 8;

export function bwPatRect(index: number): UiRect {
  const left = 8 * index;
  return { top: 0, left, bottom: 8, right: left + 8 };
}

/** `tileImage` with one of the black-and-white patterns rather than a bg. */
export function tileBwPattern(
  ctx: CanvasRenderingContext2D,
  bwpats: CanvasImageSource,
  index: number,
  dest: UiRect,
): void {
  const src = bwPatRect(index);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top);
  ctx.clip();
  // The pattern is aligned to the destination origin, as tileImage aligns it.
  const startX = dest.left - (dest.left % BW_PAT_W);
  const startY = dest.top - (dest.top % BW_PAT_W);
  for (let y = startY; y < dest.bottom; y += BW_PAT_W)
    for (let x = startX; x < dest.right; x += BW_PAT_W)
      ctx.drawImage(bwpats, src.left, src.top, BW_PAT_W, BW_PAT_W, x, y, BW_PAT_W, BW_PAT_W);
  ctx.restore();
}
