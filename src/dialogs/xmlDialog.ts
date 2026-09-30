/**
 * Running a dialogxml definition — the drawing and event halves of `cDialog`
 * (dialogxml/dialogs/dialog.cpp) and its widgets.
 *
 * The C++ blocks in `cDialog::run()` and calls click handlers from inside;
 * here the dialog is a `ModalScreen` the host pumps, and a handler that wants
 * the dialog to stay open says so. That is the same ASYNCIFY replacement
 * PLAN.md §2.3 describes, applied to the toolkit itself.
 *
 * The API mirrors how the game code addresses its dialogs — `me["day"]
 * .setTextToNum(n)`, `me["take1"].hide()` — so a ported call site reads like
 * the original: `dlg.setNum('day', n)`, `dlg.hide('take1')`.
 */

import { customSheetName } from '../render/customPics';
import { Colours } from '../render/colours';
import { centreOnDesktop } from '../render/desktop';
import { UiRect, height, shiftRect, width } from '../render/layout';
import { monsterGraphic } from '../render/monsterPics';
import { SheetStore, calcRect } from '../render/sheets';
import { statIconRect } from '../data/statusIcons';
import { terrainGraphic } from '../render/terrainPics';
import { drawString, drawStringCentre, measureString, wrapLines } from '../render/text';
import { dialogBackground, dialogTextIsWhite, dialogsAreExile3, tilePattern } from '../render/tiling';
import {
  ButtonControl, ButtonType, DialogControl, DialogDef, FieldControl, FieldType, FontSpec,
  KEY_PLACEHOLDER, LedControl, LedState, PaneControl, PictControl, PictType, TextControl, measureDialog,
  pictNaturalSize,
} from './dialogXml';
import type { ModalScreen, TouchChoice, TouchView } from './dialog';
import { drawPictAt } from './pict';
import { windowFrames } from '../render/windowChrome';

/**
 * The dialog's text colour: white on cDialog::BG_DARK, black on anything
 * else (dialog.cpp:406). The background is `dialogBackground()`.
 */
const defText = (): string => (dialogTextIsWhite() ? Colours.WHITE : Colours.BLACK);

/**
 * `cButton::btnRects` (button.cpp:247) — the source rect of each button type's
 * unpressed frame, and which sheet it comes from. The pressed frame sits at a
 * fixed offset, given here as `pressed`.
 */
const BUTTON_ART: Record<ButtonType, {
  sheet: string; w: number; h: number; x: number; y: number;
  pressed: { dx: number; dy: number };
}> = {
  small: { sheet: 'dlogbtnsm', w: 23, h: 23, x: 0, y: 0, pressed: { dx: 23, dy: 0 } },
  regular: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  done: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  left: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 23, pressed: { dx: 63, dy: 0 } },
  right: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 46, pressed: { dx: 63, dy: 0 } },
  up: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 69, pressed: { dx: 63, dy: 0 } },
  down: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 92, pressed: { dx: 63, dy: 0 } },
  large: { sheet: 'dlogbtnlg', w: 102, h: 23, x: 0, y: 0, pressed: { dx: 102, dy: 0 } },
  help: { sheet: 'dlogbtnhelp', w: 16, h: 13, x: 0, y: 0, pressed: { dx: 16, dy: 0 } },
  // btnRects are {top,left,bottom,right}: the tiny button sits at x=42 on the
  // LED sheet, not y=42.
  tiny: { sheet: 'dlogbtnled', w: 14, h: 10, x: 42, y: 0, pressed: { dx: 0, dy: 10 } },
  tall: { sheet: 'dlogbtntall', w: 63, h: 40, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  trait: { sheet: 'dlogbtntall', w: 63, h: 40, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  push: { sheet: 'dlgbtnred', w: 30, h: 30, x: 0, y: 0, pressed: { dx: 30, dy: 0 } },
};

/** `basic_buttons` (basicbtns.cpp:19) — a `done` button labels itself. */
const DONE_LABEL = 'Done';
/** `cButton::initPreset` (button.cpp:328) — and so does a `trait` button. */
const TRAIT_LABEL = 'Race|& Traits';

/** cLed::ledRects (led.cpp:18): three states across, pressed below. */
const LED_W = 14;
const LED_H = 10;
const LED_TEXT_SPACE = 4;
/**
 * `eLedState` (led.hpp:19) is `{led_green = 0, led_red, led_off}` — **green
 * first**, which reads backwards next to the "red means selected" convention
 * the header itself describes. This port had the first two swapped, so every
 * lit LED drew the green lamp: item-info's "ID?" is the visible one.
 */
const LED_ORDER: LedState[] = ['green', 'red', 'off'];

/** The `colour_map` names the dialogs actually use. */
const COLOURS: Record<string, string> = {
  black: Colours.BLACK,
  white: Colours.WHITE,
  red: Colours.RED,
  'light-green': Colours.LIGHT_GREEN,
  'light-blue': Colours.LIGHT_BLUE,
  // `link` is the blue the C++ uses for clickable text in a message.
  link: Colours.LIGHT_BLUE,
};

/** `cPict::getSheet(SHEET_FULL, n)` (pict.cpp:703) — the three named help pictures. */
const FULL_SHEETS: Record<number, string> = { 1400: 'outhelp', 1401: 'fighthelp', 1402: 'townhelp' };

/** The style a text control's own font gives, before any runtime colour. */
function textStyle(font: FontSpec): { font: 'plain' | 'bold' | 'dungeon' | 'maidenword'; size: number; colour: string } {
  return { font: font.font === 'bold' ? 'bold' : font.font, size: font.size, colour: defText() };
}

/**
 * A framed text under Exile III's look, laid out as 1997's `cd_draw_item`
 * lays out E3's message text (DLOGTOOL.CPP:1257): a text taller than 20 is
 * inset 4 on every side and wrapped, one shorter is indented 3 and centred
 * on its line. E3's small bold font also runs wider than this port's, and
 * its lines 13 apart: measured against a 1:1 capture of the north-gate
 * dialog, 0.6px more between letters and a pixel more between lines break
 * its lines where E3 does.
 */
const E3_TEXT = { inset: 4, indent: 3, spacing: 0.6, leading: 1 };

function e3Framed(control: TextControl): boolean {
  return dialogsAreExile3() && control.framed;
}

/** A text's lines, wrapped to its written width when it has one. */
function wrapControlText(ctx: CanvasRenderingContext2D, control: TextControl, text: string): string[] {
  const e3 = e3Framed(control);
  const style = { ...textStyle(control.font), spacing: e3 ? E3_TEXT.spacing : 0 };
  const w = width(control.fileRect) - (e3 && height(control.fileRect) >= 20 ? 2 * E3_TEXT.inset : 0);
  const lines: string[] = [];
  // A '|' is a hard line break (render_text.cpp:159), except in text written
  // into the definition itself, where the C++ shows pipes literally
  // (`showPipes`, message.cpp:76). Scenario text — signs, messages, names —
  // comes in through setText and breaks on them.
  const breaks = control.text.includes('|') ? /\n/ : /\n|\|/;
  for (const paragraph of text.split(breaks)) {
    lines.push(...(paragraph.length === 0 || w <= 0
      ? [paragraph]
      : wrapLines(ctx, paragraph, w, style)));
  }
  return lines;
}

/**
 * Size a definition's texts written without a width or height, with the real
 * fonts (`measureDialog`). Every dialog does this as it opens; code that
 * derives a new definition from a shared one (the compact Preferences) calls
 * it first, because the derived one can't be laid out again from the file.
 */
export function measureDialogDef(ctx: CanvasRenderingContext2D, def: DialogDef): void {
  measureDialog(def, (c) => {
    const lines = wrapControlText(ctx, c, c.text);
    const style = textStyle(c.font);
    return {
      w: Math.max(0, ...lines.map((l) => measureString(ctx, l, style))) + 16,
      h: lines.length * (c.font.size + 2) + 8,
    };
  });
}

/** A scroll pane's scrollbar width, and how far one wheel notch or arrow moves it. */
const PANE_BAR = 8;
const PANE_STEP = 12;

/** An Exile III button's label colour. */
const E3_BUTTON_TEXT = 'rgb(0,0,100)';

/**
 * Exile III's sunken frame round a text or a picture (`cd_frame_item`), the
 * one the spell dialog's boxes use: mid grey along the top and left, white
 * along the bottom and right, one pixel each, on the edge of `r`.
 */
function e3SunkenFrame(ctx: CanvasRenderingContext2D, r: UiRect): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgb(128,128,128)';
  ctx.beginPath();
  ctx.moveTo(r.left + 0.5, r.bottom - 0.5);
  ctx.lineTo(r.left + 0.5, r.top + 0.5);
  ctx.lineTo(r.right - 0.5, r.top + 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgb(255,255,255)';
  ctx.beginPath();
  ctx.moveTo(r.right - 0.5, r.top + 1.5);
  ctx.lineTo(r.right - 0.5, r.bottom - 0.5);
  ctx.lineTo(r.left + 1.5, r.bottom - 0.5);
  ctx.stroke();
}

/** cControl::drawFrame's two greys (control.cpp:443). */
const FRAME_DARK = 'rgb(48,48,48)';
const FRAME_LIGHT = 'rgb(224,224,224)';

/**
 * How big a control actually is. The C++ settles this when the definition is
 * parsed — `cButton::setBtnType` and `cLed` write their art's size into the
 * control's frame — so by the time `recalcRect` measures the window the sizes
 * are there. This port keeps the definition as read and answers the question
 * here instead, which means *both* the measuring pass and the hit test have to
 * ask; a button given only a `top`/`left` (quest-info's Done) sized as nothing
 * otherwise, and the window closed above it.
 *
 * A pict is the exception: it draws at its picture's natural size, which can
 * change at runtime with `setPictType`, so it is left as written.
 */
function controlSize(control: DialogControl): { w: number; h: number } {
  let w = width(control.rect);
  let h = height(control.rect);
  if (control.kind === 'button') {
    const art = BUTTON_ART[control.type];
    // A button is exactly its art, except the labelled kinds, which the
    // definition may stretch wider.
    w = Math.max(w, art.w);
    h = Math.max(h, art.h);
    if (control.type !== 'large' && control.type !== 'regular' && control.type !== 'done') {
      w = art.w;
      h = art.h;
    }
  } else if (control.kind === 'led') {
    w = Math.max(w, LED_W);
    h = Math.max(h, LED_H);
  }
  return { w, h };
}

/** What a handler tells the runner to do once it has run. */
export type DialogAction = 'stay' | 'close';

/**
 * Where `showError` goes when a text field refuses to give up the focus. The
 * C++ opens a `cStrDlog` on top of the dialog (strdlog.cpp:111); the host that
 * owns the modal stack installs that here, and a test leaves it unset.
 */
let fieldErrorSink: ((message: string) => void) | null = null;

export function setFieldErrorSink(sink: ((message: string) => void) | null): void {
  fieldErrorSink = sink;
}

/**
 * `cTextField`'s defocus check (field.cpp:22) — `boost::lexical_cast` of the
 * whole text, which is strict: no spaces, no trailing junk, and an empty
 * field is not a number.
 */
export function fieldTextValid(type: FieldType, text: string): boolean {
  switch (type) {
    case 'int': return /^[+-]?\d+$/.test(text);
    case 'uint': return /^\+?\d+$/.test(text);
    case 'real': return text.trim() === text && text !== '' && Number.isFinite(Number(text));
    case 'text':
    default: return true;
  }
}

const FIELD_TYPE_NAMES: Record<FieldType, string> = {
  int: 'an integer', uint: 'a non-negative integer', real: 'a number', text: '',
};

/** `cTextField::draw`'s style: 12pt plain black on white (field.cpp:301). */
const FIELD_STYLE = { size: 12, colour: Colours.BLACK, font: 'plain' as const };

export interface XmlDialogOptions {
  /** Where to put the panel; by default it is centred, as the C++ centres it. */
  origin?: { x: number; y: number };
}

/**
 * One running dialog. Controls keep their definition; what the game changes at
 * runtime (text, visibility, LED state, picture number) lives in the maps here,
 * so a definition can be shown twice without carrying state between showings.
 */
export class XmlDialog implements ModalScreen {
  /** Where it sits on the desktop; `moveBy` drags it. */
  frame: UiRect;

  bounds(): UiRect { return this.frame; }

  moveBy(dx: number, dy: number): void {
    this.frame = shiftRect(this.frame, dx, dy);
  }
  private textOverride = new Map<string, string>();
  private hidden = new Set<string>();
  private ledState = new Map<string, LedState>();
  private picNum = new Map<string, number>();
  private picType = new Map<string, PictType>();
  private colour = new Map<string, string>();
  private handlers = new Map<string, (dlg: XmlDialog) => DialogAction>();
  /** Keys attached at runtime; `def-key` in the definition is separate. */
  private keys = new Map<string, string>();
  /** `cDialog::addLabelFor` — a text control synthesised beside another. */
  private labels = new Map<string, { text: string; bold: boolean; colour: string }>();
  private labelPos = new Map<string, { where: 'left' | 'right' | 'above' | 'below'; offset: number }>();
  /** Where the `neg`-positioned controls ended up (see the constructor). */
  private placed = new Map<DialogControl, UiRect>();
  /** The control the pointer is holding down, drawn pressed. */
  private pressed: string | null = null;
  /**
   * `cDialog::currentFocus` — the text field typing goes into. `cDialog::run`
   * starts it on the first *visible* field in tab order (dialog.cpp:519), and
   * visibility is only settled once the caller has finished hiding things, so
   * it is picked on first use rather than in the constructor.
   */
  private focus: string | null = null;
  private focusPicked = false;
  /** Each field's insertion point, as an index into its text. */
  private caret = new Map<string, number>();
  /**
   * Fields whose whole text is selected. `cTextField::setText` puts the
   * insertion point at the end and the selection point at 0 (field.cpp:68),
   * so a prefilled field — "How many?" with the stack size in it — is replaced
   * by the first thing typed rather than appended to.
   */
  private selectedAll = new Set<string>();
  /** `attachFocusHandler` — false from a losing call keeps the focus. */
  private focusHandlers = new Map<string, (dlg: XmlDialog, losing: boolean) => boolean>();

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    readonly def: DialogDef,
    options: XmlDialogOptions = {},
  ) {
    // Texts written without a height or width take the size of their text,
    // measured with the real fonts, so everything placed after them moves to
    // clear them (`cTextMsg::recalcRect`: the lines plus 8, the width plus 16).
    measureDialogDef(ctx, def);
    // `cDialog::recalcRect` (dialog.cpp:425): the window is as big as its
    // furthest control plus a 6px margin. Controls positioned against the
    // dialog's own edges (`neg` with no anchor) are placed afterwards, since
    // they need the size that measurement produced.
    let right = 0;
    let bottom = 0;
    for (const c of def.controls) {
      if (this.negX(c) || this.negY(c)) continue;
      const { w, h } = controlSize(c);
      right = Math.max(right, c.rect.left + w);
      bottom = Math.max(bottom, c.rect.top + h);
    }
    right += 6;
    bottom += 6;
    for (const c of def.controls) {
      if (!this.negX(c) && !this.negY(c)) continue;
      const w = width(c.rect);
      const h = height(c.rect);
      const left = this.negX(c) ? right - c.rect.left : c.rect.left;
      const top = this.negY(c) ? bottom - c.rect.top : c.rect.top;
      // Kept on the instance: the definition is shared, and writing the
      // placed rect back into it flipped the control on every other showing.
      this.placed.set(c, { top, left, bottom: top + h, right: left + w });
    }
    const origin = options.origin ?? centreOnDesktop(right, bottom);
    this.frame = {
      left: origin.x, top: origin.y, right: origin.x + right, bottom: origin.y + bottom,
    };
  }

  private tabOrder(): FieldControl[] {
    return this.fields()
      .filter((f) => !this.hidden.has(f.name))
      .sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0));
  }

  private pickFocus(): void {
    if (this.focusPicked) return;
    this.focusPicked = true;
    const first = this.tabOrder()[0];
    if (!first) return;
    this.focus = first.name;
    this.focusHandlers.get(first.name)?.(this, false);
    this.placeCaret(first.name);
  }

  /** A control still carrying `neg` positioning is placed against the window. */
  private negX(c: DialogControl): boolean {
    return !c.anchor && !c.relAnchor && (c.relative[0] === 'neg');
  }

  private negY(c: DialogControl): boolean {
    const [h = 'abs', v = h] = c.relative;
    return !c.anchor && !c.relAnchor && v === 'neg';
  }

  // ------------------------------------------------------------- the API

  /** `me[name].setText(str)`. */
  setText(name: string, text: string): this {
    this.textOverride.set(name, text);
    if (this.def.byName.get(name)?.kind === 'field') {
      this.caret.set(name, text.length);
      this.selectedAll.add(name);
    }
    return this;
  }

  /** `me[name].setTextToNum(n)`. */
  setNum(name: string, n: number): this {
    return this.setText(name, String(n));
  }

  getText(name: string): string {
    const override = this.textOverride.get(name);
    if (override !== undefined) return override;
    const control = this.def.byName.get(name);
    if (!control) return '';
    if (control.kind === 'text' || control.kind === 'field') return control.text;
    if (control.kind === 'button' || control.kind === 'led') return control.label;
    return '';
  }

  show(name: string): this {
    this.hidden.delete(name);
    return this;
  }

  hide(name: string): this {
    this.hidden.add(name);
    return this;
  }

  isVisible(name: string): boolean {
    return !this.hidden.has(name);
  }

  /** `me[name].setPict(n)` — swap which picture a `<pict>` shows. */
  setPict(name: string, num: number): this {
    this.picNum.set(name, num);
    return this;
  }

  /** `setPict(n, type)` — the two-argument form, which also changes the kind. */
  setPictType(name: string, type: PictType, num: number): this {
    this.picType.set(name, type);
    return this.setPict(name, num);
  }

  setColour(name: string, colour: string): this {
    this.colour.set(name, colour);
    return this;
  }

  setLed(name: string, state: LedState): this {
    this.ledState.set(name, state);
    // A group lights one LED at a time, so setting one clears its siblings.
    const group = this.def.controls.find(
      (c) => c.kind === 'group' && c.leds.some((l) => l.name === name));
    if (group?.kind === 'group' && state !== 'off') {
      for (const led of group.leds) {
        if (led.name !== name) this.ledState.set(led.name, 'off');
      }
    }
    return this;
  }

  getLed(name: string): LedState {
    const control = this.def.byName.get(name);
    return this.ledState.get(name)
      ?? (control?.kind === 'led' ? control.state : 'off');
  }

  /** The lit LED of a group, or null — `cLedGroup::getSelected`. */
  getSelected(group: string): string | null {
    const control = this.def.byName.get(group);
    if (control?.kind !== 'group') return null;
    for (const led of control.leds) if (this.getLed(led.name) !== 'off') return led.name;
    return null;
  }

  /**
   * `attachClickHandler`. Without one, clicking a control closes the dialog and
   * hands its name back — which is what the majority of the game's buttons do.
   */
  /**
   * `me[id].attachKey({...})` — a shortcut the *code* attaches rather than the
   * definition. get-items.xml's eight rows get 'a'-'h' this way.
   */
  attachKey(name: string, key: string): this {
    this.keys.set(name, key.toLowerCase());
    return this;
  }

  /**
   * `cDialog::addLabelFor` (dialog.cpp:971) — a small text label placed against
   * one edge of a control. `offset` is doubled, as the C++ doubles it.
   *
   * **The label is a control of its own**, a 10pt `cTextMsg`, and it *copies*
   * the control's colour when it is made — a button on a dark background
   * gives it the default text colour instead. So recolouring the control
   * afterwards leaves the label alone, which is how spend-xp's numbers turn
   * green and red while their labels stay white. Setting the text of a label
   * that already exists keeps the colour it was made with, as the C++'s
   * `appendText` on the existing label does.
   */
  setLabel(
    name: string, text: string, where: 'left' | 'right' | 'above' | 'below' = 'left',
    offset = 7, bold = false,
  ): this {
    const existing = this.labels.get(name);
    const control = this.def.byName.get(name);
    const colour = existing?.colour
      ?? (control?.kind === 'button' ? defText() : this.resolvedColour(name));
    this.labels.set(name, { text, bold, colour });
    this.labelPos.set(name, { where, offset });
    return this;
  }

  /** A control's colour as drawn — its override, its definition's, or the default. */
  private resolvedColour(name: string): string {
    const control = this.def.byName.get(name);
    const named = this.colour.get(name)
      ?? (control && 'font' in control ? control.font.colour : undefined);
    return named ? COLOURS[named] ?? named : defText();
  }

  /** `cDialog::setEscapeButton` — which button Escape presses, over the definition's. */
  setEscapeButton(name: string): this {
    this.escBtn = name;
    return this;
  }

  private escBtn: string | undefined;

  attachHandler(name: string, fn: (dlg: XmlDialog) => DialogAction): this {
    this.handlers.set(name, fn);
    return this;
  }

  /** `attachFocusHandler` — asked when a field gains (`losing` false) or loses focus. */
  attachFocusHandler(name: string, fn: (dlg: XmlDialog, losing: boolean) => boolean): this {
    this.focusHandlers.set(name, fn);
    return this;
  }

  /** `cControl::getTextAsNum` — `istringstream >> n`, so leading digits count. */
  getTextAsNum(name: string): number {
    const n = parseInt(this.getText(name).trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  get focused(): string | null {
    this.pickFocus();
    return this.focus;
  }

  /**
   * `cDialog::toast(triggerFocus)`. Accepting runs the focused field's
   * defocus check first, and refuses to close — returning false — when it
   * fails, which is how a "How many?" box with "abc" in it stays open. A
   * handler that means to close on accept calls this and returns 'close' only
   * if it said yes.
   */
  toast(accept: boolean): boolean {
    this.pickFocus();
    if (accept && this.focus !== null) return this.defocus(this.focus);
    return true;
  }

  /** `cTextField::callHandler(EVT_DEFOCUS)` — type check, then the handler. */
  private defocus(name: string): boolean {
    const control = this.def.byName.get(name);
    if (control?.kind !== 'field') return true;
    if (!fieldTextValid(control.type, this.getText(name))) {
      fieldErrorSink?.(`You need to enter ${FIELD_TYPE_NAMES[control.type]}!`);
      return false;
    }
    const handler = this.focusHandlers.get(name);
    return handler ? handler(this, true) : true;
  }

  /** `cDialog::setFocus` — only if the field that has it lets go. */
  setFocus(name: string): boolean {
    this.pickFocus();
    if (this.focus === name) return true;
    if (this.focus !== null && !this.defocus(this.focus)) return false;
    this.focus = name;
    this.focusHandlers.get(name)?.(this, false);
    this.placeCaret(name);
    return true;
  }

  /**
   * A field focused for the first time: the insertion point goes to the end,
   * and since the selection point starts at 0 (field.cpp:295), everything
   * already in it is selected.
   */
  private placeCaret(name: string): void {
    if (this.caret.has(name)) return;
    const len = this.getText(name).length;
    this.caret.set(name, len);
    if (len > 0) this.selectedAll.add(name);
  }

  private fields(): FieldControl[] {
    return this.def.controls.filter((c): c is FieldControl => c.kind === 'field');
  }

  /** `handleTabOrder` — the next field by `tab-order`, then by position. */
  private tab(back: boolean): void {
    const order = this.tabOrder();
    if (order.length < 2 || this.focus === null) return;
    const at = order.findIndex((f) => f.name === this.focus);
    const next = order[(at + (back ? order.length - 1 : 1)) % order.length]!;
    if (this.setFocus(next.name)) this.caret.set(next.name, this.getText(next.name).length);
  }

  /**
   * `cTextField::handleInput` (field.cpp:488), cut down to one line with no
   * selection: characters insert at the caret, and the editing keys move it.
   * Returns whether the key was the field's.
   */
  private fieldKey(name: string, key: string): boolean {
    const control = this.def.byName.get(name);
    if (control?.kind !== 'field') return false;
    const text = this.getText(name);
    const ip = Math.min(this.caret.get(name) ?? text.length, text.length);
    const put = (next: string, caret: number): void => {
      this.textOverride.set(name, next);
      this.caret.set(name, caret);
    };
    if (this.selectedAll.delete(name) && text.length > 0) {
      // A key that edits replaces the selection; one that moves collapses it.
      if (key.length === 1) {
        put(key, 1);
        return true;
      }
      if (key === 'Backspace' || key === 'Delete') {
        put('', 0);
        return true;
      }
    }
    if (key.length === 1) {
      if (control.maxChars === undefined || control.maxChars < 0 || text.length < control.maxChars)
        put(text.slice(0, ip) + key + text.slice(ip), ip + 1);
      return true;
    }
    switch (key) {
      case 'Backspace': if (ip > 0) put(text.slice(0, ip - 1) + text.slice(ip), ip - 1); return true;
      case 'Delete': if (ip < text.length) put(text.slice(0, ip) + text.slice(ip + 1), ip); return true;
      case 'ArrowLeft': this.caret.set(name, Math.max(0, ip - 1)); return true;
      case 'ArrowRight': this.caret.set(name, Math.min(text.length, ip + 1)); return true;
      case 'Home': case 'ArrowUp': this.caret.set(name, 0); return true;
      case 'End': case 'ArrowDown': this.caret.set(name, text.length); return true;
      default: return false;
    }
  }

  // ------------------------------------------------------- events

  onClick(x: number, y: number): string | null {
    // A click in a field takes the focus there and puts the caret under the
    // pointer (`cTextField::handleClick`, field.cpp:202).
    for (const field of this.fields()) {
      if (this.hidden.has(field.name)) continue;
      const r = this.screenRect(field);
      if (x < r.left - 2 || x >= r.right + 2 || y < r.top - 2 || y >= r.bottom + 2) continue;
      if (this.setFocus(field.name)) {
        const text = this.getText(field.name);
        const origin = r.left + 2 - this.fieldScroll(field.name, r);
        let ip = text.length;
        for (let i = 0; i < text.length; i++) {
          const mid = measureString(this.ctx, text.slice(0, i), FIELD_STYLE)
            + measureString(this.ctx, text[i]!, FIELD_STYLE) / 2;
          if (x < origin + mid) { ip = i; break; }
        }
        this.caret.set(field.name, ip);
        this.selectedAll.delete(field.name);
      }
      return null;
    }
    // A click on a pane's scrollbar pages it towards the click.
    const pane = this.paneAt(x, y);
    if (pane !== null && x >= this.screenRect(pane).right - PANE_BAR) {
      const r = this.screenRect(pane);
      const scroll = this.paneScroll.get(pane) ?? 0;
      const range = this.paneRange(pane);
      const thumbMid = r.top + (range > 0 ? height(r) * scroll / range : 0);
      this.scrollPane(pane, (y < thumbMid ? -1 : 1) * (height(r) - PANE_STEP));
      return null;
    }
    const hit = this.controlAt(x, y);
    this.pressed = null;
    if (!hit) return null;
    return this.activate(hit.name);
  }

  onKey(key: string): string | null {
    this.pickFocus();
    // A focused field gets everything but Enter and Escape (dialog.cpp:918).
    // The C++ lets a button's hotkey fire *as well*, and warns against
    // putting a typable one beside a field; none of the player's do, so here
    // the field simply wins.
    if (this.focus !== null && !this.hidden.has(this.focus)) {
      if (key === 'Tab') { this.tab(false); return null; }
      if (key !== 'Escape' && key !== 'Enter' && key !== 'Return'
        && this.fieldKey(this.focus, key)) return null;
    }
    // The arrow keys and Page Up/Down scroll the dialog's pane, if it has one.
    const pane = this.def.controls.find((c): c is PaneControl => c.kind === 'pane');
    if (pane !== undefined) {
      const step = key === 'ArrowUp' ? -PANE_STEP : key === 'ArrowDown' ? PANE_STEP
        : key === 'PageUp' ? -(height(pane.rect) - PANE_STEP)
          : key === 'PageDown' ? height(pane.rect) - PANE_STEP : 0;
      if (step !== 0) { this.scrollPane(pane, step); return null; }
    }
    const esc = this.escBtn ?? this.def.escBtn;
    if (key === 'Escape' && esc) return this.activate(esc);
    if ((key === 'Enter' || key === 'Return') && this.def.defBtn) {
      return this.activate(this.def.defBtn);
    }
    const wanted = key.length === 1 ? key.toLowerCase() : KEY_NAMES[key];
    if (!wanted) return null;
    for (const control of this.clickable()) {
      if (control.defKey === wanted) return this.activate(control.name);
      if (control.name && this.keys.get(control.name) === wanted)
        return this.activate(control.name);
    }
    return null;
  }

  /** Run a control's handler, or close with its name when it has none. */
  private activate(name: string): string | null {
    if (this.hidden.has(name)) return null;
    const control = this.def.byName.get(name);
    // An LED toggles itself before its handler sees the click, as cLedGroup
    // does when it selects one of its own.
    if (control?.kind === 'led') {
      this.setLed(name, this.getLed(name) === 'off' ? 'red' : 'off');
    }
    const handler = this.handlers.get(name);
    // An LED with no handler just toggles — it never closes the dialog, as a
    // button with none does here. (preferences.xml's LEDs rely on it.)
    if (!handler) return control?.kind === 'led' ? null : name;
    return handler(this) === 'close' ? name : null;
  }

  // ------------------------------------------------------- touch

  /**
   * The dialog's controls for the touch overlay: every button, LED and link a
   * click could land on, named as the player would read them. A button whose
   * face is only its shortcut (select-pc's "1"…"6") takes the words beside it
   * as well, since those are what it picks.
   */
  touchView(): TouchView {
    this.pickFocus();
    const right: TouchChoice[] = [];
    for (const c of this.clickable()) {
      if (!c.name || this.hidden.has(c.name) || c.kind === 'pict') continue;
      if (c.kind === 'led') {
        const label = oneLine(this.getText(c.name)) || oneLine(this.labels.get(c.name)?.text ?? '') || humanise(c.name);
        right.push({ name: c.name, label, on: this.getLed(c.name) !== 'off' });
        continue;
      }
      let label = oneLine(this.fillKey(c, this.getText(c.name)));
      const key = (this.keys.get(c.name) ?? c.defKey ?? '').trim();
      if (c.kind === 'button' && (label.length <= 2 || label === key)) {
        const beside = this.textBeside(c);
        if (beside) label = key.length === 1 ? `${key.toUpperCase()}. ${beside}` : beside;
      }
      if (!label) label = oneLine(this.labels.get(c.name)?.text ?? '');
      if (!label && c.kind === 'button') label = ARROW_FACES[c.type] ?? '';
      if (!label) label = humanise(c.name);
      right.push({ name: c.name, label });
    }
    const view: TouchView = { right };
    const focus = this.focus;
    if (focus !== null && !this.hidden.has(focus)) view.field = { name: focus, text: this.getText(focus) };
    return view;
  }

  /** A click on `name`, without the click. */
  touchPress(name: string): string | null {
    this.pressed = null;
    return this.activate(name);
  }

  /** The whole of a field's text, as a phone's keyboard left it. */
  touchType(name: string, text: string): void {
    const control = this.def.byName.get(name);
    if (control?.kind !== 'field') return;
    const max = control.maxChars;
    const next = max !== undefined && max >= 0 ? text.slice(0, max) : text;
    this.textOverride.set(name, next);
    this.caret.set(name, next.length);
    this.selectedAll.delete(name);
  }

  /** The nearest visible words to the right of a control, on its line. */
  private textBeside(control: DialogControl): string {
    const b = this.screenRect(control);
    let best = '';
    let bestGap = 280;
    for (const t of this.def.controls) {
      if (t.kind !== 'text' || (t.name && this.hidden.has(t.name))) continue;
      const r = this.screenRect(t);
      const mid = (r.top + r.bottom) / 2;
      if (mid < b.top - 4 || mid > b.bottom + 4) continue;
      const gap = r.left - b.right;
      if (gap < -4 || gap >= bestGap) continue;
      const text = oneLine(t.name ? this.getText(t.name) : t.text);
      if (!text) continue;
      best = text;
      bestGap = gap;
    }
    return best;
  }

  /** Every control a click can land on, in draw order. */
  private clickable(): DialogControl[] {
    const out: DialogControl[] = [];
    for (const c of this.def.controls) {
      if (c.kind === 'button' || c.kind === 'led') out.push(c);
      else if (c.kind === 'group') out.push(...c.leds);
      // A pict or a text with a shortcut is clickable too (view-sign's
      // picture, and the `def-key` messages some dialogs use as links).
      else if ((c.kind === 'pict' || c.kind === 'text') && (c.defKey || this.handlers.has(c.name))) {
        out.push(c);
      }
    }
    return out;
  }

  private controlAt(x: number, y: number): DialogControl | null {
    // Topmost first: where two controls' rects overlap — an LED's measured
    // label reaching the next one's lamp — the one drawn last, on top, wins.
    for (const control of this.clickable().reverse()) {
      if (!control.name || this.hidden.has(control.name)) continue;
      const r = this.screenRect(control);
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return control;
    }
    return null;
  }

  /** A control's rect in screen coordinates (its own is dialog-relative). */
  screenRect(control: DialogControl): UiRect {
    const rect = this.placed.get(control) ?? control.rect;
    const { w, h } = controlSize(control);
    return {
      left: this.frame.left + rect.left,
      top: this.frame.top + rect.top,
      right: this.frame.left + rect.left + w,
      bottom: this.frame.top + rect.top + h,
    };
  }

  // ------------------------------------------------------- drawing

  draw(): void {
    this.pickFocus();
    const { ctx, frame } = this;
    // Drawn as a window, the pattern goes to the edge and the window's own
    // 1px edge goes over it, in place of this black frame and its shadow.
    const edge = windowFrames.on ? 0 : 2;
    if (!windowFrames.on) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(frame.left + 4, frame.top + 4, width(frame), height(frame));
      ctx.fillStyle = Colours.BLACK;
      ctx.fillRect(frame.left, frame.top, width(frame), height(frame));
    }
    const pats = this.store.get('pixpats');
    const inner: UiRect = {
      top: frame.top + edge, left: frame.left + edge,
      bottom: frame.bottom - edge, right: frame.right - edge,
    };
    if (pats) tilePattern(ctx, pats, dialogBackground(), inner, { x: frame.left, y: frame.top });
    else {
      ctx.fillStyle = Colours.GREY;
      ctx.fillRect(inner.left, inner.top, width(inner), height(inner));
    }

    for (const control of this.def.controls) this.drawControl(control);
  }

  private drawControl(control: DialogControl): void {
    if (control.name && this.hidden.has(control.name)) return;
    switch (control.kind) {
      case 'text': this.drawText(control); break;
      case 'button': this.drawButton(control); break;
      case 'pict': this.drawPict(control); break;
      case 'led': this.drawLed(control); break;
      case 'group':
        for (const led of control.leds) {
          if (!this.hidden.has(led.name)) this.drawLed(led);
        }
        break;
      case 'field': this.drawField(control); break;
      case 'line': this.drawLine(control); break;
      case 'pane': this.drawPane(control); break;
      default: break;
    }
    if (control.name && this.labels.has(control.name)) this.drawLabel(control);
  }

  // ------------------------------------------------------- scroll panes

  /** How far each pane is scrolled, in pixels. */
  private paneScroll = new Map<PaneControl, number>();

  /** How far a pane can scroll: its contents' bottom past its own. */
  private paneRange(pane: PaneControl): number {
    // A text runs to its last line, whatever height the file gave it: the
    // credits' columns are written a guessed "10 times the number of lines".
    const bottom = Math.max(pane.rect.bottom, ...pane.children.map((c) => (c.kind === 'text'
      ? c.rect.top + this.wrapText(c, c.text).length * (c.font.size + 2)
      : c.rect.bottom)));
    return Math.max(0, bottom - pane.rect.bottom);
  }

  private scrollPane(pane: PaneControl, by: number): void {
    const to = Math.max(0, Math.min(this.paneRange(pane), (this.paneScroll.get(pane) ?? 0) + by));
    this.paneScroll.set(pane, to);
  }

  private paneAt(x: number, y: number): PaneControl | null {
    for (const c of this.def.controls) {
      if (c.kind !== 'pane') continue;
      const r = this.screenRect(c);
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return c;
    }
    return null;
  }

  /** The children, clipped to the pane and moved up by its scroll; a scrollbar down the right. */
  private drawPane(pane: PaneControl): void {
    const { ctx } = this;
    const r = this.screenRect(pane);
    const scroll = this.paneScroll.get(pane) ?? 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, width(r), height(r));
    ctx.clip();
    ctx.translate(0, -scroll);
    for (const child of pane.children) this.drawControl(child);
    ctx.restore();
    const range = this.paneRange(pane);
    if (range <= 0) return;
    const track = { left: r.right - PANE_BAR, top: r.top, w: PANE_BAR, h: height(r) };
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(track.left, track.top, track.w, track.h);
    const thumbH = Math.max(12, Math.round(track.h * track.h / (track.h + range)));
    const thumbTop = track.top + Math.round((track.h - thumbH) * scroll / range);
    ctx.fillStyle = 'rgb(160,160,160)';
    ctx.fillRect(track.left + 1, thumbTop, track.w - 2, thumbH);
  }

  /**
   * The mouse wheel over a pane scrolls it. True if it did anything — the
   * host then redraws and keeps the page from scrolling too.
   */
  onWheel(x: number, y: number, deltaY: number): boolean {
    const pane = this.paneAt(x, y);
    if (pane === null) return false;
    this.scrollPane(pane, Math.sign(deltaY) * PANE_STEP);
    return true;
  }

  /**
   * `cButton::draw` (button.cpp:88) — the `<key/>` placeholder in a label is
   * replaced with the control's shortcut when it is drawn, not when it is
   * parsed, because the code may attach the key afterwards.
   */
  private fillKey(control: DialogControl, label: string): string {
    if (!label.includes(KEY_PLACEHOLDER)) return label;
    const key = (control.name ? this.keys.get(control.name) : undefined) ?? control.defKey ?? '';
    return label.split(KEY_PLACEHOLDER).join(key);
  }

  /** The label `addLabelFor` places beside a control. */
  private drawLabel(control: DialogControl): void {
    const label = this.labels.get(control.name)!;
    if (!label.text) return;
    const { where, offset } = this.labelPos.get(control.name)
      ?? { where: 'left' as const, offset: 7 };
    const b = this.screenRect(control);
    let rect: UiRect;
    switch (where) {
      case 'right': rect = { ...b, left: b.right, right: b.right + 2 * offset }; break;
      case 'above': rect = { ...b, bottom: b.top, top: b.top - 2 * offset }; break;
      case 'below': rect = { ...b, top: b.bottom, bottom: b.bottom + 2 * offset }; break;
      case 'left':
      default: rect = { ...b, right: b.left, left: b.left - 2 * offset }; break;
    }
    // The label is grown to at least 14px tall and nudged down otherwise, as
    // addLabelFor does before it places the control.
    const h = rect.bottom - rect.top;
    if (h < 14) {
      const expand = Math.trunc((14 - h) / 2) + 1;
      rect = { ...rect, top: rect.top - expand, bottom: rect.bottom + expand };
    } else {
      const by = Math.trunc(h / 6);
      rect = { ...rect, top: rect.top + by, bottom: rect.bottom + by };
    }
    drawString(this.ctx, rect, label.text, {
      size: 10, font: label.bold ? 'bold' : 'plain', colour: label.colour,
    });
  }

  private style(font: FontSpec, name: string): { font: 'plain' | 'bold' | 'dungeon' | 'maidenword'; size: number; colour: string } {
    const named = this.colour.get(name) ?? font.colour;
    return {
      font: font.font === 'bold' ? 'bold' : font.font,
      size: font.size,
      colour: named ? COLOURS[named] ?? named : defText(),
    };
  }

  /** cControl::drawFrame (control.cpp:440) — a 2px inset frame. */
  private drawFrame(rect: UiRect): void {
    const { ctx } = this;
    const r = { top: rect.top - 2, left: rect.left - 2, bottom: rect.bottom + 2, right: rect.right + 2 };
    if (dialogsAreExile3()) {
      e3SunkenFrame(ctx, r);
      return;
    }
    ctx.strokeStyle = FRAME_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, width(r) - 1, height(r) - 1);
    // The inset highlight: the same frame again, clipped to everything but the
    // top and left edges, so the light grey shows only on the inside corner.
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left + 1, r.top + 1, width(r) - 1, height(r) - 1);
    ctx.clip();
    ctx.strokeStyle = FRAME_LIGHT;
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, width(r) - 1, height(r) - 1);
    ctx.restore();
  }

  /** A text's lines, wrapped to its width when it has one. */
  private wrapText(control: TextControl, text: string): string[] {
    return wrapControlText(this.ctx, control, text);
  }

  private drawText(control: TextControl): void {
    const full = this.screenRect(control);
    if (control.framed) this.drawFrame(full);
    const e3 = e3Framed(control);
    const oneLine = height(full) < 20;
    const rect = !e3 ? full : oneLine ? { ...full, left: full.left + E3_TEXT.indent }
      : { top: full.top + E3_TEXT.inset, left: full.left + E3_TEXT.inset,
        bottom: full.bottom - E3_TEXT.inset, right: full.right - E3_TEXT.inset };
    const style = { ...this.style(control.font, control.name), spacing: e3 ? E3_TEXT.spacing : 0 };
    const text = this.fillKey(control, this.getText(control.name) || control.text);
    if (!text) return;
    // A message wraps inside its own rect, which is what gives the multi-line
    // blocks in the game's dialogs their shape. One written with no width or
    // height is sized to its text instead (`cTextMsg::recalcRect`,
    // message.cpp:139): it does not wrap, and nothing is cut off below it.
    // Nothing in a scroll pane is cut short; the pane does the clipping.
    const inPane = this.def.controls.some((c) => c.kind === 'pane' && c.children.includes(control));
    const fixedHeight = height(rect) > 0 && !control.autoHeight && !inPane;
    const lines = this.wrapText(control, text);
    const lineHeight = style.size + 2 + (e3 ? E3_TEXT.leading : 0);
    // A one-line E3 text sits in the middle of its box (`DT_VCENTER`).
    let y = e3 && oneLine ? rect.top + Math.floor((height(rect) - style.size) / 2) - 1 : rect.top;
    for (const line of lines) {
      if (fixedHeight && y > rect.bottom) break;
      const box = { ...rect, top: y, bottom: y + lineHeight };
      if (control.align === 'right') {
        const w = measureString(this.ctx, line, style);
        drawString(this.ctx, { ...box, left: rect.right - w }, line, style);
      } else {
        drawString(this.ctx, box, line, style);
      }
      y += lineHeight;
    }
  }

  private drawButton(control: ButtonControl): void {
    const rect = this.screenRect(control);
    const art = BUTTON_ART[control.type];
    const sheet = this.store.get(art.sheet);
    const down = this.pressed === control.name;
    if (sheet) {
      this.ctx.drawImage(
        sheet,
        art.x + (down ? art.pressed.dx : 0), art.y + (down ? art.pressed.dy : 0),
        art.w, art.h,
        rect.left, rect.top, width(rect), height(rect),
      );
    } else {
      this.ctx.fillStyle = Colours.GREY;
      this.ctx.fillRect(rect.left, rect.top, width(rect), height(rect));
    }
    const label = this.fillKey(control, this.getText(control.name)
      || (control.type === 'done' ? DONE_LABEL
        : control.type === 'trait' ? TRAIT_LABEL : control.label));
    if (!label) return;
    // The face text is black and centred, at 12pt unless the button says
    // otherwise (a tiny button is 9, a push button 10).
    const size = control.textSize
      ?? (control.type === 'tiny' ? 9 : control.type === 'push' ? 10 : 12);
    // E3's are navy (sampled from its own dialog: rgb(0,0,100)).
    const style = { size, colour: dialogsAreExile3() ? E3_BUTTON_TEXT : Colours.BLACK, font: 'bold' as const };
    if (control.type === 'tiny') {
      // A tiny button's label sits *beside* it (TINY_TEXT_OFFSET = 18).
      drawString(this.ctx, { ...rect, left: rect.left + 18, top: rect.top - 1 },
        label, { ...style, colour: this.style(
          { font: 'bold', size }, control.name).colour });
      return;
    }
    // `|` is a forced line break, and the block is lifted half a line for each
    // extra line so it stays centred (button.cpp:93).
    const lines = label.split('|');
    let top = rect.top + Math.floor((height(rect) - size) / 2) - Math.trunc(size / 2) * (lines.length - 1);
    for (const line of lines) {
      drawStringCentre(this.ctx, { ...rect, top }, line, style);
      top += size;
    }
  }

  private drawLed(control: LedControl): void {
    const rect = this.screenRect(control);
    const sheet = this.store.get('dlogbtnled');
    const state = this.getLed(control.name);
    const style = this.style(control.font, control.name);
    const label = this.getText(control.name) || control.label;
    const labelWidth = measureString(this.ctx, label, style);
    const lampLeft = control.labelPos === 'right'
      ? rect.left
      : rect.left + labelWidth + LED_TEXT_SPACE;
    const textLeft = control.labelPos === 'right'
      ? rect.left + LED_W + LED_TEXT_SPACE
      : rect.left;
    if (sheet) {
      this.ctx.drawImage(
        sheet, LED_ORDER.indexOf(state) * LED_W, 0, LED_W, LED_H,
        lampLeft, rect.top, LED_W, LED_H,
      );
    }
    if (label) {
      drawString(this.ctx, { ...rect, left: textLeft, top: rect.top - 1 }, label, style);
    }
  }

  /**
   * The `<pict>` kinds the player's dialogs use. Each draws at its own natural
   * size from the control's top-left, as `cPict`'s draw methods do — the rect
   * in the file is a position, not a scale.
   */
  private drawPict(control: PictControl): void {
    const at = this.screenRect(control);
    const num = this.picNum.get(control.name) ?? control.num;
    const type = this.picType.get(control.name) ?? control.type;
    const large = control.size === 'large';
    const { ctx } = this;
    if (type === 'blank') {
      // "Just a solid fill" (pict.cpp:737), in `fillClr` — black unless the
      // definition gives a colour. The help pages draw their white panels so.
      ctx.fillStyle = control.colour ? COLOURS[control.colour] ?? control.colour : Colours.BLACK;
      ctx.fillRect(at.left, at.top, width(at), height(at));
    } else if (type === 'full') {
      // `drawFullSheet`: a whole image, at its own size. 1400-1402 are the
      // three help pictures; anything else is a scenario's `sheet<n>`.
      const name = FULL_SHEETS[num] ?? `sheet${num}`;
      const sheet = this.store.get(name);
      if (sheet) ctx.drawImage(sheet, at.left, at.top);
    } else if (type === 'custom-full') {
      // PIC_CUSTOM_FULL: the scenario's `sheet<num>`, whole (`drawFullSheet`).
      const sheet = this.store.get(customSheetName(num));
      if (sheet) ctx.drawImage(sheet, at.left, at.top);
    } else {
      drawPictAt(ctx, this.store, type, num, at.left, at.top, large);
    }
    if (control.outline === 'none') return;
    // A picture's frame is `FRM_SOLID` (pict.cpp:144) — one dark line two
    // pixels out, round the picture as it now is rather than as it was read.
    const size = pictNaturalSize(type, num, large);
    const rect = size ? { ...at, right: at.left + size.w, bottom: at.top + size.h } : at;
    if (dialogsAreExile3()) {
      // E3 frames a picture as it frames text (`cd_frame_item`): sunken.
      e3SunkenFrame(ctx, { top: rect.top - 3, left: rect.left - 3, bottom: rect.bottom + 3, right: rect.right + 3 });
      return;
    }
    ctx.strokeStyle = FRAME_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.left - 2 + 0.5, rect.top - 2 + 0.5, width(rect) + 3, height(rect) + 3);
  }

  /**
   * How far a field's text is scrolled left so the caret stays in view. The
   * C++ wraps and scrolls *vertically*; every field the player meets is one
   * line tall, where that would hide the text, so this scrolls sideways.
   */
  private fieldScroll(name: string, rect: UiRect): number {
    const text = this.getText(name);
    const ip = Math.min(this.caret.get(name) ?? text.length, text.length);
    const caretX = measureString(this.ctx, text.slice(0, ip), FIELD_STYLE);
    return Math.max(0, caretX - (width(rect) - 4));
  }

  /**
   * `cTextField::draw` (field.cpp:301) — a white box two pixels outside the
   * control's frame, outlined in black, with the text in 12pt black and the
   * insertion point as a grey bar when it has the focus.
   */
  private drawField(control: DialogControl): void {
    if (control.kind !== 'field') return;
    const { ctx } = this;
    const rect = this.screenRect(control);
    const outline = { left: rect.left - 2, top: rect.top - 2, right: rect.right + 2, bottom: rect.bottom + 2 };
    ctx.fillStyle = Colours.WHITE;
    ctx.fillRect(outline.left, outline.top, width(outline), height(outline));
    ctx.strokeStyle = Colours.BLACK;
    ctx.lineWidth = 1;
    ctx.strokeRect(outline.left + 0.5, outline.top + 0.5, width(outline) - 1, height(outline) - 1);
    const text = this.getText(control.name);
    const scroll = this.fieldScroll(control.name, rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, width(rect), height(rect));
    ctx.clip();
    if (text) drawString(ctx, { ...rect, left: rect.left + 2 - scroll }, text, FIELD_STYLE);
    if (this.focus === control.name && this.selectedAll.has(control.name) && text) {
      // hiliteClr, {127,127,127}, behind the selected run.
      ctx.fillStyle = 'rgb(127,127,127)';
      ctx.fillRect(rect.left + 2 - scroll, rect.top,
        measureString(ctx, text, FIELD_STYLE), height(rect));
      drawString(ctx, { ...rect, left: rect.left + 2 - scroll }, text, FIELD_STYLE);
    }
    if (this.focus === control.name) {
      const ip = Math.min(this.caret.get(control.name) ?? text.length, text.length);
      const x = Math.round(rect.left + 2 - scroll
        + measureString(ctx, text.slice(0, ip), FIELD_STYLE)) + 0.5;
      ctx.strokeStyle = 'rgb(92,92,92)';
      ctx.beginPath();
      ctx.moveTo(x, rect.top + 1);
      ctx.lineTo(x, rect.bottom - 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** `cConnector::draw` — white on a dark dialog unless it names a colour. */
  private drawLine(control: DialogControl): void {
    if (control.kind !== 'line') return;
    const rect = this.screenRect(control);
    this.ctx.strokeStyle = control.colour ? COLOURS[control.colour] ?? control.colour : Colours.WHITE;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(rect.left + 0.5, rect.top + 0.5);
    this.ctx.lineTo(rect.right + 0.5, rect.bottom + 0.5);
    this.ctx.stroke();
  }
}

/** The `def-key` names for keys that aren't a single character. */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Escape: 'esc',
  Enter: 'enter',
  Tab: 'tab',
  ' ': 'space',
};

/** What a button with no words on its face shows on the touch overlay. */
const ARROW_FACES: Partial<Record<string, string>> = {
  left: '◀', right: '▶', up: '▲', down: '▼', help: '?',
};

/** Dialog text on one line: `|` and newlines are line breaks in game text. */
function oneLine(text: string): string {
  return text.replace(/[|\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A control's name as words, for one with nothing else to go by. */
function humanise(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}
