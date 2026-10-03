/**
 * Which snapshots of a save tree are kept — pure, so it is tested headless.
 *
 * A game's saves are a *tree*: every snapshot has a parent (the root has none), and
 * restoring an old one then playing on grows a second child under it. The game
 * saves after every move, so something has to go; what goes is decided here.
 *
 * **Only autosaves are ever thinned, and only down to a cap** (`maxAuto` on the
 * tree, `DEFAULT_MAX_AUTO_SAVES` by default). Until the cap is reached nothing
 * is deleted at all. Past it, each new autosave evicts one old one, picked at
 * random with the odds leaning on the old: an autosave with k newer ones
 * weighs `ln(1 + k)`. So the newest autosave (k = 0) never goes — the move
 * just before this one is always there — and the history thins smoothly with
 * age instead of being cut off at a fixed depth. The dice are `Math.random`,
 * never the game's: saving must not touch `get_ran`'s sequence.
 *
 * A node's **role** is what it is to the tree, which is not always what it was
 * saved as:
 *  - the **root** — the tree's identity; it only goes with the whole game;
 *  - a **branch** save — the first save of a branch, the child a restore grew.
 *    It only goes with its branch. Stored as kind `'branch'` when it is
 *    written; a tree from before that is read by shape (below);
 *  - an **end** save — a leaf, the tip of a branch (the live game's newest save
 *    is one). It only goes with its branch. A leaf stops being an end the
 *    moment play continues from it, so this is worked out, never stored;
 *  - otherwise its kind: `auto`, `milestone` (a named moment) or `manual`
 *    (the player's own). Milestones and manual saves are never thinned, but the
 *    player may delete them one at a time.
 *
 * Only role-`auto` nodes count toward the cap. Fork points (two or more
 * children) are role-`auto` when they were autosaves, but are never evicted:
 * they are where the player went back to, and the branches hang off them.
 */

/** Game ticks in a day (`party.age` / 3700). */
export const DAY = 3700;

/** How many autosaves a tree keeps, unless the player says otherwise. */
export const DEFAULT_MAX_AUTO_SAVES = 50;

export type SnapKind = 'auto' | 'milestone' | 'manual' | 'branch';

export type SnapRole = 'root' | 'branch' | 'end' | 'auto' | 'milestone' | 'manual';

export interface SnapNode {
  seq: number;
  /** Null for the root. */
  parent: number | null;
  /** `party.age` when it was saved — the tree's time axis. */
  gameAge: number;
  kind: SnapKind;
  /** Which town (200 = outdoors). */
  townNum: number;
  /** Stored size, thumbnail included. */
  bytes: number;
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

/** Children by parent, each list in seq order. */
export function childrenOf(nodes: readonly SnapNode[]): Map<number, SnapNode[]> {
  const children = new Map<number, SnapNode[]>();
  for (const n of [...nodes].sort((a, b) => a.seq - b.seq)) {
    if (n.parent === null) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  return children;
}

/**
 * Whether `n` starts a branch: saved as one, or — for a tree written before
 * branch saves had a kind — a child of a fork that isn't its first child.
 */
export function isBranchStart(n: SnapNode, children: ReadonlyMap<number, readonly SnapNode[]>): boolean {
  if (n.kind === 'branch') return true;
  if (n.parent === null) return false;
  const siblings = children.get(n.parent) ?? [];
  return siblings.length >= 2 && siblings[0]!.seq !== n.seq;
}

export function roleOf(n: SnapNode, children: ReadonlyMap<number, readonly SnapNode[]>): SnapRole {
  if (n.parent === null) return 'root';
  if (isBranchStart(n, children)) return 'branch';
  if ((children.get(n.seq) ?? []).length === 0) return 'end';
  // A stored 'branch' was caught above.
  return n.kind as Exclude<SnapKind, 'branch'>;
}

/** Every node's role, by seq. */
export function roles(nodes: readonly SnapNode[]): Map<number, SnapRole> {
  const children = childrenOf(nodes);
  return new Map(nodes.map((n) => [n.seq, roleOf(n, children)]));
}

/** How many nodes count toward the autosave cap. */
export function autoCount(nodes: readonly SnapNode[], head: number): number {
  const r = roles(nodes);
  return nodes.filter((n) => n.seq !== head && r.get(n.seq) === 'auto').length;
}

/** The autosaves that may be evicted, oldest first. */
export function autoCandidates(nodes: readonly SnapNode[], head: number): SnapNode[] {
  const children = childrenOf(nodes);
  return nodes
    .filter((n) => n.seq !== head && roleOf(n, children) === 'auto'
      && (children.get(n.seq) ?? []).length === 1)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * One autosave to evict, or null if none may go. Weighted `ln(1 + k)` by how
 * many candidates are newer, so the newest is never picked (unless it is the
 * only one, and the cap is below one).
 */
export function pickAutoVictim(
  nodes: readonly SnapNode[], head: number, rand: () => number = Math.random,
): number | null {
  const pool = autoCandidates(nodes, head);
  if (pool.length === 0) return null;
  const weights = pool.map((_, i) => Math.log(1 + (pool.length - 1 - i)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[0]!.seq;
  let r = rand() * total;
  for (const [i, w] of weights.entries()) {
    if (r < w) return pool[i]!.seq;
    r -= w;
  }
  // Floating-point slack at the very top of the range: the last with weight.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return pool[i]!.seq;
  return pool[0]!.seq;
}

/**
 * Autosaves to evict until at most `max` remain — the order they were
 * picked in. Fewer, if the rest are all protected.
 */
export function trimAutos(
  nodes: readonly SnapNode[], head: number, max: number, rand: () => number = Math.random,
): number[] {
  // Deleting the first child of a fork would make its sibling look first, so
  // a branch known only by its shape is pinned down before anything goes.
  let tree = freezeBranches(nodes);
  const gone: number[] = [];
  while (autoCount(tree, head) > max) {
    const victim = pickAutoVictim(tree, head, rand);
    if (victim === null) break;
    gone.push(victim);
    tree = reparent(tree, [victim]);
  }
  return gone;
}

/**
 * The tree with every branch start known only by its shape (a tree saved
 * before branch saves had a kind) given kind `'branch'`, so deleting around it
 * can't change what it is. Nodes that change are new objects.
 */
export function freezeBranches<T extends SnapNode>(nodes: readonly T[]): T[] {
  const children = childrenOf(nodes);
  return nodes.map((n) => (n.kind === 'auto' && isBranchStart(n, children) ? { ...n, kind: 'branch' } : n));
}

/**
 * Whether the player may delete this one save on its own: a milestone, a
 * manual save or a plain autosave, but never the root, a branch's first or
 * last save, or the save the live game is at.
 */
export function canDeleteSingle(nodes: readonly SnapNode[], seq: number, head: number): boolean {
  if (seq === head) return false;
  const n = nodes.find((m) => m.seq === seq);
  if (n === undefined) return false;
  const role = roleOf(n, childrenOf(nodes));
  return role === 'auto' || role === 'milestone' || role === 'manual';
}

/** `seq` and everything below it. */
export function subtree(nodes: readonly SnapNode[], seq: number): Set<number> {
  const children = childrenOf(nodes);
  const out = new Set<number>();
  const todo = [seq];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (out.has(at)) continue;
    out.add(at);
    for (const c of children.get(at) ?? []) todo.push(c.seq);
  }
  return out;
}

/** Whether the branch starting at `seq` may be deleted: it starts one, and the live game isn't on it. */
export function canDeleteBranch(nodes: readonly SnapNode[], seq: number, head: number): boolean {
  const n = nodes.find((m) => m.seq === seq);
  if (n === undefined || !isBranchStart(n, childrenOf(nodes))) return false;
  return !subtree(nodes, seq).has(head);
}

/**
 * The branch an end save closes: the saves from just below the nearest fork
 * above it down to it, tip first. Every one of them has a single child (the
 * nearest fork is where that stops), so deleting them takes no other branch
 * with them. Null when `seq` isn't a leaf, or no fork is above it — a tree of
 * one line has no other branch to keep.
 */
export function branchOfEnd(nodes: readonly SnapNode[], seq: number): number[] | null {
  const children = childrenOf(nodes);
  if ((children.get(seq) ?? []).length > 0) return null;
  const byId = new Map(nodes.map((n) => [n.seq, n]));
  const run: number[] = [];
  for (let at = byId.get(seq); at !== undefined; at = at.parent === null ? undefined : byId.get(at.parent)) {
    run.push(at.seq);
    if (at.parent === null) return null;
    if ((children.get(at.parent) ?? []).length > 1) return run;
  }
  return null;
}

/**
 * Whether the branch an end save closes may be deleted from it: there is
 * another branch to keep, and none of it is on the line the live game is
 * playing (the live game may have been restored partway along it).
 */
export function canDeleteFromEnd(nodes: readonly SnapNode[], seq: number, head: number): boolean {
  const run = branchOfEnd(nodes, seq);
  if (run === null) return false;
  const live = lineage(nodes, head);
  return !run.some((s) => live.has(s));
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
