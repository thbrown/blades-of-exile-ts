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
