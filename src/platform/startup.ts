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
 * one. Scenarios the player installed earlier still list here; adding one from
 * files is gone until the scenario editor lands.
 *
 * Plain DOM and no canvas: this runs before the graphics sheets have loaded.
 * `?scenario=` skips it entirely, which is what a direct link and the headless
 * verifier use.
 */

import { LibraryEntry } from '../fileio/libraryCatalog';
import { UiRect } from '../render/layout';
import { BG_RECTS, PANEL_BG } from '../render/tiling';

export interface StartupScenario {
  id: string;
  title: string;
  /** The scenario's first teaser line, shown under its title. */
  blurb: string;
  /**
   * `intro_pic` — its icon in `scenpics`, 5 across, 32×32 each — or a
   * picture of its own, 32×32 (Exile III's is EXILE3.ICO).
   */
  icon?: number | string;
  /** A picture of where it starts; the card falls back to the icon if it won't load. */
  preview?: string;
}

/**
 * One game, as a card: a save *tree*, however many snapshots it holds
 * (`platform/saveStore.ts`). Resume continues from the newest; a click on the
 * card opens the tree; two icons rename and delete it.
 */
export interface StartupTree {
  id: string;
  scenarioId: string;
  /** What the player calls the game. */
  name: string;
  /** The scenario's title, or who is in a party-only save. */
  label: string;
  /** Where in the game — "Day 3 · Fort Talrus". */
  detail: string;
  /** When, and how much — "2 Oct 2026, 14:02 · 41 saves". */
  when: string;
  /** A picture of the terrain view at the newest save, when it has one. */
  thumb?: string;
  /** The scenario's icon, for a save with no picture. */
  icon?: number | string;
  /** The game being played: it can't be deleted from under itself. */
  current?: boolean;
}

/** What the saved-game cards can do beyond continuing. */
export interface StartupSaveActions {
  /**
   * Open the restore tree for a game. Resolves with the snapshot the player
   * chose to restore, or null if they closed it.
   */
  /** The restore tree: a save to go back to, null if closed, 'deleted' if the game was deleted there. */
  browse: (treeId: string) => Promise<number | null | 'deleted'>;
  rename: (treeId: string, name: string) => Promise<void>;
  remove: (treeId: string) => Promise<void>;
  /**
   * Import an `.exg`, a tree zip or an Exile III save — `file` when one was
   * dropped on the import card, else picked — giving the new tree's id (null:
   * cancelled, refused, or handled some other way).
   */
  importFile: (file?: File) => Promise<string | null>;
}

export interface StartupChoice {
  /** '' for a choice about the party alone. */
  scenarioId: string;
  /**
   * Set when the player picked a saved game rather than a fresh start; `seq`
   * is the snapshot, absent for the one played last (by the clock). With an empty `scenarioId` it is
   * a party-only save, which becomes the party in memory (`finish_load_party`
   * returning to the startup screen).
   */
  tree?: { id: string; seq?: number };
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

/** The saved-game cards' two tools, drawn in the text colour. */
const PENCIL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
  + '<path d="M11.5 1.5l3 3L5 14H2v-3z M10 3l3 3" fill="none" stroke="currentColor" stroke-width="1.5" '
  + 'stroke-linejoin="round"/></svg>';
/** A clock with its hand turned back: the game's older saves. */
const HISTORY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
  + '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9 M2 2v3h3 M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" '
  + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
  + '<path d="M2 4h12 M6 4V2h4v2 M3.5 4l1 10h7l1-10 M6.5 7v4.5 M9.5 7v4.5" fill="none" stroke="currentColor" '
  + 'stroke-width="1.5" stroke-linejoin="round"/></svg>';

/** The player races (`eRace` 0-3); a PC of any other shows none. */
/** Short, to fit a party card: "Slith" is what players call them anyway. */
const RACE_NAMES: Record<number, string> = { 0: 'Human', 1: 'Nephilim', 2: 'Slith', 3: 'Vahnatai' };

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
    resume?: { scenarioId: string; treeId: string; label: string };
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

export interface StartupOptions {
  /** Spiderweb's own scenarios, shipped with the game. */
  official: readonly StartupScenario[];
  /** Scenarios the player installed; any that are library entries show as those instead. */
  added: readonly StartupScenario[];
  tree: readonly StartupTree[];
  /** Absent when there's nowhere to keep saves (no IndexedDB). */
  saveActions?: StartupSaveActions;
  library?: StartupLibrary;
  /** Absent when there's nowhere to keep one (no IndexedDB). */
  party?: StartupParty;
}

const REPO_URL = 'https://github.com/thbrown/blades-of-exile-ts';
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
  ['archive', 'More from the archives'],
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
function iconElement(icon: number | string): HTMLElement {
  const node = el('span', 'startup-icon');
  if (typeof icon === 'string') {
    node.style.backgroundImage = `url(${icon})`;
    node.style.backgroundSize = '64px 64px';
    return node;
  }
  const n = icon >= 0 && icon < SCEN_ICONS ? icon : 0;
  node.style.backgroundImage = `url(${import.meta.env.BASE_URL}data/graphics/scenpics.png)`;
  node.style.backgroundPosition = `${-64 * (n % 5)}px ${-64 * Math.floor(n / 5)}px`;
  return node;
}

function pictureElement(icon: number | string | undefined, preview: string | undefined): HTMLElement {
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
    if (icon !== undefined && (typeof icon === 'string' || icon < SCEN_ICONS)) frame.append(iconElement(icon));
  } else fallback();
  return frame;
}

/** What a saved game's card does when picked. */
export interface SavedGameCardHost {
  /** Carry on from `game`: its newest save, or snapshot `seq` picked in its tree. */
  open: (game: StartupTree, seq?: number) => void;
  /** A file was imported as a new tree. */
  imported: (treeId: string) => void;
}

/**
 * The saved games as cards, one a game, and the import card last: the main
 * menu's "Continue a saved game", and File › Load Game's (`showLoadGame`).
 * A click on a card carries on from its newest save (by the clock, not by
 * game time — after going back to an old save, that is the last one played),
 * and the clock icon opens its tree, to pick an earlier point. The import card
 * takes a click, or a file dropped on it.
 */
export function savedGameCards(
  trees: readonly StartupTree[], actions: StartupSaveActions | undefined, host: SavedGameCardHost,
): HTMLElement {
  const list = el('div', 'startup-list startup-cards startup-saves');
  for (const game of trees) {
    // Not a <button>: it holds buttons of its own.
    const card = el('div', 'startup-choice startup-card startup-save');
    card.dataset['tree'] = game.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const picture = pictureElement(game.icon, game.thumb);
    if (game.current === true) picture.append(el('span', 'startup-badge current', 'Playing now'));
    card.append(picture);
    const words = el('span', 'startup-words');
    const title = el('strong', undefined, game.name);
    words.append(title);
    words.append(el('span', 'startup-facts', game.label));
    words.append(el('small', 'startup-save-line', game.detail));
    words.append(el('small', 'startup-save-line', game.when));
    card.append(words);
    // A save names its own scenario, so picking one here is also how a
    // party in a scenario other than the default gets opened at all.
    const resume = (): void => { host.open(game); };
    card.title = 'Carry on from the newest save';
    card.addEventListener('click', resume);
    card.addEventListener('keydown', (e) => {
      if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      resume();
    });
    if (actions !== undefined) {
      const tools = el('span', 'startup-save-tools');
      const iconButton = (icon: string, tip: string, action: string, run: () => void): void => {
        const b = el('button', 'startup-icon-button') as HTMLButtonElement;
        b.innerHTML = icon;
        b.title = tip;
        b.setAttribute('aria-label', tip);
        b.dataset['action'] = action;
        b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
        tools.append(b);
      };
      iconButton(HISTORY_ICON, 'Older saves: pick a point in this game to go back to', 'history', () => {
        void actions.browse(game.id).then((seq) => {
          if (seq === 'deleted') card.remove();
          else if (seq !== null) host.open(game, seq);
        });
      });
      iconButton(PENCIL_ICON, 'Rename this game', 'rename', () => {
        const next = window.prompt('Name this game:', title.textContent ?? game.name)?.trim();
        if (next === undefined || next === '' || next === title.textContent) return;
        void actions.rename(game.id, next).then(() => { title.textContent = next; });
      });
      if (game.current !== true) {
        iconButton(TRASH_ICON, 'Delete this game and all its saves', 'delete', () => {
          if (!window.confirm(`Delete "${title.textContent ?? game.name}" and all its saves? This cannot be undone.`)) return;
          void actions.remove(game.id).then(() => { card.remove(); });
        });
      }
      picture.append(tools);
    }
    list.append(card);
  }
  // Importing is a card of its own, always the last in the grid: the same
  // size as a game's, with an empty picture where a game has its own.
  if (actions !== undefined) {
    const add = el('button', 'startup-choice startup-card startup-save-import');
    add.dataset['action'] = 'import';
    add.title = 'An .exg file, a zip of saves, or an Exile III save — it becomes a new game here. Click to pick one, or drop it here.';
    const frame = el('span', 'startup-picture startup-import-picture');
    frame.append(el('span', 'startup-import-plus', '+'));
    add.append(frame);
    const words = el('span', 'startup-words');
    words.append(el('strong', undefined, 'Import a saved game…'));
    words.append(el('small', undefined, 'An .exg file, a zip of saves, or an Exile III save. Click, or drop one here.'));
    add.append(words);
    const run = (file?: File): void => {
      void actions.importFile(file).then((id) => { if (id !== null) host.imported(id); });
    };
    add.addEventListener('click', () => { run(); });
    // A drop target: the card lights up while a file is held over it. The
    // counter is because dragenter and dragleave fire for every child too.
    let over = 0;
    const holdsFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;
    add.addEventListener('dragenter', (e) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      over++;
      add.classList.add('drop-here');
    });
    add.addEventListener('dragover', (e) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    add.addEventListener('dragleave', () => {
      over = Math.max(0, over - 1);
      if (over === 0) add.classList.remove('drop-here');
    });
    add.addEventListener('drop', (e) => {
      e.preventDefault();
      over = 0;
      add.classList.remove('drop-here');
      const file = e.dataTransfer?.files[0];
      if (file !== undefined) run(file);
    });
    list.append(add);
  }
  return list;
}

/** What File › Load Game picked. */
export type LoadGameChoice =
  | { kind: 'open'; game: StartupTree; seq?: number }
  | { kind: 'imported'; treeId: string }
  | { kind: 'cancel' };

/**
 * File › Load Game: the main menu's saved-game cards over the game, with
 * Cancel. Resolves once a card is picked, a file is imported, or it is
 * closed (Cancel, Escape, or a click outside it).
 */
export function showLoadGame(trees: readonly StartupTree[], actions: StartupSaveActions | undefined): Promise<LoadGameChoice> {
  installBackdrop();
  return new Promise((resolve) => {
    const back = el('div', 'loadgame-back');
    const box = el('div', 'startup loadgame');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Load a saved game');
    back.append(box);
    const done = (choice: LoadGameChoice): void => {
      back.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(choice);
    };
    const onKey = (e: KeyboardEvent): void => {
      // A game's tree opened from here (the clock icon) has keys of its own.
      if (document.querySelector('.stree-back') !== null) return;
      // The game's own keys wait while this is up.
      e.stopPropagation();
      if (e.key === 'Escape') done({ kind: 'cancel' });
    };
    window.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back) done({ kind: 'cancel' }); });
    box.append(el('h2', undefined, trees.length > 0 ? 'Load a saved game' : 'No saved games in this browser'));
    box.append(savedGameCards(trees, actions, {
      open: (game, seq) => { done({ kind: 'open', game, ...(seq !== undefined ? { seq } : {}) }); },
      imported: (treeId) => { done({ kind: 'imported', treeId }); },
    }));
    const foot = el('div', 'loadgame-foot');
    const cancel = el('button', 'startup-party-button', 'Cancel');
    cancel.addEventListener('click', () => { done({ kind: 'cancel' }); });
    foot.append(cancel);
    box.append(foot);
    document.body.append(back);
    cancel.focus();
  });
}

/**
 * The main menu's two grounds, both tiles of `pixpats.png`: the granite of the
 * game's own window frame (the tile at the top left) behind the page, and the
 * white marble the game's text and party panels are drawn on (`PANEL_BG`,
 * render/tiling.ts) as the paper of every card. CSS can't tile part of an
 * image, so each is cut out once into a data URL. Until they load (or if they
 * can't) the page keeps its plain grounds.
 */
function installBackdrop(): void {
  const img = new Image();
  img.addEventListener('load', () => {
    const cut = (name: string, rect: UiRect): void => {
      const w = rect.right - rect.left;
      const h = rect.bottom - rect.top;
      const tile = document.createElement('canvas');
      tile.width = w;
      tile.height = h;
      tile.getContext('2d')!.drawImage(img, rect.left, rect.top, w, h, 0, 0, w, h);
      document.body.style.setProperty(name, `url(${tile.toDataURL()})`);
    };
    cut('--menu-tile', { top: 0, left: 0, bottom: 64, right: 64 });
    cut('--paper-tile', BG_RECTS[PANEL_BG]!);
  }, { once: true });
  img.src = `${import.meta.env.BASE_URL}data/graphics/pixpats.png`;
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
  port.append('This is a JavaScript port for the browser. ',
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
  const { official, added, tree, saveActions, library, party } = opts;
  return new Promise((resolve) => {
    // The masthead sits above the card, not in it.
    installBackdrop();
    const page = el('div', 'startup-page');
    // The party has a card of its own, between the masthead and the rest.
    const partyCard = el('div', 'startup startup-party-card');
    const root = el('div', 'startup');
    page.append(header(), root);

    const choose = (choice: StartupChoice): void => {
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
        const active = party.active;
        if (active !== undefined) {
          const where = el('p', 'startup-party-active');
          where.append('Now adventuring in ', el('strong', undefined, active.title), '.');
          panel.append(where);
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
        if (active?.resume !== undefined) {
          const { scenarioId, treeId, label } = active.resume;
          const resume = el('button', 'startup-party-button primary', `Continue ${active.title}`);
          resume.title = label;
          resume.addEventListener('click', () => { choose({ scenarioId, tree: { id: treeId } }); });
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

    // Saved games have a card of their own too, so continuing and starting
    // fresh read as two different choices (`savedGameCards`).
    if (tree.length > 0 || saveActions !== undefined) {
      const savesCard = el('div', 'startup startup-saves-card');
      savesCard.append(el('h2', undefined, 'Continue a saved game'));
      const list = savedGameCards(tree, saveActions, {
        open: (game, seq) => { choose({ scenarioId: game.scenarioId, tree: { id: game.id, ...(seq !== undefined ? { seq } : {}) } }); },
        imported: () => { window.location.reload(); },
      });
      savesCard.append(list);
      root.before(savesCard);
    }

    // ---- the one list
    const hasLibrary = library !== undefined && library.entries.length > 0;
    root.append(el('h2', undefined, 'Start a new game'));

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
      if (entry.review !== null) bits.push([`★ ${entry.review.toFixed(1)}`, 'Average player review on the archive, out of 5']);
      const forum = entry.forum;
      if (forum?.score != null) {
        bits.push([`Forum ★ ${forum.score.toFixed(1)}`,
          `Mean of ${forum.votes} vote${forum.votes === 1 ? '' : 's'} on the forum’s review board, out of 5`]);
      }
      if (entry.review === null && forum?.score == null) bits.push(['Not yet reviewed']);
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
      if (forum !== undefined) words.append(link(forum.url, 'Reviews on the forum', 'startup-source'));
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

    /** Best reviewed first: the archive's own review, else the forum's votes. */
    const score = (e: LibraryEntry): number => e.review ?? e.forum?.score ?? 0;
    official.forEach((s, i) => cards.push(scenarioCard(s, 'official', i)));
    const libraryIds = new Set(library?.entries.map((e) => e.id) ?? []);
    added.filter((s) => !libraryIds.has(s.id)).forEach((s, i) => cards.push(scenarioCard(s, 'added', 1000 + i)));
    [...(library?.entries ?? [])]
      .sort((a, b) => Number(a.corrupted !== undefined) - Number(b.corrupted !== undefined)
        || score(b) - score(a) || a.title.localeCompare(b.title))
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
        'Community scenarios come from Spiderweb Software’s scenario archive, Kelandon’s archive and '
        + 'TrueSite for Blades, and forum scores from the Spiderweb forums’ review board. Each scenario belongs '
        + 'to its author; every card links to its listing.'));
    }
    render();


    host.append(page);
    // So Enter or a stray keypress doesn't fall through to nothing, and the
    // screen is reachable by keyboard alone.
    // Focused for the keyboard, but without scrolling to it: the masthead and
    // the party come first on the page and should be what it opens on.
    (list.querySelector('button:not([hidden])') as HTMLElement | null)?.focus({ preventScroll: true });
  });
}
