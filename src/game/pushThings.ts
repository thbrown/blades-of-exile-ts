/**
 * `push_things` (boe.specials.cpp:1683) — conveyor belts, run once per turn.
 *
 * Every creature, every dropped item and either the party (in town) or each
 * living PC (in combat) standing on a `CONVEYOR` square is shoved one step the
 * way it runs. It is the only thing in the game that moves a PC without the
 * player asking, which makes it invisible in a draw stream: three PCs can walk
 * a square north between two turns and not spend a single number doing it. This
 * port went without it until 2026-08-30, and the cost was exactly that — the
 * `[pcpos]`/`pcs:` traces disagreeing about where the party stood while every
 * draw still matched.
 *
 * **The direction flags OR together and then cancel.** A big creature can
 * straddle two belts pointing opposite ways, and the C++'s answer is to collect
 * up/down/left/right over its whole footprint and apply all four — so N and S
 * cancel exactly, and N with E is a diagonal step. Note it never double-pushes
 * along one axis however many belts agree.
 *
 * **Walls only stop a push under the `conveyor-belts: V2` feature flag.** The
 * original shoves things into walls, and the recordings made before the fix
 * depend on that, so the check is behind the flag like every other repaired bug.
 *
 * **And it is the *scenario's* flag, not the replay's** — `push_things` reads
 * `univ.scenario.get_feature_flag("conveyor-belts")` (boe.specials.cpp:1743),
 * not `has_feature_flag`. The two maps are separate: a recording replaces the
 * global one wholesale and almost none of them mention conveyor belts, so
 * asking the global map here answered "off" for every recording ever made —
 * including Za-Khazi's, whose scenario.xml declares `V2`. The visible form was
 * a PC shoved onto a square another PC was standing on, and then casting from
 * there for the rest of the fight.
 */

import { Location, loc, locsEqual } from '../core/location';
import { Direction } from '../core/location';
import { FieldType } from '../data/fields';
import { ItemType } from '../data/item';
import { TerSpec } from '../data/terrain';
import { isCombat, isOut, isTown } from './modes';
import { MainStatus } from '../universe/skills';
import { DamageType } from '../data/monster';
import { Race } from '../universe/skills';
import { damagePc, hitParty } from './damage';
import { pointOnScreen } from './session';
import type { GameSession } from './session';

/** `univ.scenario.get_feature_flag("conveyor-belts") == "V2"`. */
function beltsV2(session: GameSession): boolean {
  return session.univ.scenario.featureFlags['conveyor-belts'] === 'V2';
}

/** The result of one `check_push`: where the thing ends up, or null for "stays". */
function checkPush(
  session: GameSession, start: Location, xWidth: number, yWidth: number,
  /** Temporarily park the pushed thing here so it doesn't block itself. */
  displace: ((by: number) => void) | null,
): Location | null {
  const town = session.univ.town!;
  // A **copy**: `displace` moves the live position, and the C++'s `start_l` is
  // taken before that happens. Reading the live object here instead would make
  // the "did it move?" test compare a displaced square with itself.
  const from = loc(start.x, start.y);
  let up = false; let down = false; let left = false; let right = false;
  for (let x = from.x; x < from.x + xWidth; x++)
    for (let y = from.y; y < from.y + yWidth; y++) {
      if (!town.isOnMap(x, y)) continue;
      const ter = session.univ.terrainType(town.record.terrain[x]![y]!);
      if (ter.special !== TerSpec.CONVEYOR) continue;
      switch (ter.flag1) {
        case Direction.N: up = true; break;
        case Direction.E: right = true; break;
        case Direction.S: down = true; break;
        case Direction.W: left = true; break;
        // The C++'s note: a diagonal conveyor terrain might look strange, but a
        // terrain that carries a diagonal direction is asking for it to work.
        case Direction.NE: right = true; up = true; break;
        case Direction.SE: right = true; down = true; break;
        case Direction.SW: left = true; down = true; break;
        case Direction.NW: left = true; up = true; break;
        default: break;
      }
    }

  const check = loc(from.x, from.y);
  if (up) check.y--;
  if (down) check.y++;
  if (left) check.x--;
  if (right) check.x++;
  if (locsEqual(check, from)) return null;

  if (beltsV2(session)) {
    // The thing must not count as blocking its own destination, and the C++'s
    // way of arranging that is to shove its live position a whole map width to
    // the right for the duration of the test. Nothing restores it explicitly —
    // the assignment at the bottom does, on both paths.
    displace?.(town.record.maxDim);

    let endBlocked = false;
    for (let x = check.x; x < check.x + xWidth && !endBlocked; x++)
      for (let y = check.y; y < check.y + yWidth; y++)
        if (session.isBlocked(loc(x, y))) { endBlocked = true; break; }

    if (endBlocked) {
      // One component of a diagonal may still be free; take it if exactly one
      // of the two is blocked, and otherwise stay put.
      let blockedVertical = false;
      let blockedHorizontal = false;
      for (let x = from.x; x < from.x + xWidth && !blockedVertical; x++)
        for (let y = check.y; y < check.y + yWidth; y++)
          if (session.isBlocked(loc(x, y))) { blockedVertical = true; break; }
      for (let x = check.x; x < check.x + xWidth && !blockedHorizontal; x++)
        for (let y = from.y; y < from.y + yWidth; y++)
          if (session.isBlocked(loc(x, y))) { blockedHorizontal = true; break; }

      if (Number(blockedVertical) + Number(blockedHorizontal) === 1) {
        if (blockedVertical) check.y = from.y;
        else check.x = from.x;
      } else {
        check.x = from.x;
        check.y = from.y;
      }
    }

    displace?.(-town.record.maxDim);
  }

  return locsEqual(check, from) ? null : check;
}

/** Whether any square the push crossed is on screen — the C++'s redraw test. */
function crossedScreen(
  session: GameSession, start: Location, end: Location, xWidth: number, yWidth: number,
): boolean {
  for (let x = Math.min(start.x, end.x); x < Math.max(start.x, end.x) + xWidth; x++)
    for (let y = Math.min(start.y, end.y); y < Math.max(start.y, end.y) + yWidth; y++)
      if (pointOnScreen(session.center, loc(x, y))) return true;
  return false;
}

/**
 * Smash whatever the pushed party or PC landed on, and free anything the
 * container was holding. Shared by the town and combat halves, which the C++
 * writes out twice with the same body.
 */
async function landOn(session: GameSession, where: Location, pcIndex: number): Promise<void> {
  const { univ } = session;
  const town = univ.town!;
  if (town.hasField(where.x, where.y, FieldType.OBJECT_BARREL)) {
    town.setField(where.x, where.y, FieldType.OBJECT_BARREL, false);
    univ.addStringToBuf('You smash the barrel.');
  }
  if (town.hasField(where.x, where.y, FieldType.OBJECT_CRATE)) {
    town.setField(where.x, where.y, FieldType.OBJECT_CRATE, false);
    univ.addStringToBuf('You smash the crate.');
  }
  // The C++'s own note: you then share a square with the block, which it thinks
  // is fine. Kept.
  if (town.hasField(where.x, where.y, FieldType.OBJECT_BLOCK)) {
    univ.addStringToBuf('You crash into the block.');
    if (pcIndex < 0) await hitParty(univ, univ.rng.getRan(1, 1, 6), DamageType.WEAPON);
    else {
      await damagePc(univ, univ.party.pcs[pcIndex]!, univ.rng.getRan(1, 1, 6),
        DamageType.WEAPON, Race.UNKNOWN);
    }
  }
  // Whatever the smashed container held is now loose on the floor.
  for (const item of town.items) {
    if (item.variety !== ItemType.NO_ITEM && item.held && locsEqual(item.itemLoc, where)) {
      item.contained = false;
      item.held = false;
    }
  }
}

/** push_things — the whole pass, in the C++'s order: creatures, items, party. */
export async function pushThings(session: GameSession): Promise<void> {
  const { univ } = session;
  const town = univ.town;
  // The C++'s TODO: belts don't work outdoors.
  if (!town || isOut(session.mode)) return;
  if (!town.beltPresent) return;

  let redraw = false;
  const v2 = beltsV2(session);

  // Creatures. Only V2 accounts for a big creature's footprint; before it,
  // everything is pushed as though it stood on one square.
  for (const creature of town.monsters) {
    if (!creature.isAlive) continue;
    const xw = v2 ? creature.xWidth : 1;
    const yw = v2 ? creature.yWidth : 1;
    const to = checkPush(session, creature.curLoc, xw, yw,
      (by) => { creature.curLoc.x += by; });
    if (!to) continue;
    if (crossedScreen(session, creature.curLoc, to, xw, yw)) redraw = true;
    creature.curLoc = to;
    // Creatures destroy crates and barrels in `monst_inflict_fields` instead.
  }

  // Dropped items.
  for (const item of town.items) {
    if (item.variety === ItemType.NO_ITEM) continue;
    const to = checkPush(session, item.itemLoc, 1, 1, (by) => { item.itemLoc.x += by; });
    if (!to) continue;
    if (crossedScreen(session, item.itemLoc, to, 1, 1)) redraw = true;
    item.itemLoc = to;
  }

  // The party, walking around in peace.
  if (isTown(session.mode)) {
    const from = { ...univ.party.townLoc };
    const to = checkPush(session, univ.party.townLoc, 1, 1,
      (by) => { univ.party.townLoc.x += by; });
    if (to) {
      if (crossedScreen(session, from, to, 1, 1)) redraw = true;
      univ.party.townLoc = to;
      univ.addStringToBuf('You get pushed.');
      session.center = { ...univ.party.townLoc };
      session.updateExplored(session.center);
      await landOn(session, univ.party.townLoc, -1);
    }
  }

  // Each living PC, in a fight.
  if (isCombat(session.mode)) {
    for (let i = 0; i < univ.party.pcs.length; i++) {
      const pc = univ.party.pcs[i]!;
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      const from = { ...pc.combatPos };
      const to = checkPush(session, pc.combatPos, 1, 1, (by) => { pc.combatPos.x += by; });
      if (!to) continue;
      pc.combatPos = to;
      univ.addStringToBuf('Someone gets pushed.');
      session.updateExplored(pc.combatPos);
      await landOn(session, pc.combatPos, i);
      if (crossedScreen(session, from, to, 1, 1)) redraw = true;
      // The C++ sets its redraw flag unconditionally in this branch, whatever
      // `check_push` decided about the screen. Kept.
      redraw = true;
    }
  }

  if (redraw) session.onRedraw?.();
}
