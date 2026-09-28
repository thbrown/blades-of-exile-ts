/**
 * The spell picker for a finger: a panel over the cast dialog while touch
 * controls are on. The canvas dialog is 605×430 of small LEDs and 23px
 * buttons, which a phone shrinks to about two-thirds.
 *
 * It is only a face. Every tap presses one of the dialog's own controls by
 * its C++ id (`CastDialog.pressControl` → `SpellPick.click`), the ids the
 * replay driver feeds too, and the answer goes back through the dialog host
 * as a click's would. So the choosing — who may cast, what's lit, what a
 * missing target does — is the game's, not this file's.
 */

import type { CastDialog, CastSlot, CastView } from '../dialogs/castDialog';
import { NO_TARGET } from '../game/spellPick';

export interface TouchSpellHost {
  /** The cast dialog, when it's the one on top; null otherwise. */
  dialog(): CastDialog | null;
  /** Hand a control's answer to the dialog host (`DialogHost.answerScreen`). */
  answer(dialog: CastDialog, name: string | null): void;
}

const LEVEL_PAGES: readonly (readonly number[])[] = [[1, 2, 3, 4], [5, 6, 7]];

export class TouchSpellPanel {
  private readonly root: HTMLElement;
  /** The view last drawn, so a redraw that changes nothing rebuilds nothing. */
  private shown = '';

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
      return;
    }
    const view = dialog.view;
    const key = JSON.stringify(view);
    if (key === this.shown) return;
    this.shown = key;
    this.build(dialog, view);
  }

  private press(dialog: CastDialog, id: string): void {
    this.host.answer(dialog, dialog.pressControl(id));
  }

  private build(dialog: CastDialog, view: CastView): void {
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

    const head = el('div', 'ts-head');
    head.append(el('strong', 'ts-title', view.priest ? 'Priest Spells' : 'Mage Spells'));
    // The two pages of the grid, levels 1–4 and 5–7: the dialog's Other Spells.
    const tabs = el('div', 'ts-tabs');
    LEVEL_PAGES.forEach((levels, page) => {
      const label = `Levels ${levels[0]}–${levels[levels.length - 1]}`;
      const tab = button(page === view.page ? 'ts-tab on' : 'ts-tab', label, () => {
        if (page !== view.page) this.press(dialog, 'other');
      });
      tabs.append(tab);
    });
    head.append(tabs, el('span', 'ts-feedback', view.feedback));

    // Who casts. In combat it's the active PC, and the dialog's buttons are inert.
    const casters = el('div', 'ts-row');
    casters.append(el('span', 'ts-label', 'Caster'));
    for (const pc of view.party) {
      if (!pc.present) continue;
      if (!view.canChooseCaster && pc.index !== view.caster) continue;
      const chip = button(pc.index === view.caster ? 'ts-chip on' : 'ts-chip',
        `${pc.index + 1}. ${pc.name}`, () => this.press(dialog, `caster${pc.index + 1}`),
        !view.canChooseCaster || !pc.canCast);
      chip.append(el('small', '', ` ${pc.sp} SP`));
      casters.append(chip);
    }

    // Who it's for, when the spell is cast on a party member.
    const targets = el('div', 'ts-row');
    if (view.needsTarget) {
      targets.append(el('span', 'ts-label', 'Target'));
      for (const pc of view.party) {
        if (!pc.present) continue;
        const chip = button(pc.index === view.target ? 'ts-chip on' : 'ts-chip',
          `${pc.index + 1}. ${pc.name}`, () => this.press(dialog, `target${pc.index + 1}`));
        chip.append(el('small', '', ` ${pc.hp} HP`));
        targets.append(chip);
      }
    }

    // The grid: a column a level, the caster's own spells only; the ones they
    // can't cast now are there but dim, as the dialog's unlit LEDs are.
    const grid = el('div', 'ts-grid');
    const levels = LEVEL_PAGES[view.page] ?? [];
    for (const level of levels) {
      const col = el('div', 'ts-col');
      col.append(el('div', 'ts-level', `Level ${level}`));
      const mine = view.slots.filter((s: CastSlot) => s.level === level && s.known);
      if (mine.length === 0) col.append(el('div', 'ts-none', '—'));
      for (const s of mine) {
        const chosen = s.spell === view.spell;
        const b = button(`ts-spell${chosen ? ' on' : ''}${s.castable ? '' : ' dim'}`, s.name, () => {
          // A second tap on the chosen spell casts it, once it has what it needs.
          if (chosen && s.castable && (!view.needsTarget || view.target !== NO_TARGET)) this.press(dialog, 'cast');
          else this.press(dialog, `spell${s.slot + 1}`);
        });
        col.append(b);
      }
      grid.append(col);
    }

    const chosen = view.slots.find((s) => s.spell === view.spell);
    const foot = el('div', 'ts-foot');
    foot.append(
      button('ts-info', 'Describe', () => { if (chosen) dialog.describeSlot(chosen.slot); }, !chosen),
      el('span', 'ts-spacer'),
      button('ts-cancel', 'Cancel', () => this.press(dialog, 'cancel')),
      button('ts-cast', chosen ? `Cast ${chosen.name}` : 'Cast', () => this.press(dialog, 'cast'), !chosen),
    );

    const panel = el('div', 'ts-panel');
    panel.append(head, casters);
    if (view.needsTarget) panel.append(targets);
    panel.append(grid, foot);
    this.root.replaceChildren(panel);
  }
}
