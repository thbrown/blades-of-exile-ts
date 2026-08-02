/**
 * The move inference — recovering the recording's own trajectory from a file
 * that only ever wrote down where each step was *aimed*.
 *
 * These tests matter more than their size suggests: the whole value of the
 * tool is that its verdicts can be trusted, and a confident wrong answer would
 * send someone hunting a rule that is fine. So the cases here are as much
 * about what it refuses to conclude as about what it concludes.
 */

import { describe, expect, it } from 'vitest';
import { ReplayAction } from '../src/replay/format';
import { inferMoves } from '../src/replay/inferMoves';

const move = (x: number, y: number): ReplayAction =>
  ({ type: 'move', text: `(${x},${y})`, info: {} });
const other = (): ReplayAction => ({ type: 'handle_pause', text: '', info: {} });

describe('inferring the recording\'s own path', () => {
  it('follows a plain walk, where every step went through', () => {
    // Each destination is one step on from the last, which is only possible if
    // every step succeeded. Note the **last** move reads `unknown`: nothing
    // follows it to rule out its having been refused, and that is true of the
    // final move of every file.
    const r = inferMoves([move(5, 5), move(6, 5), move(7, 5)], { x: 4, y: 5 });
    expect(r.breaks).toEqual([]);
    expect(r.moves.map((m) => m.outcome)).toEqual(['moved', 'moved', 'unknown']);
    expect(r.moves.map((m) => m.from)).toEqual([
      { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
    ]);
  });

  /**
   * The case the whole tool exists for. Aiming twice at the same square, then
   * stepping somewhere only reachable from the original position, proves the
   * first step was refused.
   */
  it('spots a step the recording refused', () => {
    const r = inferMoves([move(5, 5), move(3, 5)], { x: 4, y: 5 });
    expect(r.breaks).toEqual([]);
    expect(r.moves[0]!.outcome).toBe('refused');
    expect(r.moves[0]!.from).toEqual({ x: 4, y: 5 });
    expect(r.moves[1]!.from).toEqual({ x: 4, y: 5 });
  });

  it('says "unknown" rather than guessing when both readings survive', () => {
    // Stepping east then aiming back west is consistent with the step having
    // gone through *or* not: (5,5) and (4,5) can both reach (4,5).
    const r = inferMoves([move(5, 5), move(4, 5)], { x: 4, y: 5 });
    expect(r.moves[0]!.outcome).toBe('unknown');
  });

  it('reads through actions that are not moves', () => {
    const r = inferMoves(
      [move(5, 5), other(), move(6, 5), other()], { x: 4, y: 5 });
    expect(r.moves.map((m) => m.at)).toEqual([0, 2]);
    expect(r.moves.map((m) => m.from)).toEqual([{ x: 4, y: 5 }, { x: 5, y: 5 }]);
  });

  /**
   * A destination nothing could have reached means the party was *relocated* —
   * a town entrance, a stairway, or the outdoor window sliding and renumbering
   * every coordinate. That is a break in the chain, not a contradiction, and
   * the walk restarts from it.
   *
   * Note what it does **not** claim afterwards: a relocation says only that the
   * party could aim at the new destination, so the square it actually landed on
   * is one of nine and the inference reports it as unknown rather than
   * assuming the step went through.
   */
  it('reports a relocation as a break and does not overclaim after it', () => {
    const r = inferMoves([move(5, 5), move(40, 40), move(41, 40)], { x: 4, y: 5 });
    expect(r.breaks).toEqual([1]);
    expect(r.moves[2]!.from).toBeNull();
    expect(r.moves[2]!.outcome).toBe('unknown');
  });

  it('handles a destination equal to the party\'s own square', () => {
    // Not a contradiction: distance 0 is within one step. Nothing can be told
    // apart about it, so it must not claim to know.
    const r = inferMoves([move(4, 5), move(5, 5)], { x: 4, y: 5 });
    expect(r.breaks).toEqual([]);
    expect(r.moves[0]!.outcome).toBe('unknown');
  });

  /**
   * The backward pass is what does the real work: a candidate can survive the
   * next destination and still be killed by the one after it, and only looking
   * backwards sees that. Here the *third* step is what proves the first two
   * were both refused — aiming twice at (5,5) and then reaching (3,5) is only
   * possible from (4,5), so the party never left it.
   */
  it('uses a later step to settle earlier ones', () => {
    const r = inferMoves([move(5, 5), move(5, 5), move(3, 5)], { x: 4, y: 5 });
    expect(r.breaks).toEqual([]);
    expect(r.moves.map((m) => m.outcome)).toEqual(['refused', 'refused', 'unknown']);
    expect(r.moves[1]!.from).toEqual({ x: 4, y: 5 });
  });

  /**
   * Diagonals are why so much of a real file reads `unknown`: from (4,5) a
   * refused step to (5,5) still leaves (5,6) one diagonal away, so both
   * readings survive and the tool must not pick one.
   */
  it('stays honest when a diagonal keeps both readings alive', () => {
    const r = inferMoves([move(5, 5), move(5, 6), move(5, 7)], { x: 4, y: 5 });
    expect(r.moves[0]!.outcome).toBe('unknown');
  });

  it('starts from wherever it is told to', () => {
    const r = inferMoves([other(), move(9, 9)], { x: 9, y: 8 }, 1);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]!.from).toEqual({ x: 9, y: 8 });
  });
});
