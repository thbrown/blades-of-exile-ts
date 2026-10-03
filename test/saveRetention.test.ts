import { describe, expect, it } from 'vitest';
import {
  SnapKind, SnapNode, autoCandidates, autoCount, branchOfEnd, canDeleteBranch, canDeleteFromEnd, canDeleteSingle,
  childrenOf, lineage,
  pickAutoVictim, reparent, roleOf, roles, trimAutos,
} from '../src/platform/saveRetention';

const node = (seq: number, parent: number | null, kind: SnapKind = 'auto'): SnapNode =>
  ({ seq, parent, gameAge: seq * 10, kind, townNum: 0, bytes: 100 });

/** A straight line 1..n, the root a milestone. */
function chain(n: number, kinds: Record<number, SnapKind> = {}): SnapNode[] {
  return Array.from({ length: n }, (_, i) =>
    node(i + 1, i === 0 ? null : i, kinds[i + 1] ?? (i === 0 ? 'milestone' : 'auto')));
}

/** A seeded stand-in for Math.random, so the tests are repeatable. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('roles', () => {
  it('names the root, a branch start, an end, and the rest by kind', () => {
    // 1-2-3-4 with 5-6 branching off 2 (5 saved as a branch).
    const nodes = [...chain(4), node(5, 2, 'branch'), node(6, 5)];
    const r = roles(nodes);
    expect([1, 2, 3, 4, 5, 6].map((s) => r.get(s))).toEqual(['root', 'auto', 'auto', 'end', 'branch', 'end']);
  });

  it('recognises a branch saved before branches had a kind, by its shape', () => {
    const nodes = [...chain(4), node(5, 2), node(6, 5)];
    expect(roleOf(nodes[4]!, childrenOf(nodes))).toBe('branch');
    // The fork's first child is the line carrying on, not a branch.
    expect(roleOf(nodes[2]!, childrenOf(nodes))).toBe('auto');
  });

  it('a milestone or manual save in the middle keeps its kind', () => {
    const r = roles(chain(5, { 3: 'milestone', 4: 'manual' }));
    expect([r.get(3), r.get(4)]).toEqual(['milestone', 'manual']);
  });
});

describe('the autosave pool', () => {
  it('counts only plain autosaves — not the root, ends, branch starts, milestones or manual saves', () => {
    const nodes = [...chain(6, { 3: 'milestone', 4: 'manual' }), node(7, 2, 'branch'), node(8, 7)];
    // 2 and 5 are plain autosaves; 6 and 8 are ends; 7 starts a branch.
    expect(autoCount(nodes, 6)).toBe(2);
    expect(autoCandidates(nodes, 6).map((n) => n.seq)).toEqual([5]); // 2 is a fork
  });

  it('never picks the newest autosave, and leans hard on the old', () => {
    const nodes = chain(52); // 50 candidates: 2..51
    const rand = seeded(7);
    const hits = new Map<number, number>();
    for (let i = 0; i < 20000; i++) {
      const v = pickAutoVictim(nodes, 52, rand)!;
      hits.set(v, (hits.get(v) ?? 0) + 1);
    }
    expect(hits.get(51)).toBeUndefined();
    expect(hits.has(52)).toBe(false); // the head
    expect(hits.has(1)).toBe(false); // the root
    const old = (hits.get(2) ?? 0) + (hits.get(3) ?? 0) + (hits.get(4) ?? 0);
    const recent = (hits.get(48) ?? 0) + (hits.get(49) ?? 0) + (hits.get(50) ?? 0);
    expect(old).toBeGreaterThan(recent * 2);
  });

  it('trims to the cap and leaves everything else alone', () => {
    const nodes = chain(80, { 10: 'milestone', 20: 'manual', 30: 'milestone' });
    const gone = trimAutos(nodes, 80, 50, seeded(3));
    const kept = reparent(nodes, gone);
    expect(autoCount(kept, 80)).toBe(50);
    for (const seq of [1, 10, 20, 30, 79, 80]) expect(kept.some((n) => n.seq === seq)).toBe(true);
    // Still one connected line.
    expect(lineage(kept, 80).size).toBe(kept.length);
  });

  it('does nothing under the cap', () => {
    expect(trimAutos(chain(30), 30, 50)).toEqual([]);
  });

  it('keeps fork points, so branches stay where they grew from', () => {
    const nodes = [...chain(10), node(11, 3, 'branch'), node(12, 6, 'branch')];
    const gone = trimAutos(nodes, 10, 0, seeded(1));
    expect(gone).not.toContain(3);
    expect(gone).not.toContain(6);
    expect(gone.sort((a, b) => a - b)).toEqual([2, 4, 5, 7, 8, 9]);
  });
});

describe('deleting by hand', () => {
  const nodes = [...chain(6, { 3: 'milestone', 4: 'manual' }), node(7, 2, 'branch'), node(8, 7)];

  it('allows a milestone, a manual save or a plain autosave on its own', () => {
    expect([2, 3, 4, 5].map((s) => canDeleteSingle(nodes, s, 6))).toEqual([true, true, true, true]);
  });

  it('refuses the root, a branch start, an end and the live game', () => {
    expect([1, 7, 8, 6].map((s) => canDeleteSingle(nodes, s, 6))).toEqual([false, false, false, false]);
  });

  it('deletes a branch only from its first save, and not the one being played', () => {
    expect(canDeleteBranch(nodes, 7, 6)).toBe(true);
    expect(canDeleteBranch(nodes, 8, 6)).toBe(false);
    expect(canDeleteBranch(nodes, 7, 8)).toBe(false);
    expect(canDeleteBranch(nodes, 1, 6)).toBe(false);
  });
});

describe('reparent', () => {
  it('hangs orphans on the nearest surviving ancestor', () => {
    const kept = reparent(chain(5), [2, 3]);
    expect(kept.map((n) => [n.seq, n.parent])).toEqual([[1, null], [4, 1], [5, 4]]);
  });
});

describe('deleting a branch from its end save', () => {
  // 1-2-3-4-5, and a branch 6-7-8 from 3.
  const tree = (): SnapNode[] => [...chain(5), node(6, 3, 'branch'), node(7, 6), node(8, 7)];

  it('takes the saves back to the fork, and no further', () => {
    expect(branchOfEnd(tree(), 8)).toEqual([8, 7, 6]);
    // The first child's line counts as a branch too, from its own end.
    expect(branchOfEnd(tree(), 5)).toEqual([5, 4]);
  });

  it('only from an end save, and only when there is another branch', () => {
    expect(branchOfEnd(tree(), 7)).toBeNull();
    expect(branchOfEnd(chain(5), 5)).toBeNull();
    expect(canDeleteFromEnd(chain(5), 5, 1)).toBe(false);
  });

  it("never the branch the live game is on, even partway along it", () => {
    expect(canDeleteFromEnd(tree(), 8, 5)).toBe(true);
    expect(canDeleteFromEnd(tree(), 8, 8)).toBe(false);
    expect(canDeleteFromEnd(tree(), 8, 7)).toBe(false);
    expect(canDeleteFromEnd(tree(), 5, 8)).toBe(true);
  });
});
