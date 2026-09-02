/**
 * `handle_target_mode`'s target lock (boe.newgraph.cpp:1102) and the two
 * geometry helpers it leans on.
 *
 * The lock is not a camera nicety: it moves `center`, and its redraw spends an
 * encumbrance roll through `draw_text_bar` — which is why it is ported at all.
 */
import { describe, expect, it } from 'vitest';
import { SCREEN_RADIUS, isOnScreen } from '../src/core/location';
import { closestPoint, pointsContainingMost } from '../src/game/targetMode';

describe('points_containing_most', () => {
  it('is empty when there is nothing to look at', () => {
    expect(pointsContainingMost([], [])).toEqual([]);
  });

  it('returns every centre that sees the one point', () => {
    // padding defaults to 1, so the padded radius is 3 and a lone point is
    // visible from the 7x7 block around it.
    const got = pointsContainingMost([{ x: 10, y: 10 }], []);
    expect(got).toHaveLength(7 * 7);
    const r = SCREEN_RADIUS - 1;
    for (const c of got) expect(isOnScreen({ x: 10, y: 10 }, c, r)).toBe(true);
  });

  it('prefers a centre that sees both to one that sees either', () => {
    const a = { x: 4, y: 10 };
    const b = { x: 10, y: 10 };
    const got = pointsContainingMost([a, b], []);
    // Six apart, and the padded radius is 3: only x = 7 sees both.
    expect(got.every((c) => c.x === 7)).toBe(true);
    for (const c of got) {
      expect(isOnScreen(a, c, 3)).toBe(true);
      expect(isOnScreen(b, c, 3)).toBe(true);
    }
  });

  it('will not give up a required point to see more of the others', () => {
    // Three in a row, too spread to see all at once: the padded radius is 3,
    // so no centre reaches both 0 and 7. Requiring the far left one rules out
    // the centres that would have dropped it in favour of the pair.
    const pts = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 }];
    const free = pointsContainingMost(pts, []);
    const held = pointsContainingMost(pts, [{ x: 0, y: 0 }]);
    expect(free.every((c) => isOnScreen({ x: 0, y: 0 }, c, 3))).toBe(false);
    expect(held.every((c) => isOnScreen({ x: 0, y: 0 }, c, 3))).toBe(true);
  });
});

describe('closest_point', () => {
  it('takes the nearest by float distance', () => {
    const got = closestPoint([{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 9, y: 9 }], { x: 4, y: 4 });
    expect(got).toEqual({ x: 3, y: 3 });
  });

  it('keeps the first of two equally close, as the C++ does', () => {
    // `closest_point_idx` only replaces its best on a *strictly* smaller
    // distance, so a tie goes to whichever came first in the list.
    const got = closestPoint([{ x: 0, y: 2 }, { x: 2, y: 0 }], { x: 0, y: 0 });
    expect(got).toEqual({ x: 0, y: 2 });
  });
});
