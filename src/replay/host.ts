/**
 * The `SpecialHost` a replay runs on — the dialogs, answered from the
 * recording instead of from a player.
 *
 * **This is the piece whose absence made the corpus look like a rules problem.**
 * The driver used to run with `attachSpecials` never called, so scripting was
 * switched off entirely: a scripted square did nothing, a message box was never
 * raised, and — the part that actually bit — a special that *blocks* a step
 * never got the chance to unblock it. The result was a party that stopped dead
 * one square short and a "desync" reported against a movement rule that was
 * perfectly correct.
 *
 * The C++ has no such seam. Its dialogs are modal: `cDialog::run` pops actions
 * off the very same stream the outer handler is walking, so a message raised
 * mid-move consumes the `click_control` that dismissed it and the move carries
 * on. That is exactly what this does — the host holds the same `ReplaySource`
 * the driver is pulling from, and reads the next action when it needs an
 * answer.
 *
 * Two rules kept from the driver, because they are why the format is worth
 * anything:
 *
 *   - **Answers are pulled, and a mismatch throws.** Asking for a click and
 *     finding a move means this port raised a dialog the recording never saw
 *     (or missed one it did), which is a real divergence and should surface
 *     here rather than being papered over.
 *   - **Nothing is answered by guessing.** A dialog kind with no faithful
 *     mapping from the recorded stream throws by name instead of returning a
 *     plausible default, so a file that uses one fails honestly.
 */

import { Location } from '../core/location';
import { ChoiceButton, MessageRecord, SpecCtxType, SpecialHost } from '../game/specials/context';
import { GameSession } from '../game/session';
import { doRest } from '../game/rest';
import { Skill } from '../universe/skills';
import { ReplaySource } from './format';
import { PcChoice, SELECT_PC_ALL, SELECT_PC_CANCEL } from '../game/selectPc';

/**
 * Take the next action, insisting it is the click that answers a dialog.
 *
 * `what` names the dialog in the error, because "expected click_control" on its
 * own is not enough to find anything: the useful question is always *which*
 * dialog this port put up that the recording did not.
 */
function popClick(source: ReplaySource, what: string, onAnswered?: () => void): string {
  if (source.exhausted) {
    throw new Error(`replay: ${what} needed an answer, but the recording has ended `
      + '— this port raised a dialog the recording never saw');
  }
  const action = source.pop();
  if (action.type !== 'click_control') {
    throw new Error(`replay: ${what} expected the click that dismissed it, `
      + `but the recording's next action is '${action.type}' `
      + '— this port raised a dialog the recording never saw');
  }
  onAnswered?.();
  return action.info.id ?? '';
}

/**
 * `eSpecKey` (keycodes.hpp:38), the three values the corpus actually types with.
 * The enum is dense and unnumbered, so these are its positions.
 */
const KEY_LEFT = 0;
const KEY_RIGHT = 1;
const KEY_BSP = 8;

export interface ReplayHostOptions {
  /** Raised when the scenario ends, so the caller can stop rather than run on. */
  onEndScenario?: () => void;
  /**
   * Called for each action the host consumes answering a dialog. These come off
   * the same stream the driver walks, so without counting them a completed run
   * looks short — the driver dispatched 152 of 153 actions and the missing one
   * was the click that dismissed a message.
   */
  onAnswered?: () => void;
  /**
   * Called when a **message box** was raised that the recording never answered,
   * and this host dismissed it instead of stopping. It consumes no action, so
   * it is invisible in the action counts — but a run that only finished because
   * boxes were clicked away for it finished on the host's terms, not the
   * recording's, and the caller should be able to say so. The pair on the other
   * side is the harness's `[ASSISTED]` line.
   */
  onOrphanDialog?: (title: string) => void;
}

/**
 * Replay the keystrokes typed into a dialog's text field, and hand back what it
 * ends up holding.
 *
 * **A recording types one key at a time.** `record_field_input` (replay.cpp:215)
 * writes a `field_input` per keypress — `c` for a character, or `spec` with `k`
 * for an arrow or a backspace — so a typed answer cannot be read out of one
 * action; it has to be *entered*, insertion point and all. `field_focus` picks
 * which field the keys belong to; every dialog answered here has exactly one,
 * so it only moves the caret to the end, as `cTextField::callHandler` does.
 *
 * Only the three special keys the corpus actually types with are modelled.
 * Anything else — including `field_selection`, which is how a player replaces a
 * field's default text — is refused by name rather than guessed at.
 */
function typeInto(
  source: ReplaySource, what: string, initial: string, onAnswered?: () => void,
): string {
  let text = initial;
  let caret = text.length;
  while (source.hasNext('field_focus') || source.hasNext('field_input')) {
    const action = source.pop();
    onAnswered?.();
    if (action.type === 'field_focus') {
      caret = text.length;
      continue;
    }
    if (action.info.spec === 'true') {
      switch (Number(action.info.k ?? '-1')) {
        case KEY_LEFT: caret = Math.max(0, caret - 1); break;
        case KEY_RIGHT: caret = Math.min(text.length, caret + 1); break;
        case KEY_BSP:
          if (caret > 0) {
            text = text.slice(0, caret - 1) + text.slice(caret);
            caret--;
          }
          break;
        default:
          throw new Error(`replay: ${what} was typed with special key `
            + `${action.info.k}, which this port does not model`);
      }
      continue;
    }
    const ch = action.info.c ?? '';
    text = text.slice(0, caret) + ch + text.slice(caret);
    caret += ch.length;
  }
  if (source.hasNext('field_selection')) {
    throw new Error(`replay: ${what} had its text selected, which this port `
      + 'does not model (a selection replaces what is typed over it)');
  }
  return text;
}

/**
 * Build the host. `source` must be the one the driver is pulling from — the
 * whole point is that dialogs and actions come off a single stream in the order
 * the C++ consumed them.
 */
export function makeReplayHost(
  session: GameSession, source: ReplaySource, options: ReplayHostOptions = {},
): SpecialHost {
  const { univ } = session;

  return {
    message: async (
      _str1: string, _str2: string, title: string,
      _pic: number, _picType: number, _record?: MessageRecord,
    ): Promise<void> => {
      // A message box has one way out, so which button was clicked does not
      // matter — only that the recording clicked one. The Record button is a
      // second control the player *may* press first; a recording that used it
      // would show two clicks here and the extra one would surface as a
      // mismatch on the next action rather than being silently eaten.
      //
      // **And if the recording never clicked at all, dismiss it and carry on.**
      // Some recordings were made by builds that did not raise the box here —
      // `ASR_05-05-2025_12-20-07` walks onto a one-time message at town (12,14)
      // that *both* this port and the C++ display and the recording answers
      // with nothing. The C++ harness skips it (`[orphan] dialog … dismissing
      // it`, dialog.cpp), so dying here would blame this port for agreeing with
      // the oracle. The two sides have to be tolerant of exactly the same
      // thing or the corpus measures the difference in their strictness.
      //
      // **Only message boxes.** `choice` below stays strict on purpose: it has
      // more than one way out, so inventing an answer picks a branch neither
      // the recording nor the player chose, and the run continues down it
      // silently. Stopping is better than guessing.
      if (source.exhausted || source.peek()?.type !== 'click_control') {
        options.onOrphanDialog?.(title || '(untitled)');
        return;
      }
      popClick(source, `the message box "${title || '(untitled)'}"`, options.onAnswered);
    },

    choice: async (
      _strs: string[], buttons: ChoiceButton[], title: string,
    ): Promise<number> => {
      const id = popClick(
        source, `the choice dialog "${title || '(untitled)'}"`, options.onAnswered);
      // **Matched on the control's name, not its label.** A recording clicks
      // `climb` or `btn2`, never "Climb" — matching labels here failed every
      // scripted stairway, portal, lever and trap in the corpus, and each one
      // took its whole chain down with it.
      const picked = buttons.findIndex((b) => b.name === id);
      if (picked < 0) {
        throw new Error(`replay: the choice dialog "${title}" was answered '${id}', `
          + `which is not one of its buttons `
          + `(${buttons.map((b) => `${b.name}=${b.label}`).join(', ')})`);
      }
      return picked;
    },

    /**
     * select-pc.xml, answered by which button was clicked. Its filter
     * (boe.items.cpp:867) reads the **last character** of the control's name
     * and subtracts '1', so `pick3` is PC 2; `pick-all` is 7 and `cancel` is 6.
     *
     * Note the dialog is only up at all because `runSelectPc` found someone to
     * offer — with nobody pickable the C++ returns 8 without showing anything,
     * and asking here would eat the recording's next real action.
     */
    selectPc: async (
      _rows: PcChoice[], title: string, _highlight?: Skill,
    ): Promise<number> => {
      const id = popClick(
        source, `the select-PC dialog "${title || '(untitled)'}"`, options.onAnswered);
      if (id === 'cancel') return SELECT_PC_CANCEL;
      if (id === 'pick-all') return SELECT_PC_ALL;
      const which = id.charCodeAt(id.length - 1) - '1'.charCodeAt(0);
      if (which < 0 || which > 5) {
        throw new Error(`replay: the select-PC dialog "${title}" was answered '${id}', `
          + 'which names no party member');
      }
      return which;
    },

    /**
     * get-num.xml — "How many? (0-max)".
     *
     * The field arrives **pre-filled with the maximum** (`setTextToNum(max)`,
     * boe.items.cpp:656), so a player who wants the lot just clicks OK and the
     * recording carries no keystrokes at all. Typing goes through the same
     * field model as the text prompt below.
     */
    getNumOfItems: async (max: number): Promise<number> => {
      const what = `the "how many?" prompt (0-${max})`;
      const typed = typeInto(source, what, String(max), options.onAnswered);
      const id = popClick(source, what, options.onAnswered);
      // `cancel` leaves the dialog's result unset, which `getResult<int>` reads
      // back as 0 — so cancelling a split gives up the whole action.
      if (id === 'cancel') return 0;
      const want = Number(typed);
      return Number.isFinite(want) ? Math.max(0, Math.min(max, Math.trunc(want))) : 0;
    },

    // The rest raise dialogs this port cannot yet answer from the stream, and
    // each says so by name. Throwing beats guessing: `story` pages back and
    // forth so its click count depends on how far the player read, and
    // `askText` is answered by `field_input` rather than a click.
    story: async (title: string, _first: number, _last: number,
      _strType: SpecCtxType): Promise<void> => {
      throw new Error(`replay: the story dialog "${title}" is not answerable from a `
        + 'recording yet (its click count depends on how far the player paged)');
    },
    /**
     * `get_text_response` on get-response.xml — the "Ask about what?" prompt,
     * which the talk screen's Ask About word raises.
     *
     * The field starts empty, and what comes back is lowercased.
     */
    askText: async (prompt: string): Promise<string> => {
      const what = `the text prompt "${prompt}"`;
      const typed = typeInto(source, what, '', options.onAnswered);
      const id = popClick(source, what, options.onAnswered);
      // Its filter sets the result to "" on Cancel (boe.items.cpp:843).
      return id === 'cancel' ? '' : typed.toLowerCase();
    },

    // The rest are not dialogs at all: they change state and the recording's
    // following actions act on the result, exactly as in the live game.
    startShop: (which: number, costAdj: number, name: string): boolean =>
      session.startShopMode(which, costAdj, name)
      || session.startShopModeAnyPc(which, costAdj, name),
    startTalk: (monsterIndex: number, personality: number,
      monsterType: number, pic: number): void => {
      session.startTalkMode(monsterIndex, personality, monsterType, pic);
    },
    // No audio in a headless run, and no state behind it.
    sound: (): void => {},
    rest: (length: number, hp: number, sp: number): void => {
      doRest(univ, length, hp, sp, session.isOutdoors, session);
    },
    moveParty: (where: Location): void => {
      if (session.inTown) univ.party.townLoc = { ...where };
      else univ.party.outLoc = { ...where };
      session.center = { ...where };
      session.updateExplored(where);
    },
    forceTown: (town: number, entryDir: number, where: Location): void => {
      // OUT_FORCE_TOWN (boe.specials.cpp:4609): `force_town_enter` and
      // `start_town_mode`, and nothing else. No `end_town_mode`, so the town
      // being left is not remembered — and the entry direction is a real
      // entrance, not `change_level`'s "9 means forced position".
      if (entryDir === 9) session.forceTownEntry(town, where);
      session.startTownMode(town, entryDir);
      session.center = { ...univ.party.townLoc };
    },
    changeLevel: (town: number, where: Location): void => {
      // change_level (boe.specials.cpp:1395): leave, then re-enter elsewhere.
      // The "leave" is a real `end_town_mode(switching_level = true)`, so the
      // level being left goes into the party's four-town memory just as it
      // would if the party had walked out of the gate — take the stairs down
      // and back up and the floor above is as you left it.
      if (where.x >= 0 && where.y >= 0) session.forceTownEntry(town, where);
      session.storeTownOnLeaving();
      session.startTownMode(town, 9);
      session.center = { ...univ.party.townLoc };
    },
    endScenario: (): void => {
      univ.addStringToBuf('*** The scenario is over. ***');
      options.onEndScenario?.();
    },
  };
}
