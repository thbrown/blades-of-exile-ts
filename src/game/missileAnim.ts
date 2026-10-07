/**
 * `run_a_missile` (boe.newgraph.cpp:297) — the projectile that flies across the
 * terrain view: an arrow, a spear, a web, a ray, a gout of breath.
 *
 * The C++ is `start_missile_anim` / `add_missile` / `do_missile_anim` /
 * `end_missile_anim`, and `do_missile_anim` **blocks**, stepping the sprite
 * along its path and sleeping a couple of milliseconds per step before the shot
 * resolves. This port can't block, so it uses the same arrangement `booms.ts`
 * uses: the request goes to a sink the renderer owns, which keeps the missile
 * for its flight time and redraws until it lands. Same thing on screen, and the
 * shot resolves at once rather than after the flight — the one visible
 * difference is that the hit's explosion pops while the arrow is still in the
 * air.
 *
 * The camera **does** follow the shot (`camera_dest` and the `recentered`
 * branch of the flight loop): the view opens framing the shooter and the
 * target together, and swings onto the target half way through the flight.
 * See `runAMissile` for what's faithful about that and what isn't.
 */

import { Location, betweenAnchorPoints } from '../core/location';
import { livingSound } from '../universe/living';
import { animAt, animBook, focusAt, paced } from './anim';

/**
 * How long a missile takes to cross, in ms. The C++ sleeps
 * `2 + 5 * GameSpeed` per step over `num_steps` steps, so at the default speed
 * a 100-step shot is about 200ms.
 *
 * `missileMs()` is this stretched by the play-testing pace — use it anywhere
 * the *current* flight time is wanted; the bare constant is the faithful one.
 */
export const MISSILE_MS = 200;

/**
 * **Play-testing, not the original.** A projectile crosses the whole view in
 * one hop, so at the same multiplier as everything else it still reads as a
 * flicker next to a paced turn — and a shot you can't follow is the thing
 * most worth watching in a fight. Folded in on top of the shared pace so the
 * two knobs stay separate: set this to 1 to go back to the C++'s proportions.
 */
const MISSILE_EXTRA = 2.5;

export function missileMs(): number {
  return paced(MISSILE_MS * MISSILE_EXTRA);
}

/**
 * **1997's hold, which OBoE dropped.** `do_missile_anim` (1997 NEWGRAPH.CPP,
 * and Exile III's the same) notes the time as it starts, and after the flight
 * spins until `pause_len + 40` ms have passed, `pause_len` being the length
 * of the launch sound: 660 for sound 11 (fire: Fireball, Flame), 410 for 12,
 * 200 for 14, 1000 for 53, 500 for 64. So a fireball lasts as long as its
 * whoosh and the blast comes after it, where OBoE's lands mid-sound. A player
 * can tell, and no die is rolled, so this port has the original's
 * (DIVERGENCES.md's rule). Paced like everything else.
 */
const SOUND_HOLD_MS: Readonly<Record<number, number>> = { 11: 660, 12: 410, 14: 200, 53: 1000, 64: 500 };

/** What a missile volley with sound `soundNum` holds the turn for, at least. */
export function missileHoldMs(soundNum: number): number {
  const hold = SOUND_HOLD_MS[soundNum];
  return hold === undefined ? 0 : paced(hold + 40);
}

/**
 * Book whatever of the hold is left, counted from `t0`, the timeline slot the
 * flight (or the whole volley) started at, as 1997 counts from its
 * `GetCurrentTime()`: an empty slot, so what follows waits for it.
 */
export function holdForSound(soundNum: number, t0: number): void {
  const left = t0 + missileHoldMs(soundNum) - animAt();
  if (left > 0) animBook(left);
}

/** One missile in flight. `store_missiles[i]` in the C++. */
export interface Missile {
  from: Location;
  dest: Location;
  /**
   * The row in missiles.png. Types 0-6 are directional (the column is the
   * heading); 7 and up are animated (the column cycles with the step).
   */
  type: number;
  /** 0 = straight, 1 = a lobbed arc. */
  pathType: number;
  xAdj: number;
  yAdj: number;
  /** `num_steps` — both the frame count and the divisor for the arc. */
  len: number;
  /** When this missile launches, on the shared animation timeline. */
  started: number;
  /**
   * How long this one's flight lasts. Carried on the missile rather than read
   * from `missileMs()` at draw time so that changing the pace mid-fight can't
   * make something already in the air jump or stall.
   */
  dur: number;
}

let sink: ((missile: Missile) => void) | null = null;

export function setMissileSink(fn: ((missile: Missile) => void) | null): void {
  sink = fn;
}

/**
 * run_a_missile. `soundNum` is a sound *file*, not a damage type — the C++
 * passes it as `play_sound(-1 * sound_num)`, where the sign only means "don't
 * block on it", which is what our sound layer does anyway.
 */
/**
 * `center` is a **global** in the C++ (`extern location center`) and
 * `do_missile_anim` writes it twice — once to frame the shooter and the target
 * together and once onto the target half way through the flight
 * (boe.newgraph.cpp:392 and :453) — and **never puts it back**. That leaks out
 * of the graphics and into the *rules*: `party_can_see`'s town branch is
 * `(point_onscreen(town_loc, w) || center != town_loc) && pt_in_light(...) &&
 * can_see_light(...)`, so from the moment a missile has moved the camera every
 * square in the town passes the first term, until `do_monster_turn`'s tail
 * restores it. A creature nine squares away is then visible to
 * `party_can_see_monst` where it was not a moment before.
 *
 * This port keeps `center` on the session and its camera on an animation
 * timeline, so the two have to be bridged: a module-level hook, the same
 * arrangement `living.ts` uses and for the same reason — the C++ keeps the
 * thing static and it is written from places that have no session to hand.
 */
let centreSink: ((where: Location) => void) | null = null;

export function setCentreSink(fn: ((where: Location) => void) | null): void {
  centreSink = fn;
}

export function runAMissile(
  from: Location,
  dest: Location,
  type: number,
  pathType: number,
  soundNum: number,
  xAdj = 0,
  yAdj = 0,
  len = 100,
  hold = true,
): void {
  // do_missile_anim plays its sound before the flight loop, and before the
  // per-missile setup has thrown anything away (boe.newgraph.cpp:429) — so a
  // missile that draws nothing still makes its noise. Raised before the
  // booking below, so it is heard as the missile *launches*.
  // `play_sound(-1 * sound_num)`: asynchronous, so the flight isn't held up.
  if (soundNum > 0) livingSound(-soundNum);
  if (type < 0) return;
  // "Eliminate missiles traveling 0 distance" — do_missile_anim drops any
  // missile whose destination is where it started.
  if (from.x === dest.x && from.y === dest.y) return;
  // The C++ blocks here for the whole flight, so whatever comes next — the hit,
  // the next monster's shot — happens after the missile lands. Booking the
  // slot on the shared timeline is how that ordering survives without blocking.
  const dur = missileMs();
  const started = animBook(dur);
  // The camera work, `do_missile_anim`'s `camera_dest`/`recentered` pair: the
  // view opens on a centre that frames the shooter and the target together,
  // and swings onto the target's own frame half way through the flight
  // (`t == num_steps / 2`). Two divergences, both in this port's favour:
  // - The C++'s other trigger — "the tracked missile has left the terrain
  //   rect" — isn't ported. Here a shot always crosses in the same time, so
  //   halfway is where it would fire in every case that matters.
  // - The C++ has to offset the sprite's path by the camera delta by hand.
  //   Ours is drawn from world coordinates against the *current* centre, so
  //   the missile simply keeps flying its line while the ground slides under
  //   it, which is what the offset is emulating.
  const cameraDest = betweenAnchorPoints(dest, from);
  focusAt(betweenAnchorPoints(from, cameraDest), started);
  focusAt(cameraDest, started + dur / 2);
  // **The rules see the second write, not the first.** The C++ blocks for the
  // whole flight, so by the time anything reads `center` again it holds
  // `camera_dest`. Set synchronously, because `party_can_see` is consulted
  // between one creature's shot and the next — long before this port's camera
  // timeline has caught up.
  centreSink?.(cameraDest);
  sink?.({
    from: { ...from }, dest: { ...dest }, type, pathType, xAdj, yAdj, len, started, dur,
  });
  // A volley (`flyMissiles`) passes `hold` false and holds once for them all.
  if (hold) holdForSound(soundNum, started);
}

/**
 * get_missile_direction (boe.newgraph.cpp:517) — which of the eight sprite
 * columns a directional missile uses, from the pixel positions of its ends.
 *
 * The C++ renormalises the origin to (149,185) and then runs a set of legacy
 * half-plane tests; the odd constants and the integer `* 34 / 10` slopes are
 * ported verbatim, since they are what decides the boundaries between headings.
 */
export function getMissileDirection(
  origin: { x: number; y: number }, point: { x: number; y: number },
): number {
  const px = point.x + 149 - origin.x;
  const py = point.y + 185 - origin.y;
  let dx = 0;
  let dy = 0;

  if (px < 135 && py >= Math.trunc((px * 34) / 10) - 293
    && py <= -Math.trunc((px * 34) / 10) + 663) dx--;
  if (px > 163 && py <= Math.trunc((px * 34) / 10) - 350
    && py >= -Math.trunc((px * 34) / 10) + 721) dx++;

  if (py < 167 && py <= Math.trunc(px / 2) + 102
    && py <= -Math.trunc(px / 2) + 249) dy--;
  if (py > 203 && py >= Math.trunc(px / 2) + 123
    && py >= -Math.trunc(px / 2) + 268) dy++;

  switch (dy) {
    case 0: return 4 - 2 * dx;
    case -1: return dx === -1 ? 7 : dx;
    case 1: return 4 - dx;
    default: return 0;
  }
}
