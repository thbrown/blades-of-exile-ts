/**
 * The dialogxml parser — the reading half of `cDialog`'s loader
 * (dialogxml/dialogs/dialog.cpp, schema in rsrc/schemas/dialog.xsd).
 *
 * A dialog definition is a flat list of positioned controls: pictures, text,
 * buttons, LEDs, LED groups, text fields and rules. The game ships 211 of
 * these and addresses their controls by name (`me["day"].setTextToNum(…)`), so
 * the parser's job is to turn one file into a `DialogDef` whose controls can be
 * looked up the same way.
 *
 * Only the reading is here; `xmlDialog.ts` draws the result and runs it.
 */

import { attr, children, tag } from '../fileio/xml';
import { UiRect } from '../render/layout';
import { customSheetSize } from '../render/customPics';

/** eBtnType (button.hpp:19), in the order `basic_buttons` uses. */
export type ButtonType =
  | 'small' | 'regular' | 'large' | 'help' | 'left' | 'right' | 'up' | 'down'
  | 'tiny' | 'done' | 'tall' | 'trait' | 'push';

/** ePicType (pictypes.hpp), narrowed to the kinds the player's dialogs use. */
export type PictType =
  | 'blank' | 'ter' | 'teranim' | 'monst' | 'dlog' | 'talk' | 'scen' | 'item'
  | 'pc' | 'field' | 'boom' | 'missile' | 'full' | 'custom-full' | 'map' | 'status' | 'btn';

export type FieldType = 'int' | 'uint' | 'real' | 'text';
export type LedState = 'red' | 'green' | 'off';

/** The `font`/`size`/`colour` attribute group, shared by text, LEDs and fields. */
export interface FontSpec {
  font: 'dungeon' | 'plain' | 'bold' | 'maidenword';
  /** A point size; the named sizes resolve to 10 (small), 12 (large), 18 (title). */
  size: number;
  colour?: string;
}

interface Base {
  name: string;
  rect: UiRect;
  /** The rect as the file wrote it, before sizing and relative placement. */
  fileRect: UiRect;
  /**
   * The positioning attributes, kept as read. `anchor` names the control this
   * one is placed against; `relative` is the two-axis mode list.
   */
  anchor?: string;
  relAnchor?: 'next' | 'prev';
  relative: string[];
  /** `def-key`, lowercased; 'none' is dropped. */
  defKey?: string;
}

export interface TextControl extends Base {
  kind: 'text';
  /** The label, with `<br/>` turned into newlines. */
  text: string;
  framed: boolean;
  font: FontSpec;
  align: 'left' | 'right';
  underline: boolean;
  ellipsis: boolean;
  /**
   * Written without a height, or without a width: `cTextMsg::recalcRect`
   * (message.cpp:139) sizes whichever is missing to the text — the height to
   * the wrapped lines plus 8, the width to the longest line plus 16. That
   * needs the fonts, so it happens in `measureDialog`, the first time the
   * dialog opens.
   */
  autoHeight: boolean;
  autoWidth: boolean;
}

export interface ButtonControl extends Base {
  kind: 'button';
  type: ButtonType;
  label: string;
  wrap: boolean;
  textSize?: number;
}

export interface PictControl extends Base {
  kind: 'pict';
  type: PictType;
  num: number;
  custom: boolean;
  framed: boolean;
  filled: boolean;
  size?: 'small' | 'wide' | 'tall' | 'large';
  /**
   * `cPict`'s frame style: `framed='false'` is none, `outline` names one, and
   * the default is solid (pict.cpp:144).
   */
  outline: 'none' | 'solid' | 'inset' | 'outset' | 'double';
  /** `color` — a pict's *fill* colour (`fillClr`, black by default). */
  colour?: string;
}

export interface LedControl extends Base {
  kind: 'led';
  label: string;
  state: LedState;
  font: FontSpec;
  labelPos: 'left' | 'right';
}

export interface FieldControl extends Base {
  kind: 'field';
  type: FieldType;
  text: string;
  maxChars?: number;
  tabOrder?: number;
}

export interface LineControl extends Base {
  kind: 'line';
  /** Unset on a dark dialog means white (`cConnector::validatePostParse`). */
  colour?: string;
}

/**
 * An LED group (`<group>`): a set of LEDs of which exactly one is lit, which is
 * how the dialogs do radio buttons. The members are also registered by their
 * own names, as the C++ does.
 */
export interface GroupControl extends Base {
  kind: 'group';
  leds: LedControl[];
}

/**
 * `cScrollPane` — a window onto controls taller than it, with a scrollbar
 * down its right edge. Its children's coordinates are the dialog's own, as
 * the file writes them; the pane shows the slice of them it is scrolled to.
 * OBoE's About box scrolled its credits in one. The player's dialogs no
 * longer use it (about-boe.xml is the 1997 box again), but OBoE-format
 * dialogs may.
 */
export interface PaneControl extends Base {
  kind: 'pane';
  children: DialogControl[];
}

export type DialogControl =
  | TextControl | ButtonControl | PictControl | LedControl
  | FieldControl | LineControl | GroupControl | PaneControl;

export interface DialogDef {
  /** The button Enter presses, and the one Escape does. */
  defBtn?: string;
  escBtn?: string;
  controls: DialogControl[];
  /** Every control by name, groups' members included. */
  byName: Map<string, DialogControl>;
  /** Whether `measureDialog` has sized the auto-height texts yet. */
  measured?: boolean;
}

/** The three named text sizes (dialog.xsd's `size` union). */
function parseSize(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === 'small') return 10;
  if (value === 'large') return 12;
  if (value === 'title') return 18;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseFont(el: Element): FontSpec {
  const font = (attr(el, 'font') ?? 'bold') as FontSpec['font'];
  return {
    font,
    size: parseSize(attr(el, 'size'), 10),
    colour: attr(el, 'colour') ?? attr(el, 'color'),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function parseRect(el: Element): UiRect {
  // The schema marks top/left required, but a container (`<group>`) carries
  // none — its frame is grown from its members. Absent reads as 0, which is
  // what the C++ leaves the frame at.
  const top = Number(attr(el, 'top') ?? 0);
  const left = Number(attr(el, 'left') ?? 0);
  const w = attr(el, 'width');
  const h = attr(el, 'height');
  return {
    top,
    left,
    bottom: top + (w === undefined && h === undefined ? 0 : Number(h ?? 0)),
    right: left + Number(w ?? 0),
  };
}

function parseBase(el: Element): Base {
  const key = attr(el, 'def-key');
  const rect = parseRect(el);
  return {
    name: attr(el, 'name') ?? '',
    rect,
    fileRect: { ...rect },
    anchor: attr(el, 'anchor'),
    relAnchor: attr(el, 'rel-anchor') as Base['relAnchor'],
    relative: (attr(el, 'relative') ?? 'abs').split(/\s+/).filter((s) => s.length > 0),
    defKey: key !== undefined && key !== 'none' ? key.toLowerCase() : undefined,
  };
}

/**
 * A `<text>`/`<button>` body: text nodes with `<br/>` breaks between them.
 * `<key ref=…/>` inlines another control's shortcut; a bare `<key/>` means the
 * control's own, which is only known once the code has attached it, so it is
 * left as a placeholder for the drawing pass to fill in.
 */

/** cControl::KEY_PLACEHOLDER (control.hpp:123) — stands in for the shortcut. */
export const KEY_PLACEHOLDER = '\u0007';

function readLabel(el: Element): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]!;
    // TinyXML condenses whitespace (`SetCondenseWhiteSpace`, on by default),
    // so a line break in the file is only a space: `<br/>` is the one thing
    // that breaks a line. Keeping the file's own newlines doubled every
    // `<br/>` that ends a source line.
    if (node.nodeType === 3) out += (node.nodeValue ?? '').replace(/\s+/g, ' ');
    else if (node.nodeType === 1) {
      const child = node as Element;
      if (tag(child) === 'br') out += '\n';
      // `<key/>` stands for the control's own shortcut, filled in at draw
      // time — `cControl::KEY_PLACEHOLDER` (control.hpp:123) is a literal BEL
      // in the label for exactly this, and the same character is used here.
      else if (tag(child) === 'key') out += attr(child, 'ref') ?? KEY_PLACEHOLDER;
    }
  }
  // Spaces at either end of a line go (the markup is indented), but not the
  // breaks themselves: a label that opens with `<br/>` starts on its second
  // line, which is how OBoE's credit columns (about-boe.xml, before it was
  // the 1997 box again) lined up.
  return out.split('\n').map((line) => line.trim()).join('\n');
}

function parseLed(el: Element): LedControl {
  return {
    ...parseBase(el),
    kind: 'led',
    label: readLabel(el),
    state: (attr(el, 'state') ?? 'off') as LedState,
    font: parseFont(el),
    labelPos: (attr(el, 'label-pos') ?? 'right') as 'left' | 'right',
  };
}

function parseControl(el: Element): DialogControl | null {
  switch (tag(el)) {
    case 'text':
      return {
        ...parseBase(el),
        kind: 'text',
        text: readLabel(el),
        framed: parseBool(attr(el, 'framed'), false),
        font: parseFont(el),
        align: (attr(el, 'align') ?? 'left') as 'left' | 'right',
        underline: parseBool(attr(el, 'underline'), false),
        ellipsis: parseBool(attr(el, 'ellipsis'), false),
        autoHeight: attr(el, 'height') === undefined,
        autoWidth: attr(el, 'width') === undefined,
      };
    case 'button': {
      const textSize = attr(el, 'text-size');
      return {
        ...parseBase(el),
        kind: 'button',
        type: (attr(el, 'type') ?? 'regular') as ButtonType,
        label: readLabel(el),
        wrap: parseBool(attr(el, 'wrap'), false),
        textSize: textSize === undefined ? undefined : Number(textSize),
      };
    }
    case 'pict':
      return {
        ...parseBase(el),
        kind: 'pict',
        type: (attr(el, 'type') ?? 'blank') as PictType,
        num: Number(attr(el, 'num') ?? 0),
        custom: parseBool(attr(el, 'custom'), false),
        // A pict is framed and filled by default, unlike everything else.
        framed: parseBool(attr(el, 'framed'), true),
        filled: parseBool(attr(el, 'filled'), true),
        size: attr(el, 'size') as PictControl['size'],
        outline: (attr(el, 'outline') as PictControl['outline'] | undefined)
          ?? (parseBool(attr(el, 'framed'), true) ? 'solid' : 'none'),
        colour: attr(el, 'colour') ?? attr(el, 'color'),
      };
    case 'led':
      return parseLed(el);
    case 'group': {
      const leds = children(el).filter((c) => tag(c) === 'led').map(parseLed);
      return { ...parseBase(el), kind: 'group', leds };
    }
    case 'field':
      return {
        ...parseBase(el),
        kind: 'field',
        type: (attr(el, 'type') ?? 'text') as FieldType,
        text: readLabel(el),
        maxChars: attr(el, 'max-chars') === undefined
          ? undefined : Number(attr(el, 'max-chars')),
        tabOrder: attr(el, 'tab-order') === undefined
          ? undefined : Number(attr(el, 'tab-order')),
      };
    case 'line':
      return { ...parseBase(el), kind: 'line', colour: attr(el, 'colour') ?? attr(el, 'color') };
    case 'pane':
      return {
        ...parseBase(el),
        kind: 'pane',
        children: children(el).map(parseControl).filter((c): c is DialogControl => c !== null),
      };
    default:
      // stack/page/tilemap/mapgroup belong to the scenario editor's dialogs,
      // which this port doesn't run.
      return null;
  }
}

/**
 * Turn one parsed `<dialog>` element into a definition. Positions are resolved
 * here, so every control comes out with an absolute rect.
 */
export function readDialogDef(root: Element): DialogDef {
  const controls: DialogControl[] = [];
  for (const el of children(root)) {
    const control = parseControl(el);
    if (control) controls.push(control);
  }
  layOut(controls, null);
  const byName = new Map<string, DialogControl>();
  for (const control of controls) {
    if (control.name) byName.set(control.name, control);
    if (control.kind === 'group') {
      for (const led of control.leds) if (led.name) byName.set(led.name, led);
    }
  }
  return {
    defBtn: attr(root, 'defbtn'),
    escBtn: attr(root, 'escbtn'),
    controls,
    byName,
  };
}

/** Every control, groups' LEDs and panes' children included. */
function everyControl(controls: DialogControl[]): DialogControl[] {
  return controls.flatMap((c) => [
    c,
    ...(c.kind === 'group' ? c.leds : []),
    ...(c.kind === 'pane' ? everyControl(c.children) : []),
  ]);
}

/**
 * Size every control and place the relative ones, starting from the rects as
 * written. `textHeight` sizes the auto-height texts; with none (at parse time,
 * where there are no fonts to measure with) they keep the height they were
 * written with, which is none.
 */
function layOut(
  controls: DialogControl[], textSize: ((c: TextControl) => { w: number; h: number }) | null,
): void {
  for (const control of everyControl(controls)) {
    control.rect = { ...control.fileRect };
    setNaturalSize(control);
    if (textSize !== null && control.kind === 'text' && (control.autoHeight || control.autoWidth)) {
      const { w, h } = textSize(control);
      const { top, left } = control.rect;
      control.rect = {
        top, left,
        bottom: control.autoHeight ? top + h : control.rect.bottom,
        right: control.autoWidth ? left + w : control.rect.right,
      };
    }
  }
  resolvePositions(controls);
  for (const c of controls) if (c.kind === 'pane') resolvePositions(c.children);
}

/**
 * The second, measured layout pass: `cDialog::recalcRect` sizing each text
 * that was written without a height or width (OBoE's About paragraphs and
 * links), then placing again everything positioned after it. Done once per definition,
 * since the result doesn't change.
 */
export function measureDialog(def: DialogDef, textSize: (c: TextControl) => { w: number; h: number }): void {
  if (def.measured) return;
  def.measured = true;
  layOut(def.controls, textSize);
}

/** Each button type's artwork size (`cButton::btnRects`, button.cpp:247). */
export const BUTTON_SIZE: Record<ButtonType, { w: number; h: number }> = {
  small: { w: 23, h: 23 }, regular: { w: 63, h: 23 }, done: { w: 63, h: 23 },
  left: { w: 63, h: 23 }, right: { w: 63, h: 23 }, up: { w: 63, h: 23 }, down: { w: 63, h: 23 },
  large: { w: 102, h: 23 }, help: { w: 16, h: 13 }, tiny: { w: 14, h: 10 },
  tall: { w: 63, h: 40 }, trait: { w: 63, h: 40 }, push: { w: 30, h: 30 },
};

/**
 * `cPict::recalcRect` (pict.cpp:551) — a picture is the size of its kind,
 * whatever the file says. `null` leaves the rect as written: a blank fill and
 * a full-size picture take the file's size.
 */
export function pictNaturalSize(
  type: PictType, num: number, large: boolean,
): { w: number; h: number } | null {
  switch (type) {
    case 'ter': case 'teranim': case 'monst': case 'item': case 'pc': case 'field': case 'boom':
      return { w: 28, h: 36 };
    case 'dlog': return large ? { w: 72, h: 72 } : { w: 36, h: 36 };
    case 'scen': return large ? { w: 64, h: 64 } : { w: 32, h: 32 };
    case 'talk': return { w: 32, h: 32 };
    case 'missile': return { w: 18, h: 18 };
    case 'map': return { w: 24, h: 24 };
    // PIC_CUSTOM_FULL: the scenario's `sheet<num>`, whole.
    case 'custom-full': return customSheetSize(num);
    case 'status': return { w: 12, h: 12 };
    case 'btn':
      if (num <= 1) return { w: 12, h: 12 };
      if (num <= 5) return { w: 14, h: 12 };
      if (num <= 9) return { w: 30, h: 12 };
      return { w: 35, h: 15 };
    default: return null;
  }
}

/**
 * The sizes the C++ settles when it *parses* a control — `setBtnType` writes
 * the button art's size into the frame, `cPict::setPict` the picture's, and an
 * LED is at least its lamp. Relative positioning measures from these, so they
 * have to be in place before `resolvePositions`: measured as written, an
 * `<pict>` with only a `top` and `left` is a zero-height anchor, and every row
 * of edit-party.xml hung off the one above it collapsed onto it.
 *
 * A labelled button (regular, large, done) may be stretched wider or taller
 * than its art; every other kind is exactly its art.
 */
function setNaturalSize(control: DialogControl): void {
  const { rect } = control;
  let w = rect.right - rect.left;
  let h = rect.bottom - rect.top;
  if (control.kind === 'button') {
    const art = BUTTON_SIZE[control.type];
    const stretch = control.type === 'regular' || control.type === 'large' || control.type === 'done';
    w = stretch ? Math.max(w, art.w) : art.w;
    h = stretch ? Math.max(h, art.h) : art.h;
  } else if (control.kind === 'pict') {
    const size = pictNaturalSize(control.type, control.num, control.size === 'large');
    if (size) ({ w, h } = size);
  } else if (control.kind === 'led') {
    // `cLed::getPreferredSize` (led.cpp:171): the lamp, four pixels, and the
    // label at 10pt. There is no canvas to measure with at parse time, so the
    // label is estimated at 6.5px a character, which is what this port's LED
    // font comes to — it only has to be right enough for a control anchored
    // `pos` on this one to clear it.
    const label = control.label.trim();
    w = Math.max(w, label ? 18 + Math.round(label.length * 6.5) : 14);
    h = Math.max(h, 10);
  } else {
    return;
  }
  control.rect = { top: rect.top, left: rect.left, bottom: rect.top + h, right: rect.left + w };
}

/**
 * Relative positioning (`anchor` / `rel-anchor` / `relative`), a port of
 * `cControl::relocateRelative` (control.cpp:78). A control with an anchor is
 * placed against another control's frame, and the coordinates in the file are
 * an *offset* from the chosen edge rather than a position:
 *
 * - `pos` measures right from the anchor's right edge (down from its bottom),
 * - `neg` measures **left from its left edge** (up from its top),
 * - `pos-in` measures right from its left edge (down from its top),
 * - `neg-in` measures left from its right edge (up from its bottom),
 * - `abs` keeps the coordinate as written.
 *
 * The first word is the horizontal mode and the second the vertical; one word
 * applies to both.
 *
 * *Gotcha*: the two "neg" modes place the control's **top-left corner** at the
 * computed point — the C++ negates the offset and hands it to `relocate`,
 * which never accounts for the control's own width or height. So a `neg`
 * control extends back *over* its anchor rather than sitting beside it. Kept.
 */
function resolvePositions(controls: DialogControl[]): void {
  const byName = new Map<string, DialogControl>();
  for (const c of controls) {
    if (c.name) byName.set(c.name, c);
    if (c.kind === 'group') for (const led of c.leds) if (led.name) byName.set(led.name, led);
  }
  // A group's LEDs are placed like any other control, in document order —
  // this used to walk the top level only, so an LED anchored on a heading
  // (preferences.xml's game speeds) stayed at its raw offset from (0, 0).
  const flat: DialogControl[] = [];
  for (const c of controls) {
    flat.push(c);
    if (c.kind === 'group') flat.push(...c.leds);
  }
  flat.forEach((control, i) => {
    if (!control.anchor && !control.relAnchor) return;
    const anchor = control.relAnchor === 'prev'
      ? flat[i - 1]
      : control.relAnchor === 'next'
        ? flat[i + 1]
        : byName.get(control.anchor ?? '');
    if (!anchor) return;
    const [hMode = 'abs', vMode = hMode] = control.relative;
    const w = control.rect.right - control.rect.left;
    const h = control.rect.bottom - control.rect.top;
    let { left, top } = control.rect;
    switch (hMode) {
      case 'pos': left = anchor.rect.right + left; break;
      case 'neg': left = anchor.rect.left - left; break;
      case 'pos-in': left = anchor.rect.left + left; break;
      case 'neg-in': left = anchor.rect.right - left; break;
      default: break;
    }
    switch (vMode) {
      case 'pos': top = anchor.rect.bottom + top; break;
      case 'neg': top = anchor.rect.top - top; break;
      case 'pos-in': top = anchor.rect.top + top; break;
      case 'neg-in': top = anchor.rect.bottom - top; break;
      default: break;
    }
    control.rect = { top, left, bottom: top + h, right: left + w };
  });
}
