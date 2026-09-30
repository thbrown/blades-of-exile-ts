/**
 * Exile III's surface world as a slippy map: drag, pinch or scroll to move
 * and zoom, every town labelled, and a search box that flies to a town (or a
 * named place, or a region).
 *
 * The world is `outWidth × outHeight` sectors of 48×48 squares, each square a
 * 28×36 terrain picture — about 12,000 × 17,000 pixels, too big for one
 * canvas. So each sector is drawn once into a bitmap at up to three sizes
 * (full, ¼ and ⅛), and a frame draws only the sectors in view, from the
 * smallest size that still looks right: a tile pyramid, one sector a tile.
 * The ⅛ size of every sector is made up front; the larger ones are made as
 * they come into view, within a time budget a frame, and kept in a small
 * cache.
 *
 * Labels: towns come from each sector's town entrances (`cityLocs`),
 * clustered, so a walled town's four gates make one label; places from its
 * area descriptions; regions from sector names, one label per connected run
 * of sectors sharing a name.
 */

import '../pages.css';
import './map.css';
import { SECTOR_SIZE } from '../../data/outdoors';
import { Scenario } from '../../data/scenario';
import { ROAD_DEST, ROAD_SRC } from '../../render/layout';
import { terrainGraphic } from '../../render/terrainPics';
import { SheetStore, TILE_H, TILE_W } from '../../render/sheets';
import { el, installBackdrop, loadExile3, searchable } from '../common';

const ZW = SECTOR_SIZE * TILE_W;
const ZH = SECTOR_SIZE * TILE_H;
const MAX_SCALE = 3;
/** Label colours: the capitals, and town-0 exits left in the data. */
const CAPITAL = '#ffcf4a';
const STRAY = '#ff6a55';

type Kind = 'town' | 'place' | 'region';

/**
 * The three lands in Exile III's outdoor grid, each shown on its own: the
 * surface in columns 0–6, and in columns 7–8 the Vahnatai caves at the top
 * and Exile's upper caves at the foot, with unused sectors between. E3's own
 * rule for "underground" is the same column test (`emit.ts`, `villageZone`).
 */
interface Land {
  id: string;
  label: string;
  /** Sectors, inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const LANDS: Land[] = [
  { id: 'valorim', label: 'Valorim', x0: 0, y0: 0, x1: 6, y1: 9 },
  { id: 'exile', label: 'Exile', x0: 7, y0: 6, x1: 8, y1: 9 },
  { id: 'vahnatai', label: 'Vahnatai Caves', x0: 7, y0: 0, x1: 8, y1: 1 },
];
const landOf = (sx: number, sy: number): Land | undefined =>
  LANDS.find((l) => sx >= l.x0 && sx <= l.x1 && sy >= l.y0 && sy <= l.y1);

/** The capitals: the five cities (four town records each) and Keep of Tinraya. */
const CAPITALS = new Set([...Array(20).keys(), 35]);

/**
 * Exits to town 0 that aren't Krizsan's gate in sector (2,9). E3 left town 0,
 * the editor's default, on the army camp's towers in (4,0), which a party can
 * walk into, and on three huts — (0,3), (2,5), (3,8) — that only a blocking
 * spot can reach. E3-SUSPECTED-BUGS.md #10.
 */
const isStrayExit = (town: number, sx: number, sy: number): boolean => town === 0 && !(sx === 2 && sy === 9);

interface Place {
  kind: Kind;
  name: string;
  land: string;
  capital?: boolean;
  /** A town-0 exit that isn't Krizsan's (`isStrayExit`). */
  stray?: boolean;
  /** World pixels, the label's anchor. */
  x: number;
  y: number;
  /** Sector and square, for the card. */
  sector: { x: number; y: number };
  square: { x: number; y: number };
  region: string;
  town?: number;
  /** A town's entrances in this cluster. */
  gates?: number;
  text: string;
}

// --- places -------------------------------------------------------------------

function collectPlaces(scen: Scenario): Place[] {
  const out: Place[] = [];
  const region = (sx: number, sy: number): string => scen.outdoors[sx]?.[sy]?.name ?? '';

  for (let sx = 0; sx < scen.outWidth; sx++) {
    for (let sy = 0; sy < scen.outHeight; sy++) {
      const land = landOf(sx, sy)?.id;
      if (!land) continue;
      const sec = scen.outdoors[sx]![sy]!;
      // Towns: cluster a town's entrances lying within a few squares.
      const clusters: { town: number; pts: { x: number; y: number }[] }[] = [];
      for (const c of sec.cityLocs) {
        if (c.spec < 0) continue;
        const near = clusters.find((k) => k.town === c.spec
          && k.pts.some((p) => Math.abs(p.x - c.x) <= 4 && Math.abs(p.y - c.y) <= 4));
        if (near) near.pts.push({ x: c.x, y: c.y });
        else clusters.push({ town: c.spec, pts: [{ x: c.x, y: c.y }] });
      }
      for (const k of clusters) {
        const lx = k.pts.reduce((a, p) => a + p.x, 0) / k.pts.length;
        const ly = k.pts.reduce((a, p) => a + p.y, 0) / k.pts.length;
        const stray = isStrayExit(k.town, sx, sy);
        const town = scen.towns[k.town]?.name || `Town ${k.town}`;
        const name = stray ? `Exit to ${town}` : town;
        out.push({
          kind: 'town', name, land, town: k.town, gates: k.pts.length, stray, capital: !stray && CAPITALS.has(k.town),
          x: sx * ZW + (lx + 0.5) * TILE_W, y: sy * ZH + (ly + 0.5) * TILE_H,
          sector: { x: sx, y: sy }, square: { x: Math.round(lx), y: Math.round(ly) },
          region: region(sx, sy), text: stray ? '' : searchable(`${name} ${region(sx, sy)}`),
        });
      }
      // Places: an area description, its rects in one sector merged.
      const byName = new Map<string, { l: number; t: number; r: number; b: number }>();
      for (const a of sec.areaDesc) {
        if (!a.descr.trim()) continue;
        const had = byName.get(a.descr);
        if (had) {
          had.l = Math.min(had.l, a.left); had.t = Math.min(had.t, a.top);
          had.r = Math.max(had.r, a.right); had.b = Math.max(had.b, a.bottom);
        } else byName.set(a.descr, { l: a.left, t: a.top, r: a.right, b: a.bottom });
      }
      for (const [name, r] of byName) {
        const lx = (r.l + r.r) / 2;
        const ly = (r.t + r.b) / 2;
        out.push({
          kind: 'place', name, land, x: sx * ZW + (lx + 0.5) * TILE_W, y: sy * ZH + (ly + 0.5) * TILE_H,
          sector: { x: sx, y: sy }, square: { x: Math.round(lx), y: Math.round(ly) },
          region: region(sx, sy), text: searchable(`${name} ${region(sx, sy)}`),
        });
      }
    }
  }

  // Regions: each connected run of sectors sharing a name.
  const seen = new Set<string>();
  for (let sx = 0; sx < scen.outWidth; sx++) {
    for (let sy = 0; sy < scen.outHeight; sy++) {
      const name = region(sx, sy);
      const land = landOf(sx, sy);
      if (!name || !land || seen.has(`${sx},${sy}`)) continue;
      const run: [number, number][] = [];
      const todo: [number, number][] = [[sx, sy]];
      seen.add(`${sx},${sy}`);
      while (todo.length) {
        const [x, y] = todo.pop()!;
        run.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (landOf(nx, ny) !== land) continue;
          if (seen.has(`${nx},${ny}`) || region(nx, ny) !== name) continue;
          seen.add(`${nx},${ny}`);
          todo.push([nx, ny]);
        }
      }
      const cx = run.reduce((a, [x]) => a + x, 0) / run.length;
      const cy = run.reduce((a, [, y]) => a + y, 0) / run.length;
      out.push({
        kind: 'region', name, land: land.id, x: (cx + 0.5) * ZW, y: (cy + 0.5) * ZH,
        sector: { x: Math.round(cx), y: Math.round(cy) }, square: { x: 24, y: 24 },
        region: name, text: searchable(name),
      });
    }
  }
  return out;
}

// --- the tile pyramid ---------------------------------------------------------

/** Sizes a sector is drawn at, largest first: 1, ¼, ⅛. */
const LODS = [1, 4, 8] as const;
const CACHE_LIMIT: Record<number, number> = { 1: 12, 4: 48 };

class Pyramid {
  private readonly caches = new Map<number, Map<string, HTMLCanvasElement>>(LODS.map((l) => [l, new Map()]));
  /** The terrains a road reaches into: Exile III's own list (`road-joins`). */
  private readonly roadJoins: Set<number>;

  constructor(private scen: Scenario, private store: SheetStore) {
    this.roadJoins = new Set((scen.featureFlags['road-joins'] ?? '').split(',').filter((n) => n)
      .map((n) => parseInt(n, 10)));
  }

  /**
   * `extend_road_terrain`, as the game's screen has it (`extendRoad`): a road
   * reaches into a neighbour that is road, or a terrain on the join list.
   * Across sector edges too, and off the edge of the world.
   */
  private roadReaches(wx: number, wy: number): boolean {
    const sx = Math.floor(wx / SECTOR_SIZE);
    const sy = Math.floor(wy / SECTOR_SIZE);
    const sec = this.scen.outdoors[sx]?.[sy];
    if (!sec) return true;
    const x = wx - sx * SECTOR_SIZE;
    const y = wy - sy * SECTOR_SIZE;
    return (sec.roads[x]?.[y] ?? false) || this.roadJoins.has(sec.terrain[x]?.[y] ?? -1);
  }

  /** `place_road`: the centre, and a stub toward each neighbour it reaches. */
  private drawRoad(ctx: CanvasRenderingContext2D, fields: ImageBitmap, wx: number, wy: number, px: number, py: number): void {
    const blit = (src: typeof ROAD_SRC.centre, dest: typeof ROAD_DEST.centre): void => {
      ctx.drawImage(fields, src.left, src.top, src.right - src.left, src.bottom - src.top,
        px + dest.left, py + dest.top, dest.right - dest.left, dest.bottom - dest.top);
    };
    blit(ROAD_SRC.centre, ROAD_DEST.centre);
    if (this.roadReaches(wx, wy - 1)) blit(ROAD_SRC.vertical, ROAD_DEST.top);
    if (this.roadReaches(wx + 1, wy)) blit(ROAD_SRC.horizontal, ROAD_DEST.right);
    if (this.roadReaches(wx, wy + 1)) blit(ROAD_SRC.vertical, ROAD_DEST.bottom);
    if (this.roadReaches(wx - 1, wy)) blit(ROAD_SRC.horizontal, ROAD_DEST.left);
  }

  /** A sector at full size, from its terrain pictures (animation frame 0). */
  private renderFull(sx: number, sy: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = ZW;
    c.height = ZH;
    const ctx = c.getContext('2d')!;
    const sec = this.scen.outdoors[sx]![sy]!;
    for (let x = 0; x < SECTOR_SIZE; x++) {
      for (let y = 0; y < SECTOR_SIZE; y++) {
        const ter = this.scen.terTypes[sec.terrain[x]![y]!];
        const g = ter && terrainGraphic(ter.picture);
        const img = g && this.store.get(g.sheetName);
        if (!g || !img) continue;
        const r = g.rect;
        ctx.drawImage(img, r.left, r.top, r.width, r.height, x * TILE_W, y * TILE_H, TILE_W, TILE_H);
      }
    }
    // Roads over the terrain, as the game lays them.
    const fields = this.store.get('fields');
    if (fields) {
      for (let x = 0; x < SECTOR_SIZE; x++) {
        for (let y = 0; y < SECTOR_SIZE; y++) {
          if (!sec.roads[x]![y]) continue;
          this.drawRoad(ctx, fields, sx * SECTOR_SIZE + x, sy * SECTOR_SIZE + y, x * TILE_W, y * TILE_H);
        }
      }
    }
    return c;
  }

  private shrink(src: HTMLCanvasElement, lod: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.round(ZW / lod);
    c.height = Math.round(ZH / lod);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  has(sx: number, sy: number, lod: number): boolean {
    return this.caches.get(lod)!.has(`${sx},${sy}`);
  }

  /** The sector at `lod`, drawing it now if it isn't cached. */
  get(sx: number, sy: number, lod: number): HTMLCanvasElement {
    const key = `${sx},${sy}`;
    const cache = this.caches.get(lod)!;
    const hit = cache.get(key);
    if (hit) {
      // Most recently used goes last.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const full = lod === 1 ? this.renderFull(sx, sy) : (this.caches.get(1)!.get(key) ?? this.renderFull(sx, sy));
    const made = lod === 1 ? full : this.shrink(full, lod);
    cache.set(key, made);
    // Keep what a full render cost for the other sizes while we have it.
    if (lod !== 1 && !this.caches.get(1)!.has(key)) this.caches.get(1)!.set(key, full);
    for (const [l, c] of this.caches) {
      const limit = CACHE_LIMIT[l];
      if (limit === undefined) continue;
      while (c.size > limit) c.delete(c.keys().next().value!);
    }
    return made;
  }

  /** The best size cached for a sector at or below `lod`'s detail, or null. */
  fallback(sx: number, sy: number, lod: number): { img: HTMLCanvasElement; lod: number } | null {
    for (const l of LODS) {
      if (l < lod) continue;
      const img = this.caches.get(l)!.get(`${sx},${sy}`);
      if (img) return { img, lod: l };
    }
    return null;
  }
}

// --- the page ---------------------------------------------------------------

async function main(): Promise<void> {
  installBackdrop();
  const root = document.getElementById('map-root')!;
  const canvas = el('canvas', 'map-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Map of Valorim. Drag to move, scroll or pinch to zoom.');
  root.append(canvas);

  const loading = el('div', 'map-loading card');
  const what = el('span', undefined, 'Loading…');
  const bar = el('div', 'progress');
  const fill = el('div');
  bar.append(fill);
  loading.append(el('strong', 'map-loading-title', 'Map of Valorim'), what, bar);
  root.append(loading);
  const status = (w: string, done?: number): void => {
    what.textContent = done !== undefined && done > 0 && done < 1 ? `${w} ${Math.round(done * 100)}%` : w;
    if (done !== undefined) fill.style.width = `${Math.round(done * 100)}%`;
  };

  let e3;
  try {
    e3 = await loadExile3(['ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim', 'fields'], status);
  } catch (e) {
    what.textContent = `Exile III could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    what.className = 'problem';
    bar.remove();
    return;
  }
  const { scen, store } = e3;
  const pyramid = new Pyramid(scen, store);

  // The overview: every sector at ⅛, a few a frame.
  const total = scen.outWidth * scen.outHeight;
  for (let i = 0; i < total; i++) {
    const sx = Math.floor(i / scen.outHeight);
    const sy = i % scen.outHeight;
    if (landOf(sx, sy)) pyramid.get(sx, sy, 8);
    if (i % 6 === 5) {
      status('Drawing the world…', i / total);
      await new Promise(requestAnimationFrame);
    }
  }
  loading.remove();

  new MapView(root, canvas, scen, pyramid, collectPlaces(scen));
}

class MapView {
  private readonly ctx: CanvasRenderingContext2D;
  /** The land on show, and its bounds in world pixels. */
  private land: Land = LANDS[0]!;
  private landButtons: HTMLButtonElement[] = [];
  /** The world pixel at the canvas's centre, and CSS pixels per world pixel. */
  private cx: number;
  private cy: number;
  private s = 0.05;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private queued = false;
  private selected: Place | null = null;
  private pulseStart = 0;
  private hits: { p: Place; x: number; y: number; w: number; h: number }[] = [];
  private flight: { from: [number, number, number]; to: [number, number, number]; t0: number; ms: number } | null = null;
  private readonly card: HTMLElement;
  private readonly readout: HTMLElement;
  private hashTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly scen: Scenario,
    private readonly pyramid: Pyramid,
    private readonly places: Place[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.cx = this.left + this.width / 2;
    this.cy = this.top + this.height / 2;

    const chrome = this.buildChrome();
    root.append(chrome.search, chrome.zoom);
    this.card = chrome.card;
    this.readout = chrome.readout;
    root.append(this.card, this.readout);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    if (!this.readHash()) this.fit();
    this.bindInput();
    window.addEventListener('hashchange', () => { if (this.readHash()) this.draw(); });
  }

  // --- geometry ---

  private get left(): number { return this.land.x0 * ZW; }
  private get top(): number { return this.land.y0 * ZH; }
  private get width(): number { return (this.land.x1 - this.land.x0 + 1) * ZW; }
  private get height(): number { return (this.land.y1 - this.land.y0 + 1) * ZH; }

  private minScale(): number {
    return Math.min(this.cssW / this.width, this.cssH / this.height) * 0.9;
  }

  private clamp(): void {
    this.s = Math.max(this.minScale(), Math.min(MAX_SCALE, this.s));
    // Keep some of the land on screen.
    this.cx = Math.max(this.left, Math.min(this.left + this.width, this.cx));
    this.cy = Math.max(this.top, Math.min(this.top + this.height, this.cy));
  }

  /** Show another land, fitted to the screen unless `fit` is false. */
  private setLand(land: Land, fit = true): void {
    if (land !== this.land) this.select(null, false);
    this.land = land;
    for (const b of this.landButtons) {
      const on = b.dataset['land'] === land.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (fit) this.fit();
  }

  private toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cx) * this.s + this.cssW / 2, (wy - this.cy) * this.s + this.cssH / 2];
  }

  private toWorld(px: number, py: number): [number, number] {
    return [(px - this.cssW / 2) / this.s + this.cx, (py - this.cssH / 2) / this.s + this.cy];
  }

  private zoomAt(px: number, py: number, factor: number): void {
    const [wx, wy] = this.toWorld(px, py);
    this.s *= factor;
    this.clamp();
    // Keep the world point under the cursor where it was.
    this.cx = wx - (px - this.cssW / 2) / this.s;
    this.cy = wy - (py - this.cssH / 2) / this.s;
    this.clamp();
    this.draw();
  }

  private fit(): void {
    this.flight = null;
    this.s = this.minScale();
    this.cx = this.left + this.width / 2;
    this.cy = this.top + this.height / 2;
    this.draw();
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.clamp();
    this.draw();
  }

  // --- the URL: #land@x,y,zoom in squares, and the chosen place ---

  private writeHash(): void {
    clearTimeout(this.hashTimer);
    this.hashTimer = window.setTimeout(() => {
      const tx = (this.cx / TILE_W).toFixed(1);
      const ty = (this.cy / TILE_H).toFixed(1);
      const sel = this.selected ? `,${encodeURIComponent(this.selected.name)}` : '';
      history.replaceState(null, '', `#${this.land.id}@${tx},${ty},${this.s.toFixed(3)}${sel}`);
    }, 250);
  }

  private readHash(): boolean {
    const [landId, view = ''] = location.hash.slice(1).split('@');
    const land = LANDS.find((l) => l.id === landId);
    if (!land) return false;
    this.setLand(land, false);
    const [x, y, s, ...name] = view.split(',');
    if (x === undefined || y === undefined || s === undefined) {
      this.fit();
      return true;
    }
    const [nx, ny, ns] = [Number(x), Number(y), Number(s)];
    if (![nx, ny, ns].every(Number.isFinite)) return false;
    this.cx = nx * TILE_W;
    this.cy = ny * TILE_H;
    this.s = ns;
    this.clamp();
    if (name.length) {
      const want = decodeURIComponent(name.join(','));
      const p = this.places.find((q) => q.name === want && Math.hypot(q.x - this.cx, q.y - this.cy) < ZW * 2)
        ?? this.places.find((q) => q.name === want);
      if (p) this.select(p, false);
    }
    return true;
  }

  // --- drawing ---

  private draw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame((now) => {
      this.queued = false;
      this.frame(now);
    });
  }

  private frame(now: number): void {
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.t0) / f.ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      // Zoom in log space, so the flight feels even.
      const ls = Math.log(f.from[2]) + (Math.log(f.to[2]) - Math.log(f.from[2])) * e;
      this.s = Math.exp(ls);
      this.cx = f.from[0] + (f.to[0] - f.from[0]) * e;
      this.cy = f.from[1] + (f.to[1] - f.from[1]) * e;
      if (t >= 1) this.flight = null;
    }
    const { ctx, dpr, s } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // The sectors in view, from the smallest size that holds up.
    const lod = s >= 0.3 ? 1 : s >= 0.1 ? 4 : 8;
    ctx.imageSmoothingEnabled = s * lod < 1;
    ctx.imageSmoothingQuality = 'high';
    const [wx0, wy0] = this.toWorld(0, 0);
    const [wx1, wy1] = this.toWorld(this.cssW, this.cssH);
    const sx0 = Math.max(this.land.x0, Math.floor(wx0 / ZW));
    const sy0 = Math.max(this.land.y0, Math.floor(wy0 / ZH));
    const sx1 = Math.min(this.land.x1, Math.floor(wx1 / ZW));
    const sy1 = Math.min(this.land.y1, Math.floor(wy1 / ZH));
    const budget = performance.now() + 12;
    let behind = false;
    for (let sx = sx0; sx <= sx1; sx++) {
      for (let sy = sy0; sy <= sy1; sy++) {
        let img: HTMLCanvasElement | null = null;
        if (this.pyramid.has(sx, sy, lod) || performance.now() < budget) img = this.pyramid.get(sx, sy, lod);
        else {
          behind = true;
          img = this.pyramid.fallback(sx, sy, lod)?.img ?? null;
        }
        if (!img) continue;
        const [dx, dy] = this.toScreen(sx * ZW, sy * ZH);
        // A hair over a sector, so no seam shows between neighbours.
        ctx.drawImage(img, dx, dy, ZW * s + 0.5, ZH * s + 0.5);
      }
    }
    // Sector lines, faint, once they are big enough to help.
    if (s >= 0.04) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const [lx0, ly0] = this.toScreen(this.left, this.top);
      const [lx1, ly1] = this.toScreen(this.left + this.width, this.top + this.height);
      for (let sx = this.land.x0; sx <= this.land.x1 + 1; sx++) {
        const [x] = this.toScreen(sx * ZW, 0);
        ctx.moveTo(Math.round(x) + 0.5, ly0);
        ctx.lineTo(Math.round(x) + 0.5, ly1);
      }
      for (let sy = this.land.y0; sy <= this.land.y1 + 1; sy++) {
        const [, y] = this.toScreen(0, sy * ZH);
        ctx.moveTo(lx0, Math.round(y) + 0.5);
        ctx.lineTo(lx1, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }

    this.drawLabels(now);
    this.positionCard();
    if (behind || this.flight || this.selected) this.draw();
    this.writeHash();
  }

  private drawLabels(now: number): void {
    const { ctx, s } = this;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    this.hits = [];
    const overlaps = (r: { x: number; y: number; w: number; h: number }): boolean =>
      placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    const onScreen = (x: number, y: number): boolean => x > -200 && y > -50 && x < this.cssW + 200 && y < this.cssH + 50;

    const label = (p: Place, font: string, fill: string, halo: string, dy: number, force = false): boolean => {
      const [x, y] = this.toScreen(p.x, p.y);
      if (!onScreen(x, y)) return false;
      ctx.font = font;
      const w = ctx.measureText(p.name).width;
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '12');
      const r = { x: x - w / 2 - 3, y: y + dy - size / 2 - 2, w: w + 6, h: size + 4 };
      if (!force && overlaps(r)) return false;
      placed.push(r);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = halo;
      ctx.strokeText(p.name, x, y + dy);
      ctx.fillStyle = fill;
      ctx.fillText(p.name, x, y + dy);
      this.hits.push({ p, ...r });
      return true;
    };

    // The chosen one first, so nothing hides it.
    const sel = this.selected;
    if (sel) {
      const [x, y] = this.toScreen(sel.x, sel.y);
      const t = ((now - this.pulseStart) % 1600) / 1600;
      ctx.beginPath();
      ctx.arc(x, y, 8 + 22 * t, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120, 220, 255, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      this.pin(x, y, '#78dcff', 7);
      label(sel, sel.kind === 'region' ? '22px BoEDungeon, Georgia, serif' : 'bold 15px system-ui, sans-serif',
        '#78dcff', '#000', sel.kind === 'town' ? -16 : 0, true);
    }

    const here = this.places.filter((p) => p.land === this.land.id && p !== sel);
    // Towns: a pin always, the name when there's room — capitals first, in
    // gold. A stray exit is a small red ring, named only close up.
    const towns = here.filter((p) => p.kind === 'town' && !p.stray)
      .sort((a, b) => Number(b.capital ?? false) - Number(a.capital ?? false));
    const strays = here.filter((p) => p.stray);
    for (const p of towns) {
      const [x, y] = this.toScreen(p.x, p.y);
      const r = (s < 0.06 ? 3 : 4.5) + (p.capital ? 1.5 : 0);
      if (onScreen(x, y)) this.pin(x, y, p.capital ? CAPITAL : '#f4f4f4', r);
    }
    for (const p of strays) {
      const [x, y] = this.toScreen(p.x, p.y);
      if (!onScreen(x, y) || s < 0.06) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = STRAY;
      ctx.stroke();
    }
    const regions = (): void => {
      if (s >= 0.2) return;
      const size = Math.round(Math.max(14, Math.min(24, s * 330)));
      for (const p of here) {
        if (p.kind === 'region') {
          label(p, `${size}px BoEDungeon, Georgia, serif`, 'rgba(255,255,255,0.8)', 'rgba(0,0,0,0.75)', 0);
        }
      }
    };
    // The capitals always win their place. Then, zoomed right out, the
    // regions are the map; closer in, the other towns are.
    const townFont = `bold ${s < 0.06 ? 11 : 13}px system-ui, sans-serif`;
    const capitalFont = `bold ${s < 0.06 ? 13 : 15}px system-ui, sans-serif`;
    for (const p of towns) if (p.capital) label(p, capitalFont, CAPITAL, 'rgba(0,0,0,0.95)', -14);
    const zoomedOut = s < 0.07;
    if (zoomedOut) regions();
    for (const p of towns) if (!p.capital) label(p, townFont, '#fff', 'rgba(0,0,0,0.9)', -13);
    if (s >= 0.2) for (const p of strays) label(p, 'italic 11px system-ui, sans-serif', '#ffb3a8', 'rgba(0,0,0,0.9)', -12);
    // Places once zoomed in a little.
    if (s >= 0.09) {
      for (const p of here) {
        if (p.kind === 'place') label(p, 'italic 12px Georgia, serif', '#f3e7c4', 'rgba(0,0,0,0.85)', 0);
      }
    }
    if (!zoomedOut) regions();
  }

  private pin(x: number, y: number, fill: string, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  // --- choosing ---

  private select(p: Place | null, fly = true): void {
    this.selected = p;
    this.pulseStart = performance.now();
    if (p && fly) {
      const want = p.kind === 'region' ? Math.max(this.minScale(), 0.07) : p.kind === 'place' ? 0.35 : 0.6;
      this.flight = {
        from: [this.cx, this.cy, this.s], to: [p.x, p.y, Math.max(this.s, want)],
        t0: performance.now(), ms: 700,
      };
    }
    this.fillCard();
    this.draw();
  }

  private fillCard(): void {
    const p = this.selected;
    this.card.hidden = !p;
    this.card.replaceChildren();
    if (!p) return;
    const close = el('button', 'map-card-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.select(null));
    const kind = p.stray ? 'A stray town exit' : p.kind === 'town' ? (p.capital ? 'Capital' : 'Town')
      : p.kind === 'place' ? 'Place' : 'Region';
    this.card.append(close, el('h2', undefined, p.name), el('div', 'map-card-kind', kind));
    if (p.stray) {
      this.card.append(el('p', 'map-card-note', p.sector.x === 4 && p.sector.y === 0
        ? 'Exile III left town 0 on the army camp’s towers, and stepping onto one really does enter Krizsan. '
          + 'E3-SUSPECTED-BUGS.md #10.'
        : 'Exile III left town 0 on this hut. Trees ring it and a spot that blocks guards the one way in, '
          + 'so no party reaches it. E3-SUSPECTED-BUGS.md #10.'));
    }
    const dl = el('dl');
    const row = (k: string, v: string): void => { dl.append(el('dt', undefined, k), el('dd', undefined, v)); };
    if (p.kind !== 'region' && p.region) row('Region', p.region);
    if (p.town !== undefined) row('Town number', String(p.town));
    if (p.gates && p.gates > 1) row('Entrances', String(p.gates));
    if (p.kind !== 'region') {
      row('Sector', `${p.sector.x}, ${p.sector.y}`);
      row('Square', `${p.square.x}, ${p.square.y}`);
    }
    if (p.kind === 'town') {
      const elsewhere = this.places.filter((q) => q.kind === 'town' && !q.stray && q.town === p.town && q !== p);
      if (elsewhere.length) {
        row(p.stray ? 'The town’s own gate' : 'Also entered at',
          elsewhere.map((q) => `sector ${q.sector.x}, ${q.sector.y}`).join('; '));
      }
    }
    this.card.append(dl);
  }

  private positionCard(): void {
    // The card sits by its place on a wide screen, and at the foot on a phone.
    const p = this.selected;
    if (!p || this.card.hidden || this.cssW < 640) {
      this.card.style.left = '';
      this.card.style.top = '';
      return;
    }
    const [x, y] = this.toScreen(p.x, p.y);
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    // Clear of the label, which is centred on the place.
    const left = Math.max(12, Math.min(this.cssW - w - 12, x + 64));
    const top = Math.max(124, Math.min(this.cssH - h - 12, y - h / 2));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  // --- input ---

  private bindInput(): void {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; mx: number; my: number } | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      pointers.set(e.pointerId, { x, y });
      moved = 0;
      this.flight = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') this.showReadout(x, y);
        return;
      }
      const last = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.cx -= (mx - pinch.mx) / this.s;
        this.cy -= (my - pinch.my) / this.s;
        this.zoomAt(mx, my, d / Math.max(1, pinch.d));
        pinch = { d, mx, my };
        moved += 10;
        return;
      }
      if (pointers.size === 1) {
        moved += Math.abs(x - last.x) + Math.abs(y - last.y);
        this.cx -= (x - last.x) / this.s;
        this.cy -= (y - last.y) / this.s;
        this.clamp();
        this.draw();
      }
    });
    const end = (e: PointerEvent): void => {
      const was = pointers.size;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (was === 1 && moved < 6 && e.type === 'pointerup') {
        const [x, y] = local(e);
        const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
        this.select(hit ? hit.p : this.nearestTown(x, y), false);
        if (e.pointerType !== 'mouse') this.showReadout(x, y);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.readout.hidden = true; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.flight = null;
      const [x, y] = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this.zoomAt(x, y, Math.exp((-e.deltaY * unit) * 0.0018));
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const [x, y] = local(e);
      this.zoomAt(x, y, 2);
    });
    c.addEventListener('keydown', (e) => {
      const step = 80 / this.s;
      const keys: Record<string, () => void> = {
        '+': () => this.zoomAt(this.cssW / 2, this.cssH / 2, 1.5),
        '=': () => this.zoomAt(this.cssW / 2, this.cssH / 2, 1.5),
        '-': () => this.zoomAt(this.cssW / 2, this.cssH / 2, 1 / 1.5),
        ArrowLeft: () => { this.cx -= step; },
        ArrowRight: () => { this.cx += step; },
        ArrowUp: () => { this.cy -= step; },
        ArrowDown: () => { this.cy += step; },
        Escape: () => this.select(null),
      };
      const k = keys[e.key];
      if (!k) return;
      e.preventDefault();
      k();
      this.clamp();
      this.draw();
    });
  }

  private nearestTown(x: number, y: number): Place | null {
    let best: Place | null = null;
    let bestD = 14;
    for (const p of this.places) {
      if (p.kind !== 'town' || p.land !== this.land.id) continue;
      const [px, py] = this.toScreen(p.x, p.y);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Where the pointer is, in the game's own terms — handy when hunting bugs. */
  private showReadout(x: number, y: number): void {
    const [wx, wy] = this.toWorld(x, y);
    const tx = Math.floor(wx / TILE_W);
    const ty = Math.floor(wy / TILE_H);
    const sx = Math.floor(tx / SECTOR_SIZE);
    const sy = Math.floor(ty / SECTOR_SIZE);
    const sec = this.scen.outdoors[sx]?.[sy];
    if (!sec || tx < 0 || ty < 0 || landOf(sx, sy) !== this.land) {
      this.readout.hidden = true;
      return;
    }
    const lx = tx - sx * SECTOR_SIZE;
    const ly = ty - sy * SECTOR_SIZE;
    const t = sec.terrain[lx]?.[ly] ?? 0;
    const ter = this.scen.terTypes[t];
    this.readout.hidden = false;
    this.readout.textContent = `${sec.name || 'Sector'} (${sx}, ${sy}) · square ${lx}, ${ly} · ` +
      `terrain ${t}${ter?.name ? ` ${ter.name}` : ''}`;
  }

  // --- the search box, zoom buttons, card ---

  private buildChrome(): { search: HTMLElement; zoom: HTMLElement; card: HTMLElement; readout: HTMLElement } {
    const search = el('div', 'map-search');
    const back = el('a', 'map-home', 'Exile III');
    back.href = import.meta.env.BASE_URL;
    back.title = 'Play the game';
    const box = el('div', 'map-search-box');
    const input = el('input', 'map-search-input');
    input.type = 'search';
    input.placeholder = 'Search towns and places';
    input.setAttribute('aria-label', 'Search towns and places');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'map-results');
    input.setAttribute('aria-expanded', 'false');
    input.autocomplete = 'off';
    const list = el('ul', 'map-results');
    list.id = 'map-results';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    box.append(input);
    // Which land is on show: one at a time, as the game has them.
    const lands = el('div', 'map-lands');
    lands.setAttribute('role', 'group');
    lands.setAttribute('aria-label', 'Land shown');
    this.landButtons = LANDS.map((l) => {
      const b = el('button', l === this.land ? 'on' : undefined, l.label);
      b.type = 'button';
      b.dataset['land'] = l.id;
      b.setAttribute('aria-pressed', String(l === this.land));
      b.addEventListener('click', () => this.setLand(l));
      return b;
    });
    lands.append(...this.landButtons);
    search.append(back, box, lands, list);

    const kindRank: Record<Kind, number> = { town: 0, place: 1, region: 2 };
    let results: Place[] = [];
    let active = 0;
    const regionsSeen = (ps: Place[]): Place[] => {
      // One entry per region name.
      const seen = new Set<string>();
      return ps.filter((p) => p.kind !== 'region' || (!seen.has(p.name) && (seen.add(p.name), true)));
    };
    const render = (): void => {
      list.replaceChildren(...results.map((p, i) => {
        const li = el('li', i === active ? 'active' : undefined);
        li.id = `map-result-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.append(el('span', `map-result-icon ${p.kind}`), el('span', 'map-result-name', p.name),
          el('span', 'map-result-where', [p.kind === 'region' ? 'Region' : p.region,
            p.land !== this.land.id ? LANDS.find((l) => l.id === p.land)?.label : '']
            .filter((w) => w).join(' · ')));
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          choose(p);
        });
        return li;
      }));
      list.hidden = results.length === 0;
      input.setAttribute('aria-expanded', String(!list.hidden));
      if (!list.hidden) input.setAttribute('aria-activedescendant', `map-result-${active}`);
      else input.removeAttribute('aria-activedescendant');
    };
    const find = (): void => {
      const q = searchable(input.value);
      if (!q) {
        results = [];
        render();
        return;
      }
      const words = q.split(' ');
      results = regionsSeen(this.places
        .filter((p) => words.every((w) => p.text.includes(w)))
        .sort((a, b) => {
          const pa = searchable(a.name).startsWith(q) ? 0 : 1;
          const pb = searchable(b.name).startsWith(q) ? 0 : 1;
          return pa - pb || kindRank[a.kind] - kindRank[b.kind] || a.name.localeCompare(b.name);
        })).slice(0, 8);
      active = 0;
      render();
    };
    const choose = (p: Place): void => {
      input.value = p.name;
      results = [];
      render();
      input.blur();
      // A place in another land shows that land first, then flies there.
      const land = LANDS.find((l) => l.id === p.land);
      if (land && land !== this.land) this.setLand(land);
      this.select(p);
    };
    input.addEventListener('input', find);
    input.addEventListener('focus', find);
    input.addEventListener('blur', () => { results = []; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!results.length) return;
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        render();
      } else if (e.key === 'Enter') {
        const p = results[active];
        if (p) {
          e.preventDefault();
          choose(p);
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        results = [];
        render();
      }
    });
    // "/" jumps to the search box, as on many maps.
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    });

    const zoom = el('div', 'map-zoom');
    const button = (text: string, label: string, go: () => void): HTMLButtonElement => {
      const b = el('button', undefined, text);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', go);
      return b;
    };
    zoom.append(
      button('+', 'Zoom in', () => this.zoomAt(this.cssW / 2, this.cssH / 2, 1.6)),
      button('−', 'Zoom out', () => this.zoomAt(this.cssW / 2, this.cssH / 2, 1 / 1.6)),
      button('⤢', 'Show the whole land', () => this.fit()),
    );

    const card = el('aside', 'map-card');
    card.hidden = true;
    const readout = el('div', 'map-readout');
    readout.hidden = true;
    return { search, zoom, card, readout };
  }
}

void main();
