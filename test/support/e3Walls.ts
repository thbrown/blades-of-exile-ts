/**
 * A search through a town whose walls move (Exile III's Concealed Tunnel,
 * `src/game/e3MovingWalls.ts`): which squares the party can reach, and in
 * how many turns, stepping, waiting and pushing crates while the walls go
 * up and down around it.
 *
 * The engine moves walls with a 48×48 scan, far too slow to run once per
 * searched state, so this carries a model of the same rules over a list of
 * walls. `stepWalls` is checked against the engine's `moveE3Walls` turn by
 * turn (`test/e3quests.test.ts`), so the two can't drift apart.
 *
 * The model of a step is BoE 1997's `town_move_party` with its crate push:
 * a crate that can't go on trades squares with the party (`push_loc` gives
 * back the pusher's square), and one pushed into a pit or water is gone.
 * Doors and false walls are taken as open, which costs a real party one
 * turn each. Creatures are left out: the test clears them first.
 */

import { FieldType } from '../../src/data/fields';
import { TerObstruct } from '../../src/data/terrain';
import { WALL_FLOOR, WALL_NORTH, WALL_SOUTH } from '../../src/game/e3MovingWalls';
import type { QuestRunner } from './e3Quest';

const W = 48;
const cell = (x: number, y: number): number => x * W + y;
const NORTH = 1, SOUTH = 2;
const MOVES: [number, number][] = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** A lever: the square that pulls it, and the squares it opens. */
export interface Lever { at: [number, number]; opens: [number, number][] }

export interface WallState {
  party: number;
  crates: number[];
  /** `cell * 4 + dir`, sorted; one shared array per layout (`WallSearch.intern`). */
  walls: number[];
  levers: number;
}

export class WallSearch {
  /** Squares a wall may stand on or move onto: floor, and where walls start. */
  private readonly track = new Uint8Array(W * W);
  /** Squares the party can't enter whatever the walls do. */
  private readonly solid = new Uint8Array(W * W);
  /** Where a pushed crate is lost: a pit or water. */
  private readonly sink = new Uint8Array(W * W);
  /** Squares that crush a carried party: E3's blockage 1, 4 or 5. */
  private readonly crush = new Uint8Array(W * W);
  /** Fields that stop a wall and are never moved: barriers, quickfire, webs, barrels. */
  private readonly stuck = new Uint8Array(W * W);
  private readonly shut = new Map<number, number>();
  private readonly scratch = new Uint8Array(W * W);
  readonly start: WallState;

  /** Which crates the party may push; the rest are left where they are. */
  pushable: (x: number, y: number) => boolean = () => true;

  constructor(q: QuestRunner, private readonly levers: Lever[] = [],
    private readonly teleports: Map<number, number> = new Map()) {
    const town = q.town;
    const crates: number[] = [];
    const walls: number[] = [];
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < W; y++) {
        const c = cell(x, y);
        let t = town.record.terrain[x]![y]!;
        let info = q.univ.terrainType(t);
        // A door or false wall, walked into, opens.
        if (info.special === 1 && info.flag1 >= 0) { t = info.flag1; info = q.univ.terrainType(t); }
        if (t === WALL_NORTH || t === WALL_SOUTH) {
          walls.push(c * 4 + (t === WALL_NORTH ? NORTH : SOUTH));
          this.track[c] = 1;
        } else if (t === WALL_FLOOR) this.track[c] = 1;
        const b = info.blockage;
        if (b === TerObstruct.BLOCK_MOVE || b === TerObstruct.BLOCK_MOVE_AND_SHOOT || b === TerObstruct.BLOCK_MOVE_AND_SIGHT) this.solid[c] = 1;
        if (t === WALL_NORTH || t === WALL_SOUTH) this.solid[c] = 0;
        if (b === TerObstruct.BLOCK_SIGHT || b >= TerObstruct.BLOCK_MOVE_AND_SHOOT) this.crush[c] = 1;
        if (t === WALL_NORTH || t === WALL_SOUTH) this.crush[c] = 0;
        if (t === 86 || info.boatOver) this.sink[c] = 1;
        if (town.hasField(x, y, FieldType.OBJECT_CRATE)) crates.push(c);
        for (const f of [FieldType.BARRIER_FIRE, FieldType.BARRIER_FORCE, FieldType.FIELD_QUICKFIRE, FieldType.FIELD_WEB, FieldType.OBJECT_BARREL]) {
          if (town.hasField(x, y, f)) { this.stuck[c] = 1; this.solid[c] = 1; }
        }
      }
    }
    // A lever's portcullis is shut by the lever, not by its terrain.
    levers.forEach((l, i) => { for (const [x, y] of l.opens) { this.shut.set(cell(x, y), i); this.solid[cell(x, y)] = 0; } });
    const p = q.at;
    this.start = { party: cell(p.x, p.y), crates: crates.sort((a, b) => a - b), walls: walls.sort((a, b) => a - b), levers: 0 };
  }

  /** Each wall layout once, with a number, so a state's key stays short. */
  private readonly layouts = new Map<string, { id: number; walls: number[] }>();
  private readonly wallId = new WeakMap<number[], number>();
  /** `stepWalls`, remembered by layout and crates. */
  private readonly stepped = new Map<string, number[]>();

  private intern(walls: number[]): number[] {
    const k = walls.join(',');
    let e = this.layouts.get(k);
    if (!e) {
      e = { id: this.layouts.size, walls };
      this.layouts.set(k, e);
      this.wallId.set(walls, e.id);
    }
    return e.walls;
  }

  key(s: WallState): string {
    return `${s.party}|${s.levers}|${s.crates.join(',')}|${this.wallId.get(this.intern(s.walls))}`;
  }

  private stepShared(walls: number[], crates: number[]): number[] {
    const k = `${this.wallId.get(this.intern(walls))}|${crates.join(',')}`;
    let out = this.stepped.get(k);
    if (!out) {
      out = this.intern(this.stepWalls(walls, new Set(crates)));
      this.stepped.set(k, out);
    }
    return out;
  }

  /** One turn of the walls, E3's two passes, given where the crates are. */
  stepWalls(walls: number[], crates: Set<number>): number[] {
    const g = this.scratch;
    g.fill(0);
    for (const w of walls) g[w >> 2] = w & 3;
    const floor = (c: number): boolean => this.track[c] === 1 && g[c] === 0;
    const free = (c: number): boolean => !crates.has(c) && this.stuck[c] === 0;
    for (let x = 1; x < W; x++) {
      for (let y = 1; y < W; y++) {
        const c = cell(x, y);
        if (g[c] !== NORTH) continue;
        if (floor(c - 1) && free(c - 1)) { g[c] = 0; g[c - 1] = NORTH; } else g[c] = SOUTH;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = W - 2; y > 0; y--) {
        const c = cell(x, y);
        if (g[c] !== SOUTH) continue;
        if (floor(c + 1) && free(c + 1)) { g[c] = 0; g[c + 1] = SOUTH; } else g[c] = NORTH;
      }
    }
    const out: number[] = [];
    for (let c = 0; c < W * W; c++) if (g[c]) out.push(c * 4 + g[c]!);
    return out;
  }

  private blocked(c: number, s: WallState, wallAt: Set<number>): boolean {
    if (this.solid[c] || wallAt.has(c)) return true;
    const lever = this.shut.get(c);
    return lever !== undefined && (s.levers & (1 << lever)) === 0;
  }

  /** The state one turn on from `s` after a move (null for one that isn't possible or kills). */
  after(s: WallState, dx: number, dy: number): WallState | null { return this.next(s, dx, dy); }

  private next(s: WallState, dx: number, dy: number): WallState | null {
    const px = Math.floor(s.party / W), py = s.party % W;
    const tx = px + dx, ty = py + dy;
    if (tx < 0 || ty < 0 || tx >= W || ty >= W) return null;
    const wallAt = new Set(s.walls.map((w) => w >> 2));
    const crates = new Set(s.crates);
    let to = cell(tx, ty);
    let levers = s.levers;
    if (to !== s.party) {
      if (this.blocked(to, s, wallAt)) return null;
      if (crates.has(to)) {
        if (!this.pushable(tx, ty)) return null;
        const bx = tx + dx, by = ty + dy;
        const beyond = cell(bx, by);
        crates.delete(to);
        if (bx >= 0 && by >= 0 && bx < W && by < W && this.sink[beyond]) { /* gone */ }
        else if (bx < 0 || by < 0 || bx >= W || by >= W || this.blocked(beyond, s, wallAt) || crates.has(beyond)) crates.add(s.party);
        else crates.add(beyond);
      }
      const lever = this.levers.findIndex((l) => cell(l.at[0], l.at[1]) === to);
      if (lever >= 0) levers ^= 1 << lever;
      // A teleport moves the party and takes no turn: the walls stay put.
      const through = this.teleports.get(to);
      if (through !== undefined) return { party: through, crates: [...crates].sort((a, b) => a - b), walls: s.walls, levers };
    }
    const sorted = [...crates].sort((a, b) => a - b);
    const walls = this.stepShared(s.walls, sorted);
    // Carried by a wall that came onto the party's square, and crushed if
    // carried onto anything that blocks.
    const onto = walls.find((w) => w >> 2 === to);
    if (onto !== undefined) {
      const carried = (onto & 3) === NORTH ? to - 1 : to + 1;
      if (this.crush[carried] || walls.some((w) => w >> 2 === carried)) return null;
      if (crates.delete(carried)) sorted.splice(sorted.indexOf(carried), 1);
      to = carried;
    }
    return { party: to, crates: sorted, walls, levers };
  }

  /**
   * Breadth-first from `from` until `goal` holds: the moves taken (each a
   * step, or [0, 0] to wait a turn) and the state reached, or null within
   * `maxTurns`.
   */
  search(from: WallState, goal: (s: WallState) => boolean, maxTurns = 200, maxStates = 400_000): { moves: [number, number][]; state: WallState } | null {
    interface Node { s: WallState; parent: Node | null; move: [number, number] }
    const seen = new Set([this.key(from)]);
    let frontier: Node[] = [{ s: from, parent: null, move: [0, 0] }];
    for (let turn = 0; turn <= maxTurns && frontier.length; turn++) {
      const hit = frontier.find((n) => goal(n.s));
      if (hit) {
        const moves: [number, number][] = [];
        for (let n: Node | null = hit; n?.parent; n = n.parent) moves.unshift(n.move);
        return { moves, state: hit.s };
      }
      const nextFrontier: Node[] = [];
      for (const node of frontier) {
        for (const move of MOVES) {
          const n = this.next(node.s, move[0], move[1]);
          if (!n) continue;
          const k = this.key(n);
          if (seen.has(k)) continue;
          seen.add(k);
          nextFrontier.push({ s: n, parent: node, move });
        }
      }
      if (seen.size > maxStates) throw new Error(`wall search: over ${maxStates} states by turn ${turn}`);
      frontier = nextFrontier;
    }
    return null;
  }

  /** The party's square in a state. */
  static at(s: WallState): { x: number; y: number } { return { x: Math.floor(s.party / W), y: s.party % W }; }
  static cellOf(x: number, y: number): number { return cell(x, y); }
}
