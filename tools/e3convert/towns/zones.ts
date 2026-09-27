/**
 * Exile 3's outdoor encounters, zone by zone: the arms of the outdoor
 * handler's switch on the zone. Zones below 21 are in `FUN_10a0_0062`, 21–44
 * in `FUN_10a0_1595`, 45–79 in `FUN_10a8_0100` and the rest in
 * `FUN_10a8_2acc` (the split is in the caller, `exile3.c` near line 59350).
 * A zone's message block is `zone / 10 + 80`.
 */

import type { PlaceScript } from '../specials';
import { e3DayReached } from '../flags';
import { partyFlag as f, zoneSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';
import { Skill, Trait } from '../../../src/universe/skills';

const block = (zone: number) => Math.floor(zone / 10) + 80;

/** An ember-flower-style herb patch: a word once `have` is set, else the find. */
function herb(b: SpecBuilder, B: number, have: number, already: number, dlg: number, item: number): Step {
  return b.ifFlagAtLeast(f(have), 1, [b.msg(B, already)], [b.giveItemDialog(dlg, f(have), item)]);
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

/** Zone 9 (9,0): the dark forest, its gremlins, and the slime valley. */
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

/** Zone 10 (0,1): the icy valley below the caldera, and the Vahnatai's beasts. */
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

/** Zone 11 (1,1): holly, and a magical wall something is breaking through. */
function zone11(b: SpecBuilder): Map<number, Step[]> {
  const Z = 11, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc4c, 0x1b, 0x13f6, 0x180)]],
    [2, [b.askDialog(0x13f7, [b.onceEncounter(spot(2), B, 0x1d, 0, 0)], [b.msg(B, 0x1c), b.setFlag(spot(2), 20)])]],
  ]);
}

/** Zone 12 (2,1): the gates of Footracer Province. */
function zone12(b: SpecBuilder): Map<number, Step[]> {
  const Z = 12, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1400, spot(1), 0x177)]],
    // Closed until zone 20's slot 9 is set; then they open onto the beasts.
    [2, [b.ifFlagEq(zoneSpotFlag(20, 9), 0, [b.dialog(0x1450), b.blockMove()],
      [b.dialog(0x1451), b.onceEncounter(spot(9), B, 0x1e, 0, 0)])]],
  ]);
}

/** Zone 13 (3,1). */
function zone13(b: SpecBuilder): Map<number, Step[]> {
  const Z = 13, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // A cave of six-legged beasts: go in, or turn back.
    [1, [b.askDialog(0x140a, [b.onceEncounter(spot(1), B, 0x19, 0, 0)], [b.blockMove()])]],
    [2, [b.giveItemDialog(0x140b, spot(2), 0x48, 0x8ca)]],
    [3, [b.giveItemDialog(0x140c, spot(3), 0, 0x151)]],
  ]);
}

/** Zone 14 (4,1): the golems' clearing. */
function zone14(b: SpecBuilder): Map<number, Step[]> {
  const Z = 14, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** Leave, sneak past (any living Woodsman), or fight. */
  const guards = (id: number): Step[] => [b.choiceDialog(0x1414,
    [b.ifTrait(Trait.WOODSMAN, [b.msg(B, 0x15), b.setFlag(spot(id), 20)], [b.onceEncounter(spot(id), B, 0x16, 0, 0)])],
    [b.onceEncounter(spot(id), B, 0, 0, 0), b.blockMove()],
    [b.blockMove()])];
  return new Map<number, Step[]>([
    // TODO(E3-3): E3 tests `can_find_town[32]` (+0x84a5), the Tower of
    // Shifting Floors showing on the map: if so, the party makes it out (0x13)
    // and the spot is marked. No node tests a town's visibility, so this
    // always gives the hidden tower's text, which is how a new game starts.
    [1, [b.msg(B, 0x14)]],
    [2, guards(2)],
    [3, guards(3)],
  ]);
}

/** Converter scratch: how many of zone 15's finds the party has taken. */
const FIND_COUNT: Flag = [291, 31];

/** Zone 15 (5,1). */
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

/** Zone 16 (6,1). */
function zone16(b: SpecBuilder): Map<number, Step[]> {
  const Z = 16, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1428, spot(1), 0x101, 0x514)]],
    [2, [b.onceEncounter(spot(2), B, 0x21, 0x26, 0)]],
  ]);
}

/** Zone 17 (7,1). */
function zone17(b: SpecBuilder): Map<number, Step[]> {
  const Z = 17, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x1432, [b.onceEncounter(spot(1), B, 0, 0, 0)], [b.blockMove()])]],
    // The same group from the other side, which marks spot 1's flag.
    [2, [b.msg(B, 0x24), b.ifFlagEq(spot(1), 0, [b.askDialog(0x1432,
      [b.onceEncounter(spot(2), B, 0, 0, 0), b.setFlag(spot(1), 20)], [b.blockMove()])])]],
  ]);
}

/** Zone 18 (8,1). */
function zone18(b: SpecBuilder): Map<number, Step[]> {
  const Z = 18, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [herb(b, B, 0xc57, 1, 0x143c, 0x185)]],
    [2, [b.askDialog(0x143d, [b.onceEncounter(spot(2), B, 2, 0, 0)], [b.msg(B, 3), b.blockMove()])]],
  ]);
}

/** Zone 19 (9,1). */
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

/** Zone 20 (0,2): Footracer's gates from the inside, the same test as zone 12's. */
function zone20(b: SpecBuilder): Map<number, Step[]> {
  return new Map<number, Step[]>([
    [1, [b.ifFlagEq(zoneSpotFlag(20, 9), 0, [b.dialog(0x1450), b.blockMove()], [b.dialog(0x1451)])]],
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
    // TODO(E3-3): journal entry 3.
    [3, [b.dialog(0x1663), b.setFlag(f(0xc95), 1), b.setFlag(spot(3), 20)]],
    [4, [b.onceEncounter(spot(4), B, 0x1e, 0, 0)]],
    [5, [b.onceEncounter(spot(5), B, 0x21, 0, 1)]],
    [6, [b.onceMsg(spot(6), B, 0x22)]],
  ]);
}

/** Zone 74 (2,8): north of Krizsan. */
function zone74(b: SpecBuilder): Map<number, Step[]> {
  const Z = 74, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // TODO(E3-3): 1 (`FUN_10c0_482d(1)`, which marks (274,1) when it succeeds).
    // 2: once flag (274,7) is set, the Metal Lumps (special item 37) are
    // here, and taking them brings an encounter.
    [2, [b.ifFlagAtLeast(spot(7), 1, [
      b.giveItemDialog(0x166e, spot(2), 0, 0x151),
      b.ifFlagAtLeast(spot(2), 1, [b.onceEncounter(spot(8), B, 0x3e, 0, 0)]),
    ])]],
  ]);
}

/** Zone 83 (2,9): the farms around Krizsan, which the plague reaches by day. */
function zone83(b: SpecBuilder): Map<number, Step[]> {
  const Z = 83, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** A farm the monsters overrun on E3's day `day` (`FUN_10d0_54b8(day, 0)`). */
  const farm = (day: number, then: Step[]): Step[] =>
    [b.ifDayReached(e3DayReached(day, 0).day, [b.msg(B, 0x35)], then)];
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16c6, [b.onceEncounter(spot(1), B, 0x31, 0, 0)])]],
    [2, [b.giveItemDialog(0x16c9, spot(2), 0x102)]],
    [11, farm(35, [b.askDialog(0x16c7, [b.msg(B, 0x32, 0x33)])])],
    // TODO(E3-3): the second dialog's yes opens a food stall (food record 9).
    [12, farm(25, [b.askDialog(0x16c7, [b.dialog(0x16c8)])])],
    [14, farm(15, [b.askDialog(0x16c7, [b.msg(B, 0x34)])])],
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

export const ZONE_SCRIPTS = new Map<number, PlaceScript>([[0, zone0], [1, zone1], [2, zone2], [3, zone3], [4, zone4], [5, zone5], [6, zone6], [7, zone7], [8, zone8], [9, zone9], [10, zone10], [11, zone11], [12, zone12], [13, zone13], [14, zone14], [15, zone15], [16, zone16], [17, zone17], [18, zone18], [19, zone19], [20, zone20], [73, zone73], [74, zone74], [83, zone83], [89, zone89]]);
