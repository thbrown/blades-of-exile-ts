/**
 * Exile 3's outdoor encounters, zone by zone: the arms of the outdoor
 * handler's switch on the zone. Zones below 21 are in `FUN_10a0_0062`, 21–44
 * in `FUN_10a0_1595`, 45–79 in `FUN_10a8_0100` and the rest in
 * `FUN_10a8_2acc` (the split is in the caller, `exile3.c` near line 59350).
 * A zone's message block is `zone / 10 + 80`.
 */

import type { PlaceScript } from '../specials';
import { partyFlag as f, partySpecItem, zoneSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';
import { Race, Skill, Trait } from '../../../src/universe/skills';
import { E3ShopType } from '../shops';

const block = (zone: number) => Math.floor(zone / 10) + 80;

/** An ember-flower-style herb patch: a word once `have` is set, else the find. */
function herb(b: SpecBuilder, B: number, have: number, already: number, dlg: number, item: number): Step {
  return b.ifFlagAtLeast(f(have), 1, [b.msg(B, already)], [b.giveItemDialog(dlg, f(have), item)]);
}

/**
 * `FUN_10c0_482d`: a stone circle (its argument, which circle, goes unused).
 * `f(0xb41)` counts the altars knelt at, and the more there have been, the
 * less the party can refuse the next. Kneeling gives the next boon (block
 * 87, or 83 for the fourth and fifth), the circle vanishes, and `then` runs
 * (E3's return of 1).
 */
function stoneCircle(b: SpecBuilder, then: Step[]): Step {
  const knelt = f(0xb41), B = 87;
  const kneel: Step[] = [b.msg(B, 0x37), b.incFlag(knelt), b.switchFlag(knelt, [
    [],
    [b.msg(B, 0x38), b.teachSpell(0x80)],
    [b.msg(B, 0x39), b.teachSpell(0x21)],
    // All six slots, living or not, gain a point of Dexterity below 18.
    [b.msg(B, 0x3a), b.eachPc(() => [b.ifStat(Skill.DEXTERITY, 18, [], [b.addStat(Skill.DEXTERITY, 1)])])],
    [b.msg(83, 0xd), b.xp(0x28)],
    [b.msg(83, 0xe, 0xf), b.teachSpell(0x38), b.teachSpell(0x3d)],
  ]), b.msg(B, 0x3d), ...then];
  // At the altar: walk away (not after two circles), kneel, or smash it (not after three).
  const altar = b.choiceDialog(0x166d, kneel,
    [b.ifFlagBelow(knelt, 3, [b.msg(B, 0x40)], [b.msg(B, 0x3c), ...kneel])],
    [b.ifFlagBelow(knelt, 2, [b.msg(B, 0x36)], [b.msg(B, 0x3c), ...kneel])]);
  // Enter, or walk on, which after four circles the party can't.
  return b.askDialog(0x166c, [altar], [b.ifFlagBelow(knelt, 4, [b.msg(B, 0x35)], [b.msg(B, 0x3b), altar])]);
}

/** Zone 0 (0,0): the far northwestern swamp. */
function zone0(b: SpecBuilder): Map<number, Step[]> {
  const Z = 0, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // The ember flowers, then (every visit, once only) the swamp denizens.
    [1, [herb(b, B, 0xc4b, 0x16, 0x1388, 0x185), b.onceEncounter(spot(9), B, 0x17, 0, 0)]],
  ]);
}

/** Zone 1 (1,0): the valley of the stone circle, whose pull is stronger once `f(0xb41)` reaches 4. */
function zone1(b: SpecBuilder): Map<number, Step[]> {
  const Z = 1, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** Until slot 9 is set: the stronger message once `f(0xb41)` reaches 4. */
  const pull = (id: number, weak: number, strong: number): Step[] => [b.ifFlagEq(spot(9), 0, [
    b.ifFlagAtLeast(f(0xb41), 4, [b.msg(B, strong)], [b.msg(B, weak)]), b.setFlag(spot(id), 20),
  ])];
  return new Map<number, Step[]>([
    [1, pull(1, 0x23, 0x22)],
    [2, pull(2, 0x25, 0x24)],
    // The whispering turns the party back. E3 marks the spot only once slot 9
    // is set, which is the other way round from its neighbours; kept
    // (E3-SUSPECTED-BUGS.md #3).
    [3, [b.ifFlagEq(spot(9), 0, [b.ifFlagAtLeast(f(0xb41), 4, [b.msg(B, 0x26), b.blockMove()])], [b.setFlag(spot(3), 20)])]],
    [4, pull(4, 0x28, 0x27)],
  ]);
}

/** Zone 2 (2,0): the six-legged beasts' pack, and the guards they killed. */
function zone2(b: SpecBuilder): Map<number, Step[]> {
  const Z = 2, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** Go on (and fight, once), or turn back. */
  const pack = (id: number, dlg: number, msg: number): Step[] =>
    [b.askDialog(dlg, [b.onceEncounter(spot(id), B, msg, 0, 0)], [b.blockMove()])];
  return new Map<number, Step[]>([
    [1, pack(1, 0x139c, 0x29)],
    [2, pack(2, 0x139c, 0x29)],
    [3, pack(3, 0x139c, 0x29)],
    [4, pack(4, 0x139d, 0x2a)],
    // The guards' bodies: taking the ring and gold brings the beasts (group 1).
    // E3 clears the flag the dialog set so that the encounter's own check passes.
    [5, [b.giveItemDialog(0x139e, spot(5), 0x141, 0x960), b.ifFlagAtLeast(spot(5), 1, [
      b.setFlag(spot(5), 0), b.onceEncounter(spot(5), B, 0x2b, 0, 1),
    ])]],
  ]);
}

/** Zone 3 (3,0): the northern plains, below the Empire's fortress. */
function zone3(b: SpecBuilder): Map<number, Step[]> {
  const Z = 3, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc4a, 0x11, 0x13a6, 0x181)]],
    [2, [b.onceMsg(spot(2), B, 0x12, 0x13)]],
    [3, [b.onceMsg(spot(3), B, 0x14, 0x15)]],
  ]);
}

/** Zone 4 (4,0): the stranded Third Empire Army, and a shade. */
function zone4(b: SpecBuilder): Map<number, Step[]> {
  const Z = 4, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** The army turns the party back, fighting it the first time. */
  const army = (id: number): Step[] =>
    [b.onceEncounter(spot(id), B, 0xd, 0, 0), b.setFlag(spot(id), 0), b.blockMove()];
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x13b0, [b.onceEncounter(spot(1), B, 0xc, 0, 0)], [b.dialog(0x13b1), b.setFlag(spot(1), 20)])]],
    [2, army(2)],
    [3, [herb(b, B, 0xc49, 0x21, 0x13b2, 0x182)]],
    // The shade: listen (it tells of Footracer) or turn away.
    [4, [b.askDialog(0x13b3, [b.msg(B, 0xf, 0x10)], [b.msg(B, 0xe)]), b.setFlag(spot(4), 20)]],
    [5, army(5)],
  ]);
}

/** Zone 5 (5,0): Vilovsky's temple, and the northern herbs. */
function zone5(b: SpecBuilder): Map<number, Step[]> {
  const Z = 5, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // The temple never lets the party onto its square. Anama rings (flag
    // (4,0) at 3) shut its gates; a second visit is only a welcome; the
    // first costs 5,000 gold for two priest spells and, for each PC with the
    // skill from 1 to 6, a coin flip's rise in Alchemy (skill 12, +0x2e) —
    // which the message calls Mage Lore (E3-SUSPECTED-BUGS.md #1). E3 flips
    // `get_ran(1, 0, 1)`.
    [1, [b.askDialog(0x13ba, [
      b.ifFlagEq(f(0xac), 3, [b.msg(B, 9)], [
        b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 7)], [b.askDialog(0x13bb, [b.pay(5000, [
          b.msg(B, 5, 6), b.teachSpell(0x97), b.teachSpell(0x9d), b.setFlag(spot(1), 1),
          b.eachPc(() => [b.ifStat(Skill.ALCHEMY, 1, [b.ifStat(Skill.ALCHEMY, 7, [], [
            b.ifCoinFlip([b.addStat(Skill.ALCHEMY, 1)]),
          ])])]),
        ], [b.log(0x10a0, 0)])])]),
      ]),
    ]), b.blockMove()]],
    [2, [herb(b, B, 0xc48, 8, 0x13bc, 0x186)]],
    [3, [b.askDialog(0x13bd, [b.onceEncounter(spot(3), B, 0, 0, 0)], [b.blockMove()])]],
  ]);
}

/** Zone 6 (6,0). */
function zone6(b: SpecBuilder): Map<number, Step[]> {
  const B = block(6);
  return new Map<number, Step[]>([[1, [herb(b, B, 0xc46, 1, 0x13c4, 0x183)]]]);
}

/** Zone 7 (7,0): the great fungus cavern, where monsters wander. */
function zone7(b: SpecBuilder): Map<number, Step[]> {
  const Z = 7, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const wander = (id: number): [number, Step[]] => [id, [b.wanderingMonster(), b.setFlag(spot(id), 20)]];
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x2e, 0x2f)]],
    wander(2), wander(3), wander(4), wander(5), wander(6), wander(7),
  ]);
}

/** Zone 8 (8,0): Vahnatai country. */
function zone8(b: SpecBuilder): Map<number, Step[]> {
  const Z = 8, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x30, 0, 0)]],
    // The spring: drink and be healed by 100.
    [2, [b.askDialog(0x13d8, [b.msg(B, 0x31, 0x32), b.heal(100), b.setFlag(spot(2), 20)])]],
    [3, [b.onceMsg(spot(3), B, 0x33)]],
  ]);
}

/** Zone 9 (0,1): the dark forest, its gremlins, and the slime valley. */
function zone9(b: SpecBuilder): Map<number, Step[]> {
  const Z = 9, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /**
   * The gremlins ask for food. 100 food (party+8) buys them off; less, and
   * they eat it all and fight anyway, as does a refusal. Spot 4's are group 1.
   */
  const gremlins = (id: number): Step[] => [b.askDialog(0x13e2, [b.ifTakeFood(100, [b.msg(B, 0x1d)], [
    b.msg(B, 0x1f), b.takeAllFood(), b.onceEncounter(spot(id), B, 0, 0, id >= 4 ? 1 : 0), b.setFlag(spot(id), 20),
  ])], [b.msg(B, 0x1e), b.onceEncounter(spot(id), B, 0, 0, id >= 4 ? 1 : 0), b.setFlag(spot(id), 20)])];
  /** Spot 6, where the path out opens. */
  const pathOut: Step[] = [b.setTer(0x17, 3, 2), b.setTer(0x17, 2, 2),
    b.ifFlagEq(spot(6), 0, [b.msg(B, 0x1a), b.setFlag(spot(6), 1)])];
  return new Map<number, Step[]>([
    // The path closes behind the party.
    [1, [b.setTer(0x17, 0xd, 0x5b), b.msg(B, 0x19), b.setFlag(spot(1), 20)]],
    [2, gremlins(2)],
    [3, gremlins(3)],
    [4, gremlins(4)],
    // The slime valley's creatures (group 2); E3's case falls through into 6's.
    [5, [b.onceEncounter(spot(5), B, 0x1b, 0, 2), ...pathOut]],
    [6, pathOut],
  ]);
}

/** Zone 10 (1,1): the icy valley below the caldera, and the Vahnatai's beasts. */
function zone10(b: SpecBuilder): Map<number, Step[]> {
  const Z = 10, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Three groups in turn, the flag cleared between so that each fires.
    [1, [b.onceEncounter(spot(1), B, 0x1f, 0x20, 0), b.setFlag(spot(1), 0),
      b.onceEncounter(spot(1), B, 0, 0, 1), b.setFlag(spot(1), 0), b.onceEncounter(spot(1), B, 0, 0, 2)]],
    // Block 80's line, as E3 pushes it, though this zone's block is 81
    // (E3-SUSPECTED-BUGS.md #4).
    [2, [b.askDialog(0x139d, [b.onceEncounter(spot(2), 80, 0x2a, 0, 3)], [b.blockMove()])]],
  ]);
}

/** Zone 11 (2,1): holly, and a magical wall something is breaking through. */
function zone11(b: SpecBuilder): Map<number, Step[]> {
  const Z = 11, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc4c, 0x1b, 0x13f6, 0x180)]],
    [2, [b.askDialog(0x13f7, [b.onceEncounter(spot(2), B, 0x1d, 0, 0)], [b.msg(B, 0x1c), b.setFlag(spot(2), 20)])]],
  ]);
}

/** Zone 12 (3,1): the gates of Footracer Province. */
function zone12(b: SpecBuilder): Map<number, Step[]> {
  const Z = 12, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1400, spot(1), 0x177)]],
    // Closed until zone 20's slot 9 is set; then they open onto the beasts.
    [2, [b.ifFlagEq(zoneSpotFlag(20, 9), 0, [b.dialog(0x1450), b.blockMove()],
      [b.dialog(0x1451), b.onceEncounter(spot(9), B, 0x1e, 0, 0)])]],
  ]);
}

/** Zone 13 (4,1). */
function zone13(b: SpecBuilder): Map<number, Step[]> {
  const Z = 13, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // A cave of six-legged beasts: go in, or turn back.
    [1, [b.askDialog(0x140a, [b.onceEncounter(spot(1), B, 0x19, 0, 0)], [b.blockMove()])]],
    [2, [b.giveItemDialog(0x140b, spot(2), 0x48, 0x8ca)]],
    [3, [b.giveItemDialog(0x140c, spot(3), 0, 0x151)]],
  ]);
}

/** Zone 14 (5,1): the golems' clearing. */
function zone14(b: SpecBuilder): Map<number, Step[]> {
  const Z = 14, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** Leave, sneak past (any living Woodsman), or fight. */
  const guards = (id: number): Step[] => [b.choiceDialog(0x1414,
    [b.ifTrait(Trait.WOODSMAN, [b.msg(B, 0x15), b.setFlag(spot(id), 20)], [b.onceEncounter(spot(id), B, 0x16, 0, 0)])],
    [b.onceEncounter(spot(id), B, 0, 0, 0), b.blockMove()],
    [b.blockMove()])];
  return new Map<number, Step[]>([
    // Once the Tower of Shifting Floors (town 32) shows on the map, the
    // party makes it out (0x13) and the spot is marked (10a0:0ee4).
    [1, [b.ifTownVisible(32, [b.msg(B, 0x13), b.setFlag(spot(1), 20)], [b.msg(B, 0x14)])]],
    [2, guards(2)],
    [3, guards(3)],
  ]);
}

/** Converter scratch: how many of zone 15's finds the party has taken. */
const FIND_COUNT: Flag = [291, 31];

/** Zone 15 (6,1). */
function zone15(b: SpecBuilder): Map<number, Step[]> {
  const Z = 15, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const lair = (id: number): Step[] => [b.askDialog(0x141e, [b.onceEncounter(spot(id), B, 0xd, 0, 0)], [b.blockMove()])];
  return new Map<number, Step[]>([
    [1, lair(1)],
    // Item 0x189, as many as the party can carry, up to ten.
    [2, [b.askDialog(0x141f, [b.giveItemUntilFull(0x189, 10, FIND_COUNT), b.setFlag(spot(2), 20)])]],
    [3, lair(3)],
    [4, [herb(b, B, 0xc47, 0x10, 0x1420, 0x180)]],
  ]);
}

/** Zone 16 (7,1). */
function zone16(b: SpecBuilder): Map<number, Step[]> {
  const Z = 16, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1428, spot(1), 0x101, 0x514)]],
    [2, [b.onceEncounter(spot(2), B, 0x21, 0x26, 0)]],
  ]);
}

/** Zone 17 (8,1). */
function zone17(b: SpecBuilder): Map<number, Step[]> {
  const Z = 17, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x1432, [b.onceEncounter(spot(1), B, 0, 0, 0)], [b.blockMove()])]],
    // The same group from the other side, which marks spot 1's flag.
    [2, [b.msg(B, 0x24), b.ifFlagEq(spot(1), 0, [b.askDialog(0x1432,
      [b.onceEncounter(spot(2), B, 0, 0, 0), b.setFlag(spot(1), 20)], [b.blockMove()])])]],
  ]);
}

/** Zone 18 (0,2). */
function zone18(b: SpecBuilder): Map<number, Step[]> {
  const Z = 18, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc57, 1, 0x143c, 0x185)]],
    [2, [b.askDialog(0x143d, [b.onceEncounter(spot(2), B, 2, 0, 0)], [b.msg(B, 3), b.blockMove()])]],
  ]);
}

/** Zone 19 (1,2). */
function zone19(b: SpecBuilder): Map<number, Step[]> {
  const Z = 19, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 9)], [b.msg(B, 5, 6), b.setFlag(spot(1), 1)])]],
    [2, [b.giveItemDialog(0x1446, spot(2), 0x13c, 0xa28)]],
    [3, [b.onceEncounter(spot(3), B, 7, 0, 0)]],
    [4, [b.onceEncounter(spot(4), B, 0xa, 0, 1)]],
    // A riddle, three literal lines: "When the end is near ..." and on.
    [11, [b.log(0x10a0, 0x19), b.log(0x10a0, 0x32), b.log(0x10a0, 0x4c)]],
  ]);
}

/** Zone 20 (2,2): Footracer's gates from the inside, the same test as zone 12's. */
function zone20(b: SpecBuilder): Map<number, Step[]> {
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(zoneSpotFlag(20, 9), 0, [b.dialog(0x1450), b.blockMove()], [b.dialog(0x1451)])]],
  ]);
}

/** Zone 23 (5,2): deserters, eye beasts, golems, and a hidden Empire camp. */
function zone23(b: SpecBuilder): Map<number, Step[]> {
  const Z = 23, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** The eye beasts: a refusal, or a purse short of 300, means a fight. */
  const eyeBeasts: Step[] = [b.onceEncounter(spot(3), B, 0x1d, 0, 1)];
  return new Map<number, Step[]>([
    // The deserters' fort: fight them (slot 9), then loot it (food 150).
    [1, [b.ifFlagEq(spot(9), 0, [b.askDialog(0x146e, [b.onceEncounter(spot(9), B, 0, 0, 0)])],
      [b.giveItemDialog(0x146f, spot(1), 0x4d, 0x47e)])]],
    // The slime valley's warning (0x1b, once), only once town 76 shows on
    // the map (10a0:17c9).
    [2, [b.ifTownVisible(76, [b.onceMsg(spot(2), B, 0x1b)])]],
    [3, [b.blockMove(), b.choiceDialog(0x1470, [b.pay(300, [b.msg(B, 0x1c)], eyeBeasts)], eyeBeasts, eyeBeasts)]],
    [4, [b.onceEncounter(spot(4), B, 0x1e, 0, 2)]],
    // Dervish Merchant's camp (spot 5's flag): 1 carrying his scroll to
    // Baziron (special item 49), 3 refused him. Its 2, a welcome back after
    // the delivery, is never set (E3-SUSPECTED-BUGS.md #5).
    [5, [b.switchFlag(spot(5), [
      [b.askDialog(0x1471, [b.askDialog(0x1472, [
        b.setFlag(spot(5), 1), b.giveSpecItem(partySpecItem(0x6e)), b.msg(B, 0x28),
      ], [b.setFlag(spot(5), 3), b.msg(B, 0x20)])], [b.dialog(0x1473)]), b.blockMove()],
      [],
      [b.msg(B, 0x1f), b.heal(200), b.blockMove()],
      [b.msg(B, 0x29), b.blockMove()],
    ])]],
  ]);
}

/** Zone 24 (6,2). */
function zone24(b: SpecBuilder): Map<number, Step[]> {
  const Z = 24, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const pass = (id: number): [number, Step[]] =>
    [id, [b.blockMove(), b.askDialog(0x1478, [b.onceEncounter(spot(id), B, 0x23, 0, 0)])]];
  return new Map<number, Step[]>([
    pass(1), pass(2), pass(3),
    // Turning away here is for good.
    [4, [b.askDialog(0x1479, [b.onceEncounter(spot(4), B, 0x24, 0, 1)], [b.setFlag(spot(4), 20)])]],
    [5, [b.onceMsg(spot(5), B, 0x27)]],
  ]);
}

/** Zone 27 (0,3): a treasure (600 gold) with its guards, and a potion seller. */
function zone27(b: SpecBuilder): Map<number, Step[]> {
  const Z = 27, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1496, spot(1), 0x6d, 0xa28), b.onceEncounter(spot(9), B, 2, 0, 0)]],
    [2, [b.blockMove(), b.askDialog(0x1497, [b.askDialog(0x1498,
      [b.shop(E3ShopType.GENERAL, 0xc1, 0xc4, 1, 0x10a0, 0x152b)], [b.msg(B, 3)])])]],
  ]);
}

/**
 * Zone 28 (8,2): shades, and the Vahnatai envoy (slot 9: 2 sent with his
 * message to zone 37, 5 turned away).
 */
function zone28(b: SpecBuilder): Map<number, Step[]> {
  const Z = 28, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x14a0, [b.onceEncounter(spot(1), B, 5, 0, 0)], [b.msg(B, 0x12)]), b.setFlag(spot(1), 20)]],
    [2, [b.onceMsg(spot(2), B, 0xd)]],
    [3, [b.ifFlagAtLeast(spot(9), 1, [b.blockMove(), b.choiceDialog(0x14a1,
      [b.dialog(0x14a2), b.setFlag(spot(9), 2), b.setFlag(spot(3), 20)],
      [b.msg(B, 8, 9), b.setFlag(spot(3), 20), b.setFlag(spot(9), 5)],
      [b.msg(B, 0xa)])])]],
    [4, [b.onceMsg(spot(4), B, 6, 7)]],
    [5, [b.askDialog(0x14a0, [b.msg(B, 0xb, 0xc)], [b.msg(B, 0x12)]), b.setFlag(spot(5), 20)]],
  ]);
}

/** Zone 29 (2,3): a find that is usually there again, and an archery trainer. */
function zone29(b: SpecBuilder): Map<number, Step[]> {
  const Z = 29, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Four times in five (`get_ran(1, 0, 4) < 4`) the spot is cleared again.
    [1, [b.giveItemDialog(0x14aa, spot(1), 0xb5), b.ifChance(80, [b.setFlag(spot(1), 0)])]],
    // 3,000 gold for a point of Archery, up to 13.
    [2, [b.askDialog(0x14ab, [b.blockMove(), b.ifGold(3000, [b.choosePc([
      b.ifStat(Skill.ARCHERY, 13, [b.log(0x10a0, 0x1549)],
        [b.takeGold(3000), b.addStat(Skill.ARCHERY, 1), b.log(0x10a0, 0x1569)]),
    ])], [b.log(0x10a0, 0x1538)])])]],
  ]);
}

/** Zone 30 (3,3): a stone circle, and more. */
function zone30(b: SpecBuilder): Map<number, Step[]> {
  const Z = 30, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [stoneCircle(b, [b.setFlag(spot(1), 20)]), b.blockMove()]],
    [2, [b.onceEncounter(spot(2), B, 0x10, 0, 0)]],
    [3, [b.askDialog(0x14b4, [b.dialog(0x14b5)])]],
    [4, [b.giveItemDialog(0x14b6, spot(4), 0x15b)]],
    [5, [b.onceEncounter(spot(5), B, 0x11, 0, 1)]],
    // Special item 44.
    [6, [b.giveItemDialog(0x14b7, spot(6), 0, 0x158)]],
  ]);
}

/** Zone 31 (4,3). */
function zone31(b: SpecBuilder): Map<number, Step[]> {
  const Z = 31, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.setFlag(spot(1), 20), b.askDialog(0x14be, [b.msg(B, 0x13)], [b.msg(B, 0x12)])]],
    [2, [b.giveItemDialog(0x14bf, spot(2), 0x9c)]],
    [3, [b.onceEncounter(spot(3), B, 0x14, 0, 0)]],
  ]);
}

/** Zone 32 (5,3): a guarded hoard, a stone circle, and a herb field. */
function zone32(b: SpecBuilder): Map<number, Step[]> {
  const Z = 32, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const guards: Step[] = [b.onceEncounter(spot(9), B, 0x23, 0, 1)];
  const field = (id: number): [number, Step[]] =>
    [id, [b.askDialog(0x14ca, [b.onceEncounter(spot(id), B, 0x26, 0, 2)])]];
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x22, 0, 0)]],
    // Once its guards (slot 9) are beaten, the hoard: 1,500 gold and up to
    // ten of item 0x19a. Until then, leave, talk (which only (0,0x119)'s
    // answer gets past) or fight.
    [2, [b.ifFlagAtLeast(spot(9), 1, [b.askDialog(0x14c9, [
      b.gold(1500), b.giveItemUntilFull(0x19a, 10, FIND_COUNT), b.setFlag(spot(2), 20),
    ])], [b.blockMove(), b.choiceDialog(0x14c8,
      [b.ifFlagAtLeast(f(0x119), 1, [b.msg(B, 0x27, 0x31)], guards)],
      guards)])]],
    [3, [stoneCircle(b, [b.setFlag(spot(3), 20)]), b.blockMove()]],
    [4, [b.askDialog(0x14ca, [b.msg(B, 0x24)])]],
    // Ten of item 0x194, as many as there is room for.
    [5, [b.askDialog(0x14ca, [b.msg(B, 0x25), b.setFlag(spot(5), 20),
      ...Array.from({ length: 10 }, () => b.giveItem(0x194))])]],
    field(6), field(7),
  ]);
}

/** Zone 33 (6,3). */
function zone33(b: SpecBuilder): Map<number, Step[]> {
  const Z = 33, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x14d2, [b.onceEncounter(spot(1), B, 0x29, 0, 0)], [b.msg(B, 0x28)]), b.setFlag(spot(1), 20)]],
    [2, [b.onceMsg(spot(2), B, 0x2b, 0x2c)]],
    [3, [b.giveItemDialog(0x14d3, spot(3), 0x186)]],
    [4, [b.onceEncounter(spot(4), B, 0x32, 0, 1)]],
    [5, [b.onceMsg(spot(5), B, 0x2f, 0x30)]],
  ]);
}

/** Zone 36 (0,4). */
function zone36(b: SpecBuilder): Map<number, Step[]> {
  const Z = 36, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const group = (id: number, a: number, g: number): [number, Step[]] => [id, [b.onceEncounter(spot(id), B, a, 0, g)]];
  return new Map<number, Step[]>([
    // Everyone poisoned by 6 (each PC in turn, `poison_pc`), then the fight.
    [1, [b.askDialog(0x14f0, [b.poisonAll(6), b.onceEncounter(spot(1), B, 0x17, 0x18, 0)])]],
    group(2, 0x19, 1), group(3, 0x19, 1), group(4, 0x1a, 2), group(5, 0x1a, 2),
    [6, []],
  ]);
}

/** Zone 37 (1,4): where the Vahnatai envoy from zone 28 sends the party. */
function zone37(b: SpecBuilder): Map<number, Step[]> {
  const Z = 37, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const envoy = zoneSpotFlag(28, 9), other = zoneSpotFlag(72, 3);
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(other, 1, [b.msg(B, 0x1b)])]],
    [2, [b.ifFlagEq(other, 1, [b.giveItemDialog(0x14fa, spot(2), 0x15a)])]],
    [3, [b.ifFlagEq(envoy, 2, [b.askDialog(0x14fb, [b.onceEncounter(spot(3), B, 0, 0, 1), b.setFlag(envoy, 3)])])]],
    [4, [b.askDialog(0x14fc, [b.onceEncounter(spot(4), B, 0x1d, 0, 0)])]],
    [5, [herb(b, B, 0xc58, 0x1e, 0x14fd, 0x184)]],
  ]);
}

/** Zone 38 (2,4). */
function zone38(b: SpecBuilder): Map<number, Step[]> {
  const Z = 38, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 1, 0, 0)]],
    [2, [b.onceEncounter(spot(2), B, 2, 0, 1)]],
    [3, [b.onceEncounter(spot(3), B, 1, 0, 0)]],
    [4, [b.onceEncounter(spot(4), B, 2, 0, 1)]],
    [8, [b.giveItemDialog(0x1504, spot(8), 0x13b)]],
  ]);
}

/** Zone 39 (3,4): an Empire checkpoint, and the farms giants flatten by day. */
function zone39(b: SpecBuilder): Map<number, Step[]> {
  const Z = 39, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /**
   * The checkpoint. Once slot 9 is set, the next crossing brings a fight
   * (once only, under slot 0) and clears it. Otherwise: talk your way past
   * (1, blocked), be searched (2: special item 40 is contraband, and brings
   * a fight; without it the party is waved on), or fight (3); a fight clears the spot's own flag so that it can fire again.
   */
  const checkpoint = (id: number): [number, Step[]] => [id, [b.ifFlagAtLeast(spot(9), 1, [
    b.setFlag(spot(9), 0), b.onceEncounter(spot(0), B, 0x15, 0, 0),
  ], [b.choiceDialog(0x150e,
    [b.ifSpecItem(partySpecItem(0x5c), [b.setFlag(spot(9), 1), b.onceEncounter(spot(id), B, 0xa, 0, 0), b.setFlag(spot(id), 0)],
      [b.msg(B, 9)])],
    [b.setFlag(spot(9), 1), b.onceEncounter(spot(id), B, 8, 0, 0), b.setFlag(spot(id), 0)],
    [b.msg(B, 7), b.blockMove()])])]];
  /** A farm, flattened from E3's day `day` (`FUN_10d0_54b8(day, 2)`). */
  const farm = (day: number, then: Step[]): Step[] =>
    [b.blockMove(), b.ifE3DayReached(day, 2, [b.msg(B, 0xc)], then)];
  return new Map<number, Step[]>([
    checkpoint(1), checkpoint(2), checkpoint(3),
    [4, farm(150, [b.askDialog(0x150f, [b.shop(E3ShopType.FOOD, 0, 9, 0, 0x10a0, 0x157b)])])],
    [5, farm(180, [b.askDialog(0x1510, [b.shop(E3ShopType.GENERAL, 0xf0, 0xf1, 5, 0x10a0, 0x158b)])])],
  ]);
}

/** Zone 40 (4,4): the dryad glade, whose trees move the party on. */
function zone40(b: SpecBuilder): Map<number, Step[]> {
  const Z = 40, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x1518, [b.onceEncounter(spot(1), B, 0, 0, 0)],
      [b.msg(B, 0x25), b.setFlag(spot(1), 20), b.blockMove()])]],
    [2, [b.ifFlagAtLeast(spot(9), 1, [b.msg(B, 0x29), b.outMoveParty(0x28, 0x1b), b.blockMove()],
      [b.onceEncounter(spot(9), B, 0x26, 0x27, 1)])]],
    [3, [b.askDialog(0x1519, [b.setFlag(spot(3), 20), b.msg(B, 0x32), b.outMoveParty(0x27, 0x1d), b.blockMove()])]],
  ]);
}

/** Zone 41 (5,4). */
function zone41(b: SpecBuilder): Map<number, Step[]> {
  const Z = 41, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1522, spot(1), 0x17c, 0x834)]],
    [2, [b.askDialog(0x1523, [b.onceEncounter(spot(2), B, 0x2a, 0, 0)])]],
    [3, [herb(b, B, 0xc56, 0x2c, 0x1524, 0x185)]],
  ]);
}

/** Zone 42 (6,4): the cairns and their undead. */
function zone42(b: SpecBuilder): Map<number, Step[]> {
  const Z = 42, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Once the undead (slot 9) are laid, the loot (750 gold, once, under
    // slot 0) and, every visit, the inscription's spell.
    [1, [b.ifFlagAtLeast(spot(9), 1, [
      b.giveItemDialog(0x152d, spot(0), 0xd1, 0xabe), b.msg(B, 0x34), b.teachSpell(0x3b),
    ], [b.askDialog(0x152c, [b.onceEncounter(spot(9), B, 0, 0, 0)])])]],
    [2, [b.onceEncounter(spot(2), B, 0x35, 0x36, 1)]],
  ]);
}

/** Zone 45 (0,5): a haunted forest, two challenges, and the roaches' hills. */
function zone45(b: SpecBuilder): Map<number, Step[]> {
  const Z = 45, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const haunt = (id: number): [number, Step[]] => [id, [b.onceEncounter(spot(id), B, 0x18, 0, id % 2)]];
  return new Map<number, Step[]>([
    haunt(1), haunt(2), haunt(3), haunt(4),
    [6, [b.blockMove(), b.askDialog(0x154a, [b.onceEncounter(spot(6), B, 0, 0, 2)])]],
    [7, [b.blockMove(), b.askDialog(0x154b, [b.onceEncounter(spot(7), B, 0, 0, 3)])]],
    // Until the Filth Factory burns, the roaches' hissing (0x16), or, once
    // the factory (town 26) shows on the map, the lair found (0x17; 10a8:0318).
    [8, [b.ifFlagEq(f(0xc87), 0, [b.ifTownVisible(26, [b.msg(B, 0x17)], [b.msg(B, 0x16)])])]],
  ]);
}

/** Zone 46 (1,5): glowing nettle, gremlins, and a talking roach. */
function zone46(b: SpecBuilder): Map<number, Step[]> {
  const Z = 46, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Only a Woodsman finds the nettle.
    [1, [b.ifFlagAtLeast(f(0xc52), 1, [b.msg(B, 0xd)],
      [b.ifTrait(Trait.WOODSMAN, [b.giveItemDialog(0x1554, f(0xc52), 0x182)], [b.msg(B, 0xc)])])]],
    [2, [b.askDialog(0x1555, [b.onceEncounter(spot(2), B, 0xe, 0, 0)])]],
    // The roach, every visit, until zone 49's spot 11 sets the flag.
    [3, [b.setFlag(spot(3), 0), b.askDialog(0x1556, [b.msg(B, 0xf)], [b.msg(B, 0x10)])]],
  ]);
}

/** Zone 47 (2,5): Vanvor the scroll seller. */
function zone47(b: SpecBuilder): Map<number, Step[]> {
  const Z = 47, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc51, 4, 0x155e, 0x183)]],
    [2, [b.askDialog(0x155f, [b.onceEncounter(spot(2), B, 5, 0, 0)], [b.msg(B, 6), b.setFlag(spot(2), 20)])]],
    [3, [b.onceEncounter(spot(3), B, 9, 0, 1)]],
    [5, [b.giveItemDialog(0x1562, spot(5), 0x186)]],
    // Vanvor won't sell to the party once it has special item 39.
    [11, [b.blockMove(), b.askDialog(0x1560, [b.ifSpecItem(partySpecItem(0x5a), [b.dialog(0x1563)],
      [b.askDialog(0x1561, [b.shop(E3ShopType.GENERAL, 0xd9, 0xdc, 2, 0x10a8, 0)], [b.msg(B, 7)])])])]],
  ]);
}

/** Zone 48 (3,5): a trading post for food, and the Anama Institute. */
function zone48(b: SpecBuilder): Map<number, Step[]> {
  const Z = 48, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), B, 0x1c)]],
    // 100 food for 400 gold, four times (counted by the spot's flag).
    [2, [b.blockMove(), b.askDialog(0x1568, [b.ifFlagAtLeast(spot(2), 4, [b.msg(B, 0x1f)], [
      b.askDialog(0x1569, [b.ifTakeFood(100, [b.incFlag(spot(2)), b.msg(B, 0x1d), b.gold(400)], [b.msg(B, 0x1e)])]),
    ])])]],
    [3, [herb(b, B, 0xc55, 0x21, 0x156c, 0x184)]],
    // The Institute sells only to those with `f(0xac)` at 3.
    [4, [b.blockMove(), b.askDialog(0x156a, [b.ifFlagEq(f(0xac), 3, [
      b.askDialog(0x156b, [b.shop(E3ShopType.GENERAL, 0xc8, 0xd4, 0, 0x10a8, 0x11)], [b.msg(B, 0x23)]),
    ], [b.msg(B, 0x22)])])]],
  ]);
}

/** Zone 49 (4,5). */
function zone49(b: SpecBuilder): Map<number, Step[]> {
  const Z = 49, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.blockMove(), b.askDialog(0x1572, [b.onceEncounter(spot(1), B, 0, 0, 0)])]],
    [2, [b.blockMove(), b.askDialog(0x1573, [b.onceEncounter(spot(2), B, 0x30, 0, 1)])]],
    [3, [b.askDialog(0x1574, [b.onceEncounter(spot(3), B, 0, 0, 2)], [b.blockMove()])]],
    // Past here, zone 46's roach is gone.
    [11, [b.setFlag(zoneSpotFlag(46, 3), 20)]],
  ]);
}

/** Zone 50 (5,5): a pass, more nettle, and a causeway that rises. */
function zone50(b: SpecBuilder): Map<number, Step[]> {
  const Z = 50, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const pass = (id: number, group: number): [number, Step[]] =>
    [id, [b.askDialog(0x157c, [b.onceEncounter(spot(id), B, 0x20, 0, group)], [b.blockMove()])]];
  return new Map<number, Step[]>([
    pass(1, 0), pass(2, 0), pass(3, 1), pass(4, 0),
    [5, [b.ifTrait(Trait.WOODSMAN, [b.giveItemDialog(0x157d, spot(5), 0x186), b.ifFlagAtLeast(spot(5), 1, [b.msg(B, 0x23)])])]],
    [6, [b.giveItemDialog(0x157e, spot(6), 0x18b)]],
    [14, [b.setTer(0x24, 0x15, 0x5b)]],
    [15, [b.setTer(0x27, 0x13, 0x5b)]],
    [16, [b.setTer(0x29, 0x13, 0x5b)]],
  ]);
}

/** Zone 51 (6,5): the heart of the affliction, and a gully of snakes. */
function zone51(b: SpecBuilder): Map<number, Step[]> {
  const Z = 51, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  // Four groups of snakes: the flag is cleared between them so each is placed.
  const snakes = (a: number): Step[] => [b.onceEncounter(spot(2), B, a, 0, 1)];
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x24, 0x25, 0)]],
    [2, [...snakes(0x26), ...[0, 0, 0].flatMap((a) => [b.setFlag(spot(2), 0), ...snakes(a)])]],
  ]);
}

/** Zone 54 (0,6): a sword in the muck, and the Anama farms. */
function zone54(b: SpecBuilder): Map<number, Step[]> {
  const Z = 54, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** A farm, abandoned from E3's day `2 * id + 0x41` (`FUN_10d0_54b8(day, 1)`); ringed visitors get 3 food. */
  const farm = (id: number): [number, Step[]] => [id, [b.askDialog(0x15a4, [
    b.ifE3DayReached(2 * id + 0x41, 1, [b.msg(B, 4)],
      [b.ifSpecItem(partySpecItem(0x5a), [b.food(3), b.msg(B, 6)], [b.msg(B, 5)])]),
  ])]];
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 7, 8, 0)]],
    [2, [b.onceEncounter(spot(2), B, 7, 8, 0)]],
    [3, [b.onceEncounter(spot(3), B, 7, 8, 0)]],
    // The broadsword, and with it (every visit once taken) disease.
    [4, [b.giveItemDialog(0x15a5, spot(4), 0x4b), b.ifFlagAtLeast(spot(4), 1, [b.msg(B, 9), b.diseaseAll(4)])]],
    farm(11), farm(12),
  ]);
}

/** Zone 55 (1,6). */
function zone55(b: SpecBuilder): Map<number, Step[]> {
  const Z = 55, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Slot 9 is never set here.
    [1, [b.ifFlagEq(spot(9), 1, [b.askDialog(0x15ae, [b.onceEncounter(spot(1), B, 0, 0, 0)])])]],
    [2, [b.onceEncounter(spot(2), B, 0xd, 0, 1)]],
    // Taking the find brings its guards (E3 clears the flag for the encounter's check).
    [3, [b.giveItemDialog(0x15af, spot(3), 0x12c), b.ifFlagAtLeast(spot(3), 1, [
      b.setFlag(spot(3), 0), b.onceEncounter(spot(3), B, 7, 0, 2),
    ])]],
    [4, [b.giveItemDialog(0x15b0, spot(4), 0xf3)]],
  ]);
}

/** Zone 56 (2,6): a stone circle. */
function zone56(b: SpecBuilder): Map<number, Step[]> {
  const Z = 56, spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [stoneCircle(b, [b.setFlag(spot(1), 20)]), b.blockMove()]],
  ]);
}

/**
 * The Wandering Merchant (magic shop 2, `start_shop_mode(7, …)`), found at
 * one of six stops in turn: zone 57's spots 14–17, then zone 58's 14 and 15.
 * Each purchase visit moves him on (`zoneSpotFlag(57, 9)`, which E3 reads
 * modulo 6). The flag is kept below 6 here, which differs from E3's byte
 * only after it wraps, at 256 visits.
 */
function merchant(b: SpecBuilder, stop: number, title: number): Step[] {
  const turn = zoneSpotFlag(57, 9);
  // The shop ends the script, so the rest comes first.
  return [b.ifFlagEq(turn, stop, [b.askDialog(0x15c2, [
    b.incFlag(turn), b.ifFlagAtLeast(turn, 6, [b.setFlag(turn, 0)]), b.blockMove(),
    b.shop(E3ShopType.MAGIC_SHOPS + 2, 0, 0, 3, 0x10a8, title),
  ])])];
}

/** Zone 57 (3,6): the Sharimik farms, and the Wandering Merchant. */
function zone57(b: SpecBuilder): Map<number, Step[]> {
  const Z = 57, spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x15c3, spot(1), 0x155)]],
    // A bushel of grub (20 food) for 10 gold.
    [2, [b.askDialog(0x15c4, [b.ifGold(10, [b.takeGold(10), b.food(20)], [b.log(0x10a8, 0x1c)])])]],
    [14, merchant(b, 0, 0x35)], [15, merchant(b, 1, 0x35)], [16, merchant(b, 2, 0x35)], [17, merchant(b, 3, 0x35)],
  ]);
}

/** Zone 58 (4,6). */
function zone58(b: SpecBuilder): Map<number, Step[]> {
  const Z = 58, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x1a, 0, 0)]],
    // Special item 41 lets the party past without a fight.
    [2, [b.blockMove(), b.askDialog(0x15cc, [b.ifSpecItem(partySpecItem(0x5e), [b.msg(B, 0x1c)],
      [b.onceEncounter(spot(2), B, 0x1b, 0, 1)]), b.setFlag(spot(2), 20)])]],
    [3, [b.giveItemDialog(0x15cd, spot(3), 0x160)]],
    [11, [b.setFlag(spot(2), 20)]],
    [14, merchant(b, 4, 0x48)], [15, merchant(b, 5, 0x48)],
  ]);
}

/** Zone 59 (5,6). */
function zone59(b: SpecBuilder): Map<number, Step[]> {
  const Z = 59, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x15d6, spot(1), 0xb5)]],
    [2, [b.askDialog(0x15d7, [b.onceEncounter(spot(2), B, 0, 0, 0)])]],
  ]);
}

/** Zone 60 (6,6): finds only a Woodsman spots, and ferries. */
function zone60(b: SpecBuilder): Map<number, Step[]> {
  const Z = 60, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const find = (id: number): [number, Step[]] => [id, [b.ifTrait(Trait.WOODSMAN, [b.giveItemDialog(0x15e0, spot(id), 0x196)])]];
  const group = (id: number): [number, Step[]] => [id, [b.onceEncounter(spot(id), B, 0x2b, 0, 0)]];
  return new Map<number, Step[]>([
    find(1), find(2), find(3), find(4), group(5), group(6), group(7), find(8),
    // Up to ten of item 0xb5, as many as there is room for, every time; then (once) the owners.
    [9, [b.askDialog(0x15e3, [b.giveItemUntilFull(0xb5, 10, FIND_COUNT), b.onceEncounter(spot(9), B, 0x2d, 0, 1)])]],
    [11, [b.askDialog(0x15e2, [b.outMoveParty(0x20, 0x21)]), b.blockMove()]],
    [12, [b.askDialog(0x15e1, [b.msg(B, 0x2c), b.outMoveParty(0x27, 0x1f)]), b.blockMove()]],
  ]);
}

/** Zone 61 (7,6). */
function zone61(b: SpecBuilder): Map<number, Step[]> {
  const Z = 61, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x1c, 0, 1)]],
    [2, [b.onceEncounter(spot(2), B, 0x1d, 0, 2)]],
    [3, [b.onceEncounter(spot(3), B, 0x1c, 0, 0)]],
    [4, [b.onceEncounter(spot(4), B, 0x1c, 0, 0)]],
  ]);
}

/** Zone 63 (0,7). */
function zone63(b: SpecBuilder): Map<number, Step[]> {
  const Z = 63, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x18, 0, 0)]],
  ]);
}

/** Zone 64 (1,7). */
function zone64(b: SpecBuilder): Map<number, Step[]> {
  const Z = 64, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1608, spot(1), 0x163), b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 1)])]],
  ]);
}

/**
 * Zone 65 (2,7): a cache, and two hermits playing chess by messenger. Slot
 * 8 is 1 while the party carries a move; slot 9 counts the moves, and its
 * parity says which hut (spot 4 even, spot 3 odd) has the next one. After
 * the eighth, slot 9 becomes 100 and both doors stay shut.
 */
function zone65(b: SpecBuilder): Map<number, Step[]> {
  const Z = 65, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const carrying = spot(8), moves = spot(9);
  /** Forty items, every fifth 0xe9 and the rest 0xe8, until nobody has room. */
  const cache = (k: number): Step[] => (k >= 40 ? [] : [b.giveItem(k % 5 === 0 ? 0xe9 : 0xe8, cache(k + 1))]);
  const hut = (id: number): Step[] => {
    const p = id % 2, shut = [b.msg(B, 0x12)];
    const values = Array.from({ length: 9 }, (_, v) => v);
    const pickUp = (v: number): Step[] => (v % 2 === p
      ? [b.askDialog(0x1616 - p, [b.incFlag(carrying), b.incFlag(moves), b.msg(B, 0x17)])] : shut);
    const deliver = (v: number): Step[] => (v % 2 === p
      ? [b.gold(100), b.setFlag(carrying, 0), ...(v > 7 ? [b.msg(B, 0x15, 0x16), b.setFlag(moves, 100)] : [b.msg(B, 0x14 - p)])]
      : shut);
    return [b.blockMove(), b.askDialog(0x1614, [b.ifFlagEq(carrying, 0,
      [b.switchFlag(moves, values.map(pickUp), shut)],
      [b.switchFlag(moves, values.map(deliver), shut)])])];
  };
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x1612, cache(0))]],
    [2, [b.askDialog(0x1613, [b.onceEncounter(spot(2), B, 0, 0, 0)]), b.setFlag(spot(2), 20)]],
    [3, hut(3)],
    [4, hut(4)],
  ]);
}

/** Zone 66 (3,7): a toll bridge. */
function zone66(b: SpecBuilder): Map<number, Step[]> {
  const Z = 66, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x161c, spot(1), 0x6f, 0x44c)]],
    [2, [b.blockMove(), b.choiceDialog(0x161d, [b.msg(B, 7)], [b.onceEncounter(spot(2), B, 6, 0, 0)], [b.msg(B, 8)])]],
    // The toll: 25 gold lets the party across; a fight brings two groups.
    [3, [b.choiceDialog(0x161e,
      [b.pay(25, [b.msg(B, 0xa)], [b.log(0x10a8, 0x5b), b.blockMove()])],
      [b.onceEncounter(spot(3), B, 6, 0, 1), b.setFlag(spot(3), 0), b.onceEncounter(spot(3), B, 0, 0, 1), b.blockMove()],
      [b.blockMove()])]],
    [4, [b.onceEncounter(spot(4), B, 0xb, 0, 2)]],
  ]);
}

/** Zone 67 (4,7): a silver vein. */
function zone67(b: SpecBuilder): Map<number, Step[]> {
  const Z = 67, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Silver ore (0x193) until nobody has room: E3 stops after 41.
    [1, [b.askDialog(0x1626, [b.msg(B, 0x24), b.giveItemUntilFull(0x193, 41, FIND_COUNT), b.setFlag(spot(1), 20)])]],
    [2, [b.onceEncounter(spot(2), B, 0x22, 0, 0), b.onceEncounter(spot(9), B, 0, 0, 1)]],
    [3, [b.giveItemDialog(0x1627, spot(3), 0xf1)]],
  ]);
}

/** Zone 68 (5,7): a gold mine dug by claws. */
function zone68(b: SpecBuilder): Map<number, Step[]> {
  const Z = 68, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const dug = spot(1);
  const mugged: Step[] = [b.msg(B, 0x25), b.setFlag(dug, 20), b.onceEncounter(spot(9), B, 0, 0, 0)];
  return new Map<number, Step[]>([
    // Each dig is 100 gold, then the owners turn up if `get_ran(1, 1, 20)`
    // is at most the number of digs so far (a chance of 5% a dig).
    [1, [b.askDialog(0x1630, [b.loop((again) => [b.askDialog(0x1631, [
      b.sound(39), b.gold(100), b.log(0x10a8, 0x74), b.incFlag(dug),
      b.switchFlag(dug, Array.from({ length: 20 }, (_, n) => [b.ifChance(5 * n, mugged, [again])]), mugged),
    ], [b.msg(B, 0x2a)])])])]],
    [2, [b.askDialog(0x1632, [b.onceEncounter(spot(2), B, 0x26, 0, 1)])]],
    [3, [b.askDialog(0x1633, [b.onceEncounter(spot(3), B, 0, 0, 2)]), b.setFlag(spot(3), 20)]],
  ]);
}

/** Zone 69 (6,7): a stone circle, and a mandrake seller. */
function zone69(b: SpecBuilder): Map<number, Step[]> {
  const Z = 69, spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [stoneCircle(b, [b.setFlag(spot(1), 20)]), b.blockMove()]],
    [2, [b.blockMove(), b.askDialog(0x163a, [b.shop(E3ShopType.GENERAL, 0xf6, 0xf6, 2, 0x10a8, 0x87)])]],
    [3, [b.giveItemDialog(0x163b, spot(3), 0x142)]],
  ]);
}

/** Zone 70 (7,7): caves, and a fountain. */
function zone70(b: SpecBuilder): Map<number, Step[]> {
  const Z = 70, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1644, spot(1), 0x97)]],
    // Ten fights, each clearing slot 8 so that it can fire: group 1 for the
    // first six, then group 2. After the tenth, only a word.
    [2, [b.ifFlagAtLeast(spot(2), 10, [b.msg(B, 0xd)], [
      b.setFlag(spot(8), 0),
      b.ifFlagAtLeast(spot(2), 6, [b.onceEncounter(spot(8), B, 0xc, 0, 2)], [b.onceEncounter(spot(8), B, 0xc, 0, 1)]),
      b.incFlag(spot(2)), b.blockMove(),
    ])]],
    [3, [b.giveItemDialog(0x1645, spot(3), 0x5e), b.onceEncounter(spot(9), B, 0xe, 0, 0)]],
    [11, [b.askDialog(0x1646, [b.msg(B, 0xf), b.heal(50)])]],
  ]);
}

/** Zone 71 (8,7): the bridge to Erika's tower. */
function zone71(b: SpecBuilder): Map<number, Step[]> {
  const Z = 71, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x164e, spot(1), 0x75, 0xb54), b.ifFlagAtLeast(spot(1), 1, [b.onceEncounter(spot(9), B, 0x13, 0, 0)])]],
    [2, [b.ifFlagAtLeast(spot(8), 1, [b.msg(B, 0x14)]), b.giveItemDialog(0x164f, spot(8), 0x183)]],
    [3, [b.onceEncounter(spot(3), B, 0x15, 0, 1)]],
    [4, [b.onceEncounter(spot(4), B, 0x16, 0, 2)]],
    [5, [b.onceEncounter(spot(5), B, 0x17, 0, 3)]],
    // Erika lets the party cross once any of flags 0xc96, 0xc93 and 0xc8a is set.
    [6, [b.ifFlagAtLeast(f(0xc96), 1, [b.msg(B, 0x1a)], [b.ifFlagAtLeast(f(0xc93), 1, [b.msg(B, 0x1a)],
      [b.ifFlagAtLeast(f(0xc8a), 1, [b.msg(B, 0x1a)], [b.msg(B, 0x19), b.blockMove()])])])]],
    // On the map, but E3's switch has no case for it.
    [24, []],
  ]);
}

/** Zone 72 (0,8): the sad dryad (slot 3, which zone 37 reads), and a hoard. */
function zone72(b: SpecBuilder): Map<number, Step[]> {
  const Z = 72, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1658, spot(1), 0x18b)]],
    [2, [b.onceEncounter(spot(2), B, 0x27, 0, 0)]],
    // Show her something beautiful: an item of class 0x66 (taken), or be
    // dumbfounded (each PC by 2) and put outside.
    [3, [b.blockMove(), b.ifFlagAtLeast(spot(3), 1, [b.msg(B, 0x31)], [
      b.askDialog(0x1659, [b.askDialog(0x165a, [b.ifTakeItemOfClass(0x66,
        [b.setFlag(spot(3), 1), b.msg(B, 0x2f, 0x30)],
        [b.msg(B, 0x2a, 0x2b), b.dumbfound(2)])], [b.msg(B, 0x32)])]),
    ])]],
    [4, [b.giveItemDialog(0x165b, spot(4), 0, 0xabe), b.ifFlagAtLeast(spot(4), 1, [b.onceEncounter(spot(7), B, 0x2c, 0x2d, 1)])]],
  ]);
}

/** Zone 73 (1,8): around Fort Emergence. */
function zone73(b: SpecBuilder): Map<number, Step[]> {
  const Z = 73, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // A find marked by slot 8's flag, with a word first if it's been had.
    [1, [b.ifFlagAtLeast(spot(8), 1, [b.msg(B, 0x1c)]), b.giveItemDialog(0x1662, spot(8), 0x180)]],
    [2, [b.onceMsg(spot(2), B, 0x1d)]],
    // The goblin outpost: every visit shows the dialog and marks it found.
    [3, [b.journal(3), b.dialog(0x1663), b.setFlag(f(0xc95), 1), b.setFlag(spot(3), 20)]],
    [4, [b.onceEncounter(spot(4), B, 0x1e, 0, 0)]],
    [5, [b.onceEncounter(spot(5), B, 0x21, 0, 1)]],
    [6, [b.onceMsg(spot(6), B, 0x22)]],
  ]);
}

/** Zone 74 (2,8): north of Krizsan. */
function zone74(b: SpecBuilder): Map<number, Step[]> {
  const Z = 74, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [stoneCircle(b, [b.setFlag(spot(1), 20)]), b.blockMove()]],
    // Once flag (274,7) is set, the Metal Lumps (special item 37) are
    // here, and taking them brings an encounter.
    [2, [b.ifFlagAtLeast(spot(7), 1, [
      b.giveItemDialog(0x166e, spot(2), 0, 0x151),
      b.ifFlagAtLeast(spot(2), 1, [b.onceEncounter(spot(8), B, 0x3e, 0, 0)]),
    ])]],
  ]);
}

/** Zone 75 (3,8): a pass only a Woodsman finds, Bulon's alchemy, and treasure. */
function zone75(b: SpecBuilder): Map<number, Step[]> {
  const Z = 75, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Open once spot 11 has been reached from the other side; until then a
    // Woodsman only finds it blocked, and anyone else falls (20 damage of type 0).
    [1, [b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 0x43)], [b.blockMove(),
      b.ifTrait(Trait.WOODSMAN, [b.msg(B, 0x42)], [b.msg(B, 0x41), b.damageAll(20, 0)])])]],
    [11, [b.setFlag(spot(1), 1)]],
    [2, [b.askDialog(0x1676, [b.msg(B, 0x44, 0x45), b.gold(2000), b.setFlag(spot(2), 20)])]],
    [3, [b.onceEncounter(spot(3), B, 0x46, 0, 0)]],
    [4, [b.blockMove(), b.askDialog(0x1677, [b.askDialog(0x1678,
      [b.shop(E3ShopType.ALCHEMY, 2, 2, 3, 0x10a8, 0x91)], [b.msg(B, 0x47)])])]],
    [5, [b.onceEncounter(spot(5), B, 0x48, 0, 1)]],
  ]);
}

/**
 * Zone 76 (4,8): the Nephilim village. Slot 9 is 2 once the party walks
 * away from their fight with the ursagi, after which only a party with a
 * Nephil gets in; 1 would be a welcome for having helped, but nothing sets
 * it (E3-SUSPECTED-BUGS.md #6).
 */
function zone76(b: SpecBuilder): Map<number, Step[]> {
  const Z = 76, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const state = spot(9);
  const battle: Step[] = [b.blockMove(), b.askDialog(0x1683,
    [b.msg(B, 0x4f), b.onceEncounter(spot(3), B, 0, 0, 1)],
    [b.msg(B, 0x50), b.setFlag(state, 2)])];
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc53, 0x54, 0x1680, 0x182)]],
    [2, [b.onceEncounter(spot(2), B, 0x4c, 0, 0)]],
    [3, [b.ifFlagAtLeast(state, 1, [b.askDialog(0x1684, [b.ifFlagEq(state, 1, [b.msg(B, 0x53)],
      [b.ifFlagEq(state, 2, [b.ifSpecies(Race.NEPHIL, [b.msg(B, 0x52)], [b.msg(B, 0x51), b.blockMove()])], battle)])],
    [b.blockMove()])], battle)]],
    [11, [b.blockMove(), b.askDialog(0x1681, [b.shop(E3ShopType.GENERAL, 0xf0, 0xf2, 1, 0x10a8, 0xa1)])]],
    [12, [b.blockMove(), b.askDialog(0x1682, [b.shop(E3ShopType.WEAPONS, 0x3f, 0x46, 3, 0x10a8, 0xac)])]],
  ]);
}

/** Zone 77 (5,8). */
function zone77(b: SpecBuilder): Map<number, Step[]> {
  const Z = 77, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x168a, spot(1), 0x197), b.ifFlagAtLeast(spot(1), 1, [b.msg(B, 0x65)])]],
    [2, [b.onceEncounter(spot(2), B, 0x66, 0, 1)]],
    [3, [b.onceEncounter(spot(3), B, 0x67, 0, 0)]],
    [4, [b.onceEncounter(spot(4), B, 0x68, 0, 0)]],
  ]);
}

/** Zone 78 (6,8): boat rides. */
function zone78(b: SpecBuilder): Map<number, Step[]> {
  return new Map<number, Step[]>([
    // 10 gold.
    [11, [b.blockMove(), b.askDialog(0x16e4, [b.pay(10, [b.log(0x10a8, 0xd4), b.outMoveParty(0x1b, 0x28)],
      [b.log(0x10a8, 0xbb)])])]],
    [12, [b.blockMove(), b.askDialog(0x16e5, [b.log(0x10a8, 0xea), b.outMoveParty(0x1a, 0x23)])]],
    [14, [b.dialog(0x1694)]],
  ]);
}

/** Zone 79 (7,8): the Nephilim bandits' camp. */
function zone79(b: SpecBuilder): Map<number, Step[]> {
  const Z = 79, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // The bandits (slot 9) first: turn back, or attack and go on. Then their loot.
    [1, [b.ifFlagEq(spot(9), 0, [b.askDialog(0x169e, [b.onceEncounter(spot(9), B, 4, 0, 0)], [b.msg(B, 3), b.blockMove()])],
      [b.giveItemDialog(0x169f, spot(1), 0x151, 0x960)])]],
    [2, [b.onceEncounter(spot(2), B, 5, 0, 1)]],
    [3, [b.giveItemDialog(0x16a0, spot(3), 0x6c, 0x898), b.ifFlagAtLeast(spot(3), 1, [b.onceEncounter(spot(8), B, 0xa, 0, 2)])]],
    // A word for everyone, and another for a party with Cave Lore.
    [11, [b.msg(B, 9), b.ifTrait(Trait.CAVE_LORE, [b.msg(B, 7)])]],
  ]);
}

/**
 * A boat ride between islands (`FUN_10c0_4652`): `paid` for the 10-gold
 * crossing (dialog 0x16e4) with its two EXE lines, or the free way back
 * (0x16e5). Either way the step is refused.
 */
function ferry(b: SpecBuilder, x: number, y: number, line: number, poor?: number): Step[] {
  const go = [b.log(0x10a8, line), b.outMoveParty(x, y)];
  return [b.blockMove(), poor === undefined
    ? b.askDialog(0x16e5, go)
    : b.askDialog(0x16e4, [b.pay(10, go, [b.log(0x10a8, poor)])])];
}

/** Zone 80 (8,8): the Vahnatai hunters, Silverlocke's potions, and hidden channels. */
function zone80(b: SpecBuilder): Map<number, Step[]> {
  const Z = 80, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /**
   * The rocks beside the boat, a square west (`dx` -1) or east of the spot,
   * part to show a channel (terrain 0x4a becomes 0x47).
   */
  const channel = (id: number, dx: number): [number, Step[]] => {
    const at = b.spotAt(id);
    return [id, [b.ifTer(at.x + dx, at.y, 0x4a, [b.msg(B, 0x1e), b.setTer(at.x + dx, at.y, 0x47)])]];
  };
  return new Map<number, Step[]>([
    // Help the hunters, or not; either way it happens once. Not after 0xc93.
    [1, [b.ifFlagEq(f(0xc93), 0, [b.askDialog(0x16aa, [b.onceEncounter(spot(1), B, 0, 0, 0)], [b.msg(B, 0x1c)])]),
      b.setFlag(spot(1), 20)]],
    [2, [b.giveItemDialog(0x16ab, spot(2), 0x65)]],
    [11, [b.askDialog(0x16a8, [b.askDialog(0x16a9,
      [b.shop(E3ShopType.GENERAL, 0xc5, 0xca, 3, 0x10a8, 0x2956)], [b.msg(B, 0x1b)])])]],
    channel(12, -1),
    [14, [b.dialog(0x16ac)]],
    channel(15, 1),
  ]);
}

/** Zone 81 (0,9). */
function zone81(b: SpecBuilder): Map<number, Step[]> {
  const Z = 81, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16b2, [b.setFlag(spot(1), 20), b.msg(B, 0x27), b.diseaseAll(8)])]],
    [2, [b.askDialog(0x16b3, [b.msg(B, 0x2a), b.blockMove()])]],
    // The same first dialog as spot 2, then a weapon shop.
    [3, [b.askDialog(0x16b3, [b.askDialog(0x16b4, [b.blockMove(),
      b.shop(E3ShopType.WEAPONS, 0x32, 0x3e, 0, 0x10a8, 0x296c)])])]],
    [4, [b.askDialog(0x16b5, [b.onceEncounter(spot(4), B, 0x2c, 0, 0), b.setFlag(spot(5), 1)], [b.msg(B, 0x2b)]),
      b.setFlag(spot(4), 20)]],
  ]);
}

/** Zone 82 (1,9). */
function zone82(b: SpecBuilder): Map<number, Step[]> {
  const Z = 82, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x20, 0, 0)]],
    [2, [b.onceEncounter(spot(2), B, 0x20, 0, 0)]],
    [3, [b.onceEncounter(spot(3), B, 0x25, 0x26, 1)]],
    [4, [b.onceEncounter(spot(4), B, 0x25, 0x26, 2)]],
  ]);
}

/** Zone 83 (2,9): the farms around Krizsan, which the plague reaches by day. */
function zone83(b: SpecBuilder): Map<number, Step[]> {
  const Z = 83, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** A farm the monsters overrun (and block) from E3's day `day` (`FUN_10d0_54b8(day, 0)`). */
  const farm = (day: number, then: Step[]): Step[] =>
    [b.ifE3DayReached(day, 0, [b.msg(B, 0x35), b.blockMove()], then)];
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16c6, [b.onceEncounter(spot(1), B, 0x31, 0, 0)])]],
    [2, [b.giveItemDialog(0x16c9, spot(2), 0x102)]],
    [11, farm(35, [b.askDialog(0x16c7, [b.msg(B, 0x32, 0x33)])])],
    // A food stall (food record 9).
    [12, farm(25, [b.askDialog(0x16c7, [b.askDialog(0x16c8, [b.blockMove(),
      b.shop(E3ShopType.FOOD, 9, 9, 0, 0x10a8, 0x297e)])])])],
    [14, farm(15, [b.askDialog(0x16c7, [b.msg(B, 0x34)])])],
  ]);
}

/** Zone 84 (3,9): goblin wolf-riders, the hill dwellers, and the slime valley. */
function zone84(b: SpecBuilder): Map<number, Step[]> {
  const Z = 84, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  const wolves: Step[] = [b.onceEncounter(spot(1), B, 0x37, 0, 0)];
  return new Map<number, Step[]>([
    // 50 gold, or a fight.
    [1, [b.blockMove(), b.askDialog(0x16d0, [b.ifGold(50, [b.takeGold(50), b.msg(B, 0x36)], wolves)], wolves)]],
    // The shanty town trades only after `f(0xc85)`.
    [2, [b.blockMove(), b.askDialog(0x16d1, [b.ifFlagEq(f(0xc85), 0, [b.msg(B, 0x3a)], [
      b.askDialog(0x16d2, [b.shop(E3ShopType.GENERAL, 0xb8, 0xb8, 1, 0x10a8, 0x2991)], [b.msg(B, 0x3b)]),
    ])])]],
    [3, [b.askDialog(0x16d4, [b.onceEncounter(spot(3), B, 0x3d, 0, 2)], [b.blockMove()])]],
    [4, [b.askDialog(0x16d3, [b.onceEncounter(spot(4), B, 0x3d, 0, 1)], [b.blockMove()])]],
    // TODO(E3-3): E3's message plays sound 54 here rather than its usual 57;
    // the engine's message box always plays 57.
    [5, [b.onceMsg(spot(5), B, 0x3e)]],
    // Only while town 22 is off the map (10a8:338e).
    [11, [b.ifTownVisible(22, [], [b.msg(B, 0x3c, 0x41)])]],
  ]);
}

/** Zone 85 (4,9): a ferry across the river. */
function zone85(b: SpecBuilder): Map<number, Step[]> {
  const Z = 85, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16db, [b.onceEncounter(spot(1), B, 0xb, 0, 0)],
      [b.askDialog(0x16dc, [b.onceEncounter(spot(1), B, 0x44, 0x46, 1)])])]],
    [11, [b.blockMove(), b.askDialog(0x16da, [b.pay(10, [b.msg(B, 0x47), b.outMoveParty(0x26, 0x12)], [b.log(0x10a8, 0x299f)])])]],
    // The way back asks the same 10 gold and says it's paid, but takes
    // nothing (E3-SUSPECTED-BUGS.md #7).
    [12, [b.blockMove(), b.askDialog(0x16da, [b.msg(B, 0x47), b.outMoveParty(0x22, 0x15)])]],
  ]);
}

/** Zone 86 (5,9): the boat people's islands. */
function zone86(b: SpecBuilder): Map<number, Step[]> {
  const Z = 86, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // Its guardians (slot 9, which blocks the way), then the nettle.
    [1, [b.ifFlagEq(spot(9), 0, [b.askDialog(0x16e6, [b.onceEncounter(spot(9), B, 0, 0, 0)]), b.blockMove()],
      [herb(b, B, 0xc54, 0x42, 0x16e7, 0x186)])]],
    [2, [b.onceMsg(spot(2), B, 0x43)]],
    [14, ferry(b, 0x1b, 0xb, 0x29e7)],
    [15, ferry(b, 0xe, 0x1b, 0x2a2c)],
    [20, ferry(b, 0x1d, 0x18, 0x29d1, 0x29b8)],
    [21, ferry(b, 0x12, 0x10, 0x2a16, 0x29fd)],
  ]);
}

/** Zone 87 (6,9): more islands. */
function zone87(b: SpecBuilder): Map<number, Step[]> {
  const Z = 87, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.onceEncounter(spot(1), B, 0x4e, 0, 0)]],
    [2, [b.onceEncounter(spot(2), B, 0x4e, 0, 0)]],
    // Only for a party that knows alchemy recipe 16 (party+0x832e).
    [3, [b.ifAlchemy(16, [b.onceEncounter(spot(3), B, 0x4b, 0x4c, 1)])]],
    [14, ferry(b, 0x19, 0x13, 0x2a71)],
    [15, ferry(b, 0x11, 8, 0x2ab6)],
    [20, ferry(b, 0x17, 0xb, 0x2a5b, 0x2a42)],
    [21, ferry(b, 0xd, 0x15, 0x2aa0, 0x2a87)],
    // On the map, but E3's switch has no case for it.
    [72, []],
  ]);
}

/** Zone 88 (7,9). */
function zone88(b: SpecBuilder): Map<number, Step[]> {
  const Z = 88, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16f8, [b.onceEncounter(spot(1), B, 0x10, 0, 2)])]],
    [2, [b.giveItemDialog(0x16f9, spot(2), 0x93)]],
    [3, [herb(b, B, 0xc50, 0x12, 0x16fa, 0x181)]],
    [4, [b.onceEncounter(spot(4), B, 0x15, 0x16, 0), b.onceEncounter(spot(6), B, 0, 0, 1)]],
  ]);
}

/** Zone 89 (8,9): the caves outside Fort Emergence. */
function zone89(b: SpecBuilder): Map<number, Step[]> {
  const Z = 89, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1702, spot(1), 0x38)]],
    [2, [b.giveItemDialog(0x1703, spot(2), 0, 2400)]],
    [3, [b.askDialog(0x1704, [b.xp(10), b.msg(B, 2, 3)], [b.msg(B, 4)]), b.setFlag(spot(3), 20)]],
    [4, [b.onceMsg(spot(4), B, 5, 6)]],
    [5, [b.onceEncounter(spot(5), B, 7, 8, 0)]],
  ]);
}

export const ZONE_SCRIPTS = new Map<number, PlaceScript>([[0, zone0], [1, zone1], [2, zone2], [3, zone3], [4, zone4], [5, zone5], [6, zone6], [7, zone7], [8, zone8], [9, zone9], [10, zone10], [11, zone11], [12, zone12], [13, zone13], [14, zone14], [15, zone15], [16, zone16], [17, zone17], [18, zone18], [19, zone19], [20, zone20], [23, zone23], [24, zone24], [27, zone27], [28, zone28], [29, zone29], [30, zone30], [31, zone31], [32, zone32], [33, zone33], [36, zone36], [37, zone37], [38, zone38], [39, zone39], [40, zone40], [41, zone41], [42, zone42], [45, zone45], [46, zone46], [47, zone47], [48, zone48], [49, zone49], [50, zone50], [51, zone51], [54, zone54], [55, zone55], [56, zone56], [57, zone57], [58, zone58], [59, zone59], [60, zone60], [61, zone61], [63, zone63], [64, zone64], [65, zone65], [66, zone66], [67, zone67], [68, zone68], [69, zone69], [70, zone70], [71, zone71], [72, zone72], [73, zone73], [74, zone74], [75, zone75], [76, zone76], [77, zone77], [78, zone78], [79, zone79], [80, zone80], [81, zone81], [82, zone82], [83, zone83], [84, zone84], [85, zone85], [86, zone86], [87, zone87], [88, zone88], [89, zone89]]);
