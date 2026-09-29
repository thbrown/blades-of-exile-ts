/**
 * Carrying, equipping and dropping items — the parts of cPlayer that deal with
 * its 24 inventory slots: give_item (pc.cpp:447), equip_item (:590),
 * unequip_item (:634), max_weight (:674) and cur_weight (:679), plus
 * cItem::item_weight (item.cpp:99).
 */

import { makeJob } from '../data/quest';
import { Item, ItemAbil, ItemType, defaultItem } from '../data/item';
import { ItemCat, variety } from '../data/itemVariety';
import { Party } from './party';
import { printResult } from './living';
import { NUM_INVEN_SLOTS, Player } from './player';
import { MainStatus, Race, Skill, Status, Trait } from './skills';

export enum GiveStatus {
  OK = 'ok',
  DEAD = 'dead',
  NO_SPACE = 'no-space',
  TOO_HEAVY = 'too-heavy',
}

/** cItem::item_weight — stacks of ammo and potions weigh per charge. */
export function itemWeight(item: Item): number {
  if (item.variety === ItemType.NO_ITEM) return 0;
  if (item.charges > 0) {
    switch (item.variety) {
      case ItemType.ARROW:
      case ItemType.THROWN_MISSILE:
      case ItemType.POTION:
      case ItemType.BOLTS:
        return item.charges * item.weight;
      default:
        break;
    }
  }
  return item.weight;
}

/**
 * cPlayer::max_weight (pc.cpp:674).
 *
 * **`skill()`, not `skills[]`** — the effective strength, with any BOOST_STAT
 * or BOOST_WAR an equipped item grants, and clamped to 20 *after* the boost.
 * Reading the raw array skipped a girdle of strength, and a Vahnatai's -25.
 */
export function maxWeight(pc: Player): number {
  return (
    100 +
    15 * Math.min(pc.skill(Skill.STRENGTH), 20) +
    (pc.traits[Trait.STRENGTH] ? 30 : 0) +
    (pc.traits[Trait.BAD_BACK] ? -50 : 0) +
    (pc.race === Race.VAHNATAI ? -25 : 0)
  );
}

/** cPlayer::cur_weight — two abilities shift the total by a flat 30. */
export function curWeight(pc: Player): number {
  let weight = 0;
  let airy = false;
  let heavy = false;
  for (const item of pc.items) {
    if (item.variety === ItemType.NO_ITEM) continue;
    weight += itemWeight(item);
    if (item.ability === ItemAbil.LIGHTER_OBJECT) airy = true;
    if (item.ability === ItemAbil.HEAVIER_OBJECT) heavy = true;
  }
  if (airy) weight -= 30;
  if (heavy) weight += 30;
  return weight;
}

export function freeWeight(pc: Player): number {
  return maxWeight(pc) - curWeight(pc);
}

/** The first empty inventory slot, or -1. */
export function firstFreeSlot(pc: Player): number {
  // `has_space()` walks `INVENTORY_SIZE`, not `items.size()` — the scratch slot
  // at the end is not storage and `give_item` reaches it by its own route.
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (pc.items[i]!.variety === ItemType.NO_ITEM) return i;
  }
  return -1;
}

/**
 * cPlayer::sort_items' priority table (pc.cpp:419) — what a pack is ordered
 * by. Wands and scrolls float to the top, worn gear sinks, and the empty
 * slots (priority 20, along with gold, food, quests and special items, none of
 * which ever occupy one) end up at the bottom.
 */
const SORT_PRIORITY: Record<ItemType, number> = {
  [ItemType.NO_ITEM]: 20, [ItemType.ONE_HANDED]: 8, [ItemType.TWO_HANDED]: 8,
  [ItemType.GOLD]: 20, [ItemType.BOW]: 9, [ItemType.ARROW]: 9,
  [ItemType.THROWN_MISSILE]: 3, [ItemType.POTION]: 2, [ItemType.SCROLL]: 1,
  [ItemType.WAND]: 0, [ItemType.TOOL]: 7, [ItemType.FOOD]: 20,
  [ItemType.SHIELD]: 10, [ItemType.ARMOR]: 10, [ItemType.HELM]: 10,
  [ItemType.GLOVES]: 10, [ItemType.SHIELD_2]: 10, [ItemType.BOOTS]: 10,
  [ItemType.RING]: 5, [ItemType.NECKLACE]: 6, [ItemType.WEAPON_POISON]: 4,
  [ItemType.NON_USE_OBJECT]: 11, [ItemType.PANTS]: 12, [ItemType.CROSSBOW]: 9,
  [ItemType.BOLTS]: 9, [ItemType.MISSILE_NO_AMMO]: 9, [ItemType.QUEST]: 20,
  [ItemType.SPECIAL]: 20,
};

/**
 * cPlayer::sort_items (pc.cpp:417) — the pack sorts itself every time it
 * gains an item, and the order is *observable*: `handle_use_item` records the
 * slot number, so a replay that used slot 3 uses whatever this leaves there.
 * A pack that agrees on contents and not on order is a different game.
 *
 * The bubble sort is kept verbatim, including the `i < 23` bound: it compares
 * slot 23 against slot 24 and stops, so a 24-slot pack is fully covered but
 * only just. It swaps on strictly-less, which makes it stable — items of equal
 * priority keep the order they were picked up in.
 *
 * The C++ also fixes up `weap_poisoned.slot` as it swaps. This port stores the
 * poisoned weapon as the item itself rather than an index (see `poisonWeapon`),
 * so there is nothing to renumber.
 */
export function sortItems(pc: Player): void {
  const priority = (item: Item): number => SORT_PRIORITY[item.variety] ?? 20;
  for (let noSwaps = false; !noSwaps;) {
    noSwaps = true;
    for (let i = 0; i < NUM_INVEN_SLOTS - 1; i++) {
      if (priority(pc.items[i + 1]!) >= priority(pc.items[i]!)) continue;
      noSwaps = false;
      const item = pc.items[i]!;
      pc.items[i] = pc.items[i + 1]!;
      pc.items[i + 1] = item;
      const equipped = pc.equip[i]!;
      pc.equip[i] = pc.equip[i + 1]!;
      pc.equip[i + 1] = equipped;
    }
  }
}

export interface GiveResult {
  status: GiveStatus;
  /** The slot the item landed in, or -1 for party-level items and failures. */
  slot: number;
  /** What to print, when the caller asked for a message. */
  message: string;
}

/**
 * `GIVE_EQUIP_SOFT` / `_TRY` / `_FORCE` (pc.hpp:38) — whether `give_item` also
 * *wears* what it hands over, and how hard it tries.
 *
 * The three are mutually exclusive, and `_FORCE` is `_SOFT | _TRY` — which is
 * why the C++'s "should I take something off?" test reads
 * `equip_type != GIVE_EQUIP_SOFT` and its "may I take a cursed thing off?"
 * test reads `equip_type == GIVE_EQUIP_FORCE`.
 *
 * There is no 1997 counterpart: the extras on `GIVE_ITEM` are an Open Blades
 * addition, so this is OBoE's rule with nothing to weigh it against.
 */
export enum GiveEquip {
  /** Don't equip at all — the default, and what every caller but a node uses. */
  NONE = 0,
  /** Equip if it fits as-is; if a hand is full, leave it in the pack. */
  SOFT = 4,
  /** Take something off to make room, unless it is cursed. */
  TRY = 8,
  /** Take something off even if it is cursed. */
  FORCE = 12,
}

/**
 * cPlayer::give_item. Gold, food, special items and quests go to the party
 * rather than a slot; everything else needs both spare capacity and a slot.
 *
 * With `checkOnly` (GIVE_CHECK_ONLY) nothing changes hands — the caller just
 * wants to know whether it could, which is how ok_to_buy tests a purchase.
 */
export function giveItem(
  pc: Player, party: Party, item: Item, checkOnly = false, allowOverload = false,
  equipType: GiveEquip = GiveEquip.NONE,
): GiveResult {
  if (pc.mainStatus !== MainStatus.ALIVE)
    return { status: GiveStatus.DEAD, slot: -1, message: '' };
  if (item.variety === ItemType.NO_ITEM)
    return { status: GiveStatus.OK, slot: -1, message: '' };

  switch (item.variety) {
    case ItemType.GOLD:
      if (!checkOnly) party.gold += item.itemLevel;
      return { status: GiveStatus.OK, slot: -1, message: 'You get some gold.' };
    case ItemType.FOOD:
      if (!checkOnly) party.food += item.itemLevel;
      return { status: GiveStatus.OK, slot: -1, message: 'You get some food.' };
    case ItemType.SPECIAL:
      if (!checkOnly) party.specItems.add(item.itemLevel);
      return { status: GiveStatus.OK, slot: -1, message: 'You get a special item.' };
    case ItemType.QUEST:
      // Picking up a quest item *starts* that quest, dated today.
      if (!checkOnly) party.activeQuests.set(item.itemLevel, makeJob(party.calcDay()));
      return { status: GiveStatus.OK, slot: -1, message: 'You get a quest.' };
    default:
      break;
  }

  // `GIVE_ALLOW_OVERLOAD` (pc.cpp) — the debug give and the get-items screen's
  // overload path skip the weight test outright.
  if (!allowOverload && itemWeight(item) > freeWeight(pc))
    return { status: GiveStatus.TOO_HEAVY, slot: -1, message: 'Item too heavy to carry.' };

  // **A full pack can still take a stackable item** (pc.cpp:502). The C++ drops
  // it into the scratch slot at `INVENTORY_SIZE`, asks `combine_things(true)`
  // whether that would merge with anything, and if so carries on with the
  // scratch slot as the destination — `combine_things` below then folds it
  // away. The slot is cleared again either way before the decision is acted on.
  let slot = firstFreeSlot(pc);
  if (slot < 0) {
    pc.items[NUM_INVEN_SLOTS] = { ...item };
    if (combineThings(pc, true)) slot = NUM_INVEN_SLOTS;
    pc.items[NUM_INVEN_SLOTS] = defaultItem();
  }
  if (slot < 0) return { status: GiveStatus.NO_SPACE, slot: -1, message: 'No room for item.' };

  // Taking an item clears the flags that only apply while it's on the floor.
  if (!checkOnly) {
    pc.items[slot] = { ...item, property: false, contained: false, held: false };
    if (equipType !== GiveEquip.NONE && variety(item.variety).equipCount)
      giveEquip(pc, slot, item, equipType);
    // `combine_things(); sort_items();` is give_item's last act (pc.cpp:579),
    // in that order — the merge first, so the sort never has to shuffle a pile
    // that is about to disappear.
    combineThings(pc);
    sortItems(pc);
  }
  const name = item.ident ? item.fullName : item.name;
  return { status: GiveStatus.OK, slot, message: `  ${pc.name} gets ${name}.` };
}

/**
 * `give_item`'s equip block (pc.cpp:526) — put the new item on, and under
 * `_TRY` or `_FORCE` take whatever is in the way off first.
 *
 * The search picks up to two victims. Only `HANDS` ever fills both, because a
 * two-handed weapon has to clear a weapon *and* a shield; `rem1` is the weapon
 * side and `rem2` the shield side, and which of the two a given item claims
 * first depends on what it is.
 *
 * **The `else if(rem1 < INVENTORY_SIZE) rem1 = i;` at the tail of the loop can
 * never fire.** `rem1` starts at `INVENTORY_SIZE`, and nothing outside the
 * `HANDS` branch above ever lowers it, so for every other exclusion category —
 * a missile weapon, its ammo, a second helmet — the test is false on every
 * iteration and no victim is ever found. The `==` this was surely meant to be
 * would make `_TRY` work for those too. Kept as written: a silent fix here
 * would make a node that hands over a bow start unequipping the old one.
 */
function giveEquip(pc: Player, slot: number, item: Item, equipType: GiveEquip): void {
  if (equipItem(pc, slot).ok) return;
  if (equipType === GiveEquip.SOFT) return;

  const info = variety(item.variety);
  const exclude = info.exclusion;
  let rem1 = NUM_INVEN_SLOTS;
  let rem2 = NUM_INVEN_SLOTS;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (i === slot || !pc.equip[i]) continue;
    const other = pc.items[i]!;
    if (variety(other.variety).exclusion !== exclude) continue;
    // Two MISC items only collide when they are the *same* variety — two
    // helmets, not a helmet and a pair of boots.
    if (exclude === ItemCat.MISC && item.variety !== other.variety) continue;
    if (exclude === ItemCat.HANDS) {
      if (rem1 === NUM_INVEN_SLOTS) {
        if (item.variety === ItemType.ONE_HANDED || item.variety === ItemType.TWO_HANDED
          || rem2 < NUM_INVEN_SLOTS) rem1 = i;
        if (rem1 < NUM_INVEN_SLOTS) continue;
      }
      if (rem2 === NUM_INVEN_SLOTS) {
        if (item.variety === ItemType.SHIELD || item.variety === ItemType.SHIELD_2
          || rem1 < NUM_INVEN_SLOTS) rem2 = i;
      }
    } else if (rem1 < NUM_INVEN_SLOTS) rem1 = i;
  }

  // A cursed item only comes off under `_FORCE`.
  const canRem1 = rem1 < NUM_INVEN_SLOTS
    && (!pc.items[rem1]!.cursed || equipType === GiveEquip.FORCE);
  const canRem2 = rem2 < NUM_INVEN_SLOTS
    && (!pc.items[rem2]!.cursed || equipType === GiveEquip.FORCE);
  if (exclude === ItemCat.HANDS) {
    if (info.numHands === 2 && canRem1 && canRem2) {
      pc.equip[rem1] = false;
      pc.equip[rem2] = false;
    } else if (info.numHands === 1) {
      if (canRem1) pc.equip[rem1] = false;
      else if (canRem2) pc.equip[rem2] = false;
    }
    // Taking the poisoned weapon off wipes the poison with it. The C++
    // compares slot numbers against `weap_poisoned.slot`; this port holds the
    // item itself, so the comparison is by identity.
    const poisoned = pc.weapPoisoned;
    if (poisoned !== null
      && ((pc.items[rem1] === poisoned && !pc.equip[rem1])
        || (pc.items[rem2] === poisoned && !pc.equip[rem2]))) {
      pc.status[Status.POISONED_WEAPON] = 0;
      pc.weapPoisoned = null;
    }
  } else if (canRem1) pc.equip[rem1] = false;
  // Whether or not anything came off, try once more.
  equipItem(pc, slot);
}

/** Whether the party as a whole could take this item. */
export function partyCanTake(party: Party, item: Item): boolean {
  return party.pcs.some((pc) => {
    if (pc.mainStatus !== MainStatus.ALIVE) return false;
    switch (item.variety) {
      case ItemType.GOLD:
      case ItemType.FOOD:
      case ItemType.SPECIAL:
      case ItemType.QUEST:
        return true;
      default:
        return itemWeight(item) <= freeWeight(pc) && firstFreeSlot(pc) >= 0;
    }
  });
}

/**
 * `cPlayer::combine_things` (pc.cpp:746) — merge stackable items.
 *
 * Two items stack when they share a **`type_flag`** and both are identified;
 * the flag is the scenario's "these are the same thing" key, so five piles of
 * twelve arrows become one of sixty. This went in two milestones late, and
 * leaving it out is not cosmetic: an unstacked pack is
 * *longer*, so every slot below the first stack sits one place further down,
 * and `has_type_equip` — which returns the **first equipped item** of a type —
 * can come back with a different weapon on each side.
 *
 * Three details kept verbatim:
 *
 * - **The cap is 125 per stack**, and the overflow is *lost* rather than left
 *   behind: the C++ clamps `items[i].charges` to 125 and still removes `j`.
 * - **The equipped flag is inherited.** If the pile being absorbed was the
 *   equipped one, the survivor becomes equipped.
 * - **`take_item(j)` shifts the pack up and the loop still increments `j`**,
 *   so the item that slides into slot `j` is skipped on this pass. Three
 *   identical piles in a row therefore need two calls to fully merge. Kept —
 *   `give_item` calls this once per item taken, which is how it converges.
 *
 * `checkOnly` answers "would anything combine?" without touching the pack,
 * which is what `give_item` asks of the extra slot. `say` is the C++'s
 * `print_result` hook, which is null in most of the paths that reach here.
 */
export function combineThings(
  pc: Player, checkOnly = false, say?: (line: string) => void,
): boolean {
  let canCombine = false;
  // **`items.size()`, not `INVENTORY_SIZE`** — the C++'s own comment says "here
  // it is correct to check items.size() because the extra slot is *for*
  // combining things", so the scratch slot at the end takes part.
  for (let i = 0; i < pc.items.length; i++) {
    const a = pc.items[i]!;
    if (a.variety !== ItemType.NO_ITEM && a.typeFlag > 0 && a.ident) {
      for (let j = i + 1; j < pc.items.length; j++) {
        const b = pc.items[j]!;
        if (b.variety === ItemType.NO_ITEM || b.typeFlag !== a.typeFlag || !b.ident) continue;
        canCombine = true;
        if (checkOnly) continue;
        say?.('(items combined)');
        const total = a.charges + b.charges;
        if (total > 125) {
          a.charges = 125;
          say?.('(Can have at most 125 of any item.)');
        } else a.charges = total;
        if (pc.equip[j]) {
          pc.equip[i] = true;
          pc.equip[j] = false;
        }
        takeItem(pc, j);
      }
    }
    if (pc.items[i]!.variety !== ItemType.NO_ITEM && pc.items[i]!.charges < 0) {
      pc.items[i]!.charges = 1;
    }
  }
  return canCombine;
}

export interface EquipResult {
  ok: boolean;
  message: string;
}

/** cPlayer::equip_item. */
export function equipItem(pc: Player, slot: number): EquipResult {
  const item = pc.items[slot];
  if (!item) return { ok: false, message: 'Equip: Can\'t equip this item.' };
  const info = variety(item.variety);
  if (info.equipCount === 0) return { ok: false, message: "Equip: Can't equip this item." };

  let numThisType = 0;
  let handsOccupied = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (!pc.equip[i]) continue;
    if (pc.items[i]!.variety === item.variety) numThisType++;
    handsOccupied += variety(pc.items[i]!.variety).numHands;
  }

  // Only one missile weapon and one kind of ammo at a time.
  if (info.exclusion === ItemCat.MISSILE_AMMO || info.exclusion === ItemCat.MISSILE_WEAPON) {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++)
      if (pc.equip[i] && variety(pc.items[i]!.variety).exclusion === info.exclusion)
        return { ok: false, message: 'Equip: You have something of this type equipped.' };
  }

  if (2 - handsOccupied < info.numHands)
    return { ok: false, message: 'Equip: Not enough free hands' };
  if (info.equipCount <= numThisType)
    return { ok: false, message: "Equip: Can't equip another" };

  pc.equip[slot] = true;
  return { ok: true, message: 'Equip: OK' };
}

/** cPlayer::unequip_item. */
export function unequipItem(pc: Player, slot: number): EquipResult {
  if (!pc.equip[slot]) return { ok: false, message: 'Equip: Not equipped' };
  if (pc.items[slot]!.cursed) return { ok: false, message: 'Equip: Item is cursed.' };
  pc.equip[slot] = false;
  return { ok: true, message: 'Equip: Unequipped' };
}

/**
 * cPlayer::has_abil_equip (pc.cpp:...) — the first equipped item with an
 * ability. `dat` narrows to abilities that carry a parameter (which status a
 * ring protects against, which stat an item boosts); -1 means "any".
 */
export function hasAbilEquip(
  pc: Player, abil: ItemAbil, dat = -1, notE3 = false,
): { slot: number; item: Item } | null {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i] || item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    // `notE3`: as in `getProtLevel`.
    if (notE3 && item.e3Ability >= 0) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    return { slot: i, item };
  }
  return null;
}

/**
 * cPlayer::has_abil (pc.cpp:807) — the first item in the pack with an ability
 * and a charge left. Unlike `hasAbilEquip` it doesn't care whether the item is
 * worn, which is what makes a plant in the bottom of the pack an ingredient.
 *
 * **Which of the two a caller wants is a rule, not a detail.** Magic Map asks
 * `has_abil` for its sapphire (boe.party.cpp:802) and so works out of the pack;
 * this port asked `has_abil_equip` and refused a sapphire nobody was wearing.
 * Read the C++ before picking one.
 */
export function hasAbil(pc: Player, abil: ItemAbil, dat = -1): { slot: number; item: Item } | null {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    if (item.charges === 0) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    return { slot: i, item };
  }
  return null;
}

/**
 * cPlayer::get_prot_level (pc.cpp:...) — the *summed* strength of every
 * equipped item with this ability. Two rings of protection stack; the status
 * methods divide the total down before subtracting it from an effect.
 */
export function getProtLevel(pc: Player, abil: ItemAbil, dat = -1, notE3 = false): number {
  let sum = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i] || item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    // `notE3`: leave out Exile III's items, where a rule of its own replaces
    // BoE's for them (`Item.e3Ability`).
    if (notE3 && item.e3Ability >= 0) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    sum += item.abilStrength;
  }
  return sum;
}

/**
 * Whether the PC wears an item Exile III gives ability `code` — its own
 * number, not BoE's (`Item.e3Ability`) — as its `FUN_1070_0681` asks.
 */
export function hasE3AbilEquip(pc: Player, code: number): boolean {
  return e3AbilEquip(pc, code) !== null;
}

/**
 * Lift an item's curse, as Remove Curse and a temple do. Exile III keeps its
 * curse in the ability byte (14, or 95 for Dancing Boots) and lifts it by
 * zeroing that (the healer, `1020:06d9`; the spell, `10b0:4937`), so its
 * uncursed Dancing Boots stop dancing too.
 */
export function uncurse(item: Item): void {
  item.cursed = false;
  item.unsellable = false;
  if (item.e3Ability === 14 || item.e3Ability === 95) item.e3Ability = 0;
}

/** E3's `FUN_1070_0681` itself: the first equipped item with E3 ability `code`. */
export function e3AbilEquip(pc: Player, code: number): Item | null {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (pc.equip[i] && item.variety !== ItemType.NO_ITEM && item.e3Ability === code) return item;
  }
  return null;
}

/**
 * cPlayer::take_item (pc.cpp:916) — empty a slot. The pack has no holes in it:
 * everything below the slot shifts up, which is why the inventory list always
 * reads as a contiguous run.
 *
 * Taking the poisoned weapon loses the poison (pc.cpp:922). The C++ also
 * shifts `weap_poisoned.slot` down with the rest; this port holds the item
 * itself, so there is nothing to shift.
 */
export function takeItem(pc: Player, slot: number): void {
  // The scratch slot is not part of the pack, so emptying it shifts nothing
  // (pc.cpp:919). `combine_things` reaches here with it when `give_item` has
  // used the extra-slot route.
  if (slot === NUM_INVEN_SLOTS) {
    pc.items[NUM_INVEN_SLOTS] = defaultItem();
    return;
  }
  if (pc.weapPoisoned !== null && pc.weapPoisoned === pc.items[slot]
    && (pc.status[Status.POISONED_WEAPON] ?? 0) > 0) {
    printResult('  Poison lost.');
    pc.status[Status.POISONED_WEAPON] = 0;
    pc.weapPoisoned = null;
  }
  for (let i = slot; i < NUM_INVEN_SLOTS - 1; i++) {
    pc.items[i] = pc.items[i + 1]!;
    pc.equip[i] = pc.equip[i + 1]!;
  }
  pc.items[NUM_INVEN_SLOTS - 1] = defaultItem();
  pc.equip[NUM_INVEN_SLOTS - 1] = false;
}

/** Remove an item from a slot, unequipping it first; cursed gear won't go. */
export function takeItemFrom(pc: Player, slot: number): Item | null {
  const item = pc.items[slot];
  if (!item || item.variety === ItemType.NO_ITEM) return null;
  if (item.cursed && pc.equip[slot]) return null;
  pc.equip[slot] = false;
  takeItem(pc, slot);
  return item;
}

/**
 * cPlayer::remove_charge (pc.cpp:938) — spend one use. An item that runs out
 * and can't be recharged is gone; a rechargeable one stays in the pack at zero
 * so a shop can fill it again.
 */
export function removeCharge(pc: Player, slot: number): void {
  const item = pc.items[slot];
  if (!item || item.charges <= 0) return;
  item.charges--;
  if (item.charges === 0 && !item.rechargeable) takeItem(pc, slot);
}

/**
 * `cPlayer::has_class` (pc.cpp:851) — the first slot holding an item of this
 * special class. `requireCharges` skips one that has run out.
 */
export function hasClass(
  pc: Player, itemClass: number, requireCharges = false,
): number {
  return pc.items.findIndex((item) => item.variety !== ItemType.NO_ITEM
    && item.specialClass === itemClass
    && (!requireCharges || item.charges > 0));
}

/**
 * `cParty::take_class` (party.cpp:691) — take **one** item of a class off the
 * first living PC who has one, and say whether anything was taken.
 *
 * A stack or a rechargeable loses a charge instead of the whole item, which is
 * how a node that buys "one of these" from a pile of five leaves four behind.
 * Class 0 is "no class" and matches nothing.
 */
export function takeClass(party: Party, itemClass: number): boolean {
  if (itemClass === 0) return false;
  for (const pc of party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    const slot = hasClass(pc, itemClass, true);
    if (slot < 0) continue;
    const item = pc.items[slot]!;
    if (item.charges > 1 || item.rechargeable) item.charges--;
    else takeItem(pc, slot);
    return true;
  }
  return false;
}
