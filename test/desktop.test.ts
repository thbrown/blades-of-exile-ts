/** The desktop layout: `adjust_window_mode` / `compute_viewport` for a browser page. */
import { describe, expect, it } from 'vitest';
import {
  DisplayMode, UI_SCALE_FIT, layoutDesktop, placeBesideGame,
} from '../src/render/desktop';

describe('layoutDesktop', () => {
  it('fills the room in game pixels and centres the game screen', () => {
    const d = layoutDesktop({ width: 1900, height: 1000 }, DisplayMode.CENTRE, 2);
    expect(d).toEqual({ w: 950, h: 500, gameX: 172, gameY: 35, scale: 2 });
  });

  it('puts the game screen in the corner the mode names', () => {
    const room = { width: 2000, height: 1000 };
    const at = (mode: DisplayMode) => {
      const d = layoutDesktop(room, mode, 1);
      return [d.gameX, d.gameY];
    };
    expect(at(DisplayMode.TOP_LEFT)).toEqual([0, 0]);
    expect(at(DisplayMode.TOP_RIGHT)).toEqual([2000 - 605, 0]);
    expect(at(DisplayMode.BOTTOM_LEFT)).toEqual([0, 1000 - 430]);
    expect(at(DisplayMode.BOTTOM_RIGHT)).toEqual([2000 - 605, 1000 - 430]);
  });

  it('shrinks the scale rather than clip the game screen', () => {
    const d = layoutDesktop({ width: 1000, height: 700 }, DisplayMode.CENTRE, 4);
    // The height is what runs out: 700 / 430 is under 1000 / 605.
    expect(d.scale).toBeCloseTo(700 / 430);
    expect(d.h).toBe(430);
    expect(d.w).toBe(614);
  });

  it('Fit makes the game screen as large as the room allows', () => {
    const d = layoutDesktop({ width: 1210, height: 1000 }, DisplayMode.CENTRE, UI_SCALE_FIT);
    expect(d.scale).toBe(2);
    expect([d.w, d.gameX]).toEqual([605, 0]);
  });

  it('Small Window is just the game screen', () => {
    const d = layoutDesktop({ width: 3000, height: 2000 }, DisplayMode.SMALL_WINDOW, 2);
    expect(d).toEqual({ w: 605, h: 430, gameX: 0, gameY: 0, scale: 2 });
  });
});

describe('placeBesideGame', () => {
  const home = { x: 52, y: 62 };
  it('prefers the right of the game screen, then the left', () => {
    const right = { w: 1000, h: 500, gameX: 0, gameY: 35, scale: 1 };
    expect(placeBesideGame(right, 296, 277, home)).toEqual({ x: 613, y: 35 });
    const left = { ...right, gameX: 395 };
    expect(placeBesideGame(left, 296, 277, home)).toEqual({ x: 91, y: 35 });
  });

  it('falls back to the spot over the terrain view', () => {
    const tight = { w: 605, h: 430, gameX: 0, gameY: 0, scale: 1 };
    expect(placeBesideGame(tight, 296, 277, home)).toEqual(home);
  });
});
