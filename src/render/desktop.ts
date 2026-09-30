/**
 * The desktop: the canvas the 605×430 game screen sits on. This ports the
 * placement half of `adjust_window_mode` and `compute_viewport`
 * (boe.graphics.cpp:170).
 *
 * OBoE opens a full-screen window and draws the game screen at `UIScale`
 * times its size, in the corner or the centre that `DisplayMode` picks. Its
 * dialogs and the automap are separate windows on the same monitor, so they
 * have the whole screen to use. The original did the same with a 605×430
 * window on a larger Mac or Windows desktop. Here the browser window is the
 * monitor. The canvas fills it, in game pixels (the window's size divided by
 * the scale), and the game screen is drawn at an offset inside it. Dialogs
 * centre on the whole canvas and the map is placed in the free space, so
 * neither is cut off by the game screen's edges.
 *
 * `DisplayMode` 5, "Small Window", is the canvas being just the game screen.
 * That was the only layout before this existed.
 */

import { BOE_HEIGHT, BOE_WIDTH, gameScreen } from './layout';

/** `DisplayMode` as OBoE stores it (boe.dlgutil.cpp:1392). The numbers are the pref's. */
export enum DisplayMode {
  CENTRE = 0,
  TOP_LEFT = 1,
  TOP_RIGHT = 2,
  BOTTOM_LEFT = 3,
  BOTTOM_RIGHT = 4,
  SMALL_WINDOW = 5,
}

/** The `scaleui` group's fixed choices. "Fit" (stored as 0) sits in its `other` slot. */
export const UI_SCALES = [1, 1.5, 2, 3, 4];
export const UI_SCALE_FIT = 0;
/**
 * OBoE's own default is the monitor's scale factor (`fallback_scale`). The
 * port's default is 1, the original's size, centred, as a 605×430 window
 * sat on a 1990s monitor.
 */
export const DEFAULT_UI_SCALE = 1;

/** What the page gives the canvas, in CSS pixels. */
export interface DesktopRoom {
  width: number;
  height: number;
}

export interface Desktop {
  /** The canvas size in game pixels. */
  w: number;
  h: number;
  /** Where the game screen's top-left corner sits on it. */
  gameX: number;
  gameY: number;
  /** CSS pixels per game pixel. */
  scale: number;
}

/**
 * The live desktop. Dialogs read it when they lay themselves out. It starts
 * as a bare game screen, which is also what headless tests see.
 */
export const desktop: Desktop = { w: BOE_WIDTH, h: BOE_HEIGHT, gameX: 0, gameY: 0, scale: 1 };

/**
 * Lay the desktop out in `room`. If the window is too small for the chosen
 * scale, the scale shrinks until the game screen fits, the way the page
 * behaved before any of this existed. The screen never gets clipped.
 */
export function layoutDesktop(room: DesktopRoom, mode: DisplayMode, uiScale: number): Desktop {
  const fit = Math.max(0.25, Math.min(room.width / BOE_WIDTH, room.height / gameScreen.h));
  const scale = uiScale === UI_SCALE_FIT ? fit : Math.min(uiScale, fit);
  if (mode === DisplayMode.SMALL_WINDOW) {
    return { w: BOE_WIDTH, h: gameScreen.h, gameX: 0, gameY: 0, scale };
  }
  const w = Math.max(BOE_WIDTH, Math.floor(room.width / scale));
  const h = Math.max(gameScreen.h, Math.floor(room.height / scale));
  // compute_viewport also leaves a 7px buffer at the sides and 28px above
  // the bottom for a taskbar. Both are there for the OS, and a browser page
  // has its own margins, so neither is kept here.
  const left = 0;
  const right = w - BOE_WIDTH;
  const top = 0;
  const bottom = h - gameScreen.h;
  const at = (gameX: number, gameY: number): Desktop => ({ w, h, gameX, gameY, scale });
  switch (mode) {
    case DisplayMode.TOP_LEFT: return at(left, top);
    case DisplayMode.TOP_RIGHT: return at(right, top);
    case DisplayMode.BOTTOM_LEFT: return at(left, bottom);
    case DisplayMode.BOTTOM_RIGHT: return at(right, bottom);
    default: return at(Math.floor(right / 2), Math.floor(bottom / 2));
  }
}

/**
 * Where to centre a `w`×`h` dialog. Centred on the desktop, but never above
 * or left of its edge. A dialog taller than the desktop keeps its title and
 * text in view, and only its bottom is lost.
 */
export function centreOnDesktop(w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.round((desktop.w - w) / 2)),
    y: Math.max(0, Math.round((desktop.h - h) / 2)),
  };
}

/** A gap between the game screen and a window placed beside it. */
const BESIDE_GAP = 8;

/**
 * Where the automap opens: beside the game screen if the desktop has room
 * for it there (right, then left, then below, then above), and otherwise at
 * the WASM build's spot over the terrain view, `home`, which is in game-screen
 * coordinates. The result is in desktop coordinates.
 */
export function placeBesideGame(
  d: Desktop, w: number, h: number, home: { x: number; y: number },
): { x: number; y: number } {
  const gameRight = d.gameX + BOE_WIDTH;
  const gameBottom = d.gameY + gameScreen.h;
  const topY = Math.max(0, Math.min(d.gameY, d.h - h));
  const leftX = Math.max(0, Math.min(d.gameX, d.w - w));
  if (d.w - gameRight >= w + BESIDE_GAP) return { x: gameRight + BESIDE_GAP, y: topY };
  if (d.gameX >= w + BESIDE_GAP) return { x: d.gameX - w - BESIDE_GAP, y: topY };
  if (d.h - gameBottom >= h + BESIDE_GAP) return { x: leftX, y: gameBottom + BESIDE_GAP };
  if (d.gameY >= h + BESIDE_GAP) return { x: leftX, y: d.gameY - h - BESIDE_GAP };
  return { x: d.gameX + home.x, y: d.gameY + home.y };
}
