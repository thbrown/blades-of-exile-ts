/** `change_cursor` / `get_mode_cursor` / `get_cur_direction`. */
import { describe, expect, it } from 'vitest';
import { GameMode } from '../src/game/modes';
import { changeCursor, curDirection, modeCursor } from '../src/platform/cursors';
import { WIN_RECTS } from '../src/render/layout';

const v = WIN_RECTS.terView;
/** The middle of view tile (tx, ty). */
const tile = (tx: number, ty: number): [number, number] =>
  [v.left + 13 + tx * 28 + 14, v.top + 13 + ty * 36 + 18];

describe('the cursor over the terrain view', () => {
  it('is an hourglass on the party and an arrow elsewhere', () => {
    expect(changeCursor(GameMode.TOWN, ...tile(4, 4), false)).toBe('wait');
    expect(changeCursor(GameMode.TOWN, ...tile(4, 0), false)).toBe('N');
    expect(changeCursor(GameMode.OUTDOORS, ...tile(8, 8), false)).toBe('SE');
    expect(changeCursor(GameMode.COMBAT, ...tile(0, 4), false)).toBe('W');
  });

  it("is the mode's own in a targeting or look mode", () => {
    expect(changeCursor(GameMode.LOOK_TOWN, ...tile(4, 0), false)).toBe('look');
    expect(changeCursor(GameMode.FIRING, ...tile(4, 4), false)).toBe('target');
    expect(modeCursor(GameMode.USE_TOWN)).toBe('key');
    expect(modeCursor(GameMode.BASH_TOWN)).toBe('boot');
  });

  it('is the sword off the grid, off the canvas, and under a dialog', () => {
    expect(changeCursor(GameMode.TOWN, 500, 200, false)).toBe('sword');
    expect(changeCursor(GameMode.TOWN, null, null, false)).toBe('sword');
    expect(changeCursor(GameMode.TOWN, ...tile(4, 0), true)).toBe('sword');
  });

  it('points by angle, not by square', () => {
    // Two squares right and one up is still "east" at under 22.5°.
    const [x, y] = tile(6, 4);
    expect(curDirection(x, y - 10)).toEqual({ dx: 1, dy: 0 });
  });
});
