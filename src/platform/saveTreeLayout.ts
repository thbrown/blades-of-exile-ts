/**
 * Where each snapshot of a tree goes when the tree is drawn: across by
 * in-game time, down by branch. Pure, so it is tested without a DOM.
 *
 * **x is game time, counted in moves.** A move in town (or a fight) is one
 * tick of `party.age`; outdoors the clock runs ten ticks to a step. So the
 * distance between two saves is their tick difference, divided by ten when
 * the later one is outdoors — saves a move apart are a step apart wherever
 * they were taken, and five moves apart are five times as far. Past
 * `LINEAR_MOVES` the distance grows with the log of the gap instead, so a
 * night's rest (hundreds of moves) is clearly longer without flattening the
 * rest of the tree. There is no minimum spacing: crowded saves draw smaller
 * (the restore view's dots shrink with `gap`) rather than evening out.
 *
 * `scale` is pixels per move; given `fitWidth`, a tree wider than that is
 * squeezed to it — the restore view never scrolls — and `gap` says how close
 * the nodes typically ended up (the median, so one crowd doesn't decide it). Nodes of the same age share an x.
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
  /** The median distance between neighbouring distinct ages, after any squeeze. */
  gap: number;
  /** For drawing the day labels: x of the first node of each new day on lane 0. */
  days: { x: number; day: number }[];
  onHead: Set<number>;
}

export interface LayoutOptions {
  /** Pixels per move, at most (a wider tree is squeezed to `fitWidth`). */
  scale: number;
  /** Left and right margin. */
  pad: number;
  /** Squeeze the tree to this many px across, if it is wider. */
  fitWidth?: number;
}

const DAY = 3700;
/** `TOWN_NUM_OUTDOORS`: where a save outdoors says it is. */
const OUTDOORS = 200;
/** Outdoors the clock runs this many ticks to a step. */
export const OUTDOOR_TICKS_PER_MOVE = 10;
/** Gaps up to this many moves are drawn to scale; longer ones by their log. */
export const LINEAR_MOVES = 10;

/**
 * How far apart two saves `ticks` of game time apart are drawn, in moves:
 * linear up to `LINEAR_MOVES`, then 5 more for every doubling.
 */
export function moveDistance(ticks: number, outdoors: boolean): number {
  const moves = Math.max(0, ticks) / (outdoors ? OUTDOOR_TICKS_PER_MOVE : 1);
  return moves <= LINEAR_MOVES ? moves : LINEAR_MOVES + 5 * Math.log2(moves / LINEAR_MOVES);
}

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

  // x: distinct ages, left to right, as far apart as the moves between them.
  const ages = [...new Set(nodes.map((n) => n.gameAge))].sort((a, b) => a - b);
  const outdoorsAt = new Map<number, boolean>();
  for (const n of nodes) if (!outdoorsAt.has(n.gameAge)) outdoorsAt.set(n.gameAge, n.townNum >= OUTDOORS);
  const unitsOfAge = new Map<number, number>();
  let units = 0;
  ages.forEach((age, i) => {
    if (i > 0) units += moveDistance(age - ages[i - 1]!, outdoorsAt.get(age) ?? false);
    unitsOfAge.set(age, units);
  });
  let scale = opts.scale;
  if (opts.fitWidth !== undefined && units > 0 && 2 * opts.pad + units * scale > opts.fitWidth) {
    scale = Math.max(0, opts.fitWidth - 2 * opts.pad) / units;
  }
  const xOfAge = new Map<number, number>();
  for (const [age, u] of unitsOfAge) xOfAge.set(age, opts.pad + u * scale);
  // The typical spacing, not the tightest: one quick walk shouldn't shrink
  // every dot in the tree.
  const spacings = ages.slice(1).map((age, i) => xOfAge.get(age)! - xOfAge.get(ages[i]!)!).sort((a, b) => a - b);
  const gap = spacings.length === 0 ? Infinity : spacings[Math.floor(spacings.length / 2)]!;
  const prev = opts.pad + units * scale;

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
  return { at, lanes: Math.max(1, lanes), width: prev + opts.pad, gap, days, onHead };
}
