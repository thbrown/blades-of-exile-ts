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
 * TODO(E3-3): the event is dropped. E3 skips the change if the event happened
 * *before* the day, and an event that never happened (30000) does not stop
 * it. The engine agrees on the first and not the second — it reads an unset
 * key as "no" (DIVERGENCES.md #9) — so keeping the key would freeze every
 * such change until E3-3's scripts set it. Dropped, the change happens on its
 * day, which is what E3 does until the event is scripted.
 */
export function e3DayReached(day: number, _event: number): { day: number; event: number } {
  return { day: day + 20, event: 0 };
}
