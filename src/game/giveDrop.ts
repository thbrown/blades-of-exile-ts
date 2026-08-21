/**
 * Handing an item to another PC and putting one on the floor — `give_thing`
 * (boe.items.cpp:193) and `drop_item` (:110), with the two action handlers
 * above them (`handle_give_item`, `handle_drop_item` and its location half,
 * boe.actions.cpp:1116, :1130, :903).
 *
 * **Both were inventions before this.** `session.giveItemTo` took a PC index
 * from a dialog that offered anyone alive, so you could hand a breastplate to
 * someone across the room in a fight, or to someone with no room for it and get
 * a refusal the C++ never lets you reach. `session.dropItem` put the item on the
 * party's own square with a made-up message, refused outdoors entirely, and
 * ignored charges, curses and `DROP_CALL_SPECIAL`. The real pair are short; what
 * they lean on — `select_pc`'s give modes and the "how many?" prompt — is what
 * was missing.
 *
 * The shape to know: **dropping is two actions, not one.** Clicking the item
 * only remembers it and switches the mode; the square arrives as the next click
 * and `dropItemAt` finishes the job. Outdoors there is no square to pick, so it
 * happens at once behind a confirmation.
 */

import { Item, ItemAbil, ItemType } from '../data/item';
import { Location } from '../core/location';
import { GameMode, isCombat, isOut, isTown } from './modes';
import { GameSession } from './session';
import { GiveStatus, giveItem, takeItem } from '../universe/inventory';
import { SELECT_PC_NONE, SelectPcMode, runSelectPc } from './selectPc';
import { SpecCtx, SpecCtxType, SpecialHost } from './specials/context';
import { placeItem } from './loot';
import { takeAp } from './combat';

/** `adjacent` (boe.locutils.cpp:82). */
function adjacent(a: Location, b: Location): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/**
 * The text of `drop-item-confirm.xml`, which the outdoor drop puts up because
 * there is no floor to put anything on out there — the item is simply gone.
 */
export const DROP_CONFIRM = 'This item will be gone forever. Still drop it?';

/**
 * `give_thing` — hand item `itemNum` of PC `pcNum` to someone else.
 *
 * *Gotcha*: the C++ prints its "can't give" message and then **carries on** to
 * the `who_to < 6` test rather than returning, which is harmless only because 8
 * fails that test. Kept as written.
 */
export async function giveThing(
  session: GameSession, pcNum: number, itemNum: number, host: SpecialHost | null,
): Promise<void> {
  const { univ } = session;
  const pc = univ.party.pcs[pcNum];
  const item = pc?.items[itemNum];
  if (!pc || !item || item.variety === ItemType.NO_ITEM) return;
  if (pc.equip[itemNum] && item.cursed) {
    univ.addStringToBuf('Give: Item is cursed.');
    return;
  }
  if (!host) return;
  const inFight = isCombat(session.mode);
  // `item_store` in the C++ is a global the select-PC loop reads; here it rides
  // as an argument. It is a *copy* — the charge split below edits it without
  // touching what is still in the pack.
  const itemStore: Item = { ...item };
  const whoTo = await runSelectPc(
    univ, SelectPcMode.ONLY_CAN_GIVE_FROM_ACTIVE, 'Give item to who?',
    (options, title, highlight) => host.selectPc(options, title, highlight),
    { item: itemStore, inCombat: inFight, curPc: pcNum },
  );
  if (whoTo === SELECT_PC_NONE) {
    univ.addStringToBuf(inFight
      ? "Can't give: must be adjacent with enough carrying capacity."
      : "Can't give: no one has the carrying capacity.");
  }
  if (whoTo >= 6 || whoTo === pcNum) return;
  const to = univ.party.pcs[whoTo];
  if (!to) return;

  let takeGivenItem = true;
  if (itemStore.typeFlag > 0 && itemStore.charges > 1) {
    const howMany = await host.getNumOfItems(itemStore.charges);
    if (howMany === 0) return;
    if (howMany < itemStore.charges) takeGivenItem = false;
    item.charges -= howMany;
    itemStore.charges = howMany;
  }
  const status = giveItem(to, univ.party, itemStore).status;
  if (status !== GiveStatus.OK) {
    // "This should be impossible, because select_pc() already checked that the
    // options were viable." The C++ calls showFatalError here; a transcript
    // line is this port's version of shouting.
    univ.addStringToBuf('Unexpectedly failed to give item!');
    return;
  }
  if (takeGivenItem) takeItem(pc, itemNum);
}

/**
 * `drop_item` — the item leaves the pack, and where it goes depends on the mode
 * it was dropped in. `where` is ignored outdoors, where nothing is placed at
 * all: the item is destroyed.
 */
export async function dropItem(
  session: GameSession, pcNum: number, itemNum: number, where: Location,
  host: SpecialHost | null,
): Promise<void> {
  const { univ } = session;
  const pc = univ.party.pcs[pcNum];
  const item = pc?.items[itemNum];
  if (!pc || !item || item.variety === ItemType.NO_ITEM) return;

  const itemStore: Item = { ...item };
  let spec = item.ability === ItemAbil.DROP_CALL_SPECIAL ? item.abilStrength : -1;
  let howMany = 1;
  let takeDroppedItem = true;

  if (pc.equip[itemNum] && item.cursed) {
    univ.addStringToBuf('Drop: Item is cursed.');
  } else if (isOut(session.mode)) {
    if (!host) return;
    // The one confirmation in either path, because outdoors the item is not
    // put anywhere — it stops existing.
    // drop-item-confirm.xml. Its escape button is Cancel and its default is OK.
    const choice = await host.choice([DROP_CONFIRM],
      [{ name: 'okay', label: 'OK' }, { name: 'cancel', label: 'Cancel' }], '', 0, 0);
    if (choice !== 0) return;
    univ.addStringToBuf('Drop: OK');
    if (itemStore.typeFlag > 0 && itemStore.charges > 1) {
      howMany = await host.getNumOfItems(itemStore.charges);
      if (howMany === itemStore.charges) takeItem(pc, itemNum);
      else item.charges -= howMany;
    } else takeItem(pc, itemNum);
  } else if (session.mode === GameMode.DROP_TOWN || session.mode === GameMode.DROP_COMBAT) {
    if (itemStore.typeFlag > 0 && itemStore.charges > 1) {
      if (!host) return;
      howMany = await host.getNumOfItems(itemStore.charges);
      if (howMany <= 0) return;
      if (howMany < itemStore.charges) takeDroppedItem = false;
      itemStore.charges = howMany;
    }
    if (placeItem(univ, itemStore, where, true)) {
      // It went into a barrel or a crate rather than onto the floor, and a
      // `DROP_CALL_SPECIAL` doesn't fire for something merely put away.
      univ.addStringToBuf('Drop: Item put away');
      spec = -1;
    } else univ.addStringToBuf('Drop: OK');
    item.charges -= howMany;
    if (takeDroppedItem) takeItem(pc, itemNum);
  }
  // Note the loop: a stack dropped `howMany` at a time runs the chain that many
  // times, and outdoors `howMany` stays 1 for anything unstacked.
  if (spec >= 0) {
    while (howMany-- > 0) {
      await session.runSpecial(SpecCtx.DROP_ITEM, SpecCtxType.SCEN, spec, where);
    }
  }
}

/**
 * `handle_drop_item` (boe.actions.cpp:1130) — the item half. In town or combat
 * this only *arms* the drop; the square arrives as the click after it.
 *
 * *Gotcha*: the outdoor branch drops from `stat_window` — whichever pack is on
 * show — while the location branch below drops from `univ.cur_pc`. The two
 * halves of one action disagree about whose item it is, and only the outdoor
 * one is right. Kept, and the caller passes both.
 */
export async function handleDropItem(
  session: GameSession, statWindow: number, itemNum: number, host: SpecialHost | null,
): Promise<void> {
  const { univ } = session;
  if (session.mode === GameMode.DROP_TOWN || session.mode === GameMode.DROP_COMBAT) {
    univ.addStringToBuf('Drop item: Cancelled');
    session.mode = isTown(session.mode) ? GameMode.TOWN : GameMode.COMBAT;
  } else if (!session.primeTime) {
    univ.addStringToBuf("Drop item: Finish what you're doing first.");
  } else if (isOut(session.mode)) {
    await dropItem(session, statWindow, itemNum, univ.party.outLoc, host);
  } else {
    univ.addStringToBuf('Drop item: Click where to drop item.');
    session.dropSlot = itemNum;
    session.mode = isTown(session.mode) ? GameMode.DROP_TOWN : GameMode.DROP_COMBAT;
  }
}

/**
 * `handle_drop_item` (boe.actions.cpp:903), the location half — the square the
 * armed item lands on. Note it drops from **`univ.cur_pc`**, not from the pack
 * on show; see the gotcha above.
 */
export async function dropItemAt(
  session: GameSession, where: Location, host: SpecialHost | null,
): Promise<void> {
  const { univ } = session;
  const slot = session.dropSlot;
  if (slot < 0) return;
  if (session.mode === GameMode.DROP_COMBAT) {
    if (!adjacent(univ.currentPc.combatPos, where)) {
      univ.addStringToBuf('Drop: must be adjacent.');
    } else {
      await dropItem(session, univ.curPc, slot, where, host);
      takeAp(session.univ, 1);
    }
    session.mode = GameMode.COMBAT;
  } else if (session.mode === GameMode.DROP_TOWN) {
    if (!adjacent(univ.party.townLoc, where)) {
      univ.addStringToBuf('Drop: must be adjacent.');
    } else if (session.sightObscurity(where.x, where.y) === 5) {
      univ.addStringToBuf('Drop: Space is blocked.');
    } else await dropItem(session, univ.curPc, slot, where, host);
    session.mode = GameMode.TOWN;
  }
  session.dropSlot = -1;
}

/** `handle_give_item` (boe.actions.cpp:1116) — `prime_time`, then one AP. */
export async function handleGiveItem(
  session: GameSession, statWindow: number, itemNum: number, host: SpecialHost | null,
): Promise<void> {
  if (!session.primeTime) {
    session.univ.addStringToBuf("Give item: Finish what you're doing first.");
    return;
  }
  await giveThing(session, statWindow, itemNum, host);
  takeAp(session.univ, 1);
  // `did_something = true` (boe.actions.cpp:1125): handing something over costs
  // a turn, so the clock ticks and the monsters get their go. Missing it left
  // this port's clock a tick behind on every give, and the drift only surfaced
  // hundreds of actions later as a monster noticing the party on the wrong one.
  await session.afterPartyTurn();
}
