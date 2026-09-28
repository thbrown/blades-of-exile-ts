/**
 * Aiming from the keyboard (or the touch pad): where a spell or missile's
 * target square starts, and where a direction moves it. Not in the original,
 * where the arrows during targeting act on the square next to the caster
 * like a click there; this port puts a cursor on the nearest enemy instead
 * and lets the arrows move it. Confirming the cursor is exactly a click on
 * its square, so the rules and the recordings never see the difference.
 *
 * **Nothing here may roll a die** (`get_ran`'s call order is part of the
 * spec): the sight tests used are the pure ones the target lock uses too.
 */

import { Direction, Location, dist, fdist, shiftLoc } from '../core/location';
import { Attitude } from '../data/monster';
import { SIGHT_BLOCKED } from '../core/sight';
import { GameMode, isCombat, isScrollable } from './modes';
import type { GameSession } from './session';

/** How far from the view's centre a square can be and still be drawn (the 9×9 view). */
const VIEW_RADIUS = 4;

/** What is being aimed and from where, or null when nothing is. */
export interface Aiming {
  from: Location;
  range: number;
  /** A multi-target spell's squares so far, which the next pick skips. */
  chosen: readonly Location[];
  /**
   * Identifies this aim: a new spell, missile or pick gets a fresh one, and
   * the cursor goes back to the nearest enemy.
   */
  token: unknown;
  picks: number;
}

/**
 * The aim in progress. Outdoors the C++ draws no targeting at all, so there
 * is nothing to aim a cursor at, and dropping an item is left to the mouse.
 */
export function currentAim(session: GameSession): Aiming | null {
  if (!session.univ.town) return null;
  const caster = isCombat(session.mode) || session.missile !== null
    ? session.univ.currentPc.combatPos
    : session.univ.party.townLoc;
  if (session.spellTargeting) {
    const t = session.spellTargeting;
    return { from: caster, range: t.range, chosen: t.targets, token: t, picks: t.targets.length };
  }
  if (session.townTarget) {
    return { from: caster, range: session.townTarget.range, chosen: [], token: session.townTarget, picks: 0 };
  }
  if (session.missile) {
    return { from: caster, range: session.missile.range, chosen: [], token: session.missile, picks: 0 };
  }
  return null;
}

function onView(session: GameSession, at: Location): boolean {
  const c = session.center;
  return Math.abs(at.x - c.x) <= VIEW_RADIUS && Math.abs(at.y - c.y) <= VIEW_RADIUS;
}

/** Whether a shot from `from` could land on `at`: in sight, and in reach. */
export function canAimAt(session: GameSession, aim: Aiming, at: Location): boolean {
  return session.canSeeLight(aim.from, at) < SIGHT_BLOCKED && dist(aim.from, at) <= aim.range;
}

/**
 * Where the cursor starts: the nearest hostile the party can see, on the
 * view, that a shot can reach and that this spell hasn't already picked.
 * Failing that the nearest visible one out of reach — so the player can see
 * why — and failing that the caster's own square.
 */
export function autoAim(session: GameSession, aim: Aiming): Location {
  const town = session.univ.town;
  const seen: Location[] = [];
  for (const monst of town?.monsters ?? []) {
    if (!monst.isAlive || monst.mon.invisible) continue;
    if (monst.attitude !== Attitude.HOSTILE_A && monst.attitude !== Attitude.HOSTILE_B) continue;
    if (!session.partyCanSeeMonst(monst)) continue;
    const at = monst.curLoc;
    if (!onView(session, at)) continue;
    if (aim.chosen.some((c) => c.x === at.x && c.y === at.y)) continue;
    seen.push({ ...at });
  }
  const nearest = (from: readonly Location[]): Location | null => {
    let best: Location | null = null;
    let bestD = Infinity;
    for (const p of from) {
      const d = fdist(aim.from, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };
  return nearest(seen.filter((p) => canAimAt(session, aim, p))) ?? nearest(seen) ?? { ...aim.from };
}

/**
 * The cursor one square `dir`. Past the edge of the 9×9 view it takes the
 * view with it where the view may scroll — `screen_shift`, exactly what the
 * border arrows round the terrain do in those modes (`isScrollable`) — and
 * otherwise stops at the edge: a town spell can't scroll the view, in the
 * original either.
 */
export function moveAim(session: GameSession, at: Location, dir: Direction): Location {
  const next = shiftLoc(at, dir);
  const c = session.center;
  const over = (v: number, mid: number): number => (v > mid + VIEW_RADIUS ? 1 : v < mid - VIEW_RADIUS ? -1 : 0);
  const dx = over(next.x, c.x);
  const dy = over(next.y, c.y);
  if ((dx !== 0 || dy !== 0) && isScrollable(session.mode)) {
    session.screenShift(dx, dy);
    return next;
  }
  return {
    x: Math.max(c.x - VIEW_RADIUS, Math.min(c.x + VIEW_RADIUS, next.x)),
    y: Math.max(c.y - VIEW_RADIUS, Math.min(c.y + VIEW_RADIUS, next.y)),
  };
}

/** What Space does while aiming, for the touch pad's label; null when it does nothing. */
export function aimSpaceAction(session: GameSession): 'cast' | 'rotate' | null {
  if (session.mode === GameMode.FANCY_TARGET) return 'cast';
  if (session.mode === GameMode.SPELL_TARGET && session.forceWallPosition < 10) return 'rotate';
  return null;
}
