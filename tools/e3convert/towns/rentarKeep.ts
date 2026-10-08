/**
 * The Keep of Rentar-Ihrno, Exile 3's end: the upper keep (town 38,
 * `FUN_1078_55ff`, block 59) and the vats below it (town 64,
 * `FUN_1088_56f5`, block 62).
 *
 * Below, ten levers (spots 20–29) open channels of goo, flags 0x304–0x30d,
 * in four chains; the last of each chain (1, 3, 6, 9) fills a vat. Above,
 * with every lever pulled, Rentar-Ihrno waits by her pedestal; Erika's
 * amulets bring Erika to duel her. At the pedestal (dialog 0xd39,
 * `FUN_1008_51e5`), Release, Power Up and Begin, in that order and with
 * all four vats full, win the game.
 */

import { panelFlag, partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

/** The channels' flags, one per lever (`0x2f0 + id` for lever `id`). */
const CHANNEL = (k: number): Flag => f(0x304 + k);
/** The lever each needs pulled first (DGROUP 0x1dbc), or -1. */
const NEEDS = [-1, 0, -1, 2, -1, 4, 5, -1, 7, 8];
/** The four vats: the last channel of each chain (DGROUP 0x46c). */
const VATS = [1, 3, 6, 9];
/**
 * Each channel's squares (`FUN_10d8_239b`, DGROUP 0x37f2): x from/to, y
 * from/to. Opened, floor (0) there becomes goo (75) and portcullis 140
 * becomes 141.
 */
const CHANNEL_RECTS: [number, number, number, number][] = [
  [7, 15, 10, 19], [10, 18, 20, 21], [9, 13, 33, 42], [14, 23, 31, 33], [33, 37, 7, 14],
  [38, 42, 14, 18], [32, 42, 19, 21], [35, 43, 32, 38], [35, 41, 39, 44], [28, 34, 31, 44],
];
/** Pedestal progress: 0, 1 released, 2 powered, 3 begun (the end). */
const PEDESTAL = f(0x208);
/** Rentar-Ihrno's teleports: 10 once Erika has fallen, then 1–6. */
const TELEPORTS = f(0x209);
/** Which reading crystal is next (spots 20–25). */
const CRYSTALS = f(0x207);
/** Erika's amulets, and the story flags that let them work. */
const AMULETS = partySpecItem(0x54);
/** Erika is creature 14; this converter flag is set while she duels. */
const ERIKA_HERE: Flag = [291, 24];
/** The party came up stair 14, which opens the portcullis at (41,1) above (`towns/entry.ts`). */
export const UP_STAIR_14: Flag = [291, 25];
const PANEL: Flag = [291, 26];
/** A special class the converter gives E3's pants (variety 22), for spot 11. */
export const PANTS_CLASS = 222;

/** Channel `k` opened, on its squares as converted. */
export function openChannel(b: SpecBuilder, k: number): Step[] {
  const [x1, x2, y1, y2] = CHANNEL_RECTS[k]!;
  return [b.rectReplace(x1, y1, x2, y2, 0, 75), b.rectReplace(x1, y1, x2, y2, 140, 141)];
}

/** Every channel whose lever is pulled, opened: town 64's entry. */
export function openChannels(b: SpecBuilder): Step[] {
  return CHANNEL_RECTS.map((_, k) => b.ifFlagAtLeast(CHANNEL(k), 1, openChannel(b, k)));
}

function upper(b: SpecBuilder, spot: (id: number) => Flag): Map<number, Step[]> {
  const B = 59;
  const down = (x: number, y: number): Step[] => [b.askDialog(0xd7e, [b.changeTown(64, x, y)]), b.blockMove()];
  const amuletsReady = (then: Step[]): Step =>
    b.ifSpecItem(AMULETS, [b.ifFlagAtLeast(f(0x262), 3, [b.ifFlagEq(f(0x263), 0, then)])]);
  /** Every lever pulled. */
  const allChannels = (then: Step[]): Step =>
    CHANNEL_RECTS.reduceRight<Step>((inner, _, k) => b.ifFlagAtLeast(CHANNEL(k), 1, [inner]), b.seq(then));
  const allVats = (then: Step[], otherwise: Step[]): Step =>
    VATS.reduceRight<Step>((inner, k) => b.ifFlagAtLeast(CHANNEL(k), 1, [inner], otherwise), b.seq(then));
  const noVats = (then: Step[], otherwise: Step[]): Step =>
    VATS.reduceRight<Step>((inner, k) => b.ifFlagEq(CHANNEL(k), 0, [inner], otherwise), b.seq(then));
  const drain = (): Step[] => CHANNEL_RECTS.map((_, k) => b.setFlag(CHANNEL(k), 0));
  const beep = (): Step => b.msg(B, 0x3a);
  /**
   * The pedestal's four buttons (dialog 0xd39, "Rentar-Ihrno's Control
   * Panel", `FUN_1008_51e5`); with no vat full, none of them does
   * anything. Only a Begin that works closes the panel. Each vat's word
   * (controls 14, 16, 18, 20) is "Z!" while its channel flag is 1.
   */
  const pedestal = (): Step => b.panel(0xd39, [0x1028, 0x63a], [
    [noVats([beep()], [...drain(), b.setFlag(PEDESTAL, 0), b.msg(B, 0x39)])],
    [noVats([beep()], [b.ifFlagEq(PEDESTAL, 0, [b.msg(B, 0x3b), b.setFlag(PEDESTAL, 1)], [beep()])])],
    [noVats([beep()], [b.ifFlagEq(PEDESTAL, 1, [b.msg(B, 0x3c), b.setFlag(PEDESTAL, 2)], [beep()])])],
    (again) => [noVats([beep(), again], [b.ifFlagEq(PEDESTAL, 2, [
      allVats([b.setFlag(PEDESTAL, 3)], [b.msg(B, 0x3d, 0x3e), ...drain(), b.setFlag(PEDESTAL, 0), again]),
    ], [beep(), again])])],
  ], PANEL, new Map(VATS.map((k, i): [number, string] =>
    [14 + 2 * i, panelFlag(CHANNEL(k), [b.exeText(0x1008, 0x51e3), b.exeText(0x1008, 0x51e0), b.exeText(0x1008, 0x51e3)])])));
  return new Map<number, Step[]>([
    [1, [b.dialog(0xd34), b.setFlag(spot(1), 20)]],
    [2, [b.onceMsg(spot(2), B, 0x2a)]],
    [3, [b.dialog(0xd35), b.setFlag(spot(3), 20)]],
    // Rentar-Ihrno, once every channel below is open; Erika joins, if called.
    [4, [allChannels([
      b.dialog(0xd36), amuletsReady([b.dialog(0xd37), b.bringIn(200, 2), b.setFlag(ERIKA_HERE, 1)]),
      b.setFlag(spot(4), 20),
    ])]],
    [5, [b.trap(0xd3c, spot(5), 0x14)]],
    // A secret: a pair of pants dropped at (17,58) opens the way to town 65.
    [11, [(next) => b.node('if-item-class-at', {
      ex1: [0x11, 0x3a], ex2: [PANTS_CLASS, b.seq([b.changeTown(65, 4, 0x2b)])(next)],
    }, next)]],
    [12, [b.askDialog(0xe2e, [b.msg(B, 0x2d), b.swapTer(0x29, 1, 0x8c, 0x8d)])]],
    [14, down(7, 0x2e)], [15, down(6, 2)], [16, down(0x2e, 4)], [17, down(0x2a, 0x2e)],
    // The reading crystals: each goes dark after one reading, and together
    // they explain the pedestal.
    ...[20, 21, 22, 23, 24, 25].map((id): [number, Step[]] => [id, [b.onceSpot(id, [b.askDialog(0xd38, [
      b.switchFlag(CRYSTALS, [
        [b.msg(B, 0x2e), b.eachPc(() => [b.ifStat(101, 5, [b.drainSp(5)])])],
        [b.msg(B, 0x2e), b.eachPc(() => [b.ifStat(101, 5, [b.drainSp(5)])])],
        [b.msg(B, 0x2f), b.eachPc(() => [b.ifStat(101, 5, [b.drainSp(5)])])],
        [b.msg(B, 0x2f), b.eachPc(() => [b.ifStat(101, 5, [b.drainSp(5)])])],
        [b.msg(B, 0x30)],
        [b.msg(B, 0x31, 0x35)],
      ]),
      b.incFlag(CRYSTALS),
    ])])]]),
    // The pedestal. Erika's duel ends as the party reaches it; without her,
    // Rentar-Ihrno teleports them away five times first.
    [26, [
      b.ifFlagAtLeast(ERIKA_HERE, 1, [b.ifCreature(14, 'here', [
        b.setFlag(TELEPORTS, 10), b.dialog(0xd3a), b.removeCreatureSlots([14]), b.setFlag(ERIKA_HERE, 0),
      ])]),
      b.ifFlagBelow(TELEPORTS, 5, [
        b.incFlag(TELEPORTS),
        b.ifFlagBelow(TELEPORTS, 2, [b.msg(B, 0x36)], [b.msg(B, 0x37)]),
        ...[0, 1, 2, 3].map(() => b.wanderingMonster()),
        b.moveParty(0xe, 0x20),
      ], [
        b.ifFlagEq(TELEPORTS, 5, [b.msg(B, 0x38), b.setFlag(TELEPORTS, 6)]),
        pedestal(),
        b.ifFlagEq(PEDESTAL, 3, [b.dialog(0xd3b), (next) => b.node('end-scen', {}, next)]),
      ]),
      b.blockMove(),
    ]],
    [27, [b.askDialog(0xd38, [b.msg(B, 0x34)])]],
  ]);
}

function vats(b: SpecBuilder): Map<number, Step[]> {
  const B = 62;
  const up = (x: number, y: number, first: Step[] = []): Step[] =>
    [b.askDialog(0xd7f, [...first, b.changeTown(38, x, y)]), b.blockMove()];
  return new Map<number, Step[]>([
    [14, up(0x2a, 1, [b.setFlag(UP_STAIR_14, 1)])],
    [15, up(0x23, 0x3b)], [16, up(0x3e, 0x3b)], [17, up(0x3e, 1)],
    // The levers: each opens its channel once the one before it is open.
    ...NEEDS.map((need, k): [number, Step[]] => [20 + k, [b.ifFlagAtLeast(CHANNEL(k), 1, [b.dialog(0xe39)], [
      b.askDialog(0xe38, [need >= 0
        ? b.ifFlagEq(CHANNEL(need), 0, [b.msg(B, 0x20)], [b.msg(B, 0x21), b.setFlag(CHANNEL(k), 1), ...openChannel(b, k)])
        : b.seq([b.msg(B, 0x21), b.setFlag(CHANNEL(k), 1), ...openChannel(b, k)])]),
    ])]]),
  ]);
}

export function rentarKeep(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    return town === 38 ? upper(b, spot) : vats(b);
  };
}
