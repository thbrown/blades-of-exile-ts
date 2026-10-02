/**
 * Where each snapshot of a series goes when the tree is drawn: across by
 * in-game time, down by branch. Pure, so it is tested without a DOM.
 *
 * **x is game time**, `gameAge`, but relaxed: saves cluster (ten moves in a
 * town is ten ticks of a 3700-tick day), and on a true linear axis the newest
 * dozen would be one blob. So x is `age * scale`, pushed right where needed to
 * keep `minGap` pixels between the distinct ages — the order, and roughly the
 * spacing, are the game's own time. Nodes of the same age share an x.
 *
 * **y is the branch.** The lineage from the root to the head is lane 0. Every
 * other branch (a run of nodes from a fork point to the next fork or a tip)
 * takes the first lane below that is free over its span, so unrelated branches
 * share a row instead of stacking forever.
 */

import { SnapNode, lineage } from './saveRetention';

export interface TreeLayout {
  /** Position by seq. */
  at: Map<number, { x: number; lane: number }>;
  lanes: number;
  /** Total width in px. */
  width: number;
  /** For drawing the day labels: x of the first node of each new day on lane 0. */
  days: { x: number; day: number }[];
  onHead: Set<number>;
}

export interface LayoutOptions {
  /** Pixels per game day before relaxing. */
  scale: number;
  minGap: number;
  /** Left margin. */
  pad: number;
}

const DAY = 3700;

export function layoutTree(nodes: readonly SnapNode[], head: number, opts: LayoutOptions): TreeLayout {
  const children = new Map<number, SnapNode[]>();
  for (const n of nodes) {
    if (n.parent !== null) {
      const list = children.get(n.parent) ?? [];
      list.push(n);
      children.set(n.parent, list);
    }
  }
  const onHead = lineage(nodes, head);

  // x: distinct ages, left to right, never closer than minGap.
  const ages = [...new Set(nodes.map((n) => n.gameAge))].sort((a, b) => a - b);
  const xOfAge = new Map<number, number>();
  let prev = -Infinity;
  for (const age of ages) {
    const x = Math.max(opts.pad + (age / DAY) * opts.scale, prev + opts.minGap);
    xOfAge.set(age, x);
    prev = x;
  }

  // y: split into branches. The root's branch is the head lineage's; at a fork
  // the child that continues a branch is the head's, or else the newest.
  const newestIn = new Map<number, number>();
  const newest = (n: SnapNode): number => {
    let best = newestIn.get(n.seq);
    if (best === undefined) {
      best = Math.max(n.seq, ...(children.get(n.seq) ?? []).map(newest));
      newestIn.set(n.seq, best);
    }
    return best;
  };
  interface Branch { first: SnapNode; members: SnapNode[]; lane: number; from: number; to: number }
  const branches: Branch[] = [];
  const root = nodes.find((n) => n.parent === null);
  const lane = new Map<number, number>();
  if (root !== undefined) {
    // Iterative so a very long chain can't overflow the stack.
    const todo: SnapNode[] = [root];
    while (todo.length > 0) {
      const first = todo.pop()!;
      const members: SnapNode[] = [];
      for (let at: SnapNode | undefined = first; at !== undefined;) {
        members.push(at);
        const kids: SnapNode[] = children.get(at.seq) ?? [];
        if (kids.length === 0) break;
        const keep: SnapNode = kids.find((k) => onHead.has(k.seq))
          ?? kids.reduce((a, b) => (newest(b) > newest(a) ? b : a));
        for (const k of kids) if (k !== keep) todo.push(k);
        at = keep;
      }
      const parentAge = first.parent === null ? first.gameAge
        : nodes.find((n) => n.seq === first.parent)?.gameAge ?? first.gameAge;
      branches.push({
        first, members, lane: 0, from: parentAge, to: members[members.length - 1]!.gameAge,
      });
    }
  }
  // Lane 0 is the branch holding the head; the rest pack by start time.
  const main = branches.find((b) => b.members.some((m) => m.seq === head)) ?? branches[0];
  const free: number[] = []; // per lane (index 0 unused for others): the age its last branch ends
  let lanes = main === undefined ? 0 : 1;
  const others = branches.filter((b) => b !== main).sort((a, b) => a.from - b.from || a.first.seq - b.first.seq);
  if (main !== undefined) { main.lane = 0; free[0] = Infinity; }
  for (const b of others) {
    let l = 1;
    while ((free[l] ?? -Infinity) >= b.from) l++;
    b.lane = l;
    free[l] = b.to;
    lanes = Math.max(lanes, l + 1);
  }
  for (const b of branches) for (const m of b.members) lane.set(m.seq, b.lane);

  const at = new Map<number, { x: number; lane: number }>();
  for (const n of nodes) at.set(n.seq, { x: xOfAge.get(n.gameAge)!, lane: lane.get(n.seq) ?? 0 });

  const days: TreeLayout['days'] = [];
  let lastDay = -1;
  for (const n of nodes.filter((m) => lane.get(m.seq) === 0).sort((a, b) => a.gameAge - b.gameAge)) {
    const day = Math.floor(n.gameAge / DAY) + 1;
    if (day !== lastDay) { days.push({ x: at.get(n.seq)!.x, day }); lastDay = day; }
  }
  return { at, lanes: Math.max(1, lanes), width: prev + opts.pad, days, onHead };
}
