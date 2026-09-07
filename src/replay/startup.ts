/**
 * The startup half of a replay — the actions the C++ records *before* there is
 * a game to act on, and which this port therefore cannot dispatch into a
 * `GameSession` at all.
 *
 * Every one of the 97 replays the C++ ships opens with the same three or four
 * actions and then stops this port dead, because they are not moves — they are
 * the splash screen, the file picker and the scenario list, none of which
 * exists here. Surveying the corpus (`scripts/survey-replays.mjs`) says
 * `startup_button_click` is the *first* gap in 81 of them, so this one file is
 * what stands between the driver and the golden masters M8 is about.
 *
 * The dominant shape, 80 files of the 97, is:
 *
 *     load_prefs  feature_flags  srand
 *     startup_button_click {btn: "Load Game"}
 *     fancy_file_picker  false
 *     click_control {id: list}   click_control {id: load1}
 *     load_party  <base64 .exg>
 *
 * — and the last line is the good news: **the replay carries the whole saved
 * game inline**, so nothing has to be reconstructed. `replayStartup` hands back
 * those bytes and the scenario they belong to, the caller builds a session on
 * that scenario and applies them, and the driver starts at the first real
 * action.
 *
 * This is the same shape as `rngForReplay`: the startup answer is produced
 * *before* the session exists, because that is when the C++ answers it too.
 */

import { readSavePreview } from '../fileio/saveIo';
import { Replay, ReplayAction } from './format';

/**
 * The actions that belong to startup rather than to the game. `runReplay` skips
 * a leading run of these (they are `replayStartup`'s business) and refuses them
 * anywhere else, since a `load_party` in the middle of a recording is a real
 * game action — the player loading a save — and quietly ignoring it would give
 * a different game from the one recorded.
 */
export const STARTUP_ACTIONS: ReadonlySet<string> = new Set([
  'load_prefs', 'feature_flags', 'srand', 'scenario', 'change_fps',
  'pick_preferences', 'startup_button_click', 'fancy_file_picker',
  'build_scen_headers', 'click_control', 'load_party',
  // **`toggle_debug_mode` is `startup_safe`** in the C++
  // (boe.actions.cpp:2725), so a recording can press shift-D at the splash
  // screen — before any game exists — and two of them do, which stopped the
  // preamble dead one action short of the `load_party` it was looking for.
  // It is not merely skipped: see `debugMode` below.
  'toggle_debug_mode',
]);

export interface ReplayStartLoad {
  kind: 'load';
  /** The `.exg` the recording began from, decoded from `<load_party>`. */
  save: Uint8Array;
  /** The scenario as the save spells it — `valleydy.boes`. */
  scenarioFile: string;
  /** …and as `Scenario.id` spells it: the directory the files live in. */
  scenarioId: string;
  /** How many leading actions the preamble accounts for. */
  consumed: number;
  /**
   * Whether the preamble left **debug mode on**.
   *
   * `univ.debug_mode` is a plain global in the C++ and is **not saved**, so a
   * shift-D pressed at the splash screen is still in force after the load —
   * and it is not cosmetic: `damage_monst` sets the victim's health to -1
   * outright and `kill_monst` skips the experience, the glands and the
   * treasure (boe.specials.cpp:1532, :1628, :1643). All three draw. Swallowing
   * the toggle as startup and starting with it off would put the stream out of
   * step the first time the party hit anything.
   *
   * Counted rather than latched, because the toggle is a toggle.
   */
  debugMode: boolean;
}

export interface ReplayStartUnsupported {
  kind: 'unsupported';
  why: string;
  consumed: number;
}

export type ReplayStart = ReplayStartLoad | ReplayStartUnsupported;

/**
 * Read the preamble. Consumes the leading run of startup actions and reports
 * what game the recording was about to play.
 */
export function replayStartup(replay: Replay): ReplayStart {
  let at = 0;
  let load: ReplayAction | null = null;
  let sawScenList = false;
  let debugMode = false;
  while (at < replay.actions.length) {
    const action = replay.actions[at]!;
    if (!STARTUP_ACTIONS.has(action.type)) break;
    if (action.type === 'load_party') load = action;
    if (action.type === 'build_scen_headers') sawScenList = true;
    if (action.type === 'toggle_debug_mode') debugMode = !debugMode;
    at++;
    // A `load_party` ends the preamble: everything after it is the game.
    // Without this the run of `click_control`s that a chain of dialogs opens
    // right after the load would be swallowed as startup.
    if (load !== null) break;
  }

  if (load === null) {
    return {
      kind: 'unsupported',
      consumed: at,
      // The other shape starts a brand-new party on a scenario chosen from the
      // list. Running it needs `pick_a_scen`'s paging modelled (three per page,
      // `scenN` picking within the page) *and* `start_new_game`'s party
      // creation to match the C++'s exactly, since the whole run is measured
      // against a party this port would have to build identically. The 17 files
      // in that shape are the second slice of this work, not the first.
      why: sawScenList
        ? 'starts a new party from the scenario picker, which needs pick_a_scen'
        : 'no <load_party>: nothing says which game the recording was playing',
    };
  }

  const save = decodeReplayFile(load.text);
  const scenarioFile = readSavePreview(save).scenarioId;
  if (scenarioFile === '') {
    // `cParty::scen_name` is empty for a party that isn't in a scenario at all
    // — the C++'s "party in memory" state, which you get from Make New Party
    // and then take to a scenario with Start Scenario. There is no world to
    // build a session on, so the recording can only be run once the picker is
    // modelled.
    return { kind: 'unsupported', consumed: at, why: 'the save is a party with no scenario' };
  }
  return {
    kind: 'load',
    save,
    scenarioFile,
    scenarioId: scenarioDirOf(scenarioFile),
    consumed: at,
    debugMode,
  };
}

/**
 * `cParty::scen_name` is the packaged file's name (`valleydy.boes`), while this
 * port's `Scenario.id` is the directory it was unpacked into (`valleydy`) —
 * `ScenarioSource` has no archive to name. Both spellings are kept on the
 * result, because a save written back out has to carry the C++'s.
 */
export function scenarioDirOf(scenarioFile: string): string {
  return scenarioFile.replace(/\.(boes|exs)$/i, '');
}

/**
 * `decode_file` (replay.cpp:314) — base64, wrapped at 76 columns, so the line
 * breaks come out first. `atob` is a global in both places this runs, which
 * `Buffer` is not.
 */
export function decodeReplayFile(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
