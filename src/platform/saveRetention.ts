/**
 * Which snapshots of a save tree to keep — pure, so it is tested headless.
 *
 * A game's saves are a *tree*: every snapshot has a parent (the root has none), and
 * restoring an old one then playing on grows a second child under it. Saving
 * happens every few moves, so the history has to thin out with age or it would
 * eat the browser's storage; but it must stay possible to get back to the
 * major milestones.
 *
 * Snapshot-thinning schemes (Time Machine, snapper, restic's `--keep-*`) all
 * agree on one thing worth copying: thin on a **fixed grid**, never by rank from
 * the newest. Rank-based thinning drifts — today's keeper is tomorrow's victim,
 * and the store churns. A grid keeps whatever it kept. The grid here is in
 * **game time** (`party.age`, 3700 to a day), because wall-clock gaps mean
 * nothing — a week away from the game is not a week of the game.
 *
 * Never deleted: the root (the tree's identity), the head (where the live game
 * is), every leaf (a branch's tip — deleting one would lose a branch outright),
 * every fork point, and manual saves, which are the player's own.
 */

/** Game ticks in a day (`party.age` / 3700). */
export const DAY = 3700;

export type SnapKind = 'auto' | 'milestone' | 'manual';

export interface SnapNode {
  seq: number;
  /** Null for the root. */
  parent: number | null;
  /** `party.age` when it was saved — the tree's time axis. */
  gameAge: number;
  kind: SnapKind;
  /** Which town (200 = outdoors); milestones are thinned per town and day. */
  townNum: number;
  /** Stored size, thumbnail included, for the budget. */
  bytes: number;
}

/** Tuning, all in one place — calibrate against `scripts/bench-save.ts`. */
export const RETENTION = {
  /** The newest this many snapshots on the head's lineage are all kept. */
  recent: 12,
  /** Within a day of the head: one per this many ticks. */
  dayGrid: DAY / 8,
  /** Within a week: one per day. Beyond: one per `farGrid`. */
  weekGrid: DAY,
  farGrid: 7 * DAY,
  /** Milestones are all kept this close to the head. */
  milestoneKeepAll: 2 * DAY,
  /** Default per-tree budget. */
  budgetBytes: 10 * 1024 * 1024,
};

export interface ThinResult {
  /** Snapshots to delete (children of these are reparented — see `reparent`). */
  remove: number[];
  /** True if even the protected set exceeds the budget. */
  overBudget: boolean;
}

/** The root→head path, as a set of seqs. */
export function lineage(nodes: readonly SnapNode[], head: number): Set<number> {
  const byId = new Map(nodes.map((n) => [n.seq, n]));
  const path = new Set<number>();
  for (let at = byId.get(head); at !== undefined && !path.has(at.seq);
    at = at.parent === null ? undefined : byId.get(at.parent)) {
    path.add(at.seq);
  }
  return path;
}

export function thin(
  nodes: readonly SnapNode[], head: number, budgetBytes: number = RETENTION.budgetBytes,
): ThinResult {
  const childCount = new Map<number, number>();
  for (const n of nodes) {
    if (n.parent !== null) childCount.set(n.parent, (childCount.get(n.parent) ?? 0) + 1);
  }
  const protectedNode = (n: SnapNode): boolean =>
    n.parent === null || n.seq === head || n.kind === 'manual'
    || (childCount.get(n.seq) ?? 0) !== 1; // a leaf (0) or a fork (2+)

  const onHead = lineage(nodes, head);
  const headAge = nodes.find((n) => n.seq === head)?.gameAge ?? 0;
  const keep = new Set<number>();
  for (const n of nodes) if (protectedNode(n)) keep.add(n.seq);

  // Newest wins each grid cell, so what a later pass keeps is what an earlier
  // one did: scan oldest→newest and let the later node overwrite the cell.
  const bySeq = [...nodes].sort((a, b) => a.seq - b.seq);
  const cells = new Map<string, number>();
  const claim = (key: string, seq: number): void => { cells.set(key, seq); };

  const lineageNewestFirst = bySeq.filter((n) => onHead.has(n.seq)).reverse();
  const recent = new Set(lineageNewestFirst.slice(0, RETENTION.recent).map((n) => n.seq));

  for (const n of bySeq) {
    if (protectedNode(n)) continue;
    if (onHead.has(n.seq)) {
      if (recent.has(n.seq)) { keep.add(n.seq); continue; }
      const behind = Math.max(0, headAge - n.gameAge);
      if (n.kind === 'milestone') {
        if (behind <= RETENTION.milestoneKeepAll) { keep.add(n.seq); continue; }
        claim(`m:${n.townNum}:${Math.floor(n.gameAge / DAY)}`, n.seq);
      }
      const width = behind <= DAY ? RETENTION.dayGrid
        : behind <= 7 * DAY ? RETENTION.weekGrid : RETENTION.farGrid;
      claim(`a:${width}:${Math.floor(n.gameAge / width)}`, n.seq);
    } else {
      // An abandoned branch: its tip and fork point are protected; the rest
      // thins to a milestone per town and one snapshot a day.
      if (n.kind === 'milestone') claim(`bm:${n.townNum}`, n.seq);
      claim(`b:${Math.floor(n.gameAge / DAY)}`, n.seq);
    }
  }
  for (const seq of cells.values()) keep.add(seq);

  const remove = nodes.filter((n) => !keep.has(n.seq)).map((n) => n.seq);

  // The budget backstop: drop the least valuable of what is left until it fits.
  const gone = new Set(remove);
  let total = nodes.reduce((sum, n) => sum + (gone.has(n.seq) ? 0 : n.bytes), 0);
  if (total > budgetBytes) {
    // Least valuable first: abandoned branches, then the head lineage's plain
    // snapshots, then its milestones; within each, the furthest back goes first.
    const tier = (n: SnapNode): number => !onHead.has(n.seq) ? 0 : n.kind === 'milestone' ? 2 : 1;
    const behind = (n: SnapNode): number => Math.max(0, headAge - n.gameAge);
    const victims = nodes
      .filter((n) => !gone.has(n.seq) && !protectedNode(n))
      .sort((a, b) => tier(a) - tier(b) || behind(b) - behind(a));
    for (const v of victims) {
      if (total <= budgetBytes) break;
      total -= v.bytes;
      remove.push(v.seq);
    }
  }
  return { remove, overBudget: total > budgetBytes };
}

/**
 * The tree after deleting `remove`: each survivor whose parent went is hung from
 * its nearest surviving ancestor, so the tree stays connected.
 */
export function reparent(nodes: readonly SnapNode[], remove: Iterable<number>): SnapNode[] {
  const gone = new Set(remove);
  const byId = new Map(nodes.map((n) => [n.seq, n]));
  const survivor = (parent: number | null): number | null => {
    let at = parent;
    while (at !== null && gone.has(at)) at = byId.get(at)?.parent ?? null;
    return at;
  };
  return nodes.filter((n) => !gone.has(n.seq)).map((n) => ({ ...n, parent: survivor(n.parent) }));
}
