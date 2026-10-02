/**
 * Exile III's intro movie — "Exile (verb) - To banish or expel ...", the
 * history of Exile told over a little play on the game's own map renderer —
 * ported from EXILE3.EXE's segment `1098`.
 *
 * E3 has three of these scripted cutscenes, picked by `FUN_1098_08bd(n)` and
 * stepped one frame at a time by `FUN_1098_103c`:
 *
 * - movie 0 (`47dd`, frames 0–239) is the title screen's background loop, the
 *   party raiding Varik's temple;
 * - **movie 1 (`3148`, frames 300–517) is this one.** The title screen's New
 *   Game and Intro buttons both call `FUN_1098_0e09(1)` (`10c8:00b7`), which
 *   plays it until a click, and New Game then builds the party;
 * - movie 2 (`1dcb`) is the ending, played from `1078:5ad8` after the last
 *   battle.
 *
 * Only movie 1 is ported.
 * TODO(E3-movies): movies 0 and 2 — they belong to E3's title screen and its
 * ending, neither of which this port has yet.
 *
 * **The stage is a town**: `08bd` loads TOWN.DAT's town 84, "Anim Data"
 * (`FUN_1040_4075`), puts its creatures on their start squares and its items
 * down, gives the party four PCs with graphics 0, 10, 20 and 30 off the edge
 * of the map, and sets the game to combat mode (`overall_mode` 10) so they
 * draw one by one. A frame then moves things about by hand — the creatures'
 * and PCs' squares are written directly — and draws through the same
 * `draw_terrain`, missile and explosion code the game uses, which E3 shares
 * with Blades of Exile 1997 (NEWGRAPH.CPP), `cartoon_happening` and all.
 *
 * Everything here is a port of that code, kept apart from the game's own
 * Universe: the movie writes squares, terrain and creatures freely, so it has
 * a copy of the town to itself, and its dice are its own (`MovieIo.ran`)
 * rather than the game's — a movie drawing on the game stream would move
 * every replay. The drawing is behind `MovieGfx`, which
 * `render/e3MovieScreen.ts` implements on a canvas and the tests stub.
 */

import { blocksMove, type Terrain } from '../data/terrain';
import type { Scenario } from '../data/scenario';
import { bugFixed } from './bugFixes';
import { getMissileDirection } from './missileAnim';

/** A square as E3 stores one: two signed bytes. */
export interface Loc { x: number; y: number }

const loc = (x: number, y: number): Loc => ({ x, y });
const same = (a: Loc, b: Loc): boolean => a.x === b.x && a.y === b.y;
/** E3's locations are `char`s: a step past 127 wraps, as the bytes do. */
const s8 = (n: number): number => ((n + 128) & 0xff) - 128;

/** Town 84, "Anim Data", the stage `08bd` loads for movies 0 and 1. */
export const MOVIE_TOWN = 84;

/**
 * Movie 1's squares, a table at `DS:1ec0` that `3148` copies to its stack
 * frame on every call (`[bp - 0x52]` on). The frame overwrites the last three
 * with the caption square, so only 32 are real.
 */
export const MOVIE1_LOCS: readonly Loc[] = [
  [5, 15], [5, 27], [9, 29], [2, 14], [4, 14], [6, 14], [8, 14], [3, 13],
  [7, 13], [6, 12], [2, 19], [4, 19], [6, 19], [8, 19], [4, 21], [6, 21],
  [3, 14], [7, 14], [15, 25], [14, 28], [16, 28], [13, 29], [17, 29], [13, 23],
  [17, 23], [25, 26], [24, 29], [25, 29], [26, 29], [27, 25], [25, 27], [5, 12],
].map(([x, y]) => loc(x!, y!));

/** `FUN_1098_08bd`: movie `n` starts at frame `n * 300`. */
export const MOVIE1_FIRST_FRAME = 300;
/**
 * The frame `3148` restarts on (`431f`: the frame counter back to -1 and
 * `08bd(1)` again). E3 loops the movie until a click; this port stops here
 * instead, since it plays once before a new game (DIVERGENCES.md).
 */
export const MOVIE1_END_FRAME = 518;

/**
 * The pause between frames: `0e09`'s loop calls `Delay` five times, 10, 10,
 * 10, 10 and 8 ticks, checking for a click between each.
 */
export const FRAME_TICKS = 48;
/** E3's `Delay(n)` (`FUN_1048_024c`) waits `n * 16` ms of `GetTickCount`. */
export const TICK_MS = 16;

export interface MovieCreature {
  /** `active`: the slot holds a creature (its number isn't 0). */
  active: boolean;
  number: number;
  loc: Loc;
  /** `m_d.direction`, written as it walks: 2 heading east, 6 west. */
  direction: number;
  picture: number;
  width: number;
  height: number;
  /** `m_d.m_type`, which picks its death cry. */
  race: number;
}

export interface MoviePc {
  loc: Loc;
  /** `pc_dir`. */
  direction: number;
  graphic: number;
}

export interface MovieItem { loc: Loc; graphic: number }

/** The town, creatures, PCs and camera of one showing — what `08bd` builds. */
export class MovieStage {
  /** `t_d.terrain[x][y]`, 64 × 64 like E3's array; the movie town fills 32. */
  terrain: number[][];
  /** The floor decals (`sfx`), one bit each as `make_sfx` writes them. */
  sfx: number[][];
  creatures: MovieCreature[];
  /** What each creature is doing (`DS:53ce`): -1 nothing, < 6 after that PC, 6 to its target, 100+ fighting creature n − 100. */
  creatureState: number[];
  creatureTarget: Loc[];
  pcs: MoviePc[];
  /** As `creatureState`, for the PCs (`DS:53c2`). */
  pcState: number[];
  pcTarget: Loc[];
  items: MovieItem[];
  /** `inTownRect`: where a creature may stand (`FUN_1080_02e9`). */
  bounds: { top: number; left: number; bottom: number; right: number };
  /** The camera (`DS:6dc8`). */
  center: Loc = loc(4, 4);
  /** The line `627a` posted (`DS:508f`) and where (`DS:5190`); the next draw shows it once. */
  caption: { text: string; at: Loc } | null = null;
  /** `combat_posing_monster`: a PC, or 100 + a creature, drawn mid-swing; -1 none. */
  posing = -1;
  /** The frame counter, `DS:3dd6`. */
  frame = MOVIE1_FIRST_FRAME - 1;

  constructor(private readonly scen: Scenario) {
    const town = scen.towns[MOVIE_TOWN];
    if (!town) throw new Error(`Exile III has no town ${MOVIE_TOWN} for its movie`);
    this.terrain = Array.from({ length: 64 }, (_, x) =>
      Array.from({ length: 64 }, (_, y) => (x < town.maxDim && y < town.maxDim ? town.terrain[x]![y]! : 0)));
    this.sfx = Array.from({ length: 64 }, () => new Array<number>(64).fill(0));
    this.bounds = { ...town.inTownRect };
    // Thirty from the town, and thirty empty slots after (`08bd`).
    this.creatures = Array.from({ length: 60 }, (_, i) => {
      const start = i < 30 ? town.creatures[i] : undefined;
      const number = start?.number ?? 0;
      const m = scen.scenMonsters[number];
      return {
        active: number !== 0,
        number,
        loc: start ? loc(start.startLoc.x, start.startLoc.y) : loc(0, 0),
        direction: 0,
        picture: m?.pictureNum ?? 0,
        width: m?.xWidth ?? 1,
        height: m?.yWidth ?? 1,
        race: m?.race ?? 0,
      };
    });
    this.creatureState = new Array<number>(60).fill(-1);
    this.creatureTarget = Array.from({ length: 60 }, () => loc(0, 0));
    // Four PCs, off the map at x 50 until the script brings them on.
    this.pcs = Array.from({ length: 4 }, (_, i) => ({ loc: loc(50, 0), direction: 0, graphic: i * 10 }));
    this.pcState = new Array<number>(6).fill(-1);
    this.pcTarget = Array.from({ length: 6 }, () => loc(0, 0));
    // The town's preset items, less the ones in containers, which never draw.
    this.items = town.presetItems
      .filter((p) => p.code >= 0 && !p.contained)
      .map((p) => ({ loc: loc(p.loc.x, p.loc.y), graphic: scen.scenItems[p.code]?.graphicNum ?? 0 }));
  }

  /** The terrain record for terrain number `ter`. */
  terrainType(ter: number): Terrain | undefined {
    return this.scen.terTypes[ter];
  }

  terrainAt(l: Loc): number {
    return l.x >= 0 && l.y >= 0 && l.x < 64 && l.y < 64 ? this.terrain[l.x]![l.y]! : 0;
  }

  /** `monst_there` — the creature covering `l`, or 90 for none. */
  creatureThere(l: Loc): number {
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i]!;
      if (!c.active) continue;
      const dx = l.x - c.loc.x;
      const dy = l.y - c.loc.y;
      if (dx >= 0 && dx < c.width && dy >= 0 && dy < c.height) return i;
    }
    return 90;
  }

  /**
   * E3's `is_blocked` (`FUN_1080_0cff`) in combat, which the movie is in: the
   * terrain (`blocks_move`, and the "keep off" terrains 237–242 and 78), a PC,
   * or a creature. The barrel and crate bit it also tests is cleared by `08bd`.
   */
  isBlocked(l: Loc): boolean {
    if (l.x < 0 || l.y < 0 || l.x >= 64 || l.y >= 64) return true;
    const ter = this.terrainAt(l);
    const type = this.scen.terTypes[ter];
    if (type && blocksMove(type)) return true;
    if (ter >= 0xed && ter <= 0xf2) return true;
    if (ter === 0x4e) return true;
    if (this.pcs.some((pc) => same(pc.loc, l))) return true;
    return this.creatureThere(l) < 90;
  }

  /** `loc_off_act_area` (`FUN_1080_02e9`): strictly inside `in_town_rect`. */
  offArea(l: Loc): boolean {
    const b = this.bounds;
    return !(b.left < l.x && l.x < b.right && b.top < l.y && l.y < b.bottom);
  }

  /** `monst_can_be_there` (`FUN_1080_0fee`). */
  creatureCanBeThere(l: Loc, i: number): boolean {
    const c = this.creatures[i]!;
    c.loc.x += 100; // so it doesn't block itself
    let ok = true;
    for (let x = 0; x < c.width && ok; x++)
      for (let y = 0; y < c.height && ok; y++) {
        const at = loc(l.x + x, l.y + y);
        if (this.isBlocked(at) || this.offArea(at)) ok = false;
      }
    c.loc.x -= 100;
    return ok;
  }

  /** `make_sfx` (FIELDS.CPP:375; E3's `FUN_1038_1185`). */
  makeSfx(x: number, y: number, type: number): void {
    if (x < 0 || y < 0 || x >= 64 || y >= 64) return;
    const t = this.scen.terTypes[this.terrain[x]![y]!];
    // `get_obscurity > 0` and `terrain_blocked`: nothing on a wall.
    if (t && (t.blockage !== 0)) return;
    const now = this.sfx[x]![y]!;
    if (type === 1 || type === 2) {
      if (now === 4) return;
      if (now < 4) type = Math.min(3, type + now);
    } else if (type === 4 && now === 8) type = 5;
    this.sfx[x]![y] = 2 ** (type - 1);
  }
}

/** One of `store_booms` (NEWGRAPH.CPP's `add_explosion`). */
export interface StoredBoom {
  dest: Loc;
  /** Frames to wait before starting, 0 for the first and 0 to −2 after. */
  offset: number;
  place: number;
  type: number;
  /** Where it sits in the terrain picture, decided when it first draws. */
  rect: { left: number; top: number };
}

/**
 * The drawing a movie needs, in E3's two pictures: the off-screen terrain
 * gworld that `draw_terrain` paints, and the screen it's copied to. Times are
 * in milliseconds.
 */
export interface MovieGfx {
  /** `draw_terrain`'s painting, into the terrain picture; it shows (and clears) the caption. */
  paintTerrain(stage: MovieStage): void;
  /** `redraw_terrain`: the terrain picture onto the screen, whole. */
  showTerrain(): void;
  /**
   * The terrain picture with sprites over it, onto the screen: missiles (from
   * missiles.png, clipped to the 9 × 9 squares) or explosions (booms.png).
   * `only` limits the copy to those 28 × 36 cells (their top-left corners),
   * as `do_explosion_anim`'s second half does.
   */
  showSprites(sprites: MovieSprite[], only?: { left: number; top: number }[]): void;
  sound(n: number): void;
  wait(ms: number): Promise<void>;
  now(): number;
}

export interface MovieSprite {
  sheet: 'missiles' | 'booms';
  /** The source cell's top-left on its sheet. */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Where in the terrain picture (279 × 351). */
  x: number;
  y: number;
  /** Drawn only inside this rectangle of the picture, if given. */
  clip?: Rect;
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * `active_area_rect`, the picture less its 13-pixel border: the nine squares
 * a missile is kept inside.
 */
export const ACTIVE_AREA: Rect = { left: 13, top: 13, right: 266, bottom: 338 };
/** `boom_space`'s `big_to`, which its hit is clipped to. */
const BIG_TO: Rect = { left: 13, top: 13, right: 265, bottom: 337 };

/** What the movie's dice are. */
export type MovieRan = (min: number, max: number) => number;

/** The terrain picture's size (`ter_scrn_rect`). */
export const TER_SCRN = { w: 279, h: 351 };

/** `boom_space`'s `sound_to_play` (GRAPHICS.CPP; E3's table at `1120:05a0`). */
const BOOM_SPACE_SOUNDS = [97, 69, 70, 71, 72, 73, 55, 75, 42, 86, 87, 88, 89, 98, 0, 0, 0, 0, 0, 0];
/** `do_explosion_anim`'s `boom_type_sound` and `snd_len` (E3's `DS:1f32`, `DS:1f54`). */
const BOOM_TYPE_SOUND = [5, 10, 53];
const BOOM_SOUND_MS = [1500, 1410, 1100];
/** `do_missile_anim`'s `pause_len`, by its sound. */
const MISSILE_PAUSE_MS: Record<number, number> = { 11: 660, 12: 410, 14: 200, 53: 1000, 64: 500 };

/** Thrown out of a wait when the player skips, to stop the script wherever it is. */
export class MovieSkipped extends Error {
  constructor() { super('skipped'); }
}

/**
 * The player of one movie: the stage, the explosion list and E3's animation
 * routines, which are Blades of Exile 1997's. `PSD[306][6]`, the game speed,
 * is 0, the title screen's.
 */
export class E3Movie {
  readonly stage: MovieStage;
  private booms: (StoredBoom | null)[] = new Array<StoredBoom | null>(30).fill(null);
  private boomAnimActive = false;
  private haveBoom = false;

  constructor(scen: Scenario, readonly gfx: MovieGfx, readonly ran: MovieRan) {
    this.stage = new MovieStage(scen);
  }

  // ------------------------------------------------------------- drawing

  /** `draw_terrain(mode)`: paint, and with mode 0 show it too. */
  private drawTerrain(mode: 0 | 1): void {
    this.gfx.paintTerrain(this.stage);
    if (mode === 0) this.gfx.showTerrain();
  }

  /** `FUN_1098_6bba`: draw the stage and copy it to the window. */
  private redraw(): void {
    this.drawTerrain(0);
  }

  /** `FUN_1098_691f(n)`: `combat_posing_monster` and a redraw. */
  private pose(n: number): void {
    this.stage.posing = n;
    this.drawTerrain(0);
  }

  /** `FUN_1098_627a(text, at)`: post a caption for the next draw. */
  private caption(text: string, at: Loc): void {
    this.stage.caption = { text, at: { ...at } };
  }

  private delayTicks(n: number): Promise<void> {
    return this.gfx.wait(n * TICK_MS);
  }

  // --------------------------------------------- NEWGRAPH.CPP, as E3 has it

  private startMissileAnim(): void {
    if (this.boomAnimActive) return;
    this.boomAnimActive = true;
    this.booms.fill(null);
    this.haveBoom = false;
  }

  private endMissileAnim(): void {
    this.boomAnimActive = false;
  }

  /**
   * `run_a_missile` (`FUN_1098_6e17`) — one missile, which is all the movie
   * ever fires: `start_missile_anim`, `add_missile`, `do_missile_anim`.
   */
  private async runAMissile(from: Loc, to: Loc, type: number, path: number, sound: number, len: number): Promise<void> {
    this.startMissileAnim();
    await this.doMissileAnim(len, from, { dest: { ...to }, type, path }, sound);
    this.endMissileAnim();
  }

  /** `do_missile_anim` for one missile (NEWGRAPH.CPP:426). */
  private async doMissileAnim(
    steps: number, origin: Loc, m: { dest: Loc; type: number; path: number }, sound: number,
  ): Promise<void> {
    const t1 = this.gfx.now();
    const pause = MISSILE_PAUSE_MS[sound] ?? 0;
    if (!this.boomAnimActive) return;
    // A missile aimed at its own origin is dropped after the checks for one,
    // so the flight's sound and time still pass with nothing in the air.
    const flying = !same(origin, m.dest);
    this.drawTerrain(1);
    this.gfx.showTerrain();
    const ul = loc(this.stage.center.x - 4, this.stage.center.y - 4);
    const start = { x: 13 + 14 + 28 * (origin.x - ul.x), y: 13 + 18 + 36 * (origin.y - ul.y) };
    const finish = { x: 1 + 13 + 14 + 28 * (m.dest.x - ul.x), y: 1 + 13 + 18 + 36 * (m.dest.y - ul.y) };
    const dir = getMissileDirection(start, finish);
    const x1 = finish.x - start.x;
    const y1 = finish.y - start.y;
    this.gfx.sound(sound);
    for (let t = 0; t < steps; t++) {
      let x = -8 + start.x + Math.trunc((x1 * t) / steps);
      let y = -8 + start.y + Math.trunc((y1 * t) / steps);
      if (m.path === 1) y -= Math.trunc((t * (steps - t)) / 100);
      // missile_origin_base {1,1,17,17}, offset into the sheet.
      const col = m.type < 7 ? dir : t % 8;
      x += 1;
      y += 1;
      if (flying) {
        this.gfx.showSprites([{
          sheet: 'missiles', sx: 1 + 18 * col, sy: 1 + 18 * m.type, w: 16, h: 16, x, y, clip: ACTIVE_AREA,
        }]);
      }
      // `if ((cartoon_happening == TRUE) && (t % 3 == 0)) Delay(1)`; at game
      // speed 0 that is the only wait there is.
      if (t % 3 === 0) await this.delayTicks(1);
    }
    this.gfx.showTerrain();
    const left = pause + 40 - (this.gfx.now() - t1);
    if (left > 0) await this.gfx.wait(left);
  }

  /** `run_a_boom` (`FUN_1098_6e5b`). */
  private async runABoom(where: Loc, type: number): Promise<void> {
    if (type < 0 || type > 2) return;
    this.startMissileAnim();
    this.addExplosion(where, -1, 0, type);
    await this.doExplosionAnim(0);
    this.endMissileAnim();
  }

  /** `add_explosion` (`FUN_1098_6ee7`); the movie never offsets one. */
  private addExplosion(dest: Loc, val: number, place: number, type: number): void {
    if (!this.boomAnimActive) return;
    // Lose redundant explosions.
    for (const b of this.booms)
      if (b && same(dest, b.dest) && place === 0) return;
    const i = this.booms.findIndex((b) => b === null);
    if (i < 0) return;
    this.haveBoom = true;
    const offset = i === 0 ? 0 : -this.ran(0, 2);
    void val;
    this.booms[i] = { dest: { ...dest }, offset, place, type, rect: { left: 0, top: 0 } };
  }

  /**
   * `do_explosion_anim(sound, special_draw)` (NEWGRAPH.CPP:621; E3's
   * `FUN_1098_7a1b`). `special_draw` 1 plays the first half and keeps the
   * explosions, 2 the second half. The sound argument is ignored, there as here.
   */
  private async doExplosionAnim(special: 0 | 1 | 2): Promise<void> {
    const t1 = this.gfx.now();
    if (!this.haveBoom || !this.boomAnimActive) {
      this.boomAnimActive = false;
      return;
    }
    if (!this.booms.some((b) => b !== null)) return;
    this.drawTerrain(1);
    if (special !== 2) this.gfx.showTerrain();
    const ul = loc(this.stage.center.x - 4, this.stage.center.y - 4);
    let cur = 0;
    for (let i = 0; i < 30; i++) {
      const b = this.booms[i];
      if (!b || special >= 2) continue;
      cur = b.type;
      b.rect = { left: 13 + 28 * (b.dest.x - ul.x), top: 13 + 36 * (b.dest.y - ul.y) };
      if (b.place === 1) {
        b.rect.left += this.ran(0, 50) - 25;
        b.rect.top += this.ran(0, 50) - 25;
      }
      // Eliminate stuff that's too gone: anything not wholly in the picture.
      if (b.rect.left < 0 || b.rect.top < 0 || b.rect.left + 28 > TER_SCRN.w || b.rect.top + 36 > TER_SCRN.h) {
        this.booms[i] = null;
      }
    }
    if (special < 2) this.gfx.sound(BOOM_TYPE_SOUND[cur]!);
    const live = (): StoredBoom[] => this.booms.filter((b): b is StoredBoom => b !== null);
    for (let t = special === 2 ? 6 : 0; t < (special === 1 ? 6 : 11); t++) {
      const sprites: MovieSprite[] = [];
      for (const b of live()) {
        const f = t + b.offset;
        if (f < 0 || f > 7) continue;
        sprites.push({ sheet: 'booms', sx: 28 * f, sy: 36 * (1 + b.type), w: 28, h: 36, x: b.rect.left, y: b.rect.top });
      }
      this.gfx.showSprites(sprites, live().map((b) => b.rect));
      // `Delay(2 * (1 + PSD[306][6]))`, and one more for a cartoon.
      await this.delayTicks(2);
      await this.delayTicks(1);
    }
    if (special !== 1) {
      this.booms.fill(null);
      const left = BOOM_SOUND_MS[cur]! + 100 - (this.gfx.now() - t1);
      if (left > 0) await this.gfx.wait(left);
    }
  }

  /**
   * `boom_space` (GRAPHICS.CPP:2279; E3's `FUN_1050_59c2`) as a cartoon: the
   * hit sprite over the square, no damage number, the sound, a pause, and the
   * terrain put back. `type`'s tens digit is unused here, as there.
   */
  private async boomSpace(where: Loc, type: number, sound: number): Promise<void> {
    const sprite = type % 10;
    const q = where.x - this.stage.center.x + 4;
    const r = where.y - this.stage.center.y + 4;
    let xAdj = 0;
    let yAdj = 0;
    const m = this.stage.creatureThere(where);
    if (m < 90) {
      xAdj += 14 * (this.stage.creatures[m]!.width - 1);
      yAdj += 18 * (this.stage.creatures[m]!.height - 1);
    }
    // dest_rect {13,13,41,49} moved to the square, clipped to big_to {13,13,265,337}.
    const x = 13 + q * 28 + xAdj;
    const y = 13 + r * 36 + yAdj;
    if (x < BIG_TO.right && y < BIG_TO.bottom && x + 28 > BIG_TO.left && y + 36 > BIG_TO.top) {
      this.gfx.showSprites([{ sheet: 'booms', sx: 28 * sprite, sy: 0, w: 28, h: 36, x, y, clip: BIG_TO }],
        [{ left: x, top: y }]);
    }
    this.gfx.sound(BOOM_SPACE_SOUNDS[sound] ?? 0);
    if (sound === 6) await this.delayTicks(12);
    await this.delayTicks(10);
    this.gfx.showTerrain();
  }

  /** `FUN_1098_6130`: a creature dies — blood, off the map, its death cry. */
  private kill(i: number): void {
    const c = this.stage.creatures[i]!;
    this.stage.makeSfx(c.loc.x, c.loc.y, 1);
    c.loc.x = 50;
    this.ran(0, 2);
    let snd: number;
    switch (c.race) {
      case 0: case 3: case 4: case 5: case 6: case 9: {
        let k: number;
        if (c.number === 38 || c.number === 39) k = 4;
        else if (c.number === 45) k = 0;
        // E3 BUG, kept (E3-SUSPECTED-BUGS.md #22): 1997's `kill_monst` rolls
        // 0 or 1 here, but E3 rolls only for a number below 155 *and* above
        // 158 (`6130`: `jae` to the 2, then `ja` to the roll), which none
        // is, so everyone else gets 2. Fixed, 155–158 get 2 and the rest roll.
        else if (!bugFixed(22) || (c.number >= 155 && c.number <= 158)) k = 2;
        else k = this.ran(0, 1);
        snd = 29 + k;
        break;
      }
      case 1: case 2: case 7: case 8: case 11:
        snd = 31 + this.ran(0, 1);
        break;
      default:
        snd = 33;
    }
    this.gfx.sound(snd);
    this.redraw();
  }

  // ---------------------------------------------------- walking (62b0, 6597)

  /** `FUN_1098_69f8`: a PC steps, opening a door it walks into. */
  private pcStep(i: number, from: Loc, dx: number, dy: number): boolean {
    const to = loc(s8(from.x + dx), s8(from.y + dy));
    // The doors: 120 → 124, 103 → 107, 108 → 109.
    for (const [shut, open] of [[0x78, 0x7c], [0x67, 0x6b], [0x6c, 0x6d]] as const) {
      if (this.stage.terrainAt(to) === shut) {
        this.stage.terrain[to.x]![to.y] = open;
        this.redraw();
        this.gfx.sound(58);
      }
    }
    if (this.stage.isBlocked(to)) return false;
    const pc = this.stage.pcs[i]!;
    pc.loc = to;
    pc.direction = dx > 0 ? 2 : dx < 0 || dy > 0 ? 6 : 2;
    return true;
  }

  /** `FUN_1098_6954`: a creature steps. */
  private creatureStep(i: number, from: Loc, dx: number, dy: number): boolean {
    const to = loc(s8(from.x + dx), s8(from.y + dy));
    if (!this.stage.creatureCanBeThere(to, i)) return false;
    const c = this.stage.creatures[i]!;
    c.loc = to;
    c.direction = dx > 0 ? 2 : dx < 0 || dy > 0 ? 6 : 2;
    return true;
  }

  /**
   * The eight ways a walker tries, in order, toward `target` from `cur`: the
   * diagonals first, then straight. Each test is on where it stood, not where
   * an earlier try took it, and stops at the first that moves.
   */
  private walk(cur: Loc, target: Loc, step: (dx: number, dy: number) => boolean): void {
    const tries: [boolean, number, number][] = [
      [cur.x > target.x && cur.y > target.y, -1, -1],
      [cur.x < target.x && cur.y < target.y, 1, 1],
      [cur.x > target.x && cur.y < target.y, -1, 1],
      [cur.x < target.x && cur.y > target.y, 1, -1],
      [cur.x > target.x, -1, 0],
      [cur.x < target.x, 1, 0],
      [cur.y < target.y, 0, 1],
      [cur.y > target.y, 0, -1],
    ];
    for (const [want, dx, dy] of tries) if (want && step(dx, dy)) return;
  }

  /** `adjacent`. */
  private static adjacent(a: Loc, b: Loc): boolean {
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  }

  /**
   * `FUN_1098_62b0` — each PC on the map takes a step toward its target, or
   * swings at the creature it is after if it's next to it (on even frames).
   */
  private async walkPcs(): Promise<void> {
    const s = this.stage;
    // Not reset between PCs: a PC whose state names no target walks to the
    // last one, as E3's stack slot does.
    let target = loc(0, 0);
    for (let i = 0; i < 4; i++) {
      const pc = s.pcs[i]!;
      const state = s.pcState[i]!;
      if (pc.loc.x >= 50 || state < 0) continue;
      if (state === 6) target = { ...s.pcTarget[i]! };
      if (state >= 100) target = { ...s.creatures[state - 100]!.loc };
      if (state >= 100 && E3Movie.adjacent(pc.loc, target) && s.frame % 2 === 0) {
        this.pose(i);
        const r = this.ran(0, 2);
        await this.boomSpace(target, r * 10 + 13, r + 1);
        continue;
      }
      const cur = { ...pc.loc };
      this.walk(cur, target, (dx, dy) => this.pcStep(i, cur, dx, dy));
    }
  }

  /** `FUN_1098_6597` — the same for the creatures, which swing on odd frames. */
  private async walkCreatures(): Promise<void> {
    const s = this.stage;
    let target = loc(0, 0);
    for (let i = 0; i < 60; i++) {
      const c = s.creatures[i]!;
      const state = s.creatureState[i]!;
      if (c.loc.x >= 50 || state < 0) continue;
      if (state < 6) target = { ...s.pcs[state]?.loc ?? loc(0, 0) };
      if (state === 6) target = { ...s.creatureTarget[i]! };
      if (state >= 100) target = { ...s.creatures[state - 100]!.loc };
      if ((state >= 100 || state < 6) && E3Movie.adjacent(c.loc, target) && s.frame % 2 === 1) {
        this.pose(i + 100);
        const r = this.ran(0, 2);
        await this.boomSpace(target, r * 10 + 13, r + 1);
        continue;
      }
      const cur = { ...c.loc };
      this.walk(cur, target, (dx, dy) => this.creatureStep(i, cur, dx, dy));
    }
  }

  // ------------------------------------------------------------ the script

  /** Nine magic explosions on one square, `place_type` 1 — someone arriving or leaving. */
  private flash(where: Loc, n = 9): void {
    for (let k = 0; k < n; k++) this.addExplosion(where, -1, 1, 1);
  }

  /** Put creature `i` on `at`, walking to `target` (state 6). */
  private bring(i: number, at: Loc, target: Loc = at): void {
    const s = this.stage;
    s.creatures[i]!.loc = { ...at };
    s.creatureState[i] = 6;
    s.creatureTarget[i] = { ...target };
  }

  /** Off the map: E3 writes 50 over the square's x. */
  private remove(i: number): void {
    this.stage.creatures[i]!.loc.x = 50;
  }

  /**
   * Play the movie through, frame by frame, from where the stage stands to the
   * frame it would loop on. `MovieSkipped` out of `gfx.wait` stops it.
   */
  async play(): Promise<void> {
    while (this.stage.frame + 1 < MOVIE1_END_FRAME) {
      await this.frame();
      await this.delayTicks(FRAME_TICKS);
    }
  }

  /** `FUN_1098_3148` — one frame of movie 1. */
  async frame(): Promise<void> {
    const s = this.stage;
    const L = MOVIE1_LOCS;
    const m = s.creatures;
    const pc = s.pcs;
    // The caption square: three above the camera, as the frame starts.
    const cap = loc(s.center.x, s.center.y - 3);
    s.frame++;
    const f = s.frame;
    const r = this.ran(0, 2);
    /** The usual tail, `4341`: the camera drifts, everyone walks, and a redraw. */
    let tail = true;
    const say = (text: string, at: Loc = L[31]!): void => this.caption(text, at);
    /** `627a` then `6bba`, and out without the tail (`3cf2`–`3fa2`). */
    const sayNow = (text: string): void => {
      this.caption(text, cap);
      this.redraw();
      tail = false;
    };

    switch (f) {
      case 300:
        // A black square at the top left for the history to play over.
        for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) s.terrain[x]![y] = 0x56;
        s.center = { ...L[0]! };
        break;
      case 301: case 302: say('Exile (verb) -'); break;
      case 303: case 304: say('To banish or expel ...'); break;
      case 305: case 306: say("from one's native land."); break;
      case 308: case 309: say('Exile is also a place -'); break;
      case 310: case 311: say('many miles of caves and tunnels,'); break;
      case 312: case 313: say("far below the world's surface."); break;
      case 314:
        // The teleporter pad goes down where the camera is.
        s.terrain[5]![15] = 0x4e;
        this.redraw();
        this.gfx.sound(51);
        tail = false;
        break;
      case 315: case 316: case 317: say('The Empire rules the surface totally.'); break;
      case 318: case 319: say('When they discovered Exile,'); break;
      case 320: case 321: say('they had the perfect use for it:'); break;
      case 322:
        this.startMissileAnim();
        this.flash(L[0]!);
        await this.doExplosionAnim(1);
        m[28]!.loc = { ...L[0]! };
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      case 323: case 324:
        say('a prison.');
        s.creatureState[28] = 6;
        s.creatureTarget[28] = { ...L[1]! };
        break;
      case 325: case 326: say("Everyone who didn't fit in:"); break;
      case 327: case 328: case 329: {
        say(f === 327 ? 'the rebels,' : f === 328 ? 'the antisocial,' : 'the disliked.');
        this.startMissileAnim();
        this.flash(L[0]!);
        await this.doExplosionAnim(1);
        const who = f === 329 ? 19 : f - 316;
        m[who]!.loc = { ...L[0]! };
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        s.creatureState[who] = 6;
        s.creatureTarget[who] = { ...L[1]! };
        break;
      }
      case 330: case 331: say('They were teleported to Exile ...'); break;
      case 332: case 333: say('forever.'); break;
      case 334:
        for (const i of [19, 11, 28, 12]) this.remove(i);
        break;
      case 335: case 336: cap.y++; say('The Exiles were not inactive.', cap); break;
      case 337: case 338: case 339: cap.y++; say('They built subterranean cities.', cap); break;
      case 341: case 342: cap.y++; say('They learned to fight.', cap); break;
      case 343:
        this.pose(115);
        await this.boomSpace(m[14]!.loc, 13, r);
        break;
      case 344:
        this.pose(114);
        await this.boomSpace(m[15]!.loc, 13, r);
        break;
      case 345: case 346:
        if (f === 345) cap.y++;
        say('They studied magic.', cap);
        break;
      case 347:
        this.pose(116);
        await this.runAMissile(m[16]!.loc, L[2]!, 8, 1, 11, 120);
        await this.runABoom(L[2]!, 0);
        break;
      case 348: case 349: cap.y--; say('They built their strength,', cap); break;
      case 350:
        pc[3]!.loc = { ...L[0]! };
        pc[3]!.loc.y++;
        m[11]!.loc = { ...L[17]! };
        s.creatureState[11] = -1;
        break;
      case 351: case 352: cap.y--; say('and when they were ready ...', cap); break;
      case 354: case 355: cap.y--; say('they got their revenge.', cap); break;
      case 356: case 357: cap.y--; say('The archmage Erika ', cap); break;
      case 358: case 359: cap.y--; say('made her own teleporter. ', cap); break;
      case 360:
        pc[3]!.loc = { ...L[0]! };
        break;
      case 361:
        this.startMissileAnim();
        this.flash(L[0]!);
        await this.doExplosionAnim(1);
        pc[3]!.loc.x = 50;
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        m[24]!.loc = { ...L[23]! };
        m[7]!.loc = { ...L[24]! };
        break;
      case 362:
        s.center = { ...L[18]! };
        break;
      case 363: case 364:
        this.remove(11);
        say('Emperor Hawthorne ruled the Empire. ', cap);
        break;
      case 365: case 366: say('He was brilliant ... ', cap); break;
      case 367: case 368: say('... and ruthless ... ', cap); break;
      case 369: case 370: say('and hated totally.', cap); break;
      case 371: {
        const p = { ...L[19]! };
        p.x++;
        this.startMissileAnim();
        this.flash(p);
        await this.doExplosionAnim(1);
        pc[3]!.loc = p;
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      }
      case 372: say('WHAT?', m[27]!.loc); break;
      case 373: {
        this.pose(3);
        await this.runAMissile(pc[3]!.loc, m[27]!.loc, 6, 1, 25, 160);
        const p = { ...m[27]!.loc };
        this.startMissileAnim();
        for (let k = 0; k < 9; k++) this.addExplosion(p, -1, 1, 0);
        await this.doExplosionAnim(1);
        this.remove(27);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      }
      case 374: {
        const p = { ...pc[3]!.loc };
        this.startMissileAnim();
        this.flash(p);
        await this.doExplosionAnim(1);
        pc[3]!.loc.x = 50;
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      }
      case 375: {
        const p = { ...L[19]! };
        p.x++;
        // Posing "PC 7", which there isn't: nobody swings.
        this.pose(7);
        await this.runAMissile(m[7]!.loc, p, 8, 1, 11, 100);
        break;
      }
      case 376: case 377: say('Oh Hell.', m[24]!.loc); break;
      case 378: {
        const p = { ...L[23]! };
        p.x++;
        s.creatureState[24] = 6;
        s.creatureTarget[24] = p;
        const q = { ...L[24]! };
        q.x--;
        s.creatureState[7] = 6;
        s.creatureTarget[7] = q;
        break;
      }
      case 379: case 380: say('Takos?', m[24]!.loc); break;
      case 381: case 382: say('Yes?', m[7]!.loc); break;
      case 383: case 384: say('It is time to deal with Exile.', m[24]!.loc); break;
      case 385: case 386: say('Yes, Garzahd.', m[7]!.loc); break;
      case 387:
        // Back to Exile, and the pad is gone. The caption is still placed by
        // the camera as the frame began.
        s.center = { ...L[0]! };
        s.terrain[5]![15] = 0;
        say('Exile struck down the Emperor.', cap);
        break;
      case 388: case 389: say('Exile struck down the Emperor.', cap); break;
      case 390: case 391: say('Four years later ...', cap); break;
      case 392:
        // The Empire's soldiers arrive: four in front, two behind.
        this.startMissileAnim();
        for (let k = 3; k < 7; k++) this.flash(L[k]!, 5);
        this.flash(L[16]!, 5);
        this.flash(L[17]!, 4);
        await this.doExplosionAnim(1);
        for (let k = 3; k < 7; k++) this.bring(17 + k, L[k]!);
        this.bring(14, L[16]!);
        this.bring(15, L[17]!);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      case 393:
        this.startMissileAnim();
        this.flash(L[7]!, 8);
        this.flash(L[8]!, 8);
        await this.doExplosionAnim(1);
        this.bring(7, L[7]!);
        this.bring(19, L[8]!);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        break;
      case 394:
        this.startMissileAnim();
        this.flash(L[9]!);
        await this.doExplosionAnim(1);
        this.bring(24, L[9]!);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        this.bring(12, L[10]!);
        this.bring(13, L[11]!);
        this.bring(17, L[12]!);
        this.bring(18, L[13]!);
        break;
      case 395: case 396: case 397: say('... the Empire invaded.', cap); break;
      case 400:
        // Everyone picks a fight.
        s.creatureState[20] = 113;
        s.creatureState[21] = 113;
        s.creatureState[22] = 117;
        s.creatureState[23] = 117;
        s.creatureState[14] = 112;
        s.creatureState[15] = 118;
        s.creatureState[12] = 120;
        s.creatureState[13] = 121;
        s.creatureState[17] = 122;
        s.creatureState[18] = 123;
        break;
      case 401:
        m[16]!.loc = { ...L[11]! };
        m[11]!.loc = { ...L[12]! };
        break;
      case 402:
        this.pose(119);
        await this.runAMissile(m[19]!.loc, m[12]!.loc, 4, 1, 11, 100);
        await this.boomSpace(m[12]!.loc, r * 10 + 13, 2);
        tail = false;
        break;
      case 403:
        this.pose(116);
        await this.runAMissile(m[16]!.loc, L[7]!, 2, 1, 11, 100);
        this.startMissileAnim();
        for (const i of [20, 21, 14, 7]) this.addExplosion(m[i]!.loc, -1, 0, 0);
        await this.doExplosionAnim(0);
        this.endMissileAnim();
        break;
      case 404:
        this.pose(124);
        await this.runAMissile(m[24]!.loc, L[12]!, 2, 1, 11, 100);
        this.startMissileAnim();
        for (const i of [17, 18, 11]) this.addExplosion(m[i]!.loc, -1, 0, 0);
        await this.doExplosionAnim(0);
        this.endMissileAnim();
        this.kill(11);
        tail = false;
        break;
      case 406:
        this.pose(115);
        await this.boomSpace(m[18]!.loc, r * 10 + 13, 2);
        this.kill(18);
        tail = false;
        break;
      case 407:
        this.pose(120);
        await this.boomSpace(m[12]!.loc, r * 10 + 13, 1);
        this.kill(12);
        tail = false;
        break;
      case 408: case 409: sayNow('Exile was outgunned ....'); break;
      case 410: case 411: sayNow('... and outnumbered.'); break;
      case 412: case 413: case 414: sayNow('The Empire War was thought lost ...'); break;
      case 415: case 416: sayNow('... until Exile found an ally.'); break;
      case 417: {
        // Two Vahnatai.
        this.startMissileAnim();
        const p = { ...L[10]! };
        p.y--;
        const q = { ...L[13]! };
        q.y--;
        this.flash(p, 8);
        this.flash(q, 8);
        await this.doExplosionAnim(1);
        m[25]!.loc = p;
        m[26]!.loc = q;
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        tail = false;
        break;
      }
      case 418: case 419: case 420: sayNow('The alien Vahnatai joined you ...'); break;
      case 421:
        this.pose(125);
        await this.runAMissile(m[25]!.loc, m[19]!.loc, 7, 1, 11, 100);
        await this.boomSpace(m[19]!.loc, r * 10 + 13, 2);
        this.kill(19);
        tail = false;
        break;
      case 422:
        this.pose(126);
        await this.runAMissile(m[26]!.loc, L[0]!, 14, 1, 25, 200);
        this.startMissileAnim();
        for (const i of [14, 15, 21, 22]) this.addExplosion(m[i]!.loc, -1, 0, 0);
        await this.doExplosionAnim(1);
        for (const i of [14, 15, 21, 22]) this.remove(i);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        tail = false;
        break;
      case 423: case 424: case 425: sayNow('... and turned the tide.'); break;
      case 426:
        this.startMissileAnim();
        this.flash(L[9]!);
        await this.doExplosionAnim(1);
        this.remove(24);
        await this.doExplosionAnim(2);
        this.endMissileAnim();
        tail = false;
        break;
      case 427: case 428: case 429: sayNow('The Empire was expelled.'); break;
      case 430:
        // Over to the black square, and the stage cleared.
        s.center = loc(4, 4);
        for (let i = 0; i < 60; i++) {
          m[i]!.loc.x = 50;
          s.creatureState[i] = -1;
        }
        break;
      case 431: case 432: say('Exile won the Empire war.', cap); break;
      case 433: case 434: say('Five years passed.', cap); break;
      case 435: case 436: case 437: say('Nothing was heard from the Empire.', cap); break;
      case 438: case 439: say('The Exiles decided ...', cap); break;
      case 440: case 441: say('... that it was time to return ...', cap); break;
      case 442: case 443: say('... to the surface.', cap); break;
      case 444: case 445: say('They built a teleporter ...', cap); break;
      case 446: case 447: say('... and formed Upper Exile ...', cap); break;
      case 448: case 449: say('... a new series of caves ...', cap); break;
      case 450: case 451: say('... just below the surface.', cap); break;
      case 452: case 453: say('They then selected someone ...', cap); break;
      case 454: case 455: say('... to explore the surface ...', cap); break;
      case 456: case 457: say('... for the first time:', cap); break;
      case 458: case 459: say('You.', s.center); break;
      case 460:
        // You, being tested.
        s.center = { ...L[0]! };
        m[19]!.loc = { ...L[7]! };
        m[14]!.loc = { ...L[0]! };
        m[14]!.loc.y++;
        m[11]!.loc = { ...L[8]! };
        pc[0]!.loc = { ...L[0]! };
        pc[0]!.loc.x -= 4;
        break;
      case 461: case 462: say('Your testing was extensive ...', cap); break;
      case 463:
        s.pcState[0] = 6;
        s.pcTarget[0] = { ...L[0]! };
        s.pcTarget[0].x += 4;
        break;
      case 465:
        this.pose(119);
        await this.runAMissile(m[19]!.loc, pc[0]!.loc, 4, 1, 11, 120);
        await this.boomSpace(pc[0]!.loc, r * 10 + 13, 3);
        break;
      case 467:
        this.pose(114);
        await this.boomSpace(pc[0]!.loc, r * 10 + 13, 2);
        break;
      case 469:
        this.pose(111);
        await this.runAMissile(m[11]!.loc, pc[0]!.loc, 2, 1, 11, 120);
        await this.runABoom(pc[0]!.loc, 0);
        break;
      case 471: case 472: say('... and very painful.', cap); break;
      case 473:
        // The briefing, under a tree.
        s.center = { ...L[30]! };
        s.center.y--;
        s.pcState[0] = -1;
        pc[1]!.loc = { ...L[26]! };
        pc[0]!.loc = { ...L[27]! };
        pc[2]!.loc = { ...L[28]! };
        m[24]!.loc = { ...L[29]! };
        break;
      case 474: case 475: say('Your briefing was considerable ...', cap); break;
      case 476: case 477: say('This ...', m[24]!.loc); break;
      case 478: case 479: say('... is a TREE!', m[24]!.loc); break;
      case 480:
        s.pcState[0] = 6;
        s.pcTarget[0] = { ...L[30]! };
        break;
      case 483: case 484: say("What's it for?", pc[0]!.loc); break;
      case 485: case 486: say('... and confusing.', cap); break;
      case 487:
        s.center = loc(4, 4);
        break;
      // The briefing proper, three above the camera's own square.
      case 488: case 489: case 490: say('You were sent up to Fort Emergence   ', s.center); break;
      case 491: case 492: case 493: say('in Upper Exile. You are to go see  ', s.center); break;
      case 494: case 495: case 496: say('someone named Anaximander to get your   ', s.center); break;
      case 497: case 498: case 499: say('orders, and then go up to the surface.    ', s.center); break;
      case 501: case 502: say('All Exile waits on you.', s.center); break;
      case 503: case 504: case 505: say("All wait to see what you'll find.  ", s.center); break;
      case 506: case 507: case 508: say('They want to return to the surface.    ', s.center); break;
      case 509: case 510: case 511: say('You carry the dreams of your people.  ', s.center); break;
      case 512: case 513: case 514: case 515: say('Good luck.', s.center); break;
      default:
        break;
    }
    if (!tail) return;
    // The camera drifts down, then back up, past the history's lines.
    if (f > 333 && f <= 345) s.center.y++;
    if (f > 347 && f <= 359) s.center.y--;
    await this.walkPcs();
    await this.walkCreatures();
    s.posing = -1;
    this.redraw();
  }
}
