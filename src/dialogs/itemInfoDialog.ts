/**
 * The item sheet — `display_pc_item` (boe.infodlg.cpp:236) and `put_item_info`
 * (view_dialogs.cpp:21), running on the real `item-info.xml`.
 *
 * This is the "I" button on an inventory row. The port used to answer it with a
 * hand-written notice carrying the name, the description and two numbers; the
 * real dialog has the item's picture, its type, value, damage, bonus, defence,
 * encumbrance, uses, level and weight, two LEDs for identified and magic, the
 * ability spelled out in words, and arrows that step through the rest of the
 * pack without closing.
 */

import { Item, ItemType } from '../data/item';
import { itemInfoFields } from '../data/itemInfo';
import { Scenario } from '../data/scenario';
import { getStr } from '../data/strings';
import { NUM_INVEN_SLOTS } from '../universe/player';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** put_item_info — fill every control from one item. */
export function putItemInfo(dlg: XmlDialog, item: Item, scen: Scenario): void {
  dlg.setPictType('pic', 'item', item.graphicNum);
  dlg.setLed('id', item.ident ? 'red' : 'off');
  // Magic only shows once the item has been identified — an unidentified magic
  // item gives nothing away.
  dlg.setLed('magic', item.magic && item.ident ? 'red' : 'off');
  dlg.setText('type', getStr('item-types-display', item.variety + 1));

  // Clear every field first: the arrows reuse the same dialog, so a field the
  // next item doesn't fill would otherwise keep the last one's value.
  for (const name of ['val', 'dmg', 'bonus', 'def', 'enc', 'use', 'lvl', 'abil'])
    dlg.setText(name, '');

  if (!item.ident) {
    // An unidentified item shows only what it looks like. Note this returns
    // *before* the weight and description are set, so those keep whatever the
    // previous item left — which is the C++'s own behaviour.
    dlg.setText('name', item.name);
    return;
  }

  const f = itemInfoFields(item, scen);
  dlg.setText('name', f.name);
  dlg.setNum('weight', f.weight);
  dlg.setText('desc', f.desc);
  dlg.setNum('val', f.val);
  if (f.abil) dlg.setText('abil', f.abil);
  // The fields `itemInfoFields` leaves undefined stay blank, as cleared above.
  for (const name of ['dmg', 'bonus', 'def', 'enc', 'use', 'lvl'] as const) {
    const n = f[name];
    if (n !== undefined) dlg.setNum(name, n);
  }
}

/**
 * `display_pc_item` — the sheet for one item in a PC's pack, with the arrows
 * stepping to the next item that PC is carrying.
 *
 * `pcNum >= 6` means the item doesn't belong to anyone (a shop's stock, a thing
 * on the floor), and the C++ hides the arrows for it.
 */
export function itemInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  univ: Universe, pcNum: number, slot: number, loose?: Item,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('item-info'));
  const pc = univ.party.pcs[pcNum];
  let which = slot;
  const shown = (): Item =>
    (pcNum >= 6 || !pc ? loose ?? univ.party.pcs[0]!.items[0]! : pc.items[which]!);

  if (pcNum >= 6 || !pc) {
    dlg.hide('left');
    dlg.hide('right');
  } else {
    const step = (by: number) => (): 'stay' => {
      // The C++'s do/while walks past empty slots. A pack with one item in it
      // comes back round to the same one.
      for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
        which = (which + by + NUM_INVEN_SLOTS) % NUM_INVEN_SLOTS;
        if (pc.items[which]!.variety !== ItemType.NO_ITEM) break;
      }
      putItemInfo(dlg, shown(), univ.scenario);
      return 'stay';
    };
    dlg.attachHandler('left', step(-1));
    dlg.attachHandler('right', step(1));
  }
  // The two LEDs are read-only here: the C++ attaches the click handler to
  // them precisely "to suppress normal LED behaviour", so clicking one does
  // nothing rather than toggling it.
  dlg.attachHandler('id', () => 'stay');
  dlg.attachHandler('magic', () => 'stay');

  putItemInfo(dlg, shown(), univ.scenario);
  return dlg;
}
