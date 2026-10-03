/**
 * When and how the game writes itself into its save tree, without the player
 * ever feeling it.
 *
 * `autosave.ts` only *notes* that a save is wanted — from inside `increase_age`,
 * which cannot wait on anything, and which runs mid-turn. A save is two halves:
 *
 *  - **The capture** — serialising the universe — has to be on the main thread
 *    and has to happen at a moment the game could be saved (no dialog, no
 *    animation, not in combat). It is taken in an idle callback, and also, by
 *    `captureIfPending`, **just before the next action starts**: the host calls
 *    that at its action gates, which only open once the last move's monsters
 *    and animations are done. So the state after *every* move is captured
 *    before the next move can change it — the idle callback alone lost most of
 *    them while a walk kept the game busy (14 saves in 60 moves).
 *  - **The write** — gzip in fflate's worker, then an IndexedDB transaction —
 *    is queued, and the queue runs one write at a time, in order. Captures
 *    are never dropped or folded; only requests made *between* two captures
 *    fold into one, and a milestone outranks a tick.
 *
 * A capture identical to the last one is skipped (the player stood still).
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
  /** A save landed. */
  saved?(result: { treeId: string; seq: number; kind: SnapKind; reason: string; evicted: number }): void;
  failed?(err: unknown): void;
  /** Run `fn` when the browser is idle. Replaceable for tests. */
  idle?(fn: () => void): void;
  /** gzip, off the main thread. Replaceable for tests. */
  compress?(raw: Uint8Array): Promise<Uint8Array>;
}

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

/** One captured save, waiting for its write. */
interface Job {
  kind: SnapKind;
  reason: string;
  cap: Capture;
  /** gzip on the main thread and skip the picture: the page is going away. */
  sync: boolean;
  done(seq: number): void;
  fail(err: unknown): void;
}

export class SaveScheduler {
  private pending: { kind: SnapKind; reason: string } | null = null;
  private armed = false;
  private readonly queue: Job[] = [];
  private draining: Promise<void> | null = null;
  /** The last capture taken, to skip an identical one. */
  private last: { treeId: string | null; raw: Uint8Array } | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  /** A save is wanted (from `autosave.ts`). Cheap: just a note, and an idle callback. */
  request(reason: string, kind: SnapKind): void {
    if (this.pending === null || (kind === 'milestone' && this.pending.kind === 'auto')) {
      this.pending = { kind, reason };
    }
    this.arm();
  }

  /**
   * Take what is pending now, if the game is at a savable moment — for the
   * host to call just before an action starts, so no move's end goes unsaved.
   * Only the serialise happens here; the write is queued.
   */
  captureIfPending(): void {
    if (this.pending === null || !this.deps.ready()) return;
    const job = this.pending;
    this.pending = null;
    void this.enqueue(job.kind, job.reason, false, false)
      .catch((err: unknown) => { this.deps.failed?.(err); });
  }

  private arm(delay = 0): void {
    if (this.armed) return;
    this.armed = true;
    const go = (): void => {
      this.armed = false;
      if (this.pending === null) return;
      if (!this.deps.ready()) this.arm(RETRY_MS);
      else this.captureIfPending();
    };
    if (delay > 0) setTimeout(() => { (this.deps.idle ?? defaultIdle)(go); }, delay);
    else (this.deps.idle ?? defaultIdle)(go);
  }

  /**
   * Save right now, because the player asked (Ctrl+S): no idle wait, no skip for
   * an unchanged game. Resolves with the new snapshot's seq, or null if there
   * was nothing to save.
   */
  async saveNow(reason: string, kind: SnapKind = 'manual'): Promise<number | null> {
    return this.enqueue(kind, reason, true, false);
  }

  /**
   * Save now, and wait for it, unless the game is unchanged since the last
   * save — for leaving the game for the main menu, which has time to wait.
   * Whatever was pending is folded in. Resolves with the new snapshot's seq,
   * or null if nothing needed writing.
   */
  async saveIfChanged(reason: string): Promise<number | null> {
    const kind = this.pending?.kind ?? 'auto';
    this.pending = null;
    const seq = await this.enqueue(kind, reason, false, false);
    // Whatever was queued ahead of it has landed too.
    await this.drained();
    return seq;
  }

  /**
   * Save now if the game is at a savable moment and has changed — for when the
   * page is being hidden or closed, which will not wait for a worker. Every
   * write still queued gzips on the main thread from here on, without its
   * picture.
   */
  flush(reason: string): void {
    for (const job of this.queue) job.sync = true;
    if (!this.deps.ready()) return;
    const kind = this.pending?.kind ?? 'auto';
    this.pending = null;
    void this.enqueue(kind, reason, false, true)
      .catch((err: unknown) => { this.deps.failed?.(err); });
  }

  /** Resolves when nothing is queued or in flight — for tests and page unload. */
  async settled(): Promise<void> {
    for (let i = 0; i < 50 && (this.pending !== null || this.draining !== null || this.armed); i++) {
      if (this.draining !== null) await this.drained();
      else await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** How many captures are waiting to be written — for the verifiers. */
  get queued(): number {
    return this.queue.length + (this.draining !== null ? 1 : 0);
  }

  private async drained(): Promise<void> {
    while (this.draining !== null) await this.draining;
  }

  /**
   * Capture now and queue the write; resolves with the seq once it is written,
   * or null if there was nothing to capture or it was the same as the last.
   */
  private enqueue(kind: SnapKind, reason: string, force: boolean, sync: boolean): Promise<number | null> {
    const cap = this.deps.capture();
    if (cap === null) return Promise.resolve(null);
    const treeId = this.deps.treeId();
    if (!force && this.last !== null && (this.last.treeId === null || this.last.treeId === treeId)
      && sameBytes(this.last.raw, cap.raw)) {
      return Promise.resolve(null);
    }
    this.last = { treeId, raw: cap.raw };
    return new Promise<number>((done, fail) => {
      this.queue.push({ kind, reason, cap, sync, done, fail });
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining !== null) return;
    this.draining = (async () => {
      for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
        try {
          job.done(await this.write(job));
        } catch (err) {
          job.fail(err);
        }
      }
    })().finally(() => {
      this.draining = null;
      if (this.queue.length > 0) this.drain();
    });
  }

  private async write(job: Job): Promise<number> {
    const { cap, kind, reason } = job;
    const [data, thumb] = job.sync
      ? [gzipSync(cap.raw, { level: 3 }), null]
      : await Promise.all([(this.deps.compress ?? compressAsync)(cap.raw), cap.thumb]);
    const input: SnapInput = { data, preview: cap.preview, place: cap.place, thumb, kind, reason };

    let treeId = this.deps.treeId();
    let seq: number;
    let evicted = 0;
    if (treeId === null) {
      const made = await createTree(this.deps.treeName(), input);
      treeId = made.tree.id;
      seq = made.snap.seq;
      this.deps.setTreeId(treeId);
      if (this.last !== null && this.last.treeId === null) this.last = { ...this.last, treeId };
    } else {
      const result: AppendResult = await appendSnapshot(treeId, input);
      seq = result.snap.seq;
      evicted = result.evicted.length;
    }
    this.deps.saved?.({ treeId, seq, kind, reason, evicted });
    return seq;
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
