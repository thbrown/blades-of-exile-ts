/**
 * The scenario library's `catalog.json` — what `scripts/build-library.ts`
 * writes to the bucket and the startup screen reads. Paths are relative to
 * the catalog's own URL.
 */

import { Scenario } from '../data/scenario';

export interface LibraryEntry {
  /** The id it installs under; what saves record. */
  id: string;
  title: string;
  /** The scenario's first teaser line. */
  blurb: string;
  /** `intro_pic`, into `scenpics`. */
  icon: number;
  /** The name on the list it came from, which is sometimes not the title. */
  listedAs: string;
  /**
   * Which of Spiderweb's three lists it's on, or `archive` for one only
   * Kelandon's archive or TrueSite carries (no category, description or
   * review of its own there).
   */
  table: 'solid' | 'untried' | 'first_efforts' | 'archive';
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
  /**
   * Its topic on the forum's review board, when it has one: the mean of the
   * Best/Good/Average/Substandard/Poor votes (5 down to 1), and how many.
   */
  forum?: { url: string; score: number | null; votes: number };
  /**
   * The version the author set (`ver` in the scenario header), when it isn't
   * 0.0.0. Where sources disagree, the newest copy is the one listed.
   */
  version?: string;
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
  /**
   * Why the scenario looks misread, if it does (`corruptionSigns`). It still
   * loads, but plays as garbage; the startup screen tags it and lists it last.
   */
  corrupted?: string;
}

export interface LibraryCatalog {
  generated: string;
  source: string;
  note: string;
  scenarios: LibraryEntry[];
}

/**
 * Signs that a scenario loaded without error but was misread: the names every
 * scenario inherits from the editor's template (the first terrain types, the
 * first monsters) coming out empty or as stray bytes. Across the archive only
 * Masks v. 1.0.3 shows this — written by some other editor, in a layout
 * neither this port nor OBoE reads (PROGRESS.md) — and it fails both counts
 * by a wide margin, while every other scenario has none. Returns a reason,
 * or null.
 */
export function corruptionSigns(scenario: Pick<Scenario, 'terTypes' | 'scenMonsters'>): string | null {
  // Empty, or holding control characters or a run of 0xFF (ˇ in Mac Roman).
  const garbled = (name: string): boolean => {
    const t = name.trim();
    return t.length < 2 || /[\u0000-\u001f\u007f]|\u02c7\u02c7/.test(t);
  };
  const ter = scenario.terTypes.slice(0, 20).filter((t) => garbled(t.name)).length;
  const mon = scenario.scenMonsters.slice(1, 30).filter((m) => garbled(m.name)).length;
  if (ter < 5 && mon < 10) return null;
  return `${ter} of the first 20 terrain names and ${mon} of the first 29 monster names are unreadable.`;
}

/** Resolve an entry's relative path against the catalog's URL. */
export function libraryUrl(catalogUrl: string, path: string): string {
  return new URL(path, new URL(catalogUrl, globalThis.location?.href ?? 'http://localhost/')).href;
}
