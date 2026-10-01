/**
 * Exile 3's smaller places, each a short switch of its own: one function
 * per town, named for it, with its E3 handler (FORMATS.md, "Town script
 * handlers") and message block.
 */

import { DamageType } from '../../../src/data/monster';
import { FieldType } from '../../../src/data/fields';
import { e3TownMessageBlock, type EntranceMark, type PlaceScript } from '../specials';
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
    [11, [b.askDialog(0xd52, [b.ifMageLoreTotal(15, [b.msg(B, 0x24), b.teachSpell(0x37)], [b.msg(B, 0x23)])])]],
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
/** The Agate Tower's slime maker is gone: flag (46, 9), party+0x259. */
const AGATE_GONE = f(0x259);

/** Its clock (`10c0:62b9`): while it stands, it breathes sleep over the 9×9 around it on a party within 8. */
export function agateTimers(b: SpecBuilder): { freq: number; steps: Step[] }[] {
  return [{ freq: 1, steps: [b.ifFlagEq(AGATE_GONE, 0, [b.ifNear(24, 41, 9,
    [b.placeFieldRect(20, 37, 28, 45, FieldType.CLOUD_SLEEP)])])] }];
}

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
    // The slime maker at (24,41): an exploding missile ends it (`1018:9aa1`),
    // and the slimes of four kinds (138–141) with it (`FUN_10d8_3d5b`).
    [21, [b.ifTargeted([b.ifFlagEq(AGATE_GONE, 0, [
      b.dialog(0xd88), b.setFlag(AGATE_GONE, 1), ...[138, 139, 140, 141].map((k) => b.removeCreatures(k)),
      b.setTer(24, 41, 0),
    ])])]],
    [20, [b.askDialog(0xd87, [b.ifMageLoreTotal(8, [b.msg(B, 0x6b), b.teachSpell(0x1a)], [b.msg(B, 0x6a)])])]],
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
          b.setFlag(f(0xc92), 3), b.journal(0x15), b.msg(B, 0x80), b.exitTo(7, 8, 0x5c, 0x29), b.changeTown(0x2d, 0x1f, 4),
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

/** The Golddale Mines (town 50), taken by sliths: `FUN_1088_1807`, block 61. */
function golddaleMines(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(50, id);
  /** How many fireballs the slith has thrown (flag (50,6)); it stops at 12, or once flags (50,7) and (50,8) are both set. */
  const thrown = f(0x27e);
  const fireball = (): Step => b.ifFlagBelow(thrown, 12, [b.ifFlagEq(f(0x27f), 0, [throwIt()], [b.ifFlagEq(f(0x280), 0, [throwIt()])])]);
  const throwIt = (): Step => b.seq([b.msg(B, 4), b.incFlag(thrown), b.e3Boom(0xf)]);
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(f(0x281), 0, [b.msg(B, 2), b.setFlag(spot(1), 20)])]],
    [2, [b.onceMsg(spot(2), B, 3)]],
    // The slith with a wand of fireballs, always in town mode and one time
    // in six in combat.
    ...[14, 15, 16, 17, 18, 19, 20, 21].map((id): [number, Step[]] =>
      [id, [b.ifInCombat([b.ifChance(17, [fireball()])], [fireball()])]]),
  ]);
}

/** Converter scratch: how much ore the party has picked up. */
const ORE_COUNT: Flag = [291, 27];

/** The Lair of the Ursagi (town 51): `FUN_1088_1959`, block 61. */
function ursagiLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(51, id);
  return new Map<number, Step[]>([
    // Gold ore (item 404), as much as the party can carry, up to 99.
    [1, [b.askDialog(0xdb6, [b.setFlag(spot(1), 20), b.giveItemUntilFull(0x194, 0x63, ORE_COUNT)])]],
    // The avalanche behind the party.
    [2, [b.msg(B, 9), ...[0x2a, 0x2b, 0x2c].map((y) => b.setTer(7, y, 0x5f)), b.setFlag(spot(2), 20), b.setFlag(spot(3), 20)]],
    [3, [b.onceMsg(spot(3), B, 8)]],
    [4, [b.onceMsg(spot(4), B, 0xa)]],
    [5, [b.msg(B, 0xc), b.bringIn(200, 1), b.setFlag(spot(5), 20)]],
    [6, [b.dialog(0xdb7)]],
  ]);
}

/** The Tomb of Vahkohs (town 52), a vampire's: `FUN_1088_1b0d`, block 61. */
function vahkohsTomb(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(52, id);
  const lever = (x: number, y: number): Step[] => [b.lever([b.msg(B, 0x11), b.swapTer(x, y, 0x7d, 0x7e)])];
  const spellbook = (reads: number, spell: number): Step[] => [b.askDialog(0xdc2,
    [b.ifMageLoreTotal(10, [b.msg(B, reads), b.teachSpell(spell)], [b.msg(B, 0x13)])])];
  return new Map<number, Step[]>([
    // The vampire's end: the tomb counts as cleared (0x295 is `towns/entry.ts`'s).
    [1, [b.askDialog(0xdc0, [b.msg(B, 0xe, 0xf), b.setFlag(f(0x295), 2), b.setFlag(spot(1), 20), b.xp(10)])]],
    [2, [b.onceMsg(spot(2), B, 0x10)]],
    // A fiery barrier.
    ...[3, 5, 6].map((id): [number, Step[]] =>
      [id, [b.askDialog(0xdc1, [b.msg(B, 0x12), b.damageAll(100, 1)]), b.blockMove()]]),
    [4, [b.onceMsg(spot(4), B, 0x16, 0x17)]],
    [14, lever(0x1c, 0x13)], [15, lever(0x1c, 0x1d)], [16, lever(0xf, 0xf)], [17, lever(0xf, 0x20)],
    [18, spellbook(0x14, 0x33)],
    [19, spellbook(0x15, 0x3b)],
  ]);
}

/** The Troglo Temple (town 53): `FUN_1088_1e4d`, block 61. */
function trogloTemple(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(53, id);
  const down = (x: number, y: number): Step[] => [b.askDialog(0xdcb, [b.changeTown(0x65, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x1b, 0x1c)]],
    [2, [b.trap(0x107e, spot(2), 0x14)]],
    // The alarm: more come, hostile, and everyone here hunts the party.
    [3, [b.setFlag(spot(3), 20), b.bringIn(200, 3), b.setCreature(-1, 'wake')]],
    [4, [b.giveItemDialog(0xdca, spot(4), 0x5f)]],
    [5, [b.onceMsg(spot(5), B, 0x1d)]],
    [11, down(5, 9)], [12, down(5, 0xf)],
  ]);
}

/** The Concealed Tunnel (town 54): `FUN_1088_2248`, block 61. */
function concealedTunnel(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(54, id);
  const lever = (x: number): Step[] => [b.lever([b.msg(B, 0x27), b.swapTer(x, 0x12, 0x6c, 0x6d), b.swapTer(x, 0x13, 0x6c, 0x6d)])];
  const teleport = (x: number, y: number): Step[] => [b.askDialog(0xdd5, [b.msg(B, 0x25), b.moveParty(x, y)])];
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x24), b.setFlag(spot(1), 20), b.bringIn(200, 1)]],
    // An invisible barrier while any barrel is left in the tunnel, anywhere
    // (1088:22b8, every square). Until 2026-09-30 this read a flag only spot
    // 14 set, and spot 14 is behind the barrier: the tunnel couldn't be
    // crossed.
    [2, [b.ifFieldCount(FieldType.OBJECT_BARREL, 1, [b.msg(B, 0x28), b.blockMove()])]],
    [11, teleport(0x28, 6)], [12, teleport(5, 0x2b)],
    // The way back from the Barrier Cavern: every barrel vanishes and the
    // portcullises open, once ((7,18) opened says so).
    [14, [b.ifTer(7, 0x12, 0x6d, [], [
      b.removeField(0, 0, 63, 63, FieldType.OBJECT_BARREL),
      ...[[7, 0x12], [7, 0x13], [0xa, 0x12], [0xa, 0x13]].map(([x, y]) => b.setTer(x!, y!, 0x6d)), b.msg(B, 0x26),
    ])]],
    [15, [b.askDialog(0xdd4, [b.changeTown(0x67, 0x1a, 0x11)]), b.blockMove()]],
    [18, lever(0xa)], [19, lever(7)],
  ]);
}

/** The Giant's Forge (town 55): `FUN_1088_1fe8`, block 61. */
function giantsForge(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(55, id);
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x1f)]],
    [2, [b.onceMsg(spot(2), B, 0x20)]],
    [3, [b.trap(0xdde, spot(3), 0x14)]],
    [4, [b.trap(0xdde, spot(4), 0x14)]],
    // The crater's fireballs, and the altar's ball lightning.
    [11, [b.msg(B, 0x22), b.e3Boom(0xf)]],
    [12, [b.msg(B, 0x23), b.e3Boom(0x62)]],
    // Kills zone 49's spot 2 (flag (249,2)).
    [14, [b.setFlag(f(0xa40), 20)]],
    // The long passage back to the Caves of the Giants.
    [15, [b.askDialog(0xddf, [
      b.msg(58, 0xb), b.onceMsg(f(0x1c2), 58, 7, 8), b.exitTo(4, 5, 0x1e, 0x22), b.changeTown(0x1f, 5, 0x2b),
    ]), b.blockMove()]],
  ]);
}

/** The Woodsy Tower (town 56), which fades once its exit is reached: `FUN_1088_2f08`, block 61. */
function woodsyTower(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(56, id);
  /** The six fountains: each asked, and each refuses the step. */
  const fountain = (drunk: Step[]): Step[] => [b.askDialog(0xde8, drunk), b.blockMove()];
  return new Map<number, Step[]>([
    // The exit: the portcullises open and the tower leaves the map
    // (can_find_town[56] = 0, party+0x84bd).
    [1, [b.ifTer(0x16, 0x26, 0x6c, [
      b.msg(B, 0x47), b.townVisible(56, false),
      ...[0x16, 0x17, 0x18].map((x) => b.setTer(x, 0x26, 0x6d)), b.setFlag(spot(1), 1),
    ])]],
    [2, [b.dialog(0xde9), b.bringIn(200, 1), b.setFlag(spot(2), 20)]],
    [3, [b.msg(B, 0x49), b.blockMove()]],
    [4, [b.trap(0xd7a, spot(4), 0x14)]],
    [5, [b.trap(0xd7a, spot(5), 0x14)]],
    // The wall that swings shut behind the party, and the quickfire alcove.
    [11, [b.ifInCombat([], [b.ifTer(0x10, 0x1f, 0x96, [], [b.msg(B, 0x40), b.setTer(0x10, 0x1f, 0x96), b.setTer(0x11, 0x1e, 100)])])]],
    [14, fountain([b.msg(B, 0x41), b.heal(200)])],
    [15, fountain([b.msg(B, 0x42), b.eachPc(() => [b.disease(6)])])],
    [16, fountain([b.msg(B, 0x43)])],
    [17, fountain([b.msg(B, 0x44), b.drainXp(0x19)])],
    [18, fountain([b.msg(B, 0x45), b.teachSpell(0x9a)])],
    [19, fountain([b.msg(B, 0x46), b.restoreSp(100)])],
    [20, [b.ifTer(0x16, 0x26, 0x6c, [b.msg(B, 0x48)])]],
  ]);
}

/** The Lair of Sulfras (town 57), the dragon: `FUN_1088_325a`, block 61. */
function sulfrasLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(57, id);
  // Each passage also moves where the party will come out (party+0x12e6,
  // `FUN_1080_022e`) to the other lair's own door in zone 28, DGROUP 0x1d98
  // and 0x1d9a. E3 gives the square relative to its outdoor window; see
  // `shiftingFloors.ts`'s `toBasement` for why the port names the zone.
  const passage = (town: number, x: number, y: number, door: [number, number]): Step[] =>
    [b.askDialog(0xdf2, [b.exitTo(1, 3, ...door), b.changeTown(town, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    [0, []],
    [1, [b.askDialog(0xfca, [b.msg(B, 0x4a), b.setFlag(spot(1), 20), b.bringIn(200, 1)], [b.blockMove()])]],
    // Sulfras grants an audience once the party has ended a plague (the
    // slimes or the roaches).
    [2, [b.ifFlagEq(f(0xc85), 0, [b.ifFlagEq(f(0xc87), 0, [b.msg(B, 0x4c)], [audience(b, B)])], [audience(b, B)])]],
    [3, [b.onceMsg(spot(3), B, 0x4e)]],
    [11, passage(0x68, 3, 8, [36, 24])], [12, passage(0x69, 0x1a, 5, [38, 25])],
    [14, [b.msg(B, 0x4f), b.blockMove()]],
  ]);
}

function audience(b: SpecBuilder, B: number): Step {
  return b.ifTer(0x16, 6, 0x7d, [
    b.msg(B, 0x4d), ...[6, 10].flatMap((y) => [0x15, 0x16, 0x17].map((x) => b.setTer(x, y, 0x7e))),
  ]);
}

/** The Chasm of Screams (town 58): `FUN_1088_2a45`, block 61. */
function chasmOfScreams(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(58, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x2b)]],
    [2, [b.msg(B, 0x2d), b.bringIn(201, 1), b.setFlag(spot(2), 20)]],
    [3, [b.msg(B, 0x2e), b.bringIn(200, 1), b.setFlag(spot(3), 20)]],
    [4, [b.onceMsg(spot(4), B, 0x2f, 0x30)]],
  ]);
}

/** The Defiled Crypt (town 59): `FUN_1088_2c12`, block 61. */
function defiledCrypt(b: SpecBuilder): Map<number, Step[]> {
  const B = 61, spot = (id: number) => townSpotFlag(59, id);
  const platinumKey = partySpecItem(0x30);
  /** A pressure plate: a click (sound 34), and a square changes. */
  const plate = (x: number, y: number, from: number, to: number, literal: number): Step[] =>
    [b.ifTer(x, y, from, [b.log(0x1088, literal), b.setTer(x, y, to)])];
  /** A trap over the whole west of the crypt: E3's field over x 1–19, y 21–47. */
  const trap = (literal: number, field: number): Step[] =>
    [b.log(0x1088, literal), b.placeFieldRect(1, 0x15, 0x13, 0x2f, field)];
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0xdfc, spot(1), 0, 300 + platinumKey)]],
    ...[2, 3, 4].map((id): [number, Step[]] => [id, [b.msg(B, 0x3a), b.bringIn(id + 0xc6, 1), b.setFlag(spot(id), 20)]]),
    [5, [b.onceMsg(spot(5), B, 0x3d, 0x3e)]],
    [11, [b.ifTer(0x1c, 0x2a, 0x7b, [b.ifSpecItem(platinumKey,
      [b.setTer(0x1c, 0x2a, 0x78), b.msg(B, 0x35)], [b.msg(B, 0x34)])])]],
    [20, plate(0x15, 0x2a, 0xc2, 0xc1, 0x2b5e)],
    [21, plate(0x15, 0x2a, 0xc1, 0xc2, 0x2b75)],
    [22, plate(0x16, 0x2a, 0xc2, 0xc1, 0x2b8c)],
    [23, plate(0x16, 0x2a, 0xc1, 0xc2, 0x2ba3)],
    [24, plate(0x28, 0x2e, 0x75, 0xc1, 0x2bba)],
    [25, trap(0x2bd1, FieldType.WALL_FORCE)],
    [26, trap(0x2be4, FieldType.WALL_ICE)],
    [27, trap(0x2bf2, FieldType.WALL_BLADES)],
  ]);
}

/** The Guarded Tunnel (town 61), the back way into Blackcrag: `FUN_1088_4f13`, block 62. */
function guardedTunnel(b: SpecBuilder): Map<number, Step[]> {
  const B = 62, spot = (id: number) => townSpotFlag(61, id);
  /** The bridge: 1 while solid (spot 16's button toggles it). */
  const bridge = spot(1);
  /** The armour at the portcullis: 1 woken, 2 once the bridge was looked at. */
  const armour = spot(9);
  return new Map<number, Step[]>([
    // The ethereal bridge: whoever is on it falls through (in combat, the active PC).
    [1, [b.ifFlagEq(bridge, 0, [b.msg(B, 6), b.slayParty(3)])]],
    // The alarm, unless flag 0x107 says the party is expected: only while
    // creature 9 is here and not hostile already (attitude 1).
    [2, [b.ifFlagEq(f(0x107), 0, [b.ifCreature(9, 'here', [b.ifCreature(9, { attitude: 1 }, [],
      [b.msg(B, 0xa), b.makeTownHostile()])])],
      [b.msg(B, 0xb), b.setFlag(spot(2), 20)])]],
    [3, [b.onceMsg(spot(3), B, 0xc)]],
    // Beams of light: two in three of the party turn to stone.
    ...[4, 5, 6].map((id): [number, Step[]] => [id, [b.askDialog(0xe1c, [
      b.msg(B, 0xd), b.eachPc(() => [b.ifChance(67, [b.slayParty(4)])]), b.setFlag(spot(id), 20),
    ], [b.blockMove()])]]),
    [9, [b.ifFlagEq(armour, 0, [b.msg(B, 9), b.bringIn(200, 1), b.setFlag(armour, 1)],
      [b.ifFlagEq(armour, 2, [b.setTer(9, 3, 0)])])]],
    [11, [b.ifOnHorse([b.log(0x1088, 0x4efb)], [b.askDialog(0xe1a, [b.changeTown(0x22, 0x3a, 0xa)])]), b.blockMove()]],
    [14, [b.ifTer(9, 3, 0, [], [b.msg(B, 5), b.setTer(9, 3, 0)])]],
    [15, [b.ifFlagEq(bridge, 0, [b.msg(B, 8)], [b.msg(B, 7)]), b.ifFlagEq(armour, 1, [b.setFlag(armour, 2)])]],
    [16, [b.askDialog(0xe1b, [b.ifFlagEq(bridge, 0, [b.setFlag(bridge, 1)], [b.setFlag(bridge, 0)])])]],
  ]);
}

/**
 * The Great Circle (town 62), where the stone circles lead: `FUN_1088_5233`,
 * block 62. Smashing the altar frees three haakai, who want everything.
 */
/**
 * Smashing the Great Circle's altar, by its spot or by the Ritual of
 * Sanctification (`towns/sanctify.ts`), which adds `yesTail` to the
 * haakai's bargain.
 */
export function greatCircleSmash(b: SpecBuilder, yesTail: Step[] = []): Step[] {
  const B = 62;
  return [
    b.setFlag(f(0x867), 1), b.setFlag(townSpotFlag(62, 1), 20), b.townVisible(62),
    b.askDialog(0xe27, [
      // The haakai take the party's gold, every magic item it carries, and
      // those lying here.
      b.msg(B, 0xf), (next) => b.node('gold', { ex1: [30000, 1] }, next), b.takeMagicItems(true), b.msg(B, 0x13),
      ...yesTail,
    ], [b.msg(B, 0x10), b.bringIn(200, 1)]),
  ];
}

function greatCircle(b: SpecBuilder): Map<number, Step[]> {
  const B = 62;
  const smash = (): Step[] => greatCircleSmash(b);
  return new Map<number, Step[]>([
    // After three stone circles (flag 0xb41), the compulsion can't be refused.
    [1, [b.askDialog(0xe26, smash(), [b.ifFlagBelow(f(0xb41), 3, [b.blockMove()], [b.msg(B, 0x11), ...smash()])])]],
  ]);
}

/** The New Factory (town 63), the golems' workshop: `FUN_1088_5402`, block 62. */
function newFactory(b: SpecBuilder): Map<number, Step[]> {
  const B = 62, spot = (id: number) => townSpotFlag(63, id);
  const button = (then: Step[]): Step[] => [b.askDialog(0xe2e, then)];
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x15, 0x1d)]],
    [2, [b.onceMsg(spot(2), B, 0x17)]],
    [11, [b.ifInCombat([b.blockMove()], [b.askDialog(0xe2e, [b.msg(B, 0x16), b.moveParty(0x28, 0xa), b.blockMove()])])]],
    // A box of gruel that fills itself again.
    [12, [b.askDialog(0xe2f, [b.msg(B, 0x19), b.addFood(10)])]],
    // Buttons that turn the belts: row y 44 east or west, and x 36 north.
    [14, button([b.msg(B, 0x18), ...Array.from({ length: 0x14 }, (_, k) => b.setTer(0x16 + k, 0x2c, 0xf8))])],
    [15, button([b.msg(B, 0x18), ...Array.from({ length: 0x14 }, (_, k) => b.setTer(0x16 + k, 0x2c, 0xfa))])],
    [16, button([b.msg(B, 0x18), ...[0x11, 0x12, 0x13].map((y) => b.setTer(0x24, y, 0xf7))])],
    [17, button([b.msg(B, 0x1e), b.swapTer(0x24, 0x1c, 0x8c, 0x8d)])],
    // The floor's fire traps, 20d6 each.
    ...Array.from({ length: 10 }, (_, k): [number, Step[]] => [20 + k, [b.e3Boom(0x14)]]),
    // The floor starts to shift, while (39,28) is still floor (E3: terrain below 5).
    [30, [b.ifTer(0x27, 0x1c, 0xfa, [], [b.msg(B, 0x1a), b.setTer(0x27, 0x1c, 0xfa), b.setTer(0x28, 0x1c, 0xfa)])]],
  ]);
}

/** The Generic Dungeon (town 65), behind the pants in Rentar-Ihrno's keep: `FUN_1088_58a1`, block 62. */
function genericDungeon(b: SpecBuilder): Map<number, Step[]> {
  const B = 62, spot = (id: number) => townSpotFlag(65, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0xe42, spot(1), 0x23)]],
    ...[2, 3, 4].map((id): [number, Step[]] => [id, [b.msg(B, id + 0x21), b.bringIn(id + 0xc6, 1), b.setFlag(spot(id), 20)]]),
    [5, [b.lever([b.msg(B, 0x28), b.swapTer(0x2a, 9, 0x6c, 0x6d)])]],
    [6, [b.changeTown(0x26, 0x14, 0x3a)]],
  ]);
}

/** The Tower of Zkal (town 70): `FUN_1088_3b05`, block 63. Teleporters everywhere. */
function zkal(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(70, id);
  const teleports: [number, number][] = [[9, 9], [0x24, 0xb], [0xc, 0x26], [9, 0x16], [0x1c, 0x2e],
    [1, 0x2d], [0x1a, 0xf], [0x2a, 0x27], [5, 0x16], [0x1a, 0x16]];
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x22, 0x23)]],
    [11, [b.askDialog(0xd7e, [b.changeTown(0x47, 0xd, 2)]), b.blockMove()]],
    ...teleports.map(([x, y], k): [number, Step[]] => [14 + k, [b.askDialog(0xe74, [b.moveParty(x, y), b.blockMove()])]]),
    [24, [b.lever([b.msg(B, 0x26), b.swapTer(0x23, 1, 0x6c, 0x6d)])]],
  ]);
}

/**
 * Zkal's level 2 (town 71): `FUN_1088_3d98`, block 63. Its four teleporters
 * (spots 20–23) move a maze state (flag (71,8)) through DGROUP 0x1d9c's
 * table, lighting one of four markers; 5 is the way out.
 */
const ZKAL_PADS = [1, 1, 0, 0, 0, 2, 1, 1, 1, 2, 3, 0, 3, 5, 2, 2];
const ZKAL_MARKERS: [number, number][] = [[0x28, 0x28], [0x28, 0x2c], [0x2c, 0x28], [0x2c, 0x2c]];

/**
 * Entering level 2 (`towns/entry.ts`): E3's loader zeroes the maze state
 * (10d8:04d6) and reloads the map, which shows marker 0 lit. The engine
 * keeps a town's terrain between visits, so the markers are set back here.
 */
export function zkal2Entry(b: SpecBuilder): Step[] {
  return [b.setFlag(townSpotFlag(71, 8), 0), ...ZKAL_MARKERS.map(([x, y], m) => b.setTer(x, y, m === 0 ? 1 : 0))];
}

function zkal2(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(71, id);
  const state = spot(8), seen = spot(7);
  const pad = (p: number): Step[] => [b.askDialog(0xe74, [b.switchFlag(state, [0, 1, 2, 3].map((st) => {
    const v = ZKAL_PADS[st * 4 + p]!;
    if (v === 5) return [b.moveParty(0x22, 0x2d)];
    return [
      b.ifFlagEq(seen, 0, [b.setFlag(seen, 1), b.msg(B, 0x28)]), b.setFlag(state, v),
      ...ZKAL_MARKERS.map(([x, y], m) => b.setTer(x, y, m === v ? 1 : 0)),
    ];
  }))]), b.blockMove()];
  const noCombat = (literal: number, then: Step[]): Step[] =>
    [b.ifInCombat([b.log(0x1088, literal), b.blockMove()], then)];
  return new Map<number, Step[]>([
    ...[1, 2, 3, 4].map((id): [number, Step[]] => [id, [b.trap(0xd7a, spot(id), 0x14)]]),
    // Crushing walls behind a vanished door.
    [5, noCombat(0x3d5a, [b.msg(B, 0x24), b.setTer(0x1e, 0x2e, 0x75), b.setTer(0x1e, 0x1b, 0x75),
      b.setFlag(spot(5), 20), b.setTer(0x1f, 0x24, 100)])],
    [6, noCombat(0x3d79, [b.msg(B, 0x27),
      ...Array.from({ length: 7 }, (_, k) => 0x28 + k).flatMap((x) => [b.setTer(x, x === 0x2e ? 2 : 1, 0x75), b.setTer(x, 0xa, 0x75)]),
      b.setFlag(spot(6), 20)])],
    [11, [b.askDialog(0xe74, [b.moveParty(0x2a, 0x2b), b.blockMove()])]],
    [12, [b.askDialog(0xe74, [b.moveParty(0xc, 0x1e), b.blockMove()])]],
    [14, [b.askDialog(0xd7f, [b.changeTown(0x46, 1, 0xe)]), b.blockMove()]],
    [15, [b.lever([b.msg(B, 0x26), b.swapTer(0x23, 0x17, 0x6c, 0x6d)])]],
    [16, [b.askDialog(0xe74, [b.moveParty(0xc, 0x1e), b.blockMove()])]],
    [17, [b.lever([b.msg(B, 0x26), b.swapTer(0x27, 9, 0x6c, 0x6d), b.swapTer(0x26, 0xa, 0x6c, 0x6d)])]],
    ...[0, 1, 2, 3].map((p): [number, Step[]] => [20 + p, pad(p)]),
  ]);
}

/** Converter scratch: how many of the Remote Cave's seven tiles show 150. */
const TILES_LIT: Flag = [291, 29];

/**
 * The Remote Cave (town 72), a rakshasa's puzzles: `FUN_1088_488c`, block 63.
 * Its tiles (spots 20–26) each flip some of seven floor squares on row 38
 * between 150 and 165; with exactly one showing 150, (38,44) opens.
 */
function remoteCave(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(72, id);
  /** The walk puzzle: spots 17, 16, then 15, in that order (flag (72,8)). */
  const walk = spot(8);
  /** The pushing floor (spots 30–31) works while flag (72,7) is 1. */
  const push = spot(7);
  const tiles = [0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21];
  const flips: Record<number, number[]> = {
    20: [0x1b, 0x1d], 21: [0x1c, 0x20, 0x21], 22: [0x1c, 0x1d], 23: [0x1f, 0x20, 0x21],
    24: [0x1c, 0x1d], 25: [0x1e], 26: [0x1e, 0x1d, 0x1f],
  };
  const tile = (id: number): Step[] => [
    b.log(0x1088, 0x487e), ...flips[id]!.map((x) => b.swapTer(x, 0x26, 0x96, 0xa5)),
    b.setFlag(TILES_LIT, 0), ...tiles.map((x) => b.ifTer(x, 0x26, 0x96, [b.incFlag(TILES_LIT)])),
    b.ifFlagEq(TILES_LIT, 1, [b.setTer(0x26, 0x2c, 0)], [b.setTer(0x26, 0x2c, 0x5f)]),
  ];
  const noCombat = (then: Step[]): Step[] => [b.ifInCombat([b.log(0x1088, 0x4854), b.blockMove()], then)];
  /** The pushing floor moves the party one square along y. */
  const shove = (id: number, dy: number): Step[] => [b.ifInCombat([], [b.ifFlagEq(push, 1, [
    b.moveParty(b.spotAt(id).x, b.spotAt(id).y + dy), b.blockMove(),
  ])])];
  return new Map<number, Step[]>([
    ...[1, 2, 3].map((id): [number, Step[]] => [id, [b.msg(B, 0x38), b.bringIn(199 + id, 1), b.setFlag(spot(id), 20)]]),
    [8, [b.msg(B, 0x3a)]],
    [9, [b.ifFlagEq(f(0x35d), 0, [b.msg(B, 0x39), b.blockMove()])]],
    [11, [b.askDialog(0xd7e, [b.changeTown(0x49, 0x12, 0x24)]), b.blockMove()]],
    [12, [b.askDialog(0xd7e, [b.changeTown(0x49, 0x17, 6)]), b.blockMove()]],
    [14, [b.setFlag(walk, 0)]],
    [15, [b.ifFlagEq(walk, 2, noCombat([b.moveParty(0x12, 0x27), b.blockMove()]))]],
    [16, [b.ifFlagEq(walk, 1, [b.setFlag(walk, 2)])]],
    [17, [b.ifFlagEq(walk, 0, [b.setFlag(walk, 1)])]],
    [18, [b.placeFieldRect(2, 0x19, 0x12, 0x27, FieldType.WALL_BLADES)]],
    [19, noCombat([b.moveParty(8, 0x18), b.blockMove()])],
    ...[20, 21, 22, 23, 24, 25, 26].map((id): [number, Step[]] => [id, tile(id)]),
    [28, [b.setTer(0x20, 0xd, 0x5f)]],
    [29, [b.setTer(0x20, 0xd, 0)]],
    [30, shove(30, 1)], [31, shove(31, -1)],
    [32, [b.ifFlagEq(push, 0, [b.setFlag(push, 1)])]],
    [33, [b.log(0x1088, 0x4885), b.setFlag(push, 2)]],
  ]);
}

/** The Rakshasa Lair (town 73): `FUN_1088_4ceb`, block 63. */
function rakshasaLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(73, id);
  return new Map<number, Step[]>([
    ...[1, 2, 3].map((id): [number, Step[]] => [id, [b.trap(0xd7a, spot(id), 0x14)]]),
    // The room's walls sink away, once.
    [4, [b.ifTer(0xa, 7, 0x96, [], [b.msg(B, 0x3b),
      ...[0, 1, 2, 3].flatMap((k) => [b.setTer(0xa, 7 + k, 0x96), b.setTer(0x10, 7 + k, 0x96)])])]],
    [5, [b.onceMsg(spot(5), B, 0x3c)]],
    [11, [b.askDialog(0xd7f, [b.changeTown(0x48, 0x18, 0x17)]), b.blockMove()]],
    [14, [b.moveParty(0x17, 6), b.blockMove()]],
    [15, [b.setTer(0x16, 0x24, 0x75)]],
    [16, [b.ifMageLoreTotal(13, [b.msg(B, 0x3d), b.teachSpell(0xa0)], [b.msg(B, 0x3e)])]],
    [17, [b.ifMageLoreTotal(17, [b.msg(B, 0x3f), b.teachSpell(0x3d)], [b.msg(B, 0x3e)])]],
  ]);
}

/** Converter scratch: the tile that wraps round in the Drakos rotation. */
const WRAP_TILE: Flag = [291, 30];

/**
 * The Lair of Drakos (town 74): `FUN_1088_34c3`, block 63. A floor of 7×3
 * tiles, 150 and 160, whose rows spots 14–16 rotate and 17 resets; and
 * squares that move the party a set step (21–36).
 */
function drakosLair(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(74, id);
  const ON = 0x96, OFF = 0xa0;
  /** Row `y` of x 19–25 moves one square (`dir` −1 left, +1 right), wrapping. */
  const rotate = (y: number, dir: -1 | 1, literal: number): Step[] => {
    const xs = dir < 0 ? [19, 20, 21, 22, 23, 24] : [25, 24, 23, 22, 21, 20];
    const wrapFrom = dir < 0 ? 19 : 25, wrapTo = dir < 0 ? 25 : 19;
    return [
      b.log(0x1088, literal),
      b.ifTer(wrapFrom, y, ON, [b.setFlag(WRAP_TILE, 1)], [b.setFlag(WRAP_TILE, 0)]),
      ...xs.map((x) => b.ifTer(x - dir, y, ON, [b.setTer(x, y, ON)], [b.setTer(x, y, OFF)])),
      b.ifFlagEq(WRAP_TILE, 1, [b.setTer(wrapTo, y, ON)], [b.setTer(wrapTo, y, OFF)]),
    ];
  };
  /** Moved from the spot by (dx, dy). */
  const step = (id: number, dx: number, dy: number): Step[] =>
    [b.moveParty(b.spotAt(id).x + dx, b.spotAt(id).y + dy), b.blockMove()];
  const moves: [number, number, number][] = [
    [21, 0, 3], [22, 0, 3], [23, 0, -3], [24, 0, -3], [25, 5, 0], [26, 5, 0], [27, -5, 0], [28, -5, 0],
    ...[30, 31, 32, 33, 34, 35, 36].map((id): [number, number, number] => [id, 0, 2]),
  ];
  return new Map<number, Step[]>([
    [1, [b.msg(B, 0x1a), b.bringIn(200, 1), b.setFlag(spot(1), 20)]],
    [2, [b.msg(B, 0x1c), b.bringIn(202, 1), b.setFlag(spot(2), 20)]],
    [3, [b.msg(B, 0x1d), b.bringIn(201, 1), b.setFlag(spot(3), 20)]],
    [4, [b.lever([b.log(0x1088, 0x3499), b.swapTer(0x1e, 0x1f, ON, OFF), b.swapTer(0x1e, 0x21, ON, OFF)])]],
    [9, [b.askDialog(0xcc5, [b.moveParty(0x2b, 4), b.blockMove()])]],
    [11, [b.log(0x1088, 0x34a0), b.setTer(0x16, 0xb, OFF), b.setTer(0x1a, 0xb, OFF)]],
    [12, [b.askDialog(0xd7e, [b.changeTown(0x4b, 0x2a, 2)]), b.blockMove()]],
    [14, rotate(0x1c, -1, 0x34a7)],
    [15, rotate(0x1b, 1, 0x34ae)],
    [16, rotate(0x1a, -1, 0x34b5)],
    [17, [b.log(0x1088, 0x34bc), b.rectTer(0x13, 0x1a, 0x19, 0x1c, OFF),
      b.setTer(0x13, 0x1a, ON), b.setTer(0x13, 0x1c, ON), b.setTer(0x19, 0x1b, ON)]],
    ...moves.filter(([id]) => b.hasSpot(id)).map(([id, dx, dy]): [number, Step[]] => [id, step(id, dx, dy)]),
    // Past the end of the switch's table: nothing.
    [38, []],
  ]);
}

/** The Lair of Drakos, level 2 (town 75): `FUN_1088_3993`, block 63. */
function drakosLair2(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(75, id);
  return new Map<number, Step[]>([
    // Drakos's illusions fall away (creatures of kinds 58–69 go), the real
    // guards come, and "your location has suddenly changed": the party is
    // put down at (14,11), in the lava pool between the two drake lords
    // (`1088:39d6`, every PC's square in combat, the party's otherwise).
    [1, [b.dialog(0xea6), ...Array.from({ length: 12 }, (_, k) => b.removeCreatures(58 + k)),
      b.bringIn(200, 1), b.setFlag(spot(1), 20), b.moveParty(0xe, 0xb), b.blockMove()]],
    [2, []], [4, []],
    [3, [b.onceMsg(spot(3), B, 0x21)]],
    [11, [b.askDialog(0xd7f, [b.changeTown(0x4a, 0x1b, 0x1a)]), b.blockMove()]],
  ]);
}

/** The Pit of the Wyrm (town 76): `FUN_1088_4188`, block 63. */
function wyrmPit(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(76, id);
  return new Map<number, Step[]>([
    ...[1, 2, 3, 4].map((id): [number, Step[]] => [id, [b.onceMsg(spot(id), B, 0x2a + id)]]),
    [5, [b.msg(B, 0x2f, 0x30), b.bringIn(200, 1), b.setFlag(spot(5), 20)]],
    [11, [b.askDialog(0xeb1, [b.changeTown(0x4d, 5, 0x2d)]), b.blockMove()]],
  ]);
}

/**
 * The Pit of the Wyrm, level 2 (town 77): `FUN_1088_4336`, block 63. Its
 * floor puzzle is a 6×3 grid (spots 20–37 at x 16–21, y 40–42): stepping on
 * a square charged (193) zaps; otherwise the grid charges again and only
 * the squares the spot names go safe (186); three squares throw the party
 * back.
 */
function wyrmPit2(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(77, id);
  const CHARGED = 0xc1, SAFE = 0xba;
  /** The squares each spot makes safe, as (dx, dy) from it (the arms from 1088:454c on). */
  const safe: Record<number, [number, number][]> = {
    20: [[1, 0], [0, 1]], 21: [[1, 0], [0, 1]], 24: [[1, 0], [0, 1]],
    22: [[1, 0], [-1, 0]], 34: [[1, 0], [-1, 0]],
    25: [[-1, 0]], 26: [[0, 1], [0, -1]], 27: [[1, 0], [-1, 0], [0, 1]], 28: [[0, 1], [0, -1], [1, 0]],
    29: [[-1, 0], [0, -1]], 30: [[1, 0], [-1, 0], [0, -1]], 35: [[1, 0], [-1, 0], [0, -1]],
    36: [[1, 0], [-1, 0], [0, -1]], 32: [[1, 0], [0, -1]], 37: [[0, -1]],
  };
  /** The bier's first visit (flag (77,9)) decides where the throw lands. */
  const bier = f(0x38f);
  const thrown = (): Step[] => [
    b.msg(B, 0x37), b.scaleHealth(50),
    b.ifFlagEq(bier, 0, [b.moveParty(0xf, 0x2a)], [b.moveParty(0x15, 0x27)]),
    b.setTer(0x10, 0x2a, SAFE), b.setTer(0x15, 0x28, SAFE), b.blockMove(),
  ];
  const floor = (id: number): Step[] => {
    const at = b.spotAt(id);
    return [b.ifInCombat([b.log(0x1088, 0x4317), b.blockMove()], [b.ifTer(at.x, at.y, CHARGED,
      [b.msg(B, 0x36), b.e3Boom(99), b.blockMove()],
      [b.rectTer(0x10, 0x28, 0x15, 0x2a, CHARGED),
        ...(safe[id] ? safe[id].map(([dx, dy]) => b.setTer(at.x + dx, at.y + dy, SAFE)) : thrown())])])];
  };
  return new Map<number, Step[]>([
    ...[1, 2, 3, 4, 5].map((id): [number, Step[]] => [id, []]),
    [11, [b.askDialog(0xeb2, [b.changeTown(0x4c, 0x12, 0x2c)]), b.blockMove()]],
    [14, [b.ifFlagEq(bier, 0, [b.msg(B, 0x31), b.setFlag(bier, 1)]), b.setTer(0xb, 0x2d, 0xa), b.setTer(6, 0x2e, 0x10)]],
    [15, [b.lever([b.msg(B, 0x32), b.setTer(0xf, 0x2a, 0x87)])]],
    [16, [b.ifTer(0xf, 0x11, 0x8a, [b.msg(B, 0x34), ...[0x11, 0x13, 0x17, 0x19].map((y) => b.setTer(0xf, y, 0x87))])]],
    ...Array.from({ length: 18 }, (_, k): [number, Step[]] => [20 + k, floor(20 + k)]),
  ]);
}

/** The Monastery of Madness (town 78): `FUN_1088_251e`, block 63. */
function madMonastery(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(78, id);
  const click = (literal: number, x: number, y: number, t: number): Step[] => [b.log(0x1088, literal), b.setTer(x, y, t)];
  return new Map<number, Step[]>([
    // Martial arts books: +1 dexterity (to 19) for a party of 15 levels.
    [1, [b.ifMageLoreTotal(15, [b.eachPc(() => [b.ifStat(1, 19, [], [b.addStat(1, 1)])]), b.msg(B, 9), b.setFlag(spot(1), 20)],
      [b.msg(B, 0xa)])]],
    // Everyone here hunts the party.
    [2, [b.setCreature(-1, 'wake'), b.msg(B, 0xb, 0xc), b.setFlag(spot(2), 20)]],
    [3, [b.giveItemDialog(0xec6, spot(3), 0x8c)]],
    ...[4, 5, 6].map((id): [number, Step[]] => [id, [b.setFlag(spot(id), 20), b.msg(B, 0x11), b.bringIn(id + 0xc4, 1)]]),
    [11, [b.askDialog(0xec4, [b.msg(B, 2)])]],
    [14, [b.askDialog(0xd7f, [b.changeTown(0x4f, 0x12, 5)]), b.blockMove()]],
    [15, [b.askDialog(0xd7f, [b.changeTown(0x4f, 0x1d, 5)]), b.blockMove()]],
    [16, [b.askDialog(0xec5, [b.msg(B, 0xe), b.drainXp(0x14)])]],
    [20, click(0x2509, 0x18, 0x14, 2)],
    [21, click(0x2510, 0x1d, 5, 0x96)],
    [22, click(0x2517, 7, 5, 2)],
  ]);
}

/** The Monastery of Madness, level 2 (town 79), the Hall of Duels: `FUN_1088_2822`, block 63. */
function madMonastery2(b: SpecBuilder): Map<number, Step[]> {
  const B = 63, spot = (id: number) => townSpotFlag(79, id);
  /** The duel is won (flag (79,3)). */
  const won = spot(3);
  const doors: [number, number, number][] = [[8, 9, 0x65], [9, 0xa, 0x6c]];
  return new Map<number, Step[]>([
    // One champion enters the hall: the doors change behind them (undone if nobody goes).
    [1, [b.askDialog(0xece, [
      ...doors.map(([x, y, t]) => b.setTer(x, y, t)),
      b.splitParty(0xa, 0xa, doors.map(([x, y]) => b.setTer(x, y, b.terrainAt(x, y)))),
    ]), b.blockMove()]],
    [2, [b.ifFlagEq(won, 0, [b.msg(B, 0x19)], [
      b.msg(B, 0x14), b.reuniteParty(), b.setFlag(spot(1), 20), b.setFlag(spot(2), 20),
    ]), b.blockMove()]],
    [3, [b.msg(B, 0x17), b.bringIn(200, 1), b.setFlag(won, 20), b.setTer(0x11, 0xa, 0x67)]],
    [4, [b.ifFlagEq(spot(4), 0, [b.setFlag(spot(4), 1)], [b.setFlag(spot(4), 20), b.msg(B, 0x18), b.bringIn(201, 1)])]],
    // A recipe among the ravings (alchemy 16, party+0x832e).
    [11, [b.dialog(0xecf), b.learnAlchemy(16)]],
    [14, [b.askDialog(0xd7e, [b.changeTown(0x4e, 0xc, 6)]), b.blockMove()]],
    [15, [b.askDialog(0xd7e, [b.changeTown(0x4e, 0x25, 6)]), b.blockMove()]],
  ]);
}

/**
 * Which way the party came to the Wolf Pit: by the Goblin Lair (town 44,
 * zone (8,9) at (44,14)) or by the Bandit Hideout (town 45, zone (8,8) at
 * (44,41)). E3 reads the party's y in its sector instead (party+0x12e9,
 * under or over 20), which no node can, so each entrance sets this
 * (`EntranceMark`).
 */
export const WOLF_SIDE: Flag = [291, 34];
const BY_GOBLINS = 0;
const BY_BANDITS = 1;

export const WOLF_PIT_ENTRANCES: EntranceMark[] = [
  { zone: 89, loc: { x: 44, y: 14 }, flag: WOLF_SIDE, value: BY_GOBLINS },
  { zone: 80, loc: { x: 44, y: 41 }, flag: WOLF_SIDE, value: BY_BANDITS },
];

/**
 * The Wolf Pit (town 80): `FUN_10b8_0000`, block 64. Spots 12 and 16 lead
 * out by the other way: from the bandits' side to the Goblin Lair's entrance,
 * and from the goblins' side to the Bandit Hideout's.
 */
function wolfPit(b: SpecBuilder): Map<number, Step[]> {
  const up = (dlg: number, town: number, x: number, y: number): Step[] =>
    [b.askDialog(dlg, [b.changeTown(town, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    [12, [b.ifFlagEq(WOLF_SIDE, BY_BANDITS, [b.setFlag(WOLF_SIDE, BY_GOBLINS), b.exitTo(7, 8, 0x5c, 0x3e)])]],
    [14, up(0xed8, 0x2d, 8, 0xe)],
    [15, up(0xed8, 0x2c, 2, 0x18)],
    [16, [b.ifFlagEq(WOLF_SIDE, BY_GOBLINS, [b.setFlag(WOLF_SIDE, BY_BANDITS), b.exitTo(7, 8, 0x5c, 0x29)])]],
    [17, up(0xd7f, 0x2d, 0x10, 0xc)],
  ]);
}

/** The Unicorn Grotto (town 81): `FUN_10b8_02e2`, block 64. */
function unicornGrotto(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(81, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0xee2, [b.setFlag(spot(1), 20), b.msg(B, 0x15, 0x16), b.bringIn(200, 1)])]],
  ]);
}

/** The Wolfrider Warren (town 82): `FUN_10b8_1169`, block 64. */
function wolfriderWarren(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(82, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x2f)]],
    [2, [b.trap(0xd7a, spot(2), 0)]],
    [3, [b.onceMsg(spot(3), B, 0x32)]],
    [4, [b.trap(0xeec, spot(4), 0)]],
    [5, [b.trap(0xeec, spot(5), 0)]],
    [6, [b.onceMsg(spot(6), B, 0x30)]],
    [11, [b.lever([b.msg(B, 0x31), b.swapTer(0xb, 0x19, 0x8c, 0x8d), b.swapTer(0xb, 0x1a, 0x8c, 0x8d)])]],
    [12, [b.lever([b.msg(B, 0x31), b.swapTer(4, 0x14, 0x8c, 0x8d)])]],
  ]);
}

/**
 * The Distant Hut (town 85), Ernest the teleporter's: `FUN_10b8_039c`,
 * block 64. Paid (flag (85,8), set in conversation), each portal sends the
 * party to one of the five cities, and the fee is spent; a party that stole
 * his book (spot 1) goes to the Fiery Pit instead, once.
 */
function distantHut(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(85, id);
  const paid = spot(8), bookTaken = spot(1), punished = spot(7);
  /** Portal id: zone, outdoor square, then town and square. E3's shareware refused 16 on (`Not until you're registered.`); this is the freeware release. */
  const portals: Record<number, [number, number, number, number, number, number, number]> = {
    14: [1, 8, 0x44, 0x51, 0, 0x3b, 0x20], 15: [0, 6, 0xb, 0x1a, 4, 0x3b, 0x20], 16: [3, 6, 0x18, 0x1e, 8, 0x20, 5],
    17: [3, 4, 0x1c, 0x1a, 0xc, 0x22, 8], 18: [5, 2, 0x47, 0x3a, 0x10, 0x20, 4],
  };
  const portal = (id: number): Step[] => {
    const [zx, zy, ox, oy, t, x, y] = portals[id]!;
    return [b.askDialog(0xf0b, [b.ifFlagEq(punished, 0, [b.ifFlagAtLeast(bookTaken, 1, [
      b.msg(B, 0x17, 0x12), b.setFlag(punished, 1), b.exitTo(5, 7, 0x3c, 0x13), b.changeTown(0x62, 8, 1),
    ], [go()])], [go()])]), b.blockMove()];
    function go(): Step {
      return b.seq([b.msg(B, 0x12), b.setFlag(paid, 0), b.exitTo(zx, zy, ox, oy), b.changeTown(t, x, y)]);
    }
  };
  return new Map<number, Step[]>([
    // Ernest's teleportation book, once the flag (85,9) says it's there.
    [1, [b.ifFlagAtLeast(spot(9), 1, [b.giveItemDialog(0xf0a, bookTaken, 0, 334)], [b.msg(B, 0x11)])]],
    [2, [b.ifFlagEq(paid, 0, [b.msg(B, 0x14), b.blockMove()], [b.msg(B, 0x13)])]],
    ...[14, 15, 16, 17, 18].map((id): [number, Step[]] => [id, portal(id)]),
  ]);
}

/** The Murder Cave (town 86), near New Formello: `FUN_10b8_0117`, block 64. */
function murderCave(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(86, id);
  /** An ambush, once: messages, and a group brought in. */
  const ambush = (id: number, text: Step, code: number): Step[] =>
    [b.ifFlagEq(spot(id), 0, [text, b.setFlag(spot(id), 20), b.bringIn(code, 1)])];
  return new Map<number, Step[]>([
    [1, ambush(1, b.msg(B, 3, 4), 200)],
    [2, ambush(2, b.msg(B, 6), 201)],
    // Fireball traps, (id + 2)d6.
    ...[3, 4, 5].map((id): [number, Step[]] => [id, [b.log(0x10b8, 0x108), b.e3Boom(id + 2)]]),
    [6, ambush(6, b.msg(B, 8), 202)],
    // The evidence of the murders: the key (special item 10), and the
    // roaches' time is up (flag 0xc90 to 4).
    [7, [b.dialog(0xf15), b.giveSpecItem(partySpecItem(0x20)), b.setFlag(spot(7), 20), b.journal(0x14),
      b.setFlag(f(0xc90), 4)]],
    [11, [b.dialog(0xf14)]],
  ]);
}

/** The Crystal Tunnel (town 87): `FUN_10b8_1097`, block 64. */
function crystalTunnel(b: SpecBuilder): Map<number, Step[]> {
  return new Map<number, Step[]>([1, 2, 3].map((id): [number, Step[]] => [id, [b.dialog(id + 0xf1d)]]));
}

/** The Spiral Crypt (town 88), Gorvifal's: `FUN_10b8_0608`, block 64. */
function spiralCrypt(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(88, id);
  /** How many of the four switches have been trodden on (flag (88,2)); Gorvifal taunts at 2 and 5. */
  const count = spot(2);
  const doors: Record<number, [[number, number], [number, number]]> = {
    6: [[2, 0xb], [9, 0x1d]], 7: [[0x11, 4], [2, 0xb]], 8: [[9, 0x1d], [0x1d, 0x14]], 9: [[0x1d, 0x14], [0x11, 4]],
  };
  const button = (x: number, y: number, t: number): Step[] =>
    [b.askDialog(0xf28, [b.msg(B, 0x1f), b.setTer(x, y, t)])];
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x22)]],
    [2, []], [3, []],
    // Each switch closes one door and opens the next.
    ...[6, 7, 8, 9].map((id): [number, Step[]] => {
      const [[cx, cy], [ox, oy]] = doors[id]!;
      return [id, [b.setTer(cx, cy, 0x6c), b.setTer(ox, oy, 0x6d), b.incFlag(count),
        b.ifFlagEq(count, 2, [b.msg(B, 0x23)]), b.ifFlagEq(count, 5, [b.msg(B, 0x24)])]];
    }),
    [14, button(0x11, 7, 0x96)],
    [15, button(7, 0xc, 0x96)],
    [16, button(3, 0x10, 0xf5)],
  ]);
}

/** Guhkbar's Pit (town 89), a giant's, with the dryad Illyree in a cell: `FUN_10b8_0856`, block 64. */
function guhkbarsPit(b: SpecBuilder): Map<number, Step[]> {
  const B = 64, spot = (id: number) => townSpotFlag(89, id);
  const rustyKey = partySpecItem(0x22);
  return new Map<number, Step[]>([
    // A tiny glowing person: leave, attack, or talk (which opens a way).
    [1, [b.ifTer(0x16, 7, 0xa, [], [b.choiceDialog(0xf32,
      [b.msg(B, 0x26), b.setFlag(spot(1), 20)],
      [b.msg(B, 0x27, 0x28), b.setTer(4, 0x1b, 0xa), b.setTer(6, 0x1a, 0)],
      [b.msg(B, 0x25)])])]],
    [2, [b.onceMsg(spot(2), B, 0x2d, 0x2e)]],
    // The alarm wakes the giant (creature 0).
    ...[3, 4].map((id): [number, Step[]] => [id, [b.askDialog(0xf33,
      [b.setFlag(spot(id), 20), b.msg(B, 0x2b), b.setCreature(0, 'wake')], [b.blockMove()])]]),
    [5, [b.askDialog(0xf33, [b.askDialog(0xf34, [b.setFlag(spot(5), 20), b.giveSpecItem(rustyKey)])])]],
    // The cell: the key frees Illyree, who deals with the giant herself
    // (creature 0 takes 1000, `FUN_10c0_4af4`) and leaves (creature 25).
    [11, [b.ifTer(0xe, 3, 0x6a, [b.ifSpecItem(rustyKey, [
      b.setTer(0xe, 3, 0x67), b.setTer(0x16, 0x13, 0x6d), b.dialog(0xf35),
      b.setFlag(spot(8), 1), b.setFlag(spot(1), 20), b.setFlag(spot(2), 20),
      b.removeCreatureSlots([0, 25]), b.xp(10),
    ], [b.msg(B, 0x29)])])]],
  ]);
}

/**
 * A town with no case in the town handler's switch (`FUN_10c0_0000`): its
 * spots below 100 do nothing, and say so here rather than stay unlisted.
 */
const noHandler = (): Map<number, Step[]> => new Map(Array.from({ length: 100 }, (_, id): [number, Step[]] => [id, []]));

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
  [50, golddaleMines],
  [51, ursagiLair],
  [52, vahkohsTomb],
  [53, trogloTemple],
  [54, concealedTunnel],
  [55, giantsForge],
  [56, woodsyTower],
  [57, sulfrasLair],
  [58, chasmOfScreams],
  [59, defiledCrypt],
  [61, guardedTunnel],
  [62, greatCircle],
  [63, newFactory],
  [65, genericDungeon],
  [70, zkal],
  [71, zkal2],
  [72, remoteCave],
  [73, rakshasaLair],
  [74, drakosLair],
  [75, drakosLair2],
  [76, wyrmPit],
  [77, wyrmPit2],
  [78, madMonastery],
  [79, madMonastery2],
  [80, wolfPit],
  [81, unicornGrotto],
  [82, wolfriderWarren],
  [85, distantHut],
  [86, murderCave],
  [87, crystalTunnel],
  [88, spiralCrypt],
  [89, guhkbarsPit],
  // "Name" and "Anim Data": towns E3's handler has no case for.
  [20, noHandler],
  [66, noHandler],
  [84, noHandler],
  [97, sacredItem(97)],
]);
