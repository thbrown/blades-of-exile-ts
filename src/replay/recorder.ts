/**
 * `record_action` (replay.cpp) — the writing half.
 *
 * The C++ records from inside each input handler, which it can do because the
 * handlers are free functions reaching for a global. Here the recorder is an
 * object the session holds, and the same small set of entry points report to
 * it. It stays null unless something asks for a recording, so nothing is paid
 * for by a game that isn't being recorded.
 *
 * What gets recorded is the *semantic* action, not the keystroke: `move` with
 * a destination, not "the right arrow went down". That is what makes a replay
 * survive a change to the key bindings, and what makes it a fidelity test of
 * the rules rather than of the UI.
 */

import { Location } from '../core/location';
import { Replay, ReplayAction, locationText, writeReplay } from './format';

export class ReplayRecorder {
  private readonly actions: ReplayAction[] = [];

  constructor(
    /** The seed the game stream was started from, for `<srand>`. */
    readonly seed: number | null = null,
    /** Which scenario this is a recording of. */
    readonly scenario: string | null = null,
  ) {}

  get length(): number {
    return this.actions.length;
  }

  /** The general form: an action with child elements. */
  record(type: string, info: Record<string, string> = {}, text = ''): void {
    this.actions.push({ type, text, info });
  }

  /** An action whose whole payload is one value (`short_from_action`). */
  recordValue(type: string, value: number | string | boolean): void {
    this.actions.push({ type, text: String(value), info: {} });
  }

  /** An action whose payload is a square (`location_from_action`). */
  recordLoc(type: string, where: Location): void {
    this.actions.push({ type, text: locationText(where), info: {} });
  }

  /** `click_control` — which dialog button or row answered a prompt. */
  recordClick(id: string, mods = 0): void {
    this.record('click_control', { id, mods: String(mods) });
  }

  toReplay(): Replay {
    return { seed: this.seed, scenario: this.scenario, actions: [...this.actions] };
  }

  serialise(): string {
    return writeReplay(this.toReplay());
  }
}
