/**
 * Exile 3's outdoor encounters, zone by zone: the arms of the outdoor
 * handler's switch on the zone. Zones below 21 are in `FUN_10a0_0062`, 21–44
 * in `FUN_10a0_1595`, 45–79 in `FUN_10a8_0100` and the rest in
 * `FUN_10a8_2acc` (the split is in the caller, `exile3.c` near line 59350).
 * A zone's message block is `zone / 10 + 80`.
 */

import type { PlaceScript } from '../specials';
import { e3DayReached } from '../flags';
import { partyFlag as f, zoneSpotFlag, type SpecBuilder, type Step } from '../script';

const block = (zone: number) => Math.floor(zone / 10) + 80;

/** Zone 73 (1,8): around Fort Emergence. */
function zone73(b: SpecBuilder): Map<number, Step[]> {
  const Z = 73, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // A find marked by slot 8's flag, with a word first if it's been had.
    [1, [b.ifFlagAtLeast(spot(8), 1, [b.msg(B, 0x1c)]), b.giveItemDialog(0x1662, spot(8), 0x180)]],
    [2, [b.onceMsg(spot(2), B, 0x1d)]],
    // The goblin outpost: every visit shows the dialog and marks it found.
    // TODO(E3-3): journal entry 3.
    [3, [b.dialog(0x1663), b.setFlag(f(0xc95), 1), b.setFlag(spot(3), 20)]],
    [4, [b.onceEncounter(spot(4), B, 0x1e, 0, 0)]],
    [5, [b.onceEncounter(spot(5), B, 0x21, 0, 1)]],
    [6, [b.onceMsg(spot(6), B, 0x22)]],
  ]);
}

/** Zone 74 (2,8): north of Krizsan. */
function zone74(b: SpecBuilder): Map<number, Step[]> {
  const Z = 74, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    // TODO(E3-3): 1 (`FUN_10c0_482d(1)`, which marks (274,1) when it succeeds).
    // 2: once flag (274,7) is set, the Metal Lumps (special item 37) are
    // here, and taking them brings an encounter.
    [2, [b.ifFlagAtLeast(spot(7), 1, [
      b.giveItemDialog(0x166e, spot(2), 0, 0x151),
      b.ifFlagAtLeast(spot(2), 1, [b.onceEncounter(spot(8), B, 0x3e, 0, 0)]),
    ])]],
  ]);
}

/** Zone 83 (2,9): the farms around Krizsan, which the plague reaches by day. */
function zone83(b: SpecBuilder): Map<number, Step[]> {
  const Z = 83, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  /** A farm the monsters overrun on E3's day `day` (`FUN_10d0_54b8(day, 0)`). */
  const farm = (day: number, then: Step[]): Step[] =>
    [b.ifDayReached(e3DayReached(day, 0).day, [b.msg(B, 0x35)], then)];
  return new Map<number, Step[]>([
    [1, [b.askDialog(0x16c6, [b.onceEncounter(spot(1), B, 0x31, 0, 0)])]],
    [2, [b.giveItemDialog(0x16c9, spot(2), 0x102)]],
    [11, farm(35, [b.askDialog(0x16c7, [b.msg(B, 0x32, 0x33)])])],
    // TODO(E3-3): the second dialog's yes opens a food stall (food record 9).
    [12, farm(25, [b.askDialog(0x16c7, [b.dialog(0x16c8)])])],
    [14, farm(15, [b.askDialog(0x16c7, [b.msg(B, 0x34)])])],
  ]);
}

/** Zone 89 (8,9): the caves outside Fort Emergence. */
function zone89(b: SpecBuilder): Map<number, Step[]> {
  const Z = 89, B = block(Z), spot = (id: number) => zoneSpotFlag(Z, id);
  return new Map<number, Step[]>([
    [1, [b.giveItemDialog(0x1702, spot(1), 0x38)]],
    [2, [b.giveItemDialog(0x1703, spot(2), 0, 2400)]],
    [3, [b.askDialog(0x1704, [b.xp(10), b.msg(B, 2, 3)], [b.msg(B, 4)]), b.setFlag(spot(3), 20)]],
    [4, [b.onceMsg(spot(4), B, 5, 6)]],
    [5, [b.onceEncounter(spot(5), B, 7, 8, 0)]],
  ]);
}

export const ZONE_SCRIPTS = new Map<number, PlaceScript>([[73, zone73], [74, zone74], [83, zone83], [89, zone89]]);
