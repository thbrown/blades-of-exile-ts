/**
 * Working out where the *recording's* party was — the diagnostic M8's
 * remaining work needs.
 *
 * A replay records where each step was **aimed**, never where the party stood:
 * `handle_terrain_screen_actions` (boe.actions.cpp:300) builds
 * `move_destination` from the party's own square plus one direction, and
 * `handle_move` records that destination whether or not the step went through.
 * So a desync tells you the two games disagree, but not about *what* — and
 * "the party is 2 squares from where the recording aimed" is a symptom that any
 * of the fifty moves before it could have caused.
 *
 * The stream is more informative than it looks, because of two facts:
 *
 *   - **Every destination is within one square of the position it was aimed
 *     from.** A destination further than that is impossible, so a candidate
 *     position that cannot reach it is eliminated.
 *   - **A move either succeeds or is refused**, so the position afterwards is
 *     either the destination or exactly what it was before. There is no third
 *     option and no partial step.
 *
 * Together those turn the destination list into a constraint problem: run the
 * candidates forward, then run *backwards* keeping only those that lead
 * somewhere consistent with the whole rest of the file. The backward half is
 * what does the real work — a candidate can survive the next destination and
 * still be killed by the one after it, and only looking backwards sees that.
 *
 * With this in hand a desync stops being "2 squares away" and becomes "the
 * recording refused the step to (x,y) at action N and this port allowed it",
 * which names a rule.
 *
 * **It infers, it does not decide.** Diagonal steps mean many runs are
 * genuinely ambiguous, and where the constraints leave more than one reading it
 * says `unknown` rather than guessing — a confident wrong answer here would
 * send someone hunting a rule that is fine.
 */

import { Location } from '../core/location';
import { ReplayAction, locationFromAction } from './format';

/** Chebyshev distance: one step covers a diagonal, so this is the step count. */
function steps(a: Location, b: Location): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const key = (l: Location): string => `${l.x},${l.y}`;
const unkey = (s: string): Location => {
  const [x, y] = s.split(',');
  return { x: Number(x), y: Number(y) };
};

/** The nine squares a step aimed at `d` could have been made from. */
function couldAimAt(d: Location): Set<string> {
  const out = new Set<string>();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) out.add(key({ x: d.x + dx, y: d.y + dy }));
  return out;
}

export interface InferredMove {
  /** Index into the action list. */
  at: number;
  /** Where the step was aimed. */
  dest: Location;
  /** Where the recording's party stood, if the constraints pinned it down. */
  from: Location | null;
  /**
   * What the recording's engine did with the step, where it can be told:
   * `moved` if the party was somewhere else afterwards, `refused` if it stayed.
   * `unknown` means both readings were still consistent with everything that
   * followed, which is common — a diagonal step leaves many paths open.
   */
  outcome: 'moved' | 'refused' | 'unknown';
}

export interface InferenceResult {
  moves: InferredMove[];
  /**
   * Where the chain broke: an action whose destination no surviving candidate
   * could reach. That is not a failure of the inference — it is the signature
   * of the party having been **relocated** between the two actions by something
   * other than a step: a town entrance, a stairway, a Word of Recall, or the
   * outdoor window sliding and renumbering every coordinate. The walk restarts
   * there, knowing only that the party was somewhere next to the new
   * destination.
   */
  breaks: number[];
}

/** One run of moves with no relocation in it. */
interface Segment {
  /** Where the party could have been before the segment's first move. */
  start: Set<string>;
  moves: { at: number; dest: Location }[];
}

/**
 * Recover the recording's own trajectory from its move destinations.
 *
 * `start` is where the party stood before the first action — from the save the
 * replay carries, which is the one position a recording *does* state.
 *
 * Only `move` actions are read. Plenty of other actions can change the position
 * (a stairway, a scripted relocation) but none of them *state* one, so they
 * surface the same way an impossible destination does: as a break.
 */
export function inferMoves(
  actions: ReplayAction[], start: Location, from = 0,
): InferenceResult {
  // ---- split into segments, breaking wherever the chain cannot continue
  const segments: Segment[] = [{ start: new Set([key(start)]), moves: [] }];
  const breaks: number[] = [];
  let live = new Set([key(start)]);

  for (let i = from; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.type !== 'move') continue;
    let dest: Location;
    try {
      dest = locationFromAction(action);
    } catch {
      continue;
    }

    const reachable = [...live].filter((p) => steps(unkey(p), dest) <= 1);
    if (reachable.length === 0) {
      breaks.push(i);
      // All that is known after a relocation is that the party could aim here.
      live = couldAimAt(dest);
      segments.push({ start: new Set(live), moves: [] });
    }
    segments[segments.length - 1]!.moves.push({ at: i, dest });
    // Forward step: stay, or arrive.
    const next = new Set<string>([key(dest)]);
    for (const p of [...live].filter((q) => steps(unkey(q), dest) <= 1)) next.add(p);
    live = next;
  }

  // ---- solve each segment independently
  const moves: InferredMove[] = [];
  for (const seg of segments) {
    if (seg.moves.length === 0) continue;

    // Forward: `before[k]` is every position consistent with the moves so far.
    const before: Set<string>[] = [seg.start];
    for (const { dest } of seg.moves) {
      const prev = before[before.length - 1]!;
      const next = new Set<string>();
      for (const p of prev) {
        if (steps(unkey(p), dest) > 1) continue;
        next.add(p);            // refused
        next.add(key(dest));    // moved
      }
      before.push(next);
    }

    // Backward: `viable[k]` is every position at step k from which the rest of
    // the segment can still be played out.
    const viable: Set<string>[] = before.map(() => new Set<string>());
    viable[seg.moves.length] = before[seg.moves.length]!;
    for (let k = seg.moves.length - 1; k >= 0; k--) {
      const dest = seg.moves[k]!.dest;
      const ahead = viable[k + 1]!;
      const keep = viable[k]!;
      for (const p of before[k]!) {
        if (steps(unkey(p), dest) > 1) continue;
        // Either outcome is a legal transition; the position is viable if
        // *some* outcome leads somewhere still viable.
        if (ahead.has(p) || ahead.has(key(dest))) keep.add(p);
      }
    }

    for (let k = 0; k < seg.moves.length; k++) {
      const { at, dest } = seg.moves[k]!;
      const froms = [...viable[k]!];
      const fromLoc = froms.length === 1 ? unkey(froms[0]!) : null;

      let outcome: InferredMove['outcome'] = 'unknown';
      if (fromLoc !== null && key(fromLoc) !== key(dest)) {
        // Standing on the destination already makes the two outcomes the same
        // state, so that case is deliberately left unknown.
        const ahead = viable[k + 1]!;
        const canStay = ahead.has(key(fromLoc));
        const canMove = ahead.has(key(dest));
        if (canMove && !canStay) outcome = 'moved';
        else if (canStay && !canMove) outcome = 'refused';
      }
      moves.push({ at, dest, from: fromLoc, outcome });
    }
  }
  return { moves, breaks };
}
