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

/** Belt Alpha's and Belt Star's squares, set from their flags. */
export function setBelts(b: SpecBuilder): Step[] {
  return [BELT_ALPHA, BELT_STAR].map((belt) => b.ifFlagAtLeast(belt.flag, 1,
    belt.squares.map(([x, y]) => b.setTer(x, y, SOUTH)), belt.squares.map(([x, y]) => b.setTer(x, y, NORTH))));
}

function level1(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  return new Map<number, Step[]>([
    [1, [b.dialog(0xcf8), b.setFlag(spot(1), 20)]],
    [2, [b.askDialog(0xd04, [b.moveParty(0x12, 4)])]],
    [11, [b.askDialog(0xd7f, [b.changeTown(33, 5, 5)]), b.blockMove()]],
    // TODO(E3-3): E3 also sets party+0x12e6 (`FUN_1080_022e`) going down.
    [12, [b.askDialog(0xd7e, [b.changeTown(108, 0x18, 0x1d)]), b.blockMove()]],
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
    [15, stairs(0xd7e, 108, 0x12, 0x13)],
    [16, stairs(0xd7e, 32, 0x2a, 0xa)],
    [17, stairs(0xd7f, 60, 0x18, 5)],
    // A belt that reverses as the party reaches it.
    [18, [b.ifTer(0x1f, 0x18, 0xf8, [], [b.msg(BLOCK, 0x1d), b.setTer(0x1f, 0x18, 0xf8), b.setTer(0x19, 0x1a, 0x6c)])]],
    [19, [b.askDialog(0xd04, [b.moveParty(0x32, 0x27)])]],
    [20, [b.dialog(0xd05)]],
    [21, [b.ledPanel(0xd06, buttons.map(press), PANEL, buttons.map((k) => b.dialogText(0xd06, k + 1))), ...setBelts(b)]],
    [22, [b.lever([b.msg(BLOCK, 0x1f), b.swapTer(0x3b, 0x30, 0xf7, 0xf9)])]],
    [23, [b.ifLevelTotal(12, [b.msg(BLOCK, 0x17), b.teachSpell(0x9d)], [b.msg(BLOCK, 0x19)])]],
    [24, [b.ifLevelTotal(20, [b.msg(BLOCK, 0x18), b.teachSpell(0x34)], [b.msg(BLOCK, 0x19)])]],
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
  // TODO(E3-3): E3 also sets party+0x12e6 (`FUN_1080_022e`) on the way up.
  return new Map<number, Step[]>([
    [11, [b.dialog(0xff0)]],
    [12, [b.ifTer(0x17, 0x1a, 0x6d, [b.msg(66, 0x2d), b.setTer(0x17, 0x1a, 0x6c), b.setTer(0x19, 0x1a, 0x6c)])]],
    [14, [b.askDialog(0xd7f, [b.changeTown(33, 0x20, 0x24)]), b.blockMove()]],
    [15, [b.askDialog(0xd7f, [b.changeTown(32, 0x17, 0x3c)]), b.blockMove()]],
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
