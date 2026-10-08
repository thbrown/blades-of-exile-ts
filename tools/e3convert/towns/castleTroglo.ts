/**
 * Castle Troglo (town 28, `FUN_1078_3303`) and the caves under it (town 29,
 * `FUN_1078_37c4`), message block 57. King Vothkaro's story:
 *
 * - With Sharimik's papers the party gets in, blindfolded, to a holding
 *   cell (stage 1). After 25 turns the door opens (stage 2): Vothkaro will
 *   see them. Walking off instead gets them marched back with a scroll
 *   (stage 3 when the door opens again).
 * - His conversation moves the story to 4–6 (talk nodes set flag (28,4)
 *   directly; `FUN_1020_1484` sets 4 for one reply).
 * - At 5 or 6 his letter lies in the cell, and a secret door opens to the
 *   caves below, where the party kills Khazi Elhioc behind a combination
 *   gate; coming back up at 6 ends it (stage 7).
 * - Stage 7, or a hostile town, turns the castle against the party
 *   (`towns/entry.ts`).
 *
 * The cell door's countdown is the castle's per-turn code (10c0:6891).
 */

import { DamageType } from '../../../src/data/monster';
import { PAT_SQUARE, panelFlag, partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

const BLOCK = 57;
/** Vothkaro's story, 0–7. */
export const TROGLO_STAGE = f(0x1a4);
/** Turns until the cell door opens. */
const CELL_TIMER = f(0x1a3);
/** 1 once the troglodytes are at war with the party. */
export const TROGLO_WAR = f(0xc8a);
/** Sharimik's papers for the diplomats. */
const PAPERS = partySpecItem(0x5e);
/** Vothkaro's scroll for Sharimik's mayor. */
const VOTHKARO_SCROLL = partySpecItem(0x62);
const CELL_TIMER_RUNNING: Flag = [291, 16];
/** Which button of the gate's panel, for `panel`. */
const PANEL: Flag = [291, 17];
/** What the gate's panel says was heard: 0 nothing yet, 1 muffled, 2 loud. */
const HEARD: Flag = [291, 35];

/** The cell door, locked (106) or open (103). */
const CELL_DOOR = { x: 0x38, y: 0x30 };
/** The cell. */
const CELL = { x: 0x36, y: 0x30 };

function castle(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  /** The cell door opens when the countdown ends; stages 1 and 2 move on. */
  const lockIn = b.townCountdown(28, CELL_TIMER, 25, CELL_TIMER_RUNNING, (s) => new Map<number, Step[]>([
    [1, [s.ifFlagBelow(TROGLO_STAGE, 2,
      [s.msg(BLOCK, 0x78), s.setTer(CELL_DOOR.x, CELL_DOOR.y, 0x67), s.setFlag(TROGLO_STAGE, 2)],
      [s.msg(BLOCK, 0x79), s.setTer(CELL_DOOR.x, CELL_DOOR.y, 0x67), s.ifFlagEq(TROGLO_STAGE, 2, [s.setFlag(TROGLO_STAGE, 3)])]),
    s.setFlag(CELL_TIMER, 0)]],
  ]), false);
  /** Into the cell (`FUN_10c0_46a4(0x36, 0x30, 1)`). */
  const toCell = (): Step[] => [b.moveParty(CELL.x, CELL.y)];
  return new Map<number, Step[]>([
    // Sound 66, not the message's usual 57 (1078:3346).
    [1, [b.askDialog(0xcd0, [b.msg(BLOCK, 0x3e, 0, undefined, 66), b.drainSpAll()])]],
    // The gates: papers get the party in, blindfolded, to the cell.
    [2, [b.ifFlagBelow(TROGLO_STAGE, 7, [b.ifFlagEq(TROGLO_WAR, 0, [b.ifInCombat([b.log(0x1078, 0x32bd)], [
      b.ifSpecItem(PAPERS, [b.askDialog(0xcd3, [b.askDialog(0xcd4, [
        b.ifFlagEq(TROGLO_STAGE, 0, [b.setFlag(TROGLO_STAGE, 1), b.msg(BLOCK, 0x76, 0x77)], [b.msg(BLOCK, 0x74)]),
        ...toCell(),
        b.ifFlagBelow(TROGLO_STAGE, 4, [b.setTer(CELL_DOOR.x, CELL_DOOR.y, 0x6a), lockIn]),
      ], [b.msg(BLOCK, 0x75)])], [b.msg(BLOCK, 0x72)])],
      [b.askDialog(0xcd2, [b.msg(BLOCK, 0x73)], [b.msg(BLOCK, 0x72)])]),
    ])])]), b.blockMove()]],
    [3, [b.msg(BLOCK, 0x48), b.blockMove()]],
    [4, [b.onceMsg(spot(4), BLOCK, 0x41, 0x42)]],
    // The end of the passage from the cell. Spot 20 closes it (2); at war
    // it is dead (20).
    [5, [b.ifFlagAtLeast(TROGLO_WAR, 1, [b.setFlag(spot(5), 20)], [b.ifInCombat([b.log(0x1078, 0x32e0), b.blockMove()], [
      b.ifFlagEq(spot(5), 2, [b.msg(BLOCK, 0x48), b.blockMove()], [b.switchFlag(TROGLO_STAGE, [
        ...[0, 1, 2].map(() => [
          b.dialog(0xcd1), lockIn, b.giveItem(b.note(31, 0xb5)), ...toCell(),
          b.setTer(CELL_DOOR.x, CELL_DOOR.y, 0x6a), b.blockMove(),
        ]),
        [], [],
        // Vothkaro's letter in the cell, and the secret door to the caves.
        ...[5, 6].map(() => [
          b.ifFlagEq(spot(5), 0, [b.placeItem(0x35, 0x30, b.note(31, 0xb6)), b.setFlag(spot(5), 1)]),
          b.setTer(0x34, 0x33, 0x65),
        ]),
        [b.setFlag(spot(5), 1), b.msg(BLOCK, 0x48), b.blockMove()],
      ])]),
    ])])]],
    // A trapdoor over coals: the floor around it gives way once.
    [6, [b.ifTerAtSpot(6, 0x4b, [], [b.msg(BLOCK, 0x45), b.rectTer(0x3a, 0xe, 0x3e, 0x12, 0x4b)])]],
    ...([[11, 0x1b, 0x37], [12, 0x30, 0x33], [14, 0x3d, 0xc]] as const).map(([id, x, y]): [number, Step[]] =>
      [id, [b.askDialog(0xd7e, [b.changeTown(29, x, y)]), b.blockMove()]]),
    [20, [b.setFlag(spot(5), 2)]],
  ]);
}

/** The gate's six dials: flags 0xc32–0xc37, how many ways each turns, and its column. */
const DIALS = [
  { flag: f(0xc32), n: 6, x: 3, y: 0xe }, { flag: f(0xc33), n: 6, x: 4, y: 0xe }, { flag: f(0xc34), n: 6, x: 5, y: 0xe },
  { flag: f(0xc35), n: 3, x: 6, y: 0xe }, { flag: f(0xc36), n: 3, x: 7, y: 0x11 }, { flag: f(0xc37), n: 3, x: 8, y: 0xe },
];

function caves(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  /** Each dial opens one square of its column (150) and walls the rest (132). */
  const gate = (): Step[] => DIALS.flatMap((d) => Array.from({ length: d.n }, (_, v) =>
    b.ifFlagEq(d.flag, v, [b.setTer(d.x, d.y + v, 150)], [b.setTer(d.x, d.y + v, 132)])));
  /** Fire over the spot, 13d6 (`FUN_1018_99f2(loc, 13)`). */
  const fire = (): Step => b.patternBoom(PAT_SQUARE, DamageType.FIRE, 13);
  const upTo = (x: number, y: number): Step[] => [b.ifFlagEq(TROGLO_WAR, 0,
    [b.askDialog(0xd7f, [b.msg(BLOCK, 0x54)])],
    [b.askDialog(0xd7f, [b.changeTown(28, x, y)])]), b.blockMove()];
  return new Map<number, Step[]>([
    [1, [b.msg(BLOCK, 0x49), b.bringIn(201, 3), b.setFlag(spot(1), 20)]],
    [2, [b.dialog(0xcdb), fire()]],
    [3, gate()],
    [4, [b.trap(0xd7a, spot(4), 0x14)]],
    [5, [b.dialog(0xcde)]],
    [6, [b.msg(BLOCK, 0x52), b.bringIn(200, 3), b.setFlag(spot(6), 20)]],
    [11, [b.askDialog(0xcda, [b.ifMageLoreTotal(10,
      [b.msg(BLOCK, 0x4d), b.teachSpell(0x9f), b.teachSpell(0xa1)], [b.msg(BLOCK, 0x4c)])])]],
    // The gate's panel (dialog 0xcdf, "Odd Array of Buttons",
    // `FUN_1008_461a`): each button turns a dial, and the walls follow.
    // Controls 13–18 show the dials, and 19–20 what was heard: the first
    // three turn quietly, the last three loudly. Nothing's heard as it opens.
    [14, [b.setFlag(HEARD, 0), b.panel(0xcdf, [0x1028, 0x5e8], DIALS.map((d, i) => [
      b.incFlag(d.flag), b.ifFlagAtLeast(d.flag, d.n, [b.setFlag(d.flag, 0)]), ...gate(),
      b.setFlag(HEARD, i < 3 ? 1 : 2),
    ]), PANEL, new Map([
      ...DIALS.map((d, i): [number, string] => [13 + i, panelFlag(d.flag)]),
      [19, panelFlag(HEARD, ['', b.exeText(0x1008, 0x45a7), b.exeText(0x1008, 0x45e2)])],
      [20, panelFlag(HEARD, ['', b.exeText(0x1008, 0x45c6), b.exeText(0x1008, 0x45fe)])],
    ]))]],
    ...[15, 21, 22].map((id): [number, Step[]] => [id, [b.askDialog(0xcdc, [b.msg(BLOCK, 0x4f), fire()])]]),
    [16, [b.ifTerAtSpot(16, 0xa4, [b.msg(BLOCK, 0x51), b.setTerAtSpot(16, 150)])]],
    [17, upTo(0x15, 0x2b)],
    // Back up after Khazi Elhioc: Vothkaro's messenger, and the scroll for Sharimik.
    [18, [b.askDialog(0xd7f, [
      b.ifFlagEq(TROGLO_STAGE, 6, [
        b.dialog(0xcd7), b.setFlag(TROGLO_STAGE, 7), b.takeSpecItem(PAPERS), b.giveSpecItem(VOTHKARO_SCROLL),
        b.journal(0x22),
      ]),
      b.changeTown(28, 0x33, 0x33),
    ]), b.blockMove()]],
    [19, upTo(0x3d, 0x1b)],
    [20, [b.askDialog(0xcdd, [b.changeTown(0x67, 4, 0x1a)]), b.blockMove()]],
  ]);
}

export function castleTroglo(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    return town === 28 ? castle(b, spot) : caves(b, spot);
  };
}
