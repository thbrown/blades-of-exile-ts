/**
 * Exile III's `monst_radiate` (`1018:5a9c`), for a scenario with the flag
 * `radiate` = `exile3`. It runs where 1997's field and summon block does
 * (COMBAT.CPP:2120, after a creature acts, when it has a target it can see:
 * the call at `1018:5934`), but E3's creature record has no `radiate`
 * field, so E3 keys it off the special skill and, for the summoners, the
 * monster's number:
 *
 * - **Skills 22, 23 and 24** place fire walls, ice walls and antimagic
 *   **every time, with no roll**: fire and ice on the ring round the
 *   creature (`DS(10f8):0788`, the 3×3 with its middle empty), antimagic on
 *   the full 3×3 (`0736`). 1997's are `square` at a chance. The converter
 *   hands these over as `RADIATE` with E3's shape; this reads them from
 *   there, without the engine's chance roll.
 * - **Skill 35**, the Alien Slime (142), summons one of slimes 138–141 on a
 *   1 in 2. It is the only creature with skill 35, so it is done by number.
 * - **The Naga** (136) summons an Asp (100) on a 1 in 4; **the Dark Wyrm**
 *   (168) a Ghast (63) on a 1 in 5; **the Vahnatai Lord** (98) and
 *   **Rentar-Ihrno** (177) an Eyebeast or a Basilisk (102, 103) on a 1 in 5.
 *
 * A summon lasts 130 turns, takes the summoner's attitude, and when it lands
 * prints E3's own line and plays 61 (`FUN_1090_3f2c` returning 1).
 */

import type { FieldType } from '../data/fields';
import { MonstAbil } from '../data/monsterAbility';
import type { Creature } from '../universe/creature';
import { livingSound } from '../universe/living';
import { summonMonster } from './monsterPlace';
import type { GameSession } from './session';
import { placeSpellPattern } from './spellPatterns';

/** `[monster, odds max, roll that summons, first summoned, how many to pick from, line]`. */
const E3_SUMMONERS: readonly (readonly [number, number, number, number, number, string])[] = [
  [142, 1, 0, 138, 4, 'Alien slime summons aid.'],
  [136, 3, 1, 100, 1, 'Naga summons aid.'],
  [168, 4, 1, 63, 1, 'Dark Wyrm summons aid.'],
  [98, 4, 1, 102, 2, 'Vahnatai uses Soul Crystal.'],
  [177, 4, 1, 102, 2, 'Vahnatai uses Soul Crystal.'],
];

export async function e3Radiate(session: GameSession, monst: Creature): Promise<void> {
  const univ = session.univ;
  const radiate = monst.mon.abil[MonstAbil.RADIATE];
  if (radiate?.active) {
    await placeSpellPattern(session, radiate.radiate.pat, monst.curLoc, {
      field: radiate.radiate.type as FieldType,
      rot: monst.direction + 6,
      whoHit: 7,
    });
  }
  for (const [number, max, hit, first, choices, line] of E3_SUMMONERS) {
    if (monst.number !== number) continue;
    if (univ.rng.getRan(1, 0, max) !== hit) continue;
    const which = first + (choices > 1 ? univ.rng.getRan(1, 0, choices - 1) : 0);
    if (summonMonster(session, which, monst.curLoc, 130, monst.attitude, monst.isFriendly, true)) {
      univ.addStringToBuf(line);
      livingSound(61);
    }
  }
}
