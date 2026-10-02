/**
 * `cThreeChoice` (3choice.cpp) — the dialog a special node raises when it asks
 * the party something: a picture, up to six strings, and up to three buttons
 * from `basic_buttons`. The scenario intro uses it too, with Done alone.
 *
 * Unlike every other dialog it has no definition file: `init_strings` sizes
 * the text to how much there is and `init_buttons` lines the buttons up under
 * it, right-aligned. This builds the same layout as a definition, so it runs
 * on `XmlDialog` like everything else.
 */

import { PIC_CUSTOM_FULL } from '../data/special';
import { customSheetSize } from '../render/customPics';
import { ChoiceButton } from '../game/specials/context';
import { STAIR_DLOGS } from '../game/specials/town';
import { SheetStore } from '../render/sheets';
import { measureString, wrapLines } from '../render/text';
import { parseXmlDoc } from '../fileio/xml';
import { ButtonType, readDialogDef } from './dialogXml';
import { pictTypeOf } from './strDialog';
import { XmlDialog } from './xmlDialog';

/** The stock prompts a special node opens from a file instead. */
export const CHOICE_DIALOG_DEFS = [
  'basic-trap', 'basic-portal', 'basic-button', 'basic-lever', ...STAIR_DLOGS,
];

/** `TextStyle`'s defaults (render_text.hpp:41): bold, 10 point. */
const STYLE = { font: 'bold', size: 10 } as const;
/** `InflateRect(&item_rect, -4, -4)` — see `init_strings` below. */
const TEXT_INSET = 4;
/** How `drawText` spaces lines at that size. */
const LINE_HEIGHT = STYLE.size + 2;

/**
 * The `basic_buttons` whose art is not the regular 63px button
 * (basicbtns.cpp:18). Done has its own art with the word painted on it.
 */
const LARGE_LABELS = new Set(['Step In', 'Approach', 'Heal Party', 'Bash Door', 'Pick Lock', 'Go Back']);

function buttonType(label: string): ButtonType {
  if (label === 'Done') return 'done';
  return LARGE_LABELS.has(label) ? 'large' : 'regular';
}

/** The large picture kinds, which push the text further right. */
function isLargePic(picType: number): boolean {
  // PIC_DLOG_LG (13), PIC_SCEN_LG (14), PIC_CUSTOM_DLOG_LG (113).
  return picType === 13 || picType === 14 || picType === 113;
}

export async function threeChoiceDialog(
  ctx: CanvasRenderingContext2D,
  store: SheetStore,
  strs: string[],
  buttons: ChoiceButton[],
  pic: number,
  picType: number,
): Promise<XmlDialog> {
  // `custom_choice_dialog` strips the trailing empty strings; a blank one in
  // the middle keeps its place (3choice.cpp:193).
  const strings = [...strs];
  while (strings.length > 0 && strings[strings.length - 1] === '') strings.pop();

  const controls: string[] = [];
  const large = isLargePic(picType);
  if (pic >= 0) {
    controls.push(`<pict name='pict' type='${pictTypeOf(picType)}' num='${pic}' top='8' left='8'`
      + `${large ? " size='large'" : ''}/>`);
  }
  // A whole scenario sheet (PIC_CUSTOM_FULL) — Exile III's maps and
  // carvings, 120×120 — pushes the text past itself and the buttons below
  // it, as E3's own dialogs lay them out. OBoE has no rule for it; the
  // picture would draw over the text.
  const full = picType === PIC_CUSTOM_FULL && pic >= 0 ? customSheetSize(pic) : null;

  // init_strings (3choice.cpp:69): one width for all of them, the square root
  // of twelve times their total length, never under 340.
  const left = full ? 8 + full.w + 10 : large ? 86 : 50;
  const lengths = strings.map((s) => Math.round(measureString(ctx, s, STYLE)));
  const total = lengths.reduce((a, b) => a + b, 0) * 12;
  // Beside a whole sheet, the text gets what is left of the 605-wide screen:
  // Exile III's province maps are 240 wide, and 340 more would push the
  // dialog and its OK off the right edge.
  const room = full ? 605 - 16 - left - 30 : Infinity;
  const strWidth = Math.min(Math.max(340, Math.trunc(Math.sqrt(total)) + 20), Math.max(160, room));
  let top = 2;
  strings.forEach((s, j) => {
    // The C++'s estimate of the height, which assumes its own font. This
    // port's wraps differently, so a string that would overflow the estimate
    // gets the height its lines actually need rather than being cut off.
    const estimate = Math.trunc((lengths[j]! + 60) / strWidth) * 12 + 16;
    // 1997's `cd_draw_item` draws a text item taller than 20px inset by
    // `TEXT_INSET` on every side (DLOGTOOL.CPP:1266, and Exile III's drawer
    // is the same code). OBoE dropped the inset, which leaves the first line
    // touching the top of the window; this layout is 1997's, so it gets
    // 1997's drawing.
    const needed = wrapLines(ctx, s, strWidth - 2 * TEXT_INSET, STYLE).length * LINE_HEIGHT
      + 4 + 2 * TEXT_INSET;
    const height = Math.max(estimate, needed);
    controls.push(`<text name='str${j + 1}' size='10' top='${top + TEXT_INSET}'`
      + ` left='${left + TEXT_INSET}' width='${strWidth - 2 * TEXT_INSET}'`
      + ` height='${height - 2 * TEXT_INSET}'/>`);
    top += height + 8;
  });
  if (full) top = Math.max(top, 8 + full.h + 8);

  // init_buttons (3choice.cpp:98): right-aligned 30px past the text, slot 2
  // rightmost, then slot 3, then slot 1 — OBoE's reversal of the original's
  // right-to-left order, which put Leave on the right.
  let right = left + strWidth + 30;
  const bySlot = new Map(buttons.map((b) => [Number(b.name.replace(/^btn/, '')) - 1, b]));
  for (const slot of [1, 2, 0]) {
    const b = bySlot.get(slot);
    if (!b) continue;
    const type = buttonType(b.label);
    const w = type === 'large' ? 102 : 63;
    const key = b.key ? ` def-key='${b.key}'` : '';
    controls.push(`<button name='${b.name}' type='${type}'${key}`
      + ` top='${top}' left='${right - w}'>${type === 'done' ? '' : escapeXml(b.label)}</button>`);
    right -= w + 4;
  }

  // Done and OK take Enter and Cancel takes Escape (their `defaultKey`s).
  // Without a Cancel, Escape does nothing: the question has to be answered.
  const enter = buttons.find((b) => b.label === 'Done' || b.label === 'OK');
  const esc = buttons.find((b) => b.label === 'Cancel');
  const attrs = (enter ? ` defbtn='${enter.name}'` : '') + (esc ? ` escbtn='${esc.name}'` : '');
  const def = readDialogDef(await parseXmlDoc(
    `<dialog${attrs}>${controls.join('')}</dialog>`, 'cThreeChoice'));

  const dlg = new XmlDialog(ctx, store, def);
  strings.forEach((s, j) => dlg.setText(`str${j + 1}`, s));
  return dlg;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
}
