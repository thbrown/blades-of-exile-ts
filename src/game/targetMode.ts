/**
 * `handle_target_mode` (boe.newgraph.cpp:1102) — entering a targeting mode, and
 * the **target lock** that scrolls the view onto the enemies while it does.
 *
 * **This is here because it spends dice.** The lock ends in `draw_terrain()`,
 * which ends in `draw_text_bar()`, which asks `pc_can_cast_spell` whether to
 * print "Recast X" or "Cannot recast" — and that rolls `total_encumbrance` in
 * combat. See `textBar.ts` for the rule; this file is one of the five places
 * the C++ calls the redraw that pays for it.
 *
 * The lock itself is not cosmetic either: it moves `center`, which is the
 * origin every recorded `move` was built from and what `screen_shift` bounds
 * itself against.
 *
 * Two gates before any of it: the recording's `target-lock` feature flag, and
 * the `TargetLock` preference — which no recording in the corpus sets, so it
 * takes its default of true (`get_bool_pref("TargetLock", true)`).
 */

import { Location, SCREEN_RADIUS, dist, fdist, isOnScreen } from '../core/location';
import { SPELLS, Spell } from '../data/spell';
import { Attitude } from '../data/monster';
import { hasFeatureFlag } from './featureFlags';
import { drawTerrain } from './textBar';
import type { GameSession } from './session';

/**
 * `points_containing_most` (location.cpp:370) — every view centre that shows
 * the most of `points`, out of those that show all of `required`.
 *
 * The C++ sweeps the points' bounding box grown by `SCREEN_RADIUS - padding`
 * and counts what each candidate sees, so its output can name squares off the
 * map; `closestPoint` against an on-map anchor is what removes them, and the
 * comment there says so.
 *
 * **Order matters and the C++'s is not defined.** It `std::sort`s the
 * candidates by count — an unstable sort — and then keeps every one with the
 * maximum. The order that survives decides which of two equally close centres
 * `closestPoint` returns. This keeps the sweep order (x outer, y inner), which
 * is what a *stable* sort would have left, and is the only defensible choice.
 */
export function pointsContainingMost(
  points: readonly Location[], required: readonly Location[], padding = 1,
): Location[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const r = SCREEN_RADIUS - padding;
  minX -= r; minY -= r; maxX += r; maxY += r;

  const seen = (from: Location, of: readonly Location[]): number =>
    of.reduce((n, p) => (isOnScreen(p, from, r) ? n + 1 : n), 0);

  const candidates: { at: Location; count: number }[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const at = { x, y };
      if (seen(at, required) < required.length) continue;
      candidates.push({ at, count: seen(at, points) });
    }
  }
  if (candidates.length === 0) return [];
  const best = candidates.reduce((m, c) => Math.max(m, c.count), -Infinity);
  return candidates.filter((c) => c.count === best).map((c) => c.at);
}

/**
 * `closest_point` (location.cpp:436) — nearest by *float* distance, first one
 * wins a tie. The C++ indexes the result without checking, so an empty list is
 * undefined behaviour there and simply never happens: every caller has already
 * tested the vector.
 */
export function closestPoint(points: readonly Location[], anchor: Location): Location {
  let best = points[0]!;
  let bestD = Infinity;
  for (const p of points) {
    const d = fdist(p, anchor);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * `handle_target_mode`'s body, minus the `overall_mode` assignment its callers
 * already do here.
 *
 * `spell` is `eSpell::NONE` for a missile, and the `target_lock` column of the
 * spell table gates it for anything else — a spell that does not aim at an
 * enemy leaves the view alone. Note the C++ `return`s in that case, so nothing
 * below it runs and no redraw happens.
 */
/**
 * The `TargetLock` preference (on by default). A module hook, like the other
 * preferences the rules read, so replays — which never set it — keep the
 * default.
 */
let targetLockPref = true;

export function setTargetLockPref(on: boolean): void {
  targetLockPref = on;
}

export function handleTargetMode(
  session: GameSession, range: number, spell: Spell = Spell.NONE,
): void {
  // `has_feature_flag("target-lock", "V1") && get_bool_pref("TargetLock", true)`
  // (boe.newgraph.cpp:1106).
  if (!hasFeatureFlag('target-lock', 'V1') || !targetLockPref) return;
  if (spell !== Spell.NONE && !(SPELLS[spell]?.targetLock ?? false)) return;

  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const from = univ.currentPc.combatPos;

  const inRange: Location[] = [];
  const alreadySeen: Location[] = [];
  for (const monst of town.monsters) {
    if (!monst.isAlive || monst.mon.invisible) continue;
    if (!session.partyCanSeeMonst(monst)) continue;
    const att = monst.attitude;
    if (att !== Attitude.HOSTILE_A && att !== Attitude.HOSTILE_B) continue;
    if (dist(from, monst.curLoc) > range) continue;
    // V2 refuses to scroll an enemy off the screen to bring others on.
    if (hasFeatureFlag('target-lock', 'V2')
      && isOnScreen(monst.curLoc, session.center, SCREEN_RADIUS)) {
      alreadySeen.push({ ...monst.curLoc });
    }
    inRange.push({ ...monst.curLoc });
  }
  if (inRange.length === 0) return;

  const candidates = pointsContainingMost(inRange, alreadySeen);
  if (candidates.length > 0) session.center = closestPoint(candidates, from);
  drawTerrain(session);
}
