/**
 * Build the scenario library for the bucket from the archive in `library/`
 * (`scripts/fetch-archive.mjs` fills it). Writes `library/dist/`:
 *
 *   catalog.json      every playable scenario, with the archive's listing
 *   files/<zip>       each download, trimmed to what plays: the scenario,
 *                     its .bmp and the author's documents (readme, hints,
 *                     maps). The Mac `.meg` resource forks (every one has a
 *                     `.bmp` twin), nested StuffIt archives, saved games and
 *                     music are dropped — about half the size, since the
 *                     library ships inside the site for now.
 *   previews/<id>.png filled in by scripts/scenario-previews.mjs --library
 *
 * A scenario is listed only if it loads and survives the smoke steps
 * (a new game, a few steps, every town entered), so nothing on the list is
 * known to be broken on arrival. Author email addresses from the listing are
 * left out: the listing page is linked instead, and credits the author.
 *
 * Usage: npx vite-node scripts/build-library.ts
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { GameRng } from '../src/core/rng';
import { identifyScenarioFiles, loadScenarioPackage } from '../src/fileio/scenarioPackage';
import { legacyPlatform } from '../src/fileio/legacy/loadLegacy';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { LibraryCatalog, LibraryEntry, corruptionSigns } from '../src/fileio/libraryCatalog';
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

const RATING = /^(G|PG-13|PG|R|NC-17)\b/;

/**
 * Spiderweb's difficulty wording, which is free text ("Medium/ High",
 * "Beginner Party moving to Very High"), as one of four levels. A range takes
 * its top end — the part a party has to survive.
 */
function difficultyLevel(listed: string): LibraryEntry['difficulty'] {
  const s = listed.toLowerCase();
  if (/very (high|hard)/.test(s)) return 'Very Hard';
  if (/high|hard/.test(s)) return 'Hard';
  if (/medium|moderate/.test(s)) return 'Moderate';
  if (/low|beginner|easy/.test(s)) return 'Easy';
  return '';
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
      // Two rows have difficulty and rating in one cell ("Medium R"), which
      // shifts everything after it along by one.
      const merged = /^(.*?)\s+(G|PG-13|PG|R|NC-17)$/.exec(cells[3] ?? '');
      if (merged && !RATING.test(cells[4] ?? '')) cells.splice(3, 1, merged[1]!, merged[2]!);
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

/** What a trimmed zip keeps. */
const KEEP = /\.(exs|bmp|txt|rtf|htm|html|doc|hnt|gif)$/i;

/** The download with only what plays and what the author wrote about it. */
function trimmedZip(zip: Uint8Array): Uint8Array {
  const kept: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const leaf = name.split('/').pop() ?? '';
    if (name.startsWith('__MACOSX') || leaf.startsWith('._') || name.endsWith('/')) continue;
    // A few Mac copies are named `x.exs 1` (a Finder duplicate); keep anything
    // that *is* a scenario, under its proper name.
    if (legacyPlatform(data) !== null) kept[name.replace(/\.exs \d+$/i, '.exs')] = data;
    else if (KEEP.test(leaf)) kept[name] = data;
  }
  return zipSync(kept, { level: 9 });
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
  const trimmed = trimmedZip(readFileSync(zipPath));
  const packages = identifyScenarioFiles([{ name: item.zip, data: trimmed }]);
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
      writeFileSync(join(DIST, 'files', basename(item.zip)), trimmed);
      const trim = (s: string): string => s.trim();
      const corrupted = corruptionSigns(scenario);
      entries.push({
        id: pkg.id,
        title: trim(scenario.title) || item.name,
        blurb: scenario.teasers.map(trim).find((t) => t !== '') ?? '',
        icon: scenario.introPic,
        listedAs: item.name,
        table: item.table,
        category: item.category,
        difficulty: difficultyLevel(item.difficulty),
        difficultyListed: item.difficulty,
        contentRating: RATING.exec(item.contentRating)?.[1] ?? '',
        description: item.description,
        review: item.review,
        towns: scenario.towns.length,
        customGraphics: pkg.graphics !== undefined,
        file: `files/${basename(item.zip)}`,
        fileBytes: trimmed.length,
        package: pkg.fileName,
        ...(existsSync(join(DIST, 'previews', `${pkg.id}.png`)) ? { preview: `previews/${pkg.id}.png` } : {}),
        source: `${PAGE_URL}${item.table}.html`,
        ...(warnings.length ? { warnings } : {}),
        ...(corrupted !== null ? { corrupted } : {}),
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
const corrupt = entries.filter((e) => e.corrupted !== undefined);
if (corrupt.length) console.log(`Tagged as corrupted:\n  ${corrupt.map((e) => `${e.id}: ${e.corrupted}`).join('\n  ')}`);
if (skipped.length) console.log(`Skipped:\n  ${skipped.join('\n  ')}`);
