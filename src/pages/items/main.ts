/**
 * Every Exile III item in one table: what the game's item sheet says
 * (`itemInfoFields`, the same function the "I" button's dialog runs) beside
 * what the code does with it (`readE3Item`), with a verdict where they part.
 * Sortable, filterable, and the filter lives in the URL so a view can be
 * shared.
 */

import '../pages.css';
import './items.css';
import { Item, ItemType } from '../../data/item';
import { ItemInfoFields, itemInfoFields } from '../../data/itemInfo';
import { itemGraphic } from '../../render/itemPics';
import { SheetStore } from '../../render/sheets';
import { el, installBackdrop, loadExile3, masthead, searchable } from '../common';
import { ItemReading, Verdict, combatLine, readE3Item, useWhere } from './e3ItemRules';

interface Row {
  idx: number;
  item: Item;
  pic: string | null;
  sheet: ItemInfoFields;
  reading: ItemReading;
  use: string | null;
  combat: string;
  group: string;
  /** The first earlier item with the same full name, when this is a variant. */
  variantOf: number | null;
  text: string;
}

const GROUPS: [string, ItemType[]][] = [
  ['Weapons', [ItemType.ONE_HANDED, ItemType.TWO_HANDED]],
  ['Bows & crossbows', [ItemType.BOW, ItemType.CROSSBOW, ItemType.MISSILE_NO_AMMO]],
  ['Ammunition & thrown', [ItemType.ARROW, ItemType.BOLTS, ItemType.THROWN_MISSILE]],
  ['Armour', [ItemType.SHIELD, ItemType.SHIELD_2, ItemType.ARMOR, ItemType.HELM, ItemType.GLOVES, ItemType.BOOTS]],
  ['Potions', [ItemType.POTION]],
  ['Scrolls', [ItemType.SCROLL]],
  ['Wands', [ItemType.WAND]],
  ['Rings & necklaces', [ItemType.RING, ItemType.NECKLACE]],
  ['Tools', [ItemType.TOOL]],
  ['Weapon poisons', [ItemType.WEAPON_POISON]],
];
const groupOf = (v: ItemType): string => GROUPS.find(([, vs]) => vs.includes(v))?.[0] ?? 'Other';

const VERDICTS: { id: Verdict; label: string }[] = [
  { id: 'differs', label: 'Differs' },
  { id: 'partly', label: 'Partly' },
  { id: 'unread', label: 'Unread' },
  { id: 'agrees', label: 'Agrees' },
  { id: 'none', label: 'No ability' },
];
const VERDICT_RANK: Record<Verdict, number> = { differs: 0, partly: 1, unread: 2, agrees: 3, none: 4 };

interface Column {
  id: string;
  label: string;
  /** A short header for narrow numeric columns. */
  title?: string;
  num?: boolean;
  key: (r: Row) => number | string;
}

const num = (n: number | undefined): number => n ?? -Infinity;
const COLUMNS: Column[] = [
  { id: 'idx', label: '#', title: 'Item number', num: true, key: (r) => r.idx },
  { id: 'name', label: 'Name', key: (r) => r.item.fullName.toLowerCase() },
  { id: 'type', label: 'Type', key: (r) => r.sheet.type.toLowerCase() },
  { id: 'lvl', label: 'Lvl', title: 'Item level', num: true, key: (r) => r.item.itemLevel },
  { id: 'dmg', label: 'Dmg/Def', title: 'The sheet’s Damage (weapons) or Defend (armour)', num: true,
    key: (r) => num(r.sheet.dmg ?? r.sheet.def) },
  { id: 'bonus', label: 'Bonus', num: true, key: (r) => num(r.sheet.bonus) },
  { id: 'enc', label: 'Enc', title: 'Encumbrance', num: true, key: (r) => num(r.sheet.enc) },
  { id: 'use', label: 'Uses', title: 'Charges', num: true, key: (r) => num(r.sheet.use) },
  { id: 'val', label: 'Value', num: true, key: (r) => r.sheet.val },
  { id: 'wt', label: 'Wt', title: 'Weight', num: true, key: (r) => r.sheet.weight },
  { id: 'sheet', label: 'In the game', title: 'What the item sheet says', key: (r) => r.sheet.abil.toLowerCase() },
  { id: 'code', label: 'By the code', title: 'What the code does', key: (r) => r.reading.effect.toLowerCase() },
  { id: 'verdict', label: 'Exile III vs BoE', title: 'Does the item sheet (BoE’s words) match what Exile III’s code does?',
    key: (r) => VERDICT_RANK[r.reading.verdict] },
];

// --- state, kept in the URL ------------------------------------------------

interface State {
  q: string;
  group: string;
  verdicts: Set<Verdict>;
  sort: string;
  desc: boolean;
}

function readState(): State {
  const p = new URLSearchParams(location.search);
  const v = p.get('v');
  return {
    q: p.get('q') ?? '',
    group: p.get('type') ?? '',
    verdicts: new Set((v ? v.split(',') : VERDICTS.map((x) => x.id)).filter(
      (x): x is Verdict => VERDICTS.some((y) => y.id === x))),
    sort: COLUMNS.some((c) => c.id === p.get('sort')) ? p.get('sort')! : 'idx',
    desc: p.get('dir') === 'desc',
  };
}

function writeState(s: State): void {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.group) p.set('type', s.group);
  if (s.verdicts.size !== VERDICTS.length) p.set('v', [...s.verdicts].join(','));
  if (s.sort !== 'idx') p.set('sort', s.sort);
  if (s.desc) p.set('dir', 'desc');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// --- pictures ---------------------------------------------------------------

function pictureMaker(store: SheetStore): (n: number) => string | null {
  const cache = new Map<number, string | null>();
  const canvas = document.createElement('canvas');
  canvas.width = 28;
  canvas.height = 36;
  const ctx = canvas.getContext('2d')!;
  return (n) => {
    if (cache.has(n)) return cache.get(n)!;
    const g = itemGraphic(n);
    const img = g && store.get(g.sheetName);
    let url: string | null = null;
    if (g && img) {
      ctx.clearRect(0, 0, 28, 36);
      const r = g.rect;
      ctx.drawImage(img, r.left, r.top, r.width, r.height, g.inset.x, g.inset.y, r.width, r.height);
      url = canvas.toDataURL();
    }
    cache.set(n, url);
    return url;
  };
}

// --- the page -------------------------------------------------------------

async function main(): Promise<void> {
  installBackdrop();
  const page = document.getElementById('page')!;
  const repo = el('a', undefined, 'the port’s rules');
  repo.href = 'https://github.com/thbrown/exile-js/blob/main/src/pages/items/e3ItemRules.ts';
  page.append(masthead('Exile III Items', [
    'Every item in Exile III: what the game’s item sheet tells you, beside what the code actually does with it.',
    (() => {
      const s = document.createElement('span');
      s.append('Where the two part, the verdict says so. Read from ', repo,
        ', which follow Exile III’s own code where it has been read.');
      return s;
    })(),
  ], 'items'));

  const card = el('section', 'card');
  page.append(card);
  const loading = el('div', 'loading');
  const what = el('span', undefined, 'Loading…');
  const bar = el('div', 'progress');
  const fill = el('div');
  bar.append(fill);
  loading.append(what, bar);
  card.append(loading);

  let e3;
  try {
    e3 = await loadExile3(['objects', 'tinyobj'], (w, done) => {
      what.textContent = done !== undefined && done > 0 && done < 1 ? `${w} ${Math.round(done * 100)}%` : w;
      if (done !== undefined) fill.style.width = `${Math.round(done * 100)}%`;
    });
  } catch (e) {
    what.textContent = `Exile III could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    what.className = 'problem';
    bar.remove();
    return;
  }
  loading.remove();

  const { scen, store } = e3;
  const picture = pictureMaker(store);
  const firstByName = new Map<string, number>();
  const rows: Row[] = [];
  scen.scenItems.forEach((item, idx) => {
    if (item.variety === ItemType.NO_ITEM) return;
    const sheet = itemInfoFields(item, scen);
    const reading = readE3Item(item, sheet.abil, scen);
    const first = firstByName.get(item.fullName);
    if (first === undefined) firstByName.set(item.fullName, idx);
    const use = useWhere(item.e3Ability);
    rows.push({
      idx, item, sheet, reading, use, pic: picture(item.graphicNum),
      combat: combatLine(item),
      group: groupOf(item.variety),
      variantOf: first ?? null,
      text: searchable([item.fullName, item.name, sheet.type, sheet.abil, reading.effect, reading.note,
        `#${idx}`, `code ${item.e3Ability}`].join(' ')),
    });
  });
  renderTable(card, rows);
}

function renderTable(card: HTMLElement, rows: Row[]): void {
  const state = readState();

  // Controls.
  const controls = el('div', 'controls');
  const filter = el('input', 'filter');
  filter.type = 'search';
  filter.placeholder = 'Search names, effects, notes…';
  filter.setAttribute('aria-label', 'Search items');
  filter.value = state.q;
  const group = el('select', 'select');
  group.setAttribute('aria-label', 'Item type');
  group.append(new Option('All types', ''));
  for (const [g] of [...GROUPS, ['Other', []] as [string, ItemType[]]]) group.append(new Option(g, g));
  group.value = state.group;
  const sortSel = el('select', 'select sort-select');
  sortSel.setAttribute('aria-label', 'Sort by');
  for (const c of COLUMNS) {
    sortSel.append(new Option(`Sort: ${c.label} ↑`, `${c.id}:asc`), new Option(`Sort: ${c.label} ↓`, `${c.id}:desc`));
  }
  const chips = el('div', 'chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Verdicts shown');
  const counts = new Map<Verdict, number>();
  for (const r of rows) counts.set(r.reading.verdict, (counts.get(r.reading.verdict) ?? 0) + 1);
  const chipEls = VERDICTS.map((v) => {
    const b = el('button', 'chip', `${v.label} (${counts.get(v.id) ?? 0})`);
    b.type = 'button';
    b.dataset['v'] = v.id;
    b.addEventListener('click', () => {
      if (state.verdicts.has(v.id)) state.verdicts.delete(v.id);
      else state.verdicts.add(v.id);
      update();
    });
    return b;
  });
  chips.append(...chipEls);
  const shown = el('span', 'shown');
  shown.setAttribute('aria-live', 'polite');
  controls.append(filter, group, sortSel, chips, shown);

  // Table.
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'items');
  const thead = el('thead');
  const hr = el('tr');
  const ths = COLUMNS.map((c) => {
    const th = el('th', c.num ? 'num' : undefined);
    th.dataset['col'] = c.id;
    const b = el('button', 'sort', c.label);
    b.type = 'button';
    if (c.title) b.title = c.title;
    b.addEventListener('click', () => {
      if (state.sort === c.id) state.desc = !state.desc;
      else {
        state.sort = c.id;
        state.desc = false;
      }
      update();
    });
    th.append(b);
    hr.append(th);
    return th;
  });
  thead.append(hr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  wrap.append(table);
  const empty = el('p', 'empty', 'No item matches.');
  const legend = el('p', 'legend');
  legend.append(
    el('strong', undefined, 'Reading it. '),
    '“In the game” is the item sheet, which names each item’s BoE ability. “By the code” is what Exile III’s ',
    'rules do. Damage ranges are before strength, blessing and the like. “Hit chance +N points” is how much ',
    'more likely each blow is to land than with the same item and no bonus: a swing that would land half the ',
    'time lands (50 + N)% of the time. (E3 rolls 1–100 and each bonus point takes 5 off the roll.) The small ',
    'grey name under an item is what it’s called until identified.',
  );
  card.append(controls, legend, wrap, empty);

  const trs = new Map<Row, HTMLTableRowElement>(rows.map((r) => [r, rowEl(r)]));

  function update(): void {
    state.q = filter.value;
    state.group = group.value;
    const words = searchable(state.q).split(' ').filter((w) => w);
    const col = COLUMNS.find((c) => c.id === state.sort) ?? COLUMNS[0]!;
    const shownRows = rows
      .filter((r) => state.verdicts.has(r.reading.verdict))
      .filter((r) => !state.group || r.group === state.group)
      .filter((r) => words.every((w) => r.text.includes(w)))
      .sort((a, b) => {
        const ka = col.key(a);
        const kb = col.key(b);
        const d = ka < kb ? -1 : ka > kb ? 1 : a.idx - b.idx;
        return state.desc && ka !== kb ? -d : d;
      });
    tbody.replaceChildren(...shownRows.map((r) => trs.get(r)!));
    shown.textContent = `${shownRows.length} of ${rows.length} items`;
    empty.hidden = shownRows.length > 0;
    for (const b of chipEls) {
      const on = state.verdicts.has(b.dataset['v'] as Verdict);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const th of ths) {
      const on = th.dataset['col'] === state.sort;
      th.setAttribute('aria-sort', on ? (state.desc ? 'descending' : 'ascending') : 'none');
      th.classList.toggle('sorted', on);
    }
    sortSel.value = `${state.sort}:${state.desc ? 'desc' : 'asc'}`;
    writeState(state);
  }

  filter.addEventListener('input', update);
  group.addEventListener('change', update);
  sortSel.addEventListener('change', () => {
    const [id, dir] = sortSel.value.split(':');
    state.sort = id ?? 'idx';
    state.desc = dir === 'desc';
    update();
  });
  update();
}

function rowEl(r: Row): HTMLTableRowElement {
  const tr = el('tr');
  tr.classList.add(`v-${r.reading.verdict}`);
  const cell = (id: string, label: string, content: string | Node | (string | Node)[], cls?: string): void => {
    const td = el('td', cls);
    td.dataset['label'] = label;
    td.dataset['col'] = id;
    // A blank stays truly empty, so `td:empty` can hide it in a card.
    if (Array.isArray(content)) td.append(...content);
    else if (content !== '') td.append(content);
    tr.append(td);
  };
  const n = (v: number | undefined): string => (v === undefined ? '' : String(v));

  cell('idx', '#', String(r.idx), 'num');

  const name = el('div', 'name');
  if (r.pic) {
    const img = el('img', 'pic');
    img.src = r.pic;
    img.alt = '';
    img.width = 28;
    img.height = 36;
    name.append(img);
  }
  const words = el('div', 'name-words');
  words.append(el('strong', undefined, r.item.fullName));
  const sub: string[] = [];
  if (r.item.name && r.item.name !== r.item.fullName) sub.push(r.item.name);
  if (r.variantOf !== null) sub.push(`variant of #${r.variantOf}`);
  if (r.item.e3Ability >= 0) sub.push(`E3 code ${r.item.e3Ability}`);
  if (sub.length) words.append(el('small', undefined, sub.join(' · ')));
  const tags = el('span', 'tags');
  if (r.item.magic) tags.append(el('span', 'tag', 'magic'));
  if (r.item.cursed) tags.append(el('span', 'tag cursed', 'cursed'));
  if (tags.childElementCount) words.append(tags);
  name.append(words);
  cell('name', 'Name', name);

  cell('type', 'Type', r.sheet.type);
  cell('lvl', 'Level', String(r.item.itemLevel), 'num');
  cell('dmg', r.sheet.dmg !== undefined ? 'Damage' : 'Defend', n(r.sheet.dmg ?? r.sheet.def), 'num');
  cell('bonus', 'Bonus', n(r.sheet.bonus), 'num');
  cell('enc', 'Encumbrance', n(r.sheet.enc), 'num');
  cell('use', 'Uses', n(r.sheet.use), 'num');
  cell('val', 'Value', String(r.sheet.val), 'num');
  cell('wt', 'Weight', String(r.sheet.weight), 'num');

  const said = r.sheet.abil ? el('span', undefined, r.sheet.abil) : el('span', 'nothing', '—');
  cell('sheet', 'In the game', r.sheet.desc ? [said, el('small', 'desc', r.sheet.desc)] : said);

  const code: Node[] = [];
  if (r.combat) code.push(el('span', 'combat', r.combat));
  if (r.reading.effect && r.item.e3Ability !== 0) code.push(el('span', 'effect', r.reading.effect));
  const meta: string[] = [];
  if (r.use) meta.push(`Use: ${r.use}`);
  if (r.reading.where !== '—') meta.push(r.reading.where);
  if (meta.length) code.push(el('small', 'where', meta.join(' · ')));
  if (!code.length) code.push(el('span', 'nothing', '—'));
  cell('code', 'By the code', code);

  const verdict: Node[] = [el('span', `badge ${r.reading.verdict}`,
    VERDICTS.find((v) => v.id === r.reading.verdict)!.label)];
  if (r.reading.note) verdict.push(el('small', 'note', r.reading.note));
  cell('verdict', 'Exile III vs BoE', verdict);
  return tr;
}

void main();
