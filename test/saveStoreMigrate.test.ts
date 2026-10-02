import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getSnapshot, getTree, listSnaps, listTrees } from '../src/platform/saveStore';

/** The save store as version 2 left it, when a tree was called a series. */
async function makeV2(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('exile-js', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('series', { keyPath: 'id' });
      d.createObjectStore('snaps', { keyPath: ['seriesId', 'seq'] });
      d.createObjectStore('blobs', { keyPath: ['seriesId', 'seq'] });
      d.createObjectStore('party', { keyPath: 'name' });
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error); };
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['series', 'snaps', 'blobs'], 'readwrite');
    tx.objectStore('series').put({ id: 'g1', name: 'Old game', scenarioId: 'valleydy', head: 2, count: 2 });
    for (const seq of [1, 2]) {
      tx.objectStore('snaps').put({ seriesId: 'g1', seq, parent: seq === 1 ? null : 1, gameAge: seq * 10 });
      tx.objectStore('blobs').put({ seriesId: 'g1', seq, data: new Uint8Array([seq, seq]) });
    }
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error); };
  });
  db.close();
}

describe('the save store upgrade from version 2', () => {
  it('carries every series over as a tree, nothing lost', async () => {
    await makeV2();
    expect((await listTrees()).map((t) => t.name)).toEqual(['Old game']);
    expect((await getTree('g1'))?.head).toBe(2);
    const snaps = await listSnaps('g1');
    expect(snaps.map((s) => [s.treeId, s.seq, s.parent])).toEqual([['g1', 1, null], ['g1', 2, 1]]);
    expect(snaps[0]).not.toHaveProperty('seriesId');
    expect(Array.from((await getSnapshot('g1', 2))!)).toEqual([2, 2]);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('exile-js');
      req.onsuccess = () => { resolve(req.result); };
    });
    expect([...db.objectStoreNames].sort()).toEqual(['party', 'tree-blobs', 'tree-snaps', 'trees']);
    db.close();
  });
});
