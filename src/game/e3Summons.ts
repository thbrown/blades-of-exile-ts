/**
 * Exile III's summoning lists. An exile-js extension, not in BoE or OBoE: a
 * scenario with the feature flag `summons` set to `exile3` summons from these
 * instead of by monster summon class.
 *
 * BoE's `get_summon_monster` draws a random monster until one's
 * `summon_type` is the class asked for, up to 200 times. Exile III's monsters
 * have no summon class: each summoning spell makes one draw from a list of
 * its own, at the same point in the cast, so every other roll keeps its
 * place. Summon Beast has a list of its own where BoE shares class 1 with
 * Weak Summoning, and a monster may be on two lists or twice on one.
 *
 * There are two sets. Casting in combat, a PC's (`1018:1f82`) or a
 * monster's (`1018:5d0b`), reads the lists at `DS:0770`; a PC casting out of
 * combat (`10b0:3a7c`) copies its own from `DS:3072`: the same but for
 * Summon Beast's list and three of class 3's. `test/e3convert.test.ts`
 * reads both back out of EXILE3.EXE.
 */

/** `DS:0770`, `0775`, `0789`, `0799`: combat's. Summon Beast's, then BoE's classes 1–3. */
export const E3_COMBAT_SUMMONS: readonly (readonly number[])[] = [
  [82, 115, 78, 99, 78],
  [38, 40, 58, 60, 72, 75, 79, 80, 40, 118, 174, 40, 58, 60, 72, 75, 79, 80, 58, 120],
  [39, 41, 45, 47, 62, 63, 73, 74, 88, 100, 116, 130, 134, 39, 41, 45],
  [48, 49, 50, 65, 66, 67, 73, 74, 76, 84, 84, 103, 121, 127, 74, 129],
];

/** `DS:3072`, `3077`, `308b`, `309b`: out of combat's. */
export const E3_TOWN_SUMMONS: readonly (readonly number[])[] = [
  [78, 82, 99, 115, 143],
  [38, 40, 58, 60, 72, 75, 79, 80, 40, 118, 174, 40, 58, 60, 72, 75, 79, 80, 58, 120],
  [39, 41, 45, 47, 62, 63, 73, 74, 88, 100, 116, 130, 134, 39, 41, 45],
  [48, 49, 50, 65, 66, 67, 73, 74, 76, 130, 84, 103, 121, 127, 129, 129],
];
