/**
 * The mouse cursor — `get_mode_cursor` and `change_cursor` (boe.main.cpp),
 * with `get_cur_direction` (boe.actions.cpp:3845) for the arrows.
 *
 * Over the terrain view in the three ordinary modes the cursor is an arrow
 * pointing the way a click would move the party, or the hourglass over the
 * party's own square; in a targeting or look mode it is that mode's cursor;
 * anywhere else — and whenever a dialog is up — it is the sword.
 *
 * The images are the original's, in `data/cursors`, each with its hotspot
 * stored as a `Hotspot(x,y)` comment inside the GIF; the table below is those
 * comments, read once.
 */

import { GameMode } from '../game/modes';
import { WIN_RECTS } from '../render/layout';

export type CursorName =
  | 'sword' | 'target' | 'talk' | 'key' | 'boot' | 'drop' | 'look' | 'wait'
  | 'NW' | 'N' | 'NE' | 'W' | 'E' | 'SW' | 'S' | 'SE';

const HOTSPOT: Record<CursorName, [number, number]> = {
  sword: [0, 0], target: [11, 11], talk: [4, 23], key: [0, 2], boot: [3, 3],
  drop: [3, 23], look: [13, 23], wait: [11, 12],
  NW: [0, 0], N: [11, 0], NE: [23, 0], W: [0, 12], E: [23, 12],
  SW: [0, 23], S: [12, 23], SE: [23, 23],
};

/** `arrow_curs[dy + 1][dx + 1]`. */
const ARROWS: CursorName[][] = [['NW', 'N', 'NE'], ['W', 'wait', 'E'], ['SW', 'S', 'SE']];

/**
 * A scenario's own cursor images, by name, each with its hotspot: the
 * blades-of-exile-ts scenario flag `cursors`, `name:x:y` comma-separated, naming the
 * `cursors/NAME.png` the scenario ships. Exile III's are its Win16 cursors
 * (tools/e3convert/cursors.ts). Only the pictures change; which cursor shows
 * when is still `change_cursor`'s.
 */
let scenarioCursors = new Map<string, { url: string; x: number; y: number }>();

/** Install a scenario's cursors from its flag; `url` finds each one's image. */
export function setScenarioCursors(flag: string | undefined, url: (name: string) => string): void {
  scenarioCursors = new Map();
  for (const entry of (flag ?? '').split(',')) {
    const [name, x, y] = entry.split(':');
    if (!name || !(name in HOTSPOT)) continue;
    scenarioCursors.set(name, { url: url(name), x: Number(x) || 0, y: Number(y) || 0 });
  }
}

/** The CSS `cursor` value for one of them. */
export function cursorCss(name: CursorName): string {
  const own = scenarioCursors.get(name);
  if (own) return `url(${own.url}) ${own.x} ${own.y}, auto`;
  const [x, y] = HOTSPOT[name];
  return `url(${import.meta.env.BASE_URL}data/cursors/${name}.gif) ${x} ${y}, auto`;
}

/** `get_mode_cursor`. */
export function modeCursor(mode: GameMode): CursorName {
  switch (mode) {
    case GameMode.TOWN_TARGET: case GameMode.SPELL_TARGET: case GameMode.FIRING:
    case GameMode.THROWING: case GameMode.FANCY_TARGET:
      return 'target';
    case GameMode.TALK_TOWN: return 'talk';
    case GameMode.USE_TOWN: return 'key';
    case GameMode.BASH_TOWN: return 'boot';
    case GameMode.DROP_TOWN: case GameMode.DROP_COMBAT: return 'drop';
    case GameMode.LOOK_OUTDOORS: case GameMode.LOOK_TOWN: case GameMode.LOOK_COMBAT:
      return 'look';
    case GameMode.RESTING: return 'wait';
    default: return 'sword';
  }
}

/** `win_to_rects[WINRECT_TERVIEW]` inset 13 — the terrain grid itself. */
function worldScreen(): { left: number; top: number; right: number; bottom: number } {
  const v = WIN_RECTS.terView;
  return { left: v.left + 13, top: v.top + 13, right: v.right - 13, bottom: v.bottom - 13 };
}

/**
 * `get_cur_direction` — by *angle* from the middle of the grid, in eight
 * 45° slices starting 22.5° below east. Returns (dx, dy).
 */
export function curDirection(x: number, y: number): { dx: number; dy: number } {
  const w = worldScreen();
  const cx = Math.trunc((w.left + w.right) / 2);
  const cy = Math.trunc((w.top + w.bottom) / 2);
  let angle = 22.5 + Math.atan2(-(y - cy), x - cx) * 180 / 3.14159;
  if (angle < 0) angle += 360;
  if (angle > 360) angle -= 360;
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0]];
  const d = dirs[Math.trunc(angle / 45)] ?? [0, 0];
  return { dx: d[0]!, dy: d[1]! };
}

/**
 * `change_cursor` — what the cursor should be with the pointer at (x, y) in
 * canvas coordinates. `null` coordinates (the pointer off the canvas) and an
 * open dialog both give the sword.
 */
export function changeCursor(mode: GameMode, x: number | null, y: number | null,
  dialogUp: boolean): CursorName {
  if (dialogUp || x === null || y === null) return 'sword';
  const w = worldScreen();
  const inside = x >= w.left && x < w.right && y >= w.top && y < w.bottom;
  if (!inside) return 'sword';
  if (mode === GameMode.OUTDOORS || mode === GameMode.TOWN || mode === GameMode.COMBAT) {
    // `mouse_to_terrain_coords(tile, true)` — the party's own square is (4, 4).
    const tx = Math.floor((x - w.left) / 28);
    const ty = Math.floor((y - w.top) / 36);
    if (tx === 4 && ty === 4) return 'wait';
    const { dx, dy } = curDirection(x, y);
    return ARROWS[dy + 1]![dx + 1]!;
  }
  return modeCursor(mode);
}
