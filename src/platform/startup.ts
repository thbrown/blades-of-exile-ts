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
  /** The scenario's title, or who is in a party-only save. */
  label: string;
  /** When, and where in the game — "Day 3 · 12 May, 14:02". */
  detail: string;
  /** A picture of the terrain view at the time, when the save has one. */
  thumb?: string;
  /** The scenario's icon, for a save with no picture. */
  icon?: number;
}

export interface StartupChoice {
  /** '' for a choice about the party alone. */
  scenarioId: string;
  /**
   * Set when the player picked a saved game rather than a fresh start. With
   * an empty `scenarioId` it is a party-only save, which becomes the party in
   * memory (`finish_load_party` returning to the startup screen).
   */
  slot?: string;
  /**
   * `make`: Make New Party, with no scenario — the party becomes the one in
   * memory. `enter`: take the party in memory into `scenarioId`
   * (`put_party_in_scen`). Absent: a scenario started the old way, making a
   * party on the way in.
   */
  party?: 'make' | 'enter';
}

export interface StartupPc {
  name: string;
  level: number;
  race: number;
  alive: boolean;
  health: number;
  maxHealth: number;
  sp: number;
  maxSp: number;
  /** The PC's graphic at 28×36, when there is one to show. */
  picture?: HTMLCanvasElement;
}

/** The player races (`eRace` 0-3); a PC of any other shows none. */
const RACE_NAMES: Record<number, string> = { 0: 'Human', 1: 'Nephilim', 2: 'Slithzerikai', 3: 'Vahnatai' };

/**
 * The party in memory — the C++'s `party_in_memory` and `draw_startup`'s
 * party list. The startup screen takes it into whichever scenario is picked.
 */
export interface StartupParty {
  /** null when there is no party in memory. */
  pcs: StartupPc[] | null;
  /** Forget it, as `do_abort` does. */
  forget: () => Promise<void>;
  /** The scenario it was last taken into and hasn't finished, if any. */
  active?: {
    title: string;
    /** The newest save in that scenario, to pick up from. */
    resume?: { scenarioId: string; slot: string; label: string };
  };
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
  /** Absent when there's nowhere to keep one (no IndexedDB). */
  party?: StartupParty;
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

/**
 * The page's masthead: the game's icon, then the title in the game's own
 * Dungeon face (the logo on the original's startup screen is the same letters)
 * over two lines on what this is.
 */
function header(): HTMLElement {
  const head = el('header', 'startup-header');
  const icon = document.createElement('img');
  icon.className = 'startup-logo';
  icon.src = `${import.meta.env.BASE_URL}data/graphics/icon.png`;
  icon.alt = '';
  const words = el('div', 'startup-masthead');
  words.append(el('h1', 'startup-title', 'Blades of Exile'));
  const what = el('p');
  what.append('A fantasy role-playing game by Jeff Vogel of Spiderweb Software, 1997. ',
    link(WIKIPEDIA_URL, 'Wikipedia'));
  const port = el('p');
  port.append('This is a JavaScript port for the browser, written largely by AI (Claude). ',
    link(REPO_URL, 'Source on GitHub'));
  words.append(what, port);
  head.append(icon, words);
  return head;
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
  const { official, added, saves, importScenarios, library, party } = opts;
  return new Promise((resolve) => {
    // The masthead sits above the card, not in it.
    const page = el('div', 'startup-page');
    // The party has a card of its own, between the masthead and the rest.
    const partyCard = el('div', 'startup startup-party-card');
    const root = el('div', 'startup');
    page.append(header(), root);

    const cleanups: (() => void)[] = [];
    const choose = (choice: StartupChoice): void => {
      for (const c of cleanups) c();
      page.remove();
      resolve(choice);
    };

    // ---- the party in memory
    let partyPcs = party?.pcs ?? null;
    /** A scenario card's choice: the party in memory goes in, if there is one. */
    const start = (scenarioId: string): StartupChoice =>
      (partyPcs !== null ? { scenarioId, party: 'enter' } : { scenarioId });
    if (party !== undefined) {
      partyCard.append(el('h2', undefined, 'Your party'));
      const panel = el('div', 'startup-party');
      partyCard.append(panel);
      root.before(partyCard);
      const showParty = (): void => {
        panel.replaceChildren();
        const make = el('button', 'startup-party-button', 'Make New Party');
        make.addEventListener('click', () => { choose({ scenarioId: '', party: 'make' }); });
        if (partyPcs === null) {
          panel.append(el('p', 'startup-sub',
            'No party in memory. Make one here, or pick a scenario and make one on the way in.'));
          panel.append(make);
          return;
        }
        const list = el('ul', 'startup-party-pcs');
        for (const pc of partyPcs) {
          const item = el('li', pc.alive ? undefined : 'gone');
          const frame = el('span', 'startup-pc-picture');
          if (pc.picture !== undefined) frame.append(pc.picture);
          item.append(frame);
          const words = el('span', 'startup-pc-words');
          words.append(el('strong', undefined, pc.name));
          const race = RACE_NAMES[pc.race];
          words.append(el('small', undefined,
            `Level ${pc.level}${race === undefined ? '' : ` ${race}`}${pc.alive ? '' : ' · dead'}`));
          const stats = el('span', 'startup-pc-stats');
          stats.append(el('span', 'hp', `HP ${pc.health}/${pc.maxHealth}`));
          if (pc.maxSp > 0) stats.append(el('span', 'sp', `SP ${pc.sp}/${pc.maxSp}`));
          words.append(stats);
          item.append(words);
          list.append(item);
        }
        panel.append(list);
        const active = party.active;
        if (active !== undefined) {
          const where = el('p', 'startup-party-active');
          where.append('Now adventuring in ', el('strong', undefined, active.title), '.');
          panel.append(where);
        }
        panel.append(el('p', 'startup-sub',
          'Pick any scenario below to take this party into it. It keeps its gold, items, '
          + 'levels and skills; special items stay behind.'));
        if (active?.resume !== undefined) {
          const { scenarioId, slot, label } = active.resume;
          const resume = el('button', 'startup-party-button primary', `Continue ${active.title}`);
          resume.title = label;
          resume.addEventListener('click', () => { choose({ scenarioId, slot }); });
          panel.append(resume);
        }
        const forget = el('button', 'startup-party-button', 'Forget Party');
        forget.addEventListener('click', () => {
          void party.forget().then(() => {
            partyPcs = null;
            showParty();
          });
        });
        panel.append(make, forget);
      };
      showParty();
    }

    if (saves.length > 0) {
      root.append(el('h2', undefined, 'Continue a saved game'));
      const list = el('div', 'startup-list startup-cards startup-saves');
      for (const save of saves) {
        const card = el('button', 'startup-choice startup-card');
        card.dataset['slot'] = save.slot;
        card.append(pictureElement(save.icon, save.thumb));
        const words = el('span', 'startup-words');
        words.append(el('strong', undefined, save.slot));
        words.append(el('span', 'startup-facts', save.label));
        words.append(el('small', undefined, save.detail));
        card.append(words);
        // A save names its own scenario, so picking one here is also how a
        // party in a scenario other than the default gets opened at all.
        card.addEventListener('click', () => {
          choose({ scenarioId: save.scenarioId, slot: save.slot });
        });
        list.append(card);
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
      card.addEventListener('click', () => { choose(start(scen.id)); });
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
        if (lib.installed.has(entry.id)) { choose(start(entry.id)); return; }
        if (card.classList.contains('busy')) return;
        card.classList.add('busy');
        state.textContent = `Downloading ${Math.max(1, Math.round(entry.fileBytes / 1024))} KB…`;
        lib.install(entry).then(() => { choose(start(entry.id)); }).catch((err: unknown) => {
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

    host.append(page);
    // So Enter or a stray keypress doesn't fall through to nothing, and the
    // screen is reachable by keyboard alone.
    // Focused for the keyboard, but without scrolling to it: the masthead and
    // the party come first on the page and should be what it opens on.
    (list.querySelector('button:not([hidden])') as HTMLElement | null)?.focus({ preventScroll: true });
  });
}
