/**
 * Exile 3's smaller places, each a short switch of its own: one function
 * per town, named for it, with its E3 handler (FORMATS.md, "Town script
 * handlers") and message block.
 */

import { DamageType } from '../../../src/data/monster';
import { FieldType } from '../../../src/data/fields';
import { e3TownMessageBlock, type PlaceScript } from '../specials';
import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

/** Blackcrag Fortress (town 34): `FUN_1078_4918`, block 58. */
function blackcrag(b: SpecBuilder): Map<number, Step[]> {
  const B = 58, spot = (id: number) => townSpotFlag(34, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x23)]],
    [2, [b.onceMsg(spot(2), B, 0x24, 0x25)]],
    // The guards who let the party in were an ambush.
    [3, [b.msg(B, 0x28), b.bringIn(200, 1), b.setFlag(spot(3), 20)]],
    [11, [b.ifFlagEq(spot(9), 0, [b.setFlag(spot(9), 1), b.dialog(0xd0c)])]],
    [12, [b.msg(B, 0x22), b.blockMove()]],
    [14, [b.askDialog(0xd0d, [b.changeTown(0x3d, 5, 4)]), b.blockMove()]],
  ]);
}

/**
 * Which end of the Great Walls the party came in by: 0 not yet known, 1 west,
 * 2 east. E3 reads the party's outdoor zone column (party+0x12e2) instead,
 * which no node can; the first end column crossed after entering says the
 * same, since each town entrance lies outside its end's column. The town's
 * entry script clears it (`towns/entry.ts`).
 */
export const WALLS_SIDE: Flag = [291, 23];

/** The Great Walls (town 37): `FUN_1078_52ae`, block 59. */
function greatWalls(b: SpecBuilder): Map<number, Step[]> {
  const B = 59, spot = (id: number) => townSpotFlag(37, id);
  /** Erika's amulets break the walls open, once, if the story is ready (flags 0x262 and 0x263). */
  const amuletsReady = (then: Step[], otherwise: Step[] = []): Step =>
    b.ifSpecItem(partySpecItem(0x54), [b.ifFlagAtLeast(f(0x262), 3, [b.ifFlagEq(f(0x263), 0, then, otherwise)], otherwise)], otherwise);
  return new Map<number, Step[]>([
    [1, [amuletsReady([b.onceMsg(spot(1), B, 0x20)], [b.onceMsg(spot(1), B, 0x21)])]],
    [2, [amuletsReady([
      b.msg(B, 0x22), b.setTer(0x17, 0x20, 0), b.setTer(0x17, 0x1f, 0x8f), b.setTer(0x17, 0x21, 0x8f),
      b.setFlag(spot(2), 20), b.setFlag(spot(4), 20),
    ])]],
    ...[3, 5, 6].map((id): [number, Step[]] => [id, [b.trap(0xd2a, spot(id), 0x14)]]),
    [4, [b.onceMsg(spot(4), B, 0x23), ...[0, 1, 2, 3].map(() => b.wanderingMonster())]],
    // The two ends of the tunnel: out the far side, if the party came in by the other.
    [11, [b.onceMsg(spot(0), B, 0x1e, 0x1f), b.ifFlagEq(WALLS_SIDE, 0, [b.setFlag(WALLS_SIDE, 1)],
      [b.ifFlagEq(WALLS_SIDE, 2, [b.exitTo(3, 0, 8, 9)])])]],
    [12, [b.ifFlagEq(WALLS_SIDE, 0, [b.setFlag(WALLS_SIDE, 2)],
      [b.ifFlagEq(WALLS_SIDE, 1, [b.exitTo(7, 0, 0xd, 3)])])]],
    [14, [b.askDialog(0xd2b, [b.msg(B, 0x26), b.drainXp(10)])]],
    [15, [b.askDialog(0xd2b, [b.msg(B, 0x27), b.teachSpell(0x24)])]],
    [16, [b.ifTer(0x37, 0x1f, 0x8c, [
      b.msg(B, 0x28), ...[0x1f, 0x20, 0x21, 0xd].map((y) => b.setTer(0x37, y, 0x8d)),
    ])]],
  ]);
}

/**
 * The Portal Fortress (town 40): `FUN_1088_0000`, block 60. Its portal goes
 * down to the Tower of Magi once the party has done something about one of
 * the four plagues (flags 0xc85, 0xc87, 0xc8a, 0xc8c); after the demon plot
 * starts, to the overrun tower; and late in the war (0xc92) without special
 * item 6, somewhere else entirely.
 */
function portalFortress(b: SpecBuilder): Map<number, Step[]> {
  const B = 60;
  const demonPlot = f(0xc91), lateWar = f(0xc92);
  /** Seles's guards stop a party that has done nothing yet. */
  const toMagi = (): Step[] => [CLEARED_ANY.reduceRight<Step>(
    (inner, flag) => b.ifFlagEq(flag, 0, [inner], [b.msg(B, 0xa, 0xb), b.changeTown(24, 0xa, 0x26)]),
    b.msg(B, 8, 9))];
  const elsewhere = (): Step[] => [b.exitTo(7, 6, 0x2d, 3), b.changeTown(0x86, 0x14, 0x16)];
  /** Late in the war the portal leads elsewhere, unless the party has special item 6. */
  const unlessLate = (then: Step[]): Step =>
    b.ifFlagEq(lateWar, 0, then, [b.ifSpecItem(partySpecItem(0x18), then, elsewhere())]);
  const enter = b.switchFlag(demonPlot, [
    [unlessLate(toMagi())],
    [b.msg(B, 0xa, 0xb), b.changeTown(25, 1, 0x3e)], [b.msg(B, 0xa, 0xb), b.changeTown(25, 1, 0x3e)],
    [unlessLate([b.msg(B, 6, 7)])], [unlessLate([b.msg(B, 6, 7)])], [unlessLate([b.msg(B, 6, 7)])],
  ]);
  return new Map<number, Step[]>([
    // The self-destruct button.
    [1, [b.askDialog(0xd48, [b.msg(B, 4, 5), b.slayParty(2)], [b.msg(B, 3)])]],
    [2, [b.ifFlagEq(demonPlot, 0, [b.askDialog(0xd49, [enter])], [b.askDialog(0xd4a, [enter])]), b.blockMove()]],
    ...[14, 15, 16].map((id): [number, Step[]] => [id, [b.askDialog(0xd4b, [b.dialog(id + 0xd3e)])]]),
  ]);
}

/** Ghikra (town 41), the Vahnatai's diplomatic settlement: `FUN_1088_0586`, block 60. */
function ghikra(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(41, id);
  /** Rentar-Ihrno has shown herself (Tinraya, flag 0x225): the barriers let the party by. */
  const metRentar = f(0x225);
  return new Map<number, Step[]>([
    // 0 is below the switch's table: nothing.
    [0, []],
    [1, [b.onceMsg(spot(1), B, 0x2b, 0x2c)]],
    [2, [b.ifFlagEq(spot(2), 0, [b.setFlag(spot(2), 20), b.dialog(0xd54), b.bringIn(201, 1)])]],
    [3, [b.ifFlagEq(metRentar, 0, [b.msg(B, 0x2e), b.blockMove()])]],
    [4, [b.ifFlagEq(spot(4), 0, [b.setFlag(spot(4), 20), b.msg(B, 0x2f), b.bringIn(200, 1)])]],
    [9, [b.ifFlagEq(spot(9), 0, [b.msg(B, 0x27), b.blockMove()])]],
    [11, [b.askDialog(0xd52, [b.ifLevelTotal(15, [b.msg(B, 0x24), b.teachSpell(0x37)], [b.msg(B, 0x23)])])]],
    [12, [b.msg(B, 0x28), b.damageDice(20, 10, DamageType.MAGIC), b.blockMove()]],
    // The glowing door takes one.
    [14, [b.askDialog(0xd53, [b.splitParty(0x28, 0x25)]), b.blockMove()]],
    [15, [b.setTer(0x1d, 0x1d, 0x4b), b.setTer(0x1d, 0x1e, 0x4b), b.setTer(0x1e, 0x1d, 0x4b)]],
    [16, [b.msg(B, 0x30), b.reuniteParty(), b.blockMove()]],
    [17, [b.ifFlagEq(metRentar, 0, [b.msg(B, 0x25, 0x26)])]],
  ]);
}

/** New Formello (town 43): `FUN_1088_0ab5`, block 60. */
function newFormello(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(43, id);
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(spot(1), 0, [b.setFlag(spot(1), 20), b.msg(B, 0x39), b.bringIn(200, 1)])]],
    // A damp room to sleep in: one time in four, someone catches something.
    [2, [b.askDialog(0xd66, [
      b.msg(B, 0x3d, 0x3e), b.heal(0x1e), b.restoreSp(3), b.addAge(500),
      b.ifChance(25, [b.atRandomPc([b.disease(2)])]),
    ])]],
    [3, [b.onceMsg(spot(3), B, 0x3a, 0x3b)]],
  ]);
}

/** The Goblin Lair (town 44): `FUN_1088_0305`, block 60. */
function goblinLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(44, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0xd72, spot(1), 0xd0)]],
    [5, []],
    [11, [b.askDialog(0xd71, [b.changeTown(80, 0x1e, 0x1c)]), b.blockMove()]],
    [12, [b.askDialog(0xd70, [b.moveParty(7, 0xb)]), b.blockMove()]],
    [14, [b.askDialog(0xd73, [b.msg(B, 0x1a)])]],
  ]);
}

/** The Bandit Hideout (town 45): `FUN_1088_040d`, block 60. */
function banditHideout(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(45, id);
  return new Map<number, Step[]>([
    ...[1, 3, 4].map((id): [number, Step[]] => [id, [b.trap(0xd7b, spot(id), 0)]]),
    [2, [b.giveItemDialog(0xd7d, spot(2), 0, 331)]],
    [5, [b.trap(0xd7a, spot(5), 0x15)]],
    [11, [b.lever([b.msg(B, 0x1c), b.swapTer(9, 6, 0x6c, 0x6d), b.swapTer(9, 7, 0x6c, 0x6d)])]],
    [14, [b.askDialog(0xd71, [b.changeTown(80, 2, 1)]), b.blockMove()]],
    [15, [b.askDialog(0xd7e, [b.changeTown(80, 0x1e, 2)]), b.blockMove()]],
    [16, [b.dialog(0xd80)]],
    [17, [b.dialog(0xd81)]],
  ]);
}

/** The Agate Tower (town 46), the slime maker Jordan's: `FUN_1088_0c28`, block 60. */
function agateTower(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(46, id);
  const up = (x: number, y: number): Step[] => [b.askDialog(0xd7f, [b.changeTown(0x5a, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x3f, 0x40), b.bringIn(200, 1), b.setFlag(spot(1), 20)]],
    [2, [b.onceMsg(spot(2), B, 0x42, 0x43)]],
    // A dark altar: a monster the first time, then nothing (2: cracked).
    [3, [b.ifFlagEq(spot(3), 2, [b.msg(B, 0x6c)], [b.askDialog(0xd84, [b.ifFlagEq(spot(3), 1, [b.msg(B, 0x66)], [
      b.msg(B, 0x65), b.bringIn(201, 1), b.setFlag(spot(3), 1),
    ])])])]],
    [4, [b.trap(0xd7a, spot(4), 0x15)]],
    [5, [b.onceMsg(spot(5), B, 0x68, 0x69)]],
    // Jordan's notes put the Slime Pit (town 22) on the map (party+0x849b).
    [11, [b.dialog(0xd85), b.townVisible(22)]],
    [12, [b.log(0x1088, 0xc21), b.setTer(0xd, 0x21, 100)]],
    [14, up(0xd, 0xc)], [15, up(0x10, 0xf)], [16, up(0x10, 0x13)], [17, up(0x18, 0x1d)],
    [21, []],
    [20, [b.askDialog(0xd87, [b.ifLevelTotal(8, [b.msg(B, 0x6b), b.teachSpell(0x1a)], [b.msg(B, 0x6a)])])]],
  ]);
}

/** Erika's Tower (town 47): `FUN_1088_0f24`, block 60. */
function erikasTower(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(47, id);
  /** Erika's word that the party may take her amulets (flag 0x262): 2 once taken. */
  const erikaSaysYes = f(0x262);
  const lever = (squares: [number, number][]): Step[] =>
    [b.lever([b.msg(B, 0x74), ...squares.map(([x, y]) => b.swapTer(x, y, 0x7c, 0x7d))])];
  return new Map<number, Step[]>([
    // The pedestal's item; taking it wakes the tower.
    [1, [b.ifFlagEq(spot(1), 0, [
      b.giveItemDialog(0xd8f, spot(1), 0x163),
      b.ifFlagAtLeast(spot(1), 1, [b.setTer(0xa, 0x14, 0x75), b.setTer(1, 0x15, 0x76), b.bringIn(202, 1)]),
    ])]],
    // Erika's amulets (special item 36), only once she has said so.
    [2, [b.askDialog(0xd8f, [b.ifFlagAtLeast(erikaSaysYes, 1, [
      b.giveSpecItem(partySpecItem(0x54)), b.setFlag(spot(2), 20), b.setFlag(erikaSaysYes, 2),
    ], [b.msg(B, 0x6e)])])]],
    [3, [b.msg(B, 0x6f), b.placeField(3, 0x20, FieldType.FIELD_QUICKFIRE)]],
    [4, [b.bringIn(201, 1), b.setFlag(spot(4), 20)]],
    [5, [b.bringIn(200, 1), b.setFlag(spot(5), 20)]],
    [9, [b.msg(B, 0x70)]],
    [11, [b.e3Boom(0xf)]],
    [12, [b.msg(B, 0x71), b.moveParty(0x1b, 0x29)]],
    [14, [b.msg(B, 0x71), b.moveParty(0x20, 0x24)]],
    [15, lever([[0x10, 0x18], [0x10, 0x1a], [0x12, 0x1b]])],
    [16, lever([[0x20, 0x18], [0x20, 0x1a], [0x1e, 0x1b]])],
  ]);
}

/** Friendly, Happy Spiders (town 48): `FUN_1088_1231`, block 60. */
function spiders(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(48, id);
  return new Map<number, Step[]>([
    // A webbed-up roach: Free it (it attacks), or kill it (Attack).
    [1, [b.choiceDialog(0xd98,
      [b.setFlag(spot(1), 20), b.msg(B, 0x4c), b.bringIn(202, 1)],
      [b.setFlag(spot(1), 20), b.msg(B, 0x4d)])]],
    [2, [b.setFlag(spot(2), 20), b.msg(B, 0x50), b.bringIn(201, 1)]],
    [3, [b.dialog(0xd99), b.setFlag(spot(3), 20)]],
    [4, []], [5, []],
  ]);
}

/**
 * The Cult of the Sacred Item (town 49): `FUN_1088_1362`, block 60. Town 97,
 * the Subterranean Dock, shares the function; only its spot 11 is there.
 */
function sacredItem(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const B = e3TownMessageBlock(town), spot = (id: number) => townSpotFlag(town, id);
    const book: [number, Step[]] = [11, [b.askDialog(0x10f4, [b.dialog(0x10f5)])]];
    if (town !== 49) return new Map([book]);
    /** Clean hands, from the fountains 1–3, let the party past wards 14–16. */
    const washed = (fountain: number) => f(0x26d + fountain);
    /** The cultists' portal home: 1 found dead, 2 re-energised (spot 22). */
    const portal = spot(3);
    const orb = partySpecItem(0x18), marbleKey = partySpecItem(0x24);
    /** A padlocked door beside the spot (x + dx): the marble key opens it. */
    const padlock = (id: number, dx: number): Step => {
      const at = b.spotAt(id);
      return b.ifTer(at.x + dx, at.y, 106, [b.ifSpecItem(marbleKey,
        [b.msg(B, 0x7a), b.setTer(at.x + dx, at.y, 0x67)], [b.msg(B, 0x79)])]);
    };
    return new Map<number, Step[]>([
      [0, []], [89, []],
      ...[1, 2, 3].map((id): [number, Step[]] => [id, [b.choiceDialog(0xda2,
        [b.msg(B, 0x75)], [b.msg(B, 0x76), b.setFlag(washed(id), 1)])]]),
      [4, [b.trap(0x107e, spot(4), 4 + 0x11)]],
      [5, [b.giveItemDialog(0xda5, spot(5), 0, 306)]],
      [6, [b.giveItemDialog(0xda6, spot(6), 0x15c)]],
      [7, [b.giveItemDialog(0xda8, spot(7), 0, 308)]],
      [8, [b.onceMsg(spot(8), B, 0x7c)]],
      [9, [b.askDialog(0xda7, [b.giveSpecItem(marbleKey), b.setFlag(spot(9), 20)])]],
      book,
      // The cultists' portal: the Orb of Thralni first, then home once re-energised.
      [12, [b.ifFlagEq(portal, 1, [b.msg(B, 0x81)], [b.askDialog(0xda4, [b.ifSpecItem(orb, [
        b.ifFlagAtLeast(portal, 1, [
          // TODO(E3-3): journal entry 0x15.
          b.setFlag(f(0xc92), 3), b.msg(B, 0x80), b.exitTo(7, 8, 0x5c, 0x29), b.changeTown(0x2d, 0x1f, 4),
        ], [b.msg(B, 0x7e, 0x7f), b.setFlag(portal, 1), b.bringIn(200, 1)]),
      ], [b.msg(B, 0x7d)])])]), b.blockMove()]],
      ...[14, 15, 16].map((id): [number, Step[]] => [id, [b.ifFlagEq(washed(id - 13), 0,
        [b.msg(B, 0x77), b.damageAll(0x19, 3)], [b.msg(B, 0x78)])]]),
      [20, [padlock(20, 1)]], [23, [padlock(23, 1)]],
      [21, [padlock(21, -1)]], [24, [padlock(24, -1)]],
      [22, [b.askDialog(0xda3, [b.ifFlagEq(portal, 1, [b.msg(B, 0x7b), b.setFlag(portal, 2)], [b.log(0x1088, 0x1351)])])]],
    ]);
  };
}

/** The four plagues' flags: any set means the party has done something. */
const CLEARED_ANY = [f(0xc85), f(0xc87), f(0xc8a), f(0xc8c)];

export const DUNGEON_SCRIPTS = new Map<number, PlaceScript>([
  [34, blackcrag],
  [37, greatWalls],
  [40, portalFortress],
  [41, ghikra],
  [43, newFormello],
  [44, goblinLair],
  [45, banditHideout],
  [46, agateTower],
  [47, erikasTower],
  [48, spiders],
  [49, sacredItem(49)],
  [97, sacredItem(97)],
]);
