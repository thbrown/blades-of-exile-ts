/**
 * The spell picker for a finger: translucent strips round the cast dialog
 * while touch controls are on, laid out as the movement pads are. The dialog
 * itself stays up and stays live — its caster buttons, Other Spells and the
 * rest still answer a tap — and the strips are the parts a thumb needs
 * bigger: on the left one level's spells, with ◀ ▶ to step through the
 * levels (a long press on one describes it); on the right the party, when
 * the spell is cast on one of them, and Cast under it.
 *
 * It is only a face. Every tap presses one of the dialog's own controls by
 * its C++ id (`CastDialog.pressControl` → `SpellPick.click`), the ids the
 * replay driver feeds too, and the answer goes back through the dialog host
 * as a click's would. So the choosing — who may cast, what's lit, what a
 * missing target does — is the game's, not this file's.
 */

import type { CastDialog, CastView } from '../dialogs/castDialog';

export interface TouchSpellHost {
  /** The cast dialog, when it's the one on top; null otherwise. */
  dialog(): CastDialog | null;
  /** Hand a control's answer to the dialog host (`DialogHost.answerScreen`). */
  answer(dialog: CastDialog, name: string | null): void;
}

/** How long a finger rests on a spell before it describes it rather than picks it. */
const LONG_PRESS_MS = 500;

const MIN_LEVEL = 1;
const MAX_LEVEL = 7;
/** The dialog's grid shows levels 1–4 on its first page and 5–7 on its second. */
const pageOf = (level: number): number => (level <= 4 ? 0 : 1);

export class TouchSpellPanel {
  private readonly root: HTMLElement;
  /** The view last drawn, so a redraw that changes nothing rebuilds nothing. */
  private shown = '';
  /** Which level the left strip lists; null until a dialog opens. */
  private level: number | null = null;
  private dialog: CastDialog | null = null;

  constructor(private readonly host: TouchSpellHost) {
    this.root = document.createElement('div');
    this.root.id = 'touch-spells';
    this.root.hidden = true;
    document.body.append(this.root);
  }

  sync(on: boolean): void {
    const dialog = on ? this.host.dialog() : null;
    this.root.hidden = dialog === null;
    if (dialog === null) {
      this.shown = '';
      this.level = null;
      this.dialog = null;
      return;
    }
    const view = dialog.view;
    // A fresh dialog opens on the level of the spell it has chosen; after
    // that, if the dialog's own Other Spells flips the page, follow it.
    if (dialog !== this.dialog || this.level === null) {
      this.dialog = dialog;
      this.level = view.slots.find((s) => s.spell === view.spell)?.level ?? (view.page === 0 ? 1 : 5);
    }
    if (pageOf(this.level) !== view.page) this.level = view.page === 0 ? 1 : 5;
    const key = `${this.level}|${JSON.stringify(view)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.build(dialog, view, this.level);
  }

  private press(dialog: CastDialog, id: string): void {
    this.host.answer(dialog, dialog.pressControl(id));
  }

  /** Step the left strip a level, flipping the dialog's page when it crosses 4↔5. */
  private stepLevel(dialog: CastDialog, view: CastView, by: number): void {
    const next = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, (this.level ?? 1) + by));
    if (next === this.level) return;
    this.level = next;
    if (pageOf(next) !== view.page) this.press(dialog, 'other');
    else {
      this.shown = '';
      this.sync(true);
    }
  }

  private build(dialog: CastDialog, view: CastView, level: number): void {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const button = (cls: string, text: string, onTap: () => void, disabled = false): HTMLButtonElement => {
      const b = el('button', `ts-btn ${cls}`, text);
      b.type = 'button';
      b.tabIndex = -1;
      b.disabled = disabled;
      b.addEventListener('click', onTap);
      return b;
    };

    // Left: this level's spells — the caster's own, dim where they can't
    // cast them now, as the dialog's unlit LEDs are.
    const left = el('div', 'ts-strip ts-left');
    left.append(el('div', 'ts-heading', `Level ${level}`));
    const list = el('div', 'ts-list');
    const mine = view.slots.filter((s) => s.level === level && s.known);
    if (mine.length === 0) list.append(el('div', 'ts-none', 'No spells'));
    for (const s of mine) {
      const chosen = s.spell === view.spell;
      // A tap picks it; a long press describes it, as a long press on the
      // game screen is the right button, which describes a spell in the dialog.
      let described = false;
      // Named as the dialog's grid names it, "name (cost)".
      const b = button(`ts-spell${chosen ? ' on' : ''}${s.castable ? '' : ' dim'}`, `${s.name} (${s.cost})`, () => {
        if (described) described = false;
        else this.press(dialog, `spell${s.slot + 1}`);
      });
      let timer = 0;
      b.addEventListener('pointerdown', () => {
        described = false;
        timer = window.setTimeout(() => { described = true; dialog.describeSlot(s.slot); }, LONG_PRESS_MS);
      });
      for (const end of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        b.addEventListener(end, () => window.clearTimeout(timer));
      }
      b.addEventListener('contextmenu', (ev) => ev.preventDefault());
      list.append(b);
    }
    // Bottom left, level with Cast on the right.
    const steps = el('div', 'ts-steps');
    steps.append(
      button('ts-step', '◀', () => this.stepLevel(dialog, view, -1), level <= MIN_LEVEL),
      button('ts-step', '▶', () => this.stepLevel(dialog, view, 1), level >= MAX_LEVEL),
    );
    left.append(list);

    // Right: who it's for, when the spell is cast on a party member.
    const right = el('div', 'ts-strip ts-right');
    if (view.needsTarget) {
      right.append(el('div', 'ts-heading', 'Target'));
      for (const pc of view.party) {
        if (!pc.present) continue;
        const chip = button(`ts-pc${pc.index === view.target ? ' on' : ''}${pc.alive ? '' : ' dim'}`,
          '', () => this.press(dialog, `target${pc.index + 1}`));
        chip.title = pc.name;
        chip.append(el('span', 'ts-name', `${pc.index + 1}. ${pc.name}`), el('small', '', `${pc.hp} HP`));
        right.append(chip);
      }
    }

    // Bottom right: Cast, and Cancel beside it.
    const chosen = view.slots.find((s) => s.spell === view.spell);
    const foot = el('div', 'ts-foot');
    const cancel = button('ts-cancel', '✕', () => this.press(dialog, 'cancel'));
    cancel.title = 'Cancel';
    cancel.setAttribute('aria-label', 'Cancel');
    foot.append(
      cancel,
      button('ts-cast', 'CAST', () => this.press(dialog, 'cast'), !chosen),
    );

    this.root.replaceChildren(left, right, steps, foot);
  }
}
