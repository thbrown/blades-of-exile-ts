/**
 * OUTDOOR.DAT: 90 zones of 3,220 bytes, 9 across and 10 down, zone
 * `y * 9 + x`. The records are big-endian (the Mac original's byte order; the
 * Windows game byte-swaps after reading, in the E3 counterpart of
 * `port_out`) and follow BoE's `outdoor_record_type` for most of their length.
 * Pinned from EXILE3.EXE's zone loader, `FUN_1040_3677` — see FORMATS.md.
 */

import { LegacyReader, type LegacyLoc, type LegacyRect } from '../../src/fileio/legacy/structs';

export const E3_ZONE_SIZE = 3220;
export const E3_ZONES_WIDE = 9;
export const E3_ZONES_HIGH = 10;

/**
 * A wandering or special-encounter group: 24 bytes, where BoE's
 * `out_wandering_type` is 22.
 */
export interface E3OutWandering {
  /** `monst[7]`. Slot 0 is empty in every group the game ships. */
  monst: number[];
  friendly: number[];
  /**
   * The six 16-bit fields the loader byte-swaps, at +10, +14, +16, +18, +20
   * and +22. BoE has six int16s here too (`spec_on_meet` … `end_spec2`), but
   * E3 has a 2-byte gap after the first and what each one means is not yet
   * pinned, so they keep their positions for now.
   */
  words: number[];
  /** +12 and +13, which the loader leaves alone. +12 is often 1. */
  gap: number[];
}

export interface E3Outdoor {
  /** terrain[x][y], as the game indexes it (`x * 48 + y`). */
  terrain: number[][];
  specialLocs: LegacyLoc[];
  /**
   * `special_id[18]`: the encounter number handed to the outdoor special
   * handler (`FUN_10a0_0062`), which clears the slot once the encounter runs.
   */
  specialId: number[];
  exitLocs: LegacyLoc[];
  /** Town numbers, as TOWN.DAT indexes them. */
  exitDests: number[];
  signLocs: LegacyLoc[];
  wandering: E3OutWandering[];
  wanderingLocs: LegacyLoc[];
  infoRect: LegacyRect[];
  /** One name per `infoRect`, stored inline where BoE had `strlens`. */
  areaNames: string[];
  name: string;
  specialEnc: E3OutWandering[];
  /**
   * The last 288 bytes: one bit per tile (48×48), set on about nine tiles a
   * zone. No code reads it at a fixed offset; its meaning is open.
   */
  tileBits: Uint8Array;
}

function readWandering(r: LegacyReader): E3OutWandering {
  const monst = r.u8s(7);
  const friendly = r.u8s(3);
  const w10 = r.i16();
  const gap = r.u8s(2);
  const rest = r.i16s(5);
  return { monst, friendly, words: [w10, ...rest], gap };
}

export function readE3Outdoor(r: LegacyReader): E3Outdoor {
  const start = r.pos;
  const terrain = Array.from({ length: 48 }, () => r.u8s(48));
  const out: E3Outdoor = {
    terrain,
    specialLocs: r.locs(18),
    specialId: r.u8s(18),
    exitLocs: r.locs(8),
    exitDests: r.i8s(8),
    signLocs: r.locs(8),
    wandering: Array.from({ length: 4 }, () => readWandering(r)),
    wanderingLocs: r.locs(4),
    infoRect: r.rects(8),
    areaNames: Array.from({ length: 8 }, () => r.cstr(30)),
    name: r.cstr(30),
    specialEnc: Array.from({ length: 4 }, () => readWandering(r)),
    tileBits: r.bytes(288),
  };
  r.expect(start, E3_ZONE_SIZE, 'E3 outdoor zone');
  return out;
}

/** All 90 zones, in file order (`y * 9 + x`). */
export function readE3Outdoors(data: Uint8Array): E3Outdoor[] {
  if (data.length !== E3_ZONE_SIZE * E3_ZONES_WIDE * E3_ZONES_HIGH) {
    throw new Error(`OUTDOOR.DAT is ${data.length} bytes, expected ${E3_ZONE_SIZE * 90}`);
  }
  const r = new LegacyReader(data, true);
  return Array.from({ length: 90 }, () => readE3Outdoor(r));
}
