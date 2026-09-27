/**
 * Outdoor monster groups: `FUN_10c0_06c3(script, phase)`, E3's own
 * `handle_wandering_specials`. A group's 24 bytes (`E3OutWandering`) carry
 * a script at `+10`, a message `(+18, +20)` (string `block*300 + i`) and
 * `+22`, which says when the message shows. The outdoor turn
 * (`1010:38e1`) copies the group met to `DGROUP 0x46a2` and calls phase 0;
 * a 1 back starts the fight (`FUN_1010_42d3`, which still lets a much
 * weaker group run). Ending the fight calls phase 1 (`1010:1b20`, after
 * "End combat" and sound 93), and running from it phase 2 (`1010:37cc`,
 * `1010:3aa6`).
 *
 * These become the group's `<onmeet>`, `<onwin>` and `<onflee>`. Where E3
 * returns 0 at the meeting, the chain ends in `blockMove`, which is how an
 * engine `spec_on_meet` calls the fight off.
 *
 * A script from 2 to 99 also makes the group meet the party from anywhere
 * (`1010:392c`), which is the engine's `force`; 99 is the one E3 uses.
 */

import type { E3OutWandering } from '../outdoor';
import { partyFlag as f, type SpecBuilder, type Step } from '../script';
import { FACTORY_BURNED } from './filthFactory';

/** The Alien Slime is dead (`kills.ts`). */
const SLIME_DEAD = f(0xc85);

export interface GroupSteps { meet: Step[] | null; win: Step[] | null; flee: Step[] | null }

/** Whether E3 meets this group wherever it is, not only beside the party. */
export function e3GroupForced(g: E3OutWandering): boolean {
  const script = g.words[0] ?? 0;
  return script > 1 && script < 100;
}

/** Phase 0, 1 and 2 of `FUN_10c0_06c3` for one group; null where E3 does nothing. */
export function e3GroupSteps(b: SpecBuilder, g: E3OutWandering): GroupSteps {
  const [script = 0, , , block = 0, i = 0, when = 0] = g.words;
  const hasMsg = block > 0 && i > 0;
  return {
    meet: hasMsg && when < 2 ? [b.msg(block, i), ...(when === 0 ? [b.blockMove()] : [])] : meet(b, script),
    // `10c0:0857`: a message for the win comes instead of the script's.
    win: hasMsg && when === 2 ? [b.msg(block, i)] : win(b, script),
    flee: flee(b, script),
  };
}

/** Phase 0 without a message: most scripts just fight. */
function meet(b: SpecBuilder, script: number): Step[] | null {
  switch (script) {
    // Empire troops, who leave a party that has killed the slime alone.
    case 0x66:
      return [b.ifFlagEq(SLIME_DEAD, 0, [b.msg(0x56, 4)], [b.msg(0x56, 5), b.blockMove()])];
    // A Nephilim patrol: it spares the party that saved it from the ursagi,
    // or one with a Nephil (race 1) among the living.
    case 0x6e:
      return [b.ifFlagEq(f(0xb55), 1, [b.msg(0x57, 0x4b), b.blockMove()], [
        b.ifSpecies(1, [b.msg(0x57, 0x4a), b.blockMove()], [b.msg(0x57, 0x49)]),
      ])];
    // Empire guards, who let the party pass once it has killed the slime or
    // burned the Filth Factory, as Sharimik's gates do (`sharimik.ts`).
    case 0x72:
      return [b.ifFlagEq(SLIME_DEAD, 0, [b.ifFlagEq(FACTORY_BURNED, 0, [b.msg(0x54, 0x1a)], [b.msg(0x54, 0x1b), b.blockMove()])],
        [b.msg(0x54, 0x1b), b.blockMove()])];
    default:
      return null;
  }
}

/**
 * Phase 1, the loot: the jump table at `cs:0b1b`, indexed by `script - 100`.
 * Gold goes straight into party+4, silently; `FUN_1070_0564` and
 * `FUN_1070_0464(item, -1)` both give an item to the first PC with room.
 */
function win(b: SpecBuilder, script: number): Step[] | null {
  switch (script) {
    case 100:
      return [b.msg(0x58, 0xf), b.setFlag(f(0xbc9), 1)];
    case 0x65:
      return [b.msg(0x57, 0x2e), b.giveItem(0x152)];
    case 0x67:
      return [b.msg(0x56, 0xf), b.gold(2000), b.giveItem(0x58), b.giveItem(0xc6)];
    // TODO(E3-3): `FUN_1070_0464(0x1f, 180)` gives the map with 180 charges,
    // as Aminro's does with 178 (`villages.ts`); the engine gives it as the
    // scenario defines it.
    case 0x68:
      return [b.msg(0x56, 0xe), b.giveItem(0x1f)];
    case 0x69:
      return [b.msg(0x56, 0x11), b.giveItem(0x10a)];
    case 0x6a:
      return [b.msg(0x55, 0xc), b.setFlag(f(0xa83), 2)];
    // TODO(E3-3): the plate is `FUN_1070_0464(0x89, 77)`, 77 in the byte
    // that charges live in; what it means for armour is not known.
    case 0x6f:
      return [b.msg(0x58, 0x48), b.giveItem(0x89)];
    case 0x70:
      return [b.msg(0x58, 0x49, 0x4a), b.giveItem(0x89)];
    case 0x71:
      return [b.msg(0x56, 0x27), b.gold(500), b.giveItem(0x43)];
    // `FUN_10b0_1ff2`: `award_xp` to every living PC.
    case 0x78:
      return [b.msg(0x54, 0x24), b.xp(10)];
    case 0x79:
      return [b.msg(0x54, 0x28), b.giveItem(0x106)];
    // E3 tries `FUN_1070_0464` after a `FUN_1070_0564` that found no room,
    // which finds none either.
    case 0x7a:
      return [b.msg(0x54, 0x2e), b.giveItem(0x87)];
    case 0x7b:
      return [b.msg(0x55, 0x21), b.gold(400)];
    case 0x7c:
      return [b.msg(0x55, 0x22), b.gold(600), b.giveItem(0x12d)];
    case 0x7d:
      return [b.msg(0x51, 4), b.giveItem(0x15d)];
    case 0x8c:
      return [b.msg(0x50, 4), b.gold(600), ...[0x186, 0x185, 0x184, 0x4f, 0x97, 0xb8, 0x104].map((it) => b.giveItem(it))];
    case 0x8e:
      return [b.msg(0x50, 0x20), b.giveItem(0x150)];
    default:
      return null;
  }
}

/** Phase 2, running away (`10c0:0ac6`). */
function flee(b: SpecBuilder, script: number): Step[] | null {
  switch (script) {
    case 100:
      return [b.msg(0x58, 0xe), b.setFlag(f(0xbc5), 0)];
    case 0x6a:
      return [b.msg(0x55, 0xb), b.setFlag(f(0xa83), 3)];
    default:
      return null;
  }
}
