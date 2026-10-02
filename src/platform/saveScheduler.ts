/**
 * When and how the game writes itself into its save tree, without the player
 * ever feeling it.
 *
 * `autosave.ts` only *notes* that a save is wanted — from inside `increase_age`,
 * which cannot wait on anything. The work happens here, off the hot path:
 *
 *  - **Deferred to idle.** A request sets a pending flag; the write runs in an
 *    idle callback, and only at a moment the game could be saved (no dialog, no
 *    animation, not in combat). A tick pending during a fight just waits for it
 *    to end.
 *  - **Only the serialise is on the main thread** — it has to read the
 *    universe. gzip runs in a worker (fflate's async API) and the write is an
 *    IndexedDB transaction, both off-thread.
 *  - **Coalesced.** One write at a time; whatever is asked for meanwhile is
 *    folded into a single follow-up, and a milestone outranks a tick.
 *  - **Skips a save identical to the last** (the player stood still).
 *  - **Watches itself.** The main-thread cost of each save is timed, and if the
 *    slow end of the last twenty is over a budget, the tick interval doubles
 *    rather than hitching every tenth move on a big scenario.
 *
 * Saving rolls no dice, so `get_ran`'s order is untouched.
 */

import { gzip, gzipSync } from 'fflate';
import { SavePreview } from '../fileio/saveIo';
import { AppendResult, SnapInput, appendSnapshot, createTree } from './saveStore';
import { SnapKind } from './saveRetention';

/** What the host hands over for one save: the cheap, must-be-synchronous half. */
export interface Capture {
  /** The uncompressed `.exg` tarball. */
  raw: Uint8Array;
  preview: SavePreview;
  /** Where the party is, for the restore tree. */
  place: string;
  /** Resolves to the picture; the canvas it came from is already copied. */
  thumb: Promise<Uint8Array | null>;
}

export interface SchedulerDeps {
  /** Whether the game is at a moment that could be saved. */
  ready(): boolean;
  /** Serialise the game now (synchronously) — null if there is nothing to save. */
  capture(): Capture | null;
  treeId(): string | null;
  setTreeId(id: string): void;
  /** The name a new tree is given. */
  treeName(): string;
  budgetBytes(): number;
  /** A save landed. */
  saved?(result: { treeId: string; seq: number; kind: SnapKind; reason: string; overBudget: boolean }): void;
  failed?(err: unknown): void;
  /** The saves are costing too much main-thread time; the host should space them out. */
  slow?(p95Ms: number): void;
  /** Run `fn` when the browser is idle. Replaceable for tests. */
  idle?(fn: () => void): void;
  /** gzip, off the main thread. Replaceable for tests. */
  compress?(raw: Uint8Array): Promise<Uint8Array>;
  now?(): number;
}

/** Over this many ms at the 95th percentile, the tick backs off. A frame is ~16. */
export const SLOW_P95_MS = 12;
const SAMPLES = 20;
/** How long to wait before asking again when the game isn't at a savable moment. */
const RETRY_MS = 500;

export const compressAsync = (raw: Uint8Array): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    // Level 3: nearly as small as 6 on these files, and cheaper.
    gzip(raw, { level: 3 }, (err, out) => { if (err) reject(err); else resolve(out); });
  });

const defaultIdle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 1000 });
  else setTimeout(fn, 50);
};

export class SaveScheduler {
  private pending: { kind: SnapKind; reason: string } | null = null;
  private armed = false;
  private writing: Promise<void> | null = null;
  private last: { treeId: string; raw: Uint8Array } | null = null;
  private costs: number[] = [];

  constructor(private readonly deps: SchedulerDeps) {}

  /** A save is wanted (from `autosave.ts`). Cheap: just a note, and an idle callback. */
  request(reason: string, kind: SnapKind): void {
    if (this.pending === null || (kind === 'milestone' && this.pending.kind === 'auto')) {
      this.pending = { kind, reason };
    }
    this.arm();
  }

  private arm(delay = 0): void {
    if (this.armed) return;
    this.armed = true;
    const go = (): void => {
      this.armed = false;
      void this.pump();
    };
    if (delay > 0) setTimeout(() => { (this.deps.idle ?? defaultIdle)(go); }, delay);
    else (this.deps.idle ?? defaultIdle)(go);
  }

  private async pump(): Promise<void> {
    if (this.pending === null) return;
    if (this.writing !== null) return; // the follow-up is armed when it finishes
    if (!this.deps.ready()) {
      this.arm(RETRY_MS);
      return;
    }
    const job = this.pending;
    this.pending = null;
    this.writing = this.write(job.kind, job.reason, false, false)
      .then(() => undefined, (err: unknown) => { this.deps.failed?.(err); })
      .finally(() => {
        this.writing = null;
        if (this.pending !== null) this.arm();
      });
    await this.writing;
  }

  /**
   * Save right now, because the player asked (Ctrl+S): no idle wait, no skip for
   * an unchanged game. Resolves with the new snapshot's seq, or null if there
   * was nothing to save.
   */
  async saveNow(reason: string, kind: SnapKind = 'manual'): Promise<number | null> {
    // Let a write in flight land first, so this one is its child, not a rival.
    while (this.writing !== null) await this.writing;
    return this.write(kind, reason, true);
  }

  /**
   * Save now, and wait for it, unless the game is unchanged since the last
   * save — for leaving the game for the main menu, which has time to wait.
   * Whatever was pending is folded in. Resolves with the new snapshot's seq,
   * or null if nothing needed writing.
   */
  async saveIfChanged(reason: string): Promise<number | null> {
    while (this.writing !== null) await this.writing;
    const kind = this.pending?.kind ?? 'auto';
    this.pending = null;
    const job = this.write(kind, reason, false);
    this.writing = job.then(() => undefined, () => undefined).finally(() => { this.writing = null; });
    return job;
  }

  /**
   * Save now if the game is at a savable moment and has changed — for when the
   * page is being hidden or closed, which will not wait for a worker. gzips on
   * the main thread this once, and does not wait for the picture.
   */
  flush(reason: string): void {
    if (!this.deps.ready() || this.writing !== null) return;
    this.pending = null;
    this.writing = this.write('auto', reason, false, true)
      .then(() => undefined, (err: unknown) => { this.deps.failed?.(err); })
      .finally(() => { this.writing = null; });
  }

  /** Resolves when nothing is queued or in flight — for tests and page unload. */
  async settled(): Promise<void> {
    for (let i = 0; i < 50 && (this.pending !== null || this.writing !== null || this.armed); i++) {
      if (this.writing !== null) await this.writing;
      else await new Promise((r) => setTimeout(r, 10));
    }
  }

  private async write(kind: SnapKind, reason: string, force: boolean, sync = false): Promise<number | null> {
    const now = this.deps.now ?? (() => performance.now());
    const t0 = now();
    const cap = this.deps.capture();
    this.recordCost(now() - t0);
    if (cap === null) return null;

    const existing = this.deps.treeId();
    if (!force && existing !== null && this.last?.treeId === existing && sameBytes(this.last.raw, cap.raw)) {
      return null;
    }
    const [data, thumb] = sync
      ? [gzipSync(cap.raw, { level: 3 }), null]
      : await Promise.all([(this.deps.compress ?? compressAsync)(cap.raw), cap.thumb]);
    const input: SnapInput = { data, preview: cap.preview, place: cap.place, thumb, kind, reason };

    let result: AppendResult | null = null;
    let treeId = this.deps.treeId();
    let seq: number;
    if (treeId === null) {
      const made = await createTree(this.deps.treeName(), input);
      treeId = made.tree.id;
      seq = made.snap.seq;
      this.deps.setTreeId(treeId);
    } else {
      result = await appendSnapshot(treeId, input, this.deps.budgetBytes());
      seq = result.snap.seq;
    }
    this.last = { treeId, raw: cap.raw };
    this.deps.saved?.({ treeId, seq, kind, reason, overBudget: result?.overBudget ?? false });
    return seq;
  }

  private recordCost(ms: number): void {
    this.costs.push(ms);
    if (this.costs.length > SAMPLES) this.costs.shift();
    if (this.costs.length < SAMPLES) return;
    const sorted = [...this.costs].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(SAMPLES * 0.95) - 1]!;
    if (p95 > SLOW_P95_MS) {
      this.costs = [];
      this.deps.slow?.(p95);
    }
  }

  /** Forget the byte comparison — a game was loaded, so the next save is a new state. */
  reset(): void {
    this.last = null;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
