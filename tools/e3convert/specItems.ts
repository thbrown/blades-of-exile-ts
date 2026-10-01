/**
 * Exile III's special-item button (`FUN_10c0_1f96`), as the converter can
 * write it. Items 0–5 and 9, the province maps, show a picture of the map
 * (dialogs 0x3b6–0x3bd, BIGMAPS.BMP's cell each; `PROVINCE_MAPS`). The Orb
 * of Thralni (6) and the Amulet of Rapid
 * Returning (7) are the engine's (`src/game/e3Flight.ts`, under the
 * `special-items` flag), which runs `amuletNode` as the amulet lands the
 * party. The Wand of Unusual Results (8) is a node here.
 */

import { makeSpecItem, type SpecItem } from '../../src/data/quest';
import { Skill } from '../../src/universe/skills';
import { partyFlag as f, type SpecBuilder, type Step } from './script';
import { FORT_SIDE } from './towns/town21';

/**
 * Which dialog each province map shows (the jump table at `10c0:2385`).
 * 0x3ba, the map to Black Halberd, is an item of the pack's (`notes.ts`),
 * and Footracer's (0x3bc) is special item 9, out of order.
 */
const PROVINCE_MAPS = new Map<number, number>([
  [0, 0x3b6], [1, 0x3b7], [2, 0x3b8], [3, 0x3b9], [4, 0x3bb], [5, 0x3bd], [9, 0x3bc],
]);

/** Uses of the wand so far (party+0x457); past 120 it does nothing. */
const WAND_USES = f(0x457);

/**
 * The wand (case 8): "You wave the wand.", then one of twelve things at
 * random (`get_ran(1, 0, 11)`), each named by string `19*300 + 120 + k`.
 * Where E3 writes a PC's record directly, the engine's node for it differs
 * a little: spell points stop at the PC's maximum, where E3 adds 5
 * regardless.
 */
function wand(b: SpecBuilder, text: (k: number) => string): Step[] {
  const effects: Step[][] = [
    [b.diseaseAll(1)],
    [b.cureDiseaseAll(1), b.poison(-1)],
    [b.eachPc(() => [b.ifStat(Skill.CUR_XP, 6, [b.drainXp(5)])])],
    [b.restoreSp(5)],
    [b.food(5)],
    [b.ifTakeFood(5, [])],
    [], [], [], [],
    [b.gold(5)],
    [b.ifGold(5, [b.takeGold(5)])],
  ];
  return [
    b.log(0x10c0, 0x1f6d),
    b.ifFlagAtLeast(WAND_USES, 0x79, [b.log(0x10c0, 0x1f80)], [
      b.incFlag(WAND_USES),
      b.randomCase(effects.length, effects.map((then, k) => [b.say(text(k)), ...then])),
    ]),
  ];
}

/** The fifty special items, with the ten E3 lets the party Use marked so. */
export function e3SpecialItems(
  b: SpecBuilder, strings: (id: number) => string, count: number,
): { items: SpecItem[]; amuletNode: number } {
  const items = Array.from({ length: count }, (_, k) => {
    const item = makeSpecItem();
    item.name = strings(1801 + 2 * k);
    item.descr = strings(1802 + 2 * k);
    return item;
  });
  for (const k of [6, 7, 8]) items[k]!.flags = 1;
  for (const [k, dlg] of PROVINCE_MAPS) {
    items[k]!.flags = 1;
    items[k]!.special = b.compile([b.dialog(dlg)]);
  }
  items[8]!.special = b.compile(wand(b, (k) => strings(19 * 300 + 120 + k)));
  // The amulet lands the party on the fort's caves side (E3: zone column 7).
  const amuletNode = b.compile([b.setFlag(FORT_SIDE, 0)]);
  return { items, amuletNode };
}
