/**
 * Boss kills: the end of `FUN_10c0_5051`, E3's `kill_monst`. After the death
 * flag (`spec1`/`spec2`, the creature's `<sdf>`) E3 switches on the dead
 * creature's `spec2` through a table at `cs:57e2` (twelve values, handlers
 * at `+0x18`), and some handlers go on to test `spec1`. The switch does not
 * look at the town, so a case belongs to whichever creatures carry its
 * numbers; `e3KillCase` answers for one creature.
 *
 * The engine's hook is the creature's `<onkill>`, which runs after its death
 * flag is set, as E3's does (`damage.ts`). E3's "every creature is gone"
 * loops (clearing `active` at `+0x1427` for all 60) are `removeCreatures()`.
 *
 * Offsets decoded here: `party+0x84fd + 2k` is `key_times[k]` (`setEvent`),
 * and `party+0x8485 + t` is `can_find_town[t]` (`townVisible`).
 */

import { FieldType } from '../../../src/data/fields';
import { e3TownMessageBlock } from '../specials';
import { partyFlag as f, partySpecItem, type SpecBuilder, type Step } from '../script';

/** The two plague bosses' flags, which Anaximander's reports wait for. */
const SLIME_DEAD = f(0xc85);
const GOLEMS_DONE = f(0xc8c);

/** What killing a creature with this `spec1`/`spec2` does in `town`, or null. */
export function e3KillCase(b: SpecBuilder, town: number, spec1: number, spec2: number): Step[] | null {
  switch (spec2) {
    // `55b1`.
    case 8:
      return [0x68, 0x69, 0x39].includes(spec1) ? [b.dialog(0xfc8)] : null;
    // `55df`: a run of `if`s on `spec1`; at most one matches.
    case 9:
      if (spec1 === 0x1c) return [b.dialog(0xcd9), b.xp(20)];
      if (spec1 === 0x1d) return [b.dialog(0xce0), b.xp(20), b.setFlag(f(0x1a4), 6)];
      if (spec1 === 0x47) return [b.dialog(0xe7e), b.xp(20), b.setFlag(f(0x353), 1)];
      if (spec1 >= 0xa7 && spec1 <= 0xaa) return [b.dialog(0xe12)];
      // The golems' crystal (town 60).
      if (spec1 === 0x3c) {
        return [
          b.dialog(0xe10), b.dialog(0xe11), b.giveSpecItem(partySpecItem(0x46)), b.setEvent(3),
          b.removeCreatures(), b.setFlag(GOLEMS_DONE, 1), b.journal(0xd), b.xp(25),
        ];
      }
      return null;
    // `5309`: a word, and the town is lost from the map.
    case 0xc8:
      return [b.msg(e3TownMessageBlock(town), 0x21), b.townVisible(88, false)];
    // `5336`: the Alien Slime (town 23).
    case 0xc9:
      return [
        b.setFlag(SLIME_DEAD, 1), b.dialog(0xca5), b.xp(25), b.removeCreatures(), b.journal(6), b.setEvent(0),
      ];
    // `538a` (town 47). `FUN_1038_0788(x, y)` is quickfire, as at the Filth
    // Factory (`filthFactory.ts`).
    case 0xca:
      return [
        b.dialog(0xd90),
        ...[[0x18, 0x1e], [0x11, 0x22], [0x1f, 0x22], [0x18, 0x18], [0x18, 0x29]]
          .map(([x, y]) => b.placeField(x!, y!, FieldType.FIELD_QUICKFIRE)),
        b.journal(0x1b), b.townVisible(47, false), b.setFlag(f(0x263), 1),
        b.takeSpecItem(partySpecItem(0x4c)), b.takeSpecItem(partySpecItem(0x54)),
      ];
    // `540c` (town 99): creature slot 1 goes too (`+0x1483`).
    case 0xcb:
      return [
        b.msg(0x41, 0x2f), b.setFlag(f(0x46b), 1), b.setFlag(f(0x465), 20), b.setFlag(f(0x46a), 1),
        b.setFlag(f(0x469), 1), b.removeCreatureSlots([1]),
      ];
    // `5455` (town 52). Flag 0x28f is the town's spot 3, now dead; E3 then
    // re-scans its spots (`FUN_10d8_43ab`), which the engine's spot guard
    // does on every step.
    case 0xcd:
      return [b.msg(0x3d, 0x19, 0x1a), b.setFlag(f(0x28f), 20), b.setFlag(f(0x295), 1), b.setFlag(f(0xb0f), 1)];
    // `5490` (town 102): the party dies with it.
    case 0xce:
      return [b.msg(0x42, 0xa), b.slayParty(2)];
    // `54a9` (town 104): flag (104,9), then `FUN_10d8_3d5b(0x53, 104, 9)`
    // takes every 0x53 away since it is set, and the town turns.
    case 0xcf:
      return [b.msg(0x42, 0x16), b.setFlag(f(0x49d), 1), b.removeCreatures(0x53), b.makeTownHostile()];
    // `54d8` (town 61): while the terrain at (9,3) (town `+0x2d01`) is not 0.
    case 0xd0:
      return [b.ifTer(9, 3, 0, [], [b.msg(0x3e, 0xe), b.setTer(9, 3, 0), b.setFlag(f(0x2ef), 2)])];
    // `550f` (town 36) and `5560` (town 62): the third kill clears the town.
    case 0xd1:
      return countdown(b, f(0x1f5), 0xd20, 0xd21);
    case 0xd2:
      return countdown(b, f(0x2f8), 0xe24, 0xe25);
    default:
      return null;
  }
}

function countdown(b: SpecBuilder, count: [number, number], before: number, last: number): Step[] {
  return [b.incFlag(count), b.ifFlagBelow(count, 3, [b.dialog(before)], [b.dialog(last), b.removeCreatures()])];
}

/**
 * After the switch (`5724`): the four creatures with `spec1` 0x3a (town 58)
 * each have a death flag, (58,6)–(58,9); the last of them to die gives a
 * message, once (flag 0x58d to 2).
 */
export function e3KillAfter(b: SpecBuilder, spec1: number): Step[] {
  if (spec1 !== 0x3a) return [];
  const all = [0x2ce, 0x2cf, 0x2d0, 0x2d1].reduceRight<Step[]>(
    (then, flag) => [b.ifFlagAtLeast(f(flag), 1, then)],
    [b.ifFlagBelow(f(0x58d), 2, [b.msg(0x3d, 0x2a), b.setFlag(f(0x58d), 2)])],
  );
  return all;
}
