/**
 * Where saved games live in the browser — the web equivalent of the C++'s
 * Saved Games folder, and the replacement for `run_file_picker`.
 *
 * The C++ writes `.exg` files to disk and re-reads the directory to build its
 * picker, showing a preview of each party (`load_party` with `preview = true`).
 * Here the same bytes go into IndexedDB under a slot name, with the preview
 * stored alongside so the picker doesn't have to unzip every save to draw a
 * list. `exportSave`/`importSave` move the very same bytes in and out as real
 * `.exg` files, so a save made here opens in the desktop build and vice versa.
 */

import { SavePreview, readSavePreview } from '../fileio/saveIo';
import { pickLocalFile } from './pickFile';

const DB_NAME = 'exile-js';
const DB_VERSION = 1;
const STORE = 'saves';

/** One row of the picker. */
export interface SaveSlot {
  /** The slot's name, which is also its key — "Autosave", "Fort Talrus", … */
  name: string;
  /** Milliseconds since the epoch, for sorting newest first. */
  savedAt: number;
  preview: SavePreview;
  /** A PNG of the terrain view when it was saved, for the startup screen. */
  thumb?: Uint8Array;
}

interface SaveRecord extends SaveSlot {
  data: Uint8Array;
  /** On the party in memory only: the scenario it was last taken into, and not yet finished. */
  activeScenario?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('could not open the save store')); };
  });
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('save store request failed')); };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  what: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await open();
  try {
    return await what(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

/** Whether saving is possible at all — IndexedDB is absent under Vitest. */
export function saveStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * The key the party in memory lives under — the C++'s `party_in_memory`, the
 * party the startup screen will take into whichever scenario is picked next.
 * It has to be stored because a page reload lies between the startup screen
 * and the game. The NUL keeps it from clashing with a name a player types, and
 * `listSaves` leaves it out.
 */
const PARTY_IN_MEMORY = '\u0000party in memory';

/** The party in memory, as a party-only save; null when there is none. */
export async function getPartyInMemory(): Promise<{
  data: Uint8Array; preview: SavePreview; activeScenario?: string;
} | null> {
  const row = await withStore(
    'readonly', (store) => run(store.get(PARTY_IN_MEMORY) as IDBRequest<SaveRecord | undefined>));
  if (row === undefined) return null;
  // Read afresh rather than trusting the stored preview, which an older build
  // wrote with fewer fields.
  const data = new Uint8Array(row.data);
  return {
    data, preview: readSavePreview(data),
    ...(row.activeScenario !== undefined ? { activeScenario: row.activeScenario } : {}),
  };
}

/** Keep a party in memory (a save written with `serialiseSave(univ, true)`), or forget it. */
export async function setPartyInMemory(data: Uint8Array | null): Promise<void> {
  if (data === null) await deleteSave(PARTY_IN_MEMORY);
  else await putSave(PARTY_IN_MEMORY, data);
}

/**
 * Note which scenario the party in memory is off in (null: none — it won, or
 * is between scenarios). The startup screen says so, and offers that
 * scenario's latest save.
 */
export async function setPartyActiveScenario(id: string | null): Promise<void> {
  await withStore('readwrite', async (store) => {
    const row = await run(store.get(PARTY_IN_MEMORY) as IDBRequest<SaveRecord | undefined>);
    if (row === undefined) return;
    if (id === null) delete row.activeScenario;
    else row.activeScenario = id;
    await run(store.put(row));
  });
}

/** The slots, newest first, without their bytes. */
export async function listSaves(): Promise<SaveSlot[]> {
  const rows = await withStore('readonly', (store) => run(store.getAll() as IDBRequest<SaveRecord[]>));
  return rows
    .filter((row) => row.name !== PARTY_IN_MEMORY)
    .map(({ name, savedAt, preview, thumb }) => ({ name, savedAt, preview, ...(thumb ? { thumb } : {}) }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Store (or overwrite) a slot. The preview is derived from the bytes. */
export async function putSave(name: string, data: Uint8Array, thumb?: Uint8Array | null): Promise<SaveSlot> {
  const record: SaveRecord = {
    name,
    savedAt: Date.now(),
    preview: readSavePreview(data),
    // A copy, because the caller's array may be a view onto a larger buffer.
    data: new Uint8Array(data),
    ...(thumb ? { thumb: new Uint8Array(thumb) } : {}),
  };
  await withStore('readwrite', (store) => run(store.put(record)));
  return { name: record.name, savedAt: record.savedAt, preview: record.preview };
}

export async function getSave(name: string): Promise<Uint8Array | null> {
  const row = await withStore(
    'readonly', (store) => run(store.get(name) as IDBRequest<SaveRecord | undefined>));
  return row === undefined ? null : new Uint8Array(row.data);
}

export async function deleteSave(name: string): Promise<void> {
  await withStore('readwrite', (store) => run(store.delete(name)));
}

/** Hand the raw `.exg` to the browser as a download. */
export function exportSave(name: string, data: Uint8Array): void {
  const file = name.endsWith('.exg') ? name : `${name}.exg`;
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file;
  link.click();
  // Revoking immediately can beat the download on some browsers; a tick is
  // enough and the object is small.
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

/** Ask for an `.exg` from the local disk; null if the picker is dismissed. */
export async function importSave(): Promise<{ name: string; data: Uint8Array } | null> {
  const picked = await pickLocalFile('.exg,application/octet-stream');
  return picked === null ? null : { name: picked.fileName.replace(/\.exg$/i, ''), data: picked.data };
}
