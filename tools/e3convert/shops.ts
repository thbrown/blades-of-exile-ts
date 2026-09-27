/**
 * Exile 3's shops. E3's shop code is BoE 1997's `start_shop_mode`
 * (DLGUTILS.CPP) almost line for line — `FUN_1020_0082` sets up the shop and
 * `FUN_1020_0ebe` fills it — with one difference that matters here: **what a
 * shop sells comes from the shopkeeper, not the conversation**. The talk node
 * names the kind of shop and its price level; the creature's `extra1`/`extra2`
 * name the first and last entry of a list. The lists:
 *
 * | shop type | E3 talk node | stock `extra1 … extra2` indexes |
 * |---|---|---|
 * | 0 weapons, 1 armor, 2 general | 7, 5, 12 | the int16 item list at `1100:02a0` |
 * | 3 healer | 18 | nothing: the nine cures, as BoE's healer |
 * | 4 food | 11 | the fifteen 63-byte food records at `1100:1652` |
 * | 5–9 the magic shops | 17 (`e1` = which) | nothing: refreshed at random, as BoE's |
 * | 10 mage, 11 priest spells | 14, 15 | E3's own lists (`FUN_1098_9084`, `_92f9`) |
 * | 12 alchemy | 16 | the recipes (`FUN_1098_94de`) |
 *
 * E3's two spell lists name BoE's spells: entry `i` teaches spell `spell[i]`
 * of the 62, at E3's own price. BoE only ever sold spells from 30 up and
 * prices the rest at a placeholder 5 gold, so those carry a `cost=`.
 */

import { ItemType } from '../../src/data/item';
import { Shop, ShopItemType, ShopPreset, ShopPrompt, presetShop } from '../../src/data/shop';
import type { LegacyItem } from '../../src/fileio/legacy/structs';
import { neAutoDataSegment, readNeSegment } from './ne';

/** Segment 33 (`1100:`), which also holds `terrain_pic` at `+0xa0`. */
const TABLE_SEGMENT = 33;
const ITEM_LIST = 0x2a0;
const ITEM_LIST_LENGTH = 256;
const FOOD = 0x1652;
const FOOD_COUNT = 15;
/** E3's in-memory item record: the 59-byte file record with the names 4 bytes on. */
const FOOD_RECORD = 63;

export interface E3SpellEntry { spell: number; cost: number }

export interface E3ShopTables {
  itemList: number[];
  food: LegacyItem[];
  mage: E3SpellEntry[];
  priest: E3SpellEntry[];
  alchemyCosts: number[];
}

export function readE3ShopTables(exe: Uint8Array): E3ShopTables {
  const seg = readNeSegment(exe, TABLE_SEGMENT);
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const i16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getInt16(o, true);
  const text = (from: number, len: number) => {
    const b = seg.subarray(from, from + len);
    const end = b.indexOf(0);
    return new TextDecoder('windows-1252').decode(end < 0 ? b : b.subarray(0, end));
  };
  const itemList = Array.from({ length: ITEM_LIST_LENGTH }, (_, i) => i16(seg, ITEM_LIST + 2 * i));
  const food = Array.from({ length: FOOD_COUNT }, (_, i): LegacyItem => {
    const o = FOOD + i * FOOD_RECORD;
    return {
      variety: i16(seg, o), itemLevel: i16(seg, o + 2), awkward: 0, bonus: 0, protection: 0,
      charges: 0, type: 0, magicUseType: 0, graphicNum: seg[o + 9] ?? 0, ability: 0,
      abilityStrength: 0, typeFlag: 0, isSpecial: 0, value: i16(seg, o + 13), weight: 0,
      specialClass: 0, itemLoc: { x: 0, y: 0 }, fullName: text(o + 23, 25), name: text(o + 48, 15),
      treasClass: 0, itemProperties: 1,
    };
  });
  // Each list is a byte of spell numbers and an int16 of prices, copied onto
  // the stack by the function that looks one up.
  const spells = (spellsAt: number, costsAt: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ spell: ds[spellsAt + i] ?? 0, cost: i16(ds, costsAt + 2 * i) }));
  return {
    itemList,
    food,
    mage: spells(0x2049, 0x2070, 38),
    priest: spells(0x21e2, 0x2194, 39),
    alchemyCosts: Array.from({ length: 17 }, (_, i) => i16(ds, 0x22e6 + 2 * i)),
  };
}

/** E3's shop types, as `start_shop_mode` numbers them. */
export enum E3ShopType {
  WEAPONS = 0, ARMOR = 1, GENERAL = 2, HEALER = 3, FOOD = 4,
  /** The first of the five magic shops, 5–9. */
  MAGIC_SHOPS = 5,
  MAGE = 10, PRIEST = 11, ALCHEMY = 12,
}

/**
 * The scenario's first six shops, which the engine expects where BoE's
 * scenario constructor puts them: the five magic shops, then the healer.
 * E3's magic shops are BoE's (`FUN_1070_41a4` is `refresh_store_items`, with
 * the same loot table), and so is its healer.
 */
export function standardShops(): Shop[] {
  return [...Array.from({ length: 5 }, () => presetShop(ShopPreset.JUNK)), presetShop(ShopPreset.HEALING)];
}
export const HEALER_SHOP = 5;

/**
 * One E3 shop as an engine shop. `foodBase` is where the food records were
 * appended to the item list. Returns null for a shop the engine already has
 * (the healer).
 */
export function e3Shop(
  tables: E3ShopTables, type: E3ShopType, first: number, last: number, title: string, foodBase: number,
): Shop | null {
  if (type === E3ShopType.HEALER) return null;
  const shop = new Shop();
  shop.name = title;
  shop.prompt = type === E3ShopType.MAGE ? ShopPrompt.MAGE
    : type === E3ShopType.PRIEST ? ShopPrompt.PRIEST
    : type === E3ShopType.ALCHEMY ? ShopPrompt.ALCHEMY : ShopPrompt.SHOPPING;
  const placeholder = { variety: ItemType.GOLD } as Parameters<Shop['addItem']>[1];
  for (let i = first; i <= last; i++) {
    switch (type) {
      case E3ShopType.WEAPONS: case E3ShopType.ARMOR: case E3ShopType.GENERAL: {
        const n = tables.itemList[i];
        if (n !== undefined && n >= 0) shop.addItem(n, { ...placeholder }, 0);
        break;
      }
      case E3ShopType.FOOD:
        if (i >= 0 && i < tables.food.length) shop.addItem(foodBase + i, { ...placeholder }, 0);
        break;
      case E3ShopType.MAGE: case E3ShopType.PRIEST: {
        const e = (type === E3ShopType.MAGE ? tables.mage : tables.priest)[i];
        if (!e) break;
        shop.addSpecial(type === E3ShopType.MAGE ? ShopItemType.MAGE_SPELL : ShopItemType.PRIEST_SPELL, e.spell);
        shop.getItem(shop.size - 1).item.value = e.cost;
        break;
      }
      case E3ShopType.ALCHEMY: {
        const cost = tables.alchemyCosts[i];
        if (cost === undefined) break;
        shop.addSpecial(ShopItemType.ALCHEMY, i);
        shop.getItem(shop.size - 1).item.value = cost;
        break;
      }
    }
  }
  return shop;
}
