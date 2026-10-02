import { describe, expect, it } from 'vitest';
import { SnapNode } from '../src/platform/saveRetention';
import { layoutTree } from '../src/platform/saveTreeLayout';

const node = (seq: number, parent: number | null, gameAge: number): SnapNode =>
  ({ seq, parent, gameAge, kind: 'auto', townNum: 0, bytes: 1 });
const OPTS = { scale: 100, minGap: 20, pad: 10 };

describe('tree layout', () => {
  it('puts the head lineage on lane 0, ordered by game time', () => {
    const l = layoutTree([node(1, null, 0), node(2, 1, 100), node(3, 2, 200)], 3, OPTS);
    expect([1, 2, 3].map((s) => l.at.get(s)!.lane)).toEqual([0, 0, 0]);
    const xs = [1, 2, 3].map((s) => l.at.get(s)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.lanes).toBe(1);
  });

  it('keeps nodes a minimum distance apart even when their ages are close', () => {
    const l = layoutTree([node(1, null, 0), node(2, 1, 1), node(3, 2, 2)], 3, OPTS);
    expect(l.at.get(2)!.x - l.at.get(1)!.x).toBeGreaterThanOrEqual(20);
    expect(l.at.get(3)!.x - l.at.get(2)!.x).toBeGreaterThanOrEqual(20);
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
