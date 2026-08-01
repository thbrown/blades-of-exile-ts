/**
 * The replay driver — `replay_action` (boe.main.cpp:647) and the loop that
 * feeds it (:1353).
 *
 * The C++ dispatches on the action's element name into the same `handle_*`
 * functions the keyboard and mouse call. This port dispatches into
 * `GameSession`, which is where the rules live; the key handling in `main.ts`
 * is the UI layer above it and has nothing a replay needs.
 *
 * Two properties are kept deliberately:
 *
 *   - **Actions are pulled, and a mismatch throws.** The driver asks the source
 *     for what it needs; a control-flow divergence anywhere in the engine shows
 *     up as the wrong action type at the first input it changes, instead of
 *     quietly producing a different game.
 *   - **Nothing is skipped silently.** An action this port has no handler for
 *     is counted and reported by name, so `runReplay`'s result is an honest
 *     statement of what was and wasn't exercised — the same discipline as the
 *     `TODO(Mn)` markers.
 */

import { Direction } from '../core/location';
import { GameRng } from '../core/rng';
import { GameSession } from '../game/session';
import { Replay, ReplaySource, locationFromAction, numberFromAction } from './format';

export interface ReplayResult {
  /** How many actions were dispatched to a handler. */
  ran: number;
  /** Action types with no handler here, and how often each turned up. */
  unsupported: Record<string, number>;
  /** Where playback stopped, if it stopped early. */
  error: string | null;
  /** The index of the action that failed, or -1. */
  errorAt: number;
}

export interface ReplayOptions {
  /**
   * What to do with an action this port can't run. `stop` is the strict
   * reading — any gap invalidates everything after it, because the game state
   * has diverged from the recording. `skip` is for surveying a file to see how
   * far the port could get, which is what curating the C++'s own replays needs.
   */
  onUnsupported?: 'stop' | 'skip';
  /** Answers `click_control`; the driver only records which id came up. */
  onClick?: (id: string, mods: number) => void;
}

/**
 * Replay into a live session. The caller is responsible for the session having
 * been built on the replay's scenario and seed — `applyReplaySeed` below does
 * the seed half.
 */
export async function runReplay(
  session: GameSession,
  replay: Replay,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const source = new ReplaySource(replay.actions);
  const onUnsupported = options.onUnsupported ?? 'stop';
  const result: ReplayResult = { ran: 0, unsupported: {}, error: null, errorAt: -1 };

  while (!source.exhausted) {
    const at = source.position;
    const action = source.pop();
    try {
      switch (action.type) {
        case 'move':
          await session.moveTo(locationFromAction(action));
          break;
        case 'handle_pause':
          await session.pause();
          break;
        case 'handle_rest':
          session.rest();
          break;
        case 'handle_combat_switch':
          // One action for both halves in the C++: it is a toggle, and the
          // direction only matters on the way in.
          if (action.text === '') session.endCombat();
          else session.startCombat(numberFromAction(action) as Direction);
          break;
        case 'handle_look':
          session.lookAt(locationFromAction(action));
          break;
        case 'handle_use_space':
          await session.useSpace(locationFromAction(action));
          break;
        case 'handle_switch_pc':
          session.univ.curPc = numberFromAction(action);
          break;
        case 'click_control':
          options.onClick?.(action.info.id ?? '', Number(action.info.mods ?? '0'));
          break;
        // Recorded by the C++ but carrying no game state: preferences, the
        // window furniture, and the seed/scenario this port reads up front.
        case 'load_prefs':
        case 'feature_flags':
        case 'srand':
        case 'scenario':
        case 'change_fps':
          break;
        default: {
          result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
          if (onUnsupported === 'stop') {
            result.error = `no handler for '${action.type}'`;
            result.errorAt = at;
            return result;
          }
          continue;
        }
      }
      // **Wait for the action to finish before reading the next one.** The C++
      // is single-threaded and blocking, so a special chain or a monster round
      // always completes before `handle_action` is entered again. Here those
      // are async and some are launched fire-and-forget, so without this the
      // next action interleaves with the last one's tail and the run stops
      // being reproducible — the same actions replayed twice give different
      // RNG draw counts. The live UI enforces the same rule through
      // `flushingInput`, which drops keystrokes while anything is still going.
      await session.settled();
    } catch (err) {
      result.error = String(err);
      result.errorAt = at;
      return result;
    }
    result.ran++;
  }
  return result;
}

/**
 * The RNG a replay has to be *built* on. The C++ pops `<srand>` during startup,
 * before the party or the scenario exist (boe.main.cpp:1174), and that ordering
 * is the whole point: constructing a Universe and starting a game already draws
 * thousands of numbers, so seeding afterwards rewinds the stream and every
 * replayed action then reads from the wrong place. Handing back the rng rather
 * than re-seeding a live session makes that mistake impossible to write.
 *
 * **Only the game stream is seeded** — the C++ records one `<srand>` and leaves
 * `unique_rand` alone, because it is deliberately not reproducible.
 */
export function rngForReplay(replay: Replay): GameRng {
  const rng = new GameRng();
  if (replay.seed !== null) rng.seedGame(replay.seed);
  return rng;
}
