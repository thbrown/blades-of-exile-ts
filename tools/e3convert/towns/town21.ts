/**
 * Fort Emergence (town 21), the game's first town: `FUN_1078_0b66`, and
 * Anaximander's reports in `FUN_1078_0ee6` (`ghidra/project/fort.s`,
 * `anax.s`). Flags are named by their party-record offsets, as the
 * disassembly has them.
 */

import { partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';

const TOWN = 21;
/** The fort's message block, `21 / 5 + 52`. */
const BLOCK = 56;
/** Anaximander's reports, `FUN_1008_386f`. */
const ANAX = 14;
/** The engine's Mage Lore, skill 11 as in E3's PC record. */
const MAGE_LORE = 11;
/** Special items 7 and 23/24 live at party+0x1a, +0x3a and +0x3c. */
const AMULET = partySpecItem(0x1a);
const PRAZAC_SCROLL = partySpecItem(0x3a);
const ANAX_SCROLL = partySpecItem(0x3c);

/** Anaximander's office (spot 1): the first briefing, then every report. */
function anaximander(b: SpecBuilder): Step[] {
  const report = (flag: number, a: number, bb = 0, ...after: Step[]) =>
    b.ifFlagEq(f(flag), 1, [b.msg(ANAX, a, bb), ...after, b.setFlag(f(flag), 2)]);
  return [
    // TODO(E3-3): E3 also adds journal entries here (`FUN_1008_3780`, 2 and
    // 0x11); the engine has no events journal yet.
    b.ifFlagEq(f(0xc82), 0, [b.dialog(0x802), b.msg(ANAX, 1), b.setFlag(f(0xc82), 2)]),
    report(0xc83, 2, 3),
    report(0xc84, 4, 5),
    report(0xc85, 6, 7, b.msg(ANAX, 8, 9), b.setFlag(f(0xc9a), 1)),
    report(0xc86, 10),
    report(0xc87, 11, 0, b.setFlag(f(0xc9a), 1), b.setFlag(f(0xc9c), 1)),
    report(0xc88, 12, 13),
    report(0xc89, 14, 15),
    report(0xc8a, 16, 17, b.setFlag(f(0xc9c), 1), b.setFlag(f(0xc9a), 1)),
    report(0xc8b, 18, 19),
    report(0xc8c, 20, 21, b.setFlag(f(0xc9a), 1), b.setFlag(f(0xc9c), 1)),
    report(0xc8d, 22),
    report(0xc8e, 23, 24),
    // Prazac's scroll: delivered by flag or by carrying it in.
    ...(() => {
      const deliver = [
        b.msg(ANAX, 0x2b, 0x2c), b.msg(ANAX, 0x2d, 0x2e),
        b.takeSpecItem(PRAZAC_SCROLL), b.giveSpecItem(ANAX_SCROLL),
        b.addAge(2500), b.setFlag(f(0xc94), 2),
      ];
      return [b.ifFlagEq(f(0xc94), 1, deliver, [b.ifSpecItem(PRAZAC_SCROLL, deliver)])];
    })(),
    report(0xc8f, 0x19, 0x1a),
    b.ifFlagAtLeast(f(0xc90), 1, [b.setFlag(f(0x23b), 1)]),
    // A counter that has moved on since the last visit gets its message.
    b.ifFlagGreater(f(0xc90), f(0xc9f), [
      b.ifFlagEq(f(0xc90), 1, [b.msg(ANAX, 0x1c)]),
      b.ifFlagEq(f(0xc90), 2, [b.msg(ANAX, 0x1d)]),
      b.ifFlagEq(f(0xc90), 3, [b.msg(ANAX, 0x1e)]),
      b.ifFlagEq(f(0xc90), 4, [b.msg(ANAX, 0x1f)]),
      b.ifFlagEq(f(0xc90), 5, [b.msg(ANAX, 0x20), b.incFlag(f(0xc90))]),
      b.copyFlag(f(0xc9f), f(0xc90)),
    ]),
    b.ifFlagEq(f(0xc91), 1, [b.msg(ANAX, 0x21, 0x22), b.msg(ANAX, 0x23), b.incFlag(f(0xc91))],
      [b.ifFlagEq(f(0xc91), 3, [b.msg(ANAX, 0x24, 0x25), b.incFlag(f(0xc91))])]),
    b.ifFlagEq(f(0xc92), 1, [b.msg(ANAX, 0x26, 0x27), b.incFlag(f(0xc92))],
      [b.ifFlagEq(f(0xc92), 3, [b.msg(ANAX, 0x28), b.incFlag(f(0xc92))])]),
    report(0xc93, 0x29, 0x2a, b.msg(ANAX, 0x48), b.setFlag(f(0x225), 1)),
    report(0xc95, 0x2f, 0x30),
    report(0xc96, 0x31, 0x32),
    report(0xc97, 0x33, 0x34),
    // Reminders once enough days have gone by without word (`calc_day() > n`).
    b.ifFlagEq(f(0xc98), 0, [b.ifFlagEq(f(0xc95), 0, [b.ifDayReached(51, [b.msg(ANAX, 0x35), b.setFlag(f(0xc98), 2)])])]),
    b.ifFlagEq(f(0xc99), 0, [b.ifFlagEq(f(0xc95), 0, [b.ifDayReached(151, [b.msg(ANAX, 0x36), b.setFlag(f(0xc99), 2)])])]),
    b.ifFlagEq(f(0xc9a), 1, [
      b.ifFlagEq(f(0xc91), 0, [b.msg(ANAX, 0x37), b.setFlag(f(0xc9a), 2)],
        [b.ifFlagAtLeast(f(0xc91), 3, [b.msg(ANAX, 0x3b), b.setFlag(f(0xc9a), 2)])]),
    ]),
    b.ifFlagEq(f(0xc9b), 0, [b.msg(ANAX, 0x38), b.setFlag(f(0xc9b), 2)]),
    b.ifFlagEq(f(0xc9c), 1, [b.ifSpecItem(AMULET, [], [
      b.msg(ANAX, 0x39, 0x3a), b.setFlag(f(0xc9c), 0), b.giveSpecItem(AMULET),
    ])]),
    report(0xc9e, 0x3c, 0x3d),
    b.ifFlagEq(f(0xac), 3, [b.ifFlagEq(f(0x10f), 0, [b.msg(0x36, 0x11), b.setFlag(f(0x10f), 1)])]),
    b.ifFlagEq(f(0x105), 1, [b.msg(0x36, 0xb), b.setFlag(f(0x105), 2)]),
  ];
}

export function town21(b: SpecBuilder): Map<number, Step[]> {
  const spot = (id: number) => townSpotFlag(TOWN, id);
  return new Map<number, Step[]>([
    [1, anaximander(b)],
    // A bookshelf with something on it.
    [2, [b.giveItemDialog(0x803, spot(2), 0x192)]],
    // TODO(E3-3): 3, a trapped chest (`FUN_10e0_03ae`, trap 7, dialog 0x805).
    // 4: the way is barred until the flag is set.
    [4, [b.ifFlagAtLeast(spot(4), 1, [b.msg(BLOCK, 0x10)], [b.msg(BLOCK, 0xe, 0xf), b.blockMove()])]],
    [5, [b.onceMsg(spot(5), BLOCK, 0x13)]],
    [6, [b.onceMsg(spot(6), BLOCK, 4)]],
    // 11 and 12: the north gate comes out on the surface, and the south one
    // in the caves. E3 only moves the party when it came in from the other
    // side (by the zone it was in); each target is the fort's own entrance on
    // that side, so moving it regardless comes to the same thing.
    [11, [b.exitTo(1, 8, 20, 25)]],
    [12, [b.exitTo(7, 8, 84, 84)]],
    // 14 and 15: runes that teach a mage or priest spell to a party with
    // enough Mage Lore between them (`FUN_10b0_302f` totals skill 11).
    ...([14, 15] as const).map((id): [number, Step[]] => [id, [b.askDialog(0x809, [
      b.ifSkillTotal(MAGE_LORE, 7, [b.msg(BLOCK, id - 3), b.teachSpell(id === 14 ? 9 : 0x6a)], [b.msg(BLOCK, 10)]),
    ])]]),
    // 16: a lever (`FUN_10e0_09e5`: dialog 0x3fc, then the lever itself
    // flips between 243 and 244), which works five portcullises.
    // TODO(E3-3): E3 plays sound 94 as it goes.
    [16, [b.askDialog(0x3fc, [
      b.swapTer(57, 52, 243, 244),
      b.ifTer(57, 52, 243, [b.msg(BLOCK, 0x15)], [b.msg(BLOCK, 0x16)]),
      ...[[58, 53], [58, 56], [58, 58], [52, 55], [54, 55]].map(([x, y]) => b.swapTer(x!, y!, 0x7c, 0x7d)),
    ])]],
    // 17: the beds.
    [17, [b.askDialog(0x806, [b.msg(BLOCK, 0x17), b.heal(200), b.restoreSp(100), b.addAge(500)])]],
    [18, [b.ifFlagAtLeast(f(0xc8c), 1, [b.msg(BLOCK, 6)])]],
  ]);
}
