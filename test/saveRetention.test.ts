import { describe, expect, it } from 'vitest';
import { DAY, RETENTION, SnapKind, SnapNode, lineage, reparent, thin } from '../src/platform/saveRetention';

/** A straight history, one save per `step` ticks, `n` of them. */
function chain(n: number, step = 10, milestoneEvery = 0): SnapNode[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    parent: i === 0 ? null : i,
    gameAge: i * step,
    kind: (milestoneEvery > 0 && i % milestoneEvery === 0 ? 'milestone' : 'auto') as SnapKind,
    townNum: Math.floor(i / 500) % 3,
    bytes: 20_000,
  }));
}

/** Apply a thinning pass, as the store does. */
function settle(nodes: SnapNode[], head: number): SnapNode[] {
  return reparent(nodes, thin(nodes, head).remove);
}

describe('snapshot thinning', () => {
  it('keeps a short history whole', () => {
    expect(thin(chain(10), 10).remove).toEqual([]);
  });

  it('never deletes the root, the head, a leaf, a fork, or a manual save', () => {
    const nodes = chain(3000, 40);
    nodes[1500]!.kind = 'manual';
    // A branch off node 700 that ends in a leaf.
    nodes.push({ seq: 5000, parent: 700, gameAge: 700 * 40 + 1, kind: 'auto', townNum: 0, bytes: 1 });
    const gone = new Set(thin(nodes, 3000).remove);
    for (const seq of [1, 3000, 5000, 700, 1501]) expect(gone.has(seq)).toBe(false);
    expect(gone.size).toBeGreaterThan(2000);
  });

  it('thins a long history to a size that grows far slower than the history', () => {
    const small = settle(chain(2000, 40), 2000).length;
    const big = settle(chain(20000, 40), 20000).length;
    expect(big).toBeLessThan(small * 10 * 0.5);
    expect(big).toBeLessThan(2000);
  });

  it('is idempotent, and stable as the head moves on a little', () => {
    const once = settle(chain(5000, 40), 5000);
    expect(thin(once, 5000).remove).toEqual([]);
    // Extend the same history by a few saves: nothing already kept far back is dropped.
    const more = [...once];
    for (let i = 1; i <= 5; i++) {
      more.push({ seq: 5000 + i, parent: 5000 + i - 1, gameAge: (4999 + i) * 40, kind: 'auto', townNum: 0, bytes: 20_000 });
    }
    const dropped = new Set(thin(more, 5005).remove);
    const farKept = once.filter((n) => n.gameAge < 4000 * 40);
    expect(farKept.filter((n) => dropped.has(n.seq)).length).toBeLessThanOrEqual(2);
  });

  it('keeps the tree connected after reparenting', () => {
    const nodes = chain(4000, 40);
    nodes.push({ seq: 9000, parent: 1000, gameAge: 40_001, kind: 'auto', townNum: 0, bytes: 1 });
    nodes.push({ seq: 9001, parent: 9000, gameAge: 40_050, kind: 'auto', townNum: 0, bytes: 1 });
    const after = settle(nodes, 4000);
    const ids = new Set(after.map((n) => n.seq));
    expect(after.filter((n) => n.parent === null)).toHaveLength(1);
    for (const n of after) if (n.parent !== null) expect(ids.has(n.parent)).toBe(true);
    // Every node still reaches the root.
    for (const n of after) {
      let at: SnapNode | undefined = n;
      let hops = 0;
      while (at && at.parent !== null && hops++ < 10_000) at = after.find((m) => m.seq === at!.parent);
      expect(at?.parent).toBeNull();
    }
    expect(lineage(after, 4000).has(1)).toBe(true);
  });

  it('keeps every milestone near the head and one per town and day further back', () => {
    const nodes = chain(4000, 40, 7);
    const after = settle(nodes, 4000);
    const headAge = 3999 * 40;
    const near = nodes.filter((n) => n.kind === 'milestone' && headAge - n.gameAge <= RETENTION.milestoneKeepAll);
    const kept = new Set(after.map((n) => n.seq));
    for (const n of near) expect(kept.has(n.seq)).toBe(true);
    const far = after.filter((n) => n.kind === 'milestone' && headAge - n.gameAge > 30 * DAY);
    const cells = new Set(far.map((n) => `${n.townNum}:${Math.floor(n.gameAge / DAY)}`));
    expect(far.length).toBeLessThanOrEqual(cells.size + 5);
  });

  it('thins an abandoned branch harder than the head lineage', () => {
    const nodes = chain(400, 20);
    // 300 saves off node 100, none of them the head's lineage.
    for (let i = 0; i < 300; i++) {
      nodes.push({ seq: 1000 + i, parent: i === 0 ? 100 : 999 + i, gameAge: 2000 + i * 20, kind: 'auto', townNum: 0, bytes: 1 });
    }
    const gone = new Set(thin(nodes, 400).remove);
    const branchGone = nodes.filter((n) => n.seq >= 1000 && gone.has(n.seq)).length;
    expect(branchGone).toBeGreaterThan(250);
    expect(gone.has(1299)).toBe(false); // its tip
  });

  it('enforces the budget but never deletes the protected set', () => {
    const nodes = chain(300, 5_000); // spread over many days so thinning alone keeps a lot
    const loose = thin(nodes, 300, Infinity);
    const keptLoose = nodes.length - loose.remove.length;
    const tight = thin(nodes, 300, 20_000 * 20);
    expect(nodes.length - tight.remove.length).toBeLessThanOrEqual(20);
    expect(nodes.length - tight.remove.length).toBeLessThan(keptLoose);
    expect(tight.remove).not.toContain(1);
    expect(tight.remove).not.toContain(300);
    // Absurdly small: the protected set (root + head) is over budget, and it says so.
    const tiny = thin(nodes, 300, 1);
    expect(tiny.overBudget).toBe(true);
    expect(tiny.remove).not.toContain(1);
    expect(tiny.remove).not.toContain(300);
  });
});
