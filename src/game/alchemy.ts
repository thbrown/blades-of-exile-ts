/**
 * Making a potion — `do_alchemy` (boe.party.cpp:2284) and the eligibility half
 * of `alch_choice` (:2345).
 *
 * The dialogs the C++ runs (select_pc, then pick-potion.xml) belong to the
 * host; what's here is the rules — who can attempt what, what it consumes, and
 * what comes out.
 */

import { Alchemy, AlchemyRecipe, alchemyCharges, alchemyFailChance, alchemyName, alchemyPotion, canMakeAlchemy, alchemyRecipe } from '../data/alchemy';
import { Item, ItemAbil, ItemType } from '../data/item';
import { GiveStatus, e3AbilSlot, giveItem, hasAbil, removeCharge } from '../universe/inventory';

// Re-exported for the callers that found it here first; `has_abil` is a
// `cPlayer` method and now lives beside `hasAbilEquip` in `universe/inventory`.
export { hasAbil };
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { Skill } from '../universe/skills';
import { Universe } from '../universe/universe';
import { bugFixed } from './bugFixes';
import { placeItem } from './loot';
import type { GameSession } from './session';


/** cPlayer::has_space (pc.cpp:732) — the first empty slot, or -1. */
export function hasSpace(pc: Player): number {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (pc.items[i]!.variety === ItemType.NO_ITEM) return i;
  }
  return -1;
}

/** One line of `alch_choice`'s potion list. */
export interface AlchemyChoice {
  which: Alchemy;
  recipe: AlchemyRecipe;
  name: string;
  /** The difficulty, which the dialog shows in brackets after the name. */
  difficulty: number;
  /**
   * `can_make` — false means the recipe is known but this PC's skill is below
   * its difficulty. The C++ hides the Take button and leaves the label, so the
   * player can see what they're working towards.
   */
  canMake: boolean;
}

/**
 * The recipes to offer `pcNum`: every one the *party* knows, whether or not
 * this PC can manage it (`alch_choice`, boe.party.cpp:2358).
 */
export function alchemyChoices(univ: Universe, pcNum: number): AlchemyChoice[] {
  const pc = univ.party.pcs[pcNum];
  const skill = pc ? pc.skill(Skill.ALCHEMY) : 0;
  const out: AlchemyChoice[] = [];
  for (let i = 0; i < univ.party.alchemy.length; i++) {
    if (!univ.party.alchemy[i]) continue;
    const info = alchemyRecipe(i);
    if (!info) continue;
    out.push({
      which: i,
      recipe: info,
      name: alchemyName(i),
      difficulty: info.difficulty,
      canMake: canMakeAlchemy(info, skill),
    });
  }
  return out;
}

/**
 * The body of `do_alchemy` once the PC and the potion have been chosen. Every
 * refusal is a transcript line and no ingredients are spent; past that point
 * the ingredients go whether the mixing works or not.
 */
export function makePotion(
  session: GameSession, pcNum: number, which: Alchemy, sound?: (n: number) => void,
): void {
  const univ = session.univ;
  const pc = univ.party.pcs[pcNum];
  const info = alchemyRecipe(which);
  if (!pc || !info) return;
  if (univ.scenario.featureFlags['alchemy'] === 'exile3') {
    e3MakePotion(session, pc, which, sound);
    return;
  }
  const say = (line: string): void => univ.addStringToBuf(line);

  if (hasSpace(pc) < 0) {
    say("Alchemy: Can't carry another item.");
    return;
  }
  const first = hasAbil(pc, info.ingred1);
  if (!first) {
    say('Alchemy: Don\'t have ingredients.');
    return;
  }
  if (info.ingred2 !== ItemAbil.NONE) {
    const second = hasAbil(pc, info.ingred2);
    if (!second) {
      say('Alchemy: Don\'t have ingredients.');
      return;
    }
    // Highest slot first: `remove_charge` can take the item out of the pack
    // entirely, and everything below it shifts up (the C++'s own comment).
    if (first.slot < second.slot) {
      removeCharge(pc, second.slot);
      removeCharge(pc, first.slot);
    } else {
      removeCharge(pc, first.slot);
      removeCharge(pc, second.slot);
    }
  } else removeCharge(pc, first.slot);

  sound?.(8);

  const roll = univ.rng.getRan(1, 1, 100);
  const skill = pc.skill(Skill.ALCHEMY);
  if (roll < alchemyFailChance(info, skill)) {
    say('Alchemy: Failed.');
    sound?.(41);
    return;
  }
  const potion = alchemyPotion(which);
  // Only `charges`: `cItem(ITEM_POTION)` left `max_charges` at 1 and
  // `do_alchemy` doesn't touch it, so a two- or three-dose potion reads as
  // over-full. Kept.
  potion.charges = alchemyCharges(info, skill);
  // Three shades of the same bottle, so a shelf of potions isn't uniform.
  potion.graphicNum += univ.rng.getRan(1, 0, 2);
  const given = giveItem(pc, univ.party, potion);
  if (given.status !== GiveStatus.OK) {
    say('No room in inventory. Potion placed on floor.');
    placeItem(univ, potion, univ.party.townLoc);
  } else say('Alchemy: Successful.');
}

/**
 * Exile III's recipes (`10b0:88f4`, tables in DGROUP): BoE's first seventeen,
 * in the same order and at the same difficulties, but with ingredients named
 * by E3 ability code and the scenario's own items as the products.
 */
export const E3_ALCHEMY: Readonly<Record<'ingred1' | 'ingred2' | 'difficulty' | 'fail' | 'product', readonly number[]>> = {
  /** `DS:30ba`. 55 is both Wormgrass and Asp Fangs, so either will do. */
  ingred1: [52, 53, 52, 53, 55, 54, 54, 55, 58, 55, 58, 52, 58, 56, 57, 56, 56],
  /** `DS:30dc`, 0 for none. Recipes 9 and 11 differ from BoE's. */
  ingred2: [0, 0, 0, 55, 0, 0, 0, 54, 0, 54, 52, 55, 53, 0, 0, 55, 57],
  /** `DS:30fe`. */
  difficulty: [1, 1, 1, 3, 3, 4, 5, 5, 7, 9, 9, 10, 12, 12, 9, 14, 19],
  /** `DS:3120`, indexed by skill above difficulty. */
  fail: [50, 40, 30, 20, 10, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /** `DS:3148`: the item each recipe makes. */
  product: [272, 273, 176, 276, 177, 265, 256, 268, 350, 274, 285, 178, 257, 179, 351, 266, 217],
};

/**
 * E3's `do_alchemy` (`10b0:88f4`) once the PC and recipe are chosen — 1997's,
 * with E3's tables. It differs from the BoE path above in four ways:
 *   - the roll is `get_ran(1,0,100)` on the *raw* Alchemy skill, and a
 *     failure draws `get_ran(1,0,1)` besides (1997 has both; OBoE neither);
 *   - the second ingredient is taken from the slot found *before* the first
 *     was used, so when the first runs out and the pack shifts up, a charge
 *     comes off whatever moved into that slot. 1997 does the same; OBoE takes
 *     the higher slot first, as the fix does (E3-SUSPECTED-BUGS.md #17);
 *   - the product is the scenario's item, identified, one charge more at five
 *     over the difficulty and another at eleven, and a new picture only if it
 *     is a potion (the poisons and the balm keep theirs);
 *   - with no room for it, E3 says so and the potion is lost: it has none
 *     of 1997's "Potion placed on floor".
 */
function e3MakePotion(
  session: GameSession, pc: Player, which: Alchemy, sound?: (n: number) => void,
): void {
  const univ = session.univ;
  const t = E3_ALCHEMY;
  const say = (line: string): void => univ.addStringToBuf(line);
  const need1 = t.ingred1[which];
  const need2 = t.ingred2[which];
  const made = t.product[which];
  if (need1 === undefined || need2 === undefined || made === undefined) return;

  if (hasSpace(pc) < 0) {
    say("Alchemy: Can't carry another item.");
    return;
  }
  const slot1 = e3AbilSlot(pc, need1);
  const slot2 = need2 > 0 ? e3AbilSlot(pc, need2) : 0;
  if (slot1 === NUM_INVEN_SLOTS || slot2 === NUM_INVEN_SLOTS) {
    say("Alchemy: Don't have ingredients.");
    return;
  }
  sound?.(8);
  if (need2 > 0 && bugFixed(17) && slot1 < slot2) {
    removeCharge(pc, slot2);
    removeCharge(pc, slot1);
  } else {
    removeCharge(pc, slot1);
    if (need2 > 0) removeCharge(pc, slot2);
  }

  const skill = pc.skills[Skill.ALCHEMY] ?? 0;
  const over = skill - t.difficulty[which]!;
  if ((t.fail[over] ?? 0) > univ.rng.getRan(1, 0, 100)) {
    say('Alchemy: Failed.');
    univ.rng.getRan(1, 0, 1);
    sound?.(41);
    return;
  }
  const template = univ.scenario.scenItems[made];
  if (!template) return;
  const potion: Item = { ...template, ident: true };
  if (over >= 5) potion.charges++;
  if (over >= 11) potion.charges++;
  if (potion.variety === ItemType.POTION) potion.graphicNum += univ.rng.getRan(1, 0, 2);
  if (giveItem(pc, univ.party, potion).status !== GiveStatus.OK) say('No room in inventory.');
  else say('Alchemy: Successful.');
}
