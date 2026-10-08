/**
 * What the Exile III reference pages (`exile3/items.html`, `spells.html`, `map.html`) share: the
 * main menu's look — the game's granite behind, its marble as paper, the
 * Dungeon-face masthead — and a loader that gets Exile III the way the game
 * does.
 *
 * The published site may not carry a converted Exile III (its licence allows
 * only unaltered copies: vendor/exile3/README.md), so these pages hold no
 * data of their own. The dev server serves the converted copy; anywhere else
 * the browser converts Spiderweb's installer once and keeps it
 * (`platform/exile3.ts`), which the game then reuses too.
 */

import { Scenario } from '../data/scenario';
import { loadStringTables } from '../data/strings';
import { loadOpcodes, loadScenario } from '../fileio/loadScenario';
import { loadScenarioPackage } from '../fileio/scenarioPackage';
import { FetchSource } from '../fileio/source';
import { EXILE3_ID, exile3Served, prepareExile3 } from '../platform/exile3';
import { installCustomSheets, loadCustomSheets } from '../render/customPics';
import { SheetStore } from '../render/sheets';
import { BG_RECTS, PANEL_BG } from '../render/tiling';

const BASE = import.meta.env.BASE_URL;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The main menu's granite and marble (`installBackdrop` in
 * platform/startup.ts): CSS can't tile part of an image, so each is cut out
 * of pixpats.png into a data URL. Until then the page keeps its plain grounds.
 */
export function installBackdrop(): void {
  const img = new Image();
  img.addEventListener('load', () => {
    const cut = (name: string, r: { top: number; left: number; bottom: number; right: number }): void => {
      const c = document.createElement('canvas');
      c.width = r.right - r.left;
      c.height = r.bottom - r.top;
      c.getContext('2d')!.drawImage(img, r.left, r.top, c.width, c.height, 0, 0, c.width, c.height);
      document.body.style.setProperty(name, `url(${c.toDataURL()})`);
    };
    cut('--menu-tile', { top: 0, left: 0, bottom: 64, right: 64 });
    cut('--paper-tile', BG_RECTS[PANEL_BG]!);
  }, { once: true });
  img.src = `${BASE}data/graphics/pixpats.png`;
}

/** The pages, for the masthead's links. */
const PAGES: { href: string; label: string; id: string }[] = [
  { href: `${BASE}`, label: 'Play', id: 'play' },
  { href: `${BASE}exile3/items.html`, label: 'Exile III items', id: 'items' },
  { href: `${BASE}exile3/spells.html`, label: 'Exile III spells', id: 'spells' },
  { href: `${BASE}exile3/map.html`, label: 'Map of Valorim', id: 'map' },
];

/** The main menu's masthead: Exile III's icon and a title in the Dungeon face. */
export function masthead(title: string, lines: (string | Node)[], current: string): HTMLElement {
  const head = el('header', 'page-header');
  const icon = el('img', 'page-logo');
  icon.src = `${BASE}exile3-icon.png`;
  icon.alt = '';
  const words = el('div', 'page-masthead');
  words.append(el('h1', 'page-title', title));
  for (const l of lines) {
    const p = el('p');
    p.append(l);
    words.append(p);
  }
  const nav = el('nav', 'page-nav');
  for (const p of PAGES) {
    const a = el('a', p.id === current ? 'current' : undefined, p.label);
    a.href = p.href;
    if (p.id === current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  words.append(nav);
  head.append(icon, words);
  return head;
}

export interface Exile3 {
  scen: Scenario;
  /** The game's sheets named in `sheets`, and the scenario's own. */
  store: SheetStore;
}

/**
 * Exile III, parsed, with its graphics. `status` hears what is happening,
 * and how far along (0..1) when that is known.
 */
export async function loadExile3(
  sheets: string[], status: (what: string, done?: number) => void,
): Promise<Exile3> {
  const fetchText = async (url: string): Promise<string> => {
    const res = await fetch(BASE + url.replace(/^\//, ''));
    if (!res.ok) throw new Error(`could not fetch ${url} (${res.status})`);
    return res.text();
  };
  const store = new SheetStore();
  const sheetsReady = Promise.all(sheets.map((s) => store.load(s)));
  const [opcodes] = await Promise.all([loadOpcodes(fetchText), loadStringTables(fetchText)]);

  let scen: Scenario;
  if (await exile3Served()) {
    status('Loading Exile III…');
    const url = `${BASE}scenarios/${EXILE3_ID}/`;
    let done = 0;
    let total = 1;
    scen = await loadScenario(new FetchSource(url, () => status('Loading Exile III…', ++done / total)), opcodes,
      (n) => { total = n; });
    await loadCustomSheets(store, scen, new FetchSource(url));
  } else {
    const pkg = await prepareExile3(status);
    status('Loading Exile III…');
    const loaded = await loadScenarioPackage(pkg, opcodes);
    scen = loaded.scenario;
    await installCustomSheets(store, loaded.sheets);
  }
  await sheetsReady;
  return { scen, store };
}

/**
 * Text as search compares it (the main menu's rule): lower case, letters and
 * digits only, one space between words.
 */
export function searchable(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w !== '').join(' ');
}
