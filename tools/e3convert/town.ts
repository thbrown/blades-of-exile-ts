/**
 * TOWN.DAT: 200 records. Each is a 1,058-byte common record followed by a
 * block whose size depends on the record number, the arithmetic of E3's town
 * loader (`FUN_1040_1e1c`):
 *
 * | records | block | bytes |
 * |---|---|---|
 * | 0–39 | large, 64×64 | 5,904 |
 * | 40–79 | medium, 48×48 | 3,532 |
 * | 80–119 | small, 32×32 | 1,724 |
 * | 120–199 | a village: no terrain, built at load | 640 |
 *
 * Big-endian, like OUTDOOR.DAT. The common record is BoE's `town_record_type`
 * with smaller arrays and no special nodes (E3's scripting is code). See
 * FORMATS.md for what is pinned and what is still open.
 */

import { LegacyReader, type LegacyLoc, type LegacyRect } from '../../src/fileio/legacy/structs';

export const E3_TOWN_COUNT = 200;
export const E3_TOWN_RECORD_SIZE = 0x422;

export type E3TownKind = 'large' | 'medium' | 'small' | 'village';

interface Geometry { kind: E3TownKind; size: number; rooms: number; creatures: number; bytes: number }

const GEOMETRY: Geometry[] = [
  { kind: 'large', size: 64, rooms: 12, creatures: 60, bytes: 0x1710 },
  { kind: 'medium', size: 48, rooms: 10, creatures: 40, bytes: 0xdcc },
  { kind: 'small', size: 32, rooms: 4, creatures: 30, bytes: 0x6bc },
  { kind: 'village', size: 0, rooms: 0, creatures: 30, bytes: 0x280 },
];

function geometry(town: number): Geometry {
  const g = GEOMETRY[Math.min(3, Math.floor(town / 40))];
  if (!g) throw new Error(`no geometry for town ${town}`);
  return g;
}

/** Byte offset of record `town`, as the loader's `_llseek` computes it. */
export function e3TownOffset(town: number): number {
  let off = town * E3_TOWN_RECORD_SIZE;
  for (let t = 0; t < town; t += 40) {
    off += Math.min(40, town - t) * geometry(t).bytes;
  }
  return off;
}

export interface E3PresetItem {
  loc: LegacyLoc; itemCode: number; ability: number;
  charges: number; alwaysThere: number; property: number; contained: number;
}

export interface E3PresetField { loc: LegacyLoc; fieldType: number }

/** 14 bytes, where BoE's `creature_start_type` is 24. */
export interface E3CreatureStart {
  number: number; startAttitude: number; startLoc: LegacyLoc;
  mobile: number; timeFlag: number; extra1: number; extra2: number;
  spec1: number; spec2: number;
  /**
   * +10/+11, an int16: the day and event a `timeFlag` tests, packed as
   * `event * 1000 + day` (the town loader, `10d8:0d3b`: `day_reached(code %
   * 1000, code / 1000)`). Event 8 means none. -1 when unused.
   */
  timeCode: number;
  /**
   * +12/+13, big-endian: the conversation. Personality `p` is slot `p % 10`
   * of talk block `120 + floor(p / 10)` in the string table (FORMATS.md).
   */
  personality: number;
}

/**
 * The 640-byte block of records 120–199, the villages. Their maps are built at
 * load from building blocks (`FUN_1040_1600`; FORMATS.md).
 */
export interface E3Village {
  creatures: E3CreatureStart[];
  /** 15 × 8 bytes; the loader byte-swaps the first two words. */
  entries: { words: number[]; bytes: number[] }[];
  /** 10 × 10 bytes: a rect and two bytes. */
  rects: { rect: LegacyRect; bytes: number[] }[];
}

export interface E3Town {
  number: number;
  kind: E3TownKind;
  townChopTime: number;
  townChopKey: number;
  wandering: number[][];
  wanderingLocs: LegacyLoc[];
  specialLocs: LegacyLoc[];
  specId: number[];
  signLocs: LegacyLoc[];
  lighting: number;
  startLocs: LegacyLoc[];
  exitSpecs: number[];
  /**
   * Where the party comes out on leaving by each edge, in the zone the party
   * is in (`exit_locs`, in E3's order north, south, east, west; x below 1 is
   * unused). E3's end_town_mode, `FUN_10d8_252b` (`10d8:2b..` on, the
   * `es:[0xc2]`–`[0xc8]` reads), takes one where BoE nudges the party off its
   * way in. Under Tinraya (36) has only a west one, out beside its own
   * entrance in zone (1,1), not the keep's.
   */
  exitLocs: LegacyLoc[];
  inTownRect: LegacyRect;
  presetItems: E3PresetItem[];
  maxNumMonst: number;
  /** The byte-swapped word after `max_num_monst`. */
  unknown350: number;
  presetFields: E3PresetField[];
  /**
   * The four byte-swapped words that end the record: the message (block, i)
   * the town loader shows a party that walks in, and the one it shows
   * instead once the town is cleared out (`10d8:2281`, `FUN_1008_37de`).
   * 0 for none. 33 towns have one or the other (`towns/entry.ts`).
   */
  entryMsg: [number, number];
  deadMsg: [number, number];
  /** terrain[x][y]; empty for a village. */
  terrain: number[][];
  roomRects: LegacyRect[];
  roomNames: string[];
  creatures: E3CreatureStart[];
  /** lighting[row][x], one bit per tile; empty for a village. */
  lightingMap: number[][];
  village: E3Village | null;
}

function readCreature(r: LegacyReader): E3CreatureStart {
  return {
    number: r.u8(), startAttitude: r.u8(), startLoc: r.loc(),
    mobile: r.u8(), timeFlag: r.u8(), extra1: r.u8(), extra2: r.u8(),
    spec1: r.u8(), spec2: r.u8(),
    timeCode: r.i16(), personality: r.i16(),
  };
}

function readPresetItem(r: LegacyReader): E3PresetItem {
  return {
    loc: r.loc(), itemCode: r.i16(), ability: r.i16(),
    charges: r.u8(), alwaysThere: r.u8(), property: r.u8(), contained: r.u8(),
  };
}

export function readE3Town(data: Uint8Array, town: number): E3Town {
  const r = new LegacyReader(data, true);
  r.pos = e3TownOffset(town);
  const start = r.pos;
  const g = geometry(town);
  const head = {
    number: town,
    kind: g.kind,
    townChopTime: r.i16(),
    townChopKey: r.i16(),
    wandering: Array.from({ length: 4 }, () => r.u8s(4)),
    wanderingLocs: r.locs(4),
    specialLocs: r.locs(40),
    specId: r.u8s(40),
    signLocs: r.locs(12),
    lighting: r.i16(),
    startLocs: r.locs(4),
    exitSpecs: r.i16s(4),
    exitLocs: r.locs(4),
    inTownRect: r.rect(),
    presetItems: Array.from({ length: 64 }, () => readPresetItem(r)),
    maxNumMonst: r.i16(),
    unknown350: r.i16(),
    presetFields: Array.from({ length: 50 }, (): E3PresetField => ({ loc: r.loc(), fieldType: r.i16() })),
    entryMsg: [r.i16(), r.i16()] as [number, number],
    deadMsg: [r.i16(), r.i16()] as [number, number],
  };
  r.expect(start, E3_TOWN_RECORD_SIZE, 'E3 town record');

  const blockStart = r.pos;
  if (g.kind === 'village') {
    const village: E3Village = {
      creatures: Array.from({ length: g.creatures }, () => readCreature(r)),
      entries: Array.from({ length: 15 }, () => ({ words: r.i16s(2), bytes: r.u8s(4) })),
      rects: Array.from({ length: 10 }, () => ({ rect: r.rect(), bytes: r.u8s(2) })),
    };
    r.expect(blockStart, g.bytes, 'E3 village block');
    return { ...head, terrain: [], roomRects: [], roomNames: [], creatures: [], lightingMap: [], village };
  }
  const terrain = Array.from({ length: g.size }, () => r.u8s(g.size));
  const roomRects = r.rects(g.rooms);
  const roomNames = Array.from({ length: g.rooms }, () => r.cstr(30));
  const creatures = Array.from({ length: g.creatures }, () => readCreature(r));
  const lightingMap = Array.from({ length: g.size / 8 }, () => r.u8s(g.size));
  r.expect(blockStart, g.bytes, `E3 ${g.kind} town block`);
  return { ...head, terrain, roomRects, roomNames, creatures, lightingMap, village: null };
}

export function readE3Towns(data: Uint8Array): E3Town[] {
  if (data.length !== e3TownOffset(E3_TOWN_COUNT)) {
    throw new Error(`TOWN.DAT is ${data.length} bytes, expected ${e3TownOffset(E3_TOWN_COUNT)}`);
  }
  return Array.from({ length: E3_TOWN_COUNT }, (_, t) => readE3Town(data, t));
}
