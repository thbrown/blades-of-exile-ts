/**
 * The restore view: a tree drawn as a tree, so a player can see where each
 * save was taken and pick one to go back to.
 *
 * Nodes run left to right by in-game time and top to bottom by branch
 * (`saveTreeLayout.ts`). Colour says what a save is — grey for the periodic
 * ones, orange for milestones (entering a town, a rest), a blue star for the
 * player's own — and a ring marks where the live game is. Hovering or clicking a
 * node shows its screenshot and details beside the tree, with the buttons to
 * restore it or download it as an `.exg`.
 *
 * Restoring never deletes: playing on from an old save starts a branch, and the
 * view says so beside the button. Plain DOM and SVG, no canvas, so the startup
 * screen (which runs before any graphics load) and the in-game Load command
 * share it.
 */

import { SnapInfo } from './saveStore';
import { layoutTree } from './saveTreeLayout';

export interface SaveTreeOptions {
  treeName: string;
  scenarioTitle: string;
  snaps: readonly SnapInfo[];
  head: number;
  /** "Fort Talrus", "Outdoors" — the place a save was taken. */
  placeName: (snap: SnapInfo) => string;
  /** Restore this save; the view closes first. */
  restore: (seq: number) => void;
  download: (seq: number) => void;
  exportTree?: () => void;
  /** Delete a whole abandoned branch below `seq`; resolves with the fresh tree. */
  deleteBranch?: (seq: number) => Promise<readonly SnapInfo[]>;
  close: () => void;
}

const SVG = 'http://www.w3.org/2000/svg';
const ROW = 38;
const TOP = 26;
const DOT = 6;

const CSS = `
.stree-back { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.stree { background: #e4e4e4; color: #000; border: 1px solid #000; border-radius: 4px; width: min(980px, 100%);
  max-height: 100%; display: flex; flex-direction: column; font: 12px/1.35 system-ui, sans-serif; box-sizing: border-box; }
.stree header { display: flex; align-items: baseline; gap: 12px; padding: 10px 14px 6px; flex-wrap: wrap; }
.stree h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
.stree header small { color: #444; }
.stree-body { display: flex; gap: 12px; padding: 0 14px 12px; min-height: 0; flex: 1 1 auto; flex-wrap: wrap; }
.stree-scroll { flex: 1 1 380px; min-width: 0; min-height: 150px; max-height: 60vh; overflow: auto; background: #f4f4f4;
  border: 1px solid #000; border-radius: 3px; }
.stree-scroll svg { display: block; }
.stree-detail { flex: 0 0 250px; display: flex; flex-direction: column; gap: 6px; }
.stree-shot { width: 100%; aspect-ratio: 351 / 279; background: #111; border: 1px solid #000; object-fit: cover; display: block; }
.stree-shot.none { display: flex; align-items: center; justify-content: center; color: #888; }
.stree-detail h3 { margin: 0; font-size: 13px; }
.stree-detail dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; }
.stree-detail dt { color: #555; }
.stree-detail dd { margin: 0; }
.stree-callout { border: 1px solid #b45309; background: #fff7ed; border-radius: 3px; padding: 5px 8px; }
.stree-callout.plain { border-color: #888; background: #f4f4f4; }
.stree-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.stree button { font: inherit; padding: 5px 12px; background: #f4f4f4; border: 1px solid #000; border-radius: 3px; color: #000; cursor: pointer; }
.stree button:hover:not(:disabled), .stree button:focus { background: #fff; outline: 1px solid #000; }
.stree button.primary { font-weight: bold; }
.stree button:disabled { opacity: .45; cursor: default; }
.stree footer { display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-top: 1px solid #999; flex-wrap: wrap; }
.stree footer .grow { flex: 1 1 auto; }
.stree-key { display: inline-flex; align-items: center; gap: 4px; color: #333; }
.stree-tip { position: fixed; z-index: 1001; width: 190px; background: #fff; border: 1px solid #000; border-radius: 3px;
  padding: 4px; pointer-events: none; font: 11px/1.35 system-ui, sans-serif; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.stree-tip .stree-shot { margin-bottom: 3px; }
.stree-node { cursor: pointer; }
.stree-node:focus { outline: none; }
.stree-node:focus .ring, .stree-node:hover .ring { stroke: #000; stroke-width: 2; }
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

const KIND_COLOUR = { auto: '#6b7280', milestone: '#d9480f', manual: '#1d4ed8' } as const;
const KIND_NAME = { auto: 'Autosave', milestone: 'Milestone', manual: 'Saved by you' } as const;

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

export function showSaveTree(parent: HTMLElement, opts: SaveTreeOptions): { close: () => void } {
  addCss();
  let snaps = [...opts.snaps];
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

  const back = h('div', 'stree-back');
  const box = h('div', 'stree');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Saved games: ${opts.treeName}`);
  back.append(box);

  const head = h('header');
  head.append(h('h2', undefined, opts.treeName), h('small', undefined, opts.scenarioTitle));
  const body = h('div', 'stree-body');
  const scroll = h('div', 'stree-scroll');
  const detail = h('div', 'stree-detail');
  body.append(scroll, detail);

  const foot = h('footer');
  const key = (colour: string, label: string, star = false): HTMLElement => {
    const k = h('span', 'stree-key');
    const svg = s('svg', { width: 14, height: 14, viewBox: '-7 -7 14 14' });
    svg.append(star ? s('path', { d: starPath(6), fill: colour }) : s('circle', { r: 5, fill: colour }));
    k.append(svg, label);
    return k;
  };
  foot.append(key(KIND_COLOUR.auto, 'Autosave'), key(KIND_COLOUR.milestone, 'Milestone'),
    key(KIND_COLOUR.manual, 'Saved by you', true), h('span', 'grow'));
  if (opts.exportTree) {
    const exp = h('button', undefined, 'Export all (zip)…');
    exp.addEventListener('click', () => { opts.exportTree!(); });
    foot.append(exp);
  }
  const closeBtn = h('button', undefined, 'Close');
  closeBtn.addEventListener('click', () => { opts.close(); });
  foot.append(closeBtn);
  box.append(head, body, foot);

  let selected = opts.head;
  const nodeEls = new Map<number, SVGGElement>();

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
    const day = Math.floor(snap.gameAge / 3700) + 1;
    detail.append(h('h3', undefined, `${opts.placeName(snap)} — day ${day}`));
    const dl = h('dl');
    const row = (k: string, v: string): void => { dl.append(h('dt', undefined, k), h('dd', undefined, v)); };
    row('Saved', new Date(snap.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    row('Kind', `${KIND_NAME[snap.kind]}${snap.reason !== '' && snap.reason !== 'Tick' && snap.reason !== 'Manual'
      ? ` (${snap.reason})` : ''}`);
    row('Gold', String(snap.preview.gold));
    for (const pc of snap.preview.pcs.filter((p) => p.name !== '')) {
      row(pc.name, `L${pc.level} · HP ${pc.health}/${pc.maxHealth}${pc.maxSp > 0 ? ` · SP ${pc.sp}/${pc.maxSp}` : ''}`);
    }
    detail.append(dl);

    const isHead = seq === opts.head;
    const hasChildren = snaps.some((n) => n.parent === seq);
    // The newest save needs no note: Continue says what it does.
    if (!isHead) {
      const note = h('div', hasChildren ? 'stree-callout' : 'stree-callout plain');
      note.textContent = hasChildren
        ? 'Restoring an older save starts a new branch — your current game and its later saves are kept.'
        : 'Restoring this save continues from its end of the tree.';
      detail.append(note);
    }
    const actions = h('div', 'stree-actions');
    const restore = h('button', 'primary', isHead ? 'Continue' : hasChildren ? 'Restore (new branch)' : 'Restore');
    restore.addEventListener('click', () => { opts.restore(seq); });
    const dl2 = h('button', undefined, 'Download .exg');
    dl2.addEventListener('click', () => { opts.download(seq); });
    actions.append(restore, dl2);
    if (opts.deleteBranch && !draw.layout.onHead.has(seq)) {
      const del = h('button', undefined, 'Delete this branch');
      del.addEventListener('click', () => {
        if (!window.confirm('Delete this save and every save after it on its branch? This cannot be undone.')) return;
        void opts.deleteBranch!(seq).then((fresh) => {
          snaps = [...fresh];
          selected = opts.head;
          draw();
          showDetail(selected);
        }).catch((err: unknown) => { window.alert(String(err)); });
      });
      actions.append(del);
    }
    detail.append(actions);
  };

  // `draw.layout` is read by the detail panel, so hold it on the function.
  const draw = Object.assign((): void => {
    const layout = layoutTree(snaps, opts.head, { scale: 900, minGap: 22, pad: 24 });
    draw.layout = layout;
    const width = Math.max(layout.width + 24, 320);
    const height = TOP + layout.lanes * ROW + 16;
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    const y = (lane: number): number => TOP + lane * ROW + ROW / 2 - 8;

    for (const d of layout.days) {
      svg.append(s('line', { x1: d.x, x2: d.x, y1: 16, y2: height - 6, stroke: '#ddd' }));
      const t = s('text', { x: d.x + 3, y: 12, 'font-size': 10, fill: '#666' });
      t.textContent = `Day ${d.day}`;
      svg.append(t);
    }
    // Edges first, so the dots sit on top.
    for (const n of snaps) {
      if (n.parent === null) continue;
      const a = layout.at.get(n.parent)!;
      const b = layout.at.get(n.seq)!;
      const live = layout.onHead.has(n.seq) && layout.onHead.has(n.parent);
      const path = a.lane === b.lane
        ? `M${a.x},${y(a.lane)}H${b.x}`
        : `M${a.x},${y(a.lane)}C${a.x + 14},${y(a.lane)} ${a.x + 6},${y(b.lane)} ${a.x + 20 > b.x ? b.x : a.x + 20},${y(b.lane)}H${b.x}`;
      svg.append(s('path', {
        d: path, fill: 'none', stroke: live ? '#222' : '#999', 'stroke-width': live ? 2 : 1.5,
      }));
    }
    nodeEls.clear();
    for (const n of snaps) {
      const p = layout.at.get(n.seq)!;
      const live = layout.onHead.has(n.seq);
      const g = s('g', { class: 'stree-node', transform: `translate(${p.x},${y(p.lane)})`, tabindex: 0,
        opacity: live ? 1 : 0.7, 'data-seq': n.seq });
      g.append(s('circle', { class: 'ring', r: DOT + 4, fill: 'transparent', stroke: 'transparent' }));
      if (n.seq === opts.head) g.append(s('circle', { r: DOT + 3, fill: 'none', stroke: '#111', 'stroke-width': 2 }));
      g.append(n.kind === 'manual'
        ? s('path', { d: starPath(DOT + 2), fill: KIND_COLOUR.manual })
        : s('circle', { r: DOT - (n.kind === 'auto' ? 1 : 0), fill: KIND_COLOUR[n.kind] }));
      const title = s('title', {});
      title.textContent = `${opts.placeName(n)}, day ${Math.floor(n.gameAge / 3700) + 1}`;
      g.append(title);
      // Hovering previews in a tooltip, which can't move anything under the
      // pointer; clicking (or arrowing onto a node) selects it for the panel.
      g.addEventListener('mouseenter', () => { showTip(n, g); });
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
      g.addEventListener('click', () => { select(n.seq); });
      g.addEventListener('focus', () => { select(n.seq); });
      nodeEls.set(n.seq, g);
      svg.append(g);
    }
    scroll.replaceChildren(svg);
    markSelected();
    // Start scrolled to the head, which is the newest thing in the game.
    const at = layout.at.get(opts.head);
    if (at !== undefined) scroll.scrollLeft = Math.max(0, at.x - scroll.clientWidth * 0.7);
  }, { layout: layoutTree([], 0, { scale: 1, minGap: 1, pad: 0 }) });

  const select = (seq: number): void => {
    if (seq === selected && detail.firstChild !== null) return;
    selected = seq;
    showDetail(seq);
    markSelected();
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
    tip.append(h('div', undefined, `${opts.placeName(n)} — day ${Math.floor(n.gameAge / 3700) + 1}`),
      h('div', undefined, `${KIND_NAME[n.kind]} · ${new Date(n.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`));
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
  };

  // Arrow keys walk the tree: left/right along the branch, up/down between lanes.
  box.addEventListener('keydown', (e) => {
    // Nothing typed here may reach the game underneath.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); opts.close(); return; }
    const layout = draw.layout;
    const here = layout.at.get(selected);
    if (here === undefined || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    let best: { seq: number; score: number } | null = null;
    for (const [seq, p] of layout.at) {
      if (seq === selected) continue;
      const mx = (p.x - here.x) * dx;
      const my = (p.lane - here.lane) * dy;
      if (dx !== 0 ? mx <= 0 : my <= 0) continue;
      const score = dx !== 0 ? mx + Math.abs(p.lane - here.lane) * 1000 : my * 1000 + Math.abs(p.x - here.x);
      if (best === null || score < best.score) best = { seq, score };
    }
    if (best !== null) {
      nodeEls.get(best.seq)?.focus();
      select(best.seq);
      nodeEls.get(best.seq)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  back.addEventListener('mousedown', (e) => { if (e.target === back) opts.close(); });

  parent.append(back);
  draw();
  showDetail(selected);
  nodeEls.get(selected)?.focus({ preventScroll: true });

  return {
    close: () => {
      back.remove();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}
