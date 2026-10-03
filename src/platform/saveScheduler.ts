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
 * **No two saves in a row are the same game.** A capture identical to the last
 * one (the player stood still, or a milestone fired on the move a tick just
 * saved) is not written again. If it is the better kind — a milestone over the
 * player's own save over an autosave — the save already written takes its kind
 * and reason instead (`promoteSnapshot`); otherwise it is dropped. A loaded
 * game starts out as the save it came from (`loaded`), so reloading, or
 * restoring and standing still, adds nothing.
 *
 * **A page going away** (`flush`) cannot wait for IndexedDB, let alone for the
 * gzip worker a write may be stuck behind. So the newest capture, if its write
 * hasn't landed, is also handed to `park` — gzipped on the main thread, for the
 * host to keep somewhere synchronous — and `unpark`ed once it has. The next
 * load of that tree adds it (`main.ts`).
 *
 * Saving rolls no dice, so `get_ran`'s order is untouched.
 */

import { gzip, gzipSync } from 'fflate';
import { SavePreview } from '../fileio/saveIo';
import { sameTarContents } from '../fileio/tarball';
import { AppendResult, SnapInput, appendSnapshot, createTree, promoteSnapshot } from './saveStore';
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
  /** A save landed — or an identical one already written took this one's kind (`promoted`). */
  saved?(result: { treeId: string; seq: number; kind: SnapKind; reason: string; evicted: number; promoted?: boolean }): void;
  failed?(err: unknown): void;
  /** Run `fn` when the browser is idle. Replaceable for tests. */
  idle?(fn: () => void): void;
  /** gzip, off the main thread. Replaceable for tests. */
  compress?(raw: Uint8Array): Promise<Uint8Array>;
  /**
   * The page is going away before this capture's write has landed: keep it
   * somewhere synchronous (a gzipped `.exg`), to be added to the tree on the
   * next load.
   */
  park?(unsaved: Unsaved): void;
  /** What was parked has been written after all. */
  unpark?(): void;
}

/** A capture parked by `flush`. */
export interface Unsaved {
  treeId: string;
  /** A gzipped `.exg`, as the tree stores it. */
  data: Uint8Array;
  kind: SnapKind;
  reason: string;
}

/**
 * Which of two identical saves is kept: a milestone, then the player's own,
 * then an autosave. A branch save is an autosave that happened to start a branch.
 */
export const KIND_RANK: Record<SnapKind, number> = { auto: 1, branch: 1, manual: 2, milestone: 3 };

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

/** The newest game captured: what the next capture is compared with. */
interface Last {
  treeId: string | null;
  raw: Uint8Array;
  kind: SnapKind;
  reason: string;
  /** Its seq once written; null if the write failed. Never rejects. */
  seq: Promise<number | null>;
  /** Whether it is in the tree yet. */
  landed: boolean;
}

/** One queued piece of work: a capture to write, or a save already written to promote. */
interface Job {
  kind: SnapKind;
  reason: string;
  /** Absent for a promotion. */
  cap?: Capture;
  rec: Last;
  /** gzip on the main thread and skip the picture: the page is going away. */
  sync: boolean;
  done(seq: number | null): void;
  fail(err: unknown): void;
}

export class SaveScheduler {
  private pending: { kind: SnapKind; reason: string } | null = null;
  private armed = false;
  private readonly queue: Job[] = [];
  private draining: Promise<void> | null = null;
  private last: Last | null = null;
  /** What `flush` handed to `park`, until it lands. */
  private parked: Last | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  /** A save is wanted (from `autosave.ts`). Cheap: just a note, and an idle callback. */
  request(reason: string, kind: SnapKind): void {
    if (this.pending === null || KIND_RANK[kind] > KIND_RANK[this.pending.kind]) {
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
   * Save right now, because the player asked (Ctrl+S): no idle wait. An
   * unchanged game is not saved twice — the save it already is becomes a
   * manual one, unless it is a milestone. Resolves with the seq of the save
   * that holds the game, or null if there was nothing to save.
   */
  async saveNow(reason: string, kind: SnapKind = 'manual'): Promise<number | null> {
    return this.enqueue(kind, reason, false, true);
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
   * picture; and the newest capture, if it isn't in the tree yet, is parked.
   */
  flush(reason: string): void {
    for (const job of this.queue) job.sync = true;
    if (this.deps.ready()) {
      const kind = this.pending?.kind ?? 'auto';
      this.pending = null;
      void this.enqueue(kind, reason, true, false)
        .catch((err: unknown) => { this.deps.failed?.(err); });
    }
    const rec = this.last;
    const treeId = rec?.treeId ?? this.deps.treeId();
    if (rec === null || rec.landed || treeId === null || this.deps.park === undefined) return;
    this.deps.park({ treeId, data: gzipSync(rec.raw, { level: 3 }), kind: rec.kind, reason: rec.reason });
    this.parked = rec;
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
   * or null if there was nothing to capture. A capture the same as the last
   * promotes that save if it outranks it (resolving with its seq), and is
   * otherwise dropped — resolving with null, or with the last save's seq
   * when `sameSeq` asks for it.
   */
  private enqueue(kind: SnapKind, reason: string, sync: boolean, sameSeq: boolean): Promise<number | null> {
    const cap = this.deps.capture();
    if (cap === null) return Promise.resolve(null);
    const treeId = this.deps.treeId();
    const last = this.last;
    if (last !== null && (last.treeId === null || last.treeId === treeId) && sameTarContents(last.raw, cap.raw)) {
      if (KIND_RANK[kind] <= KIND_RANK[last.kind]) return sameSeq ? last.seq : Promise.resolve(null);
      last.kind = kind;
      last.reason = reason;
      return this.push({ kind, reason, rec: last, sync });
    }
    const rec: Last = { treeId, raw: cap.raw, kind, reason, seq: Promise.resolve(null), landed: false };
    this.last = rec;
    const written = this.push({ kind, reason, cap, rec, sync });
    rec.seq = written.catch(() => null);
    return written;
  }

  private push(job: Omit<Job, 'done' | 'fail'>): Promise<number | null> {
    return new Promise<number | null>((done, fail) => {
      this.queue.push({ ...job, done, fail });
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining !== null) return;
    this.draining = (async () => {
      for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
        try {
          job.done(job.cap === undefined ? await this.promote(job) : await this.write(job, job.cap));
        } catch (err) {
          job.fail(err);
        }
      }
    })().finally(() => {
      this.draining = null;
      if (this.queue.length > 0) this.drain();
    });
  }

  private async write(job: Job, cap: Capture): Promise<number> {
    const { kind, reason, rec } = job;
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
    } else {
      const result: AppendResult = await appendSnapshot(treeId, input);
      seq = result.snap.seq;
      evicted = result.evicted.length;
    }
    rec.treeId = treeId;
    this.landed(rec);
    this.deps.saved?.({ treeId, seq, kind, reason, evicted });
    return seq;
  }

  /** An identical save is already written (or being written, just ahead): give it this kind. */
  private async promote(job: Job): Promise<number | null> {
    const seq = await job.rec.seq;
    const treeId = job.rec.treeId ?? this.deps.treeId();
    if (seq === null || treeId === null) return null;
    await promoteSnapshot(treeId, seq, job.kind, job.reason);
    this.deps.saved?.({ treeId, seq, kind: job.kind, reason: job.reason, evicted: 0, promoted: true });
    return seq;
  }

  private landed(rec: Last): void {
    rec.landed = true;
    if (this.parked === rec) {
      this.parked = null;
      this.deps.unpark?.();
    }
  }

  /** Forget the last capture: what is in memory now is not known to be any save. */
  reset(): void {
    this.last = null;
  }

  /**
   * The game in memory is now save `seq` of `treeId`, as `raw` serialises it
   * (taken right after loading it), so standing still saves nothing.
   */
  loaded(treeId: string, seq: number, kind: SnapKind, raw: Uint8Array): void {
    this.last = { treeId, raw, kind, reason: '', seq: Promise.resolve(seq), landed: true };
  }
}
