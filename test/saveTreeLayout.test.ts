import { describe, expect, it } from 'vitest';
import { SnapNode } from '../src/platform/saveRetention';
import { LINEAR_MOVES, layoutTree, moveDistance } from '../src/platform/saveTreeLayout';

const node = (seq: number, parent: number | null, gameAge: number, townNum = 0): SnapNode =>
  ({ seq, parent, gameAge, kind: 'auto', townNum, bytes: 1 });
const OPTS = { scale: 20, pad: 10 };

describe('tree layout', () => {
  it('puts the head lineage on lane 0, ordered by game time', () => {
    const l = layoutTree([node(1, null, 0), node(2, 1, 100), node(3, 2, 200)], 3, OPTS);
    expect([1, 2, 3].map((s) => l.at.get(s)!.lane)).toEqual([0, 0, 0]);
    const xs = [1, 2, 3].map((s) => l.at.get(s)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.lanes).toBe(1);
  });

  it('spaces saves by the moves between them: five moves are five times one', () => {
    const l = layoutTree([node(1, null, 0), node(2, 1, 1), node(3, 2, 6)], 3, OPTS);
    const one = l.at.get(2)!.x - l.at.get(1)!.x;
    expect(one).toBe(OPTS.scale);
    expect(l.at.get(3)!.x - l.at.get(2)!.x).toBeCloseTo(5 * one);
  });

  it('counts an outdoor step (ten ticks) as one move, like a step in town', () => {
    const l = layoutTree([node(1, null, 0, 200), node(2, 1, 10, 200), node(3, 2, 11, 5)], 3, OPTS);
    expect(l.at.get(2)!.x - l.at.get(1)!.x).toBeCloseTo(l.at.get(3)!.x - l.at.get(2)!.x);
  });

  it('draws long gaps by their log, so a rest is longer but not overwhelming', () => {
    expect(moveDistance(LINEAR_MOVES, false)).toBe(LINEAR_MOVES);
    expect(moveDistance(2 * LINEAR_MOVES, false)).toBe(LINEAR_MOVES + 5);
    const rest = moveDistance(1000, false);
    expect(rest).toBeGreaterThan(LINEAR_MOVES);
    expect(rest).toBeLessThan(60);
  });

  it('gives a branch its own lane, drawn from the fork', () => {
    // 1-2-3-4 is the head's line; 5-6 branches off 2.
    const l = layoutTree(
      [node(1, null, 0), node(2, 1, 100), node(3, 2, 200), node(4, 3, 300), node(5, 2, 150), node(6, 5, 250)], 4, OPTS);
    expect(l.at.get(5)!.lane).toBe(1);
    expect(l.at.get(6)!.lane).toBe(1);
    expect(l.lanes).toBe(2);
  });

  it('lets branches that do not overlap in time share a lane', () => {
    const nodes = [
      node(1, null, 0), node(2, 1, 100), node(3, 2, 200), node(4, 3, 300), node(5, 4, 400),
      node(6, 1, 50), // a short branch early on
      node(7, 4, 350), // another, much later
    ];
    const l = layoutTree(nodes, 5, OPTS);
    expect(l.at.get(6)!.lane).toBe(1);
    expect(l.at.get(7)!.lane).toBe(1);
    expect(l.lanes).toBe(2);
  });

  it('stacks branches that overlap', () => {
    const nodes = [
      node(1, null, 0), node(2, 1, 100), node(3, 2, 900),
      node(4, 1, 10), node(5, 4, 800), // a long branch from the root
      node(6, 2, 120), node(7, 6, 700), // another over the same span
    ];
    const l = layoutTree(nodes, 3, OPTS);
    expect(new Set([l.at.get(5)!.lane, l.at.get(7)!.lane]).size).toBe(2);
  });

  it('squeezes a wide tree to fit, keeping the order', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(i + 1, i === 0 ? null : i, i * 3));
    const l = layoutTree(nodes, 200, { ...OPTS, fitWidth: 500 });
    expect(l.width).toBeLessThanOrEqual(500);
    const xs = nodes.map((n) => l.at.get(n.seq)!.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(500 - OPTS.pad);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(OPTS.pad);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.gap).toBeLessThan(OPTS.scale);
  });

  it('starts from the first save, not day 1', () => {
    const l = layoutTree([node(1, null, 3700 * 300), node(2, 1, 3700 * 300 + 50)], 2, OPTS);
    expect(l.at.get(1)!.x).toBe(OPTS.pad);
  });

  it('labels each new day on the main line once', () => {
    const l = layoutTree([node(1, null, 0), node(2, 1, 4000), node(3, 2, 4100), node(4, 3, 8000)], 4, OPTS);
    expect(l.days.map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it('copes with a very long chain', () => {
    const nodes = Array.from({ length: 20000 }, (_, i) => node(i + 1, i === 0 ? null : i, i * 5));
    const l = layoutTree(nodes, 20000, OPTS);
    expect(l.at.size).toBe(20000);
  });
});
