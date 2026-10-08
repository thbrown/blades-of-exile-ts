/**
 * Every Exile III spell in one table: the Library's own description, what
 * the code does (`spellRules.ts`) with the numbers worked out for a caster
 * the reader sets, how they grow, and where a party learns it
 * (`spellSources.ts`). Filters and the caster live in the URL, so a view can
 * be shared.
 */

import '../pages.css';
import '../items/items.css';
import './spells.css';
import { SPELLS, Spell, SpellWhen, spellName, type SpellInfo } from '../../data/spell';
import { getStr } from '../../data/strings';
import { el, installBackdrop, loadExile3, masthead, searchable } from '../common';
import { SKILL_BONUS, SPELL_RULES, type Caster, type SpellRule } from './spellRules';
import { spellSources, type Source, type SourceKind } from './spellSources';

interface Row {
  spell: Spell;
  priest: boolean;
  /** 1–62 within its school. */
  num: number;
  name: string;
  info: SpellInfo;
  desc: string;
  rule: SpellRule | undefined;
  sources: Source[];
  text: string;
}

const LEVELS = [1, 5, 10, 15, 20, 30];

// --- state, kept in the URL ------------------------------------------------

interface State {
  q: string;
  school: '' | 'mage' | 'priest';
  where: '' | 'combat' | 'town' | 'outdoors';
  how: '' | SourceKind | 'none';
  level: number;
  int: number;
  sort: 'num' | 'name' | 'cost' | 'level';
  desc: boolean;
}

const clampInt = (s: string | null, lo: number, hi: number, dflt: number): number => {
  const n = s === null ? NaN : parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

function readState(): State {
  const p = new URLSearchParams(location.search);
  const pick = <T extends string>(v: string | null, ok: readonly T[], d: T): T => (ok.includes(v as T) ? v as T : d);
  return {
    q: p.get('q') ?? '',
    school: pick(p.get('school'), ['', 'mage', 'priest'] as const, ''),
    where: pick(p.get('where'), ['', 'combat', 'town', 'outdoors'] as const, ''),
    how: pick(p.get('how'), ['', 'start', 'shop', 'taught', 'none'] as const, ''),
    level: clampInt(p.get('lvl'), 1, 50, 10),
    int: clampInt(p.get('int'), 0, 20, 4),
    sort: pick(p.get('sort'), ['num', 'name', 'cost', 'level'] as const, 'num'),
    desc: p.get('dir') === 'desc',
  };
}

function writeState(s: State): void {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.school) p.set('school', s.school);
  if (s.where) p.set('where', s.where);
  if (s.how) p.set('how', s.how);
  if (s.level !== 10) p.set('lvl', String(s.level));
  if (s.int !== 4) p.set('int', String(s.int));
  if (s.sort !== 'num') p.set('sort', s.sort);
  if (s.desc) p.set('dir', 'desc');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// --- the page -------------------------------------------------------------

async function main(): Promise<void> {
  installBackdrop();
  const page = document.getElementById('page')!;
  const rules = el('a', undefined, 'the port’s casting code');
  rules.href = 'https://github.com/thbrown/blades-of-exile-ts/blob/main/src/pages/spells/spellRules.ts';
  page.append(masthead('Exile III Spells', [
    'Every spell in Exile III: what the Library says, what it really does, how that grows with the caster, and where to learn it.',
    (() => {
      const s = document.createElement('span');
      s.append('The numbers are read from ', rules, ', which follows Blades of Exile’s and, where they differ, Exile III’s own.');
      return s;
    })(),
  ], 'spells'));

  const card = el('section', 'card');
  page.append(card);
  const loading = el('div', 'loading', 'Loading…');
  card.append(loading);

  let scen;
  try {
    ({ scen } = await loadExile3([], (w, done) => {
      loading.textContent = done !== undefined && done > 0 && done < 1 ? `${w} ${Math.round(done * 100)}%` : w;
    }));
  } catch (e) {
    loading.textContent = `Exile III could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    loading.className = 'problem';
    return;
  }
  loading.remove();

  const sources = spellSources(scen);
  const rows: Row[] = [];
  for (const priest of [false, true]) {
    for (let i = 0; i < 62; i++) {
      const spell = (priest ? 100 + i : i) as Spell;
      const info = SPELLS[spell];
      if (!info) continue;
      const desc = getStr(priest ? 'priest-spells' : 'mage-spells', i + 1);
      const rule = SPELL_RULES[spell];
      const src = sources.get(spell) ?? [];
      rows.push({
        spell, priest, num: i + 1, name: spellName(spell), info, desc, rule, sources: src,
        text: searchable([spellName(spell), desc, rule?.effect, rule?.note, ...src.map((s) => `${s.who ?? ''} ${s.where ?? ''}`)]
          .join(' ')),
      });
    }
  }
  render(card, rows);
}

function sourceLine(s: Source): Node {
  const li = el('li', `src-${s.kind}`);
  if (s.kind === 'start') li.append('Known from the start');
  else if (s.kind === 'shop') {
    li.append(el('strong', undefined, `${s.cost} gold`), ` from ${s.who}`);
    if (s.where) li.append(el('span', 'src-where', ` (${s.where})`));
  } else {
    li.append(s.who ? `Taught by ${s.who}` : 'Taught at ');
    if (s.where) li.append(el('span', 'src-where', s.who ? ` (${s.where})` : s.where));
  }
  return li;
}

function whenText(info: SpellInfo): string {
  const w = info.when ?? 0;
  const parts: string[] = [];
  if (w & SpellWhen.COMBAT) parts.push('combat');
  if (w & SpellWhen.TOWN) parts.push('town');
  if (w & SpellWhen.OUTDOORS) parts.push('outdoors');
  return parts.length === 3 ? 'anywhere' : parts.join(', ');
}

function render(card: HTMLElement, rows: Row[]): void {
  const state = readState();

  // The caster.
  const caster = el('div', 'caster');
  const lvlIn = el('input');
  lvlIn.type = 'range'; lvlIn.min = '1'; lvlIn.max = '50'; lvlIn.value = String(state.level);
  lvlIn.setAttribute('aria-label', 'Caster level');
  const intIn = el('input');
  intIn.type = 'range'; intIn.min = '0'; intIn.max = '20'; intIn.value = String(state.int);
  intIn.setAttribute('aria-label', 'Intelligence');
  const lvlOut = el('output');
  const intOut = el('output');
  const lvlLab = el('label', 'slider');
  lvlLab.append(el('span', undefined, 'Caster level'), lvlIn, lvlOut);
  const intLab = el('label', 'slider');
  intLab.append(el('span', undefined, 'Intelligence'), intIn, intOut);
  caster.append(lvlLab, intLab);

  // Filters.
  const controls = el('div', 'controls');
  const filter = el('input', 'filter');
  filter.type = 'search';
  filter.placeholder = 'Search names, effects, teachers…';
  filter.setAttribute('aria-label', 'Search spells');
  filter.value = state.q;
  const select = (label: string, opts: [string, string][], value: string): HTMLSelectElement => {
    const s = el('select', 'select');
    s.setAttribute('aria-label', label);
    for (const [v, t] of opts) s.append(new Option(t, v));
    s.value = value;
    return s;
  };
  const school = select('School', [['', 'Both schools'], ['mage', 'Mage'], ['priest', 'Priest']], state.school);
  const where = select('Castable', [['', 'Cast anywhere or not'], ['combat', 'In combat'], ['town', 'In town'],
    ['outdoors', 'Outdoors']], state.where);
  const how = select('How to get it', [['', 'However learned'], ['start', 'Known from the start'], ['shop', 'Sold'],
    ['taught', 'Taught or found'], ['none', 'Not learnable']], state.how);
  const sortSel = select('Sort by', [['num:asc', 'Sort: school order'], ['level:asc', 'Sort: spell level'],
    ['cost:asc', 'Sort: cost ↑'], ['cost:desc', 'Sort: cost ↓'], ['name:asc', 'Sort: name']], `${state.sort}:${state.desc ? 'desc' : 'asc'}`);
  sortSel.classList.add('sort-always');
  const shown = el('span', 'shown');
  shown.setAttribute('aria-live', 'polite');
  controls.append(filter, school, where, how, sortSel, shown);

  const legend = el('p', 'legend');
  legend.append(
    el('strong', undefined, 'Reading the formulas. '),
    'L is the caster’s level. P, the power of an aimed combat spell, is 1 + ⌊L/2⌋ (one more with an item of Magery ',
    'at least the spell’s level, one more for an Anama priest). B is the Intelligence bonus: −3 at 0–1, −2 at 2, −1 at 3, ',
    '0 at 4–5, then +1, +2, +3, +4 and +5 by 19 (one more for Magically Apt, and for an item that raises it). ',
    'XdY is X dice of Y sides; ⌊ ⌋ rounds down. Monsters’ resistances and armour then cut the damage. ',
    '“The numbers” works the formula out for the caster set above; “As L grows” keeps B and walks L.',
  );

  const list = el('div', 'spells');
  const empty = el('p', 'empty', 'No spell matches.');
  card.append(caster, controls, legend, list, empty);

  const cards = new Map<Row, { root: HTMLElement; numbers: HTMLElement; growth: HTMLElement }>(
    rows.map((r) => [r, cardEl(r)]));

  function update(): void {
    state.q = filter.value;
    state.school = school.value as State['school'];
    state.where = where.value as State['where'];
    state.how = how.value as State['how'];
    state.level = clampInt(lvlIn.value, 1, 50, 10);
    state.int = clampInt(intIn.value, 0, 20, 4);
    const [s, d] = sortSel.value.split(':');
    state.sort = (s ?? 'num') as State['sort'];
    state.desc = d === 'desc';
    const c: Caster = { level: state.level, bonus: SKILL_BONUS[state.int] ?? 0 };
    lvlOut.textContent = String(c.level);
    intOut.textContent = `${state.int} (B ${c.bonus >= 0 ? '+' : '−'}${Math.abs(c.bonus)})`;

    const words = searchable(state.q).split(' ').filter((w) => w);
    const whenBit = { combat: SpellWhen.COMBAT, town: SpellWhen.TOWN, outdoors: SpellWhen.OUTDOORS };
    const key = (r: Row): number | string => state.sort === 'name' ? r.name.toLowerCase()
      : state.sort === 'cost' ? (r.info.cost ?? 0)
        : state.sort === 'level' ? (r.info.level ?? 0) * 1000 + r.spell : r.spell;
    const shownRows = rows
      .filter((r) => !state.school || (state.school === 'priest') === r.priest)
      .filter((r) => !state.where || ((r.info.when ?? 0) & whenBit[state.where]) !== 0)
      .filter((r) => !state.how || (state.how === 'none' ? r.sources.length === 0 : r.sources.some((x) => x.kind === state.how)))
      .filter((r) => words.every((w) => r.text.includes(w)))
      .sort((a, b) => {
        const ka = key(a), kb = key(b);
        const dd = ka < kb ? -1 : ka > kb ? 1 : a.spell - b.spell;
        return state.desc && ka !== kb ? -dd : dd;
      });
    for (const r of shownRows) {
      const k = cards.get(r)!;
      k.numbers.textContent = r.rule?.at ? r.rule.at(c) : '';
      k.numbers.parentElement!.hidden = !r.rule?.at;
      k.growth.replaceChildren(...growth(r.rule, c));
      k.growth.parentElement!.hidden = !r.rule?.at || r.rule.grows === 'int' || !r.rule.grows;
    }
    list.replaceChildren(...shownRows.map((r) => cards.get(r)!.root));
    shown.textContent = `${shownRows.length} of ${rows.length} spells`;
    empty.hidden = shownRows.length > 0;
    writeState(state);
  }

  for (const e of [filter, lvlIn, intIn]) e.addEventListener('input', update);
  for (const e of [school, where, how, sortSel]) e.addEventListener('change', update);
  update();
}

/** The numbers at a few levels, the reader's Intelligence held. */
function growth(rule: SpellRule | undefined, c: Caster): Node[] {
  if (!rule?.at) return [];
  return LEVELS.map((level) => {
    const li = el('li', level === c.level ? 'here' : undefined);
    li.append(el('span', 'lvl', `L${level}`), rule.at!({ level, bonus: c.bonus }));
    return li;
  });
}

function cardEl(r: Row): { root: HTMLElement; numbers: HTMLElement; growth: HTMLElement } {
  const root = el('article', `spell ${r.priest ? 'priest' : 'mage'}`);
  const head = el('header', 'spell-head');
  head.append(el('h2', undefined, r.name));
  const facts = el('div', 'facts');
  const fact = (label: string, value: string): void => {
    const f = el('span', 'fact');
    f.append(el('small', undefined, label), value);
    facts.append(f);
  };
  fact('School', `${r.priest ? 'Priest' : 'Mage'} #${r.num}`);
  fact('Level', String(r.info.level ?? '—'));
  fact('Cost', r.info.cost === -1 ? 'varies' : `${r.info.cost ?? 0} SP`);
  if (r.info.range) fact('Range', String(r.info.range));
  fact('Cast', whenText(r.info));
  head.append(facts);
  root.append(head);

  const body = el('div', 'spell-body');
  const said = el('section', 'said');
  said.append(el('h3', undefined, 'The Library says'), el('p', undefined, r.desc || '—'));
  const does = el('section', 'does');
  does.append(el('h3', undefined, 'What it does'), el('p', undefined, r.rule?.effect ?? '—'));
  if (r.rule?.note) does.append(el('p', 'note', r.rule.note));
  const numbers = el('p', 'numbers');
  const nWrap = el('div', 'numbers-wrap');
  nWrap.append(el('h3', undefined, 'The numbers'), numbers);
  const growthList = el('ul', 'growth');
  const gWrap = el('div', 'growth-wrap');
  gWrap.append(el('h3', undefined, 'As L grows'), growthList);
  does.append(nWrap, gWrap);
  const get = el('section', 'get');
  get.append(el('h3', undefined, 'How to get it'));
  const ul = el('ul', 'sources');
  if (r.sources.length === 0) ul.append(el('li', 'nothing', 'Not found anywhere in Exile III'));
  else for (const s of r.sources) ul.append(sourceLine(s));
  get.append(ul);
  body.append(said, does, get);
  root.append(body);
  return { root, numbers, growth: growthList };
}

void main();
