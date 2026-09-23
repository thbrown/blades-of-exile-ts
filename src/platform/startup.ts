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
 * Each scenario is a card with a picture: where a new game starts, once one
 * has been played (or shipped with the scenario), else the scenario's own icon
 * from `scenpics`. Scenarios can be added with the button or by dropping files
 * anywhere on the screen — a `.boes`, an `.exs` and its `.bmp`, or a zip.
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
 * The online scenario library (`catalog.json` in the bucket). A card installs
 * its scenario on first click and then starts it.
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

/** The icons in `scenpics` — 5 columns, 7 rows. */
const SCEN_ICONS = 35;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The icon, cut out of `scenpics` with CSS and doubled like the game canvas. */
function iconElement(icon: number): HTMLElement {
  const node = el('span', 'startup-icon');
  const n = icon >= 0 && icon < SCEN_ICONS ? icon : 0;
  node.style.backgroundImage = `url(${import.meta.env.BASE_URL}data/graphics/scenpics.png)`;
  node.style.backgroundPosition = `${-64 * (n % 5)}px ${-64 * Math.floor(n / 5)}px`;
  return node;
}

function pictureElement(scen: StartupScenario): HTMLElement {
  const frame = el('span', 'startup-picture');
  const fallback = (): void => {
    frame.replaceChildren(iconElement(scen.icon ?? 0));
    frame.classList.add('icon-only');
  };
  if (scen.preview !== undefined) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = scen.preview;
    img.addEventListener('error', fallback, { once: true });
    frame.append(img);
    // The icon rides in the corner of the picture, as the scenario's own mark.
    if (scen.icon !== undefined && scen.icon < SCEN_ICONS) frame.append(iconElement(scen.icon));
  } else fallback();
  return frame;
}

async function readFiles(list: FileList | File[]): Promise<{ name: string; data: Uint8Array }[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

/**
 * Put the screen up and resolve once something is chosen. The overlay removes
 * itself first, so the caller can get on with loading against a clean page.
 */
export function showStartupScreen(
  host: HTMLElement,
  scenarios: readonly StartupScenario[],
  saves: readonly StartupSave[],
  /** Absent when there's nowhere to keep a scenario (no IndexedDB). */
  importScenarios?: ImportScenarios,
  library?: StartupLibrary,
): Promise<StartupChoice> {
  return new Promise((resolve) => {
    const root = el('div', 'startup');
    root.append(el('h1', undefined, 'Blades of Exile'));

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

    root.append(el('h2', undefined, 'Start a new game'));
    const list = el('div', 'startup-list startup-cards');
    const scenarioButton = (scen: StartupScenario): HTMLElement => {
      const button = el('button', 'startup-choice startup-card');
      button.dataset['id'] = scen.id;
      button.append(pictureElement(scen));
      const words = el('span', 'startup-words');
      words.append(el('strong', undefined, scen.title));
      if (scen.blurb !== '') words.append(el('small', undefined, scen.blurb));
      button.append(words);
      button.addEventListener('click', () => { choose({ scenarioId: scen.id }); });
      return button;
    };
    for (const scen of scenarios) list.append(scenarioButton(scen));
    root.append(list);

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
        importScenarios(files).then((added) => {
          let last: HTMLElement | null = null;
          for (const scen of added) {
            // Installing an id that's already listed replaces it.
            list.querySelector(`[data-id="${CSS.escape(scen.id)}"]`)?.remove();
            last = scenarioButton(scen);
            list.append(last);
          }
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

    if (library !== undefined && library.entries.length > 0) {
      root.append(librarySection(library, (id) => { choose({ scenarioId: id }); }));
    }

    host.append(root);
    // So Enter or a stray keypress doesn't fall through to nothing, and the
    // screen is reachable by keyboard alone.
    (root.querySelector('button') as HTMLElement | null)?.focus();
  });
}

const TABLE_LABELS: Record<LibraryEntry['table'], string> = {
  solid: 'Solid adventures',
  first_efforts: 'First efforts',
  untried: 'Untried',
};

/**
 * The library: a filter box, Spiderweb's three lists as toggles, and a card
 * per scenario. Reviewed-best first, as the archive's own lists read.
 */
function librarySection(library: StartupLibrary, start: (id: string) => void): HTMLElement {
  const section = el('section', 'startup-library');
  const head = el('div', 'startup-library-head');
  head.append(el('h2', undefined, `Scenario library (${library.entries.length})`));
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Search titles and descriptions';
  filter.className = 'startup-filter';
  head.append(filter);
  const tables = new Set<LibraryEntry['table']>(['solid', 'first_efforts', 'untried']);
  const chips = el('div', 'startup-chips');
  for (const [table, label] of Object.entries(TABLE_LABELS) as [LibraryEntry['table'], string][]) {
    const chip = el('button', 'startup-chip on', label);
    chip.addEventListener('click', () => {
      if (tables.has(table)) tables.delete(table); else tables.add(table);
      chip.classList.toggle('on', tables.has(table));
      render();
    });
    chips.append(chip);
  }
  head.append(chips);
  section.append(head);
  section.append(el('p', 'startup-credit',
    'Community scenarios from Spiderweb Software\u2019s archive. Each belongs to its author; '
    + 'the card links to its listing.'));

  const list = el('div', 'startup-list startup-cards');
  section.append(list);
  const sorted = [...library.entries].sort((a, b) => (b.review ?? 0) - (a.review ?? 0) || a.title.localeCompare(b.title));
  const cards = new Map<string, HTMLElement>();
  for (const entry of sorted) {
    const card = el('button', 'startup-choice startup-card');
    card.dataset['library'] = entry.id;
    card.append(pictureElement({
      id: entry.id, title: entry.title, blurb: entry.blurb, icon: entry.icon,
      ...(entry.preview ? { preview: library.url(entry.preview) } : {}),
    }));
    const words = el('span', 'startup-words');
    words.append(el('strong', undefined, entry.title));
    const facts = [entry.category, entry.difficulty, entry.contentRating,
      entry.review !== null ? `\u2605 ${entry.review.toFixed(1)}` : 'unreviewed'].filter((f) => f !== '');
    words.append(el('span', 'startup-facts', facts.join(' \u00b7 ')));
    words.append(el('small', undefined, entry.description || entry.blurb));
    const state = el('span', 'startup-state', library.installed.has(entry.id) ? 'Installed' : '');
    words.append(state);
    const credit = document.createElement('a');
    credit.href = entry.source;
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = `Listed as \u201c${entry.listedAs}\u201d`;
    credit.className = 'startup-source';
    credit.addEventListener('click', (e) => { e.stopPropagation(); });
    words.append(credit);
    card.append(words);
    card.addEventListener('click', () => {
      if (library.installed.has(entry.id)) { start(entry.id); return; }
      if (card.classList.contains('busy')) return;
      card.classList.add('busy');
      state.textContent = `Downloading ${Math.max(1, Math.round(entry.fileBytes / 1024))} KB\u2026`;
      library.install(entry).then(() => { start(entry.id); }).catch((err: unknown) => {
        card.classList.remove('busy');
        state.textContent = `Couldn\u2019t install: ${err instanceof Error ? err.message : String(err)}`;
      });
    });
    cards.set(entry.id, card);
    list.append(card);
  }

  const render = (): void => {
    const q = filter.value.trim().toLowerCase();
    for (const entry of sorted) {
      const text = `${entry.title} ${entry.listedAs} ${entry.description} ${entry.blurb} ${entry.category}`.toLowerCase();
      cards.get(entry.id)!.hidden = !tables.has(entry.table) || (q !== '' && !text.includes(q));
    }
  };
  filter.addEventListener('input', render);
  return section;
}
