/**
 * The startup screen — `MODE_STARTUP` (boe.consts.hpp:99) in browser clothing.
 *
 * The original draws a splash with five buttons (`draw_startup`,
 * boe.graphics.cpp:288) and reaches the scenario list through a second dialog.
 * This is the same two choices in one screen, because the web build has a
 * question the original doesn't: which scenario's *files* to fetch. Everything
 * downstream — the sheets, the strings, the Universe — needs that answer before
 * it can start, so it is asked first rather than last.
 *
 * One list holds every scenario there is to start: the official ones Spiderweb
 * shipped (badged, and always first), the ones the player added themselves,
 * and the community library (`catalog.json`), best reviewed first. A search
 * box and a row of toggles narrow it. Each is a card with a picture — where a
 * new game starts, or the scenario's own icon from `scenpics` until there is
 * one. Scenarios can be added with the button or by dropping files anywhere on
 * the screen: a `.boes`, an `.exs` and its `.bmp`, or a zip.
 *
 * Plain DOM and no canvas: this runs before the graphics sheets have loaded.
 * `?scenario=` skips it entirely, which is what a direct link and the headless
 * verifier use.
 */

import { LibraryEntry } from '../fileio/libraryCatalog';

export interface StartupScenario {
  id: string;
  title: string;
  /** The scenario's first teaser line, shown under its title. */
  blurb: string;
  /** `intro_pic` — its icon in `scenpics`, 5 across, 32×32 each. */
  icon?: number;
  /** A picture of where it starts; the card falls back to the icon if it won't load. */
  preview?: string;
}

export interface StartupSave {
  /** The slot name in the save store. */
  slot: string;
  scenarioId: string;
  label: string;
}

export interface StartupChoice {
  scenarioId: string;
  /** Set when the player picked a saved game rather than a fresh start. */
  slot?: string;
}

/**
 * The community scenario library. A card installs its scenario on first click
 * and then starts it.
 */
export interface StartupLibrary {
  entries: LibraryEntry[];
  /** Resolve a catalog-relative path (a preview, a download). */
  url: (path: string) => string;
  /** Ids already installed, which start at once. */
  installed: ReadonlySet<string>;
  install: (entry: LibraryEntry) => Promise<void>;
}

/** Install every scenario among some files; throws with a reason if there are none. */
export type ImportScenarios = (files: { name: string; data: Uint8Array }[]) => Promise<StartupScenario[]>;

export interface StartupOptions {
  /** Spiderweb's own scenarios, shipped with the game. */
  official: readonly StartupScenario[];
  /** Scenarios the player installed; any that are library entries show as those instead. */
  added: readonly StartupScenario[];
  saves: readonly StartupSave[];
  /** Absent when there's nowhere to keep a scenario (no IndexedDB). */
  importScenarios?: ImportScenarios;
  library?: StartupLibrary;
}

const REPO_URL = 'https://github.com/thbrown/exile-js';
const WIKIPEDIA_URL = 'https://en.wikipedia.org/wiki/Blades_of_Exile';

/** The icons in `scenpics` — 5 columns, 7 rows. */
const SCEN_ICONS = 35;

/** Which toggle a card answers to. */
type Group = 'official' | 'added' | LibraryEntry['table'];

const GROUP_LABELS: [Group, string][] = [
  ['official', 'Official'],
  ['solid', 'Solid adventures'],
  ['first_efforts', 'First efforts'],
  ['untried', 'Untried'],
  ['added', 'Added by you'],
];

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href: string, text: string, className?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  if (className !== undefined) a.className = className;
  // A link inside a card mustn't also pick the card.
  a.addEventListener('click', (e) => { e.stopPropagation(); });
  return a;
}

/** The icon, cut out of `scenpics` with CSS and doubled like the game canvas. */
function iconElement(icon: number): HTMLElement {
  const node = el('span', 'startup-icon');
  const n = icon >= 0 && icon < SCEN_ICONS ? icon : 0;
  node.style.backgroundImage = `url(${import.meta.env.BASE_URL}data/graphics/scenpics.png)`;
  node.style.backgroundPosition = `${-64 * (n % 5)}px ${-64 * Math.floor(n / 5)}px`;
  return node;
}

function pictureElement(icon: number | undefined, preview: string | undefined): HTMLElement {
  const frame = el('span', 'startup-picture');
  // Only the picture and its corner icon go; anything laid over the frame
  // since (a badge) stays.
  const fallback = (): void => {
    for (const child of [...frame.querySelectorAll(':scope > img, :scope > .startup-icon')]) child.remove();
    frame.prepend(iconElement(icon ?? 0));
    frame.classList.add('icon-only');
  };
  if (preview !== undefined) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = preview;
    img.addEventListener('error', fallback, { once: true });
    frame.append(img);
    // The icon rides in the corner of the picture, as the scenario's own mark.
    if (icon !== undefined && icon < SCEN_ICONS) frame.append(iconElement(icon));
  } else fallback();
  return frame;
}

async function readFiles(list: FileList | File[]): Promise<{ name: string; data: Uint8Array }[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

function aboutSection(): HTMLElement {
  const about = el('section', 'startup-about');
  const p1 = el('p');
  p1.append(
    el('strong', undefined, 'Blades of Exile'),
    ' is a fantasy role-playing game by Jeff Vogel of Spiderweb Software, released in 1997 — the fourth and last of '
    + 'the Exile games. It shipped with three adventures and a scenario editor, and its players went on to write '
    + 'many more of their own. ',
    link(WIKIPEDIA_URL, 'More on Wikipedia'),
  );
  const p2 = el('p');
  p2.append(
    'This is a from-scratch port of the game to the browser: the original rules, screen and art, with nothing to '
    + 'install. It was built with heavy use of AI: most of the code was written by Claude, directed by a person, '
    + 'and checked against the original game by automated tests. ',
    link(REPO_URL, 'Source on GitHub'),
  );
  about.append(p1, p2);
  return about;
}

/**
 * Text as search compares it: lower case, letters and digits only, one space
 * between words — so "zakhazi" finds "The Za-Khazi Run".
 */
function searchable(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w !== '').join(' ');
}

interface Card {
  id: string;
  group: Group;
  node: HTMLElement;
  /** What the search box matches against (`searchable`). */
  text: string;
  /** Official first, then the player's own, then the library by review, corrupted last. */
  rank: number;
}

/**
 * Put the screen up and resolve once something is chosen. The overlay removes
 * itself first, so the caller can get on with loading against a clean page.
 */
export function showStartupScreen(host: HTMLElement, opts: StartupOptions): Promise<StartupChoice> {
  const { official, added, saves, importScenarios, library } = opts;
  return new Promise((resolve) => {
    const root = el('div', 'startup');
    root.append(el('h1', undefined, 'Blades of Exile'));
    root.append(aboutSection());

    const cleanups: (() => void)[] = [];
    const choose = (choice: StartupChoice): void => {
      for (const c of cleanups) c();
      root.remove();
      resolve(choice);
    };

    if (saves.length > 0) {
      root.append(el('h2', undefined, 'Continue a saved game'));
      const list = el('div', 'startup-list');
      for (const save of saves) {
        const button = el('button', 'startup-choice');
        button.append(el('strong', undefined, save.slot));
        button.append(el('small', undefined, save.label));
        // A save names its own scenario, so picking one here is also how a
        // party in a scenario other than the default gets opened at all.
        button.addEventListener('click', () => {
          choose({ scenarioId: save.scenarioId, slot: save.slot });
        });
        list.append(button);
      }
      root.append(list);
    }

    // ---- the one list
    const hasLibrary = library !== undefined && library.entries.length > 0;
    root.append(el('h2', undefined, 'Start a new game'));
    root.append(el('p', 'startup-sub', hasLibrary
      ? 'Choose an official scenario, or pick from the community scenario library.'
      : 'Choose a scenario.'));

    const cards: Card[] = [];
    const list = el('div', 'startup-list startup-cards');

    const scenarioCard = (scen: StartupScenario, group: 'official' | 'added', rank: number): Card => {
      const card = el('button', 'startup-choice startup-card');
      card.dataset['id'] = scen.id;
      const picture = pictureElement(scen.icon, scen.preview);
      picture.append(el('span', `startup-badge ${group}`, group === 'official' ? 'Official' : 'Added by you'));
      card.append(picture);
      const words = el('span', 'startup-words');
      words.append(el('strong', undefined, scen.title));
      if (scen.blurb !== '') words.append(el('small', undefined, scen.blurb));
      card.append(words);
      card.addEventListener('click', () => { choose({ scenarioId: scen.id }); });
      return { id: scen.id, group, node: card, text: searchable(`${scen.id} ${scen.title} ${scen.blurb}`), rank };
    };

    const libraryCard = (entry: LibraryEntry, rank: number): Card => {
      const lib = library!;
      const card = el('button', 'startup-choice startup-card');
      card.dataset['library'] = entry.id;
      const picture = pictureElement(entry.icon, entry.preview ? lib.url(entry.preview) : undefined);
      if (entry.corrupted !== undefined) {
        const badge = el('span', 'startup-badge corrupted', 'Corrupted');
        badge.title = `This file seems to have been misread, so it will not play properly. ${entry.corrupted}`;
        picture.append(badge);
        card.classList.add('corrupted');
      }
      card.append(picture);
      const words = el('span', 'startup-words');
      words.append(el('strong', undefined, entry.title));
      const facts = el('span', 'startup-facts');
      const bits: [string, string?][] = [];
      if (entry.category) bits.push([entry.category]);
      if (entry.difficulty) bits.push([entry.difficulty, `Listed as “${entry.difficultyListed}”`]);
      if (entry.contentRating) bits.push([entry.contentRating, 'Content rating']);
      bits.push(entry.review !== null
        ? [`★ ${entry.review.toFixed(1)}`, 'Average player review on the archive, out of 5']
        : ['Not yet reviewed']);
      bits.forEach(([text, tip], i) => {
        if (i > 0) facts.append(' · ');
        const span = el('span', undefined, text);
        if (tip !== undefined) span.title = tip;
        facts.append(span);
      });
      words.append(facts);
      words.append(el('small', undefined, entry.description || entry.blurb));
      // Empty (and hidden) until a click starts a download: progress and errors only.
      const state = el('span', 'startup-state', '');
      words.append(state);
      words.append(link(entry.source, `Listed as “${entry.listedAs}”`, 'startup-source'));
      card.append(words);
      card.addEventListener('click', () => {
        if (lib.installed.has(entry.id)) { choose({ scenarioId: entry.id }); return; }
        if (card.classList.contains('busy')) return;
        card.classList.add('busy');
        state.textContent = `Downloading ${Math.max(1, Math.round(entry.fileBytes / 1024))} KB…`;
        lib.install(entry).then(() => { choose({ scenarioId: entry.id }); }).catch((err: unknown) => {
          card.classList.remove('busy');
          state.textContent = `Couldn’t install: ${err instanceof Error ? err.message : String(err)}`;
        });
      });
      return {
        id: entry.id, group: entry.table, node: card, rank,
        text: searchable(`${entry.id} ${entry.title} ${entry.listedAs} ${entry.description} ${entry.blurb} ${entry.category}`),
      };
    };

    official.forEach((s, i) => cards.push(scenarioCard(s, 'official', i)));
    const libraryIds = new Set(library?.entries.map((e) => e.id) ?? []);
    added.filter((s) => !libraryIds.has(s.id)).forEach((s, i) => cards.push(scenarioCard(s, 'added', 1000 + i)));
    [...(library?.entries ?? [])]
      .sort((a, b) => Number(a.corrupted !== undefined) - Number(b.corrupted !== undefined)
        || (b.review ?? 0) - (a.review ?? 0) || a.title.localeCompare(b.title))
      .forEach((e, i) => cards.push(libraryCard(e, 10000 + i)));
    cards.sort((a, b) => a.rank - b.rank);

    // ---- search and toggles, above the list
    const on = new Set<Group>(GROUP_LABELS.map(([g]) => g));
    const controls = el('div', 'startup-controls');
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = 'Search scenarios';
    filter.className = 'startup-filter';
    controls.append(filter);
    const chips = el('div', 'startup-chips');
    const chipFor = new Map<Group, HTMLElement>();
    for (const [group] of GROUP_LABELS) {
      const chip = el('button', 'startup-chip on');
      chip.addEventListener('click', () => {
        if (on.has(group)) on.delete(group); else on.add(group);
        chip.classList.toggle('on', on.has(group));
        render();
      });
      chipFor.set(group, chip);
      chips.append(chip);
    }
    controls.append(chips);
    const shown = el('span', 'startup-shown');
    controls.append(shown);
    const empty = el('p', 'startup-empty', 'No scenarios match.');

    const render = (): void => {
      for (const [group, label] of GROUP_LABELS) {
        const n = cards.filter((c) => c.group === group).length;
        const chip = chipFor.get(group)!;
        chip.textContent = `${label} (${n})`;
        chip.hidden = n === 0;
      }
      const q = searchable(filter.value);
      let n = 0;
      for (const c of cards) {
        const visible = on.has(c.group) && (q === '' || c.text.includes(q));
        c.node.hidden = !visible;
        if (visible) n++;
      }
      shown.textContent = n === cards.length ? `${n} scenarios` : `${n} of ${cards.length} shown`;
      empty.hidden = n > 0;
    };
    filter.addEventListener('input', render);

    list.append(...cards.map((c) => c.node));
    root.append(controls, list, empty);
    if (hasLibrary) {
      root.append(el('p', 'startup-credit',
        'Community scenarios come from Spiderweb Software’s scenario archive. Each belongs to its author; '
        + 'every card links to its listing there.'));
    }
    render();

    if (importScenarios !== undefined) {
      const add = el('button', 'startup-choice startup-add');
      add.append(el('strong', undefined, 'Add a scenario…'));
      add.append(el('small', undefined,
        'A .zip from the scenario archive, an .exs (and its .bmp), or an Open Blades of Exile .boes — '
        + 'or drop the files anywhere here.'));
      const problem = el('p', 'startup-problem');
      problem.hidden = true;

      const addFiles = (files: { name: string; data: Uint8Array }[]): void => {
        if (files.length === 0) return;
        problem.hidden = true;
        root.classList.add('busy');
        importScenarios(files).then((scens) => {
          let last: HTMLElement | null = null;
          for (const scen of scens) {
            // Installing an id that's already listed replaces it.
            const at = cards.findIndex((c) => c.id === scen.id && c.group === 'added');
            if (at >= 0) cards.splice(at, 1);
            const card = scenarioCard(scen, 'added', 1000 + cards.length);
            cards.push(card);
            last = card.node;
          }
          cards.sort((a, b) => a.rank - b.rank);
          list.replaceChildren(...cards.map((c) => c.node));
          render();
          last?.scrollIntoView({ block: 'nearest' });
          last?.focus();
        }).catch((err: unknown) => {
          problem.textContent = `That couldn't be added: ${err instanceof Error ? err.message : String(err)}`;
          problem.hidden = false;
        }).finally(() => { root.classList.remove('busy'); });
      };

      add.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.zip,.exs,.bmp,.boes';
        input.addEventListener('change', () => {
          if (input.files) void readFiles(input.files).then(addFiles);
        });
        input.click();
      });

      // Drop anywhere on the page while the screen is up.
      let depth = 0;
      const onEnter = (e: DragEvent): void => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        depth++;
        root.classList.add('dropping');
      };
      const onLeave = (): void => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) root.classList.remove('dropping');
      };
      const onOver = (e: DragEvent): void => { e.preventDefault(); };
      const onDrop = (e: DragEvent): void => {
        e.preventDefault();
        depth = 0;
        root.classList.remove('dropping');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) void readFiles(files).then(addFiles);
      };
      window.addEventListener('dragenter', onEnter);
      window.addEventListener('dragleave', onLeave);
      window.addEventListener('dragover', onOver);
      window.addEventListener('drop', onDrop);
      cleanups.push(() => {
        window.removeEventListener('dragenter', onEnter);
        window.removeEventListener('dragleave', onLeave);
        window.removeEventListener('dragover', onOver);
        window.removeEventListener('drop', onDrop);
      });
      root.append(add, problem);
    }

    host.append(root);
    // So Enter or a stray keypress doesn't fall through to nothing, and the
    // screen is reachable by keyboard alone.
    (list.querySelector('button:not([hidden])') as HTMLElement | null)?.focus();
  });
}
