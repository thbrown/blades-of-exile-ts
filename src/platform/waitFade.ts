/**
 * The town wait's night: the terrain view closes to black like an eye
 * shutting, holds a moment, and opens on the new time.
 *
 * Not in either original as drawn. OBoE's `handle_town_wait` draws the rest
 * screen (`draw_rest_screen`, boe.graphics.cpp:1469) between its turns, and
 * Exile III flashes the view black; the user asked for a fade in their place.
 * It is only a picture over the canvas — the wait itself runs as it always
 * did, so no draw or clock moves.
 */

import { desktop } from '../render/desktop';
import { TER_VIEW_TILES, terrainSpotPos } from '../render/layout';

const TILE_W = 28;
const TILE_H = 36;

let registered = false;
/** `--iris` has to be a typed length for the browser to animate it. */
function registerIris(): void {
  if (registered) return;
  registered = true;
  try {
    CSS.registerProperty({ name: '--iris', syntax: '<percentage>', inherits: false, initialValue: '100%' });
  } catch { /* already registered, or no Houdini: opacity alone still fades */ }
}

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const finished = (a: Animation): Promise<void> => a.finished.then(() => undefined, () => undefined);

/**
 * Close the view, run `act` (the wait), and open it again once `act` is done
 * or has put something up — a dialog from a special mid-wait would otherwise
 * sit under the black. `redraw` paints the new state before the eye opens.
 */
export async function aroundWaitFade<T>(
  canvas: HTMLCanvasElement, act: () => Promise<T>, redraw: () => void,
): Promise<T> {
  const host = canvas.parentElement;
  if (host === null || typeof canvas.animate !== 'function') return act();
  registerIris();

  // The 9x9 tiles only, in the canvas's own pixels mapped onto however it is
  // scaled on the page. The canvas is the whole desktop, and the game screen
  // sits at (gameX, gameY) in it — off the corner whenever the window is
  // wider or taller than the game, as a phone held sideways always is.
  const spot = terrainSpotPos(0, 0);
  const origin = { x: desktop.gameX + spot.x, y: desktop.gameY + spot.y };
  const sx = canvas.offsetWidth / canvas.width;
  const sy = canvas.offsetHeight / canvas.height;
  const veil = document.createElement('div');
  Object.assign(veil.style, {
    position: 'absolute',
    left: `${canvas.offsetLeft + origin.x * sx}px`,
    top: `${canvas.offsetTop + origin.y * sy}px`,
    width: `${TER_VIEW_TILES * TILE_W * sx}px`,
    height: `${TER_VIEW_TILES * TILE_H * sy}px`,
    pointerEvents: 'none',
    opacity: '0',
    background: 'radial-gradient(ellipse at 50% 50%, rgba(2,2,12,0) calc(var(--iris) - 30%), rgb(2,2,12) var(--iris))',
  });
  veil.setAttribute('aria-hidden', 'true');
  host.append(veil);

  const calm = reducedMotion();
  const shut: Keyframe[] = calm
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, '--iris': '130%' }, { opacity: 1, '--iris': '0%' }];
  try {
    await finished(veil.animate(shut, { duration: calm ? 200 : 520, easing: 'ease-in', fill: 'forwards' }));
    const acting = act();
    // Hold in the dark a beat, but no longer than the wait takes to stop.
    await Promise.race([acting.then(() => undefined, () => undefined),
      new Promise<void>((r) => { setTimeout(r, 1000); })]);
    await new Promise<void>((r) => { setTimeout(r, calm ? 80 : 260); });
    redraw();
    const open = veil.animate([...shut].reverse(), { duration: calm ? 250 : 700, easing: 'ease-out', fill: 'forwards' });
    void finished(open).then(() => { veil.remove(); });
    return await acting;
  } catch (err) {
    veil.remove();
    throw err;
  }
}
