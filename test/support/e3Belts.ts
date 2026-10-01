/**
 * A search through a town of conveyor belts (Exile III's Tower of Shifting
 * Floors), with the engine itself as the model: from each square the party
 * has reached, it puts the party there and takes each of the eight steps,
 * or stands still for a turn, and notes where the turn left it once the
 * belts have carried it. So the search can't disagree with the game, and a
 * path it finds is replayed through a fresh runner by the test that asks.
 *
 * The belts must be the only thing moving: the caller clears the town's
 * creatures and anything that makes more (the golem generators). Every step
 * is taken with the party healed, so lava on the way costs nothing but the
 * turn. A step that leaves the town (stairs, the edge) ends that branch,
 * and the runner is put back. Items and fields aren't restored: the tower's
 * belts don't need them.
 */

import { Direction, shiftLoc, type Location } from '../../src/core/location';
import { MainStatus, Status } from '../../src/universe/skills';
import type { QuestRunner } from './e3Quest';

/** The eight steps, then standing still (Space). */
export const BELT_MOVES = [
  Direction.N, Direction.NE, Direction.E, Direction.SE, Direction.S, Direction.SW, Direction.W, Direction.NW, Direction.Here,
] as const;
export type BeltMove = (typeof BELT_MOVES)[number];

export interface BeltGoal {
  /** Reached on this square, in this town. */
  at?: (where: Location) => boolean;
  /** Or: a step that takes the party to this town. */
  town?: number;
}

/**
 * One move from `from`, through the engine: where it ends, and in which town.
 * What the move changes (a belt a spot turns round, a door, a flag) is put
 * back afterwards, so every trial starts from the level as the search found
 * it, and a route found is one a fresh party can walk. A change the route
 * needs is a leg of its own.
 */
async function take(q: QuestRunner, town: number, from: Location, move: BeltMove, foes: RegExp): Promise<{ town: number; at: Location }> {
  const terrain = q.town.record.terrain.map((col) => [...col]);
  const flags = q.party.stuffDone.map((row) => row.slice());
  try {
    return await trial(q, town, from, move, foes);
  } finally {
    if (q.session.inTown && q.townNum === town) {
      terrain.forEach((col, x) => col.forEach((t, y) => { q.town.record.terrain[x]![y] = t; }));
    }
    flags.forEach((row, i) => q.party.stuffDone[i]!.set(row));
  }
}

async function trial(q: QuestRunner, town: number, from: Location, move: BeltMove, foes: RegExp): Promise<{ town: number; at: Location }> {
  for (const pc of q.party.pcs) { pc.mainStatus = MainStatus.ALIVE; pc.curHealth = pc.maxHealth; }
  q.place(from);
  await stepOnce(q, move, foes);
  const result = { town: q.session.inTown ? q.townNum : -1, at: { ...q.at } };
  if (result.town !== town) await q.enter(town, from);
  return result;
}

/**
 * One move as a player makes it: a door (or a false wall) opens as it's
 * walked into and the party stays put, so it gets a second step, as
 * `QuestRunner.walk` does; and anything hostile that turns up and matches
 * `foes` (spot 2 on level 2 brings golems in; golems are all the tower
 * has) is fought off before the next move, and the
 * party is put back on its feet, as the search's trials are.
 */
async function stepOnce(q: QuestRunner, move: BeltMove, foes: RegExp): Promise<void> {
  const town = q.townNum;
  const from = { ...q.at };
  if (move === Direction.Here) await q.pause();
  else {
    const ahead = shiftLoc(from, move);
    const ter = () => (q.town.isOnMap(ahead.x, ahead.y) ? q.town.record.terrain[ahead.x]![ahead.y] : -1);
    const before = ter();
    await q.go(move);
    if (q.session.inTown && q.townNum === town && q.at.x === from.x && q.at.y === from.y && ter() !== before) await q.go(move);
  }
  // The tower's attackers are all golems (the default); the Mind Crystal is
  // left for the test.
  if (q.session.inTown && q.town.monsters.some((m) => m.isAlive && !m.isFriendly && foes.test(m.getName()))) await q.kill(foes);
  // What the fight left the party with, as a party that won it would have
  // shaken off: golems hit hard, and put it to sleep and paralyse it.
  for (const pc of q.party.pcs) {
    pc.mainStatus = MainStatus.ALIVE;
    pc.curHealth = pc.maxHealth;
    pc.status[Status.ASLEEP] = 0;
    pc.status[Status.PARALYZED] = 0;
  }
}

/**
 * The shortest list of moves from `start` to `goal` in the runner's town, or
 * null. The runner is left in the town, wherever the last trial put it.
 */
export async function searchBelts(q: QuestRunner, start: Location, goal: BeltGoal, limit = 6000, foes = /Golem/): Promise<BeltMove[] | null> {
  const town = q.townNum;
  const key = (l: Location) => `${l.x},${l.y}`;
  const back = new Map<string, { from: string; move: BeltMove } | null>([[key(start), null]]);
  const queue: Location[] = [start];
  const path = (end: string, last?: BeltMove): BeltMove[] => {
    const moves: BeltMove[] = last === undefined ? [] : [last];
    for (let k = end, b = back.get(k); b; k = b.from, b = back.get(k)) moves.unshift(b.move);
    return moves;
  };
  if (goal.at?.(start)) return [];
  while (queue.length && back.size < limit) {
    const from = queue.shift()!;
    for (const move of BELT_MOVES) {
      const to = await take(q, town, from, move, foes);
      if (goal.town !== undefined && to.town === goal.town) return path(key(from), move);
      if (to.town !== town) continue;
      const k = key(to.at);
      if (back.has(k)) continue;
      back.set(k, { from: key(from), move });
      if (goal.at?.(to.at)) return path(k);
      queue.push(to.at);
    }
  }
  return null;
}

/**
 * Take `moves` from where the party stands, as a player would (`stepOnce`),
 * fighting off whatever matches `foes` as it turns up.
 */
export async function walkBelts(q: QuestRunner, moves: BeltMove[], foes = /Golem/): Promise<void> {
  for (const move of moves) await stepOnce(q, move, foes);
}
