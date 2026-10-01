/**
 * Scenarios the player has added — the web equivalent of dropping a `.boes`
 * or an `.exs` into the desktop build's Scenarios folder.
 *
 * The four bundled scenarios are fetched file by file from
 * `public/scenarios/<id>/`; anything else arrives as one file (a `.boes`, or an
 * `.exs` and its `.bmp`), and is kept here whole so it survives a reload and a
 * save can find it again. The title, teaser and icon are stored beside the
 * bytes, so the startup screen can list the library without loading every
 * scenario, and so is a picture of where the game starts once one exists.
 *
 * A database of its own rather than a second store in `saveStore`'s, so adding
 * it needs no schema upgrade of the one that holds people's saved games.
 */

import { loadLegacyScenario } from '../fileio/legacy/loadLegacy';
import { PackedSource } from '../fileio/packedSource';
import { PackageKind, ScenarioPackage } from '../fileio/scenarioPackage';
import { readScenarioFromXml } from '../fileio/scenarioXml';
import { parseXmlDoc } from '../fileio/xml';

// The project's old name, kept: renaming it would lose what players have stored.
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
  /** `intro_pic` — the scenario's icon in `scenpics`. */
  introPic: number;
  /** A PNG of the terrain view as a new game starts, once the game has shown it. */
  preview?: Uint8Array;
  /** Whether custom graphics were stored with it. */
  hasGraphics: boolean;
}

interface ScenarioRecord extends Omit<InstalledScenario, 'hasGraphics'> {
  /** Absent on records made before `.exs` support, which were all `.boes`. */
  kind?: PackageKind;
  fileName?: string;
  data: Uint8Array;
  graphics?: Uint8Array;
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
    .map(({ id, title, blurb, installedAt, introPic, preview, graphics }) => ({
      id, title, blurb, installedAt, introPic: introPic ?? 0, ...(preview ? { preview } : {}),
      hasGraphics: graphics !== undefined,
    }))
    .sort((a, b) => a.installedAt - b.installedAt);
}

/** The package; null if nothing is installed under that id. */
export async function getInstalledScenario(id: string): Promise<ScenarioPackage | null> {
  const row = await withStore(
    'readonly', (store) => run(store.get(id) as IDBRequest<ScenarioRecord | undefined>));
  if (row === undefined) return null;
  return {
    id, fileName: row.fileName ?? `${id}.boes`, kind: row.kind ?? 'boes', data: new Uint8Array(row.data),
    ...(row.graphics ? { graphics: new Uint8Array(row.graphics) } : {}),
  };
}

/** What the startup screen shows for a package, read without loading all of it. */
async function describe(pkg: ScenarioPackage): Promise<{ title: string; blurb: string; introPic: number }> {
  if (pkg.kind === 'exs') {
    const { scenario } = loadLegacyScenario(pkg.data, pkg.id);
    return {
      title: scenario.title.trim() || pkg.id,
      blurb: scenario.teasers.find((t) => t.trim() !== '')?.trim() ?? '',
      introPic: scenario.introPic,
    };
  }
  const src = new PackedSource(pkg.id, pkg.data);
  const hdr = readScenarioFromXml(await parseXmlDoc(await src.getText('scenario.xml'), 'scenario.xml'));
  return { title: hdr.title || pkg.id, blurb: hdr.teasers.find((t) => t !== '') ?? '', introPic: hdr.introPic };
}

/**
 * Check a package loads and has a readable header, then keep it. Throws with
 * a reason if it isn't a scenario, so nothing unplayable reaches the list.
 * Installing over an existing id replaces it — a newer version of the same file.
 */
export async function installScenario(pkg: ScenarioPackage): Promise<InstalledScenario> {
  const info = await describe(pkg);
  const record: ScenarioRecord = {
    id: pkg.id,
    ...info,
    installedAt: Date.now(),
    kind: pkg.kind,
    fileName: pkg.fileName,
    // Copies, because the caller's arrays may be views onto larger buffers.
    data: new Uint8Array(pkg.data),
    ...(pkg.graphics ? { graphics: new Uint8Array(pkg.graphics) } : {}),
  };
  await withStore('readwrite', (store) => run(store.put(record)));
  return {
    id: record.id, title: record.title, blurb: record.blurb, installedAt: record.installedAt,
    introPic: record.introPic, hasGraphics: record.graphics !== undefined,
  };
}

/** Keep a picture of where the game starts, taken the first time it's played. */
export async function setScenarioPreview(id: string, png: Uint8Array): Promise<void> {
  await withStore('readwrite', async (store) => {
    const row = await run(store.get(id) as IDBRequest<ScenarioRecord | undefined>);
    if (row === undefined) return;
    row.preview = new Uint8Array(png);
    await run(store.put(row));
  });
}

export async function uninstallScenario(id: string): Promise<void> {
  await withStore('readwrite', (store) => run(store.delete(id)));
}
