/**
 * The dialogs that ask the player to *type* something, and the error box a
 * text field raises when what was typed won't do. All three are built on
 * `XmlDialog`'s field; the runner (`DialogHost`) owns showing them.
 *
 * - `get_num_of_items` (boe.items.cpp:667) — "How many? (0-max)" for a stack.
 * - `get_num_response` (strchoice.cpp:323) — a number in a range, for
 *   IF_NUM_RESPONSE. It has no Cancel: the C++ hides the button unless the
 *   caller passes a `cancel_value`, and the special node doesn't.
 * - `get_text_response` (boe.items.cpp:869) — a typed word, lowercased.
 * - `showError` / `showWarning` (strdlog.cpp:84) — a `cStrDlog` titled
 *   "Error" or "Warning" on dialog picture 25 or 24.
 */

import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { strDialog } from './strDialog';
import { XmlDialog } from './xmlDialog';

export const INPUT_DIALOG_DEFS = ['get-num', 'get-response'];

/** `PIC_DLOG` — the numbered pictures on the dialog sheet. */
const PIC_DLOG = 4;

/** The result a dialog below carries back through its closing button. */
export interface NumDialog {
  dlg: XmlDialog;
  /** Read once the dialog has closed on `okay` (or `cancel`). */
  result(closedOn: string): number;
}

/**
 * `get_num_of_items`. Cancel answers 0 — the filter's `setResult<int>(0)` —
 * and anything typed is clamped into range on the way out, not refused.
 *
 * The "choose" button is left showing with nothing attached, as the C++
 * leaves it; `get_num_response` is the one that hides it.
 */
export function numOfItemsDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, maxNum: number,
): NumDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('get-num'));
  dlg.hide('extra-led');
  dlg.attachHandler('choose', () => 'stay');
  dlg.attachHandler('cancel', () => 'close');
  dlg.attachHandler('okay', (me) => (me.toast(true) ? 'close' : 'stay'));
  dlg.setText('prompt', `How many? (0-${maxNum})`);
  dlg.setNum('number', maxNum);
  return {
    dlg,
    result: (closedOn) => (closedOn === 'cancel'
      ? 0 : Math.max(0, Math.min(maxNum, dlg.getTextAsNum('number')))),
  };
}

/**
 * `get_num_response(min, max, prompt)` with every optional argument at its
 * default: no choices, no cancel, an initial 0 and no extra LED. The range is
 * enforced by a focus handler, so OK with an out-of-range number puts up
 * "Number out of range!" and leaves the dialog open.
 */
export function numResponseDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  min: number, max: number, prompt: string, showError: (msg: string) => void,
): NumDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('get-num'));
  dlg.hide('extra-led');
  dlg.hide('choose');
  dlg.hide('cancel');
  dlg.attachHandler('okay', (me) => (me.toast(true) ? 'close' : 'stay'));
  dlg.setText('prompt', `${prompt} (${min}-${max})`);
  dlg.setNum('number', 0);
  if (min < max) {
    dlg.attachFocusHandler('number', (me, losing) => {
      if (!losing) return true;
      const val = me.getTextAsNum('number');
      if (val < min || val > max) {
        showError('Number out of range!');
        return false;
      }
      return true;
    });
  }
  return { dlg, result: () => dlg.getTextAsNum('number') };
}

/**
 * `get_text_response`. Cancel answers "", and the answer comes back
 * lowercased — every caller compares it case-blind, and the C++ does the
 * folding here rather than at each of them.
 */
export function textResponseDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, prompt: string, pic?: number,
  lowercase = true,
): { dlg: XmlDialog; result(closedOn: string): string } {
  const dlg = new XmlDialog(ctx, store, getDialogDef('get-response'));
  dlg.attachHandler('cancel', (me) => { me.toast(true); return 'close'; });
  dlg.attachHandler('okay', (me) => { me.toast(true); return 'close'; });
  if (prompt !== '') {
    if (pic !== undefined) dlg.setPict('pic', pic);
    dlg.setText('prompt', prompt);
  }
  return {
    dlg,
    result: (closedOn) => {
      if (closedOn === 'cancel') return '';
      const text = dlg.getText('response');
      return lowercase ? text.toLowerCase() : text;
    },
  };
}

/** `giveError` — the error box; `warning` picks showWarning's title and picture. */
export function errorDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  str1: string, str2 = '', warning = false,
): XmlDialog {
  return strDialog(ctx, store, {
    str1, str2, title: warning ? 'Warning' : 'Error', pic: warning ? 24 : 25, picType: PIC_DLOG,
  });
}
