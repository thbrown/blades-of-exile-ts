/**
 * Where saved games live in the browser — the web equivalent of the C++'s
 * Saved Games folder, and the replacement for `run_file_picker`.
 *
 * A game is a **series**: a tree of snapshots (`saveRetention.ts` explains the
 * shape and what is thinned). Each snapshot is the very bytes an `.exg` file
 * holds, so `exportSnapshot` hands one to the browser as a real file that the
 * desktop build opens, and `importSave` goes the other way.
 *
 * Three object stores keep the tree cheap to draw: `series` (one small row per
 * game), `snaps` (a snapshot's metadata, preview and thumbnail) and `blobs` (the
 * save bytes, read only when one is restored or exported). The party in memory
 * — the C++'s `party_in_memory`, between scenarios — has a store of its own.
 */

import { SavePreview } from '../fileio/saveIo';
import { pickLocalFile } from './pickFile';
import { RETENTION, SnapKind, SnapNode, lineage, reparent, thin } from './saveRetention';

// The project's old name, kept: renaming it would lose what players have stored.
const DB_NAME = 'exile-js';
const DB_VERSION = 2;
const SERIES = 'series';
const SNAPS = 'snaps';
const BLOBS = 'blobs';
const PARTY = 'party';

/** One game, as the picker's card shows it. */
export interface SeriesInfo {
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
  /** Saves since thinning last ran. */
  sinceThin: number;
  /** How many snapshots it holds. */
  count: number;
  /** The head snapshot's summary, so the startup screen needn't read the tree. */
  cover: SeriesCover;
}

export interface SeriesCover {
  savedAt: number;
  place: string;
  preview: SavePreview;
  thumb?: Uint8Array;
}

/** A node of the tree, with what the restore view shows. */
export interface SnapInfo extends SnapNode {
  seriesId: string;
  savedAt: number;
  /** Why it was taken: 'Tick', 'EnterTown', 'Manual', … */
  reason: string;
  /** Where the party was — a town's name, or 'Outdoors'; '' when not known. */
  place: string;
  preview: SavePreview;
  /** An image of the terrain view at the time. */
  thumb?: Uint8Array;
}

/** What `appendSnapshot` and `createSeries` take. */
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
      // Version 1 kept flat slots in `saves`. Nothing had shipped, so they are
      // dropped rather than migrated.
      if (db.objectStoreNames.contains('saves')) db.deleteObjectStore('saves');
      if (!db.objectStoreNames.contains(SERIES)) db.createObjectStore(SERIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS, { keyPath: ['seriesId', 'seq'] });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: ['seriesId', 'seq'] });
      if (!db.objectStoreNames.contains(PARTY)) db.createObjectStore(PARTY, { keyPath: 'name' });
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

type StoreName = typeof SERIES | typeof SNAPS | typeof BLOBS | typeof PARTY;

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

const seriesRange = (id: string): IDBKeyRange => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const coverOf = (snap: SnapInfo): SeriesCover => ({
  savedAt: snap.savedAt, place: snap.place, preview: snap.preview, ...(snap.thumb ? { thumb: snap.thumb } : {}),
});

function snapRow(seriesId: string, seq: number, parent: number | null, input: SnapInput): SnapInfo {
  const thumb = input.thumb ? new Uint8Array(input.thumb) : undefined;
  return {
    seriesId, seq, parent,
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

/** Start a new series whose root is `input`. */
export async function createSeries(
  name: string, input: SnapInput,
): Promise<{ series: SeriesInfo; snap: SnapInfo }> {
  askPersist();
  const id = newId();
  const snap = snapRow(id, 1, null, input);
  const series: SeriesInfo = {
    id, name, scenarioId: input.preview.scenarioId, createdAt: snap.savedAt, updatedAt: snap.savedAt,
    head: 1, nextSeq: 2, bytes: snap.bytes, sinceThin: 0, count: 1, cover: coverOf(snap),
  };
  await transact('readwrite', [SERIES, SNAPS, BLOBS], async (get) => {
    await run(get(SERIES).put(series));
    await run(get(SNAPS).put(snap));
    await run(get(BLOBS).put({ seriesId: id, seq: 1, data: new Uint8Array(input.data) }));
  });
  return { series, snap };
}

/** How many saves between thinning passes. */
const THIN_EVERY = 10;

export interface AppendResult {
  snap: SnapInfo;
  series: SeriesInfo;
  /** The budget could not be met without deleting a branch tip or the like. */
  overBudget: boolean;
}

/**
 * Save `input` as a child of the series' head, and make it the new head — which
 * is how a branch starts when the head is not a leaf. Thinning runs here every
 * few saves, in the same transaction.
 */
export async function appendSnapshot(
  seriesId: string, input: SnapInput, budgetBytes: number = RETENTION.budgetBytes,
): Promise<AppendResult> {
  return transact('readwrite', [SERIES, SNAPS, BLOBS], async (get) => {
    const series = await run(get(SERIES).get(seriesId) as IDBRequest<SeriesInfo | undefined>);
    if (series === undefined) throw new Error('that saved game no longer exists');
    const snap = snapRow(seriesId, series.nextSeq, series.head, input);
    await run(get(SNAPS).put(snap));
    await run(get(BLOBS).put({ seriesId, seq: snap.seq, data: new Uint8Array(input.data) }));
    series.head = snap.seq;
    series.nextSeq += 1;
    series.bytes += snap.bytes;
    series.updatedAt = snap.savedAt;
    series.sinceThin += 1;
    series.count += 1;
    series.cover = coverOf(snap);
    let overBudget = false;
    if (series.sinceThin >= THIN_EVERY || series.bytes > budgetBytes) {
      series.sinceThin = 0;
      overBudget = await thinInTransaction(get, series, budgetBytes);
    }
    await run(get(SERIES).put(series));
    return { snap, series, overBudget };
  });
}

/** Thin one series in an open transaction; reports whether it is still over budget. */
async function thinInTransaction(
  get: (name: StoreName) => IDBObjectStore, series: SeriesInfo, budgetBytes: number,
): Promise<boolean> {
  const snaps = await run(get(SNAPS).getAll(seriesRange(series.id)) as IDBRequest<SnapInfo[]>);
  const { remove, overBudget } = thin(snaps, series.head, budgetBytes);
  if (remove.length === 0) return overBudget;
  const kept = reparent(snaps, remove);
  const before = new Map(snaps.map((s) => [s.seq, s]));
  for (const seq of remove) {
    await run(get(SNAPS).delete([series.id, seq]));
    await run(get(BLOBS).delete([series.id, seq]));
    series.bytes -= before.get(seq)?.bytes ?? 0;
    series.count -= 1;
  }
  for (const node of kept) {
    const row = before.get(node.seq)!;
    if (row.parent !== node.parent) await run(get(SNAPS).put({ ...row, parent: node.parent }));
  }
  return overBudget;
}

/** The live game is now at `seq` (a restore): the next save branches from it if it is not a leaf. */
export async function setHead(seriesId: string, seq: number): Promise<void> {
  await transact('readwrite', [SERIES, SNAPS], async (get) => {
    const series = await run(get(SERIES).get(seriesId) as IDBRequest<SeriesInfo | undefined>);
    if (series === undefined) return;
    const snap = await run(get(SNAPS).get([seriesId, seq]) as IDBRequest<SnapInfo | undefined>);
    if (snap === undefined) throw new Error('no such save');
    series.head = seq;
    series.cover = coverOf(snap);
    await run(get(SERIES).put(series));
  });
}

/** Every game, most recently played first. */
export async function listSeries(): Promise<SeriesInfo[]> {
  const rows = await transact('readonly', [SERIES], (get) => run(get(SERIES).getAll() as IDBRequest<SeriesInfo[]>));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSeries(id: string): Promise<SeriesInfo | null> {
  return await transact('readonly', [SERIES],
    (get) => run(get(SERIES).get(id) as IDBRequest<SeriesInfo | undefined>)) ?? null;
}

/** A series' whole tree, oldest first — metadata and thumbnails, no save bytes. */
export async function listSnaps(seriesId: string): Promise<SnapInfo[]> {
  const rows = await transact('readonly', [SNAPS],
    (get) => run(get(SNAPS).getAll(seriesRange(seriesId)) as IDBRequest<SnapInfo[]>));
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function getSnapshot(seriesId: string, seq: number): Promise<Uint8Array | null> {
  const row = await transact('readonly', [BLOBS],
    (get) => run(get(BLOBS).get([seriesId, seq]) as IDBRequest<{ data: Uint8Array } | undefined>));
  return row === undefined ? null : new Uint8Array(row.data);
}

export async function renameSeries(id: string, name: string): Promise<void> {
  await transact('readwrite', [SERIES], async (get) => {
    const series = await run(get(SERIES).get(id) as IDBRequest<SeriesInfo | undefined>);
    if (series !== undefined) await run(get(SERIES).put({ ...series, name }));
  });
}

export async function deleteSeries(id: string): Promise<void> {
  await transact('readwrite', [SERIES, SNAPS, BLOBS], async (get) => {
    await run(get(SERIES).delete(id));
    await run(get(SNAPS).delete(seriesRange(id)));
    await run(get(BLOBS).delete(seriesRange(id)));
  });
}

/**
 * Delete `seq` and everything below it — a whole abandoned branch. Refused for
 * anything on the head's lineage (that is the game being played, and includes the
 * root); returns how many snapshots went.
 */
export async function deleteBranch(seriesId: string, seq: number): Promise<number> {
  return transact('readwrite', [SERIES, SNAPS, BLOBS], async (get) => {
    const series = await run(get(SERIES).get(seriesId) as IDBRequest<SeriesInfo | undefined>);
    if (series === undefined) return 0;
    const snaps = await run(get(SNAPS).getAll(seriesRange(seriesId)) as IDBRequest<SnapInfo[]>);
    if (lineage(snaps, series.head).has(seq)) throw new Error("that save is on the game you're playing");
    const doomed = new Set([seq]);
    for (let grew = true; grew;) {
      grew = false;
      for (const s of snaps) {
        if (s.parent !== null && doomed.has(s.parent) && !doomed.has(s.seq)) { doomed.add(s.seq); grew = true; }
      }
    }
    for (const s of snaps) {
      if (!doomed.has(s.seq)) continue;
      await run(get(SNAPS).delete([seriesId, s.seq]));
      await run(get(BLOBS).delete([seriesId, s.seq]));
      series.bytes -= s.bytes;
      series.count -= 1;
    }
    await run(get(SERIES).put(series));
    return doomed.size;
  });
}

/** A whole series arriving from a zip: nodes keep their numbers and parents. */
export interface ImportedNode extends SnapInput {
  seq: number;
  parent: number | null;
}

export async function importSeries(
  name: string, scenarioId: string, nodes: ImportedNode[], head: number,
): Promise<SeriesInfo> {
  askPersist();
  const id = newId();
  const rows = nodes.map((n) => ({ ...snapRow(id, n.seq, n.parent, n), seq: n.seq }));
  const now = Date.now();
  const series: SeriesInfo = {
    id, name, scenarioId, createdAt: Math.min(now, ...rows.map((r) => r.savedAt)), updatedAt: now,
    head, nextSeq: Math.max(0, ...rows.map((r) => r.seq)) + 1,
    bytes: rows.reduce((sum, r) => sum + r.bytes, 0), sinceThin: 0, count: rows.length,
    cover: coverOf(rows.find((r) => r.seq === head) ?? rows[rows.length - 1]!),
  };
  await transact('readwrite', [SERIES, SNAPS, BLOBS], async (get) => {
    await run(get(SERIES).put(series));
    for (const [i, row] of rows.entries()) {
      await run(get(SNAPS).put(row));
      await run(get(BLOBS).put({ seriesId: id, seq: row.seq, data: new Uint8Array(nodes[i]!.data) }));
    }
  });
  return series;
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
 * Ask for an `.exg`, a series zip, or Exile III's own `.sav` from the local
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

/** The bytes of every snapshot in a series, for exporting it whole. */
export async function getAllSnapshots(seriesId: string): Promise<Map<number, Uint8Array>> {
  const rows = await transact('readonly', [BLOBS],
    (get) => run(get(BLOBS).getAll(seriesRange(seriesId)) as IDBRequest<{ seq: number; data: Uint8Array }[]>));
  return new Map(rows.map((r) => [r.seq, new Uint8Array(r.data)]));
}
