/**
 * Game data Exile 3 keeps in EXILE3.EXE rather than in a data file: the
 * terrain types and where a new game starts. Each value is read from the
 * table the game itself consults, found by following the code (FORMATS.md,
 * "Tables in the EXE").
 */

import type { LegacyMonster } from '../../src/fileio/legacy/structs';
import { BLADBASE_EXTRAS } from './bladbaseExtras';
import { neAutoDataSegment, readNeSegment } from './ne';

export const E3_TERRAIN_COUNT = 256;

export interface E3TerrainType {
  /** String `301 + id`. */
  name: string;
  /**
   * 0–239: TER1–TER5, 50 to a sheet. 300–314: an animation in TERANIM, four
   * frames side by side, three animations to a row.
   */
  pic: number;
  /** 0–5, BoE's `eTerObstruct` scale; outdoors, 3 and up stops the party. */
  blockage: number;
  /**
   * Passable in a boat. The outdoor move code (`FUN_1010_7169`) lets a party
   * in a boat onto these despite their blockage; it is a list of ids in the
   * code, not a table.
   */
  boat: boolean;
  /** What happens when the party moves into it; null for nothing. */
  special: E3TerrainSpecial | null;
}

/**
 * E3's doors, as BoE terrain specials. E3 has no special field: the move code
 * switches on the terrain id (`FUN_10c0_0c97`, a jump table at `10c0:186a`)
 * and the lock-pick code on another (`FUN_10d8_3f67`, `10d8:4182`).
 */
export type E3TerrainSpecial =
  /** Bumping it turns it into `to` and plays sound `sound`. */
  | { kind: 'step-change'; to: number; sound: number }
  /**
   * Locked: picking (or bashing) it turns it into `to`. `pickable` false is a
   * door E3's lock-pick code refuses outright.
   */
  | { kind: 'unlock'; to: number; pickable: boolean };

/** Door sound: `play_sound(-58)` in both door arms. */
const DOOR_SOUND = 58;

function doorSpecial(t: number): E3TerrainSpecial | null {
  // Three styles of wall (stone, basalt, adobe), each with the same run of
  // doors: 101–107, 118–124, 133–139.
  for (const base of [101, 118, 133]) {
    // `base`: a secret door drawn as plain wall; bumping it finds the door
    // (`base + 1`, "Wall (w. Secret Door)", which lets the party through).
    if (t === base) return { kind: 'step-change', to: base + 1, sound: DOOR_SOUND };
    // `base + 2`: a closed door; it opens into `base + 6`, "Open Door".
    if (t === base + 2) return { kind: 'step-change', to: base + 6, sound: DOOR_SOUND };
    // `base + 3`: locked, and a successful pick adds 3 (`base + 6`, open).
    if (t === base + 3) return { kind: 'unlock', to: base + 6, pickable: true };
    // `base + 4`, `base + 5`: locked past picking.
    if (t === base + 4 || t === base + 5) return { kind: 'unlock', to: base + 6, pickable: false };
  }
  return null;
}

/** `FUN_1010_7169`'s boat test: 22, 24–35, 50–64, 71, 74, 75, 86. */
function boatPassable(t: number): boolean {
  return t === 0x16 || (t >= 0x18 && t <= 0x23) || (t >= 0x32 && t <= 0x40)
    || t === 0x47 || t === 0x4a || t === 0x4b || t === 0x56;
}

export function readE3Terrain(exe: Uint8Array, strings: Map<number, string>): E3TerrainType[] {
  // `terrain_pic[256]`: segment 33 (`1100:00a0`), little-endian int16s.
  const seg33 = readNeSegment(exe, 33);
  const pics = new DataView(seg33.buffer, seg33.byteOffset + 0xa0, E3_TERRAIN_COUNT * 2);
  // `terrain_blocked[256]` at `DS:1c7e`, read by `FUN_1080_14f9` (blocked if >= 3).
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const blocked = ds.subarray(0x1c7e, 0x1c7e + E3_TERRAIN_COUNT);
  return Array.from({ length: E3_TERRAIN_COUNT }, (_, t) => ({
    name: strings.get(301 + t) ?? `Terrain ${t}`,
    pic: pics.getInt16(t * 2, true),
    blockage: blocked[t] ?? 0,
    boat: boatPassable(t),
    special: doorSpecial(t),
  }));
}

export interface E3Start {
  town: number;
  loc: { x: number; y: number };
}

/**
 * A new game (`FUN_1010_6b20`) calls `start_town_mode(21, 9)`, and entry
 * direction 9 puts the party at the location held in `DS:05f0`.
 */
export function readE3Start(exe: Uint8Array): E3Start {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  return { town: 21, loc: { x: ds[0x5f0] ?? 0, y: ds[0x5f1] ?? 0 } };
}

export const E3_MONSTER_COUNT = 190;

/**
 * E3's monsters 1–190 as BoE legacy records, ready for the legacy importer's
 * `convertMonster`. Index 0 is the empty monster. The stats are E3's own:
 * segment 39's parallel arrays (`FUN_1090_0000`; FORMATS.md). `pictureNum`
 * is E3's sprite index, for `buildMonsterSheets` to replace.
 */
export function readE3Monsters(exe: Uint8Array, strings: Map<number, string>): LegacyMonster[] {
  const t = readNeSegment(exe, 39);
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u8 = (off: number, n: number) => t[off + n] ?? 0;
  const i16 = (off: number, n: number) => v.getInt16(off + 2 * n, true);
  const resist = (n: number) => [4800, 5000, 5200, 5400]
    .reduce((bits, off, k) => bits | (u8(off, n) === 1 ? 1 << (2 * k) : u8(off, n) >= 2 ? 2 << (2 * k) : 0), 0);
  const out: LegacyMonster[] = [];
  for (let n = 0; n <= E3_MONSTER_COUNT; n++) {
    // Fields E3's table lacks: borrowed from BoE's bladbase for 1–176, the
    // monsters the two games share; E3's unique 177–190 get BoE's defaults.
    // TODO(E3-3): find where E3 keeps them (its code).
    const x = BLADBASE_EXTRAS[n - 1] ?? [0, 0, 0, 1, 0, 0, 0, 0];
    out.push({
      level: u8(0, n), mName: n === 0 ? '' : strings.get(600 + n) ?? `Monster ${n}`,
      mHealth: i16(200, n), armor: u8(600, n), skill: u8(800, n),
      a: [i16(1000, n), i16(1400, n), i16(1800, n)],
      a1Type: u8(2200, n), a23Type: u8(2400, n), mType: u8(2600, n), speed: u8(2800, n),
      mu: u8(3000, n), cl: u8(3200, n), breath: u8(3400, n), breathType: x[0] ?? 0,
      treasure: u8(3800, n), specSkill: u8(4000, n), poison: u8(3600, n),
      corpseItem: x[6] ?? 0, corpseItemChance: x[7] ?? 0, immunities: resist(n),
      xWidth: u8(4400, n) || 1, yWidth: u8(4600, n) || 1,
      radiate1: x[1] ?? 0, radiate2: x[2] ?? 0, defaultAttitude: x[3] ?? 0, summonType: x[4] ?? 0,
      defaultFacialPic: x[5] ?? 0, pictureNum: u8(4200, n),
    });
  }
  return out;
}
