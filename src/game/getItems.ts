/**
 * The pick-up-items screen with no screen attached — `show_get_items`
 * (boe.items.cpp:559) as a state machine.
 *
 * Same arrangement as `spellPick.ts`, and for the same reason: the C++'s modal
 * `cDialog::run` takes clicks by **control name**, and a replay records those
 * names. The driver has to be able to answer `item1-key` / `pc2` / `done`
 * without a canvas, and the live dialog has to answer them the same way, so the
 * rules live here and `dialogs/getItemsDialog.ts` is left with the drawing.
 * Having one implementation on both sides of that seam is the whole point — a
 * divergence between what the player sees and what a recording replays is
 * exactly the class of bug M8 exists to find.
 *
 * The screen **stays open**: the six PC buttons choose who is doing the picking
 * up, each item click hands that item over and drops it out of the list, and
 * Done closes.
 */

import { Item, ItemType } from '../data/item';
import { hasSpace } from './alchemy';
import { isCombat } from './modes';
import { MainStatus } from '../universe/skills';
import type { GameSession } from './session';

/** ITEMS_IN_WINDOW — eight rows show at a time. */
export const ITEMS_IN_WINDOW = 8;

/** The eight row shortcuts, as the dialog's own help text promises. */
export const ROW_KEYS = 'abcdefgh';

/** `current_getting_pc` is 6 when nobody in the party can pick anything up. */
export const NOBODY = 6;

export class GetItemsPick {
  /** `current_getting_pc` — who picks things up. */
  who: number;

  /** The scroll position: which item is drawn on the top row. */
  first = 0;

  /**
   * What the `prompt` field says. Normally the carrier's weight; a refusal
   * ("It's too heavy to carry.") replaces it until the next refresh.
   */
  prompt = '';

  constructor(
    private session: GameSession,
    /** The pile, which shrinks as things are taken. */
    readonly items: Item[],
  ) {
    this.who = session.univ.curPc;
    this.refresh();
  }

  /** Can this PC be handed something — alive, present, and with a free slot? */
  usable(index: number): boolean {
    const pc = this.session.univ.party.pcs[index];
    if (pc === undefined || pc.mainStatus !== MainStatus.ALIVE) return false;
    if (hasSpace(pc) < 0) return false;
    // In combat only the acting PC can take things: the rest are elsewhere on
    // the battlefield.
    return !isCombat(this.session.mode) || this.session.univ.curPc === index;
  }

  /**
   * `put_item_graphics`'s bookkeeping half — settle who is carrying and what
   * the prompt says. A PC who has died or filled their pack stops being the
   * one picking up, and the first PC who *can* takes over.
   */
  refresh(): void {
    if (this.who < NOBODY && !this.usable(this.who)) this.who = NOBODY;
    if (this.who === NOBODY) {
      for (let i = 0; i < 6; i++) {
        if (this.usable(i)) { this.who = i; break; }
      }
    }
    this.prompt = '';
  }

  /**
   * A click on a control, by the C++'s own name for it. Returns whether the
   * screen stays up — `done` is the only thing that closes it.
   */
  click(id: string): 'stay' | 'done' {
    if (id === 'done') return 'done';
    if (id === 'up') {
      if (this.first > 0) this.first -= ITEMS_IN_WINDOW;
      this.refresh();
      return 'stay';
    }
    if (id === 'down') {
      if (this.first + ITEMS_IN_WINDOW < this.items.length) this.first += ITEMS_IN_WINDOW;
      this.refresh();
      return 'stay';
    }
    const pc = /^pc([1-6])$/.exec(id);
    if (pc) {
      // The C++ hides a button it can't use, so a click on one cannot happen;
      // the guard is here because a *recording* can still name it, and quietly
      // handing the pile to a dead PC would be worse than ignoring it.
      const which = Number(pc[1]) - 1;
      if (this.usable(which)) this.who = which;
      this.refresh();
      return 'stay';
    }
    const row = /^item([1-8])-key$/.exec(id);
    if (row) {
      this.take(this.first + Number(row[1]) - 1);
      return 'stay';
    }
    // The pictures and the labels beside each row are inert, as they are in the
    // definition — only the lettered button takes the item.
    return 'stay';
  }

  /** Hand item `index` to the current PC and drop it out of the list. */
  take(index: number): void {
    if (this.who >= NOBODY) return;
    const item = this.items[index];
    if (!item || item.variety === ItemType.NO_ITEM) return;
    // `takeItem` reports what happened either way, so success is judged by
    // whether the item actually left the floor — it splices it out of the town
    // on success and leaves it there on a refusal.
    const message = this.session.takeItem(item, this.who);
    const town = this.session.univ.town;
    if (town && town.items.includes(item)) {
      this.prompt = message || "It's too heavy to carry.";
      return;
    }
    this.items.splice(index, 1);
    if (this.first > 0 && this.first >= this.items.length) {
      this.first = Math.max(0, this.first - ITEMS_IN_WINDOW);
    }
    this.refresh();
  }
}
