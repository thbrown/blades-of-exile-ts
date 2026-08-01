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
}

interface SaveRecord extends SaveSlot {
  data: Uint8Array;
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

/** The slots, newest first, without their bytes. */
export async function listSaves(): Promise<SaveSlot[]> {
  const rows = await withStore('readonly', (store) => run(store.getAll() as IDBRequest<SaveRecord[]>));
  return rows
    .map(({ name, savedAt, preview }) => ({ name, savedAt, preview }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Store (or overwrite) a slot. The preview is derived from the bytes. */
export async function putSave(name: string, data: Uint8Array): Promise<SaveSlot> {
  const record: SaveRecord = {
    name,
    savedAt: Date.now(),
    preview: readSavePreview(data),
    // A copy, because the caller's array may be a view onto a larger buffer.
    data: new Uint8Array(data),
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

/**
 * Ask for an `.exg` from the local disk. Resolves null if the picker is
 * dismissed — which, since browsers fire no event for that, is detected by the
 * window regaining focus with nothing chosen.
 */
export function importSave(): Promise<{ name: string; data: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.exg,application/octet-stream';
    let settled = false;
    const finish = (value: { name: string; data: Uint8Array } | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) {
        finish(null);
        return;
      }
      void file.arrayBuffer().then((buf) => {
        finish({ name: file.name.replace(/\.exg$/i, ''), data: new Uint8Array(buf) });
      });
    };
    window.addEventListener('focus', () => {
      // Give the change event a moment to arrive first.
      setTimeout(() => { finish(null); }, 500);
    }, { once: true });
    input.click();
  });
}
