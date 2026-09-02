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

/**
 * `GI=1`, the pair to the harness's `BOE_TRACE_GI`: the pile the get-items
 * screen opened on, and one line per row taken.
 *
 * Worth having for the same reason `PICK=1` is: **taking an item spends no
 * draws**, so two engines can hand the same recording's `item3-key` to
 * different PCs — or find different things under it — and stay byte-identical
 * in the draw stream until, thousands of actions later, one of them raises a
 * "how many?" prompt over a stack the other never split. The pile is printed
 * as `variety/charges/type_flag` in row order, which is the order a recording's
 * row letters index into.
 */
const TRACE_GI = Boolean(
  typeof process !== 'undefined' ? process.env?.GI : undefined);

const giLine = (item: Item): string =>
  `${item.variety}/${item.charges}/${item.typeFlag}@${item.itemLoc.x},${item.itemLoc.y}`;

export class GetItemsPick {
  /** `current_getting_pc` — who picks things up. */
  who: number;

  /** The scroll position: which item is drawn on the top row. */
  first = 0;

  /**
   * `cDialog::getResult<bool>()` — "the player stole something on this
   * screen". `show_get_items` starts it false and `display_item_event_filter`
   * sets it the first time a *property* item is taken, which is both the
   * answer `get_item` acts on afterwards and the reason the steal prompt only
   * ever appears once per screen.
   */
  stole = false;

  /**
   * The row waiting on `steal-item`'s answer, or null. The C++ raises a nested
   * `cChoiceDlog` here and blocks; this port cannot block inside a click
   * handler, so the pick holds the question and the next click answers it —
   * which is also what a recording replays, since it recorded the nested
   * dialog's `steal` / `leave` as plain `click_control`s.
   */
  pendingSteal: number | null = null;

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
    if (TRACE_GI) {
      console.log(`      [gi] open who=${this.who} cur=${session.univ.curPc}`
        + ` wct=${session.whichCombatType}`
        + ` n=${items.length} [${items.map(giLine).join(' ')}]`);
    }
  }

  /**
   * Can this PC hold anything at all — alive, with a free slot?
   *
   * **Deliberately without the combat clause**, because the C++'s two tests are
   * not the same test. `put_item_graphics` demotes the current carrier on
   * `main_status != ALIVE || !has_space()` alone (boe.items.cpp:367); only the
   * loop that *promotes* a replacement also asks `(!is_combat() || univ.cur_pc
   * == i)`. So in combat a PC who is neither dead nor full stays the carrier
   * even when they are not the acting PC, and this port used to demote them.
   */
  canHold(index: number): boolean {
    const pc = this.session.univ.party.pcs[index];
    if (pc === undefined || pc.mainStatus !== MainStatus.ALIVE) return false;
    return hasSpace(pc) >= 0;
  }

  /** Whose button is *shown* — and so who may be promoted to carrier. */
  usable(index: number): boolean {
    // In combat only the acting PC can take things: the rest are elsewhere on
    // the battlefield.
    return this.canHold(index)
      && (!isCombat(this.session.mode) || this.session.univ.curPc === index);
  }

  /**
   * `put_item_graphics`'s bookkeeping half — settle who is carrying and what
   * the prompt says. A PC who has died or filled their pack stops being the
   * one picking up, and the first PC whose button is shown takes over.
   *
   * Note the asymmetry between the two conditions, which is the C++'s and is
   * load-bearing: see `canHold`.
   */
  refresh(): void {
    if (this.who < NOBODY && !this.canHold(this.who)) this.who = NOBODY;
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
    // While `steal-item` is up it is modal and owns every click, exactly as the
    // C++'s nested `cChoiceDlog` does. "Leave" abandons the take outright
    // (`return true` before any of the giving, boe.items.cpp:479).
    if (this.pendingSteal !== null) {
      const index = this.pendingSteal;
      if (id === 'steal') {
        this.pendingSteal = null;
        this.stole = true;
        this.take(index);
      } else if (id === 'leave') {
        this.pendingSteal = null;
      }
      // Anything else is a click the nested modal swallowed.
      return 'stay';
    }
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
      // **Unconditionally**, as `display_item_event_filter` does
      // (`current_getting_pc = id[2] - '1'`, boe.items.cpp:466). This used to
      // be guarded on `usable`, reasoning that the C++ hides a button it cannot
      // use so a click on one can never arrive — true of a player, false of a
      // recording, and the guard changed the answer rather than ignoring the
      // click: refusing the assignment leaves the *previous* carrier in place,
      // where the C++ takes the click, demotes to `NOBODY` in `refresh` and
      // promotes the first PC who can hold something. That is the whole of
      // `ASR_19-05-2025_19-38-44`'s divergence — the C++ handing rows to PCs 0
      // and 1 while this port went on handing them to PC 2.
      this.who = Number(pc[1]) - 1;
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
    if (TRACE_GI) {
      const at = this.items[index];
      console.log(`      [gi] take idx=${index} who=${this.who}`
        + ` cur=${this.session.univ.curPc} first=${this.first}`
        + ` n=${this.items.length} item=${at ? giLine(at) : 'none'}`);
    }
    if (this.who >= NOBODY) return;
    const item = this.items[index];
    if (!item || item.variety === ItemType.NO_ITEM) return;
    // Someone else's property asks first, and only the *first* time: once the
    // player has said "steal" the screen's result is set and every later
    // property item goes quietly (boe.items.cpp:475).
    if (item.property) {
      if (!this.stole) { this.pendingSteal = index; return; }
    }
    // The C++ hands over a **copy** with `property` cleared and blanks the
    // floor original, so the item in the pack is never stolen goods and the
    // one still on the floor after a weight refusal is still someone else's.
    // One object stands in for both here, so clear it and put it back if the
    // take doesn't happen.
    const wasProperty = item.property;
    item.property = false;
    // `takeItem` reports what happened either way, so success is judged by
    // whether the item actually left the floor — it splices it out of the town
    // on success and leaves it there on a refusal.
    const message = this.session.takeItem(item, this.who);
    const town = this.session.univ.town;
    if (town && town.items.includes(item)) {
      item.property = wasProperty;
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
