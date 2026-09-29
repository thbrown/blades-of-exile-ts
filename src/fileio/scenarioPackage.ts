/**
 * A scenario as a file someone hands over: an OBoE `.boes` package, a 1997
 * `.exs` with its optional `.bmp` of custom graphics, or a `.zip` of those as
 * the community archive publishes them.
 *
 * `identifyScenarioFiles` works out which of the given files are scenarios and
 * pairs each `.exs` with its graphics; `loadScenarioPackage` builds the
 * `Scenario`. Kept apart from IndexedDB and the DOM so the publishing pipeline
 * can use it from Node.
 */

import { unzipSync } from 'fflate';
import { Scenario } from '../data/scenario';
import { SpecType } from '../data/special';
import { Rgba, decodeBmp } from './legacy/bmp';
import { legacyPlatform, loadLegacyScenario } from './legacy/loadLegacy';
import { legacySheets } from './legacy/legacySheets';
import { loadScenario } from './loadScenario';
import { PackedSource, scenarioIdFromFileName } from './packedSource';

export type PackageKind = 'boes' | 'exs';

export interface ScenarioPackage {
  /** What saves record and `?scenario=` names; from the file name. */
  id: string;
  /** The scenario file's own name, for messages. */
  fileName: string;
  kind: PackageKind;
  data: Uint8Array;
  /** An `.exs`'s `.bmp`, when it has one. */
  graphics?: Uint8Array;
}

export interface LoadedPackage {
  scenario: Scenario;
  /** Custom graphics sheets — from the package's PNGs, or cut from the `.bmp`. */
  sheets: { png?: Uint8Array; rgba?: Rgba }[];
  /** The package's own sounds, `sounds/SNDn.wav`, by `n`. */
  sounds: Map<number, Uint8Array>;
  /** Its own cursor images, `cursors/NAME.png`, by name (the `cursors` flag). */
  cursors: Map<string, Uint8Array>;
  /** Its replacements for the game's sheets, `graphics/NAME.png` (not `sheetN`). */
  overrides: Map<string, Uint8Array>;
  /** Its lines for the game's string tables, `strings/NAME.txt` (`overrideStrings`). */
  strings: Map<string, string>;
  warnings: string[];
}

function isGzipOrTar(data: Uint8Array): boolean {
  if (data[0] === 0x1f && data[1] === 0x8b) return true;
  // A bare ustar tar has "ustar" at 257.
  return String.fromCharCode(...data.subarray(257, 262)) === 'ustar';
}

function isZip(data: Uint8Array): boolean {
  return data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

const stem = (name: string): string => (name.split('/').pop() ?? name).replace(/\.[^.]*$/, '').toLowerCase();

/**
 * The scenarios among a set of files. A zip is opened (one level deep) and
 * treated as if its contents had been handed over. An `.exs` takes the `.bmp`
 * with its own name, or the only `.bmp` there is; the Mac `.meg` resource fork
 * is not read (no archive scenario ships one without a `.bmp`).
 */
export function identifyScenarioFiles(files: { name: string; data: Uint8Array }[]): ScenarioPackage[] {
  const flat: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, data: Uint8Array): void => {
    flat.push({ name, data: macBinaryDataFork(data) ?? data });
  };
  for (const f of files) {
    if (isZip(f.data)) {
      for (const [name, data] of Object.entries(unzipSync(f.data))) {
        if (name.endsWith('/') || name.startsWith('__MACOSX') || name.includes('/._')) continue;
        add(name, data);
      }
    } else add(f.name, f.data);
  }
  const bmps = flat.filter((f) => /\.bmp$/i.test(f.name) && f.data[0] === 0x42 && f.data[1] === 0x4d);
  const out: ScenarioPackage[] = [];
  for (const f of flat) {
    const fileName = f.name.split('/').pop() ?? f.name;
    if (legacyPlatform(f.data) !== null && f.data.length > 81142) {
      const graphics = bmps.find((b) => stem(b.name) === stem(f.name)) ?? (bmps.length === 1 ? bmps[0] : undefined);
      out.push({
        id: scenarioIdFromFileName(fileName), fileName, kind: 'exs', data: f.data,
        ...(graphics ? { graphics: graphics.data } : {}),
      });
    } else if (/\.boes$/i.test(f.name) && isGzipOrTar(f.data)) {
      out.push({ id: scenarioIdFromFileName(fileName), fileName, kind: 'boes', data: f.data });
    }
  }
  return out;
}

/** Load a package into a playable `Scenario` and its custom sheets. */
export async function loadScenarioPackage(
  pkg: ScenarioPackage, opcodes: Map<string, SpecType>, onExtraFilesKnown?: (count: number) => void,
): Promise<LoadedPackage> {
  if (pkg.kind === 'boes') {
    const src = new PackedSource(pkg.id, pkg.data);
    const scenario = await loadScenario(src, opcodes, onExtraFilesKnown);
    const sheets: LoadedPackage['sheets'] = [];
    // `load_scenario_v2` counts the first unbroken run of sheetN.png.
    while (src.has(`graphics/sheet${sheets.length}.png`)) {
      sheets.push({ png: await src.getBinary(`graphics/sheet${sheets.length}.png`) });
    }
    const sounds = new Map<number, Uint8Array>();
    const cursors = new Map<string, Uint8Array>();
    const overrides = new Map<string, Uint8Array>();
    const strings = new Map<string, string>();
    for (const path of src.paths()) {
      const t = /^strings\/(\w+)\.txt$/.exec(path);
      if (t) strings.set(t[1]!, await src.getText(path));
      const m = /^sounds\/SND(\d+)\.wav$/.exec(path);
      if (m) sounds.set(Number(m[1]), await src.getBinary(path));
      const c = /^cursors\/(\w+)\.png$/.exec(path);
      if (c) cursors.set(c[1]!, await src.getBinary(path));
      const g = /^graphics\/(\w+)\.png$/.exec(path);
      if (g && !/^sheet\d+$/.test(g[1]!)) overrides.set(g[1]!, await src.getBinary(path));
    }
    return { scenario, sheets, sounds, cursors, overrides, strings, warnings: [] };
  }
  const { scenario, warnings } = loadLegacyScenario(pkg.data, pkg.id);
  let sheets: LoadedPackage['sheets'] = [];
  if (pkg.graphics) {
    try {
      sheets = legacySheets(decodeBmp(pkg.graphics)).map((rgba) => ({ rgba }));
    } catch (err) {
      // "The game will still work without the custom graphics, but some
      // things will not look right." (fileio_scen.cpp:2689)
      warnings.push(`The custom graphics could not be read (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  return { scenario, sheets, sounds: new Map(), cursors: new Map(), overrides: new Map(), strings: new Map(), warnings };
}

/**
 * The data fork of a MacBinary file, or null if `data` isn't one. Mac authors
 * sometimes uploaded files wrapped this way: a 128-byte header naming the
 * file, then its data fork, then its resource fork. Four archive scenarios'
 * `.bmp`s are wrapped (Echoes: Pawns, Black Horse, Nightmare, Quintessence).
 * Without this their custom graphics were silently dropped, and every custom
 * terrain drew as a blank square. The header is checked as MacBinary readers
 * check it: a zero first byte, a 1–63 character name, zeros at bytes 74 and
 * 82, and a data fork that fits in the file.
 */
export function macBinaryDataFork(data: Uint8Array): Uint8Array | null {
  if (data.length < 128) return null;
  const nameLen = data[1]!;
  if (data[0] !== 0 || nameLen < 1 || nameLen > 63 || data[74] !== 0 || data[82] !== 0) return null;
  const len = ((data[83]! << 24) | (data[84]! << 16) | (data[85]! << 8) | data[86]!) >>> 0;
  if (len === 0 || 128 + len > data.length) return null;
  return data.subarray(128, 128 + len);
}
