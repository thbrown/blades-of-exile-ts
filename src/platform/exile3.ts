/**
 * Exile III in the player's browser. The published site may not carry a
 * converted copy of the game (its licence allows redistributing it only
 * unaltered: vendor/exile3/README.md), so it carries Spiderweb's installer as
 * it is, at `exile3/EXL3INST.EXE`, and the browser converts it the first time
 * Exile III is played — in a worker, with the same converter `npm run dev`
 * runs in Node — and keeps the result in the scenario store.
 *
 * Where the converted files are served already (`npm run dev` makes them in
 * `public/scenarios/exile3/`), those are used instead and nothing happens
 * here.
 */

import type { ScenarioPackage } from '../fileio/scenarioPackage';
import { getInstalledScenario, installScenario, scenarioStoreAvailable } from './scenarioStore';

export const EXILE3_ID = 'exile3';

/** A hash of the conversion's inputs (vite.config.ts); a stored copy made by other code is redone. */
declare const __EXILE3_VERSION__: string;
const VERSION = typeof __EXILE3_VERSION__ === 'string' ? __EXILE3_VERSION__ : 'dev';
const FILE_NAME = `exile3-${VERSION}.boes`;

/** The installer's SHA-256 (`tools/e3convert/unpack.ts` has the same). */
const INSTALLER_SHA256 = '1a03ede845ba69cb3fffe75bdfd0c9525a6f2004769d6754ff12fb5e9101e71c';

/** The startup screen's card, for when there is no `scenario.xml` to read it from. */
export const EXILE3_CARD = {
  id: EXILE3_ID,
  title: 'Exile III: Ruined World',
  blurb: 'The surface world is dying. Find out why.',
  // A committed picture of the game's first screen (the user's decision,
  // 2026-09-27), so the card has one before anyone has played.
  preview: `${import.meta.env.BASE_URL}exile3-preview.png`,
  // The game's own icon, EXILE3.ICO (tools/e3convert/makeIcon.ts).
  icon: `${import.meta.env.BASE_URL}exile3-icon.png`,
};

/**
 * The game sheets a converted Exile III replaces (`graphics/NAME.png`), which
 * a served copy can't list. Must match tools/e3convert's `E3_SHEET_OVERRIDES`.
 */
export const EXILE3_SHEET_OVERRIDES = [
  'dlogpics', 'talkportraits', 'pixpats', 'statarea', 'inventory', 'transcript', 'textbar',
  'terscreen',
];

/**
 * Pictures of its own a converted Exile III ships that the game has no sheet
 * for — its opening logo and title picture. Must match tools/e3convert's
 * `E3_PICTURES`; `installSheetOverrides` adds them to the store as they are.
 */
export const EXILE3_PICTURES = ['e3logo', 'e3start'];

/**
 * The game's string tables a converted Exile III has lines for
 * (`strings/NAME.txt`, `overrideStrings`): its instant help, E3's string
 * block 10. Must match tools/e3convert's `E3_STRING_OVERRIDES`.
 */
export const EXILE3_STRING_OVERRIDES = ['help'];

/** Whether this site serves a converted copy as plain files (the dev server does). */
export async function exile3Served(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}scenarios/${EXILE3_ID}/scenario.xml`);
    if (!res.ok) return false;
    // A missing file can come back as the site's index page.
    return (await res.text()).includes('<scenario');
  } catch {
    return false;
  }
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Runs the conversion worker over the installer, reporting progress 0..1. */
function convert(installer: ArrayBuffer, onProgress: (done: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./exile3Worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ progress?: number; boes?: Uint8Array; error?: string }>) => {
      const m = ev.data;
      if (m.progress !== undefined) onProgress(m.progress);
      else {
        worker.terminate();
        if (m.boes) resolve(m.boes);
        else reject(new Error(m.error ?? 'the conversion failed'));
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'the conversion worker failed')); };
    worker.postMessage(installer, [installer]);
  });
}

/**
 * Exile III as an installed package, converting it first if the browser has
 * no current copy. `onProgress` hears what is happening and how far along
 * (0..1). Without a scenario store (a private window) the package is made
 * each time and not kept.
 */
export async function prepareExile3(onProgress: (what: string, done: number) => void): Promise<ScenarioPackage> {
  if (scenarioStoreAvailable()) {
    const have = await getInstalledScenario(EXILE3_ID).catch(() => null);
    if (have && have.fileName === FILE_NAME) return have;
  }
  onProgress('Fetching Exile III from Spiderweb’s installer…', 0);
  const res = await fetch(`${import.meta.env.BASE_URL}exile3/EXL3INST.EXE`);
  if (!res.ok) throw new Error(`could not fetch the Exile III installer (${res.status})`);
  const installer = await res.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', installer)) !== INSTALLER_SHA256) {
    throw new Error('the Exile III installer is not the expected file');
  }
  const boes = await convert(installer, (done) => onProgress('Converting Exile III for this browser (once)…', done));
  const pkg: ScenarioPackage = { id: EXILE3_ID, fileName: FILE_NAME, kind: 'boes', data: boes };
  if (scenarioStoreAvailable()) {
    onProgress('Saving Exile III in this browser…', 1);
    await installScenario(pkg).catch((e: unknown) => { console.warn('Exile III could not be kept:', e); });
  }
  return pkg;
}
