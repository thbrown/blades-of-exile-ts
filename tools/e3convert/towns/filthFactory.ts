/**
 * The Filth Factory (towns 26 and 27), which breeds the roaches plaguing
 * the Isle of Bigail: `FUN_1078_259e` and `FUN_1078_294f`, message block 57.
 *
 * Both levels also have per-turn code in `FUN_10c0_61c4` (near 10c0:65bf):
 * a countdown that restarts the slime flow on level 1, and the machinery
 * that fills level 2's barrels or, with the pipes capped, bursts them.
 * Those are `townCountdown`s here.
 */

import { FieldType } from '../../../src/data/fields';
import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

const BLOCK = 57;
/** Level 1's slime flow: turns until it restarts, 0 while it flows. */
const HALTED = f(0x191);
/** Level 2: 1 while the pipes' caps are closed. */
const CAPPED = f(0x199);
/** Level 2: turns the machinery has left to run. */
const MACHINERY = f(0x19a);
/** Level 2: 1 once the barrels were filled. */
const FILLED = f(0x198);
/** Level 2: 1 while the dissecting rune is on. */
const RUNE = f(0x19b);
/** The Phoenix Egg, which burns the roach pit. */
const PHOENIX_EGG = partySpecItem(0x58);
/** E3's roach plague: 1 once the factory has burned. */
export const FACTORY_BURNED = f(0xc87);

// The converter's own flags (`flags.ts`: row 291 from column 10 is free).
const PANEL: Flag = [291, 12];
const RIVER_TIMER: Flag = [291, 13];
const MACHINERY_TIMER: Flag = [291, 14];
const FOOD_BITS: Flag[] = Array.from({ length: 15 }, (_, k): Flag => [291, 20 + k]);
const FOOD_COUNT: Flag = [291, 15];

/** The wall level 2's burst pipes break down (DGROUP 0x37e0). */
const PIPE_WALL = { x: 52, y: 34, ter: 132 };
/** Level 1's scavenger gates (DGROUP 0x458), which the panel opens and shuts. */
const GATES: [number, number][] = [[4, 16], [5, 16], [6, 16], [7, 16], [41, 51], [42, 51], [43, 51], [52, 7], [52, 8], [52, 9]];
const WATER = 71;

function level1(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  /** The flow's trench, dry (210) while halted, and the grate above it (47,33). */
  const trench = (grate: number, floor: number): Step[] => [b.setTer(47, 33, grate), b.rectTer(47, 34, 52, 35, floor)];
  const gates = (t: number): Step => b.seq(GATES.map(([x, y]) => b.setTer(x, y, t)));
  // The flow restarts after 120 turns (10c0:66bb). A party caught in the
  // trench in town mode drowns; in combat, each PC standing in it does.
  const halt = b.townCountdown(26, HALTED, 120, RIVER_TIMER, (s) => new Map<number, Step[]>([
    [100, [s.msg(BLOCK, 0x2e)]],
    [40, [s.msg(BLOCK, 0x2f)]],
    [0, [s.setTer(47, 33, 140), s.rectTer(47, 34, 52, 35, WATER),
      s.ifPartyOnTer(WATER, [s.msg(BLOCK, 0x31), s.slayParty(0)], [
        s.msg(BLOCK, 0x30),
        s.eachPc(() => [s.ifTargetOnTer(WATER, [s.msg(BLOCK, 0x38), s.slayParty(2)])]),
      ])]],
  ]));
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x10a5, [b.msg(BLOCK, 0x19), b.setFlag(spot(1), 20), b.cureDiseaseAll()])]],
    // E3 adds 4 to every PC's disease outright.
    [2, [b.msg(BLOCK, 0x1a), b.setFlag(spot(2), 20), b.diseaseAll(4)]],
    [3, [b.onceMsg(spot(3), BLOCK, 0x1b, 0x1c)]],
    [4, [b.dialog(0x10a6), b.setFlag(spot(4), 20)]],
    [5, [b.onceMsg(spot(5), BLOCK, 0x27)]],
    [6, [b.onceMsg(spot(6), BLOCK, 0x28)]],
    [11, [b.dialog(0x10a4), b.blockMove()]],
    // The whirlpool: everyone is gone.
    [12, [b.msg(BLOCK, 0x20), b.slayParty(0)]],
    // The control panel (dialog 0xcc0, handled by `FUN_1008_436d`).
    [14, [b.ledPanel(0xcc0, [
      [gates(0)],
      [b.ifFlagEq(HALTED, 0, [b.msg(BLOCK, 0x2d), ...trench(141, 210), halt])],
      [b.ifFlagAtLeast(HALTED, 1, [b.setFlag(HALTED, 0), ...trench(140, WATER)])],
      [gates(132)],
    ], PANEL)]],
    [15, [b.ifFlagEq(HALTED, 0, [b.msg(BLOCK, 0x26)], [b.msg(BLOCK, 0x25)])]],
    // A lever that only grinds.
    [16, [b.lever([b.msg(BLOCK, 0x29)])]],
    // The control room lets one in at a time.
    [17, [b.askDialog(0xcc1, [b.splitParty(0x33, 0x10)]), b.blockMove()]],
    [18, [b.askDialog(0xcc2, [b.reuniteParty()]), b.blockMove()]],
    [19, [b.ifTer(53, 20, 132, [b.msg(BLOCK, 0x2c), b.setTer(53, 20, 150), b.setTer(54, 20, 150)])]],
    [20, [b.askDialog(0x10a7, [b.changeTown(27, 6, 0x27)]), b.blockMove()]],
    [21, [b.askDialog(0x10a7, [b.changeTown(27, 0x37, 0xd)]), b.blockMove()]],
    [28, [b.dialog(0xcc3)]],
  ]);
}

function level2(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  /** Levers 22 and 24 do nothing once the pipes have burst; E3 says why from its code segment. */
  const unlessBurst = (literal: number, then: Step[]): Step =>
    b.ifTer(PIPE_WALL.x, PIPE_WALL.y, PIPE_WALL.ter, then, [b.log(0x1078, literal), b.blockMove()]);
  // Ten turns of machinery: capped pipes burst and open the wall, open ones
  // fill the barrels.
  const runMachinery = b.townCountdown(27, MACHINERY, 10, MACHINERY_TIMER, (s) => new Map<number, Step[]>([
    [5, [s.ifFlagEq(CAPPED, 1, [s.msg(BLOCK, 0x6c)])]],
    [0, [s.ifFlagEq(CAPPED, 1, [s.msg(BLOCK, 0x6d), s.setTer(PIPE_WALL.x, PIPE_WALL.y, 0)],
      [s.setFlag(FILLED, 1), s.msg(BLOCK, 0x6e)])]],
  ]));
  const teleport = (x: number, y: number): Step[] => [b.askDialog(0xcc5, [b.moveParty(x, y)])];
  return new Map<number, Step[]>([
    [1, [b.dialog(0xcc8), b.setFlag(spot(1), 20)]],
    // The heart of the roach pit, where the Phoenix Egg burns it all.
    // TODO(E3-3): party+0x849f, which E3 zeroes here.
    [2, [b.ifSpecItem(PHOENIX_EGG, [b.askDialog(0xcca, [
      b.dialog(0xccb), b.setFlag(spot(2), 20), b.setFlag(FACTORY_BURNED, 1), b.journal(8),
      b.placeField(0x1d, 0x1f, FieldType.FIELD_QUICKFIRE), b.xp(25), b.takeSpecItem(PHOENIX_EGG),
      b.removeCreatures(), b.setEvent(1),
    ])], [b.dialog(0xcc9)]), b.blockMove()]],
    [3, [b.trap(0xccc, spot(3), 0x17)]],
    [4, [b.trap(0xccc, spot(4), 0x17)]],
    [5, [b.giveItemDialog(0xccd, spot(5), 0, 327)]],
    [9, [b.msg(BLOCK, 0x36), b.blockMove()]],
    [11, [b.dialog(0x10a4), b.blockMove()]],
    [12, [b.askDialog(0xcc6, [b.changeTown(26, 0x2f, 0x28)]), b.blockMove()]],
    [14, teleport(6, 0x3a)],
    [15, teleport(0x3c, 0x3c)],
    [16, teleport(6, 0x38)],
    [17, teleport(3, 3)],
    [18, teleport(0x3a, 3)],
    [19, [b.askDialog(0xcc6, [b.changeTown(26, 0xe, 0x27)]), b.blockMove()]],
    [21, [b.msg(BLOCK, 0x35), b.halveFood(FOOD_BITS, FOOD_COUNT)]],
    // The caps on the sampling room's pipes.
    [22, [b.lever([unlessBurst(0x2939, [
      b.ifFlagEq(CAPPED, 0, [b.msg(BLOCK, 0x68), b.setFlag(CAPPED, 1)], [b.msg(BLOCK, 0x67), b.setFlag(CAPPED, 0)]),
    ])])]],
    // The rune's switch.
    [23, [b.lever([b.msg(BLOCK, 0x69), b.ifFlagEq(RUNE, 0, [b.setFlag(RUNE, 1)], [b.setFlag(RUNE, 0)])])]],
    // The machinery.
    [24, [b.lever([unlessBurst(0x2928, [
      b.ifFlagAtLeast(MACHINERY, 1, [b.msg(BLOCK, 0x6b), b.setFlag(MACHINERY, 0)], [b.msg(BLOCK, 0x70), runMachinery]),
    ])])]],
    [25, [b.lever([b.msg(BLOCK, 0x6a), b.swapTer(0x38, 0x1c, 0x8c, 0x8d), b.swapTer(0x3a, 0x1c, 0x8c, 0x8d)])]],
    // The sampling room.
    [26, [b.ifTer(PIPE_WALL.x, PIPE_WALL.y, PIPE_WALL.ter, [
      b.ifFlagEq(CAPPED, 0, [b.msg(BLOCK, 0x65)], [b.msg(BLOCK, 0x66)]),
      b.ifFlagAtLeast(FILLED, 1, [b.msg(BLOCK, 0x6f)]),
    ], [b.msg(BLOCK, 0x71)])]],
    // The dissecting rune: 10d10 to everyone standing on it, when on.
    [27, [b.ifFlagEq(RUNE, 0, [b.msg(BLOCK, 0x3a)], [b.msg(BLOCK, 0x3b), b.damageDice(10, 10, 0), b.blockMove()])]],
  ]);
}

export function filthFactory(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    return town === 26 ? level1(b, spot) : level2(b, spot);
  };
}
