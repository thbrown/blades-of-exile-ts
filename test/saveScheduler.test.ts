import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SavePreview } from '../src/fileio/saveIo';
import { Capture, SaveScheduler, SchedulerDeps } from '../src/platform/saveScheduler';
import { getSnapshot, listTrees, listSnaps } from '../src/platform/saveStore';

const preview = (age: number): SavePreview => ({ scenarioId: 'x', age, gold: 1, townNum: 200, pcs: [] });

/** A scheduler wired to fakes: idle callbacks are run by hand, and the "game" is a counter. */
function rig(over: Partial<SchedulerDeps> = {}) {
  let age = 0;
  let ready = true;
  let tree: string | null = null;
  const idle: (() => void)[] = [];
  const flushIdle = async (): Promise<void> => {
    while (idle.length > 0) idle.shift()!();
    await sched.settled();
  };
  const sched: SaveScheduler = new SaveScheduler({
    ready: () => ready,
    capture: (): Capture => ({
      raw: new Uint8Array([1, 2, 3, age & 255, age >> 8]),
      preview: preview(age), place: 'Somewhere', thumb: Promise.resolve(null),
    }),
    treeId: () => tree,
    setTreeId: (id) => { tree = id; },
    treeName: () => 'Test game',
    idle: (fn) => { idle.push(fn); },
    compress: (raw) => Promise.resolve(new Uint8Array([0x1f, 0x8b, ...raw])),
    // Every move saved, unless a test is about the quiet period.
    quietMs: 0,
    ...over,
  });
  return {
    sched, flushIdle, idle,
    setAge: (n: number) => { age = n; },
    setReady: (r: boolean) => { ready = r; },
    tree: () => tree,
  };
}

describe('the save scheduler', () => {
  it('does nothing until idle, then writes the first save as a new tree', async () => {
    const r = rig();
    r.sched.request('Tick', 'auto');
    expect(r.tree()).toBeNull();
    expect(r.idle).toHaveLength(1);
    await r.flushIdle();
    expect(r.tree()).not.toBeNull();
    const [tree] = (await listTrees()).filter((s) => s.id === r.tree());
    expect(tree!.name).toBe('Test game');
    expect((await listSnaps(tree!.id))[0]!.place).toBe('Somewhere');
  });

  it('folds many requests into one write, and a milestone outranks a tick', async () => {
    const r = rig();
    r.sched.request('Tick', 'auto');
    r.sched.request('Tick', 'auto');
    r.sched.request('EnterTown', 'milestone');
    r.sched.request('Tick', 'auto');
    expect(r.idle).toHaveLength(1);
    await r.flushIdle();
    const snaps = await listSnaps(r.tree()!);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ kind: 'milestone', reason: 'EnterTown' });
  });

  it('saveIfChanged writes and waits, takes over what was pending, and skips an unchanged game', async () => {
    const r = rig();
    r.sched.request('Start', 'milestone');
    expect(await r.sched.saveIfChanged('MainMenu')).toBe(1);
    const [first] = await listSnaps(r.tree()!);
    expect(first).toMatchObject({ kind: 'milestone', reason: 'MainMenu' });
    expect(await r.sched.saveIfChanged('MainMenu')).toBeNull();
    r.setAge(5);
    expect(await r.sched.saveIfChanged('MainMenu')).toBe(2);
    await r.flushIdle(); // the request it took over writes nothing more
    expect(await listSnaps(r.tree()!)).toHaveLength(2);
  });

  it('waits while the game is not at a savable moment', async () => {
    const r = rig();
    r.setReady(false);
    r.sched.request('Tick', 'auto');
    r.idle.shift()!();
    await new Promise((res) => setTimeout(res, 20));
    expect(r.tree()).toBeNull();
    r.setReady(true);
    await new Promise((res) => setTimeout(res, 600)); // the retry
    r.idle.shift()?.();
    await r.sched.settled();
    expect(r.tree()).not.toBeNull();
  });

  it('skips a save identical to the last, and Save on an unchanged game adds nothing', async () => {
    const r = rig();
    r.setAge(10);
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    expect(await listSnaps(r.tree()!)).toHaveLength(1);
    r.setAge(20);
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    expect(await listSnaps(r.tree()!)).toHaveLength(2);
    // The player saves where the tick just did: that save becomes theirs.
    expect(await r.sched.saveNow('Manual', 'manual')).toBe(2);
    const snaps = await listSnaps(r.tree()!);
    expect(snaps).toHaveLength(2);
    expect(snaps[1]).toMatchObject({ kind: 'manual', reason: 'Manual' });
    expect(snaps.map((s) => s.parent)).toEqual([null, 1]);
    expect((await getSnapshot(r.tree()!, 2))!.length).toBeGreaterThan(0);
  });

  it('keeps one of two identical saves: milestone, then manual, then auto', async () => {
    const saved: { kind: string; promoted?: boolean }[] = [];
    const s = rig({ saved: (x) => { saved.push(x); } });
    // A tick, then a milestone on the same game (the tick caught the move first).
    s.setAge(1);
    s.sched.request('Tick', 'auto');
    s.sched.captureIfPending();
    s.sched.request('EnterTown', 'milestone');
    s.sched.captureIfPending();
    await s.flushIdle();
    let snaps = await listSnaps(s.tree()!);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ kind: 'milestone', reason: 'EnterTown' });
    expect(saved.at(-1)).toMatchObject({ kind: 'milestone', promoted: true });
    // A manual save on top of the milestone leaves it a milestone.
    expect(await s.sched.saveNow('Manual', 'manual')).toBe(1);
    snaps = await listSnaps(s.tree()!);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.kind).toBe('milestone');
  });

  it('starts a loaded game out as the save it came from', async () => {
    const r = rig();
    r.setAge(5);
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    // As if save 1 were loaded: nothing changed, so nothing is written…
    r.sched.loaded(r.tree()!, 1, 'auto', new Uint8Array([1, 2, 3, 5, 0]));
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    r.sched.flush('Leaving');
    await r.sched.settled();
    expect(await listSnaps(r.tree()!)).toHaveLength(1);
    // …until it does.
    r.setAge(6);
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    expect(await listSnaps(r.tree()!)).toHaveLength(2);
  });

  it('parks a capture the page leaves before it is written, and unparks it once it is', async () => {
    let parked: unknown = null;
    let release: () => void = () => undefined;
    const slow = new Promise<void>((res) => { release = res; });
    const r = rig({
      park: (u) => { parked = u; },
      unpark: () => { parked = null; },
      compress: async (raw) => { await slow; return new Uint8Array([0x1f, 0x8b, ...raw]); },
    });
    r.setAge(1);
    r.sched.request('Start', 'milestone');
    r.sched.captureIfPending();
    // The tree doesn't exist until that first write lands: nowhere to park yet.
    r.sched.flush('Leaving');
    expect(parked).toBeNull();
    release();
    await r.flushIdle();
    expect(r.tree()).not.toBeNull();

    let hold: () => void = () => undefined;
    const r2 = rig({
      park: (u) => { parked = u; },
      unpark: () => { parked = null; },
    });
    r2.setAge(1);
    r2.sched.request('Start', 'milestone');
    await r2.flushIdle();
    const held = new Promise<void>((res) => { hold = res; });
    // The next write is stuck behind the gzip worker as the page goes.
    (r2.sched as unknown as { deps: SchedulerDeps }).deps.compress = async (raw) => {
      await held;
      return new Uint8Array([0x1f, 0x8b, ...raw]);
    };
    r2.setAge(2);
    r2.sched.request('Tick', 'auto');
    r2.sched.captureIfPending();
    r2.setAge(3);
    r2.sched.flush('Leaving');
    expect(parked).toMatchObject({ treeId: r2.tree(), kind: 'auto', reason: 'Leaving' });
    hold();
    await r2.sched.settled();
    expect(parked).toBeNull();
    expect((await listSnaps(r2.tree()!)).map((s) => s.gameAge)).toEqual([1, 2, 3]);
  });

  it('reports a save that fails, rather than throwing', async () => {
    const failures: unknown[] = [];
    const r = rig({
      compress: () => Promise.reject(new Error('worker died')),
      failed: (err) => { failures.push(err); },
    });
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    expect(failures).toHaveLength(1);
    expect(r.tree()).toBeNull();
  });

  it('captures every move when the host asks before each action, and writes them all in order', async () => {
    const r = rig();
    // A walk: a tick from inside each move, then the next move's gate. No
    // idle callback runs in between, and the writes are still in flight.
    for (let i = 1; i <= 30; i++) {
      r.setAge(i);
      r.sched.request('Tick', 'auto');
      r.sched.captureIfPending();
    }
    await r.flushIdle();
    const snaps = await listSnaps(r.tree()!);
    expect(snaps).toHaveLength(30);
    expect(snaps.map((s) => s.gameAge)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(snaps.slice(1).every((s, i) => s.parent === snaps[i]!.seq)).toBe(true);
  });

  it('saves a walk where it pauses: ticks closer than the quiet period wait and fold', async () => {
    let clock = 0;
    const r = rig({ quietMs: 500, now: () => clock });
    // Held arrow key: a step every 100ms, the gate before each.
    for (let i = 1; i <= 10; i++) {
      r.setAge(i);
      r.sched.request('Tick', 'auto');
      r.sched.captureIfPending();
      clock += 100;
    }
    expect(r.sched.queued).toBe(0);
    // The walk stops; once 500ms have passed since the last step, it saves.
    clock += 400;
    r.sched.captureIfPending();
    await r.flushIdle();
    expect((await listSnaps(r.tree()!)).map((snap) => snap.gameAge)).toEqual([10]);
    // Two steps a second apart are two saves, the first at the second's gate.
    r.setAge(11);
    r.sched.request('Tick', 'auto');
    clock += 1000;
    r.sched.captureIfPending();
    r.setAge(12);
    r.sched.request('Tick', 'auto');
    clock += 1000;
    r.sched.captureIfPending();
    await r.flushIdle();
    expect((await listSnaps(r.tree()!)).map((snap) => snap.gameAge)).toEqual([10, 11, 12]);
  });

  it('a milestone never waits for the quiet period', async () => {
    const clock = 0;
    const r = rig({ quietMs: 500, now: () => clock });
    r.sched.request('Tick', 'auto');
    r.sched.request('EnterTown', 'milestone');
    r.sched.captureIfPending();
    expect(r.sched.queued).toBe(1);
    await r.flushIdle();
  });

  it('captures nothing at a moment the game cannot be saved', async () => {
    const r = rig();
    r.setReady(false);
    r.sched.request('Tick', 'auto');
    r.sched.captureIfPending();
    expect(r.sched.queued).toBe(0);
    r.setReady(true);
    r.sched.captureIfPending();
    await r.flushIdle();
    expect(await listSnaps(r.tree()!)).toHaveLength(1);
  });
});
