/**
 * Fits the canvas to the browser window, as `adjust_window_mode` fits OBoE's
 * window to the monitor (see `render/desktop.ts` for the layout itself).
 * This file is only the DOM side: measuring the room the page leaves the
 * canvas, and sizing the canvas and its wrapper to match.
 */

import { Desktop, DesktopRoom, DisplayMode, desktop, layoutDesktop } from '../render/desktop';

/**
 * The room below the canvas's top edge, less whatever the page puts under it
 * (the status line and the body's padding), so the canvas never pushes the
 * page into scrolling.
 */
function measureRoom(wrap: HTMLElement): DesktopRoom {
  const body = document.body.getBoundingClientRect();
  const box = wrap.getBoundingClientRect();
  const below = Math.max(0, body.bottom - box.bottom);
  const styles = getComputedStyle(document.body);
  const sides = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return {
    width: Math.max(1, document.documentElement.clientWidth - sides),
    // Measured from the top of the document: the page may be scrolled.
    height: Math.max(1, window.innerHeight - (box.top + window.scrollY) - below),
  };
}

/**
 * Lay the desktop out for the current window and resize the canvas to it.
 * Returns true if the canvas changed size. A resized canvas has lost its
 * picture and its context state, so the caller must redraw.
 */
export function fitCanvasToPage(
  canvas: HTMLCanvasElement, mode: DisplayMode, uiScale: number,
): boolean {
  const wrap = canvas.parentElement;
  if (wrap === null) return false;
  const before = { w: canvas.width, h: canvas.height };
  const room = measureRoom(wrap);
  let next: Desktop = apply(canvas, wrap, layoutDesktop(room, mode, uiScale));
  // The measurement can't see everything the page stacks up (flex gaps, a
  // status line that wraps), so check for the page scrolling and take the
  // overflow off once.
  const over = document.documentElement.scrollHeight - window.innerHeight;
  if (over > 0 && mode !== DisplayMode.SMALL_WINDOW) {
    next = apply(canvas, wrap, layoutDesktop({ ...room, height: room.height - over }, mode, uiScale));
  }
  const resized = before.w !== next.w || before.h !== next.h;
  const moved = resized || desktop.gameX !== next.gameX || desktop.gameY !== next.gameY;
  Object.assign(desktop, next);
  return moved;
}

/** Size the canvas and its wrapper for `d`. The menu bar spans the window. */
function apply(canvas: HTMLCanvasElement, wrap: HTMLElement, d: Desktop): Desktop {
  const cssWidth = `${Math.floor(d.w * d.scale)}px`;
  wrap.style.width = cssWidth;
  // Assigning the size clears the canvas even when it is unchanged.
  if (canvas.width !== d.w) canvas.width = d.w;
  if (canvas.height !== d.h) canvas.height = d.h;
  return d;
}
