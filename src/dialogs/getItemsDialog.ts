/**
 * The pick-up-items screen — `show_get_items` and `put_item_graphics`
 * (boe.items.cpp:559 and :363), running on the real `get-items.xml`.
 *
 * Unlike a plain pick-list this one **stays open**: the six PC buttons choose
 * who is doing the picking up, each item click hands that item over and drops
 * it out of the list, and Done closes. Eight rows show at a time, with up/down
 * arrows for a longer pile.
 *
 * The dialog was a hand-drawn approximation until the dialogxml toolkit landed;
 * the layout, the fonts and the colours are the definition's now, which is what
 * brings back the detail line under each name ("Not identified.",
 * "Damage: 1-6.") and the "Weight: n" label beside it.
 */

import { Item, ItemType, interestingString } from '../data/item';
import { GetItemsPick, ITEMS_IN_WINDOW, NOBODY, ROW_KEYS } from '../game/getItems';
import type { GameSession } from '../game/session';
import { SheetStore } from '../render/sheets';
import type { UiRect } from '../render/layout';
import { curWeight, itemWeight, maxWeight } from '../universe/inventory';
import type { ModalScreen, TouchChoice, TouchView } from './dialog';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

const ROWS = ITEMS_IN_WINDOW;

/**
 * The screen's *state* is `GetItemsPick`, shared with the replay driver; this
 * class is the drawing and the hit-testing over the top of it. Every control
 * goes through `pick.click(id)` with the C++'s own control name, which is the
 * same string a recording carries.
 */
export class GetItemsDialog implements ModalScreen {
  private dlg: XmlDialog;
  private pick: GetItemsPick;
  /**
   * `steal-item`, while it is up. The C++ raises it as a `cChoiceDlog` with
   * the get-items screen as its parent, so it is a modal *inside* a modal —
   * and `DialogHost` only holds one at a time. It lives here instead: while it
   * exists it draws on top and takes every click, which is what a nested modal
   * does anyway.
   */
  private steal: XmlDialog | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    private session: GameSession,
    items: Item[],
    title: string,
  ) {
    this.pick = new GetItemsPick(session, items);
    this.dlg = new XmlDialog(ctx, store, getDialogDef('get-items'));
    this.dlg.setText('title', title);

    for (const id of ['up', 'down', 'pc1', 'pc2', 'pc3', 'pc4', 'pc5', 'pc6']) {
      this.dlg.attachHandler(id, () => {
        this.pick.click(id);
        this.refresh();
        return 'stay';
      });
    }
    for (let i = 0; i < ROWS; i++) {
      const name = `item${i + 1}-key`;
      this.dlg.attachKey(name, ROW_KEYS[i]!);
      this.dlg.attachHandler(name, () => {
        this.pick.click(name);
        this.refresh();
        return 'stay';
      });
    }
    this.refresh();
  }

  /** Whether the player answered "steal" at any point — the screen's result. */
  get stole(): boolean {
    return this.pick.stole;
  }

  /** Put `steal-item` up or take it down to match the pick's own state. */
  private syncSteal(): void {
    if (this.pick.pendingSteal === null) { this.steal = null; return; }
    if (this.steal) return;
    this.steal = new XmlDialog(this.ctx, this.store, getDialogDef('steal-item'));
  }

  /** Answer the nested prompt, then fall back to the screen underneath. */
  private answerSteal(name: string): void {
    this.pick.click(name);
    this.steal = null;
    this.refresh();
  }

  /** The pile still on the floor. `verify-screen.mjs` reads this. */
  get items(): Item[] {
    return this.pick.items;
  }

  /** `current_getting_pc` — who is picking things up. */
  get who(): number {
    return this.pick.who;
  }

  /** `put_item_graphics` — refill every control from the current state. */
  private refresh(): void {
    this.syncSteal();
    const { univ } = this.session;
    const dlg = this.dlg;
    const pcs = univ.party.pcs;
    const { items } = this.pick;

    for (let i = 0; i < 6; i++) {
      const pc = pcs[i];
      const id = `pc${i + 1}`;
      const usable = this.pick.usable(i);
      if (usable) {
        dlg.show(id);
        dlg.show(`${id}-g`);
        if (pc) dlg.setPictType(`${id}-g`, 'pc', pc.whichGraphic);
      } else {
        dlg.hide(id);
        dlg.hide(`${id}-g`);
      }
      // The current PC is marked with an asterisk beside their button.
      dlg.setLabel(id, this.pick.who === i ? '*   ' : '    ', 'left', 7, true);
    }

    // The arrows only show when there is somewhere to go.
    if (this.pick.first === 0) dlg.hide('up'); else dlg.show('up');
    if (items.length <= ROWS || this.pick.first > items.length - (ROWS - 1))
      dlg.hide('down');
    else dlg.show('down');

    for (let i = 0; i < ROWS; i++) {
      const id = `item${i + 1}`;
      const item = items[i + this.pick.first];
      if (item && item.variety !== ItemType.NO_ITEM) {
        dlg.show(`${id}-g`);
        dlg.setPictType(`${id}-g`, 'item', item.graphicNum);
        dlg.setText(`${id}-name`, item.ident ? item.fullName : item.name);
        dlg.setText(`${id}-detail`, interestingString(item));
        dlg.setText(`${id}-weight`, `Weight: ${itemWeight(item)}`);
        dlg.setText(`${id}-key`, ROW_KEYS[i]!);
      } else {
        dlg.hide(`${id}-g`);
        dlg.setText(`${id}-name`, '');
        dlg.setText(`${id}-detail`, '');
        dlg.setText(`${id}-weight`, '');
        dlg.setText(`${id}-key`, '');
      }
    }

    // A refusal takes the prompt over until the next click; otherwise it is
    // the carrier's weight.
    if (this.pick.prompt !== '') dlg.setText('prompt', this.pick.prompt);
    else if (this.pick.who < NOBODY) {
      const who = pcs[this.pick.who]!;
      dlg.setText('prompt',
        `${who.name} is carrying ${curWeight(who)} out of ${maxWeight(who)}.`);
    }
  }

  /**
   * For a finger: the whole pile down the left, not just the eight rows on
   * show, and the party down the right. Tapping an item further down pages
   * the screen to it first, with the dialog's own arrows, then takes it — so
   * the pick sees the same clicks a mouse would have made.
   */
  touchView(): TouchView {
    if (this.steal) return this.steal.touchView();
    const pcs = this.session.univ.party.pcs;
    const right: TouchChoice[] = [];
    for (let i = 0; i < 6; i++) {
      const pc = pcs[i];
      if (!pc || !this.pick.usable(i)) continue;
      right.push({
        name: `pc${i + 1}`, label: `${i + 1}. ${pc.name}`,
        detail: `${curWeight(pc)} / ${maxWeight(pc)}`, on: this.pick.who === i,
      });
    }
    right.push({ name: 'done', label: 'Done' });
    const left = this.pick.items.map((item, i): TouchChoice => ({
      name: `take:${i}`,
      label: item.ident ? item.fullName : item.name,
      detail: [interestingString(item), `Weight: ${itemWeight(item)}`].filter(Boolean).join('  '),
    }));
    return { left, leftHeading: 'Take', right, rightHeading: 'Who picks up' };
  }

  touchPress(name: string): string | null {
    if (this.steal) {
      const answer = this.steal.touchPress(name);
      if (answer !== null) this.answerSteal(answer);
      return null;
    }
    const take = /^take:(\d+)$/.exec(name);
    if (!take) return this.dlg.touchPress(name);
    const index = Number(take[1]);
    if (index >= this.pick.items.length) return null;
    // Page to it as the arrows do, a page at a time.
    for (let guard = 0; guard < 64 && index < this.pick.first; guard++) this.pick.click('up');
    for (let guard = 0; guard < 64 && index >= this.pick.first + ROWS; guard++) this.pick.click('down');
    const row = index - this.pick.first;
    if (row < 0 || row >= ROWS) return null;
    const answer = this.dlg.touchPress(`item${row + 1}-key`);
    this.refresh();
    return answer;
  }

  // The dialog underneath does the drawing and the dispatching.

  draw(): void {
    this.dlg.draw();
    this.steal?.draw();
  }

  bounds(): UiRect { return this.dlg.bounds(); }

  /** `steal-item` is a window of its own, centred when it opens, so it stays put. */
  moveBy(dx: number, dy: number): void { this.dlg.moveBy(dx, dy); }

  onClick(x: number, y: number): string | null {
    if (this.steal) {
      // Every button on `steal-item` closes it, so its own name comes straight
      // back; a click that misses is swallowed, as a modal's is.
      const name = this.steal.onClick(x, y);
      if (name !== null) this.answerSteal(name);
      return null;
    }
    return this.dlg.onClick(x, y);
  }

  onKey(key: string): string | null {
    if (this.steal) {
      const name = this.steal.onKey(key);
      if (name !== null) this.answerSteal(name);
      return null;
    }
    return this.dlg.onKey(key);
  }
}
