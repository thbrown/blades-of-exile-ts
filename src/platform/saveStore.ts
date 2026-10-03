/**
 * Where saved games live in the browser — the web equivalent of the C++'s
 * Saved Games folder, and the replacement for `run_file_picker`.
 *
 * A game is a **tree** of snapshots (`saveRetention.ts` explains the shape
 * and what is thinned). Each snapshot is the very bytes an `.exg` file
 * holds, so `exportSnapshot` hands one to the browser as a real file that the
 * desktop build opens, and `importSave` goes the other way.
 *
 * Three object stores keep the tree cheap to draw: `trees` (one small row per
 * game), `tree-snaps` (a snapshot's metadata, preview and thumbnail) and
 * `tree-blobs` (the save bytes, read only when one is restored or exported).
 * The party in memory — the C++'s `party_in_memory`, between scenarios — has a
 * store of its own.
 */

import { SavePreview } from '../fileio/saveIo';
import { pickLocalFile } from './pickFile';
import {
  DEFAULT_MAX_AUTO_SAVES, SnapKind, SnapNode, canDeleteBranch, canDeleteSingle, freezeBranches, lineage,
  reparent, subtree, trimAutos,
} from './saveRetention';

// The project's old name, kept: renaming it would lose what players have stored.
const DB_NAME = 'exile-js';
const DB_VERSION = 3;
const TREES = 'trees';
const SNAPS = 'tree-snaps';
const BLOBS = 'tree-blobs';
const PARTY = 'party';
/**
 * Version 2's names, from when a tree was called a *series*: `series`, and
 * `snaps` and `blobs` keyed on `seriesId`. Version 3 copies them across.
 */
const V2_STORES = { trees: 'series', snaps: 'snaps', blobs: 'blobs' } as const;

/** One game, as the picker's card shows it. */
export interface TreeInfo {
  id: string;
  /** What the player calls it — the root save's name, renameable. */
  name: string;
  /** The scenario it is played in; '' for a party between scenarios. */
  scenarioId: string;
  createdAt: number;
  updatedAt: number;
  /** The snapshot the live game is at: saving adds a child of this. */
  head: number;
  nextSeq: number;
  /** Stored size of every snapshot, thumbnails included. */
  bytes: number;
  /**
   * The most autosaves it keeps (`saveRetention.ts`); absent means
   * `DEFAULT_MAX_AUTO_SAVES`. The player sets it in the restore tree.
   */
  maxAuto?: number;
  /** How many snapshots it holds. */
  count: number;
  /** The head snapshot's summary, so the startup screen needn't read the tree. */
  cover: TreeCover;
}

export interface TreeCover {
  savedAt: number;
  place: string;
  preview: SavePreview;
  thumb?: Uint8Array;
}

/** A node of the tree, with what the restore view shows. */
export interface SnapInfo extends SnapNode {
  treeId: string;
  savedAt: number;
  /** Why it was taken: 'Tick', 'EnterTown', 'Manual', … */
  reason: string;
  /** Where the party was — a town's name, or 'Outdoors'; '' when not known. */
  place: string;
  preview: SavePreview;
  /** An image of the terrain view at the time. */
  thumb?: Uint8Array;
}

/** What `appendSnapshot` and `createTree` take. */
export interface SnapInput {
  /** A gzipped `.exg`. */
  data: Uint8Array;
  preview: SavePreview;
  thumb?: Uint8Array | null;
  kind: SnapKind;
  reason: string;
  place?: string;
  savedAt?: number;
}

interface PartyRow {
  name: 'party';
  data: Uint8Array;
  activeScenario?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      // Version 1 kept flat slots in `saves`. Nothing had shipped, so they are
      // dropped rather than migrated.
      if (db.objectStoreNames.contains('saves')) db.deleteObjectStore('saves');
      if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS, { keyPath: ['treeId', 'seq'] });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: ['treeId', 'seq'] });
      if (!db.objectStoreNames.contains(PARTY)) db.createObjectStore(PARTY, { keyPath: 'name' });
      // Version 2's saves move to version 3's stores, `seriesId` becoming
      // `treeId`; each old store goes once it is copied. All inside the
      // upgrade's own transaction, so a failure leaves version 2 as it was.
      const move = (from: string, to: string, rename: boolean): void => {
        if (!db.objectStoreNames.contains(from)) return;
        const source = tx.objectStore(from);
        const target = tx.objectStore(to);
        const cursor = source.openCursor();
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (at === null) { db.deleteObjectStore(from); return; }
          const row = at.value as Record<string, unknown>;
          if (rename) {
            const { seriesId, ...rest } = row;
            target.put({ treeId: seriesId, ...rest });
          } else target.put(row);
          at.continue();
        };
      };
      move(V2_STORES.trees, TREES, false);
      move(V2_STORES.snaps, SNAPS, true);
      move(V2_STORES.blobs, BLOBS, true);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error ?? new Error('could not open the save store')); };
  });
  return dbPromise;
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('save store request failed')); };
  });
}

type StoreName = typeof TREES | typeof SNAPS | typeof BLOBS | typeof PARTY;

/**
 * One transaction over the named stores. The callback must only await IDB
 * requests (`run`) — anything else lets the transaction commit under it. The
 * promise settles when the transaction *commits*, so a resolved write is durable.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  stores: StoreName[],
  what: (get: (name: StoreName) => IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error('save store transaction failed')); };
    tx.onabort = () => { reject(tx.error ?? new Error('save store transaction aborted')); };
  });
  let value: T;
  try {
    value = await what((name) => tx.objectStore(name));
  } catch (err) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => undefined);
    throw err;
  }
  await done;
  return value;
}

/** Whether saving is possible at all — IndexedDB is absent under Vitest. */
export function saveStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

const treeRange = (id: string): IDBKeyRange => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const coverOf = (snap: SnapInfo): TreeCover => ({
  savedAt: snap.savedAt, place: snap.place, preview: snap.preview, ...(snap.thumb ? { thumb: snap.thumb } : {}),
});

function snapRow(treeId: string, seq: number, parent: number | null, input: SnapInput): SnapInfo {
  const thumb = input.thumb ? new Uint8Array(input.thumb) : undefined;
  return {
    treeId, seq, parent,
    savedAt: input.savedAt ?? Date.now(),
    gameAge: input.preview.age,
    kind: input.kind,
    reason: input.reason,
    place: input.place ?? '',
    townNum: input.preview.townNum,
    bytes: input.data.length + (thumb?.length ?? 0),
    preview: input.preview,
    ...(thumb ? { thumb } : {}),
  };
}

/** Ask the browser not to evict the history under storage pressure. Best effort. */
let persistAsked = false;
function askPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

/** Start a new tree whose root is `input`. */
export async function createTree(
  name: string, input: SnapInput,
): Promise<{ tree: TreeInfo; snap: SnapInfo }> {
  askPersist();
  const id = newId();
  const snap = snapRow(id, 1, null, input);
  const tree: TreeInfo = {
    id, name, scenarioId: input.preview.scenarioId, createdAt: snap.savedAt, updatedAt: snap.savedAt,
    head: 1, nextSeq: 2, bytes: snap.bytes, count: 1, cover: coverOf(snap),
  };
  await transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    await run(get(TREES).put(tree));
    await run(get(SNAPS).put(snap));
    await run(get(BLOBS).put({ treeId: id, seq: 1, data: new Uint8Array(input.data) }));
  });
  return { tree, snap };
}

export interface AppendResult {
  snap: SnapInfo;
  tree: TreeInfo;
  /** Autosaves evicted to make room. */
  evicted: number[];
}

/** A tree's autosave cap. */
export const maxAutoOf = (tree: TreeInfo): number => tree.maxAuto ?? DEFAULT_MAX_AUTO_SAVES;

/**
 * Save `input` as a child of the tree's head, and make it the new head. When
 * the head already has a child this starts a branch, and an autosave doing so
 * is stored as a **branch** save, which the cap never touches. Past the cap,
 * one old autosave is evicted (`saveRetention.ts`), in the same transaction.
 */
export async function appendSnapshot(
  treeId: string, input: SnapInput, rand: () => number = Math.random,
): Promise<AppendResult> {
  return transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    const tree = await run(get(TREES).get(treeId) as IDBRequest<TreeInfo | undefined>);
    if (tree === undefined) throw new Error('that saved game no longer exists');
    const snaps = await run(get(SNAPS).getAll(treeRange(treeId)) as IDBRequest<SnapInfo[]>);
    const forks = snaps.some((s) => s.parent === tree.head);
    const kind: SnapKind = forks && input.kind === 'auto' ? 'branch' : input.kind;
    const snap = snapRow(treeId, tree.nextSeq, tree.head, { ...input, kind });
    await run(get(SNAPS).put(snap));
    await run(get(BLOBS).put({ treeId, seq: snap.seq, data: new Uint8Array(input.data) }));
    snaps.push(snap);
    tree.head = snap.seq;
    tree.nextSeq += 1;
    tree.bytes += snap.bytes;
    tree.updatedAt = snap.savedAt;
    tree.count += 1;
    tree.cover = coverOf(snap);
    const evicted = await evictInTransaction(get, tree, snaps, maxAutoOf(tree), rand);
    await run(get(TREES).put(tree));
    return { snap, tree, evicted };
  });
}

/**
 * Bring one tree down to `max` autosaves in an open transaction. Before
 * anything is deleted, a branch start known only by its shape (a tree saved
 * before branch saves had a kind) is written down as one: deleting the save
 * before it can change which child of a fork looks like the first.
 */
async function evictInTransaction(
  get: (name: StoreName) => IDBObjectStore, tree: TreeInfo, snaps: SnapInfo[], max: number,
  rand: () => number,
): Promise<number[]> {
  const remove = trimAutos(snaps, tree.head, max, rand);
  if (remove.length === 0) return remove;
  const frozen = freezeBranches(snaps);
  for (const [i, row] of frozen.entries()) if (row !== snaps[i]) await run(get(SNAPS).put(row));
  await removeInTransaction(get, tree, frozen, remove);
  return remove;
}

/** Delete `remove` from an open transaction, hanging their children on what is left. */
async function removeInTransaction(
  get: (name: StoreName) => IDBObjectStore, tree: TreeInfo, snaps: readonly SnapInfo[], remove: readonly number[],
): Promise<void> {
  const kept = reparent(snaps, remove);
  const before = new Map(snaps.map((s) => [s.seq, s]));
  for (const seq of remove) {
    await run(get(SNAPS).delete([tree.id, seq]));
    await run(get(BLOBS).delete([tree.id, seq]));
    tree.bytes -= before.get(seq)?.bytes ?? 0;
    tree.count -= 1;
  }
  for (const node of kept) {
    const row = before.get(node.seq)!;
    if (row.parent !== node.parent) await run(get(SNAPS).put({ ...row, parent: node.parent }));
  }
}

/** Change a tree's autosave cap, evicting at once if it went down. Returns how many went. */
export async function setMaxAuto(treeId: string, max: number, rand: () => number = Math.random): Promise<number> {
  return transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    const tree = await run(get(TREES).get(treeId) as IDBRequest<TreeInfo | undefined>);
    if (tree === undefined) return 0;
    tree.maxAuto = Math.max(0, Math.floor(max));
    const snaps = await run(get(SNAPS).getAll(treeRange(treeId)) as IDBRequest<SnapInfo[]>);
    const gone = await evictInTransaction(get, tree, snaps, tree.maxAuto, rand);
    await run(get(TREES).put(tree));
    return gone.length;
  });
}

/**
 * Delete one save — a milestone, a manual save or an autosave — keeping what
 * came after it. Refused for the root, a branch's first or last save, and the
 * save the live game is at (`canDeleteSingle`).
 */
export async function deleteSnapshot(treeId: string, seq: number): Promise<void> {
  await transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    const tree = await run(get(TREES).get(treeId) as IDBRequest<TreeInfo | undefined>);
    if (tree === undefined) return;
    const snaps = await run(get(SNAPS).getAll(treeRange(treeId)) as IDBRequest<SnapInfo[]>);
    if (!canDeleteSingle(snaps, seq, tree.head)) {
      throw new Error("the first and last saves of a branch can only be deleted with the branch");
    }
    await removeInTransaction(get, tree, snaps, [seq]);
    await run(get(TREES).put(tree));
  });
}

/** The live game is now at `seq` (a restore): the next save branches from it if it is not a leaf. */
export async function setHead(treeId: string, seq: number): Promise<void> {
  await transact('readwrite', [TREES, SNAPS], async (get) => {
    const tree = await run(get(TREES).get(treeId) as IDBRequest<TreeInfo | undefined>);
    if (tree === undefined) return;
    const snap = await run(get(SNAPS).get([treeId, seq]) as IDBRequest<SnapInfo | undefined>);
    if (snap === undefined) throw new Error('no such save');
    tree.head = seq;
    tree.cover = coverOf(snap);
    await run(get(TREES).put(tree));
  });
}

/** Every game, most recently played first. */
export async function listTrees(): Promise<TreeInfo[]> {
  const rows = await transact('readonly', [TREES], (get) => run(get(TREES).getAll() as IDBRequest<TreeInfo[]>));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTree(id: string): Promise<TreeInfo | null> {
  return await transact('readonly', [TREES],
    (get) => run(get(TREES).get(id) as IDBRequest<TreeInfo | undefined>)) ?? null;
}

/** A tree's every snapshot, oldest first — metadata and thumbnails, no save bytes. */
export async function listSnaps(treeId: string): Promise<SnapInfo[]> {
  const rows = await transact('readonly', [SNAPS],
    (get) => run(get(SNAPS).getAll(treeRange(treeId)) as IDBRequest<SnapInfo[]>));
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function getSnapshot(treeId: string, seq: number): Promise<Uint8Array | null> {
  const row = await transact('readonly', [BLOBS],
    (get) => run(get(BLOBS).get([treeId, seq]) as IDBRequest<{ data: Uint8Array } | undefined>));
  return row === undefined ? null : new Uint8Array(row.data);
}

export async function renameTree(id: string, name: string): Promise<void> {
  await transact('readwrite', [TREES], async (get) => {
    const tree = await run(get(TREES).get(id) as IDBRequest<TreeInfo | undefined>);
    if (tree !== undefined) await run(get(TREES).put({ ...tree, name }));
  });
}

export async function deleteTree(id: string): Promise<void> {
  await transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    await run(get(TREES).delete(id));
    await run(get(SNAPS).delete(treeRange(id)));
    await run(get(BLOBS).delete(treeRange(id)));
  });
}

/**
 * Delete a whole branch: `seq`, which must start one, and everything below it.
 * Refused if the live game is on it; the root's "branch" is the whole game
 * (`deleteTree`). Returns how many snapshots went.
 */
export async function deleteBranch(treeId: string, seq: number): Promise<number> {
  return transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    const tree = await run(get(TREES).get(treeId) as IDBRequest<TreeInfo | undefined>);
    if (tree === undefined) return 0;
    const snaps = await run(get(SNAPS).getAll(treeRange(treeId)) as IDBRequest<SnapInfo[]>);
    if (lineage(snaps, tree.head).has(seq)) throw new Error("that save is on the game you're playing");
    if (!canDeleteBranch(snaps, seq, tree.head)) throw new Error('that save does not start a branch');
    const doomed = subtree(snaps, seq);
    for (const s of snaps) {
      if (!doomed.has(s.seq)) continue;
      await run(get(SNAPS).delete([treeId, s.seq]));
      await run(get(BLOBS).delete([treeId, s.seq]));
      tree.bytes -= s.bytes;
      tree.count -= 1;
    }
    await run(get(TREES).put(tree));
    return doomed.size;
  });
}

/** A whole tree arriving from a zip: nodes keep their numbers and parents. */
export interface ImportedNode extends SnapInput {
  seq: number;
  parent: number | null;
}

export async function importTree(
  name: string, scenarioId: string, nodes: ImportedNode[], head: number,
): Promise<TreeInfo> {
  askPersist();
  const id = newId();
  const rows = nodes.map((n) => ({ ...snapRow(id, n.seq, n.parent, n), seq: n.seq }));
  const now = Date.now();
  const tree: TreeInfo = {
    id, name, scenarioId, createdAt: Math.min(now, ...rows.map((r) => r.savedAt)), updatedAt: now,
    head, nextSeq: Math.max(0, ...rows.map((r) => r.seq)) + 1,
    bytes: rows.reduce((sum, r) => sum + r.bytes, 0), count: rows.length,
    cover: coverOf(rows.find((r) => r.seq === head) ?? rows[rows.length - 1]!),
  };
  await transact('readwrite', [TREES, SNAPS, BLOBS], async (get) => {
    await run(get(TREES).put(tree));
    for (const [i, row] of rows.entries()) {
      await run(get(SNAPS).put(row));
      await run(get(BLOBS).put({ treeId: id, seq: row.seq, data: new Uint8Array(nodes[i]!.data) }));
    }
  });
  return tree;
}

/**
 * The party in memory — the party the startup screen takes into whichever
 * scenario is picked next. It has to be stored because a page reload lies
 * between the startup screen and the game.
 */
export async function getPartyInMemory(): Promise<{
  data: Uint8Array; activeScenario?: string;
} | null> {
  const row = await transact('readonly', [PARTY], (get) => run(get(PARTY).get('party') as IDBRequest<PartyRow | undefined>));
  if (row === undefined) return null;
  return {
    data: new Uint8Array(row.data),
    ...(row.activeScenario !== undefined ? { activeScenario: row.activeScenario } : {}),
  };
}

/** Keep a party in memory (a save written with `saveGame(univ, true)`), or forget it. */
export async function setPartyInMemory(data: Uint8Array | null): Promise<void> {
  await transact('readwrite', [PARTY], async (get) => {
    if (data === null) await run(get(PARTY).delete('party'));
    else await run(get(PARTY).put({ name: 'party', data: new Uint8Array(data) } satisfies PartyRow));
  });
}

/**
 * Note which scenario the party in memory is off in (null: none — it won, or
 * is between scenarios). The startup screen says so, and offers that
 * scenario's latest save.
 */
export async function setPartyActiveScenario(id: string | null): Promise<void> {
  await transact('readwrite', [PARTY], async (get) => {
    const row = await run(get(PARTY).get('party') as IDBRequest<PartyRow | undefined>);
    if (row === undefined) return;
    if (id === null) delete row.activeScenario;
    else row.activeScenario = id;
    await run(get(PARTY).put(row));
  });
}

/** Hand a file to the browser as a download. */
export function downloadFile(file: string, data: Uint8Array, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file;
  link.click();
  // Revoking immediately can beat the download on some browsers; a tick is
  // enough and the object is small.
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

/** Hand the raw `.exg` to the browser as a download. */
export function exportSave(name: string, data: Uint8Array): void {
  downloadFile(/\.(exg|sav)$/i.test(name) ? name : `${name}.exg`, data);
}

/**
 * Ask for an `.exg`, a tree zip, or Exile III's own `.sav` from the local
 * disk; null if the picker is dismissed.
 *
 * No filter: the original's saves are `EXILE3.SAV` and the like, and macOS's
 * picker greyed those out under `.sav` (it maps an extension to a file type,
 * and the uppercase one didn't match). Open Game tells the formats apart by
 * their bytes, so nothing is lost by letting every file through.
 */
export async function importSave(): Promise<{ name: string; data: Uint8Array } | null> {
  const picked = await pickLocalFile('');
  return picked === null ? null : { name: picked.fileName.replace(/\.(exg|zip)$/i, ''), data: picked.data };
}

/** The bytes of every snapshot in a tree, for exporting it whole. */
export async function getAllSnapshots(treeId: string): Promise<Map<number, Uint8Array>> {
  const rows = await transact('readonly', [BLOBS],
    (get) => run(get(BLOBS).getAll(treeRange(treeId)) as IDBRequest<{ seq: number; data: Uint8Array }[]>));
  return new Map(rows.map((r) => [r.seq, new Uint8Array(r.data)]));
}
