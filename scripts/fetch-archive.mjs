/**
 * Download Spiderweb's community scenario archive into `library/` (gitignored:
 * these are third-party works, fetched rather than committed).
 *
 *   library/pages/*.html     the three list pages
 *   library/archive/*.zip    one download per scenario, as published
 *   library/unzipped/<name>/ each zip unpacked
 *
 * and then two larger archives, which hold about twice as many scenarios:
 *
 *   library/pages/s3/*.html        Kelandon's archive, back online on S3
 *   library/archive-s3/*.zip       its downloads
 *   library/pages/truesite/*.html  TrueSite for Blades, one page per scenario
 *   library/archive-truesite/*.zip its downloads
 *
 * These overlap each other and Spiderweb's lists heavily, under different
 * file names, so they are left zipped: `build-library.ts` reads the zips and
 * keeps one copy of each scenario. The forum thread that pointed at them
 * (spiderwebforums topic 33604) says S3 plus three TrueSite files
 * (Tatterdemalion, A Little Girl, Witch or Worse) is everything known.
 *
 * One more source can't be scripted: The Lurker's bundle of all of the above,
 * BoEArchFull.zip, on Google Drive (linked from that topic). Download it by
 * hand to library/BoEArchFull.zip. It holds the only whole copies of The
 * Crusaders and War Preparations, whose TrueSite zips are cut off, and newer
 * versions of several scenarios.
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

/**
 * Crawl `start` and every page under `prefix` it links to, keeping the pages
 * in `pagesDir`, and download every .zip they link to into `zipDir`.
 */
async function mirror(name, start, prefix, pagesDir, zipDir, pageLinks) {
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(zipDir, { recursive: true });
  const pages = [start];
  const seenPages = new Set(pages);
  const zips = new Set();
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i];
    const file = join(pagesDir, url.slice(prefix.length).replace(/\//g, '_') || 'index.html');
    if (!existsSync(file)) {
      const resp = await fetch(url).catch(() => null);
      if (!resp?.ok) { failed.push(url); continue; }
      writeFileSync(file, await resp.text());
      await new Promise((r) => setTimeout(r, 200));
    }
    const html = readFileSync(file, 'latin1');
    for (const m of html.matchAll(/href="([^"#]+)"/gi)) {
      let target;
      try { target = new URL(m[1], url).href; } catch { continue; }
      if (/\.zip$/i.test(target)) zips.add(target);
      else if (target.startsWith(prefix) && pageLinks.test(target) && !seenPages.has(target)) {
        seenPages.add(target);
        pages.push(target);
      }
    }
  }
  let got = 0;
  for (const url of [...zips].sort()) {
    const file = join(zipDir, decodeURIComponent(basename(url)));
    if (existsSync(file)) continue;
    const resp = await fetch(url).catch(() => null);
    if (!resp?.ok) { failed.push(url); continue; }
    writeFileSync(file, new Uint8Array(await resp.arrayBuffer()));
    got++;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`${name}: ${pages.length} pages, ${zips.size} downloads, ${got} fetched now.`);
}

const S3 = 'https://spiderwebstuff.s3.us-west-1.amazonaws.com/archive/';
await mirror('Kelandon\'s archive', `${S3}archive.html`, S3,
  join(LIB, 'pages', 's3'), join(LIB, 'archive-s3'), /\.html$/i);
// TrueSite's letter pages (walkthrougha.html…) link each scenario's own page,
// and that page links the download. Its other sections (BoA, graphics) are
// left alone.
const TRUESITE = 'https://truesite4blades.nethergate.net/Home/';
await mirror('TrueSite', `${TRUESITE}mylittleboepage.html`, TRUESITE,
  join(LIB, 'pages', 'truesite'), join(LIB, 'archive-truesite'),
  /\/Home\/(walkthrough[a-z]\.html|TrueSite4Blades\/[^/]+\.html)$/i);

if (failed.length) console.log(`Failed:\n  ${failed.join('\n  ')}`);
