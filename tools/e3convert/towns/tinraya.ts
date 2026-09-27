/**
 * The Keep of Tinraya (town 35, `FUN_1078_4a82`) and the Vahnatai fortress
 * under it (town 36, `FUN_1078_4cde`), message block 59.
 *
 * Under the keep, Rentar-Ihrno's projection has the party thrown into a
 * cell (spot 7). They wait there, food running out, until a voice lets one
 * of them out through a small teleporter (the per-turn countdown at
 * 10c0:7393, flag 0x1f2). That one splits off (spot 3), finds the cell
 * panel and frees the rest (spot 19), and then they face the Crystal Souls
 * (spot 8), with the Bunker's weapon (special item 33) if they have it.
 */

import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

const BLOCK = 59;
/** The fight with the Crystal Souls has happened. */
export const SOULS_FOUGHT = f(0x1f3);
/** The alarm has been raised from the cell panel. */
const ALARM = f(0x1f4);
/** Turns the party has been left in the cell. */
const CELL_TIMER = f(0x1f2);
const CELL_TIMER_RUNNING: Flag = [291, 21];
const PANEL: Flag = [291, 22];
/** The Vahnatai key, from the case on level 2. */
const VAHNATAI_KEY = partySpecItem(0x34);
/** The key from the murder cave near New Formello. */
const MURDER_CAVE_KEY = partySpecItem(0x20);
/** The Bunker's weapon, which puts the Crystal Souls to sleep. */
const BUNKER_WEAPON = partySpecItem(0x4e);
/** Rentar-Ihrno has shown herself (flag 0xc93); first time only. */
const MET_RENTAR = f(0xc93);
/** The doors the cell panel works (DGROUP 0x37ae): button A's does nothing. */
export const PANEL_DOORS: [number, number][] = [[42, 42], [41, 44], [33, 45], [23, 51], [41, 52], [26, 55], [26, 56], [27, 59], [37, 57], [33, 57], [31, 57], [35, 52]];
const DOOR_SHUT = 140, DOOR_OPEN = 141;

function keep(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const down = (x: number, y: number): Step[] => [b.askDialog(0xd7e, [b.changeTown(36, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    ...[1, 2, 3].map((id): [number, Step[]] => [id, [b.trap(0xd7a, spot(id), 0x14)]]),
    // The alien beasts' birthing vats: burn each once.
    ...[4, 5, 6, 7].map((id): [number, Step[]] =>
      [id, [b.askDialog(0xd16, [b.setFlag(spot(id), 20), b.msg(BLOCK, 1), b.xp(5)])]]),
    [8, [b.dialog(0xd17), b.setFlag(spot(8), 20)]],
    [11, down(0xf, 0x1d)], [12, down(0x13, 0x1c)], [14, down(0x3d, 0x3d)],
    [15, [b.lever([b.msg(BLOCK, 8), b.swapTer(4, 0xb, 0x6c, 0x6d)])]],
    [16, [b.msg(BLOCK, 9), b.e3Boom(0x69)]],
    // A dusty bedroom: rest, but the beasts gather.
    [17, [b.askDialog(0xd18, [
      b.msg(BLOCK, 0xb), b.heal(0x46), b.restoreSp(0x1e), b.addAge(500),
      b.wanderingMonster(), b.wanderingMonster(), b.wanderingMonster(),
    ])]],
  ]);
}

function fortress(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const up = (x: number, y: number): Step[] => [b.askDialog(0xd7f, [b.changeTown(35, x, y)]), b.blockMove()];
  /** A rune-covered door that `key` opens (137). */
  const runeDoor = (x: number, y: number, key: number, opens: number): Step[] => [b.ifTer(x, y, 0x8a,
    [b.ifSpecItem(key, [b.setTer(x, y, 0x87), b.msg(BLOCK, opens)], [b.msg(BLOCK, 0x10)])])];
  /** Days in the cell: food runs out, then the voice (and the teleporter's wall opens). */
  const imprison = b.townCountdown(36, CELL_TIMER, 45, CELL_TIMER_RUNNING, (s) => new Map<number, Step[]>([
    [30, [s.msg(BLOCK, 0x1a), s.takeFood(15)]],
    [15, [s.msg(BLOCK, 0x1b), s.takeFood(15)]],
    [1, [s.msg(BLOCK, 0xf), s.setTer(0x2a, 0x3e, 0x85)]],
  ]), false);
  /** The cell panel (dialog 0xd28, `FUN_1008_4ecd`'s cases): each lettered button swaps a door. */
  const panelButtons = Array.from({ length: 14 }, (_, k) => 5 + 3 * k);
  const press = (button: number): Step[] => {
    const label = b.dialogText(0xd28, button + 1);
    if (button === 41) {
      return [b.ifFlagEq(f(0x1e2), 0, [b.setFlag(f(0x1e2), 1), b.say(`${label}: ${b.exeText(0x1008, 0x4ec4)}`)],
        [b.setFlag(f(0x1e2), 0), b.say(`${label}: ${b.exeText(0x1008, 0x4ec0)}`)])];
    }
    const k = (button - 5) / 3;
    const door = PANEL_DOORS[k];
    if (k === 0 || !door) return [];
    const [x, y] = door;
    return [b.swapTer(x, y, DOOR_SHUT, DOOR_OPEN), b.ifTer(x, y, DOOR_SHUT,
      [b.say(`${label}: ${b.exeText(0x1008, 0x4eb7)}`)], [b.say(`${label}: ${b.exeText(0x1008, 0x4ebb)}`)])];
  };
  // The alarm is the last button, and closes the panel: every door opens
  // and the guards come.
  const alarm = (): Step[] => [
    b.msg(BLOCK, 0x1c), b.setFlag(ALARM, 1), b.bringIn(201, 1),
    ...PANEL_DOORS.slice(1).map(([x, y]) => b.setTer(x, y, DOOR_OPEN)),
  ];
  const labels = panelButtons.map((k) => b.dialogText(0xd28, k + 1));
  return new Map<number, Step[]>([
    [1, [b.msg(BLOCK, 0x12), b.setFlag(spot(1), 20),
      ...[0x13, 0x14, 0x15, 0x17, 0x18, 0x19].map((x) => b.setTer(x, 4, 0xc1))]],
    [2, [b.giveItemDialog(0xd27, spot(2), 0, 300 + VAHNATAI_KEY)]],
    // The small teleporter out of the cell takes one.
    [3, [b.askDialog(0xd19, [b.setFlag(spot(3), 20), b.splitParty(0x1b, 0x2a, [b.setFlag(spot(3), 0)], [BLOCK, 0x18])]),
      b.blockMove()]],
    // The hall of the Crystal Souls: captured.
    [7, [b.ifFlagEq(SOULS_FOUGHT, 0, [
      b.ifFlagEq(MET_RENTAR, 0, [
        b.dialog(0xd24), b.journal(0x19), b.takeSpecItem(partySpecItem(0x46)), b.setFlag(MET_RENTAR, 1),
        b.townVisible(87), b.setFlag(f(0x225), 1),
      ], [b.dialog(0xd23)]),
      b.moveParty(0x28, 0x3d), b.msg(BLOCK, 0xe), imprison, b.blockMove(),
    ])]],
    // Back to the hall, free.
    [8, [b.ifFlagEq(SOULS_FOUGHT, 0, [
      b.setFlag(SOULS_FOUGHT, 1), b.bringIn(200, 1),
      b.ifSpecItem(BUNKER_WEAPON, [b.dialog(0xd25), b.removeCreatureSlots([0, 1, 2, 3])], [b.dialog(0xd26)]),
    ])]],
    // Meditating at a crystal: the first time poisons the PC who does, and
    // later ones cure a point. E3 adds 1 to the status outright (up to 20).
    [11, [b.askDialog(0xd22, [b.choosePc([
      b.msg(BLOCK, 0xd), b.ifFlagEq(spot(0), 0, [b.poison(1)], [b.poison(-1)]), b.incFlag(spot(0)),
    ], [b.blockMove()])])]],
    [12, runeDoor(12, 32, VAHNATAI_KEY, 0x11)],
    [14, up(2, 0x20)], [15, up(0x10, 0x1a)], [20, up(0x2d, 0x30)],
    [16, [b.ifSplit([b.msg(BLOCK, 0x13), b.blockMove()])]],
    [17, runeDoor(28, 7, MURDER_CAVE_KEY, 0x14)],
    [18, [b.ifFlagAtLeast(SOULS_FOUGHT, 1, [b.msg(BLOCK, 0x1d)], [b.ifFlagAtLeast(ALARM, 1, [b.msg(BLOCK, 0x1d)], [
      b.ledPanel(0xd28, panelButtons.map((k) => (k === 44 ? alarm() : press(k))), PANEL, labels, [14]),
    ])])]],
    // The cell's two crystals: one opens the wall E3 tests (36,59) against
    // at (38,59) — E3's own mismatch, kept; the other frees the party.
    [19, [b.choiceDialog(0xd29,
      [b.ifTer(36, 59, 150, [b.log(0x1078, 0x4cbc)], [b.msg(BLOCK, 0x16), b.setTer(38, 59, 150)])],
      [b.ifTer(36, 61, 150, [b.log(0x1078, 0x4ccd)], [
        b.msg(BLOCK, 0x16), b.setTer(38, 61, 150),
        b.ifSplit([b.msg(BLOCK, 0x17), b.reuniteParty(), b.blockMove()]),
      ])])]],
  ]);
}

export function tinraya(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    return town === 35 ? keep(b, spot) : fortress(b, spot);
  };
}
