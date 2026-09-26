/**
 * Sharimik (towns 8–11, one city in four states): `FUN_1078_2f0c`
 * (`ghidra/project/sharimik.s`). Its message block is 53.
 *
 * As in Shayder, most flags are named by address (town 8's, or plot flags),
 * so they hold for the city in every state.
 */

import { DamageType } from '../../../src/data/monster';
import { e3DeathFlag } from '../flags';
import { PAT_SQUARE, partyFlag as f, partySpecItem, townSpotFlag, type SpecBuilder, type Step } from '../script';

const BLOCK = 53;
/** Sloan's ring, hidden under a stone (talk scripts 144–145). */
export const SLOAN_RING = partySpecItem(0x60);
/** Set when the party may look for it. */
export const RING_HIDDEN = f(0xde);
/** A ticket for the boat to Farport, from Kurt. */
export const FARPORT_TICKET = f(0xdd);
/**
 * Spragin, creature 0 in every state. E3 asks whether he is alive; the
 * converter gives him a death flag to ask instead (`e3DeathFlag`). One flag
 * for all four states, where E3 keeps each town's dead apart.
 */
export const SPRAGIN_DEAD = e3DeathFlag(0);
export const SHARIMIK_DEATH_FLAGS: [string, [number, number]][] =
  [8, 9, 10, 11].map((t) => [`${t}:0`, SPRAGIN_DEAD]);

export function sharimik(town: number) {
  return (b: SpecBuilder): Map<number, Step[]> => {
    const spot = (id: number) => townSpotFlag(town, id);
    /** A trapped dresser or treasury: going in turns the town on the party. */
    const alarm = (dlg: number, msg: number, id: number): Step[] =>
      [b.askDialog(dlg, [b.msg(BLOCK, msg), b.setFlag(spot(id), 20), b.makeTownHostile()], [b.blockMove()])];
    /** The greeting once, and a note that the party has been seen. */
    const welcome: Step[] = [b.ifFlagEq(f(0xc08), 0, [b.dialog(0xc09), b.setFlag(f(0xc08), 1)])];
    return new Map<number, Step[]>([
      // Where Sloan said: his ring, under a stone.
      [1, [b.ifFlagAtLeast(RING_HIDDEN, 1, [b.askDialog(0xc08, [
        b.giveSpecItem(SLOAN_RING), b.setFlag(RING_HIDDEN, 0),
      ])])]],
      // The gates: until flag 0xc85 or 0xc87 is set (missions reported at
      // the fort), the guards know the Exiles and turn them away.
      [2, [b.ifFlagEq(f(0xc85), 0, [
        b.ifFlagEq(f(0xc87), 0, [b.dialog(0xc0a), b.blockMove()], welcome),
      ], welcome)]],
      // A troglodyte shockwave cracks the wall, and the shock troops come in.
      [3, [b.ifFlagEq(f(0xd7), 0, [b.setFlag(f(0xd7), 20), b.dialog(0xc0b), b.bringIn(200, 1)])]],
      [4, [b.trap(0x107c, spot(4), 20)]],
      [5, [b.onceMsg(f(0xd9), BLOCK, 8)]],
      [6, alarm(0xc0d, 6, 6)],
      [7, alarm(0xc0e, 9, 7)],
      // A scroll tube; taking it in one state takes it in all of them.
      [8, [b.giveItemDialog(0xc0f, spot(8), 0xd0), b.ifFlagAtLeast(spot(8), 1, [
        b.setFlag(f(0xe6), 20), b.setFlag(f(0xf0), 20), b.setFlag(f(0xfa), 20),
      ])]],
      // The boat to Farport (village 126), with Kurt's ticket.
      [11, [b.ifFlagEq(FARPORT_TICKET, 0, [b.msg(BLOCK, 4)], [b.askDialog(0xc0c, [
        b.addAge(800), b.setFlag(FARPORT_TICKET, 0), b.msg(BLOCK, 3),
        b.exitTo(2, 7, 0x18, 0x14), b.changeTown(0x7e, 0x18, 6),
      ])]), b.blockMove()]],
      [14, [b.ifFlagEq(SPRAGIN_DEAD, 0, [b.msg(BLOCK, 7), b.blockMove()])]],
      // "Fireballs explode!": three 3×3 blasts of 20 dice of fire.
      [15, [b.msg(BLOCK, 10), ...[0, 1, 2].map(() => b.patternBoom(PAT_SQUARE, DamageType.FIRE, 20))]],
      // A door of locking runes, which knows the party once flag 0xe8 is 3.
      [16, [b.ifFlagBelow(f(0xe8), 3, [b.msg(BLOCK, 0xc), b.blockMove()], [
        b.ifTer(0x34, 0x33, 0x6a, [b.msg(BLOCK, 0xd), b.setTer(0x34, 0x33, 0x67)]),
      ])]],
      [17, [b.askDialog(0xc10, [b.msg(BLOCK, 0x11), b.teachSpell(0x29)])]],
      // A rune under the dresser: poison gas.
      [18, [b.msg(BLOCK, 0x12), b.poisonAll(5)]],
    ]);
  };
}
