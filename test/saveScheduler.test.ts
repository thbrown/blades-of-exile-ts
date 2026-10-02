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
    budgetBytes: () => 10 * 1024 * 1024,
    idle: (fn) => { idle.push(fn); },
    compress: (raw) => Promise.resolve(new Uint8Array([0x1f, 0x8b, ...raw])),
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

  it('skips a save identical to the last, but not a manual one', async () => {
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
    await r.sched.saveNow('Manual', 'manual');
    const snaps = await listSnaps(r.tree()!);
    expect(snaps).toHaveLength(3);
    expect(snaps.map((s) => s.parent)).toEqual([null, 1, 2]);
    expect((await getSnapshot(r.tree()!, 3))!.length).toBeGreaterThan(0);
  });

  it('lets a loaded game start fresh', async () => {
    const r = rig();
    r.setAge(5);
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    r.sched.reset();
    r.sched.request('Tick', 'auto');
    await r.flushIdle();
    expect(await listSnaps(r.tree()!)).toHaveLength(2);
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

  it('asks the host to back off when the serialise is slow', async () => {
    let t = 0;
    const slow: number[] = [];
    const r = rig({
      now: () => (t += 20), // every capture "takes" 20 ms
      slow: (p95) => { slow.push(p95); },
    });
    for (let i = 0; i < 20; i++) {
      r.setAge(i);
      r.sched.request('Tick', 'auto');
      await r.flushIdle();
    }
    expect(slow.length).toBeGreaterThan(0);
  });
});
