/**
 * The pop-out map: the automap, big, in a window of its own. The original
 * has nothing like it. OBoE's map is a small OS window and the browser port
 * draws it on the desktop (`mapScreen.ts`). This one is for a second tab or
 * a second monitor. Outdoors it shows the whole continent, not a 40-square
 * window, and it labels the towns and named areas the party has found.
 *
 * It only shows what the automap could. A square appears once it's explored,
 * a town is named only if the party can find it and has seen its entrance,
 * and a hidden town's entrance is drawn as the terrain `erase_hidden_towns`
 * swaps in (boe.town.cpp:1256), so the map spoils nothing.
 *
 * This file is shared by both sides. The game tab builds a `MapSnapshot`
 * (`WorldMapFeed`) and posts it on a BroadcastChannel. The map tab
 * (`platform/mapWindow.ts`) draws it. A snapshot is a grid of palette indices
 * plus a palette of 12px map squares, sent only when a new terrain type turns
 * up. Each step costs a few tens of kilobytes rather than a picture of the
 * continent.
 */

import { TerSpec, Terrain } from '../data/terrain';
import { SECTOR_SIZE } from '../data/outdoors';
import { GameMode } from '../game/modes';
import { GameSession } from '../game/session';
import { PartyStatus } from '../universe/skills';
import { drawMapTile, drawRoadStub } from './mapScreen';
import { SheetStore } from './sheets';

export const MAP_CHANNEL = 'exile-js:map';
/** The size of one square in the palette: the map sheets' own size. */
export const WORLD_TILE = 12;
/** Palette squares per row. */
export const PALETTE_COLS = 32;
/** Palette index 0 is an unexplored square and 1 is the road stub. */
export const PAL_UNEXPLORED = 0;
export const PAL_ROAD = 1;
const PAL_FIRST_TERRAIN = 2;

export interface MapLabel {
  text: string;
  /** In squares, the label's centre. */
  x: number;
  y: number;
  /** A town entrance, a named area, or a whole outdoor sector. */
  kind: 'town' | 'area' | 'sector';
}

export interface MapSnapshot {
  type: 'snapshot';
  /** Which game tab sent it (`WorldMapFeed.gameId`). */
  game: string;
  scenario: string;
  /** "Outdoors", or the town's name. */
  place: string;
  /** Set when there's no map to show: "No map in combat." and the like. */
  note: string | null;
  /** The grid, in squares. */
  w: number;
  h: number;
  /** A palette index per square, row by row. */
  cells: Uint16Array;
  /** 1 where a road stub goes. */
  roads: Uint8Array;
  paletteVersion: number;
  /** Sent when `paletteVersion` changes; the map tab keeps the last one. */
  palette?: ImageData;
  party: { x: number; y: number } | null;
  /** Detect Life's markers, in town. */
  life: { x: number; y: number }[];
  labels: MapLabel[];
}

/**
 * From the map tab: send everything, palette included. `game` names the game
 * tab it belongs to. A map tab opened by hand has none, and pairs with the
 * first game that answers.
 */
export interface MapHello { type: 'hello'; game?: string }
/** From the game tab when it starts, so an open map tab says hello again. */
export interface MapReady { type: 'ready'; game: string }
/**
 * From a game tab that already has the id a newly started one announced.
 * Duplicating a tab copies its sessionStorage, id and all, so the newcomer
 * takes a fresh one.
 */
export interface MapTaken { type: 'taken'; game: string }
export type MapMessage = MapSnapshot | MapHello | MapReady | MapTaken;

/** The map as terrain types, before they're turned into palette indices. */
interface MapGrid {
  place: string;
  note: string | null;
  w: number;
  h: number;
  /** A terrain type per square, or -1 where unexplored. */
  terrain: Int32Array;
  roads: Uint8Array;
  party: { x: number; y: number } | null;
  life: { x: number; y: number }[];
  labels: MapLabel[];
}

function emptyGrid(place: string, note: string): MapGrid {
  return {
    place, note, w: 0, h: 0, terrain: new Int32Array(0), roads: new Uint8Array(0),
    party: null, life: [], labels: [],
  };
}

/** The whole continent, or the whole town, as the party knows it. */
export function buildMapGrid(session: GameSession): MapGrid {
  const univ = session.univ;
  const arena = session.mode === GameMode.COMBAT && session.whichCombatType === 0;
  if (arena) return emptyGrid('Outdoors', 'No map in combat.');
  // The same test the automap uses, so talking or shopping outdoors still
  // shows the continent.
  const outMode = session.isOutdoors;
  // The markers are skipped in combat and while talking or shopping, as
  // `draw_map` skips them.
  const showParty = session.mode !== GameMode.COMBAT && !session.talk && !session.shop;
  return outMode ? outdoorGrid(session, showParty) : townGrid(session, showParty);
}

function outdoorGrid(session: GameSession, showParty: boolean): MapGrid {
  const univ = session.univ;
  const scen = univ.scenario;
  const party = univ.party;
  const w = scen.outWidth * SECTOR_SIZE;
  const h = scen.outHeight * SECTOR_SIZE;
  const terrain = new Int32Array(w * h).fill(-1);
  const roads = new Uint8Array(w * h);
  const labels: MapLabel[] = [];
  const entrances: { spec: number; name: string; x: number; y: number }[] = [];
  const corner = party.outdoorCorner;
  const explored = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x]! >= 0;

  for (let sx = 0; sx < scen.outWidth; sx++) {
    for (let sy = 0; sy < scen.outHeight; sy++) {
      const sector = scen.outdoors[sx]![sy]!;
      // The 2×2 block the party is in is live in `univ.out`, with this
      // session's explored squares and altered terrain. The rest are as
      // `save_outdoor_maps` last folded them back.
      const wx = sx - corner.x;
      const wy = sy - corner.y;
      const live = wx >= 0 && wx <= 1 && wy >= 0 && wy <= 1;
      for (let i = 0; i < SECTOR_SIZE; i++) {
        for (let j = 0; j < SECTOR_SIZE; j++) {
          const at = (sy * SECTOR_SIZE + j) * w + sx * SECTOR_SIZE + i;
          if (live) {
            const ox = wx * SECTOR_SIZE + i;
            const oy = wy * SECTOR_SIZE + j;
            if (univ.out.explored[ox]![oy]! === 0) continue;
            terrain[at] = univ.out.at(ox, oy);
            roads[at] = univ.out.isRoad(ox, oy) ? 1 : 0;
          } else {
            if (sector.maps[i]![j]! === 0) continue;
            terrain[at] = sector.terrain[i]![j]!;
            roads[at] = sector.roads[i]![j]! ? 1 : 0;
          }
        }
      }
      for (const city of sector.cityLocs) {
        if (city.x < 0 || city.y < 0 || city.x >= SECTOR_SIZE || city.y >= SECTOR_SIZE) continue;
        const gx = sx * SECTOR_SIZE + city.x;
        const gy = sy * SECTOR_SIZE + city.y;
        const at = gy * w + gx;
        if (terrain[at]! < 0) continue;
        const town = scen.towns[city.spec];
        if (!town) continue;
        const spec = univ.terrainType(terrain[at]!);
        // erase_hidden_towns, for sectors outside the live window. Inside it
        // the swap has already been made on `univ.out`.
        if (!town.canFind) {
          if (!live && spec.special === TerSpec.TOWN_ENTRANCE) terrain[at] = spec.flag1;
          continue;
        }
        entrances.push({ spec: city.spec, name: town.name, x: gx + 0.5, y: gy + 0.5 });
      }
      let anyExplored = false;
      for (let i = 0; i < SECTOR_SIZE && !anyExplored; i++) {
        for (let j = 0; j < SECTOR_SIZE && !anyExplored; j++) {
          anyExplored = explored(sx * SECTOR_SIZE + i, sy * SECTOR_SIZE + j);
        }
      }
      if (!anyExplored) continue;
      if (sector.name.trim() !== '') {
        labels.push({
          text: sector.name.trim(), x: (sx + 0.5) * SECTOR_SIZE, y: (sy + 0.5) * SECTOR_SIZE, kind: 'sector',
        });
      }
      for (const area of sector.areaDesc) {
        const text = area.descr.trim();
        if (text === '' || text === sector.name.trim()) continue;
        if (!rectExplored(area, (x, y) => explored(sx * SECTOR_SIZE + x, sy * SECTOR_SIZE + y))) continue;
        labels.push({
          text,
          x: sx * SECTOR_SIZE + (area.left + area.right + 1) / 2,
          y: sy * SECTOR_SIZE + (area.top + area.bottom + 1) / 2,
          kind: 'area',
        });
      }
    }
  }
  labels.push(...townLabels(entrances));
  const party0 = showParty
    ? { x: corner.x * SECTOR_SIZE + party.outLoc.x, y: corner.y * SECTOR_SIZE + party.outLoc.y }
    : null;
  return { place: 'Outdoors', note: null, w, h, terrain, roads, party: party0, life: [], labels };
}

function townGrid(session: GameSession, showParty: boolean): MapGrid {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return emptyGrid('', 'No map here.');
  const record = town.record;
  if (record.defyMapping) return emptyGrid(record.name, 'This place defies mapping.');
  const w = record.maxDim;
  const h = record.maxDim;
  const terrain = new Int32Array(w * h).fill(-1);
  const roads = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!town.isExplored(x, y)) continue;
      terrain[y * w + x] = record.terrain[x]![y]!;
      roads[y * w + x] = town.isRoad(x, y) ? 1 : 0;
    }
  }
  const labels: MapLabel[] = [];
  for (const area of record.areaDesc) {
    const text = area.descr.trim();
    if (text === '' || !rectExplored(area, (x, y) => town.isOnMap(x, y) && town.isExplored(x, y))) continue;
    labels.push({
      text, x: (area.left + area.right + 1) / 2, y: (area.top + area.bottom + 1) / 2, kind: 'area',
    });
  }
  // Detect Life (boe.town.cpp:1561): living creatures on explored squares.
  const life: { x: number; y: number }[] = [];
  if (showParty && (univ.party.partyStatus[PartyStatus.DETECT_LIFE] ?? 0) > 0) {
    for (const monst of town.monsters) {
      if (monst.isAlive && town.isExplored(monst.curLoc.x, monst.curLoc.y)) life.push({ ...monst.curLoc });
    }
  }
  return {
    place: record.name, note: null, w, h, terrain, roads,
    party: showParty ? { ...univ.party.townLoc } : null, life, labels,
  };
}

/** Entrances to one town this close together share a single label. */
const SAME_TOWN_SQUARES = 10;

/**
 * One label per town, not per entrance. A town can have several entrances
 * side by side (Valley of Dying Things' School Entry has three), and those are
 * merged into one label at their centre. Entrances far apart keep a label each.
 */
function townLabels(entrances: { spec: number; name: string; x: number; y: number }[]): MapLabel[] {
  const groups: { spec: number; name: string; xs: number[]; ys: number[] }[] = [];
  for (const e of entrances) {
    const near = groups.find((g) => g.spec === e.spec && g.xs.some((x, i) =>
      Math.abs(x - e.x) <= SAME_TOWN_SQUARES && Math.abs(g.ys[i]! - e.y) <= SAME_TOWN_SQUARES));
    if (near) {
      near.xs.push(e.x);
      near.ys.push(e.y);
    } else {
      groups.push({ spec: e.spec, name: e.name, xs: [e.x], ys: [e.y] });
    }
  }
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
  return groups.map((g) => ({ text: g.name, x: mean(g.xs), y: Math.min(...g.ys), kind: 'town' }));
}

function rectExplored(
  r: { left: number; top: number; right: number; bottom: number },
  explored: (x: number, y: number) => boolean,
): boolean {
  for (let x = r.left; x <= r.right; x++) {
    for (let y = r.top; y <= r.bottom; y++) if (explored(x, y)) return true;
  }
  return false;
}

/**
 * The game tab's end: answers a map tab's hello with everything, and after
 * that posts a snapshot whenever `update` is called, at most every
 * `intervalMs`. Nothing is built or sent until a map tab has said hello, and
 * a snapshot identical to the last one isn't sent at all. The game redraws
 * several times a second just to animate.
 *
 * **Every message carries the game tab's id.** Two game tabs on one origin
 * share the channel, and each numbers its palette in its own order, so a map
 * tab hearing both drew one game's grid with the other's palette, which came
 * out as scattered specks or black. The id is kept in `sessionStorage`, so
 * reloading the game tab keeps its map tab.
 */
export class WorldMapFeed {
  gameId = gameTabId();
  private channel: BroadcastChannel | null = null;
  private listening = false;
  private lastSent: MapSnapshot | null = null;
  private roadDrawn = false;
  private palette = new Map<number, number>();
  private paletteCanvas: HTMLCanvasElement | null = null;
  private paletteVersion = 0;
  private sentPaletteVersion = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: SheetStore,
    private session: () => GameSession,
    private scenarioTitle: () => string,
    private intervalMs = 150,
  ) {}

  /** Start listening. Does nothing where BroadcastChannel is missing. */
  attach(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(MAP_CHANNEL);
    this.channel.onmessage = (ev: MessageEvent<MapMessage>) => {
      const msg = ev.data;
      if (msg?.type === 'ready' && msg.game === this.gameId) {
        this.channel?.postMessage({ type: 'taken', game: this.gameId } satisfies MapTaken);
        return;
      }
      if (msg?.type === 'taken' && msg.game === this.gameId) {
        this.gameId = gameTabId(true);
        return;
      }
      if (msg?.type !== 'hello') return;
      if (msg.game !== undefined && msg.game !== this.gameId) return;
      this.listening = true;
      this.sentPaletteVersion = -1;
      this.post(true);
    };
    this.channel.postMessage({ type: 'ready', game: this.gameId } satisfies MapReady);
  }

  /** Open this game's map tab, or bring it back if it's already open. */
  open(): void {
    const id = encodeURIComponent(this.gameId);
    window.open(`${import.meta.env.BASE_URL}?popout=map&game=${id}`, `exile-js-map-${this.gameId}`);
  }

  /** Something may have changed: post a snapshot soon. */
  update(): void {
    if (!this.listening || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.post();
    }, this.intervalMs);
  }

  private post(force = false): void {
    if (this.channel === null) return;
    const snap = this.snapshot();
    if (!force && !snap.palette && this.lastSent !== null && sameSnapshot(snap, this.lastSent)) return;
    this.channel.postMessage(snap);
    this.lastSent = snap;
    if (snap.palette) this.sentPaletteVersion = snap.paletteVersion;
  }

  snapshot(): MapSnapshot {
    const session = this.session();
    const grid = buildMapGrid(session);
    const cells = new Uint16Array(grid.w * grid.h);
    for (let i = 0; i < cells.length; i++) {
      const ter = grid.terrain[i]!;
      cells[i] = ter < 0 ? PAL_UNEXPLORED : this.paletteIndex(ter, session.univ.terrainType(ter));
    }
    if (!this.roadDrawn) this.ensurePalette();
    const snap: MapSnapshot = {
      type: 'snapshot', game: this.gameId, scenario: this.scenarioTitle(), place: grid.place, note: grid.note,
      w: grid.w, h: grid.h, cells, roads: grid.roads, paletteVersion: this.paletteVersion,
      party: grid.party, life: grid.life, labels: grid.labels,
    };
    if (this.sentPaletteVersion !== this.paletteVersion) {
      const canvas = this.ensurePalette();
      const ctx = canvas.getContext('2d');
      if (ctx) snap.palette = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    return snap;
  }

  /** The palette slot for a terrain type, drawing it on first sight. */
  private paletteIndex(ter: number, spec: Terrain): number {
    const known = this.palette.get(ter);
    if (known !== undefined) return known;
    const index = PAL_FIRST_TERRAIN + this.palette.size;
    const canvas = this.ensurePalette(index);
    const ctx = canvas.getContext('2d');
    if (!ctx) return PAL_UNEXPLORED;
    ctx.imageSmoothingEnabled = false;
    const [x, y] = paletteCell(index);
    // A sheet still loading (a scenario's custom graphics, say): show the
    // square as unexplored for now and try again next time, rather than
    // keeping a blank tile for good.
    if (!drawMapTile(ctx, this.store, spec, x, y, WORLD_TILE)) return PAL_UNEXPLORED;
    this.palette.set(ter, index);
    this.paletteVersion++;
    return index;
  }

  /** The palette canvas, grown if `index` doesn't fit. Growing keeps what's drawn. */
  private ensurePalette(index = PAL_ROAD): HTMLCanvasElement {
    const rows = Math.floor(index / PALETTE_COLS) + 1;
    const height = rows * WORLD_TILE;
    let canvas = this.paletteCanvas;
    if (canvas === null || canvas.height < height) {
      const next = document.createElement('canvas');
      next.width = PALETTE_COLS * WORLD_TILE;
      next.height = Math.max(height, WORLD_TILE * 4);
      const ctx = next.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        if (canvas !== null) ctx.drawImage(canvas, 0, 0);
      }
      canvas = next;
      this.paletteCanvas = next;
      this.paletteVersion++;
    }
    if (!this.roadDrawn) {
      const ctx = canvas.getContext('2d');
      const [rx, ry] = paletteCell(PAL_ROAD);
      if (ctx && drawRoadStub(ctx, this.store, rx, ry, WORLD_TILE)) {
        this.roadDrawn = true;
        this.paletteVersion++;
      }
    }
    return canvas;
  }
}

/** Where palette entry `index` sits, in pixels. */
export function paletteCell(index: number): [number, number] {
  return [(index % PALETTE_COLS) * WORLD_TILE, Math.floor(index / PALETTE_COLS) * WORLD_TILE];
}

/** This game tab's id: made once, and kept across reloads of the same tab. */
function gameTabId(fresh = false): string {
  const KEY = 'exile-js:game-tab';
  try {
    const kept = fresh ? null : sessionStorage.getItem(KEY);
    if (kept) return kept;
    const made = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(KEY, made);
    return made;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Would `a` draw exactly what `b` did? The palette is compared by version. */
function sameSnapshot(a: MapSnapshot, b: MapSnapshot): boolean {
  if (a.paletteVersion !== b.paletteVersion || a.w !== b.w || a.h !== b.h) return false;
  if (a.place !== b.place || a.note !== b.note || a.scenario !== b.scenario) return false;
  if (JSON.stringify([a.party, a.life, a.labels]) !== JSON.stringify([b.party, b.life, b.labels])) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  for (let i = 0; i < a.roads.length; i++) if (a.roads[i] !== b.roads[i]) return false;
  return true;
}
