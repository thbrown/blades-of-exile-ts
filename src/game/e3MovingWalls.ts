/**
 * Exile III's moving walls. An blades-of-exile-ts extension, not in BoE or OBoE: a
 * scenario with the feature flag `moving-walls` set to `exile3:<node>:<towns>`
 * runs these at the end of every turn and every combat round (DIVERGENCES.md
 * #35). In Exile III they are the Concealed Tunnel's (town 54) and town 71's.
 *
 * Two terrains move, one square a turn, onto floor: the adobe wall (132)
 * north and the basalt wall (117) south, each turning around when it can't
 * go on (`10c0:6aa2`, the per-turn town code `FUN_10c0_61c4`). A crate, a
 * barrel, a web, quickfire or a fire or force barrier ahead stops one, which
 * is how the party wedges them.
 *
 * A wall can move onto the party. Then E3's own `push_things`
 * (`FUN_10c0_58b1`, which runs next) carries the party the way the wall
 * goes, as it does on a belt, and if that lands the party on a square that
 * blocks, "The moving wall smashes you into a wall" (the flag's `node`) and
 * everyone dies, or in a fight the one PC does (`kill_pc` with the split
 * offset: no luck save, no life-saving item), so no draw is spent. E3's
 * belts share the routine, so under the flag a belt that carries the party
 * into a wall crushes it too (`pushThings.ts`), in any town.
 */

import type { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { TerObstruct } from '../data/terrain';
import { MainStatus } from '../universe/skills';
import type { Universe } from '../universe/universe';
import { bugFixed } from './bugFixes';
import { killPc } from './damage';
import { slayParty } from './increaseAge';
import { isCombat, isTown } from './modes';
import type { GameSession } from './session';
import { SpecCtx, SpecCtxType } from './specials/context';

/** The wall that moves north (`0x84`), the one that moves south (`0x75`), and the floor they move onto (`0x96`). */
export const WALL_NORTH = 132;
export const WALL_SOUTH = 117;
export const WALL_FLOOR = 150;

/** What stops a wall: E3's six tests of the square ahead (`FUN_1038_03b1` and on). */
const STOPPERS = [
  FieldType.OBJECT_CRATE, FieldType.BARRIER_FIRE, FieldType.OBJECT_BARREL,
  FieldType.FIELD_WEB, FieldType.FIELD_QUICKFIRE, FieldType.BARRIER_FORCE,
];

interface WallsFlag { node: number; towns: Set<number> }

function wallsFlag(univ: Universe): WallsFlag | null {
  const flag = univ.scenario.featureFlags['moving-walls'];
  const m = flag?.match(/^exile3:(-?\d+):([\d,]+)$/);
  if (!m) return null;
  return { node: Number(m[1]), towns: new Set(m[2]!.split(',').map(Number)) };
}

/**
 * The walls' turn, in E3's order: every north wall with x from 1 and y
 * rising, then every south wall with y falling, so a wall that turns around
 * in the first pass may move in the second.
 */
export function moveE3Walls(session: GameSession): boolean {
  const { univ } = session;
  const town = univ.town;
  const flag = wallsFlag(univ);
  if (!town || !flag || !flag.towns.has(univ.party.townNum)) return false;
  const ter = town.record.terrain;
  const at = (x: number, y: number): number => ter[x]?.[y] ?? -1;
  const set = (x: number, y: number, t: number): void => { ter[x]![y] = t; };
  const clear = (x: number, y: number): boolean => !STOPPERS.some((f) => town.hasField(x, y, f));
  // E3 asks for a creature on the wall's *own* square (`10c0:6b66` pushes
  // the wall's location, not the square ahead), where none can stand, so a
  // wall moves onto a creature (E3-SUSPECTED-BUGS.md #19). Fixed, it asks
  // about the square ahead.
  const ahead = bugFixed(19);
  const noCreature = (x: number, y: number, dy: number): boolean => !town.monsterAt({ x, y: ahead ? y + dy : y });
  let moved = false;
  for (let x = 1; x < 48; x++) {
    for (let y = 1; y < 48; y++) {
      if (at(x, y) !== WALL_NORTH) continue;
      moved = true;
      if (at(x, y - 1) === WALL_FLOOR && clear(x, y - 1) && noCreature(x, y, -1)) {
        set(x, y, WALL_FLOOR);
        set(x, y - 1, WALL_NORTH);
      } else set(x, y, WALL_SOUTH);
    }
  }
  for (let x = 0; x < 48; x++) {
    for (let y = 46; y > 0; y--) {
      if (at(x, y) !== WALL_SOUTH) continue;
      moved = true;
      if (at(x, y + 1) === WALL_FLOOR && clear(x, y + 1) && noCreature(x, y, 1)) {
        set(x, y, WALL_FLOOR);
        set(x, y + 1, WALL_SOUTH);
      } else set(x, y, WALL_NORTH);
    }
  }
  // E3 also clears a byte per square the wall moves into (`DGROUP:0x5cb1`),
  // whose meaning hasn't been found; the map is redrawn either way.
  if (!moved) return false;
  // `update_explored` around the party (`FUN_1080_0b09`), or each living PC.
  if (isCombat(session.mode)) {
    for (const pc of univ.party.pcs) if (pc.mainStatus === MainStatus.ALIVE) session.updateExplored(pc.combatPos);
  } else session.updateExplored(univ.party.townLoc);
  return true;
}

/** E3's "that square blocks" for the crush (`FUN_1080_1529`): its blockage 1, 4 or 5. */
function crushes(univ: Universe, where: Location): boolean {
  const t = univ.town!.record.terrain[where.x]?.[where.y];
  if (t === undefined) return false;
  const b = univ.terrainType(t).blockage;
  return b === TerObstruct.BLOCK_SIGHT || b >= TerObstruct.BLOCK_MOVE_AND_SHOOT;
}

/**
 * E3's crush, after anything carries the party (`pc` -1) or a PC onto
 * `to`, a moving wall or a belt: if `to` blocks, the message and the death.
 * Returns whether it struck. Nothing without the flag.
 */
export async function e3Crush(session: GameSession, to: Location, pc: number): Promise<boolean> {
  const { univ } = session;
  const flag = wallsFlag(univ);
  if (!flag || !univ.town || !crushes(univ, to)) return false;
  await session.runSpecial(SpecCtx.SCEN_TIMER, SpecCtxType.SCEN, flag.node, to);
  if (pc < 0) slayParty(univ.party, MainStatus.DEAD);
  else killPc(univ, univ.party.pcs[pc]!, MainStatus.SPLIT + MainStatus.DEAD);
  return true;
}

/** Where a wall under `where` carries whoever stands there, or null. */
function carriedTo(univ: Universe, where: Location): Location | null {
  const t = univ.town!.record.terrain[where.x]?.[where.y];
  if (t === WALL_NORTH) return { x: where.x, y: where.y - 1 };
  if (t === WALL_SOUTH) return { x: where.x, y: where.y + 1 };
  return null;
}

/**
 * E3's `push_things` for the walls: the party (in town), or each living PC
 * (in a fight), standing where a wall has come is carried along, smashing
 * a barrel or crate it lands on, and crushed if it lands on anything that
 * blocks. Returns whether anyone moved.
 */
export async function pushOffE3Walls(session: GameSession): Promise<boolean> {
  const { univ } = session;
  const town = univ.town;
  const flag = wallsFlag(univ);
  if (!town || !flag || !flag.towns.has(univ.party.townNum)) return false;
  const smash = (at: Location): void => {
    if (town.hasField(at.x, at.y, FieldType.OBJECT_BARREL)) {
      town.setField(at.x, at.y, FieldType.OBJECT_BARREL, false);
      univ.addStringToBuf('You smash the barrel.');
    }
    if (town.hasField(at.x, at.y, FieldType.OBJECT_CRATE)) {
      town.setField(at.x, at.y, FieldType.OBJECT_CRATE, false);
      univ.addStringToBuf('You smash the crate.');
    }
  };
  let moved = false;
  if (isTown(session.mode)) {
    const to = carriedTo(univ, univ.party.townLoc);
    if (to) {
      moved = true;
      univ.addStringToBuf('You get pushed.');
      univ.party.townLoc = to;
      session.center = { ...to };
      session.updateExplored(to);
      await e3Crush(session, to, -1);
      smash(to);
    }
  }
  if (isCombat(session.mode)) {
    for (const [i, pc] of univ.party.pcs.entries()) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      const to = carriedTo(univ, pc.combatPos);
      if (!to) continue;
      moved = true;
      univ.addStringToBuf('Someone gets pushed.');
      await e3Crush(session, to, i);
      pc.combatPos = to;
      session.updateExplored(to);
      smash(to);
    }
  }
  if (moved) session.onRedraw?.();
  return moved;
}
