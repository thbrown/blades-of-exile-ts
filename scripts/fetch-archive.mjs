/**
 * Download Spiderweb's community scenario archive into `library/` (gitignored:
 * these are third-party works, fetched rather than committed).
 *
 *   library/pages/*.html     the three list pages
 *   library/archive/*.zip    one download per scenario, as published
 *   library/unzipped/<name>/ each zip unpacked
 *
 * Already-downloaded files are skipped, so it can be re-run to fill gaps.
 * `test/legacyImport.test.ts` (with LEGACY_ARCHIVE=1) and the smoke harness
 * read `library/unzipped`.
 *
 * Usage: node scripts/fetch-archive.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { unzipSync } from 'fflate';

const BASE = 'https://www.spiderwebsoftware.com/blades/scen_stuff/';
const PAGES = ['solid', 'untried', 'first_efforts'];
const LIB = 'library';

for (const dir of ['pages', 'archive', 'unzipped']) mkdirSync(join(LIB, dir), { recursive: true });

const urls = new Set();
for (const page of PAGES) {
  const file = join(LIB, 'pages', `${page}.html`);
  if (!existsSync(file)) {
    const resp = await fetch(`${BASE}${page}.html`);
    if (!resp.ok) throw new Error(`${page}: ${resp.status}`);
    writeFileSync(file, await resp.text());
  }
  for (const m of readFileSync(file, 'utf8').matchAll(/href="([^"]*user_scen\/[^"]+)"/gi)) urls.add(m[1]);
}

let fetched = 0;
const failed = [];
for (const url of [...urls].sort()) {
  const file = join(LIB, 'archive', basename(url));
  if (!existsSync(file)) {
    const resp = await fetch(url).catch(() => null);
    if (!resp?.ok) { failed.push(url); continue; }
    writeFileSync(file, new Uint8Array(await resp.arrayBuffer()));
    fetched++;
    await new Promise((r) => setTimeout(r, 300)); // be gentle with the server
  }
  if (!/\.zip$/i.test(file)) continue; // the one StuffIt archive stays packed
  const out = join(LIB, 'unzipped', basename(file).replace(/\.zip$/i, ''));
  if (existsSync(out)) continue;
  try {
    for (const [name, data] of Object.entries(unzipSync(readFileSync(file)))) {
      if (name.endsWith('/') || name.startsWith('__MACOSX')) continue;
      mkdirSync(dirname(join(out, name)), { recursive: true });
      writeFileSync(join(out, name), data);
    }
  } catch (err) {
    failed.push(`${file}: ${err.message}`);
  }
}
console.log(`${urls.size} scenarios listed, ${fetched} downloaded now.`);
if (failed.length) console.log(`Failed:\n  ${failed.join('\n  ')}`);
