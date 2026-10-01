/**
 * The Tower of Shifting Floors, the golem factory: level 1 (town 32,
 * `FUN_1078_4491`) and level 2 (town 33, `FUN_1078_45b8`), message block 58;
 * level 3 (town 60, `FUN_1088_4745`, block 62) and the basement (town 108,
 * `FUN_10b8_3e9d`, block 66).
 * Its floors are conveyor belts (terrains 247–250, `tables.ts`).
 *
 * Level 2's control panel (dialog 0xd06, `FUN_1008_4d3e`, buttons handled by
 * `FUN_1008_4b58`) toggles five settings, flags 0x4c1–0x4c5. Two of them
 * turn level 2's belts north or south when the panel is left, and again as
 * the level loads (`towns/entry.ts`); Belt Beta turns the basement's (town
 * 108). The other five buttons say "Not authorized."
 */

import { partyFlag as f, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

const BLOCK = 58;
const PANEL: Flag = [291, 19];
/** Belt Alpha and Belt Star: the squares each turns, and their flags. */
export const BELT_ALPHA = { flag: f(0x4c3), squares: [[5, 51], [6, 51]] as [number, number][] };
export const BELT_STAR = { flag: f(0x4c5), squares: [[32, 10], [32, 11]] as [number, number][] };
/** Belt Beta, which runs the basement's belts (town 108) the other way. */
export const BELT_BETA = f(0x4c4);
const NORTH = 247, SOUTH = 249;

/** Each panel button (a control id) with what it toggles: flag and E3's two words for it. */
const PANEL_SETTINGS = new Map<number, { flag: Flag; off: number; on: number }>([
  [32, { flag: f(0x4c1), off: 0x4b39, on: 0x4b3e }],
  [26, { flag: f(0x4c2), off: 0x4b42, on: 0x4b47 }],
  [17, { flag: f(0x4c3), off: 0x4b4c, on: 0x4b4e }],
  [23, { flag: f(0x4c4), off: 0x4b50, on: 0x4b52 }],
  [29, { flag: f(0x4c5), off: 0x4b54, on: 0x4b56 }],
]);

/**
 * Level 1's sixteen golem generators (terrain 255): each one's flag and its
 * square, in the order E3 numbers them. The squares are one table at
 * 1140:0190; the flags are party+0xc0a on for the first ten and party+0xc00
 * on for the other six (`10c0:720e`, `10d8:1dff`).
 *
 * Dispel Barrier on a generator's square sets its flag (`10b0:66f5`, in
 * E3's dispel; `towns/sanctify.ts` has it), and nothing clears one. The
 * spawner and the entry case (`towns/entry.ts`) test them.
 */
export const GENERATORS: { flag: Flag; x: number; y: number }[] = [
  ...[[8, 3], [12, 7], [2, 13], [14, 13], [30, 20], [23, 26], [6, 25], [11, 41], [16, 54], [4, 57]]
    .map(([x, y], i) => ({ flag: f(0xc0a + i), x: x!, y: y! })),
  ...[[25, 42], [31, 56], [35, 56], [50, 5], [48, 15], [49, 56]]
    .map(([x, y], i) => ({ flag: f(0xc00 + i), x: x!, y: y! })),
];

/** The golems a generator makes, kinds 159–163 (`0x9f + get_ran(1, 0, 4)`). */
const GOLEMS = [159, 160, 161, 162, 163];

/**
 * The generators at work (`10c0:71cb`, in the per-tick clock): on every
 * eighth tick of age, in level 1 or a fight inside it, E3 picks one of the
 * sixteen at random and, unless its flag is set, places a golem of a random
 * kind on the square north of it, hostile and hunting (`FUN_1090_3d56`,
 * which fills the first free creature slot of 60). If it found a slot, the
 * party hears "You hear a distant clang.". The engine runs it as a town
 * `<timer>` that repeats (the `town-timers` flag, `specialIncreaseAge.ts`),
 * which fires on the same ticks. With all 60 slots taken E3 places nothing
 * and says nothing; the engine's town has no limit, so the step asks how
 * many are here first.
 */
export function level1Timers(b: SpecBuilder): { freq: number; steps: Step[] }[] {
  const make = ({ flag, x, y }: (typeof GENERATORS)[number]): Step[] => [b.ifFlagEq(flag, 0, [
    // The kind is rolled first, as E3 passes it in; the slot is looked for after.
    b.randomCase(GOLEMS.length, GOLEMS.map((kind) => [b.ifCreature(0, { fewerThan: 60 }, [
      b.placeMonster(x, y - 1, kind), b.log(0x10c0, 0x6171),
    ])])),
  ])];
  return [{ freq: 8, steps: [b.randomCase(GENERATORS.length, GENERATORS.map(make))] }];
}

/** Belt Alpha's and Belt Star's squares, set from their flags. */
export function setBelts(b: SpecBuilder): Step[] {
  return [BELT_ALPHA, BELT_STAR].map((belt) => b.ifFlagAtLeast(belt.flag, 1,
    belt.squares.map(([x, y]) => b.setTer(x, y, SOUTH)), belt.squares.map(([x, y]) => b.setTer(x, y, NORTH))));
}

/**
 * The tower (32) and its basement (108) open onto zone 14 by two different
 * doors, (34,14) and (34,4). Each stair between them also moves where the
 * party will come out (party+0x12e6, through `FUN_1080_022e`), to the door
 * of the building it arrives in: DGROUP 0x1c78 and 0x1c7c going down, 0x31d2
 * going up. Without it, a party that went down would leave the basement by
 * the tower's door.
 *
 * E3 stores the square relative to its outdoor window, and `FUN_1080_022e`
 * adds 48 to x when the party is in the window's right half, but never to y
 * (party+0x12e5 is unread). So a party whose window put zone 14 in its lower
 * half would come out 48 squares north, in zone 5. That depends on E3's
 * window, which the engine's is not; the port names zone 14 outright.
 */
const toBasement = (b: SpecBuilder): Step => b.exitTo(5, 1, 34, 4);
const toTower = (b: SpecBuilder): Step => b.exitTo(5, 1, 34, 14);

function level1(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  return new Map<number, Step[]>([
    [1, [b.dialog(0xcf8), b.setFlag(spot(1), 20)]],
    [2, [b.askDialog(0xd04, [b.moveParty(0x12, 4)])]],
    [11, [b.askDialog(0xd7f, [b.changeTown(33, 5, 5)]), b.blockMove()]],
    [12, [b.askDialog(0xd7e, [toBasement(b), b.changeTown(108, 0x18, 0x1d)]), b.blockMove()]],
    [14, [b.askDialog(0xd7f, [b.changeTown(33, 0x28, 8)]), b.blockMove()]],
    [15, [b.dialog(0xcfa)]],
  ]);
}

function level2(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const stairs = (dlg: number, town: number, x: number, y: number): Step[] =>
    [b.askDialog(dlg, [b.changeTown(town, x, y)]), b.blockMove()];
  const buttons = Array.from({ length: 10 }, (_, k) => 5 + 3 * k);
  /** E3 shows every setting on the panel; here each press lists them. */
  const status = (): Step[] => [...PANEL_SETTINGS].map(([button, s]) => {
    const label = b.dialogText(0xd06, button + 1);
    return b.ifFlagEq(s.flag, 0, [b.say(`${label}: ${b.exeText(0x1008, s.off)}`)],
      [b.say(`${label}: ${b.exeText(0x1008, s.on)}`)]);
  });
  const press = (button: number): Step[] => {
    const s = PANEL_SETTINGS.get(button);
    if (!s) return [b.log(0x1008, 0x4b23)];
    return [b.ifFlagEq(s.flag, 0, [b.setFlag(s.flag, 1)], [b.setFlag(s.flag, 0)]), b.log(0x1008, 0x4b33), ...status()];
  };
  return new Map<number, Step[]>([
    [1, [b.onceMsg(spot(1), BLOCK, 0x1a)]],
    [2, [b.msg(BLOCK, 0x1b), b.bringIn(200, 1), b.setFlag(spot(2), 20)]],
    // The ore machine drops a lump (item 232) onto a belt at (40,54).
    [3, [b.msg(BLOCK, 0x1e), b.placeItem(40, 54, 0xe8), b.incFlag(spot(3))]],
    [11, [b.dialog(0xd02)]],
    [12, [b.dialog(0xd03)]],
    [14, stairs(0xd7e, 32, 2, 3)],
    [15, [b.askDialog(0xd7e, [toBasement(b), b.changeTown(108, 0x12, 0x13)]), b.blockMove()]],
    [16, stairs(0xd7e, 32, 0x2a, 0xa)],
    [17, stairs(0xd7f, 60, 0x18, 5)],
    // A belt that reverses as the party reaches it.
    [18, [b.ifTer(0x1f, 0x18, 0xf8, [], [b.msg(BLOCK, 0x1d), b.setTer(0x1f, 0x18, 0xf8), b.setTer(0x19, 0x1a, 0x6c)])]],
    [19, [b.askDialog(0xd04, [b.moveParty(0x32, 0x27)])]],
    [20, [b.dialog(0xd05)]],
    [21, [b.ledPanel(0xd06, buttons.map(press), PANEL, buttons.map((k) => b.dialogText(0xd06, k + 1))), ...setBelts(b)]],
    [22, [b.lever([b.msg(BLOCK, 0x1f), b.swapTer(0x3b, 0x30, 0xf7, 0xf9)])]],
    [23, [b.ifMageLoreTotal(12, [b.msg(BLOCK, 0x17), b.teachSpell(0x9d)], [b.msg(BLOCK, 0x19)])]],
    [24, [b.ifMageLoreTotal(20, [b.msg(BLOCK, 0x18), b.teachSpell(0x34)], [b.msg(BLOCK, 0x19)])]],
  ]);
}

/** The four spires' flags: the pylon is safe once all four are down. */
const SPIRES = [0x713, 0x71d, 0x727, 0x731].map((o) => f(o));

function level3(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const allDown = SPIRES.reduceRight<Step[]>((then, flag) => [b.ifFlagEq(flag, 0, [b.msg(62, 1), b.blockMove()], then)],
    [b.msg(62, 2, 3)]);
  return new Map<number, Step[]>([
    [1, [b.dialog(0xe13), b.setFlag(spot(1), 20)]],
    [2, allDown],
    [11, [b.askDialog(0xd7e, [b.changeTown(33, 0x20, 5)]), b.blockMove()]],
  ]);
}

function basement(b: SpecBuilder): Map<number, Step[]> {
  return new Map<number, Step[]>([
    [11, [b.dialog(0xff0)]],
    [12, [b.ifTer(0x17, 0x1a, 0x6d, [b.msg(66, 0x2d), b.setTer(0x17, 0x1a, 0x6c), b.setTer(0x19, 0x1a, 0x6c)])]],
    [14, [b.askDialog(0xd7f, [toTower(b), b.changeTown(33, 0x20, 0x24)]), b.blockMove()]],
    [15, [b.askDialog(0xd7f, [toTower(b), b.changeTown(32, 0x17, 0x3c)]), b.blockMove()]],
  ]);
}

export function shiftingFloors(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    if (town === 60) return level3(b, spot);
    if (town === 108) return basement(b);
    return town === 32 ? level1(b, spot) : level2(b, spot);
  };
}
