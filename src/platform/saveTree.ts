/**
 * The restore view: a tree drawn as a tree, so a player can see where each
 * save was taken and pick one to go back to.
 *
 * Nodes run left to right by in-game time and top to bottom by branch
 * (`saveTreeLayout.ts`), squeezed to the pane so it never scrolls. Shape and
 * colour say what a save is to the tree (`roleOf` in `saveRetention.ts`):
 * grey for the autosaves, orange for milestones (entering a town, a rest), a
 * blue star for the player's own, a green diamond where a branch starts and a
 * hollow ring at a branch's end; a black ring marks where the live game is.
 * Hovering a node previews it; clicking one shows its screenshot and a card of
 * what the party had, with what may be done to it.
 *
 * A row of buttons under the tree walks it without aiming at a dot — on a
 * phone the dots of a long game are too close to tap. ◀ is the save before
 * (the parent: back along this save's own history), ▶ the save after on the
 * same branch (at a fork, the child on its own row, else the first), ▲ ▼ hop
 * to the nearest save on the row above or below, and ⏮ ⏭ go to the first
 * save and to where the game is now. The arrow keys, Home and End do the same.
 *
 * The dialog is one fixed size, whatever is selected — the note under the
 * card always has its room — and its only buttons bottom right are Cancel and
 * Restore. Restoring never deletes: playing on from an old save starts a
 * branch. Plain DOM and SVG, no canvas, so the startup screen (which runs
 * before any graphics load) and the in-game Load command share it.
 */

import {
  DEFAULT_MAX_AUTO_SAVES, SnapRole, autoCount, branchOfEnd, canDeleteBranch, canDeleteFromEnd, canDeleteSingle, roles,
} from './saveRetention';
import { SnapInfo } from './saveStore';
import { layoutTree } from './saveTreeLayout';

export interface SaveTreeOptions {
  treeName: string;
  scenarioTitle: string;
  snaps: readonly SnapInfo[];
  head: number;
  /** The tree's autosave cap. */
  maxAuto?: number;
  /** "Fort Talrus", "Outdoors" — the place a save was taken. */
  placeName: (snap: SnapInfo) => string;
  /** Restore this save; the view closes first. */
  restore: (seq: number) => void;
  download: (seq: number) => void;
  exportTree?: () => void;
  /** Delete one save, keeping what came after; resolves with the fresh tree. */
  deleteSnapshot?: (seq: number) => Promise<readonly SnapInfo[]>;
  /** Delete a whole branch, from its first save or its end save; resolves with the fresh tree. */
  deleteBranch?: (seq: number) => Promise<readonly SnapInfo[]>;
  /** Delete the whole game (offered on its first save); the caller closes the view. */
  deleteTree?: () => void;
  /** Change the autosave cap; resolves with the fresh tree. */
  setMaxAuto?: (max: number) => Promise<readonly SnapInfo[]>;
  close: () => void;
}

const SVG = 'http://www.w3.org/2000/svg';
const TOP = 22;

const CSS = `
.stree-back { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.7);
  display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.stree { width: min(1000px, calc(100vw - 24px)); height: min(640px, calc(100vh - 24px));
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto; box-sizing: border-box;
  background: var(--paper-tile, none) 0 0 / 64px 64px repeat, #e4e4e4; image-rendering: pixelated;
  color: #000; border: 1px solid #000; border-radius: 4px; box-shadow: 0 4px 18px rgba(0,0,0,.55);
  font: 12px/1.35 system-ui, sans-serif; }
.stree img, .stree svg { image-rendering: auto; }
.stree header { display: flex; align-items: center; gap: 6px 14px; padding: 10px 14px 8px; flex-wrap: wrap; }
.stree-title { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.stree h2 { margin: 0; font-family: 'BoEDungeon', Georgia, serif; font-variant: small-caps; font-weight: normal;
  font-size: 24px; line-height: 1.05; letter-spacing: .03em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.stree-title small { color: #333; font-size: 11px; font-style: italic; }
.stree-legend { display: flex; gap: 4px 12px; flex-wrap: wrap; justify-content: flex-end; }
.stree-key { display: inline-flex; align-items: center; gap: 4px; color: #222; white-space: nowrap; }
.stree-body { display: grid; grid-template-columns: minmax(0, 1fr) 262px; gap: 12px; padding: 0 14px; min-height: 0; }
.stree-pane { position: relative; overflow: hidden; min-height: 0; background: rgba(255,255,255,.6);
  border: 1px solid #000; border-radius: 3px; }
.stree-pane svg { position: absolute; inset: 0; display: block; }
.stree-left { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 6px; min-height: 0; }
.stree-nav { display: flex; gap: 4px; align-items: center; }
.stree-nav button { padding: 3px 0; width: 36px; font-size: 13px; line-height: 1.2; }
.stree-nav .stree-where { flex: 1 1 auto; min-width: 0; padding-left: 6px; color: #333; font-size: 11px;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.stree-key-toggle { display: none; }
.stree-detail { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: hidden; }
.stree-shot { width: 100%; aspect-ratio: 351 / 279; background: #111; border: 1px solid #000; border-radius: 3px;
  object-fit: cover; display: block; box-sizing: border-box; flex: none; }
.stree-shot.none { display: flex; align-items: center; justify-content: center; color: #888; }
.stree-card { border: 1px solid #000; border-radius: 3px; background: rgba(255,255,255,.55); padding: 7px 9px; flex: none; }
.stree-card h3 { margin: 0 0 3px; font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.stree-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0 8px; }
.stree-card dt { color: #444; }
.stree-card dd { margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.stree-pcs { margin: 5px 0 0; padding: 4px 0 0; border-top: 1px solid #999; list-style: none;
  display: grid; grid-template-columns: 1fr auto auto auto; gap: 0 8px; font-size: 11px; font-variant-numeric: tabular-nums; }
.stree-pcs li { display: contents; }
.stree-pcs span:first-child { font-weight: bold; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.stree-note { min-height: 46px; flex: none; box-sizing: border-box; font-size: 11px; }
.stree-note > div { border: 1px solid #b45309; background: #fff7ed; border-radius: 3px; padding: 5px 8px; }
.stree-note > div.plain { border-color: #888; background: rgba(255,255,255,.55); }
.stree-node-actions { display: flex; gap: 6px; flex-wrap: wrap; flex: none; }
.stree button { font: inherit; padding: 5px 12px; background: #f4f4f4; border: 1px solid #000; border-radius: 3px;
  color: #000; cursor: pointer; }
.stree button:hover:not(:disabled), .stree button:focus-visible { background: #fff; outline: 1px solid #000; }
.stree button.primary { font-weight: bold; min-width: 88px; }
.stree button.small { padding: 3px 9px; font-size: 11px; }
.stree button.danger:hover:not(:disabled) { color: #a00; }
.stree button:disabled { opacity: .45; cursor: default; }
.stree footer { display: flex; gap: 10px; align-items: center; padding: 10px 14px; flex-wrap: wrap; }
.stree footer .grow { flex: 1 1 auto; }
.stree-cap { display: inline-flex; align-items: center; gap: 6px; }
.stree-cap input { width: 52px; font: inherit; padding: 3px 5px; border: 1px solid #000; border-radius: 3px; background: #fff; }
.stree-tip { position: fixed; z-index: 1001; width: 190px; background: #fff; border: 1px solid #000; border-radius: 3px;
  padding: 4px; pointer-events: none; font: 11px/1.35 system-ui, sans-serif; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.stree-tip .stree-shot { margin-bottom: 3px; }
.stree-node { cursor: pointer; }
.stree-node:focus { outline: none; }
.stree-node:hover .ring { stroke: #000; stroke-width: 1.5; }
/* A phone: the whole screen; the tree on top with its buttons, the save's
   picture and card side by side under it; the key folded behind a button. */
@media (max-width: 640px) {
  .stree-back { padding: 0; }
  .stree { width: 100vw; height: 100vh; height: 100dvh; border-radius: 0; border: none; }
  .stree header { padding: 8px 10px 6px; }
  .stree h2 { font-size: 20px; }
  .stree-key-toggle { display: inline-block; }
  .stree-legend { display: none; width: 100%; justify-content: flex-start; }
  .stree.show-key .stree-legend { display: flex; }
  .stree-body { grid-template-columns: 1fr; grid-template-rows: minmax(150px, 1fr) auto; gap: 8px; padding: 0 10px; }
  .stree-nav button { width: auto; flex: 0 0 44px; min-height: 38px; font-size: 15px; }
  .stree-nav .stree-where { display: none; }
  .stree-detail { display: grid; grid-template-columns: 40% minmax(0, 1fr); align-items: start; gap: 8px;
    overflow: auto; max-height: 48vh; max-height: 48dvh; }
  .stree-detail > .stree-note, .stree-detail > .stree-node-actions { grid-column: 1 / -1; }
  .stree-note { min-height: 0; }
  .stree footer { padding: 8px 10px; gap: 8px; }
  .stree footer .grow { flex-basis: 100%; height: 0; }
  .stree footer .grow ~ button { flex: 1 1 0; min-height: 40px; }
}
`;

let cssDone = false;
function addCss(): void {
  if (cssDone) return;
  cssDone = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const COLOUR = {
  auto: '#6b7280', milestone: '#d9480f', manual: '#1d4ed8', branch: '#2f7d32',
} as const;
const KIND_NAME = { auto: 'Autosave', milestone: 'Milestone', manual: 'Saved by you', branch: 'Autosave' } as const;
const ROLE_NAME: Partial<Record<SnapRole, string>> = {
  root: 'First save', branch: 'Branch save', end: 'End save',
};

/** A star path centred on 0,0, radius r. */
function starPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** The mark for one save, centred on 0,0. */
function mark(kind: SnapInfo['kind'], role: SnapRole, r: number): SVGElement {
  if (kind === 'manual') return s('path', { d: starPath(r + 2), fill: COLOUR.manual });
  if (role === 'branch') {
    return s('path', { d: `M0,${-r - 1}L${r + 1},0L0,${r + 1}L${-r - 1},0Z`, fill: COLOUR.branch });
  }
  if (role === 'end') {
    return s('circle', { r: r - 0.5, fill: '#fff', stroke: COLOUR[kind], 'stroke-width': 2.5 });
  }
  return s('circle', { r: r - (kind === 'auto' ? 1 : 0), fill: COLOUR[kind] });
}

const dayOf = (snap: SnapInfo): number => Math.floor(snap.gameAge / 3700) + 1;
const when = (snap: SnapInfo): string =>
  new Date(snap.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function showSaveTree(parent: HTMLElement, opts: SaveTreeOptions): { close: () => void } {
  addCss();
  /** A touch screen: bigger hit areas, and no hover preview (a tap selects). */
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let snaps = [...opts.snaps];
  let roleBy = roles(snaps);
  let maxAuto = opts.maxAuto ?? DEFAULT_MAX_AUTO_SAVES;
  const urls = new Map<number, string>();
  const thumbUrl = (snap: SnapInfo): string | undefined => {
    if (!snap.thumb) return undefined;
    let url = urls.get(snap.seq);
    if (url === undefined) {
      url = URL.createObjectURL(new Blob([snap.thumb as BlobPart], { type: 'image/webp' }));
      urls.set(snap.seq, url);
    }
    return url;
  };
  const roleOf = (snap: SnapInfo): SnapRole => roleBy.get(snap.seq) ?? snap.kind;
  const kindLabel = (snap: SnapInfo): string => {
    const base = `${KIND_NAME[snap.kind]}${snap.reason !== '' && snap.reason !== 'Tick' && snap.reason !== 'Manual'
      ? ` (${snap.reason})` : ''}`;
    const role = ROLE_NAME[roleOf(snap)];
    return role === undefined ? base : `${role} · ${base}`;
  };

  const back = h('div', 'stree-back');
  const box = h('div', 'stree');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Saved games: ${opts.treeName}`);
  back.append(box);

  // Header: the game's name, and the key to the marks.
  const head = h('header');
  const title = h('div', 'stree-title');
  const counts = h('small');
  title.append(h('h2', undefined, opts.treeName), counts);
  const legend = h('div', 'stree-legend');
  const key = (label: string, make: () => SVGElement): void => {
    const k = h('span', 'stree-key');
    const svg = s('svg', { width: 16, height: 16, viewBox: '-8 -8 16 16' });
    svg.append(make());
    k.append(svg, label);
    legend.append(k);
  };
  key('Autosave', () => mark('auto', 'auto', 5));
  key('Milestone', () => mark('milestone', 'milestone', 5));
  key('Saved by you', () => mark('manual', 'manual', 4));
  key('Branch save', () => mark('auto', 'branch', 5));
  key('End save', () => mark('auto', 'end', 5));
  // On a phone the key folds away behind a button (CSS shows it there only).
  const keyToggle = h('button', 'small stree-key-toggle', 'Key');
  keyToggle.type = 'button';
  keyToggle.setAttribute('aria-expanded', 'false');
  keyToggle.addEventListener('click', () => {
    keyToggle.setAttribute('aria-expanded', String(box.classList.toggle('show-key')));
  });
  head.append(title, keyToggle, legend);

  const body = h('div', 'stree-body');
  const left = h('div', 'stree-left');
  const pane = h('div', 'stree-pane');
  const nav = h('div', 'stree-nav');
  left.append(pane, nav);
  const detail = h('div', 'stree-detail');
  body.append(left, detail);

  // Footer: the tree's own settings on the left; Cancel and Restore, only, on the right.
  const foot = h('footer');
  if (opts.setMaxAuto) {
    const cap = h('label', 'stree-cap');
    const input = h('input');
    input.type = 'number';
    input.min = '0';
    input.max = '9999';
    input.value = String(maxAuto);
    input.title = 'How many autosaves this game keeps. Milestones, your own saves and the first and last save of each branch are kept as well, and never counted.';
    input.addEventListener('change', () => {
      const want = Math.max(0, Math.min(9999, Math.floor(Number(input.value))));
      if (!Number.isFinite(want)) { input.value = String(maxAuto); return; }
      const lose = autoCount(snaps, opts.head) - want;
      if (lose > 0 && !window.confirm(`That deletes ${lose} of this game's older autosaves now. Go ahead?`)) {
        input.value = String(maxAuto);
        return;
      }
      void opts.setMaxAuto!(want).then((fresh) => {
        maxAuto = want;
        input.value = String(want);
        refresh(fresh);
      }).catch((err: unknown) => { window.alert(String(err)); });
    });
    cap.append('Keep up to', input, 'autosaves');
    foot.append(cap);
  }
  if (opts.exportTree) {
    const exp = h('button', 'small', 'Export all (zip)…');
    exp.type = 'button';
    exp.addEventListener('click', () => { opts.exportTree!(); });
    foot.append(exp);
  }
  foot.append(h('span', 'grow'));
  const cancelBtn = h('button', undefined, 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => { opts.close(); });
  const restoreBtn = h('button', 'primary', 'Restore');
  restoreBtn.type = 'button';
  restoreBtn.addEventListener('click', () => { opts.restore(selected); });
  foot.append(cancelBtn, restoreBtn);
  box.append(head, body, foot);

  let selected = opts.head;
  const nodeEls = new Map<number, SVGGElement>();

  type Step = 'first' | 'back' | 'up' | 'down' | 'fwd' | 'now';
  const navButtons = new Map<Step, HTMLButtonElement>();
  const where = h('span', 'stree-where');
  for (const [step, label, tip] of [
    ['first', '⏮', 'First save'],
    ['back', '◀', 'The save before'],
    ['up', '▲', 'The branch above'],
    ['down', '▼', 'The branch below'],
    ['fwd', '▶', 'The save after, on this branch'],
    ['now', '⏭', 'Where the game is now'],
  ] as const) {
    const b = h('button', undefined, label);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.dataset['step'] = step;
    b.addEventListener('click', () => { go(step); });
    navButtons.set(step, b);
    nav.append(b);
  }
  nav.append(where);

  const updateCounts = (): void => {
    const bytes = snaps.reduce((sum, n) => sum + n.bytes, 0);
    const autos = autoCount(snaps, opts.head);
    counts.textContent = `${opts.scenarioTitle} · ${snaps.length} saves (${autos} of ${maxAuto} autosaves) · `
      + `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const showDetail = (seq: number): void => {
    const snap = snaps.find((n) => n.seq === seq);
    if (snap === undefined) return;
    detail.replaceChildren();
    const url = thumbUrl(snap);
    if (url !== undefined) {
      const img = h('img', 'stree-shot');
      img.alt = `Screenshot of ${opts.placeName(snap)}`;
      img.src = url;
      detail.append(img);
    } else {
      detail.append(h('div', 'stree-shot none', 'No picture'));
    }

    // What the game was, in a card.
    const card = h('div', 'stree-card');
    card.append(h('h3', undefined, `${opts.placeName(snap)} — day ${dayOf(snap)}`));
    const dl = h('dl');
    const row = (k: string, v: string): void => { dl.append(h('dt', undefined, k), h('dd', undefined, v)); };
    row('Saved', when(snap));
    row('Kind', kindLabel(snap));
    row('Gold', String(snap.preview.gold));
    card.append(dl);
    const pcs = snap.preview.pcs.filter((p) => p.name !== '');
    if (pcs.length > 0) {
      const list = h('ul', 'stree-pcs');
      for (const pc of pcs) {
        const li = h('li');
        li.append(h('span', undefined, pc.name), h('span', undefined, `L${pc.level}`),
          h('span', undefined, `HP ${pc.health}/${pc.maxHealth}`),
          h('span', undefined, pc.maxSp > 0 ? `SP ${pc.sp}/${pc.maxSp}` : ''));
        list.append(li);
      }
      card.append(list);
    }
    detail.append(card);

    // The note always has its room, so choosing a save never resizes anything.
    const isHead = seq === opts.head;
    const role = roleOf(snap);
    const hasChildren = snaps.some((n) => n.parent === seq);
    const note = h('div', 'stree-note');
    const say = (text: string, plain: boolean): void => {
      const d = h('div', plain ? 'plain' : undefined, text);
      note.append(d);
    };
    if (!isHead && hasChildren) {
      say('Restoring an older save starts a new branch — your current game and its later saves are kept.', false);
    } else if (!isHead) {
      say('Restoring this save carries on from the end of its branch.', true);
    }
    detail.append(note);

    // What may be done to this one save.
    const actions = h('div', 'stree-node-actions');
    const button = (label: string, danger: boolean, act: () => void): void => {
      const b = h('button', danger ? 'small danger' : 'small', label);
      b.type = 'button';
      b.addEventListener('click', act);
      actions.append(b);
    };
    button('Download .exg', false, () => { opts.download(seq); });
    const after = (p: Promise<readonly SnapInfo[]>): void => {
      p.then(refresh).catch((err: unknown) => { window.alert(String(err)); });
    };
    if (opts.deleteSnapshot && canDeleteSingle(snaps, seq, opts.head)) {
      button('Delete save', true, () => {
        if (!window.confirm('Delete this save? The saves after it are kept.')) return;
        after(opts.deleteSnapshot!(seq));
      });
    } else if (opts.deleteBranch && role === 'branch' && canDeleteBranch(snaps, seq, opts.head)) {
      button('Delete branch', true, () => {
        if (!window.confirm('Delete this branch — this save and every save after it? This cannot be undone.')) return;
        after(opts.deleteBranch!(seq));
      });
    } else if (opts.deleteBranch && role === 'end' && canDeleteFromEnd(snaps, seq, opts.head)) {
      // The tip of a branch that isn't the one being played: the branch back
      // to where it split off goes, the other branches stay.
      const n = branchOfEnd(snaps, seq)?.length ?? 0;
      button('Delete branch', true, () => {
        if (!window.confirm(`Delete this branch — the ${n} save${n === 1 ? '' : 's'} from where it split off up to this one? `
          + 'This cannot be undone.')) return;
        after(opts.deleteBranch!(seq));
      });
    } else if (opts.deleteTree && role === 'root') {
      button('Delete whole game', true, () => {
        if (!window.confirm(`Delete "${opts.treeName}" and all ${snaps.length} of its saves? This cannot be undone.`)) return;
        opts.deleteTree!();
      });
    }
    detail.append(actions);
    restoreBtn.title = isHead ? 'Carry on from where the game is now' : 'Go back to this save';
  };

  const refresh = (fresh: readonly SnapInfo[]): void => {
    snaps = [...fresh];
    roleBy = roles(snaps);
    if (!snaps.some((n) => n.seq === selected)) selected = opts.head;
    draw();
    showDetail(selected);
  };

  // `draw.layout` is read by the keyboard handler, so hold it on the function.
  const draw = Object.assign((): void => {
    updateCounts();
    const width = Math.max(200, pane.clientWidth);
    const height = Math.max(80, pane.clientHeight);
    const layout = layoutTree(snaps, opts.head, { scale: 900, minGap: 24, pad: 18, fitWidth: width });
    draw.layout = layout;
    const row = Math.min(38, (height - TOP - 6) / layout.lanes);
    // Dots shrink when the tree is crowded, so neighbours don't merge.
    const dot = Math.max(2.5, Math.min(6, layout.gap / 2.6, row / 3.2));
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    // A tree of a lane or two sits in the middle of the pane, not stuck to its top.
    const top = TOP + Math.max(0, (height - TOP - 6 - layout.lanes * row) / 2);
    const y = (lane: number): number => top + lane * row + row / 2;

    let lastLabel = -Infinity;
    for (const d of layout.days) {
      svg.append(s('line', { x1: d.x, x2: d.x, y1: 14, y2: height - 4, stroke: 'rgba(0,0,0,.15)' }));
      if (d.x - lastLabel < 44) continue;
      lastLabel = d.x;
      const t = s('text', { x: d.x + 3, y: 11, 'font-size': 10, fill: '#444' });
      t.textContent = `Day ${d.day}`;
      svg.append(t);
    }
    // Edges first, so the dots sit on top.
    for (const n of snaps) {
      if (n.parent === null) continue;
      const a = layout.at.get(n.parent);
      const b = layout.at.get(n.seq);
      if (a === undefined || b === undefined) continue;
      const live = layout.onHead.has(n.seq) && layout.onHead.has(n.parent);
      const bend = Math.min(20, Math.max(6, b.x - a.x));
      const path = a.lane === b.lane
        ? `M${a.x},${y(a.lane)}H${b.x}`
        : `M${a.x},${y(a.lane)}C${a.x + bend * 0.7},${y(a.lane)} ${a.x + bend * 0.3},${y(b.lane)} ${a.x + bend},${y(b.lane)}H${b.x}`;
      svg.append(s('path', {
        d: path, fill: 'none', stroke: live ? '#222' : '#888', 'stroke-width': live ? 2 : 1.5,
      }));
    }
    nodeEls.clear();
    for (const n of snaps) {
      const p = layout.at.get(n.seq)!;
      const live = layout.onHead.has(n.seq);
      const g = s('g', { class: 'stree-node', transform: `translate(${p.x},${y(p.lane)})`, tabindex: 0,
        opacity: live ? 1 : 0.75, 'data-seq': n.seq, 'data-lane': p.lane, 'data-role': roleOf(n) });
      // A finger needs more than the dot: the invisible hit area grows to
      // half the space to the neighbours, so a tap lands on the nearer save.
      if (coarse) g.append(s('circle', { r: Math.max(dot + 4, Math.min(16, layout.gap / 2, row / 2)), fill: 'transparent' }));
      g.append(s('circle', { class: 'ring', r: dot + 4, fill: 'transparent', stroke: 'transparent' }));
      if (n.seq === opts.head) g.append(s('circle', { r: dot + 3, fill: 'none', stroke: '#111', 'stroke-width': 2 }));
      g.append(mark(n.kind, roleOf(n), dot));
      // Hovering previews in a tooltip, which can't move anything under the
      // pointer; clicking (or arrowing onto a node) selects it for the panel.
      g.addEventListener('mouseenter', () => { if (!coarse) showTip(n, g); });
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
      g.addEventListener('click', () => { select(n.seq); });
      g.addEventListener('dblclick', () => { opts.restore(n.seq); });
      g.addEventListener('focus', () => { select(n.seq); });
      nodeEls.set(n.seq, g);
      svg.append(g);
    }
    pane.replaceChildren(svg);
    markSelected();
  }, { layout: layoutTree([], 0, { scale: 1, minGap: 1, pad: 0 }) });

  const select = (seq: number): void => {
    if (seq === selected && detail.firstChild !== null) return;
    selected = seq;
    showDetail(seq);
    markSelected();
  };

  /** Where each step goes from the selected save; null where it can't. */
  const target = (step: Step): number | null => {
    const here = snaps.find((n) => n.seq === selected);
    const layout = draw.layout;
    const at = layout.at.get(selected);
    if (here === undefined || at === undefined) return null;
    switch (step) {
      case 'first': {
        const root = snaps.find((n) => n.parent === null);
        return root === undefined || root.seq === selected ? null : root.seq;
      }
      case 'now':
        return opts.head === selected || !layout.at.has(opts.head) ? null : opts.head;
      case 'back':
        return here.parent;
      case 'fwd': {
        const kids = snaps.filter((n) => n.parent === selected).sort((a, b) => a.seq - b.seq);
        return (kids.find((k) => layout.at.get(k.seq)?.lane === at.lane) ?? kids[0])?.seq ?? null;
      }
      case 'up':
      case 'down': {
        // The nearest save in time on the nearest row that way.
        const dy = step === 'down' ? 1 : -1;
        let best: { seq: number; score: number } | null = null;
        for (const [seq, p] of layout.at) {
          const my = (p.lane - at.lane) * dy;
          if (my <= 0) continue;
          const score = my * 1e6 + Math.abs(p.x - at.x);
          if (best === null || score < best.score) best = { seq, score };
        }
        return best?.seq ?? null;
      }
    }
  };

  const go = (step: Step): void => {
    const seq = target(step);
    if (seq === null) return;
    select(seq);
    nodeEls.get(seq)?.focus({ preventScroll: true });
  };

  const updateNav = (): void => {
    for (const [step, b] of navButtons) b.disabled = target(step) === null;
    const snap = snaps.find((n) => n.seq === selected);
    where.textContent = snap === undefined ? '' : `${opts.placeName(snap)} — day ${dayOf(snap)} · ${when(snap)}`;
  };

  const tip = h('div', 'stree-tip');
  tip.hidden = true;
  back.append(tip);
  const showTip = (n: SnapInfo, at: Element): void => {
    tip.replaceChildren();
    const url = thumbUrl(n);
    if (url !== undefined) {
      const img = h('img', 'stree-shot');
      img.alt = '';
      img.src = url;
      tip.append(img);
    }
    tip.append(h('div', undefined, `${opts.placeName(n)} — day ${dayOf(n)}`),
      h('div', undefined, `${kindLabel(n)} · ${when(n)}`));
    tip.hidden = false;
    const r = at.getBoundingClientRect();
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.bottom + 6 + th > window.innerHeight ? Math.max(4, r.top - th - 6) : r.bottom + 6}px`;
  };

  const markSelected = (): void => {
    for (const [seq, g] of nodeEls) {
      g.querySelector('.ring')?.setAttribute('stroke', seq === selected ? '#000' : 'transparent');
      g.querySelector('.ring')?.setAttribute('stroke-width', seq === selected ? '2' : '1');
    }
    updateNav();
  };

  // The keys walk the tree as the buttons do.
  const KEY_STEP: Record<string, Step> = {
    ArrowLeft: 'back', ArrowRight: 'fwd', ArrowUp: 'up', ArrowDown: 'down', Home: 'first', End: 'now',
  };
  box.addEventListener('keydown', (e) => {
    // Nothing typed here may reach the game underneath.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); opts.close(); return; }
    if (e.key === 'Enter' && (e.target as Element).closest('.stree-node') !== null) {
      e.preventDefault();
      opts.restore(selected);
      return;
    }
    const step = KEY_STEP[e.key];
    if (step === undefined || (e.target as Element).tagName === 'INPUT') return;
    e.preventDefault();
    go(step);
  });
  back.addEventListener('mousedown', (e) => { if (e.target === back) opts.close(); });

  parent.append(back);
  draw();
  showDetail(selected);
  nodeEls.get(selected)?.focus({ preventScroll: true });
  // The tree is drawn to the pane's size, so a resized window redraws it.
  const resized = new ResizeObserver(() => { draw(); });
  resized.observe(pane);

  return {
    close: () => {
      resized.disconnect();
      back.remove();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}
