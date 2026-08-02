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
import { curWeight, itemWeight, maxWeight } from '../universe/inventory';
import type { ModalScreen } from './dialog';
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

  constructor(
    ctx: CanvasRenderingContext2D,
    store: SheetStore,
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

  // The dialog underneath does the drawing and the dispatching.

  draw(): void {
    this.dlg.draw();
  }

  onClick(x: number, y: number): string | null {
    return this.dlg.onClick(x, y);
  }

  onKey(key: string): string | null {
    return this.dlg.onKey(key);
  }
}
