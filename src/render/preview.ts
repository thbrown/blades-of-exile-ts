/**
 * A picture of the terrain view, for a scenario's card on the startup screen.
 * Cropped from the game's own canvas, so it is exactly what a new game shows.
 */

import { desktop } from './desktop';
import { WIN_RECTS } from './layout';

export function captureTerrainView(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const r = WIN_RECTS.terView;
  const crop = document.createElement('canvas');
  crop.width = r.right - r.left;
  crop.height = r.bottom - r.top;
  crop.getContext('2d')!.drawImage(canvas, desktop.gameX + r.left, desktop.gameY + r.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve) => {
    crop.toBlob((blob) => {
      if (blob === null) resolve(null);
      else void blob.arrayBuffer().then((buf) => { resolve(new Uint8Array(buf)); });
    }, 'image/png');
  });
}

/** The size a save's thumbnail is kept at: two-thirds of the terrain view. */
const THUMB_W = 234;

/**
 * A save's picture. Small and lossy (WebP, quality 0.6 — a browser without
 * WebP encoding quietly gives a PNG), because a series keeps a lot of these
 * inside a few megabytes. The copy off the canvas is synchronous, so the picture
 * is of *this* moment even though the encoding finishes later.
 */
export function captureSaveThumb(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const r = WIN_RECTS.terView;
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const thumb = document.createElement('canvas');
  thumb.width = THUMB_W;
  thumb.height = Math.round(THUMB_W * h / w);
  const g = thumb.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, desktop.gameX + r.left, desktop.gameY + r.top, w, h, 0, 0, thumb.width, thumb.height);
  return new Promise((resolve) => {
    thumb.toBlob((blob) => {
      if (blob === null) resolve(null);
      else void blob.arrayBuffer().then((buf) => { resolve(new Uint8Array(buf)); });
    }, 'image/webp', 0.6);
  });
}
