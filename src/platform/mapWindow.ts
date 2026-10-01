/**
 * The pop-out map's own page: `?popout=map`, opened from View › Map in New
 * Window. It loads none of the game. It says hello on the map channel and
 * draws whatever the game tab sends back (see `render/worldMap.ts`), fitted
 * to its window. Put it on another monitor and it follows the party around.
 */

import {
  MAP_CHANNEL, MapLabel, MapMessage, MapSnapshot, PAL_ROAD, PAL_UNEXPLORED, WORLD_TILE, paletteCell,
} from '../render/worldMap';

/** Extra squares around the explored area when the map is cropped to it. */
const CROP_MARGIN = 3;

const STYLE = `
  body.popout { padding: 0; gap: 0; height: 100vh; overflow: hidden; background: #111; }
  body.popout > :not(.map-root) { display: none !important; }
  .map-root { position: fixed; inset: 0; display: flex; flex-direction: column; }
  .map-bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    padding: 6px 12px; background: #222; border-bottom: 1px solid #3a3a3a;
    font-size: 13px; color: #ddd;
  }
  .map-bar strong { font-weight: 600; }
  .map-bar .map-place { color: #c9b27a; }
  .map-bar .map-spacer { flex: 1; }
  .map-bar button {
    font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 3px;
    border: 1px solid #4a4a4a; background: transparent; color: #aaa; cursor: pointer;
  }
  .map-bar button.on { background: #3a3a55; border-color: #6a8fc7; color: #ddd; }
  .map-view { flex: 1; position: relative; min-height: 0; }
  .map-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`;

export function startMapWindow(): void {
  document.title = 'Map — blades-of-exile-ts';
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  document.body.classList.add('popout');

  const root = document.createElement('div');
  root.className = 'map-root';
  const bar = document.createElement('div');
  bar.className = 'map-bar';
  const title = document.createElement('strong');
  title.textContent = 'Waiting for the game…';
  const place = document.createElement('span');
  place.className = 'map-place';
  const spacer = document.createElement('span');
  spacer.className = 'map-spacer';
  const toggle = (label: string, on: boolean, tip: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = tip;
    b.classList.toggle('on', on);
    return b;
  };
  // Cropped by default: early in a game the explored part of a whole
  // continent is a speck, which looks like a blank map.
  const cropBtn = toggle('Explored area only', true, 'Zoom in on the part of the map the party has seen');
  const namesBtn = toggle('Names', true, 'Show town and area names');
  bar.append(title, place, spacer, cropBtn, namesBtn);
  const view = document.createElement('div');
  view.className = 'map-view';
  const canvas = document.createElement('canvas');
  view.append(canvas);
  root.append(bar, view);
  document.body.append(root);

  const grid = document.createElement('canvas');
  const palette = document.createElement('canvas');
  let snap: MapSnapshot | null = null;
  let prevCells: Uint16Array | null = null;
  let prevRoads: Uint8Array | null = null;
  let crop = true;
  let names = true;

  cropBtn.addEventListener('click', () => {
    crop = !crop;
    cropBtn.classList.toggle('on', crop);
    paint();
  });
  namesBtn.addEventListener('click', () => {
    names = !names;
    namesBtn.classList.toggle('on', names);
    paint();
  });

  /** Bring the offscreen grid up to date with `next`, redrawing only changed squares. */
  const updateGrid = (next: MapSnapshot, full: boolean): void => {
    const g = grid.getContext('2d');
    if (!g) return;
    if (grid.width !== next.w * WORLD_TILE || grid.height !== next.h * WORLD_TILE) {
      grid.width = next.w * WORLD_TILE;
      grid.height = next.h * WORLD_TILE;
      full = true;
    }
    if (full || prevCells === null || prevCells.length !== next.cells.length) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, grid.width, grid.height);
      full = true;
    }
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < next.h; y++) {
      for (let x = 0; x < next.w; x++) {
        const i = y * next.w + x;
        const cell = next.cells[i]!;
        const road = next.roads[i]!;
        if (!full && prevCells![i] === cell && prevRoads![i] === road) continue;
        const dx = x * WORLD_TILE;
        const dy = y * WORLD_TILE;
        g.fillStyle = '#000';
        g.fillRect(dx, dy, WORLD_TILE, WORLD_TILE);
        if (cell === PAL_UNEXPLORED) continue;
        const [sx, sy] = paletteCell(cell);
        g.drawImage(palette, sx, sy, WORLD_TILE, WORLD_TILE, dx, dy, WORLD_TILE, WORLD_TILE);
        if (road) {
          const [rx, ry] = paletteCell(PAL_ROAD);
          g.drawImage(palette, rx, ry, WORLD_TILE, WORLD_TILE, dx, dy, WORLD_TILE, WORLD_TILE);
        }
      }
    }
    prevCells = next.cells;
    prevRoads = next.roads;
  };

  /** The part of the grid on show, in squares. */
  const viewRect = (s: MapSnapshot): { x: number; y: number; w: number; h: number } => {
    if (!crop) return { x: 0, y: 0, w: s.w, h: s.h };
    let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (s.cells[y * s.w + x] === PAL_UNEXPLORED) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: s.w, h: s.h };
    x0 = Math.max(0, x0 - CROP_MARGIN);
    y0 = Math.max(0, y0 - CROP_MARGIN);
    x1 = Math.min(s.w - 1, x1 + CROP_MARGIN);
    y1 = Math.min(s.h - 1, y1 + CROP_MARGIN);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const paint = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(view.clientWidth * dpr));
    const ch = Math.max(1, Math.round(view.clientHeight * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cw, ch);
    if (snap === null) return;
    if (snap.note !== null || snap.w === 0) {
      centredText(ctx, snap.note ?? '', cw / 2, ch / 2, 16 * dpr);
      return;
    }
    const v = viewRect(snap);
    const pad = 12 * dpr;
    const scale = Math.min((cw - 2 * pad) / v.w, (ch - 2 * pad) / v.h);
    const ox = (cw - v.w * scale) / 2;
    const oy = (ch - v.h * scale) / 2;
    // Shrinking wants smoothing, and enlarging wants square pixels.
    ctx.imageSmoothingEnabled = scale < WORLD_TILE;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(grid, v.x * WORLD_TILE, v.y * WORLD_TILE, v.w * WORLD_TILE, v.h * WORLD_TILE,
      ox, oy, v.w * scale, v.h * scale);
    const at = (x: number, y: number): [number, number] => [ox + (x - v.x) * scale, oy + (y - v.y) * scale];

    for (const m of snap.life) marker(ctx, ...at(m.x + 0.5, m.y + 0.5), scale, '#00ff00', '#0000ff');
    if (snap.party) marker(ctx, ...at(snap.party.x + 0.5, snap.party.y + 0.5), scale, '#ff0000', '#000');
    if (names) drawLabels(ctx, snap.labels, at, scale, dpr);
  };

  // The game tab that opened this one names itself in the URL. Every other
  // game on the channel is ignored, because each numbers its palette its own
  // way. Opened by hand, the map pairs with the first game that answers.
  let game = new URLSearchParams(window.location.search).get('game');
  const hello = (): void => {
    channel.postMessage(game === null ? { type: 'hello' } : { type: 'hello', game });
  };
  const channel = new BroadcastChannel(MAP_CHANNEL);
  channel.onmessage = (ev: MessageEvent<MapMessage>) => {
    const msg = ev.data;
    if (msg?.type === 'ready') {
      if (game === null || msg.game === game) hello();
      return;
    }
    if (msg?.type !== 'snapshot') return;
    if (game === null) game = msg.game;
    if (msg.game !== game) return;
    let full = false;
    if (msg.palette) {
      palette.width = msg.palette.width;
      palette.height = msg.palette.height;
      palette.getContext('2d')?.putImageData(msg.palette, 0, 0);
      full = true;
    }
    if (snap === null || snap.w !== msg.w || snap.h !== msg.h || snap.place !== msg.place) full = true;
    snap = msg;
    title.textContent = msg.scenario;
    place.textContent = msg.place;
    document.title = `Map — ${msg.place || msg.scenario}`;
    updateGrid(msg, full);
    paint();
  };
  hello();
  window.addEventListener('resize', paint);
  paint();
}

function marker(
  ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, fill: string, ring: string,
): void {
  const r = Math.max(4, scale / 2);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r / 4);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

function centredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.font = `${size}px BoEBold, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ddd';
  ctx.fillText(text, x, y);
}

/**
 * Names, most important first, and a name that would overlap one already
 * placed is left out: towns beat areas, and areas beat sector names.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D, labels: MapLabel[],
  at: (x: number, y: number) => [number, number], scale: number, dpr: number,
): void {
  const order: MapLabel['kind'][] = ['town', 'area', 'sector'];
  const placed: { l: number; t: number; r: number; b: number }[] = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const kind of order) {
    const size = (kind === 'sector' ? 17 : kind === 'town' ? 14 : 12) * dpr;
    ctx.font = kind === 'town'
      ? `bold ${size}px BoEBold, system-ui, sans-serif`
      : kind === 'area'
        ? `italic ${size}px BoEPlain, system-ui, sans-serif`
        : `${size}px BoEMaidenword, BoEBold, serif`;
    for (const label of labels) {
      if (label.kind !== kind) continue;
      let [x, y] = at(label.x, label.y);
      // A town's name sits just above its entrance.
      if (kind === 'town') y -= Math.max(6 * dpr, scale * 0.6) + size / 2;
      const w = ctx.measureText(label.text).width;
      const box = { l: x - w / 2 - 3, t: y - size / 2 - 2, r: x + w / 2 + 3, b: y + size / 2 + 2 };
      if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue;
      placed.push(box);
      ctx.globalAlpha = kind === 'sector' ? 0.55 : 1;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeText(label.text, x, y);
      ctx.fillStyle = kind === 'town' ? '#fff' : kind === 'area' ? '#f3dc98' : '#c9d6ea';
      ctx.fillText(label.text, x, y);
      ctx.globalAlpha = 1;
    }
  }
}
