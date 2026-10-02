/**
 * `apply_light_mask`'s region (`src/render/lightMask.ts`), from hand-made
 * `light_area`s: the shapes are the 1997 release's.
 */

import { describe, expect, it } from 'vitest';
import { lightMaskShapes } from '../src/render/lightMask';

/** A 13 × 13 `light_area`, lit (1) on `[lo, hi]` in both directions. */
function litSquare(lo: number, hi: number): number[][] {
  return Array.from({ length: 13 }, (_, i) => Array.from({ length: 13 }, (_, j) =>
    (i >= lo && i <= hi && j >= lo && j <= hi ? 1 : 0)));
}

describe('lightMaskShapes', () => {
  it('draws no mask at all when the whole view is lit (1997\'s is_dark)', () => {
    expect(lightMaskShapes(litSquare(0, 12))).toBeNull();
    // Only the 9 × 9 view (2..10) counts: dark beyond it is still no mask.
    expect(lightMaskShapes(litSquare(2, 10))).toBeNull();
  });

  it('cuts a three-by-three ellipse around each well-lit square, and a block at each very well-lit one', () => {
    // The party's own light, radius 2: a 5 × 5 pool round the centre (6, 6).
    const shapes = lightMaskShapes(litSquare(4, 8))!;
    // 2s on the inner 3 × 3, of which the centre is a 3.
    expect(shapes.ellipses).toHaveLength(8);
    expect(shapes.blocks).toEqual([{ left: 13 + 28 * 4, top: 13 + 36 * 4, right: 13 + 28 * 6, bottom: 13 + 36 * 6 }]);
    // The ellipse of (5, 5) spans its neighbours: view squares 2..4.
    expect(shapes.ellipses[0]).toEqual({ left: 13 + 28 * 2, top: 13 + 36 * 2, right: 13 + 28 * 5, bottom: 13 + 36 * 5 });
  });

  it('zeroes the 3s right of and below each block, as the C++ does, so a 3 × 3 of them cuts four blocks, not nine', () => {
    const shapes = lightMaskShapes(litSquare(3, 9))!;
    expect(shapes.ellipses).toHaveLength(25 - 9);
    const at = (i: number, j: number) => ({ left: 13 + 28 * (i - 2), top: 13 + 36 * (j - 2) });
    expect(shapes.blocks.map(({ left, top }) => ({ left, top }))).toEqual([at(5, 5), at(5, 7), at(7, 5), at(7, 7)]);
  });
});
