/**
 * A picture of the terrain view, for a scenario's card on the startup screen.
 * Cropped from the game's own canvas, so it is exactly what a new game shows.
 */

import { WIN_RECTS } from './layout';

export function captureTerrainView(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const r = WIN_RECTS.terView;
  const crop = document.createElement('canvas');
  crop.width = r.right - r.left;
  crop.height = r.bottom - r.top;
  crop.getContext('2d')!.drawImage(canvas, r.left, r.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve) => {
    crop.toBlob((blob) => {
      if (blob === null) resolve(null);
      else void blob.arrayBuffer().then((buf) => { resolve(new Uint8Array(buf)); });
    }, 'image/png');
  });
}
