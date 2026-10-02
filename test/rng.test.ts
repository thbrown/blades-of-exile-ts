import { describe, expect, it } from 'vitest';
import { GameRng, MT19937, launchSeed, seedForLaunch } from '../src/core/rng';

// Reference vectors for std::mt19937 (C++11 standard requires the 10000th
// consecutive invocation of a default-constructed engine to be 4123659995).
describe('MT19937', () => {
  it('matches std::mt19937 with default seed 5489', async () => {
    const rng = new MT19937();
    expect(rng.next()).toBe(3499211612);
    expect(rng.next()).toBe(581869302);
    expect(rng.next()).toBe(3890346734);
    expect(rng.next()).toBe(3586334585);
    expect(rng.next()).toBe(545404204);
  });

  it('produces the standard-mandated 10000th output', async () => {
    const rng = new MT19937();
    let v = 0;
    for (let i = 0; i < 10000; i++) v = rng.next();
    expect(v).toBe(4123659995);
  });

  it('matches std::mt19937 seeded with 1', async () => {
    const rng = new MT19937(1);
    expect(rng.next()).toBe(1791095845);
  });
});

describe('GameRng.getRan', () => {
  it('returns times*min when max <= min', async () => {
    const rng = new GameRng();
    expect(rng.getRan(3, 5, 5)).toBe(15);
    expect(rng.getRan(2, 7, 4)).toBe(14); // max<min clamps to min
  });

  it('consumes one game-stream value per die and stays in [min,max]', async () => {
    const rng = new GameRng();
    const reference = new MT19937();
    const v = rng.getRan(1, 1, 6);
    expect(v).toBe(1 + (reference.next() % 6));
    for (let i = 0; i < 1000; i++) {
      const roll = rng.getRan(2, 1, 6);
      expect(roll).toBeGreaterThanOrEqual(2);
      expect(roll).toBeLessThanOrEqual(12);
    }
  });

  it('unique stream does not advance the game stream', async () => {
    const a = new GameRng();
    const b = new GameRng();
    a.getRan(5, 1, 100, true); // unique only
    expect(a.getRan(1, 1, 1000000)).toBe(b.getRan(1, 1, 1000000));
  });
});

describe('the launch seed', () => {
  it('comes off the clock, so each run rolls afresh', () => {
    expect(launchSeed('', 1234567)).toBe(1234567);
    expect(launchSeed('?scenario=exile3', 2 ** 40 + 5)).toBe(5);
  });

  it('is pinned by ?seed=, and the same seed rolls the same dice', () => {
    expect(launchSeed('?scenario=exile3&seed=42', 999)).toBe(42);
    expect(launchSeed('?seed=junk', 999)).toBe(999);
    const roll = (seed: number): number[] => {
      const r = new GameRng();
      seedForLaunch(r, seed);
      return [r.getRan(1, 1, 100), r.getRan(1, 1, 100), r.getRan(1, 1, 100, true)];
    };
    expect(roll(42)).toEqual(roll(42));
    expect(roll(42)).not.toEqual(roll(43));
  });
});
