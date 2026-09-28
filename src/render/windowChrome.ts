/**
 * The title bar an OS window had. The original's dialogs and its automap are
 * separate windows, each with a caption the player could drag; this port
 * draws everything on one canvas, so it draws the caption as well. It is
 * artificial — nothing in the C++ paints one — and so is its look, which is
 * the Windows 9x caption each game was played under:
 *
 * - **Blades of Exile**: Windows 98's standard gradient, navy to light blue
 *   when active and two greys when not. Titles are 1997's: "Blades of Exile"
 *   on every dialog (DLOGTOOL.CPP:284) and "Blades of Exile Map" on the map
 *   (the RC's `CAPTION`), where OBoE's say "Dialog" and "Map".
 * - **Exile III**: measured from a 1:1 capture of its own dialog — a 1px
 *   `#616468` edge, a 22px caption from `#bdcfdc` to `#d5e3f0` with its
 *   title in black and not bold, and a 1px line under it. (A scaled video of
 *   it looked greyer; the capture is the one to trust.) Titles "Exile III:
 *   Ruined World" and "Exile 3 Map".
 *
 * The close box is left out: the original's dialogs have it greyed.
 */

import type { UiRect } from './layout';

/**
 * Everything above a window's client area: its 1px edge, a 22px caption and
 * the 1px line under it, as E3's windows measure in a 1:1 capture.
 */
export const CAPTION_H = 24;

/**
 * Whether dialogs are being drawn as windows. The host turns it on with the
 * title bars, and a dialog then leaves out its own black frame and drop
 * shadow: the window's 1px edge, drawn over the dialog's outer pixel, stands
 * in for them. Off, as in tests, every dialog draws as it always has.
 */
export const windowFrames = { on: false };

export type ChromeFlavour = 'boe' | 'exile3';

interface CaptionStyle {
  from: string;
  to: string;
  text: string;
  font: string;
}

const BOLD = 'bold 11px Tahoma, "MS Sans Serif", Verdana, Arial, sans-serif';
const PLAIN = '12px Tahoma, "Segoe UI", "MS Sans Serif", Verdana, Arial, sans-serif';

const STYLES: Record<ChromeFlavour, { edge: string; active: CaptionStyle; inactive: CaptionStyle }> = {
  boe: {
    edge: '#404040',
    active: { from: '#000080', to: '#1084d0', text: '#ffffff', font: BOLD },
    inactive: { from: '#808080', to: '#c0c0c0', text: '#d4d0c8', font: BOLD },
  },
  // Sampled from a 1:1 capture of E3's own dialog: black, not bold, on a
  // pale blue that brightens to the right, inside a dark grey edge.
  exile3: {
    edge: '#616468',
    // The capture reads `#bdcfdc` at the far left; the user remembers it
    // greyer there, so it starts from a grey and warms into the blue.
    active: { from: '#b3b9bf', to: '#d5e3f0', text: '#000000', font: PLAIN },
    inactive: { from: '#d4d8dc', to: '#e6e9ec', text: '#6d6d6d', font: PLAIN },
  },
};

/** The dialog and map titles each game's windows carry. */
export const WINDOW_TITLES: Record<ChromeFlavour, { dialog: string; map: string }> = {
  boe: { dialog: 'Blades of Exile', map: 'Blades of Exile Map' },
  exile3: { dialog: 'Exile III: Ruined World', map: 'Exile 3 Map' },
};

/** The strip above a window whose client area is `client`, edge included. */
export function captionRect(client: UiRect): UiRect {
  return { left: client.left, right: client.right, top: client.top - CAPTION_H, bottom: client.top };
}

export function inRect(r: UiRect, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/**
 * Draw the window round `client`: the edge down its sides and along its
 * bottom (over the client's own outer pixel), and the caption above it, no
 * wider than it. `icon`, when given, sits at the left as a window with a
 * system menu has it (the map); a dialog has none.
 */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  client: UiRect,
  title: string,
  opts: { flavour: ChromeFlavour; active: boolean; icon?: CanvasImageSource | null },
): void {
  const r = captionRect(client);
  const w = r.right - r.left;
  const style = STYLES[opts.flavour];
  const c = style[opts.active ? 'active' : 'inactive'];
  ctx.save();
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.left + 0.5, r.top + 0.5, w - 1, client.bottom - r.top - 1);
  // The line between caption and client.
  ctx.fillStyle = style.edge;
  ctx.fillRect(r.left, client.top - 1, w, 1);
  const bar = { left: r.left + 1, top: r.top + 1, w: w - 2, h: CAPTION_H - 2 };
  const grad = ctx.createLinearGradient(bar.left, 0, bar.left + bar.w, 0);
  grad.addColorStop(0, c.from);
  grad.addColorStop(1, c.to);
  ctx.fillStyle = grad;
  ctx.fillRect(bar.left, bar.top, bar.w, bar.h);
  let textLeft = bar.left + 3;
  if (opts.icon) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(opts.icon, bar.left + 2, bar.top + 3, 16, 16);
    textLeft = bar.left + 21;
  }
  ctx.beginPath();
  ctx.rect(bar.left, bar.top, bar.w - 2, bar.h);
  ctx.clip();
  ctx.fillStyle = c.text;
  ctx.font = c.font;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, textLeft, bar.top + bar.h / 2 + 0.5);
  ctx.restore();
}
