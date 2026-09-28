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
 * - **Exile III**: the grey to light blue gradient of the user's recording
 *   of it, sampled (`#888c88`→`#a8ccf0` active, `#8a8b87`→`#c4c4c4` not).
 *   Titles "Exile III: Ruined World" and "Exile 3 Map".
 *
 * The close box is left out: the original's dialogs have it greyed.
 */

import type { UiRect } from './layout';

/** Windows 98's caption height, border line included. */
export const CAPTION_H = 18;

export type ChromeFlavour = 'boe' | 'exile3';

interface CaptionColours {
  from: string;
  to: string;
  text: string;
}

const COLOURS: Record<ChromeFlavour, { active: CaptionColours; inactive: CaptionColours }> = {
  boe: {
    active: { from: '#000080', to: '#1084d0', text: '#ffffff' },
    inactive: { from: '#808080', to: '#c0c0c0', text: '#d4d0c8' },
  },
  exile3: {
    active: { from: '#888c88', to: '#a8ccf0', text: '#ffffff' },
    inactive: { from: '#8a8b87', to: '#c4c4c4', text: '#d4d0c8' },
  },
};

/** The dialog and map titles each game's windows carry. */
export const WINDOW_TITLES: Record<ChromeFlavour, { dialog: string; map: string }> = {
  boe: { dialog: 'Blades of Exile', map: 'Blades of Exile Map' },
  exile3: { dialog: 'Exile III: Ruined World', map: 'Exile 3 Map' },
};

/** The caption strip for a window whose client area is `client`: just above it. */
export function captionRect(client: UiRect): UiRect {
  return { left: client.left, right: client.right, top: client.top - CAPTION_H, bottom: client.top };
}

export function inRect(r: UiRect, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/**
 * Draw the caption above `client`. `icon`, when given, sits at the left as a
 * window with a system menu has it (the map); a dialog has none.
 */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  client: UiRect,
  title: string,
  opts: { flavour: ChromeFlavour; active: boolean; icon?: CanvasImageSource | null },
): void {
  const r = captionRect(client);
  const w = r.right - r.left;
  const c = COLOURS[opts.flavour][opts.active ? 'active' : 'inactive'];
  ctx.save();
  // The window's dark outer edge, round the caption's three open sides.
  ctx.fillStyle = '#000000';
  ctx.fillRect(r.left - 1, r.top - 1, w + 2, CAPTION_H + 1);
  const grad = ctx.createLinearGradient(r.left, 0, r.right, 0);
  grad.addColorStop(0, c.from);
  grad.addColorStop(1, c.to);
  ctx.fillStyle = grad;
  ctx.fillRect(r.left, r.top, w, CAPTION_H - 1);
  let textLeft = r.left + 3;
  if (opts.icon) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(opts.icon, r.left + 1, r.top + 1, 16, 16);
    textLeft = r.left + 20;
  }
  ctx.beginPath();
  ctx.rect(r.left, r.top, w - 2, CAPTION_H);
  ctx.clip();
  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px Tahoma, "MS Sans Serif", Verdana, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, textLeft, r.top + (CAPTION_H - 1) / 2 + 0.5);
  ctx.restore();
}
