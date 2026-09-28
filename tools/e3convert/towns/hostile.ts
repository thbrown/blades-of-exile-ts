/**
 * What Exile 3 does as a town turns on the party, beyond BoE's: the town
 * cases at the end of its `make_town_hostile`, `FUN_1070_23b9`, which become
 * each town's `<onoffend>` node. The engine runs it wherever the town turns
 * (a blow at a friendly, an END_ALARM reply, a script), as E3 calls the one
 * function from all of them.
 *
 * BoE 1997's `make_town_hostile` (ITEMS.CPP:818) still has E3's `fry_party`
 * and a "wedge in special" comment where these cases were: every PC's
 * `main_status` set to 0 and the stat window to 6. That is `killParty`.
 *
 * - Fort Emergence (21) and Portal Fortress (40): the guards haul the party
 *   off (60:0x13), and it ends.
 * - Ghikra (41): the walls burn (60:0x31), and it ends.
 * - Blackcrag Fortress (34): the guards converge (58:0x27), and it ends.
 * - Erika's Tower (47): the flames (60:0x72) end it, unless the party has
 *   the amulets (special item 32, party+0x4c), which say so (60:0x73).
 * - Drake Aerie (107), once (party+0x4b9): the drake's traps (dialog 0xfe7)
 *   paralyse, sleep, slow and curse each PC.
 * - Castle Troglo (28): Vothkaro's story goes to 7, the war (0x1a4), two
 *   flags to 20, and everyone to attitude 3. E3 makes that 3 in its first
 *   loop too; here BoE's pass makes it 1, and the node sets it again.
 *
 * E3 tests "in town or in combat" before each case; the engine runs the node
 * only in a town.
 */

import { partyFlag as f, partySpecItem, type SpecBuilder, type Step } from '../script';
import type { EntryScript } from '../specials';

const fatal = (b: SpecBuilder, block: number, i: number): Step[] => [b.msg(block, i), b.killParty()];

export const HOSTILE_SCRIPTS = new Map<number, EntryScript>([
  [21, (b) => fatal(b, 0x3c, 0x13)],
  [40, (b) => fatal(b, 0x3c, 0x13)],
  [41, (b) => fatal(b, 0x3c, 0x31)],
  [34, (b) => fatal(b, 0x3a, 0x27)],
  [47, (b) => [b.msg(0x3c, 0x72), b.ifSpecItem(partySpecItem(0x4c), [b.msg(0x3c, 0x73)], [b.killParty()])]],
  [107, (b) => [b.ifFlagEq(f(0x4b9), 0, [
    b.dialog(0xfe7),
    b.eachPc(() => [b.paralyze(5), b.sleep(5), b.slow(8), b.curse(8)]),
    b.setFlag(f(0x4b9), 1),
  ])]],
  [28, (b) => [
    b.setFlag(f(0x1a4), 7), b.setFlag(f(0x1a1), 20), b.setFlag(f(0x19f), 20), b.everyoneAttitude(3),
  ]],
]);
