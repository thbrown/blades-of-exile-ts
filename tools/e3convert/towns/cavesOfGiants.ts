/**
 * The Caves of the Giants (towns 30 and 31): `FUN_1078_3c6f` and
 * `FUN_1078_4089`, message block 58. The hill giants' home, with the
 * passage to the Giant's Forge (town 55) and the Barrier Cavern (103).
 */

import { DamageType } from '../../../src/data/monster';
import { FieldType } from '../../../src/data/fields';
import { PAT_SQUARE, partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

const BLOCK = 58;
/** The giant's key, from the box on level 2. */
const GIANTS_KEY = partySpecItem(0x2e);
/** The lights-out runes' seven lights (`FUN_1008_48d9`): flags 0xc28–0xc2e. */
const RUNES: Flag[] = Array.from({ length: 7 }, (_, k) => f(0xc28 + k));
/** Which runes each of the seven buttons toggles (DGROUP 0x2ba). */
const RUNE_BUTTONS = [[1, 2, 0], [4, 5, 3], [1, 0], [1, 2], [6, 5], [5], [3, 6]];
const PANEL: Flag = [291, 18];

function upper(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const down = (x: number, y: number): Step[] => [b.askDialog(0xce4, [b.changeTown(31, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    // The altar's knife and coins: taking them hatches a firebird's egg,
    // quickfire behind the altar, and the ways out close.
    [1, [b.ifFlagEq(spot(1), 0, [
      b.giveItemDialog(0xce5, spot(1), 0x164, 2700),
      b.ifFlagAtLeast(spot(1), 1, [
        b.msg(BLOCK, 3), b.placeField(0xf, 0xd, FieldType.FIELD_QUICKFIRE),
        b.setTer(0xb, 0x17, 0x76), b.setTer(0xe, 0x18, 0x75), b.setTer(0xf, 0x18, 0x75), b.setTer(0x10, 0x18, 0x75),
      ]),
    ])]],
    [2, [b.trap(0xdde, spot(2), 0x14)]],
    [3, [b.onceMsg(spot(3), BLOCK, 4)]],
    [4, [b.onceMsg(f(0x1c2), BLOCK, 7, 8)]],
    // A chest with a rune in the lid: 18d6 of magic around the party.
    [11, [b.askDialog(0xd7a, [b.msg(BLOCK, 1), b.patternBoom(PAT_SQUARE, DamageType.MAGIC, 18)], [b.blockMove()])]],
    [14, down(3, 2)], [15, down(2, 0x3d)], [16, down(0x22, 2)], [17, down(0x3a, 6)],
    // The concealed door out of the burning temple puts the fire out.
    [20, [b.ifTer(0xe, 0x18, 0x75, [
      b.msg(BLOCK, 2), b.setTer(0xe, 0x18, 0x7e), b.setTer(0xf, 0x18, 0x7e), b.setTer(0x10, 0x18, 0x7e),
      b.removeField(0, 0, 63, 63, FieldType.FIELD_QUICKFIRE),
    ])]],
    [21, [b.msg(BLOCK, 6), b.setFlag(f(0x1b0), 1)]],
    // The magic brush behind the escape: it closes after you.
    [22, [b.ifTer(0x38, 0x39, 0x52, [], [b.msg(BLOCK, 9), b.setTer(0x38, 0x39, 0x52), b.setTer(0x38, 0x3b, 0x52)])]],
    // Boxes of a dead soldier's things, for his family: special items 45–48.
    ...[23, 24, 25, 26].map((id): [number, Step[]] => [id, [b.ifFlagEq(f(0xc07 + id), 0, [
      b.askDialog(0xce6, [b.setFlag(f(0xc07 + id), 1), b.giveSpecItem(22 + id)]),
    ])]]),
  ]);
}

function lower(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  /** E3's literal from its code segment, a click (sound 34), and doors. */
  const lever = (literal: number, squares: [number, number, number][]): Step[] =>
    [b.log(0x1078, literal), ...squares.map(([x, y, t]) => b.setTer(x, y, t))];
  const up = (dlg: number, x: number, y: number): Step[] => [b.askDialog(dlg, [b.changeTown(30, x, y)]), b.blockMove()];
  /** To the Giant's Forge: out to zone (4,5) and in. */
  const toForge = (): Step[] => [b.msg(BLOCK, 0xb), b.exitTo(4, 5, 0x1a, 0x1d), b.changeTown(0x37, 0x2a, 0x2c)];
  const shut = (): Step[] => lever(0x4066, [[0xc, 0x11, 0], [0xc, 0x12, 0], [0xc, 0x13, 0], [0xd, 0x20, 0], [0xe, 0x20, 0]]);
  /** All seven runes lit opens (54,23); any dark closes it again. */
  const runeDoor = (): Step => RUNES.reduceRight<Step>(
    (inner, flag) => b.ifFlagEq(flag, 1, [inner], [b.ifTer(0x36, 0x17, 0x8d, [b.setTer(0x36, 0x17, 0x8c)])]),
    // Opening it also puts town 54 on the map (party+0x84bb, `can_find_town[54]`).
    b.ifTer(0x36, 0x17, 0x8c, [b.setTer(0x36, 0x17, 0x8d), b.townVisible(54)]));
  /** E3 lights the runes on its panel; here each press lists them. */
  const showRunes = (): Step[] => RUNES.map((flag, k) =>
    b.ifFlagEq(flag, 1, [b.say(`Rune ${k + 1} glows.`)], [b.say(`Rune ${k + 1} is dark.`)]));
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0xcf0, spot(1), 0, 300 + GIANTS_KEY)]],
    // The snake pit: the giants' pets come out.
    [2, [b.msg(BLOCK, 0xc, 0xd), b.bringIn(200, 1), b.setFlag(spot(2), 20)]],
    [3, [b.dialog(0xcf1)]],
    [4, [b.onceMsg(spot(4), BLOCK, 0xe)]],
    [5, [b.askDialog(0xcee, toForge())]],
    [11, [b.askDialog(0xcee, toForge())]],
    // A pressure plate opens the snake pit's doors.
    [12, shut()],
    [14, up(0xcef, 1, 0x32)], [15, up(0xcef, 1, 8)], [16, up(0xcef, 0x2b, 7)], [17, up(0xcf2, 0x38, 1)],
    [19, [b.askDialog(0xcee, [b.changeTown(0x67, 4, 5)]), b.blockMove()]],
    // Until the snakes are out, these close their doors.
    [20, [b.ifFlagEq(spot(2), 0, lever(0x406d, [[0xc, 0x11, 0x5f], [0xc, 0x12, 0x5f], [0xc, 0x13, 0x5f]]))]],
    [21, [b.ifFlagEq(spot(2), 0, lever(0x4074, [[0xd, 0x20, 0x5f], [0xe, 0x20, 0x5f]]))]],
    // The padlocked door that only the giant's key opens.
    [22, [b.ifTer(0x2f, 0x17, 0x8a, [b.ifSpecItem(GIANTS_KEY,
      [b.msg(BLOCK, 0x11), b.setTer(0x2f, 0x17, 0x87)], [b.msg(BLOCK, 0x10), b.blockMove()])])]],
    // The lights-out runes (dialog 0xcf4).
    [23, [b.ledPanel(0xcf4, RUNE_BUTTONS.map((toggles) => [
      ...toggles.map((k) => b.ifFlagEq(RUNES[k]!, 0, [b.setFlag(RUNES[k]!, 1)], [b.setFlag(RUNES[k]!, 0)])),
      ...showRunes(), runeDoor(),
    ]), PANEL, RUNE_BUTTONS.map((_, i) => `button ${i + 1}`))]],
    [24, lever(0x407b, [[0x3b, 7, 0]])],
    [25, lever(0x4082, [[0x38, 6, 0]])],
  ]);
}

export function cavesOfGiants(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    return town === 30 ? upper(b, spot) : lower(b, spot);
  };
}
