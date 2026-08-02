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
import { MessageRecord, SpecCtxType, SpecialHost } from '../game/specials/context';
import { GameSession } from '../game/session';
import { doRest } from '../game/rest';
import { Skill } from '../universe/skills';
import { ReplaySource } from './format';

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
      popClick(source, `the message box "${title || '(untitled)'}"`, options.onAnswered);
    },

    choice: async (
      _strs: string[], buttons: string[], title: string,
    ): Promise<number> => {
      const id = popClick(
        source, `the choice dialog "${title || '(untitled)'}"`, options.onAnswered);
      // The dialog's controls are named for their buttons, so the recorded id
      // is the button — which is what `choice` answers with the index of.
      const picked = buttons.indexOf(id);
      if (picked < 0) {
        throw new Error(`replay: the choice dialog "${title}" was answered '${id}', `
          + `which is not one of its buttons (${buttons.join(', ')})`);
      }
      return picked;
    },

    // The rest raise dialogs this port cannot yet answer from the stream, and
    // each says so by name. Throwing beats guessing: `story` pages back and
    // forth so its click count depends on how far the player read, `askText`
    // is answered by `field_input` rather than a click, and `selectPc` needs
    // the PC buttons of a dialog whose ids this port has not pinned down.
    story: async (title: string, _first: number, _last: number,
      _strType: SpecCtxType): Promise<void> => {
      throw new Error(`replay: the story dialog "${title}" is not answerable from a `
        + 'recording yet (its click count depends on how far the player paged)');
    },
    askText: async (prompt: string): Promise<string> => {
      throw new Error(`replay: the text prompt "${prompt}" is answered by `
        + "'field_input', which the driver does not read yet");
    },
    selectPc: async (prompt: string, _highlight?: Skill): Promise<number> => {
      throw new Error(`replay: the select-PC dialog "${prompt}" is not answerable `
        + 'from a recording yet');
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
    changeLevel: (town: number, where: Location): void => {
      // change_level (boe.specials.cpp:1395): leave, then re-enter elsewhere.
      if (where.x >= 0 && where.y >= 0) session.forceTownEntry(town, where);
      session.startTownMode(town, 9);
      session.center = { ...univ.party.townLoc };
    },
    endScenario: (): void => {
      univ.addStringToBuf('*** The scenario is over. ***');
      options.onEndScenario?.();
    },
  };
}
