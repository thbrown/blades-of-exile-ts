/**
 * Coordinates, directions, and rectangles.
 * Ported from ../exile-wasm/src/location.{hpp,cpp}.
 */

export enum Direction {
  N = 0,
  NE = 1,
  E = 2,
  SE = 3,
  S = 4,
  SW = 5,
  W = 6,
  NW = 7,
  Here = 8,
}

export interface Location {
  x: number;
  y: number;
}

export function loc(x = 0, y = 0): Location {
  return { x, y };
}

export function locsEqual(a: Location, b: Location): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Euclidean distance truncated to short, as in C++ `short dist = hypot(...)`. */
export function dist(a: Location, b: Location): number {
  return Math.trunc(Math.hypot(a.x - b.x, a.y - b.y));
}

export function fdist(a: Location, b: Location): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The 9x9 terrain view reaches four squares from its centre. */
export const SCREEN_RADIUS = 4;

/** is_on_screen (location.cpp:318) with an explicit centre and radius. */
export function isOnScreen(where: Location, centre: Location, radius: number): boolean {
  return where.x >= centre.x - radius && where.x <= centre.x + radius
    && where.y >= centre.y - radius && where.y <= centre.y + radius;
}

/**
 * between_anchor_points (location.cpp:325) — a centre that frames both
 * anchors, favouring `anchor1` when it can't frame both.
 *
 * The midpoint is rounded *toward* anchor1, and then walked back toward it a
 * square at a time until anchor1 is on screen. Used by the missile animation
 * to frame a shot and its target together.
 */
export function betweenAnchorPoints(
  anchor1: Location, anchor2: Location, padding = 0,
): Location {
  const cx = (anchor1.x + anchor2.x) / 2;
  const cy = (anchor1.y + anchor2.y) / 2;
  const between = {
    x: anchor1.x < anchor2.x ? Math.floor(cx) : Math.ceil(cx),
    y: anchor1.y < anchor2.y ? Math.floor(cy) : Math.ceil(cy),
  };
  const paddedRadius = SCREEN_RADIUS - padding;
  // The C++ loops until anchor1 is in frame; it always terminates because each
  // pass steps toward it. Guarded anyway, since a padding >= 4 would make the
  // test unsatisfiable and hang the tab rather than the process.
  for (let guard = 0; guard < 200; guard++) {
    if (isOnScreen(anchor1, between, paddedRadius)) break;
    if (anchor1.x < between.x - paddedRadius) between.x--;
    else if (anchor1.x > between.x + paddedRadius) between.x++;
    if (anchor1.y < between.y - paddedRadius) between.y--;
    else if (anchor1.y > between.y + paddedRadius) between.y++;
  }
  return between;
}

/** Chebyshev ("vision") distance. */
export function vdist(a: Location, b: Location): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// x/y deltas per Direction, N..Here
const DIR_X = [0, 1, 1, 1, 0, -1, -1, -1, 0] as const;
const DIR_Y = [-1, -1, 0, 1, 1, 1, 0, -1, 0] as const;

export function shiftLoc(p: Location, dir: Direction): Location {
  return { x: p.x + DIR_X[dir]!, y: p.y + DIR_Y[dir]! };
}

/** BoE rectangles are {top,left,bottom,right}, edges inclusive for contains(). */
export class Rect {
  constructor(
    public top = 0,
    public left = 0,
    public bottom = 0,
    public right = 0,
  ) {}

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }

  contains(p: Location): boolean {
    return p.y >= this.top && p.y <= this.bottom && p.x >= this.left && p.x <= this.right;
  }

  empty(): boolean {
    if (this.right < this.left || this.bottom < this.top) return true;
    return this.width === 0 && this.height === 0;
  }

  offset(dx: number, dy: number): Rect {
    return new Rect(this.top + dy, this.left + dx, this.bottom + dy, this.right + dx);
  }

  inset(dx: number, dy: number): Rect {
    return new Rect(this.top + dy, this.left + dx, this.bottom - dy, this.right - dx);
  }
}

/**
 * A C++ `short`, which is what half the game's numbers actually are — and
 * `cMonster::health` and `cCreature::health` are two of them (monster.hpp:31,
 * creature.hpp:31).
 *
 * **It is not pedantry.** `AllMageSpells` turns the difficulty up until a
 * creature's health is 140 × 3⁵ = 34,020, and in the C++ that stores as
 * **-31,516**. Every rule that divides by it then flips sign: the one that
 * mattered was `monst_check_one_special_terrain`'s `guts += health / 20`, which
 * went from +1,701 to -1,575 and turned "walks into the web" into "will not
 * go near it".
 */
export function toShort(n: number): number {
  return (n << 16) >> 16;
}

export function minmax(min: number, max: number, k: number): number {
  return Math.max(min, Math.min(max, k));
}

/**
 * percent (mathutil.cpp:...) — `value * percentage / 100` with C++'s truncating
 * integer division. Resistances are stored as percentages, so this is on the
 * hot path of every damage calculation and the truncation matters.
 */
export function percent(value: number, percentage: number): number {
  return Math.trunc((value * percentage) / 100);
}
