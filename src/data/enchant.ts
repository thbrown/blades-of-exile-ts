/**
 * `eEnchant` and `cEnchant` (enchant.hpp / enchant.cpp) — the eight things a
 * smith can do to a plain weapon, and `cItem::enchant_weapon` (item.cpp:374),
 * which is the only thing that applies them.
 *
 * **The numbers are the enum's, and they are stored.** A talk node's ENCHANT
 * arm puts its `extra1` straight into `shop_identify_cost` (boe.dlgutil.cpp:1048)
 * and `handle_item_shop_action` casts that back to an `eEnchant`
 * (boe.actions.cpp:1211), so a scenario names its smith's service by *number*.
 * Don't renumber.
 *
 * `PLUS_FOUR` is last rather than fourth, which is what a table grown by
 * appending looks like — `cEnchant::MAX` is `int(PLUS_FOUR)` and the list is
 * walked by index, so the order is part of the format too.
 */

import { DamageType } from './monster';
import { Item, ItemAbil, ItemType } from './item';
import { Spell } from './spell';
import { Status } from '../universe/skills';

export enum Enchant {
  NONE = -1,
  PLUS_ONE = 0,
  PLUS_TWO = 1,
  PLUS_THREE = 2,
  SHOOT_FLAME = 3,
  FLAMING = 4,
  PLUS_FIVE = 5,
  BLESSED = 6,
  PLUS_FOUR = 7,
}

export interface EnchantInfo {
  /** What goes in the brackets after the item's name: "Bronze Sword (+2)". */
  suffix: string;
  /** `aug_cost` — the price multiplier, not a price. See `adjustValue`. */
  augCost: number;
  addBonus: number;
  addAbility: ItemAbil;
  abilStrength: number;
  /** `uItemAbilData` — a spell, a damage type or a status, by ability. */
  abilData: number;
  charges: number;
}

function e(
  suffix: string, augCost: number,
  rest: Partial<Omit<EnchantInfo, 'suffix' | 'augCost'>> = {},
): EnchantInfo {
  return {
    suffix,
    augCost,
    addBonus: 0,
    addAbility: ItemAbil.NONE,
    abilStrength: 0,
    abilData: 0,
    charges: 0,
    ...rest,
  };
}

/** `cEnchant::dictionary` (enchant.cpp:68). */
export const ENCHANTS: Partial<Record<Enchant, EnchantInfo>> = {
  [Enchant.PLUS_ONE]: e('+1', 4, { addBonus: 1 }),
  [Enchant.PLUS_TWO]: e('+2', 7, { addBonus: 2 }),
  [Enchant.PLUS_THREE]: e('+3', 10, { addBonus: 3 }),
  [Enchant.SHOOT_FLAME]: e('F', 8, {
    addAbility: ItemAbil.CAST_SPELL, abilStrength: 5, abilData: Spell.FLAME, charges: 8,
  }),
  [Enchant.FLAMING]: e('F!', 15, {
    addAbility: ItemAbil.DAMAGING_WEAPON, abilStrength: 5, abilData: DamageType.FIRE,
  }),
  [Enchant.PLUS_FIVE]: e('+5', 15, { addBonus: 5 }),
  [Enchant.BLESSED]: e('B', 10, {
    addBonus: 1,
    addAbility: ItemAbil.AFFECT_STATUS, abilStrength: 5, abilData: Status.BLESS_CURSE,
  }),
  [Enchant.PLUS_FOUR]: e('+4', 15, { addBonus: 4 }),
};

/**
 * `cEnchant::adjust_value` (enchant.cpp:59) — what the item is worth
 * afterwards, and (through `place_item_button`) what the smith charges for it.
 *
 * Note it is a `max`, not a sum: a worthless weapon still costs `augCost * 100`
 * to enchant, and an expensive one costs a multiple of its own value. Both
 * halves matter — a Bronze Knife at 4 gold and a Mithral Blade at 800 pay very
 * different prices for the same +1.
 */
export function adjustValue(ench: Enchant, initialValue: number): number {
  const info = ENCHANTS[ench];
  if (!info) return initialValue;
  return Math.max(info.augCost * 100, initialValue * (5 + info.augCost));
}

/**
 * `cItem::enchant_weapon` (item.cpp:374) — put an enchantment on a weapon.
 *
 * The three refusals at the top are the same set `place_item_button` uses to
 * decide whether the button appears at all, so a shop can never reach them; a
 * special node's `CHANGE_ITEM` arm can.
 *
 * **The value clamp is written twice and the second half looks wrong**: `if
 * (value > 15000) value = 15000; if (value < 0) value = 15000;` — a value that
 * has overflowed *negative* is treated as the maximum rather than as zero.
 * Kept, because `adjust_value` multiplies by up to twenty and `value` is a
 * `short` in the save file.
 */
export function enchantWeapon(item: Item, ench: Enchant): void {
  if (item.magic || item.ability !== ItemAbil.NONE) return;
  if (item.variety !== ItemType.ONE_HANDED && item.variety !== ItemType.TWO_HANDED) return;
  const info = ENCHANTS[ench];
  if (!info) return;

  item.magic = true;
  item.enchanted = true;
  // The name is built from the *old* full name and only assigned at the end,
  // which is why the bonus and the value below can't be read out of it.
  const storeName = `${item.fullName} (${info.suffix})`;
  item.bonus += info.addBonus;
  item.value = adjustValue(ench, item.value);
  if (info.addAbility !== ItemAbil.NONE) {
    item.ability = info.addAbility;
    item.abilStrength = info.abilStrength;
    item.abilData = info.abilData;
  }
  if (info.charges > 0) {
    item.charges = info.charges;
    item.maxCharges = info.charges;
    item.rechargeable = true;
  }
  if (item.value > 15000) item.value = 15000;
  if (item.value < 0) item.value = 15000;
  item.fullName = storeName;
}
