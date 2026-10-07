/**
 * The list behind Preferences' "Fix known bugs" (`game/bugFixes.ts`), opened
 * by the "?" beside it — blades-of-exile-ts's own, on `known-bugs.xml`, paged
 * like the event journal. Each row is one entry of `KNOWN_BUGS`, with what
 * the preference does about it: fixes it, or leaves it, and why.
 */

import { KNOWN_BUGS } from '../game/bugFixes';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

export const KNOWN_BUGS_DIALOG_DEFS = ['known-bugs'];

const PER_PAGE = 6;

const INTRO = 'With “Fix known bugs in the original games” on, each of these plays as it was ' +
  'probably meant to, unless it says otherwise. Replays always play them as shipped. ' +
  'E3 bugs are Exile III’s own; BoE bugs are the engine’s, in every scenario.';

export interface KnownBugRow {
  /** "E3 #24": Exile III's number in E3-SUSPECTED-BUGS.md; 100 on are the engine's. */
  num: string;
  text: string;
}

export function knownBugRows(): KnownBugRow[] {
  return Object.entries(KNOWN_BUGS).map(([n, bug]) => {
    const num = Number(n) >= 100 ? `BoE #${n}` : `E3 #${n}`;
    let text = `${bug.title}.`;
    if (bug.ruling === 'legit') text += ' Not changed: it was meant.';
    else if (bug.unwired) text += ` Not changed: ${bug.unwired}.`;
    return { num, text };
  });
}

export function knownBugsDialog(ctx: CanvasRenderingContext2D, store: SheetStore): XmlDialog {
  const rows = knownBugRows();
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  let page = 0;
  const dlg = new XmlDialog(ctx, store, getDialogDef('known-bugs'));
  dlg.setText('intro', INTRO);
  const fill = (): void => {
    for (let i = 0; i < PER_PAGE; i++) {
      const row = rows[page * PER_PAGE + i];
      dlg.setText(`num${i + 1}`, row?.num ?? '');
      dlg.setText(`str${i + 1}`, row?.text ?? '');
      if (row) dlg.show(`str${i + 1}`);
      else dlg.hide(`str${i + 1}`);
    }
    dlg.setText('page', `Page ${page + 1} of ${pages}`);
  };
  dlg.attachHandler('left', () => { page = (page + pages - 1) % pages; fill(); return 'stay'; });
  dlg.attachHandler('right', () => { page = (page + 1) % pages; fill(); return 'stay'; });
  if (pages === 1) {
    dlg.hide('left');
    dlg.hide('right');
  }
  // The overlay would name the ◀ by the words beside it, "Page 1 of 4".
  dlg.touchFace = {
    view: () => ({
      right: [
        ...(pages > 1 ? [
          { name: 'left', label: '◀ Previous page' },
          { name: 'right', label: 'Next page ▶', detail: `Page ${page + 1} of ${pages}` },
        ] : []),
        { name: 'done', label: 'Done', section: '' },
      ],
    }),
    press: (name) => dlg.pressControl(name),
  };
  fill();
  return dlg;
}
