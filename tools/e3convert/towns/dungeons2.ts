/**
 * Exile 3's places from town 90 to 111, and the two switches that the
 * villages' ferries share with them (`ferries`, `boatmen`). As in
 * `dungeons.ts`: one function per town, named for it, with its E3 handler
 * (FORMATS.md, "Town script handlers") and message block. Read from
 * `ghidra/nedis.py`'s disassembly.
 */

import { FieldType } from '../../../src/data/fields';
import { E3_TER_255_ALL } from '../tables';
import { Skill } from '../../../src/universe/skills';
import { e3DailyFlag } from '../flags';
import { e3TownMessageBlock, type PlaceScript } from '../specials';
import { partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';
import { ANAMA } from './shayder';

/** A Leave/Climb stair (`FUN_10c0_4a61` behind a dialog); the step is refused either way. */
function stair(b: SpecBuilder, dlg: number, t: number, x: number, y: number): Step[] {
  return [b.askDialog(dlg, [b.changeTown(t, x, y)]), b.blockMove()];
}

/** A bed: 200 health, 100 spell points, and `age` ticks gone. */
function bed(b: SpecBuilder, B: number, msg: number, age: number): Step[] {
  return [b.msg(B, msg), b.heal(200), b.restoreSp(100), b.addAge(age)];
}

/** The Agate Tower's grounds (town 90): `FUN_10b8_0b0c`, block 65. The tower itself is 46. */
function agateGrounds(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(90, id);
  /** The lever (spot 12) flips it; while it is 0 the trapdoor (spot 18) is live and the portcullis (spot 4) falls. */
  const lever = spot(9);
  return new Map<number, Step[]>([
    // A bag of silver in a tree.
    [1, [b.msg(B, 1), b.gold(100), b.setFlag(spot(1), 20)]],
    [2, [b.onceMsg(spot(2), B, 4)]],
    [3, [b.onceMsg(spot(3), B, 5)]],
    [4, [b.ifFlagEq(lever, 0, [b.ifTer(0x10, 0xb, 0x6d, [
      b.setTer(0x10, 0xb, 0x6c), b.setTer(0x11, 0xb, 0x6c), b.msg(B, 6),
    ])])]],
    // The secret door shuts behind the party.
    [11, [b.ifTer(7, 0x1b, 0x64, [], [b.setTer(7, 0x1b, 0x64), b.msg(B, 2)])]],
    [12, [b.lever([b.ifFlagEq(lever, 0, [b.setFlag(lever, 1)], [b.setFlag(lever, 0)]), b.msg(B, 8)])]],
    [14, stair(b, 0xd7e, 0x2e, 7, 2)],
    [15, stair(b, 0xd7e, 0x2e, 0x17, 0x17)],
    [16, stair(b, 0xd7e, 0x2e, 0x17, 0x1c)],
    [17, stair(b, 0xd7e, 0x2e, 0x29, 0x15)],
    // The trapdoor drops the party into the tower's chute.
    [18, [b.ifFlagEq(lever, 0, [b.msg(B, 3), b.changeTown(0x2e, 0x13, 0x10)])]],
  ]);
}

/** The Anama Temple's upper level (town 91), above Shayder: `FUN_10b8_18cc`, block 65. */
function anamaTemple(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(91, id);
  /**
   * The prayer books (spots 14–17): members with a total level of at least
   * 7 × k learn priest spells 30 + 8k to 34 + 8k. Anyone else is
   * dumbfounded, 7 each; E3 writes the status outright, where the engine's
   * `dumbfound` allows a saving roll.
   */
  const book = (k: number): Step[] => [b.askDialog(0xf47, [b.ifFlagEq(ANAMA, 3, [
    b.ifMageLoreTotal(7 * k, [b.msg(B, 0xe), ...[0, 1, 2, 3, 4].map((i) => b.teachSpell(0x82 + 8 * k + i))], [b.msg(B, 0xd)]),
  ], [b.msg(B, 0xc), b.dumbfound(7)])])];
  return new Map<number, Step[]>([
    [1, [b.askDialog(0xf46, bed(b, B, 0xb, 500))]],
    // The barrier to the treasure: walking through makes the Anama enemies (2).
    [2, [b.askDialog(0xf48, [b.msg(B, 0x10), b.setFlag(ANAMA, 2), b.setFlag(spot(2), 20)], [b.blockMove()])]],
    // `FUN_1038_0788`: quickfire.
    [3, [b.placeField(0x11, 0x15, FieldType.FIELD_QUICKFIRE)]],
    [11, stair(b, 0xd7e, 4, 6, 0x1b)],
    [12, stair(b, 0xd7e, 4, 0xd, 6)],
    ...[14, 15, 16, 17].map((id): [number, Step[]] => [id, book(id - 14)]),
  ]);
}

/**
 * The ferries (`FUN_10b8_153b`), one switch for towns 92, 127, 129, 131, 132
 * and 135: each spot number is used in one of them. A ferry needs its fare
 * paid in conversation first (a flag set to 1), takes a day, and leaves the
 * party in the next town. The message block is the town's own.
 */
function ferries(town: number): PlaceScript {
  return (b) => {
    const B = e3TownMessageBlock(town), spot = (id: number) => townSpotFlag(town, id);
    /** A paid crossing: `fare` is cleared, then out into zone `(zx, zy)` and into town `t`. */
    const crossing = (fare: [number, number] | null, unpaid: number, dlg: number, msg: number,
      zone: [number, number, number, number], t: [number, number, number]): Step[] => {
      const go = b.askDialog(dlg, [
        ...(fare ? [b.setFlag(fare, 0)] : []), b.msg(B, msg), b.exitTo(...zone), b.addAge(800), b.changeTown(...t),
      ]);
      return [fare ? b.ifFlagEq(fare, 0, [b.msg(B, unpaid)], [go]) : go, b.blockMove()];
    };
    return new Map<number, Step[]>([
      // 0 is below the switch's table: nothing.
      [0, []],
      // Port Townsend (127) to Farport (126).
      [1, crossing(f(0x583), 0x15, 0x10b3, 0x14, [2, 7, 0x18, 0x14], [0x7e, 0x1a, 5])],
      // Kuper (131) to Kneece (135).
      [2, crossing(f(0x5aa), 2, 0x10d6, 1, [2, 6, 0x10, 0x1e], [0x87, 0x19, 5])],
      // Bavner (129).
      [3, [b.giveItemDialog(0x10c2, spot(3), 0x157, 2100)]],
      [4, [b.ifFlagEq(f(0x592), 0, [b.msg(B, 0x18), b.setFlag(f(0x592), 20), b.bringIn(0xc9, 1)])]],
      // Kneece (135) to Kuper (131), free.
      [6, crossing(null, 0, 0x10fe, 7, [2, 6, 0xb, 0x1a], [0x83, 0x18, 0x29])],
      [7, [b.askDialog(0x10ff, [b.msg(B, 8), b.setFlag(f(0x5d1), 20)], [b.blockMove()])]],
      // Fenris Port (132) to Softport (133), free.
      [9, crossing(null, 0, 0x10e0, 0xb, [2, 5, 0x1f, 0x15], [0x85, 0x18, 0x29])],
      // The roaches (92): their map puts the Filth Factory (26) on the map (party+0x849f).
      [11, [b.dialog(0xf50), b.townVisible(26)]],
      [14, [b.ifFlagEq(f(0x41d), 0, [b.msg(B, 0x2d), b.setFlag(f(0x41d), 1)])]],
      [15, [b.ifFlagEq(f(0x41e), 0, [b.msg(B, 0x2e), b.setFlag(f(0x41e), 1)])]],
    ]);
  };
}

/** The Point of Contemplation (town 93): `FUN_10b8_1bfa`, block 65. */
function contemplation(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(93, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0xf5a, [b.msg(B, 0x19), b.cureDiseaseAll()])]],
    [2, [b.onceMsg(spot(2), B, 0x1a, 0x1b)]],
    [3, [b.onceMsg(spot(3), B, 0x1e)]],
    [4, [b.giveItemDialog(0xf5b, spot(4), 0x142)]],
  ]);
}

/** The Northpoint Lighthouse (town 94): `FUN_10b8_1d23`, block 65. */
function lighthouse(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(94, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x28, 0x29)]],
    [11, [b.msg(B, 0x2c), b.blockMove()]],
  ]);
}

/** The Shayder Sewers (town 96): `FUN_10b8_1ae1`, block 65. */
function shayderSewers(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(96, id);
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x13), b.blockMove()]],
    [2, [b.msg(B, 0x14), b.blockMove()]],
    [3, [b.onceMsg(spot(3), B, 0x15)]],
    [11, stair(b, 0xd7f, 4, 6, 0x36)],
    [12, stair(b, 0xd7f, 4, 0x2b, 6)],
  ]);
}

/**
 * The boatmen (`FUN_10b8_1f49`), one switch for town 98 (the Fiery Pit) and
 * villages 142–145. As with `ferries`, each spot number belongs to one town,
 * and the message block is the town's own. A crossing takes 400 ticks.
 */
function boatmen(town: number): PlaceScript {
  return (b) => {
    const B = e3TownMessageBlock(town), spot = (id: number) => townSpotFlag(town, id);
    const sail = (msg: number, zone: [number, number, number, number], t: [number, number, number]): Step[] =>
      [b.msg(B, msg), b.exitTo(...zone), b.addAge(400), b.changeTown(...t)];
    /** Paid in conversation at Storm Port (flag (143, 9)). */
    const stormPortFare = f(0x623);
    return new Map<number, Step[]>([
      // Lost Isle (142) back to Libras (141).
      [1, [b.askDialog(0x1144, sail(0x10, [5, 8, 0x1d, 0x2b], [0x8d, 0x17, 0x2a])), b.blockMove()]],
      // E3 says so again every visit once the chest is empty.
      [2, [b.giveItemDialog(0x1145, spot(2), 0xf0, 2100), b.ifFlagAtLeast(spot(2), 1, [b.msg(B, 0xf)])]],
      // Storm Port (143).
      [3, [b.msg(B, 6), b.bringIn(200, 1), b.setFlag(f(0x61d), 20)]],
      [4, [b.ifFlagEq(stormPortFare, 0, [b.msg(B, 8)], [b.askDialog(0x114e, [
        b.setFlag(stormPortFare, 0), ...sail(7, [5, 8, 0x3f, 0x34], [0x91, 0x18, 8]),
      ])]), b.blockMove()]],
      // Gebra (145).
      [5, [b.askDialog(0x1162, sail(0xa, [5, 8, 0x51, 0x21], [0x8f, 0x18, 0x28])), b.blockMove()]],
      [6, [b.msg(B, 0xc, 0xd), b.bringIn(200, 1), b.setFlag(f(0x634), 20)]],
      // The Fiery Pit (98).
      [7, [b.onceMsg(spot(7), B, 0x3d)]],
    ]);
  };
}

/**
 * The Dryad Grove (town 99), Esselare's, taken over by an ogre:
 * `FUN_10b8_2220`, block 65. Poppy pods (spot 2, flag (99,6)) put it to
 * sleep for good (spot 3); the thicket (spot 16) lets the party out once it
 * has (flag (99,8)).
 */
function dryadGrove(b: SpecBuilder): Map<number, Step[]> {
  const B = 65, spot = (id: number) => townSpotFlag(99, id);
  const pods = spot(6), freed = spot(8);
  /** The ogre (creature 0) wakes with 120 health, and its group comes in. */
  const fight: Step[] = [b.msg(B, 0x34), b.bringIn(200, 1), b.setCreature(0, 'health', 120)];
  return new Map<number, Step[]>([
    // The pollen: back to the entrance, 5 spell points gone.
    [1, [b.msg(B, 0x30), b.drainSp(5), b.moveParty(3, 2), b.blockMove()]],
    [2, [b.askDialog(0xf96, [b.msg(B, 0x32), b.setFlag(pods, 1), b.setFlag(spot(2), 20)])]],
    [3, [b.askDialog(0xf99, [b.ifFlagAtLeast(pods, 1, [b.askDialog(0xf97, [
      b.msg(B, 0x33, 0x3a), b.setFlag(spot(9), 1), b.setFlag(spot(3), 20), b.setFlag(freed, 1),
      b.setFlag(spot(7), 1), b.removeCreatureSlots([1]),
    ], fight)], fight)], [b.blockMove()])]],
    // The glowing trees: one PC goes in alone.
    [4, [b.askDialog(0xf9a, [b.splitParty(0x1e, 0x10, [], [B, 0x39])]), b.blockMove()]],
    [14, [b.setTer(0xc, 0x19, 0x5b), b.setTer(0xe, 0x15, 2)]],
    [15, [b.setTer(0x14, 6, 0x5b), b.setTer(0x1a, 8, 2)]],
    [16, [b.askDialog(0xf98, [b.ifFlagEq(freed, 0, [b.msg(B, 0x38)], [
      b.msg(B, 0x36, 0x37), b.reuniteParty(), b.setFlag(spot(4), 20),
    ])]), b.blockMove()]],
  ]);
}

/** The Troglo Temple's lower level (town 101): `FUN_10b8_2848`, block 66. */
function trogloTemple2(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(101, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 1, 2)]],
    [2, [b.trap(0xd7a, spot(2), 0x14)]],
    [3, []],
    // Two altars that kill whoever touches them.
    [5, [b.askDialog(0xfac, [b.msg(B, 4), b.slayParty(2)])]],
    [6, [b.askDialog(0xfad, [b.msg(B, 4), b.slayParty(2)])]],
    [11, stair(b, 0xfaa, 0x35, 0x29, 0x14)],
    [12, stair(b, 0xfaa, 0x35, 0x29, 0x1f)],
    // `FUN_1098_6e9c` is a screen effect.
    [14, [b.askDialog(0xfab, [b.msg(B, 3), b.e3Boom(0xd)])]],
  ]);
}

/**
 * Hawke's Manse (town 102), the house the party can own: `FUN_10b8_2a00`,
 * block 66. Coming in the first time, the housekeeper Marjorie; each later
 * day, one time in eight each, one of four chores (ghosts twice, a
 * basilisk, rats), each once (flags (102,6) to (102,9)).
 */
export const HAWKE_DAY = e3DailyFlag(2);
function hawkesManse(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(102, id);
  /** E3 stamps the day in (102,5) and compares; a flag the new day clears does the same. */
  const chore = (k: number): Step[] => [b.ifFlagEq(spot(6 + k), 0, [
    b.msg(B, 0xc + k), b.setFlag(spot(6 + k), 1), b.bringIn(200 + k, Math.floor(k / 2)),
  ])];
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(spot(1), 0, [b.msg(B, 0x13, 0x14), b.setFlag(HAWKE_DAY, 1), b.setFlag(spot(1), 1)], [
      b.ifFlagEq(HAWKE_DAY, 0, [b.setFlag(HAWKE_DAY, 1), b.randomCase(8, [0, 1, 2, 3].map(chore))]),
    ])]],
    [2, [b.giveItemDialog(0xfb6, spot(2), 0x165)]],
    [11, [b.askDialog(0xfb4, bed(b, B, 0xb, 500))]],
    [12, stair(b, 0xfb5, 0xc, 0x13, 0xd)],
  ]);
}

/**
 * The Barrier Cavern (town 103): `FUN_10b8_2def`, block 66. Smashing the
 * crystal drops the barriers and restarts the war between the troglodytes
 * and the giants (0xc8a), and closes a handful of spots in their towns.
 * E3 also stamps the day into party+0x8501, which is `key_times[2]`: event 2.
 */
function barrierCavern(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(103, id);
  return new Map<number, Step[]>([
    // Afterwards, shards for the fort (special item 28, party+0x44).
    [1, [b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 0x15), b.giveSpecItem(partySpecItem(0x44)), b.setFlag(spot(1), 20)], [
      b.askDialog(0xfbf, [
        b.setEvent(2), b.setFlag(spot(1), 1), b.dialog(0xfc0), b.damageAll(0x32, 3), b.dialog(0xfc1), b.xp(25), b.journal(0xb),
        b.bringIn(200, 1), b.setFlag(f(0xc8a), 1),
        ...[0x1bd, 0x1a1, 0x19f, 0x19e, 0x1ab].map((a) => b.setFlag(f(a), 20)),
        // The barriers: terrain 255, which the converter gives a stand-in
        // per picture (town 103's is the red barrier, 257). Until 2026-09-30
        // only 255 was replaced, so they stayed up until the party came back in.
        ...E3_TER_255_ALL.map((t) => b.replaceTerrain(t, 0)),
      ]),
    ])]],
    [2, [b.setFlag(spot(2), 20), b.dialog(0xfc2)]],
    [11, [b.askDialog(0xfbe, [b.exitTo(4, 5, 0x1e, 0x22), b.changeTown(0x1f, 0x15, 0x39)]), b.blockMove()]],
    [12, [b.askDialog(0xfbe, [b.exitTo(4, 6, 0x24, 3), b.changeTown(0x1d, 0x20, 6)]), b.blockMove()]],
    [14, [b.askDialog(0xfbe, [b.exitTo(5, 6, 0x13, 0x11), b.changeTown(0x36, 5, 0x12)]), b.blockMove()]],
  ]);
}

/** Sulfras's password (flag 0x2c5, set in the Lair of Sulfras) opens Athron's and Khoth's doors. */
const SULFRAS_WORD = f(0x2c5);

/** The Lair of Athron (town 104): `FUN_10b8_3288`, block 66. */
function athronsLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(104, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x17, 0x18)]],
    [2, [b.ifFlagEq(SULFRAS_WORD, 0, [b.msg(B, 0x19)], [b.ifTer(0xa, 0x18, 0, [], [b.setTer(0xa, 0x18, 0), b.msg(B, 0x1a)])])]],
    [3, [b.giveItemDialog(0xfcb, spot(3), 0, 337)]],
    [11, stair(b, 0xfc9, 0x39, 2, 0x2d)],
    // Attacking: `FUN_10d8_3d5b(83, 104, 9)` removes the creatures of kind 83
    // if flag (104,9) is set, which it just was; then the town turns.
    [12, [b.ifFlagEq(spot(9), 0, [b.askDialog(0xfca, [
      b.msg(B, 0x1b), b.setFlag(spot(9), 1), b.removeCreatures(0x53), b.makeTownHostile(),
    ], [b.blockMove()])])]],
    [14, [b.askDialog(0xfcc, [b.moveParty(0x1a, 0xd)])]],
    [15, [b.askDialog(0xfcc, [b.moveParty(0x16, 0xf)])]],
  ]);
}

/** The Lair of Khoth (town 105): `FUN_10b8_3477`, block 66, with its library (spots 20–27). */
function khothsLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(105, id);
  /** A book that teaches spell `s` to a party with total level `lvl`; 0x28 says it's beyond them. */
  const book = (lvl: number, msg: number, then: Step[]): Step[] => [b.ifMageLoreTotal(lvl, [b.msg(B, msg), ...then], [b.msg(B, 0x28)])];
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x1e), b.blockMove()]],
    [2, [b.ifFlagEq(SULFRAS_WORD, 0, [b.msg(B, 0x26)], [b.ifTer(0x15, 0x16, 0x7e, [], [
      b.setTer(0x15, 0x16, 0x7e), b.setTer(0x15, 0x17, 0x7e), b.msg(B, 0x27),
    ])])]],
    [3, []], [4, []], [5, []],
    [11, stair(b, 0xfc9, 0x39, 0x2d, 0x2d)],
    [20, [b.msg(B, 0x1c), b.moveParty(0x11, 0x11), b.blockMove()]],
    [21, book(15, 0x1d, [b.teachSpell(0x9e)])],
    // A random PC's Item Lore goes up by one, to 15, once.
    [22, [b.ifFlagEq(spot(9), 0, [b.msg(B, 0x1f),
      b.atRandomPc([b.ifStat(Skill.ITEM_LORE, 15, [], [b.addStat(Skill.ITEM_LORE, 1)])]), b.setFlag(spot(9), 1)])]],
    // A random PC's Intelligence goes down by one, to 1, every time.
    [23, [b.msg(B, 0x20), b.atRandomPc([b.ifStat(Skill.INTELLIGENCE, 2, [b.addStat(Skill.INTELLIGENCE, -1)])])]],
    [24, book(12, 0x21, [b.teachSpell(0x9b)])],
    // Each PC dumbfounded by 0 to 7.
    [25, [b.msg(B, 0x23), b.eachPc(() => [b.randomCase(8, [0, 1, 2, 3, 4, 5, 6, 7].map((n) => (n > 0 ? [b.dumbfound(n)] : [])))])]],
    // Alchemy recipe 10 (party+0x8328).
    [26, book(8, 0x24, [b.learnAlchemy(10)])],
    [27, [b.msg(B, 0x25), b.setFlag(spot(6), 1)]],
  ]);
}

/**
 * The Remote Aerie and the Drake Aerie (towns 106 and 107):
 * `FUN_10b8_3941`, block 66. Spots 1 and 2 set town 106's flags, whichever
 * town runs them.
 */
function aeries(b: SpecBuilder): Map<number, Step[]> {
  const B = 66;
  const dizzy = (id: number): Step[] => [b.msg(B, 0x2a), b.dumbfound(8), b.setFlag(townSpotFlag(106, id), 20)];
  return new Map<number, Step[]>([
    [1, dizzy(1)],
    [2, dizzy(2)],
    // Dalakros, lord of lizard-kind: hand over all the food, or fight.
    [3, [b.askDialog(0xfe6, [b.dialog(0xfe8), b.takeFood(30000)], [b.makeTownHostile()]), b.setFlag(townSpotFlag(107, 3), 20)]],
  ]);
}

/** The Vahnatai Home (town 109): `FUN_10b8_44ed`, block 66. */
function vahnataiHome(b: SpecBuilder): Map<number, Step[]> {
  const B = 66, spot = (id: number) => townSpotFlag(109, id);
  /** Past 1, the crypt's business is done (flag 0x1f5). */
  const late = f(0x1f5);
  /** Flag (109,8): 1 once the party has rested here, 2 once the ghosts came. */
  const rested = spot(8);
  return new Map<number, Step[]>([
    [1, [
      b.ifFlagAtLeast(late, 2, [b.setTer(0xd, 0x12, 0x8a), b.setTer(0xe, 0x12, 0x8a)]),
      b.ifFlagEq(spot(1), 0, [b.ifFlagAtLeast(late, 2, [b.msg(B, 0x2f, 0x34)], [b.msg(B, 0x2e)]), b.setFlag(spot(1), 1)]),
    ]],
    [2, [b.ifFlagEq(rested, 1, [b.msg(B, 0x30, 0x31), b.bringIn(200, 1), b.setFlag(rested, 2), b.setFlag(spot(9), 1)])]],
    // The host's bed; creature 0 leaves (E3 leaves a stain where it stood, `FUN_1038_1185`).
    [3, [b.ifFlagAtLeast(rested, 1, [b.msg(B, 0x35)], [b.askDialog(0xffa, [
      b.heal(200), b.restoreSp(100), b.dialog(0xffb), b.removeCreatureSlots([0]), b.setFlag(rested, 1),
    ])])]],
  ]);
}

/** The Vahnatai Crypt (town 110): `FUN_10b8_4437`, block 67. */
function vahnataiCrypt(b: SpecBuilder): Map<number, Step[]> {
  const B = 67;
  return new Map<number, Step[]>([
    [1, [b.ifTer(0x15, 0x17, 0x84, [b.msg(B, 1), b.setTer(0x15, 0x17, 0), b.setTer(0x16, 0x16, 0)])]],
    [2, [b.ifTer(0x15, 0x17, 0x84, [b.msg(B, 3)])]],
  ]);
}

/** The House on the Hill (town 111): `FUN_10b8_46db`, block 67. */
function houseOnHill(b: SpecBuilder): Map<number, Step[]> {
  const B = 67, spot = (id: number) => townSpotFlag(111, id);
  return new Map<number, Step[]>([
    [1, [b.ifMageLoreTotal(20, [b.msg(B, 6), b.teachSpell(0x21)], [b.msg(B, 7)])]],
    [2, [b.onceMsg(spot(2), B, 5)]],
    [3, [b.askDialog(0x100e, bed(b, B, 8, 900))]],
  ]);
}

export const DUNGEON2_SCRIPTS = new Map<number, PlaceScript>([
  [90, agateGrounds],
  [91, anamaTemple],
  ...[92, 127, 129, 131, 132, 135].map((t): [number, PlaceScript] => [t, ferries(t)]),
  [93, contemplation],
  [94, lighthouse],
  [96, shayderSewers],
  ...[98, 142, 143, 144, 145].map((t): [number, PlaceScript] => [t, boatmen(t)]),
  [99, dryadGrove],
  [101, trogloTemple2],
  [102, hawkesManse],
  [103, barrierCavern],
  [104, athronsLair],
  [105, khothsLair],
  [106, aeries],
  [107, aeries],
  [109, vahnataiHome],
  [110, vahnataiCrypt],
  [111, houseOnHill],
]);
