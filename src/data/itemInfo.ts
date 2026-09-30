/**
 * What the item sheet says about an identified item — the fields
 * `put_item_info` (view_dialogs.cpp:21) fills, as plain values. The dialog
 * (`dialogs/itemInfoDialog.ts`) writes these into its controls; the Exile III
 * item list (`src/pages/items/`) prints them as "what the game tells you".
 *
 * A number field left undefined is one the dialog leaves blank.
 */

import { Item, ItemAbil, ItemType, SKILL_INVALID } from './item';
import { getAbilName, weaponSkillName } from './itemAbilName';
import { Scenario } from './scenario';
import { getStr } from './strings';
import { itemWeight } from '../universe/inventory';

export interface ItemInfoFields {
  type: string;
  name: string;
  weight: number;
  /** The player's part of the description, before `|||`. */
  desc: string;
  val: number;
  abil: string;
  dmg?: number;
  bonus?: number;
  def?: number;
  enc?: number;
  use?: number;
  lvl?: number;
}

export function itemInfoFields(item: Item, scen: Scenario): ItemInfoFields {
  const f: ItemInfoFields = {
    type: getStr('item-types-display', item.variety + 1),
    name: item.fullName,
    weight: itemWeight(item),
    // `|||` ends the part of the description the player is allowed to read; the
    // rest is the designer's note.
    desc: item.desc.split('|||')[0] ?? '',
    // A stack of charges is worth its value times the count.
    val: item.charges > 0 ? item.value * item.charges : item.value,
    abil: '',
  };

  if (item.ability !== ItemAbil.NONE) {
    if (item.concealed) {
      f.abil = '???';
    } else {
      let abil = getAbilName(item);
      if (item.ability === ItemAbil.SUMMONING || item.ability === ItemAbil.MASS_SUMMONING) {
        abil = abil.replace('%s', scen.scenMonsters[item.abilData]?.name ?? '');
      }
      f.abil = abil;
    }
  }
  if (item.charges > 0) f.use = item.charges;
  if (item.protection > 0) f.def = item.protection;

  switch (item.variety) {
    case ItemType.ONE_HANDED:
    case ItemType.TWO_HANDED:
    case ItemType.BOW:
    case ItemType.CROSSBOW:
    case ItemType.THROWN_MISSILE:
    case ItemType.MISSILE_NO_AMMO:
      // A weapon with no ability of its own advertises the skill it rolls
      // against instead — the ability field does double duty. The C++ then
      // falls through into the ammunition case, which shares the two lines
      // below; TypeScript won't allow a non-empty fallthrough, so they are
      // written out in both arms.
      if (item.ability === ItemAbil.NONE && item.weapType !== SKILL_INVALID)
        f.abil = `Key skill: ${weaponSkillName(item.weapType)}`;
      f.dmg = item.itemLevel;
      f.bonus = item.bonus;
      break;
    case ItemType.ARROW:
    case ItemType.BOLTS:
      f.dmg = item.itemLevel;
      f.bonus = item.bonus;
      break;
    case ItemType.POTION:
    case ItemType.RING:
    case ItemType.SCROLL:
    case ItemType.TOOL:
    case ItemType.WAND:
    case ItemType.NECKLACE:
      f.lvl = item.itemLevel;
      break;
    case ItemType.SHIELD:
    case ItemType.ARMOR:
    case ItemType.HELM:
    case ItemType.GLOVES:
    case ItemType.SHIELD_2:
    case ItemType.BOOTS:
      // The C++ has its own TODO about this: armour folds bonus and protection
      // together into "Bonus" and puts the item level under "Defend", which is
      // the other way round from a weapon. Kept.
      f.bonus = item.bonus + item.protection;
      f.def = item.itemLevel;
      f.enc = item.awkward;
      break;
    case ItemType.WEAPON_POISON:
      f.lvl = item.itemLevel;
      break;
    default:
      // no item, gold, food, non-use and the two unused kinds: nothing to add.
      break;
  }
  return f;
}
