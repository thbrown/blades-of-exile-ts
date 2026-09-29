/**
 * The Slime Pit (towns 22 and 23, two levels): `FUN_1078_155e` and
 * `FUN_1078_19df`. Message block 56 for both.
 *
 * Level 2's five slime pools (terrain 255 at DGROUP 0x37de's squares) breathe
 * sleep over the 7×7 around them each turn a party is within 8 (`10c0:6325`,
 * `make_sleep_cloud`), and an exploding missile landing on one destroys it
 * (`1018:9bb5`: flags 0x14c–0x150; the last clears spot 3's wall, flag
 * 0x16d). No BoE node reads a missile or a distance: `explode-spots` and
 * `if-near` (DIVERGENCES.md #27) do. The pools are spots of their own,
 * `POOL_SPOT` on (`emit.ts`), where two of them had E3's spot 0, which does
 * nothing.
 */

import { FieldType } from '../../../src/data/fields';
import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

/** Level 2's pools (DGROUP 0x37de). */
export const SLIME_POOLS: [number, number][] = [[13, 2], [11, 19], [34, 22], [46, 15], [46, 7]];
/** The spot ids the pools take, one each (E3's own go up to 26). */
export const POOL_SPOT = 80;
const poolGone = (i: number): Flag => f(0x14c + i);

/** Each pool's spot: an exploding missile destroys it (`1018:9bb5`). */
function poolSteps(b: SpecBuilder, i: number): Step[] {
  const [x, y] = SLIME_POOLS[i]!;
  const others = SLIME_POOLS.map((_, k) => k).filter((k) => k !== i);
  const lastOne = others.reduceRight<Step[]>((inner, k) => [b.ifFlagEq(poolGone(k), 1, inner, [b.dialog(0xca6)])],
    [b.dialog(0xca7), b.setFlag(f(0x16d), 20)]);
  return [b.ifTargeted([b.ifFlagEq(poolGone(i), 0, [...lastOne, b.setFlag(poolGone(i), 1), b.setTer(x, y, 0)])])];
}

/** Level 2's clock: every turn, each pool still there breathes sleep on a party within 8. */
export function level2Timers(b: SpecBuilder): { freq: number; steps: Step[] }[] {
  return [{
    freq: 1,
    steps: SLIME_POOLS.map(([x, y], i) => b.ifFlagEq(poolGone(i), 0, [b.ifNear(x, y, 9,
      [b.placeFieldRect(x - 3, y - 3, x + 3, y + 3, FieldType.CLOUD_SLEEP)])])),
  }];
}

const BLOCK = 56;
/** Which pedestal button was pressed last, 0–4 (`FUN_1008_4251`); `towns/entry.ts` reads it. */
export const PEDESTAL = f(0x169);
/** The converter's scratch flag for the typed button number. */
const PRESSED: Flag = [291, 11];

export function slimePit(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    /**
     * A glowing fountain, counted in `count`: the first drink restores, the
     * next nine restore or hurt (20, type 4) at even odds, then nothing.
     */
    const fountain = (dlg: number, count: Flag, good: number, bad: number, dry: number, restore: Step): Step[] =>
      [b.askDialog(dlg, [
        b.ifFlagEq(count, 0, [b.msg(BLOCK, good), restore], [
          b.ifFlagBelow(count, 10, [b.ifCoinFlip([b.msg(BLOCK, bad), b.damageAll(20, 4)], [b.msg(BLOCK, good), restore])],
            [b.msg(BLOCK, dry)]),
        ]),
        b.incFlag(count),
      ])];
    /** Down or up the spiral to the other level (`FUN_10c0_4a61`); the step is refused either way. */
    const stair = (dlg: number, to: number, x: number, y: number): Step[] =>
      [b.askDialog(dlg, [b.changeTown(to, x, y)]), b.blockMove()];
    if (town === 22) {
      return new Map<number, Step[]>([
        // 0 is below the switch's table: nothing.
        [0, []],
        [1, [b.giveItemDialog(0xc95, spot(1), 0x160)]],
        [2, fountain(0xc96, f(0x162), 0x1f, 0x20, 0x21, b.heal(20))],
        [3, [b.msg(BLOCK, 0x31), b.bringIn(200, 1), b.setFlag(f(0x163), 20)]],
        // Slimes melding with a wolf, a goblin, a lizard: kill it, or leave it.
        ...[4, 5, 6].map((id): [number, Step[]] =>
          [id, [b.askDialog(0xc94 + id, [b.msg(BLOCK, 0x24), b.setFlag(f(0x160 + id), 20)], [b.msg(BLOCK, 0x25)])]]),
        [7, [b.msg(BLOCK, 0x27, 0x28), b.bringIn(0xc9, 1), b.setFlag(f(0x167), 20)]],
        [8, [b.onceMsg(spot(8), BLOCK, 0x29)]],
        [9, [b.msg(BLOCK, 0x2f), b.diseaseAll(3)]],
        [11, [b.askDialog(0xc9b, [b.ifFlagEq(f(0xc85), 0, [b.msg(BLOCK, 0x2b, 0x2c)], [b.msg(BLOCK, 0x2d)])])]],
        // The pedestal of five buttons (dialog 0xc97, `FUN_1008_4292`). E3
        // shows five LEDs; the last one pressed opens a portcullis on level
        // 2 (towns/entry.ts). The engine asks for the number instead.
        [12, [b.dialog(0xc97),
          b.askNumber('Which button do you press? (1 to 5, or 0 for none)', 0, 5, PRESSED),
          b.ifFlagAtLeast(PRESSED, 1, [b.copyFlag(PEDESTAL, PRESSED), b.decFlag(PEDESTAL)]),
          b.blockMove()]],
        [14, [b.askDialog(0xc9c, [b.ifLevelTotal(8,
          [b.msg(BLOCK, 0x32), b.teachSpell(0x19), b.teachSpell(0x1b)], [b.msg(BLOCK, 0x33)])])]],
        [21, stair(0xc94, 23, 2, 0x3e)], [22, stair(0xc94, 23, 9, 0x3a)], [23, stair(0xc94, 23, 0x21, 0x2d)],
        [24, stair(0xc94, 23, 0x23, 0x39)], [25, stair(0xc94, 23, 0x2d, 0x1c)], [26, stair(0xc94, 23, 0x3a, 1)],
      ]);
    }
    return new Map<number, Step[]>([
      [0, []],
      [1, [b.trap(0xc9f, spot(1), 3)]],
      [2, [b.dialog(0xca0), b.setFlag(f(0x16c), 20)]],
      [3, [b.msg(BLOCK, 0x36, 0x37), b.blockMove()]],
      [4, [b.dialog(0xca1), b.setFlag(f(0x16e), 20)]],
      // The bodies rise: every Body (209) becomes cave floor.
      [5, [b.msg(BLOCK, 0x38), b.bringIn(200, 1), b.setFlag(f(0x16f), 20), b.replaceTerrain(209, 0)]],
      [6, [b.onceMsg(spot(6), BLOCK, 0x39)]],
      [7, [b.onceMsg(spot(7), BLOCK, 0x3a)]],
      [8, [b.askDialog(0xca3, [b.msg(BLOCK, 0x3b, 0x3c), b.setFlag(f(0x172), 20), b.bringIn(0xc9, 2)])]],
      [9, fountain(0xca4, f(0x173), 0x3d, 0x3e, 0x3f, b.restoreSp(20))],
      [11, [b.dialog(0xca2), b.giveSpecItem(partySpecItem(0x40))]],
      [21, stair(0xc9e, 22, 3, 0x3c)], [22, stair(0xc9e, 22, 6, 0x37)], [23, stair(0xc9e, 22, 0x1f, 0x35)],
      [24, stair(0xc9e, 22, 0x1f, 0x3a)], [25, stair(0xc9e, 22, 0x32, 0x17)], [26, stair(0xc9e, 22, 0x3a, 1)],
      ...SLIME_POOLS.map((_, i): [number, Step[]] => [POOL_SPOT + i, poolSteps(b, i)]),
    ]);
  };
}
