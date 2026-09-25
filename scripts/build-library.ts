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
import { basename, dirname, join } from 'node:path';
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

/**
 * Each download's name as an archive's own pages list it, keyed by the zip's
 * file name in lower case, with the page that lists it (for credit). Kelandon's
 * index follows a utility's link with "( Utility )", which is the only
 * category either archive gives.
 */
function linkedNames(pagesDir: string, pageUrl: (file: string) => string,
  clean: (text: string) => string = (t) => t): Map<string, { name: string; page: string; utility: boolean }> {
  const out = new Map<string, { name: string; page: string; utility: boolean }>();
  if (!existsSync(pagesDir)) return out;
  for (const file of readdirSync(pagesDir).sort()) {
    const html = readFileSync(join(pagesDir, file), 'latin1');
    for (const m of html.matchAll(/<a[^>]*href="([^"]+\.zip)"[^>]*>([\s\S]*?)<\/a>([^\n]*)/gi)) {
      const zip = decodeURIComponent(basename(m[1]!)).toLowerCase();
      const name = clean(text(m[2]!));
      const utility = file === 'utility.html' || /\(\s*Utility\s*\)/i.test(text(m[3]!.split(/<br/i)[0]!));
      if (name !== '' && !out.has(zip)) out.set(zip, { name, page: pageUrl(file), utility });
    }
  }
  return out;
}

const S3 = 'https://spiderwebstuff.s3.us-west-1.amazonaws.com/archive/';
const TRUESITE = 'https://truesite4blades.nethergate.net/Home/';
const OTHER_ARCHIVES: { dir: string; home: string; names: () => ReturnType<typeof linkedNames> }[] = [
  {
    dir: 'archive-s3', home: `${S3}archive.html`,
    names: () => linkedNames(join(LIB, 'pages', 's3'), (f) => `${S3}${f}`),
  },
  {
    dir: 'archive-truesite', home: `${TRUESITE}mylittleboepage.html`,
    // fetch-archive.mjs saved TrueSite4Blades/x.html as TrueSite4Blades_x.html.
    names: () => linkedNames(join(LIB, 'pages', 'truesite'), (f) => `${TRUESITE}${f.replace('_', '/')}`,
      (t) => t.replace(/^Download\s+/i, '')),
  },
];

/**
 * The review forum's header for each scenario (scripts/forum-reviews.tsv:
 * spiderwebforums, "Blades of Exile Scenario Reviews", one topic per
 * scenario). The forum sits behind Cloudflare, so the table was read in a
 * browser and committed rather than fetched here. Refresh it the same way.
 */
const FORUM_TOPIC = 'https://spiderwebforums.ipbhost.com/topic/';
interface ForumRow { title: string; difficulty: string; rating: string; entry: NonNullable<LibraryEntry['forum']> }
const forumRows = new Map<string, ForumRow>();
/** A title as the forum and the archives both write it: no articles, punctuation or "(Utility)". */
const titleKey = (s: string): string => s.toLowerCase()
  .replace(/\(utility\)|\(creator\)/g, '')
  .replace(/[^a-z0-9 ]/g, '')
  .replace(/\b(the|a|an)\b/g, '')
  .replace(/\s+/g, '');
for (const line of readFileSync('scripts/forum-reviews.tsv', 'utf8').split('\n').slice(1)) {
  const [topic, title, , difficulty, rating, , votes] = line.split('\t');
  if (!topic || !title) continue;
  // Best, Good, Average, Substandard, Poor: 5 down to 1. The forum's own
  // "Composite Score" is this same mean, but it is filled in by hand, so a
  // topic with votes can still say "Not reviewed yet".
  const counts = (votes ?? '').split(',').map(Number);
  const n = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, c, i) => a + c * (5 - i), 0);
  forumRows.set(titleKey(title), {
    title, difficulty: difficulty ?? '', rating: rating ?? '',
    entry: { url: `${FORUM_TOPIC}${topic}/`, score: n > 0 ? Math.round((sum / n) * 100) / 100 : null, votes: n },
  });
}
const forumReview = (...titles: string[]): ForumRow | undefined =>
  titles.map((t) => forumRows.get(titleKey(t))).find((r) => r !== undefined);

const opcodes = buildOpcodeTable(readFileSync('public/data/strings/specials-opcodes.txt', 'utf8'));
mkdirSync(join(DIST, 'files'), { recursive: true });
mkdirSync(join(DIST, 'previews'), { recursive: true });

const entries: LibraryEntry[] = [];
const skipped: string[] = [];
const seen = new Set<string>();

/** What a listing says about a scenario, wherever the listing came from. */
type Meta = Omit<Listing, 'zip'> & { source: string };

/**
 * Load, smoke-test and list every scenario in one download. `file` is where
 * the trimmed zip goes under `files/`. The first copy of an id wins, which is
 * why Spiderweb's lists go first: they carry the most about each scenario.
 */
async function addZip(zipPath: string, file: string, meta: Meta): Promise<void> {
  const name = basename(zipPath);
  let trimmed: Uint8Array;
  try {
    trimmed = trimmedZip(readFileSync(zipPath));
  } catch (err) {
    skipped.push(`${zipPath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const packages = identifyScenarioFiles([{ name, data: trimmed }]);
  if (packages.length === 0) skipped.push(`${zipPath}: no scenario inside`);
  for (const pkg of packages) {
    if (seen.has(pkg.id)) { skipped.push(`${zipPath}: ${pkg.id} is already listed`); continue; }
    // The game ships these; a library copy would install under the same id.
    if (BUNDLED.includes(pkg.id)) { skipped.push(`${zipPath}: ${pkg.id} is bundled with the game`); continue; }
    try {
      const { scenario, warnings } = await loadScenarioPackage(pkg, opcodes);
      const session = new GameSession(new Universe(scenario, new GameRng(), PartyPreset.DEFAULT));
      session.startNewGame();
      for (let t = 0; t < scenario.towns.length; t++) session.startTownMode(t, FORCED_ENTRY, true);
      seen.add(pkg.id);
      mkdirSync(dirname(join(DIST, 'files', file)), { recursive: true });
      writeFileSync(join(DIST, 'files', file), trimmed);
      const trim = (s: string): string => s.trim();
      // Ten or so never renamed the editor's placeholder title.
      const title = trim(scenario.title).replace(/^Scen name$/i, '') || meta.name;
      const corrupted = corruptionSigns(scenario);
      const forum = forumReview(meta.name, title);
      // A scenario only the other archives carry has no listing to say how
      // hard or how strong it is, so the forum's review header fills in.
      const difficulty = meta.difficulty || forum?.difficulty || '';
      const contentRating = RATING.exec(meta.contentRating)?.[1]
        ?? RATING.exec(forum?.rating.replace(/^PG13$/, 'PG-13') ?? '')?.[1] ?? '';
      entries.push({
        id: pkg.id,
        title,
        blurb: scenario.teasers.map(trim).find((t) => t !== '') ?? '',
        icon: scenario.introPic,
        listedAs: meta.name,
        table: meta.table,
        category: meta.category,
        difficulty: difficultyLevel(difficulty),
        difficultyListed: difficulty,
        contentRating,
        description: meta.description,
        review: meta.review,
        ...(forum !== undefined ? { forum: forum.entry } : {}),
        towns: scenario.towns.length,
        customGraphics: pkg.graphics !== undefined,
        file: `files/${file}`,
        fileBytes: trimmed.length,
        package: pkg.fileName,
        ...(existsSync(join(DIST, 'previews', `${pkg.id}.png`)) ? { preview: `previews/${pkg.id}.png` } : {}),
        source: meta.source,
        ...(warnings.length ? { warnings } : {}),
        ...(corrupted !== null ? { corrupted } : {}),
      });
    } catch (err) {
      skipped.push(`${zipPath} (${pkg.fileName}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

for (const item of listings()) {
  const zipPath = join(LIB, 'archive', item.zip);
  if (!existsSync(zipPath) || !/\.zip$/i.test(item.zip)) {
    skipped.push(`${item.zip}: not downloaded, or not a zip`);
    continue;
  }
  await addZip(zipPath, basename(item.zip), { ...item, source: `${PAGE_URL}${item.table}.html` });
}

// Then the two bigger archives (fetch-archive.mjs), for what Spiderweb's
// lists leave out. They list a name and a download and nothing else.
for (const other of OTHER_ARCHIVES) {
  const dir = join(LIB, other.dir);
  if (!existsSync(dir)) { skipped.push(`${dir}: not downloaded (node scripts/fetch-archive.mjs)`); continue; }
  const names = other.names();
  for (const zip of readdirSync(dir).filter((f) => /\.zip$/i.test(f)).sort()) {
    const listed = names.get(zip.toLowerCase());
    await addZip(join(dir, zip), `${other.dir}/${zip}`, {
      table: 'archive', category: listed?.utility ? 'Utility' : '', name: listed?.name ?? zip.replace(/\.zip$/i, ''), size: '',
      difficulty: '', contentRating: '', description: '', review: null,
      source: listed?.page ?? other.home,
    });
  }
}

const catalog: LibraryCatalog = {
  generated: new Date().toISOString(),
  source: 'https://www.spiderwebsoftware.com/blades/scen_list.html',
  note: 'Community scenarios for Blades of Exile, from Spiderweb Software\'s scenario archive, '
    + 'Kelandon\'s archive and TrueSite for Blades. Each belongs to its author; see its listing for credit.',
  scenarios: entries.sort((a, b) => a.title.localeCompare(b.title)),
};
writeFileSync(join(DIST, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`${entries.length} scenarios in ${join(DIST, 'catalog.json')}`);
const corrupt = entries.filter((e) => e.corrupted !== undefined);
if (corrupt.length) console.log(`Tagged as corrupted:\n  ${corrupt.map((e) => `${e.id}: ${e.corrupted}`).join('\n  ')}`);
if (skipped.length) console.log(`Skipped:\n  ${skipped.join('\n  ')}`);
