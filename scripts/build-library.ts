/**
 * Build the scenario library for the bucket from the archive in `library/`
 * (`scripts/fetch-archive.mjs` fills it). Writes `library/dist/`:
 *
 *   catalog.json      every playable scenario, with the archive's listing
 *   files/<zip>       each download exactly as Spiderweb publishes it, the
 *                     author's readme included
 *   previews/<id>.png filled in by scripts/scenario-previews.mjs --library
 *
 * A scenario is listed only if it loads and survives the smoke steps
 * (a new game, a few steps, every town entered), so nothing on the list is
 * known to be broken on arrival. Author email addresses from the listing are
 * left out: the listing page is linked instead, and credits the author.
 *
 * Usage: npx vite-node scripts/build-library.ts
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { GameRng } from '../src/core/rng';
import { identifyScenarioFiles, loadScenarioPackage } from '../src/fileio/scenarioPackage';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { LibraryCatalog, LibraryEntry } from '../src/fileio/libraryCatalog';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const LIB = 'library';
const DIST = join(LIB, 'dist');
const PAGES: { page: LibraryEntry['table']; label: string }[] = [
  { page: 'solid', label: 'Solid Adventures' },
  { page: 'untried', label: 'Untried and Untested' },
  { page: 'first_efforts', label: 'First Efforts' },
];
const BUNDLED = ['valleydy', 'stealth', 'zakhazi', 'busywork'];
const PAGE_URL = 'https://www.spiderwebsoftware.com/blades/scen_stuff/';

interface Listing {
  table: LibraryEntry['table'];
  category: string;
  name: string;
  size: string;
  difficulty: string;
  contentRating: string;
  description: string;
  review: number | null;
  zip: string;
}

const text = (html: string): string => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

function listings(): Listing[] {
  const out: Listing[] = [];
  for (const { page } of PAGES) {
    const html = readFileSync(join(LIB, 'pages', `${page}.html`), 'latin1');
    for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const href = /href="[^"]*user_scen\/([^"]+)"/i.exec(row[1]!)?.[1];
      if (href === undefined) continue;
      const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1]!));
      // Untried has no review column.
      const hasReview = cells.length >= 8;
      const review = hasReview ? parseFloat(cells[6] ?? '') : NaN;
      out.push({
        table: page,
        category: cells[0] ?? '',
        name: cells[1] ?? '',
        size: cells[2] ?? '',
        difficulty: cells[3] ?? '',
        contentRating: cells[4] ?? '',
        description: cells[5] ?? '',
        review: Number.isFinite(review) ? review : null,
        zip: href,
      });
    }
  }
  return out;
}

function filesIn(dir: string): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else out.push({ name: entry.name, data: readFileSync(full) });
  }
  return out;
}

const opcodes = buildOpcodeTable(readFileSync('public/data/strings/specials-opcodes.txt', 'utf8'));
mkdirSync(join(DIST, 'files'), { recursive: true });
mkdirSync(join(DIST, 'previews'), { recursive: true });

const entries: LibraryEntry[] = [];
const skipped: string[] = [];
const seen = new Set<string>();
for (const item of listings()) {
  const zipPath = join(LIB, 'archive', item.zip);
  if (!existsSync(zipPath) || !/\.zip$/i.test(item.zip)) {
    skipped.push(`${item.zip}: not downloaded, or not a zip`);
    continue;
  }
  const packages = identifyScenarioFiles([{ name: item.zip, data: readFileSync(zipPath) }]);
  if (packages.length === 0) skipped.push(`${item.zip}: no scenario inside`);
  for (const pkg of packages) {
    if (seen.has(pkg.id)) { skipped.push(`${item.zip}: ${pkg.id} is listed twice`); continue; }
    // The game ships these; a library copy would install under the same id.
    if (BUNDLED.includes(pkg.id)) { skipped.push(`${item.zip}: ${pkg.id} is bundled with the game`); continue; }
    try {
      const { scenario, warnings } = await loadScenarioPackage(pkg, opcodes);
      const session = new GameSession(new Universe(scenario, new GameRng(), PartyPreset.DEFAULT));
      session.startNewGame();
      for (let t = 0; t < scenario.towns.length; t++) session.startTownMode(t, FORCED_ENTRY, true);
      seen.add(pkg.id);
      copyFileSync(zipPath, join(DIST, 'files', basename(item.zip)));
      const trim = (s: string): string => s.trim();
      entries.push({
        id: pkg.id,
        title: trim(scenario.title) || item.name,
        blurb: scenario.teasers.map(trim).find((t) => t !== '') ?? '',
        icon: scenario.introPic,
        listedAs: item.name,
        table: item.table,
        category: item.category,
        difficulty: item.difficulty,
        contentRating: item.contentRating,
        description: item.description,
        review: item.review,
        towns: scenario.towns.length,
        customGraphics: pkg.graphics !== undefined,
        file: `files/${basename(item.zip)}`,
        fileBytes: readFileSync(zipPath).length,
        package: pkg.fileName,
        ...(existsSync(join(DIST, 'previews', `${pkg.id}.png`)) ? { preview: `previews/${pkg.id}.png` } : {}),
        source: `${PAGE_URL}${item.table}.html`,
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (err) {
      skipped.push(`${item.zip} (${pkg.fileName}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const catalog: LibraryCatalog = {
  generated: new Date().toISOString(),
  source: 'https://www.spiderwebsoftware.com/blades/scen_list.html',
  note: 'Community scenarios for Blades of Exile, from Spiderweb Software\'s scenario archive. '
    + 'Each belongs to its author; see its listing for credit.',
  scenarios: entries.sort((a, b) => a.title.localeCompare(b.title)),
};
writeFileSync(join(DIST, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`${entries.length} scenarios in ${join(DIST, 'catalog.json')}`);
if (skipped.length) console.log(`Skipped:\n  ${skipped.join('\n  ')}`);
