/**
 * The scenario library's `catalog.json` — what `scripts/build-library.ts`
 * writes to the bucket and the startup screen reads. Paths are relative to
 * the catalog's own URL.
 */

export interface LibraryEntry {
  /** The id it installs under; what saves record. */
  id: string;
  title: string;
  /** The scenario's first teaser line. */
  blurb: string;
  /** `intro_pic`, into `scenpics`. */
  icon: number;
  /** The name on Spiderweb's list, which is sometimes not the title. */
  listedAs: string;
  /** Which of Spiderweb's three lists it's on. */
  table: 'solid' | 'untried' | 'first_efforts';
  category: string;
  /** Spiderweb's wording mapped onto four levels; '' if it gave none. */
  difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Very Hard' | '';
  /** The wording as listed ("Medium/ High", "Beginner (Very Low)"). */
  difficultyListed: string;
  /** G, PG, PG-13, R or NC-17; '' when the listing has none. */
  contentRating: string;
  description: string;
  /** The listing's average user review, 1-5; null when unreviewed. */
  review: number | null;
  towns: number;
  customGraphics: boolean;
  /** The download, as published — a zip. */
  file: string;
  fileBytes: number;
  /** Which scenario in the zip this entry is (a few zips hold two). */
  package: string;
  /** A picture of where a new game starts. */
  preview?: string;
  /** The listing page, for credit. */
  source: string;
  warnings?: string[];
}

export interface LibraryCatalog {
  generated: string;
  source: string;
  note: string;
  scenarios: LibraryEntry[];
}

/** Resolve an entry's relative path against the catalog's URL. */
export function libraryUrl(catalogUrl: string, path: string): string {
  return new URL(path, new URL(catalogUrl, globalThis.location?.href ?? 'http://localhost/')).href;
}
