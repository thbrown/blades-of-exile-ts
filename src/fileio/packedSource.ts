/**
 * A packed `.boes` scenario held in memory — the `is_packed` branch of
 * `load_scenario_v2` (fileio_scen.cpp:2310), where every file comes out of one
 * tarball as `scenario/<relpath>` instead of off the disk.
 *
 * The package is a gzipped ustar tar of the same tree `public/scenarios/<id>/`
 * holds unpacked, so once it is open nothing downstream can tell the two apart.
 */

import { gunzipSync } from 'fflate';
import { readTar } from './tarball';
import { ScenarioSource } from './source';

/** Every path in a package sits under this directory (`pack.getFile("scenario/" + relpath)`). */
const PACK_ROOT = 'scenario/';

export class PackedSource implements ScenarioSource {
  private readonly files = new Map<string, Uint8Array>();

  /**
   * `id` is what a save records as the scenario, so it has to be stable across
   * sessions — the caller picks it (from the file name), not the package.
   */
  constructor(readonly id: string, data: Uint8Array) {
    // The desktop build gzips; accept a bare tar too, as `openSave` does.
    const gzipped = data[0] === 0x1f && data[1] === 0x8b;
    for (const entry of readTar(gzipped ? gunzipSync(data) : data)) {
      if (!entry.name.startsWith(PACK_ROOT)) continue;
      this.files.set(entry.name.slice(PACK_ROOT.length), entry.data);
    }
    // `load_scenario_v2` reads the binary header first and gives up without it.
    if (!this.files.has('header.exs') || !this.files.has('scenario.xml')) {
      throw new Error('not a Blades of Exile scenario: no scenario/header.exs or scenario/scenario.xml');
    }
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  getText(path: string): Promise<string> {
    return this.getBinary(path).then((data) => new TextDecoder().decode(data));
  }

  getBinary(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (data === undefined) return Promise.reject(new Error(`${this.id}: no ${path} in the package`));
    return Promise.resolve(data);
  }
}

/**
 * A scenario id from a file name: `Valley Of Dying Things.boes` →
 * `valley-of-dying-things`. It lands in URLs (`?scenario=`) and save files, so
 * it is kept to the characters `scenarioFromQuery` accepts.
 */
export function scenarioIdFromFileName(fileName: string): string {
  return fileName
    .replace(/\.(boes|exs|zip)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scenario';
}
