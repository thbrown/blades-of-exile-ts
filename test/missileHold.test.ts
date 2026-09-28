import { afterEach, describe, expect, it } from 'vitest';
import { animClear, animPending, paced } from '../src/game/anim';
import { missileMs, runAMissile } from '../src/game/missileAnim';

/**
 * 1997's `do_missile_anim` (and Exile III's) holds a shot until its launch
 * sound has played: `pause_len + 40` ms from the start, 660 for sound 11.
 * OBoE dropped it; this port keeps the original's.
 */
describe("a missile's hold for its sound", () => {
  afterEach(() => animClear());

  it('holds a fire shot for 700 ms, paced, and a plain one for its flight', () => {
    runAMissile({ x: 1, y: 1 }, { x: 5, y: 5 }, 2, 1, 11);
    expect(animPending()).toBeGreaterThanOrEqual(paced(700) - 5);
    animClear();
    runAMissile({ x: 1, y: 1 }, { x: 5, y: 5 }, 2, 1, 5);
    expect(animPending()).toBeLessThanOrEqual(missileMs() + 5);
  });
});
