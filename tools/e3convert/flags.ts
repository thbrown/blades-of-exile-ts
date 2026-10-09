/**
 * Exile 3's story flags, as the engine's SDFs.
 *
 * E3 keeps its flags as a flat byte array at party+0x84 and addresses flag
 * `(a, b)` as `a*10 + b` everywhere: the talk nodes (`FUN_1020_1d1d`), a
 * creature's death flag (`spec1`/`spec2`, set by END_DIE and checked when a
 * town loads), and the encounter code. That is BoE's `stuff_done[x][10]`
 * before BoE widened it. The engine's SDF is `[350][50]`, so a flag keeps its
 * row and column, canonicalised through the flat index so that `(a, b)` with
 * `b >= 10` lands where E3 would have put it.
 */

import { SDF_ROWS } from '../../src/universe/party';

export function e3Flag(a: number, b: number): [row: number, col: number] {
  const idx = a * 10 + b;
  const row = Math.floor(idx / 10);
  if (idx < 0 || row >= SDF_ROWS) throw new Error(`E3 flag (${a},${b}) is outside the engine's SDF`);
  return [row, idx % 10];
}

/**
 * E3's "key times", `party.key_times[20]` (party+0x84fd): the day each plot
 * event happened, 30000 until it does. Event `k` is the engine's key `k + 1`,
 * since the engine reads key 0 as "no event".
 */
export function e3Event(k: number): number {
  return k + 1;
}

/**
 * A `day_reached(day, event)` test, E3's (`FUN_10d0_54b8`), in the engine's
 * terms. E3 adds 20 days, as BoE 1997's Windows build did; OBoE's does not,
 * so the day moves here. Event 8 is "none".
 *
 * This is for the engine's own day tests (a creature's time flag, a town's
 * chop). A script's test is `SpecBuilder.ifE3DayReached`, which keeps the
 * event with E3's meaning.
 *
 * The event is kept: E3 skips the change if the event happened *before*
 * the day, and an event that never happened (30000) does not stop it, which
 * the engine's `day-reached` = `1997` flag agrees with (DIVERGENCES.md #9).
 */
export function e3DayReached(day: number, event: number): { day: number; event: number } {
  return { day: day + 20, event: event === 8 ? 0 : e3Event(event) };
}

/**
 * A flag of the converter's own for a one-shot spot, where E3 erases the
 * spot instead. E3's flags only use columns 0–9, so columns 10–49 are free:
 * town `t`'s spot `k` (under 40) is `(t, 10 + k)`, and zone `z`'s (under 18)
 * is `(200 + z, 10 + k)`.
 */
export function e3SpotFlag(place: { zone: number } | { town: number }, k: number): [number, number] {
  return 'town' in place ? [place.town, 10 + k] : [200 + place.zone, 10 + k];
}

/**
 * A converter flag that a new day clears: `(290, 10 + k)`. E3 stamps some
 * things with the day they last happened (Levy's pay, Elisa's rations) and
 * compares it with `calc_day()`; the engine has no node that reads the day
 * into a flag, so a daily timer clears these instead (`dailyReset`).
 */
export function e3DailyFlag(k: number): [number, number] {
  return [290, 10 + k];
}

/**
 * A converter flag counting days, `(293, 10 + k)`: where E3 stamps a day and
 * later subtracts, the daily timer advances one of these instead
 * (`towns/plot.ts`).
 *
 * Every converter flag is in columns 10–49. Columns 0–9 are E3's own bytes
 * (`e3Flag`), even in rows no transcription names: `(294, 0)` is party+0xc00,
 * a golem generator's flag (`towns/entry.ts`), and the town states once sat
 * there.
 */
export function e3DayCount(k: number): [number, number] {
  return [293, 10 + k];
}

/**
 * E3's day stamps and the converter flags that stand in for them, for a
 * save (`e3SaveImport.ts`, `e3SaveExport.ts`). A stamp is a party-record
 * byte or word holding `calc_day()` (`FUN_10d0_548b`):
 *
 * - a **daily** one is compared for equality with today, the whole day
 *   against the byte (`1020:2ef8`), and its flag is set exactly when the two
 *   match: Levy's pay (21,7) and Elisa's rations (21,8) (`LEVY_PAID`,
 *   `ELISA_FED`, `towns/talkScripts.ts`), Hawke's chores (102,5)
 *   (`HAWKE_DAY`, `towns/dungeons2.ts`; `10b8:2a9d`);
 * - a **count** is subtracted from today and read as at least `max`:
 *   Ostoth's order, party+0x8511 (`key_times[10]`), set on ordering
 *   (`1020:3452`) and "made" while it is 20000 or less (`1020:3426`), ready
 *   at 4 days (`1020:347e`); `OSTOTH_DAYS`, `towns/newCotra.ts`, counts while
 *   `OSTOTH_WEAPON` (party+0x22b) is set.
 */
export const E3_DAILY_STAMPS: { at: number; flag: [number, number] }[] = [
  { at: 0x15d, flag: e3DailyFlag(0) },
  { at: 0x15e, flag: e3DailyFlag(1) },
  { at: 0x485, flag: e3DailyFlag(2) },
];
export const E3_DAY_COUNTS: { at: number; count: [number, number]; while: [number, number]; max: number; unset: number }[] = [
  { at: 0x8511, count: e3DayCount(0), while: e3Flag(0, 0x22b - 0x84), max: 4, unset: 20000 },
];

/**
 * A converter flag holding a changing town's state, `(294, 10 + k)` for the
 * `k`th of `towns/townStates.ts`'s groups: 0–3, how many records past the
 * first the party walks into. A scenario `<town-flag>` adds it to the town
 * number, which is how E3's loader swaps the record (`FUN_10d8_0107`).
 */
export function e3TownState(k: number): [number, number] {
  return [294, 10 + k];
}
