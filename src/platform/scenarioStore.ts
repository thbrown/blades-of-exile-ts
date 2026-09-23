/**
 * Scenarios the player has added — the web equivalent of dropping a `.boes`
 * into the desktop build's Scenarios folder.
 *
 * The four bundled scenarios are fetched file by file from
 * `public/scenarios/<id>/`; anything else arrives as one packed `.boes`, and is
 * kept here whole so it survives a reload and a save can find it again. The
 * header's title and teaser are stored beside the bytes, so the startup screen
 * can list the library without unpacking every package.
 *
 * A database of its own rather than a second store in `saveStore`'s, so adding
 * it needs no schema upgrade of the one that holds people's saved games.
 */

import { PackedSource } from '../fileio/packedSource';
import { readScenarioFromXml } from '../fileio/scenarioXml';
import { parseXmlDoc } from '../fileio/xml';

const DB_NAME = 'exile-js-scenarios';
const DB_VERSION = 1;
const STORE = 'scenarios';

export interface InstalledScenario {
  /** The key; also what saves record and what `?scenario=` names. */
  id: string;
  title: string;
  blurb: string;
  /** Milliseconds since the epoch. */
  installedAt: number;
}

interface ScenarioRecord extends InstalledScenario {
  data: Uint8Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('could not open the scenario store')); };
  });
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('scenario store request failed')); };
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

export function scenarioStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** The library, oldest first, without the bytes. */
export async function listInstalledScenarios(): Promise<InstalledScenario[]> {
  const rows = await withStore('readonly', (store) => run(store.getAll() as IDBRequest<ScenarioRecord[]>));
  return rows
    .map(({ id, title, blurb, installedAt }) => ({ id, title, blurb, installedAt }))
    .sort((a, b) => a.installedAt - b.installedAt);
}

/** The package, opened; null if nothing is installed under that id. */
export async function getInstalledScenario(id: string): Promise<PackedSource | null> {
  const row = await withStore(
    'readonly', (store) => run(store.get(id) as IDBRequest<ScenarioRecord | undefined>));
  return row === undefined ? null : new PackedSource(id, new Uint8Array(row.data));
}

/**
 * Check a package opens and has a readable header, then keep it. Throws with a
 * reason if it isn't a scenario, so nothing unplayable reaches the list.
 * Installing over an existing id replaces it — a newer version of the same file.
 */
export async function installScenario(id: string, data: Uint8Array): Promise<InstalledScenario> {
  const src = new PackedSource(id, data);
  const hdr = readScenarioFromXml(await parseXmlDoc(await src.getText('scenario.xml'), 'scenario.xml'));
  const record: ScenarioRecord = {
    id,
    title: hdr.title || id,
    blurb: hdr.teasers.find((t) => t !== '') ?? '',
    installedAt: Date.now(),
    // A copy, because the caller's array may be a view onto a larger buffer.
    data: new Uint8Array(data),
  };
  await withStore('readwrite', (store) => run(store.put(record)));
  return { id: record.id, title: record.title, blurb: record.blurb, installedAt: record.installedAt };
}

export async function uninstallScenario(id: string): Promise<void> {
  await withStore('readwrite', (store) => run(store.delete(id)));
}
