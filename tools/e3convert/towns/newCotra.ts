/**
 * New Cotra (town 42): `FUN_1088_08c7`, block 60, and Ostoth's weapon
 * (talk scripts 111–115). Told who is behind the plagues (112 Erika, 113
 * the Vahnatai, 114 the dragons), Ostoth's mages make something for it
 * (flag 0x22b: 1 amulets, 2 a crystal, 3 a sword), ready
 * four days later in the chest by his room (spot 4).
 *
 * E3 stamps the day in party+0x8511 and subtracts; the engine has no node
 * that reads the day into a flag, so the converter counts the days since in
 * a flag of its own, which the daily timer advances (`towns/plot.ts`).
 */

import { e3DayCount } from '../flags';
import { partyFlag as f, partySpecItem, townSpotFlag, type Flag, type SpecBuilder, type Step } from '../script';

/** What Ostoth's mages are making: 0 nothing yet, 1–3 as above. */
export const OSTOTH_WEAPON = f(0x22b);
/** Days since the order (the converter's count of E3's party+0x8511). */
export const OSTOTH_DAYS: Flag = e3DayCount(0);

/** The daily timer's part: count the days since the order, up to 4. */
export function ostothDay(b: SpecBuilder): Step {
  return b.ifFlagAtLeast(OSTOTH_WEAPON, 1, [b.ifFlagBelow(OSTOTH_DAYS, 4, [b.incFlag(OSTOTH_DAYS)])]);
}

/** Talk scripts 111–115: Ostoth. */
export const OSTOTH_TALK = new Map<number, (b: SpecBuilder) => Step[]>([
  // 111: the weapon, once there is one; its makers are spent (creatures 1
  // and 2 of New Cotra, types 53 and 28, are gone).
  [111, (b) => [b.ifFlagEq(OSTOTH_WEAPON, 0, [b.reply(0x28, 0x29)], [b.ifFlagBelow(OSTOTH_DAYS, 4, [b.reply(0x34)], [
    b.removeCreatures(53), b.removeCreatures(28), b.reply(0x32, 0x33),
  ])])]],
  // 112–114: the answer, once; asked again, 111's reply.
  ...[112, 113, 114].map((t): [number, (b: SpecBuilder) => Step[]] => [t, (b) => [b.ifFlagEq(OSTOTH_WEAPON, 0, [
    b.setFlag(OSTOTH_WEAPON, t - 111), b.setFlag(OSTOTH_DAYS, 0), b.reply(t - 70, 0x2d),
  ], OSTOTH_TALK.get(111)!(b))]]),
  // 115: what it is.
  [115, (b) => [b.ifFlagEq(OSTOTH_WEAPON, 0, [b.replyLiteral(0x1020, 0x2e86)],
    [b.switchFlag(OSTOTH_WEAPON, [[], [b.reply(0x2e, 0x31)], [b.reply(0x2f, 0x31)], [b.reply(0x30, 0x31)]])])]],
]);

export function newCotra(b: SpecBuilder): Map<number, Step[]> {
  const B = 60, spot = (id: number) => townSpotFlag(42, id);
  const done = (): Step => b.setFlag(spot(4), 20);
  return new Map<number, Step[]>([
    // The chest: empty until the weapon is ready.
    [4, [b.ifFlagEq(OSTOTH_WEAPON, 0, [b.msg(B, 0x33)], [b.ifFlagBelow(OSTOTH_DAYS, 4, [b.msg(B, 0x33)], [
      b.switchFlag(OSTOTH_WEAPON, [[],
        [b.msg(B, 0x34), b.giveSpecItem(partySpecItem(0x4c)), done()],
        [b.msg(B, 0x35), b.giveSpecItem(partySpecItem(0x4e)), done()],
        [b.msg(B, 0x36), b.giveItem(0x167, [done()], [b.log(0x1088, 0x8af)])],
      ]),
    ])])]],
    // The bunker's password, once Commander Johnson has told it (flag (42,1)).
    [5, [b.ifFlagAtLeast(f(0x229), 1, [b.ifTer(0xd, 0xa, 0, [], [b.msg(B, 0x37), b.setTer(0xd, 0xa, 0)])])]],
  ]);
}
