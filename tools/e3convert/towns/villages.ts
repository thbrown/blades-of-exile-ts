/**
 * The villages' own switches, towns 121 to 177 (the ferries' two are in
 * `dungeons2.ts`). As there: one function per handler, named for a town it
 * serves, with its E3 handler (FORMATS.md, "Town script handlers"). The
 * message block is each town's own. Read from `ghidra/nedis.py`'s
 * disassembly. Towns 120, 130, 134, 136 and 167–170, 172 have no code: the
 * town switch (`FUN_10c0_0000`, table at 10c0:055f) skips them.
 */

import { e3TownMessageBlock, type PlaceScript } from '../specials';
import { partyFlag as f, townSpotFlag, type SpecBuilder, type Step } from '../script';

/** Monsters that come when a village is attacked (`FUN_1090_4053(200, 1)`). */
const RAIDERS = 0xc8;

const on = (t: number) => ({ B: e3TownMessageBlock(t), spot: (id: number) => townSpotFlag(t, id) });

/** A day test as E3 writes it, `FUN_10d0_54b8(day, event)`. */
function ifDay(b: SpecBuilder, day: number, event: number, then: Step[], otherwise: Step[] = []): Step {
  return b.ifE3DayReached(day, event, then, otherwise);
}

/** Delis (121): `FUN_10b8_0dc4`. Spot 1 is the package the party is sent for. */
function delis(b: SpecBuilder): Map<number, Step[]> {
  const { B } = on(121);
  return new Map<number, Step[]>([
    [0, []],
    // Only once Pergies's courier job (122, 0) is taken.
    [1, [b.ifFlagEq(f(0x548), 0, [], [b.askDialog(0x1072, [
      b.setFlag(f(0x549), 1), b.setFlag(f(0x53f), 20),
      // From E3's day 60 it is just "You get the package." (10b8:0daf);
      // before, the pouch is trapped: a shriek, the town turns, and the
      // secret doors change.
      ifDay(b, 0x3c, 0, [b.log(0x10b8, 0xdaf)], [
        b.msg(B, 5), b.makeTownHostile(), b.setTer(0x13, 0xa, 0x67), b.setTer(0x15, 8, 0x64),
      ]),
    ])])]],
  ]);
}

/** Pergies (122): `FUN_10b8_0e93`. */
function pergies(b: SpecBuilder): Map<number, Step[]> {
  const { B, spot } = on(122);
  return new Map<number, Step[]>([
    [2, [b.trap(0x107c, spot(2), 0)]],
    [3, [b.trap(0x107c, spot(3), 0)]],
    [4, [b.trap(0x107d, spot(4), 0xb)]],
    [5, [b.trap(0x107d, spot(5), 0xb)]],
    [6, [b.onceMsg(spot(6), B, 6, 7)]],
  ]);
}

/** The Inn of Blades (123): `FUN_10b8_10eb`, trapped boxes. */
function innOfBlades(b: SpecBuilder): Map<number, Step[]> {
  const { spot } = on(123);
  return new Map<number, Step[]>([
    [1, [b.trap(0x107d, spot(1), 0x14)]],
    [2, [b.trap(0x107d, spot(2), 0)]],
    [3, [b.trap(0x107d, spot(3), 0xb)]],
    [4, []], [5, []],
  ]);
}

/** Silvar (124): `FUN_10b8_0f46`. */
function silvar(b: SpecBuilder): Map<number, Step[]> {
  const { B, spot } = on(124);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0xa)]],
    // Until E3's day 70, a message and the step is refused.
    [11, [ifDay(b, 0x46, 0, [], [b.msg(B, 0xc), b.blockMove()])]],
  ]);
}

/** Colchis (125): `FUN_10b8_0ff1`. Two gifts once (125, 8) is set. */
function colchis(b: SpecBuilder): Map<number, Step[]> {
  const { spot } = on(125);
  const gift = f(0x56e);
  return new Map<number, Step[]>([
    [1, [b.ifFlagAtLeast(gift, 1, [b.giveItemDialog(0x1090, spot(1), 0x178)])]],
    [2, [b.ifFlagAtLeast(gift, 1, [b.giveItemDialog(0x1091, spot(2), 0x175)])]],
  ]);
}

/**
 * Farport (126): `FUN_10b8_1341`. Two paid crossings, to Port Townsend (127)
 * and to Sharimik (8). E3 ages the party and clears the fare before it moves
 * it, the other way round from the ferries' switch.
 */
function farport(b: SpecBuilder): Map<number, Step[]> {
  const { B } = on(126);
  const toTownsend = f(0x578), toSharimik = f(0x579);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0xcbc, [b.dialog(0xcbd)])]],
    [2, [b.ifFlagEq(toTownsend, 0, [b.msg(B, 0x12)], [b.askDialog(0xcbe, [
      b.addAge(800), b.setFlag(toTownsend, 0), b.msg(B, 0x13), b.exitTo(0, 6, 0x20, 0x26), b.changeTown(0x7f, 0x18, 0x2b),
    ])]), b.blockMove()]],
    // E3's shareware build stops here with "You need to be registered."
    // (10b8:1326); the registered game, which this is, goes on. The crossing
    // needs Sharimik open, (307, 3) or (307, 5).
    [3, [b.ifFlagEq(toSharimik, 0, [b.msg(B, 0x12)], [b.askDialog(0xcbf, [
      b.addAge(800), b.setFlag(toSharimik, 0),
      b.ifFlagEq(f(0xc85), 0, [b.ifFlagEq(f(0xc87), 0, [b.msg(B, 0x19)], [sharimik()])], [sharimik()]),
    ])]), b.blockMove()]],
    [4, []], [5, []],
  ]);
  function sharimik(): Step {
    return b.seq([b.msg(B, 0x13), b.exitTo(3, 6, 0x18, 0x1e), b.changeTown(8, 0xe, 0x20)]);
  }
}

/** Marish (128) and towns 156–158: `FUN_10b8_3077`. */
function marish(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    return new Map<number, Step[]>([
      [1, [b.giveItemDialog(0x11d0, spot(1), 0x104)]],
      [2, [b.trap(0x107c, spot(2), 0x14)]],
      [3, [b.trap(0x107d, spot(3), 0x14)]],
      [4, [b.bringIn(RAIDERS, 1), b.msg(B, 0x14, 0x15), b.setFlag(f(0x6aa), 20)]],
      // 25 food.
      [5, [b.giveItemDialog(0x11e4, spot(5), 0, 1025)]],
      [6, [b.onceMsg(spot(6), B, 0x1c)]],
      ...[7, 8, 9, 10, 13, 14].map((id): [number, Step[]] => [id, []]),
      [11, [b.dialog(0x11e5)]],
      [12, [b.dialog(0x11e6)]],
      // The ferry to Shayder (4) for 10 gold. E3 takes the gold itself, where
      // the engine's node also says "You give up 10 gold."
      [15, [b.askDialog(0x10b8, [b.pay(10, [
        b.msg(B, 0x1d), b.exitTo(0, 6, 0xb, 0x1a), b.changeTown(4, 7, 0x2a), b.addAge(800),
      ], [b.log(0x10b8, 0x3066)])]), b.blockMove()]],
    ]);
  };
}

/** Softport (133), Gidrik (137) and towns 147–149 (Squiggus): `FUN_10b8_2549`. */
function softport(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    return new Map<number, Step[]>([
      // Gidrik's horses 4–6, sold in conversation (137, 9), are the party's
      // for nothing from E3's day 200 (their `property` bytes, party+0x6a99).
      [1, [ifDay(b, 0xc8, 2, [b.giveHorse(4), b.giveHorse(5), b.giveHorse(6)])]],
      [2, [b.giveItemDialog(0x10ea, spot(2), 0xd3)]],
      // An ambush: every PC slowed and cursed by 8.
      [3, [
        b.setFlag(f(0x659), 20), b.msg(B, 0x14, 0x15), b.bringIn(RAIDERS, 1), b.slow(8), b.curse(8),
      ]],
      [4, [b.onceMsg(spot(4), B, 0x16)]],
      [5, [b.trap(0x107d, spot(5), 0)]],
      ...[6, 7, 8, 9, 10].map((id): [number, Step[]] => [id, []]),
      // The ferry to Fenris Port (132); E3 leaves the fare (133, 9) set.
      [11, [b.ifFlagEq(f(0x5bf), 0, [b.msg(B, 0x12)], [b.askDialog(0x10eb, [
        b.msg(B, 0x13), b.exitTo(2, 5, 0x13, 0x20), b.changeTown(0x84, 0x2a, 0x18), b.addAge(800),
      ])]), b.blockMove()]],
    ]);
  };
}

/** Golddale (138) and towns 139–141: `FUN_10b8_1dbe`. */
function golddale(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    return new Map<number, Step[]>([
      [1, [b.onceMsg(spot(1), B, 0xe)]],
      [2, [b.trap(0x107c, spot(2), 0)]],
      [3, [b.trap(0x107c, spot(3), 0xb)]],
      [4, [b.trap(0x107d, spot(4), 0)]],
      [5, [b.giveItemDialog(0x111c, spot(5), 0xcf)]],
      [6, [b.trap(0x107e, spot(6), 0x14)]],
      [7, [b.trap(0x107c, spot(7), 0xb)]],
      [8, []],
      // Libras's (141) ferry to town 142, fare (141, 1).
      [9, [b.ifFlagEq(f(0x607), 0, [b.msg(B, 3)], [b.askDialog(0x113a, [
        b.setFlag(f(0x607), 0), b.msg(B, 2), b.exitTo(5, 8, 0x20, 0x33), b.changeTown(0x8e, 0x18, 6), b.addAge(400),
      ])]), b.blockMove()]],
    ]);
  };
}

/** Aminro (146): `FUN_10b8_2761`. */
function aminro(b: SpecBuilder): Map<number, Step[]> {
  const { B, spot } = on(146);
  return new Map<number, Step[]>([
    ...[1, 2, 3, 4, 5].map((id): [number, Step[]] => [id, [b.trap(0x107c, spot(id), 0xb)]]),
    [6, [ifDay(b, 0x6e, 2, [], [b.onceMsg(spot(6), B, 0x12)])]],
    // `FUN_1070_0464(0x1f, 0xb2)`: the smeared map (`notes.ts`).
    [7, [b.askDialog(0x116c, [b.giveItem(b.note(31, 0xb2)), b.setFlag(f(0x63f), 20)])]],
  ]);
}

/** Bengaro (150) to the Isolated Inn (155): `FUN_10b8_2bf3`, whose inn has a switch of its own. */
function bengaro(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    if (t === 155) {
      return new Map<number, Step[]>([
        [1, [b.askDialog(0x1198, [b.dialog(0x1199), b.bringIn(RAIDERS, 1), b.setFlag(f(0x693), 20)])]],
        // Once the item is taken the inn leaves the map (party+0x8520,
        // `can_find_town[155]`).
        [2, [b.ifFlagAtLeast(f(0x693), 1, [b.giveItemDialog(0x1197, spot(2), 0x13a),
          b.ifFlagAtLeast(spot(2), 1, [b.townVisible(155, false)])])]],
      ]);
    }
    return new Map<number, Step[]>([
      [1, [b.askDialog(0x1194, [b.msg(B, 2), b.bringIn(RAIDERS, 1), b.setFlag(f(0x661), 20)])]],
      [2, [b.giveItemDialog(0x1195, spot(2), 0xc7), b.ifFlagAtLeast(spot(2), 1, [b.msg(B, 3)])]],
      ...[3, 4, 5].map((id): [number, Step[]] => [id, [b.trap(0x107e, spot(id), 0x14)]]),
      [6, [b.trap(0xd7a, spot(6), 0x14)]],
      [7, [b.giveItemDialog(0x1196, spot(7), 0xa2)]],
      // Above the switch's table: nothing.
      [8, []],
    ]);
  };
}

/** Towns 159–162 (Mernia, Greendale): `FUN_10b8_382d`. */
function mernia(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    return new Map<number, Step[]>([
      [1, [b.onceMsg(spot(1), B, 1)]],
      [2, [ifDay(b, 0xd2, 3, [], [b.msg(B, 4, 5), b.bringIn(RAIDERS, 1), b.setFlag(f(0x6d0), 20)])]],
      [3, []],
      [4, [b.giveItemDialog(0x120c, spot(4), 0x13d)]],
      [5, []],
    ]);
  };
}

/** Tevrono (163) and Moon (171): `FUN_10b8_3b6e`. Moon's books teach a party of high enough level. */
function tevrono(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    /** A book: living PCs whose levels add up to `level` learn `lesson`; others hear string 2. */
    const book = (level: number, msg: number, lesson: Step[]): Step[] =>
      [b.ifLevelTotal(level, [b.msg(B, msg), ...lesson], [b.msg(B, 2)])];
    return new Map<number, Step[]>([
      [1, [b.trap(0x107d, spot(1), 0xb)]],
      [2, [b.trap(0x107c, spot(2), 0x14)]],
      [3, [b.giveItemDialog(0x1266, spot(3), 0x12c)]],
      [4, [b.ifFlagEq(f(0x73b), 0, [b.msg(B, 1), b.blockMove()])]],
      [5, [b.onceMsg(spot(5), B, 0x10, 0x11)]],
      // A bed in the abandoned inn.
      [6, [b.askDialog(0x1216, [b.msg(B, 0x12), b.heal(200), b.restoreSp(100), b.addAge(500)])]],
      ...[7, 8, 9, 10, 11, 12, 13].map((id): [number, Step[]] => [id, []]),
      [14, book(0xe, 3, [b.teachSpell(0x35)])],
      [15, book(0x10, 4, [b.teachSpell(0x8c)])],
      [16, book(9, 5, [b.teachSpell(6)])],
      // Party+0x8328 is alchemy recipe 10.
      [17, book(0xc, 6, [b.learnAlchemy(10)])],
      [18, book(0x14, 7, [b.teachSpell(0x9a)])],
    ]);
  };
}

/** Execa (164) and towns 165–166 (Torria): `FUN_10b8_3a04`. */
function execa(t: number): PlaceScript {
  return (b) => {
    const { B } = on(t);
    return new Map<number, Step[]>([
      [1, [b.msg(B, 0xc), b.bringIn(RAIDERS, 1), b.setFlag(f(0x701), 20)]],
      [2, [b.msg(B, 0xd), b.ifLevelTotal(0xf, [b.msg(B, 0xe), b.teachSpell(0x9c)], [b.msg(B, 0xf)])]],
      ...[3, 4, 5, 6, 7, 8, 9, 10].map((id): [number, Step[]] => [id, []]),
      // Rowing away from the island, to Gale (16).
      [11, [b.askDialog(0x1220, [
        b.addAge(500), b.msg(B, 8), b.exitTo(5, 2, 0x47, 0x3a), b.changeTown(0x10, 0x24, 0x37),
      ]), b.blockMove()]],
    ]);
  };
}

/** Erox (173): `FUN_10b8_41f4`. (173, 9) is set once the villagers have turned. */
function erox(b: SpecBuilder): Map<number, Step[]> {
  const { B, spot } = on(173);
  const turned = f(0x74f);
  /** The ambush: (173, 2) and (173, 4) done, the raiders in, creature 9 gone. */
  const ambush = [
    b.setFlag(turned, 1), b.setFlag(f(0x748), 20), b.setFlag(f(0x74a), 20), b.bringIn(RAIDERS, 1),
    b.removeCreatureSlots([9]),
  ];
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x127a, spot(1), 0x8e)]],
    // Drugged: every PC slowed by 8 and put to sleep for 6.
    [2, [b.askDialog(0x127b, [b.msg(B, 0x15), ...ambush, b.slow(8), b.sleep(6)])]],
    // A bed that kills the party unless it has already found them out.
    [3, [b.askDialog(0x127c, [b.ifFlagEq(turned, 0, [b.msg(B, 0x16), b.slayParty(2)], [
      b.msg(B, 0x17), b.heal(80), b.restoreSp(40), b.addAge(500),
    ])])]],
    [4, [b.msg(B, 0x19), ...ambush]],
    [5, [b.trap(0x127d, spot(5), 0x14)]],
    [6, [b.ifFlagEq(turned, 0, [b.msg(B, 0x1a)], [b.msg(B, 0x1b)])]],
  ]);
}

/** Manara (174) to Wyvern Pass (177): `FUN_10b8_3fc5`. */
function manara(t: number): PlaceScript {
  return (b) => {
    const { B, spot } = on(t);
    /** A rune the Empire's wizards left: the second step on it sets it off, and three squares become terrain 2. */
    const walls = (flag: number, sq: [number, number][]): Step[] => [b.ifFlagEq(f(flag), 0, [b.incFlag(f(flag))], [
      b.msg(B, 0x11, 0x12), ...sq.map(([x, y]) => b.setTer(x, y, 2)), b.setFlag(f(flag), 20),
    ])];
    return new Map<number, Step[]>([
      [1, [b.trap(0xd7a, spot(1), 0x14)]],
      [2, [b.msg(B, 0x10), b.bringIn(RAIDERS, 1), b.setFlag(spot(2), 20)]],
      // Dellskeep (176, 3) and Wyvern Pass (177, 4).
      [3, walls(0x767, [[0x14, 0x28], [0x14, 7], [0x28, 0x14]])],
      [4, walls(0x772, [[0x1c, 0x28], [7, 0x1b], [0x28, 0x14]])],
      ...[5, 6, 7, 8, 9, 10].map((id): [number, Step[]] => [id, []]),
      [11, [b.ifLevelTotal(0x14, [b.msg(B, 0xd), b.teachSpell(0x88), b.teachSpell(0x89)], [b.msg(B, 0xe)])]],
    ]);
  };
}

export const VILLAGE_SCRIPTS = new Map<number, PlaceScript>([
  // Delan has a spot but no code.
  [120, () => new Map<number, Step[]>([[1, []]])],
  [121, delis],
  [122, pergies],
  [123, innOfBlades],
  [124, silvar],
  [125, colchis],
  [126, farport],
  ...[128, 156, 157, 158].map((t): [number, PlaceScript] => [t, marish(t)]),
  ...[133, 137, 147, 148, 149].map((t): [number, PlaceScript] => [t, softport(t)]),
  ...[138, 139, 140, 141].map((t): [number, PlaceScript] => [t, golddale(t)]),
  [146, aminro],
  ...[150, 151, 152, 153, 154, 155].map((t): [number, PlaceScript] => [t, bengaro(t)]),
  ...[159, 160, 161, 162].map((t): [number, PlaceScript] => [t, mernia(t)]),
  ...[163, 171].map((t): [number, PlaceScript] => [t, tevrono(t)]),
  ...[164, 165, 166].map((t): [number, PlaceScript] => [t, execa(t)]),
  [173, erox],
  ...[174, 175, 176, 177].map((t): [number, PlaceScript] => [t, manara(t)]),
]);
