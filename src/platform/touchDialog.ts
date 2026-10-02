/**
 * Any dialog, for a finger: its buttons as a strip down the right, as the
 * spell picker's party strip is (`touchSpells.ts`), and a list down the
 * left when it has one to pick from (get-items' pile). The dialog stays up
 * and live between them. A text field gets a real `<input>` at the top of
 * the strip, which is what brings a phone's keyboard up — the canvas can't.
 *
 * It is only a face, as the spell strips are: what's listed is the dialog's
 * own `touchView`, and a tap is `touchPress` on the control by name, which
 * does what a click on it does.
 */

import type { TouchChoice, TouchView } from '../dialogs/dialog';

export interface TouchDialogHost {
  /** The top dialog's choices, or null when there's none (or it has its own strips). */
  view(): TouchView | null;
  press(name: string): void;
  type(field: string, text: string): void;
  /** Enter, for the field: the dialog's default button. */
  enter(): void;
}

/**
 * How long a strip that has just appeared ignores taps. The tap that opens a
 * conversation is on the pad's middle, and the talk strip's Done comes up
 * right under that thumb: a quick second tap would end the talk unread.
 */
const FRESH_MS = 400;

export class TouchDialogPanel {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private shown = '';
  private field: string | null = null;
  /** When the strips last appeared (`FRESH_MS`). */
  private shownAt = 0;

  constructor(private readonly host: TouchDialogHost) {
    this.root = document.createElement('div');
    this.root.id = 'touch-dialog';
    this.root.hidden = true;
    document.body.append(this.root);

    // One input for the panel's life, so rebuilding the strips never takes
    // the keyboard down in the middle of a word.
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'td-field';
    this.input.autocomplete = 'off';
    this.input.setAttribute('autocapitalize', 'off');
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'done';
    this.input.placeholder = 'Tap to type';
    this.input.addEventListener('input', () => {
      if (this.field !== null) this.host.type(this.field, this.input.value);
    });
    // Typed here, a key is the input's alone: the game listens on the window
    // and would type it into the canvas field a second time.
    this.input.addEventListener('keydown', (ev) => {
      // Escape still reaches the game, which cancels the dialog with it.
      if (ev.key === 'Escape') {
        this.input.blur();
        return;
      }
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.input.blur();
        this.host.enter();
      }
    });
  }

  sync(on: boolean): void {
    const view = on ? this.host.view() : null;
    if (view !== null && this.root.hidden) this.shownAt = performance.now();
    this.root.hidden = view === null;
    if (view === null) {
      this.shown = '';
      this.field = null;
      if (document.activeElement === this.input) this.input.blur();
      return;
    }
    const newField = view.field !== undefined && view.field.name !== this.field;
    this.field = view.field?.name ?? null;
    // The field's text is left out of the key: typing changes it, and the
    // strips don't need rebuilding for that.
    const key = JSON.stringify({ ...view, field: view.field?.name ?? null });
    if (view.field && document.activeElement !== this.input) this.input.value = view.field.text;
    if (key !== this.shown) {
      this.shown = key;
      this.build(view);
    }
    // A field that has just appeared takes the focus, which on Android brings
    // the keyboard straight up: the tap that opened the dialog ("Ask About…",
    // Rename) still counts as the gesture. An iPhone wants the input tapped.
    if (newField) {
      this.input.focus({ preventScroll: true });
      this.input.select();
    }
  }

  private build(view: TouchView): void {
    // A toggle (an LED, the chosen PC) rebuilds the strips, but a strip whose
    // buttons are the same ones is the same page: it keeps its scroll, so the
    // button just tapped doesn't jump away from under the finger.
    const kept = new Map<string, { names: string; top: number }>();
    for (const list of this.root.querySelectorAll<HTMLElement>('.ts-list')) {
      const side = list.dataset['side'];
      if (side) kept.set(side, { names: list.dataset['names'] ?? '', top: list.scrollTop });
    }
    const children: HTMLElement[] = [];
    const [leftSide, rightSide] = view.mirrored ? ['ts-right', 'ts-left'] : ['ts-left', 'ts-right'];
    if (view.left) children.push(this.strip(leftSide, view.leftHeading, view.left, null));
    const right = this.strip(rightSide, view.rightHeading, view.right, view.field ? this.input : null);
    if (view.rightFollowsPad) right.classList.add('td-follows-pad');
    children.push(right);
    this.root.replaceChildren(...children);
    for (const list of this.root.querySelectorAll<HTMLElement>('.ts-list')) {
      const before = kept.get(list.dataset['side'] ?? '');
      if (before && before.names === list.dataset['names']) list.scrollTop = before.top;
    }
  }

  private strip(side: string, heading: string | undefined, choices: TouchChoice[], field: HTMLElement | null): HTMLElement {
    const strip = document.createElement('div');
    strip.className = `ts-strip td-strip ${side}`;
    if (heading) {
      const h = document.createElement('div');
      h.className = 'ts-heading';
      h.textContent = heading;
      strip.append(h);
    }
    if (field) strip.append(field);
    const list = document.createElement('div');
    list.className = 'ts-list';
    list.dataset['side'] = side;
    list.dataset['names'] = choices.map((c) => c.name).join('\n');
    for (const choice of choices) {
      if (choice.section !== undefined) {
        const section = document.createElement('div');
        section.className = choice.section ? 'td-section' : 'td-section td-rule';
        section.textContent = choice.section;
        list.append(section);
      }
      list.append(this.button(choice));
    }
    strip.append(list);
    return strip;
  }

  private button(choice: TouchChoice): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = `ts-btn td-btn${choice.on ? ' on' : ''}`;
    b.disabled = choice.disabled === true;
    const label = document.createElement('span');
    label.className = 'td-label';
    label.textContent = choice.label;
    b.append(label);
    if (choice.detail) {
      const detail = document.createElement('small');
      detail.textContent = choice.detail;
      b.append(detail);
    }
    b.addEventListener('click', () => {
      if (performance.now() - this.shownAt < FRESH_MS) return;
      this.host.press(choice.name);
    });
    return b;
  }
}
