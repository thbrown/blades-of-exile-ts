/**
 * `cPictChoice` on `choose-pict.xml` — thirty-six LEDs, each beside a
 * picture, and arrows between pages. The paging rules are `PictChoiceState`'s
 * (`game/pictChoice.ts`); this only draws them.
 *
 * `fillPage` (pictchoice.cpp:79) hides the LEDs and pictures past the end of
 * the list, and lights the LED of the current pick only when it is on the page
 * showing, since the group can hold one lit LED at a time.
 */

import { SheetStore } from '../render/sheets';
import { PictChoiceState } from '../game/pictChoice';
import { PictType } from './dialogXml';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

export const PICT_CHOICE_DIALOG_DEFS = ['choose-pict'];

export interface PictChoiceOptions {
  prompt?: string;
  /** `disableCancel` — pick_pc_graphic's creation mode. */
  noCancel?: boolean;
}

export function pictChoiceDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  picts: readonly { num: number; type: PictType }[], start: number,
  options: PictChoiceOptions = {},
): { dlg: XmlDialog; state: PictChoiceState } {
  const dlg = new XmlDialog(ctx, store, getDialogDef('choose-pict'));
  const state = new PictChoiceState(picts.length, start);
  const fill = (): void => {
    for (let i = 0; i < PictChoiceState.PER_PAGE; i++) {
      const at = state.slot(i);
      const led = `led${i + 1}`;
      const pic = `pic${i + 1}`;
      if (at < 0) {
        dlg.hide(led).hide(pic);
        continue;
      }
      dlg.show(led).show(pic);
      dlg.setLed(led, at === state.cur ? 'red' : 'off');
      const p = picts[at]!;
      dlg.setPictType(pic, p.type, p.num);
    }
  };
  if (picts.length <= PictChoiceState.PER_PAGE) dlg.hide('left').hide('right');
  if (options.noCancel) dlg.hide('cancel');
  if (options.prompt) dlg.setText('prompt', options.prompt);
  for (const id of ['left', 'right']) {
    dlg.attachHandler(id, () => { state.click(id); fill(); return 'stay'; });
  }
  for (let i = 1; i <= PictChoiceState.PER_PAGE; i++) {
    const id = `led${i}`;
    dlg.attachHandler(id, () => { state.click(id); fill(); return 'stay'; });
  }
  dlg.attachHandler('done', () => 'close');
  dlg.attachHandler('cancel', () => 'close');
  fill();
  return { dlg, state };
}
