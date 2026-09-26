/**
 * Converts Exile III off the main thread: given Spiderweb's installer, it
 * unpacks it (`tools/e3convert/unpack.ts`), runs the converter
 * (`tools/e3convert/emit.ts`, the same code `npm run dev` runs in Node) and
 * packs the scenario tree as a `.boes` (a gzipped tar under `scenario/`).
 *
 * In:  the installer's bytes (an ArrayBuffer).
 * Out: `{ progress: 0..1 }` as it goes, then `{ boes: Uint8Array }` or
 *      `{ error: string }`.
 */

import { gzipSync } from 'fflate';
import { convertE3 } from '../../tools/e3convert/emit';
import { unpackE3Installer } from '../../tools/e3convert/unpack';
import { writeTar, type TarEntry } from '../fileio/tarball';

const post = (msg: unknown, transfer: Transferable[] = []): void => {
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);
};

self.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
  try {
    post({ progress: 0 });
    const files = unpackE3Installer(new Uint8Array(ev.data));
    const entries: TarEntry[] = [];
    const text = new TextEncoder();
    convertE3(
      (name) => {
        const f = files.get(name);
        if (!f) throw new Error(`the installer has no ${name}`);
        return f;
      },
      (path, data) => { entries.push({ name: `scenario/${path}`, data: typeof data === 'string' ? text.encode(data) : data }); },
      (done) => { post({ progress: 0.05 + 0.9 * done }); },
    );
    const boes = gzipSync(writeTar(entries), { level: 6 });
    post({ boes }, [boes.buffer]);
  } catch (e) {
    post({ error: e instanceof Error ? e.message : String(e) });
  }
};
