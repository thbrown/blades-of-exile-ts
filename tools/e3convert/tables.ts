/**
 * Game data Exile 3 keeps in EXILE3.EXE rather than in a data file: the
 * terrain types and where a new game starts. Each value is read from the
 * table the game itself consults, found by following the code (FORMATS.md,
 * "Tables in the EXE").
 */

import type { LegacyItem, LegacyMonster } from '../../src/fileio/legacy/structs';
import { BLADBASE_ITEMS } from './bladbaseExtras';
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
  /**
   * The kind of outdoor combat arena fought on it (`DS:3850`, int16s, read by
   * `FUN_10d8_342b`): 0–13, an index into `src/game/e3Arena.ts`'s tables.
   */
  arena: number;
}

/**
 * E3's doors, as BoE terrain specials. E3 has no special field: the move code
 * switches on the terrain id (`FUN_10c0_0c97`, a jump table at `10c0:186a`)
 * and the lock-pick code on another (`FUN_10d8_3f67`, `10d8:4182`).
 */
export type E3TerrainSpecial =
  /**
   * A conveyor belt carrying the party toward `dir` (eDirection: 0 N, 2 E,
   * 4 S, 6 W). E3's move code (near `exile3.c:59327`) refuses a step against
   * 247–250, and its per-turn code carries the party along them, as BoE
   * 1997's legacy terrain specials 16–19 do.
   */
  | { kind: 'belt'; dir: number }
  /** Bumping it turns it into `to` and plays sound `sound`. */
  | { kind: 'step-change'; to: number; sound: number }
  /** Using it turns it into `to` and plays sound `sound`. */
  | { kind: 'use-change'; to: number; sound: number }
  /**
   * Locked: picking (or bashing) it turns it into `to`. `pickable` false is a
   * door E3's lock-pick code refuses outright.
   */
  | { kind: 'unlock'; to: number; pickable: boolean }
  /** Readable: a sign location on it has text (`sign_locs`). */
  | { kind: 'sign' };

/**
 * The terrains a sign can stand on: the three "w. Sign" walls, the two free
 * signs, the obelisk and the basalt runes. These are exactly the terrains
 * under E3's 630 sign locations, towns and zones together. The code that
 * reads them has not been found, so this list comes from the data.
 */
const SIGN_TERRAINS = new Set([110, 127, 142, 213, 214, 252]);

/** Door sound: `play_sound(-58)` in both door arms. */
const DOOR_SOUND = 58;
/**
 * Closing sound: E3's code never closes a door (see `base + 6` below), but it
 * ships a sound 59 byte-for-byte BoE's door closing, which is what BoE's own
 * open doors play on Use.
 */
const DOOR_CLOSE_SOUND = 59;

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
    // `base + 6`, open: Use closes it again (`base + 2`), as BoE's open door
    // does. **Not found in E3's code**: its Use (`FUN_10c0_425c`) has no door
    // arm, but the user remembers closing doors in Exile III, so it is here
    // on their word (2026-09-28), with BoE's closing sound, which E3 ships.
    if (t === base + 6) return { kind: 'use-change', to: base + 2, sound: DOOR_CLOSE_SOUND };
  }
  return null;
}

/** `FUN_1010_7169`'s boat test: 22, 24–35, 50–64, 71, 74, 75, 86. */
function boatPassable(t: number): boolean {
  return t === 0x16 || (t >= 0x18 && t <= 0x23) || (t >= 0x32 && t <= 0x40)
    || t === 0x47 || t === 0x4a || t === 0x4b || t === 0x56;
}

/**
 * What a road reaches into: E3's `place_road` (`1050:5460`, BoE 1997's with
 * the same rectangles) draws an arm toward a neighbour whose terrain is on
 * this list, the 44 bytes at `DS:1608` that `1050:5417` searches. Bridges,
 * doors, portcullises, towns, roads, walkways and special encounters. BoE
 * tests pictures instead (`extend_road_terrain`), OBoE trims.
 */
export function readE3RoadJoins(exe: Uint8Array): number[] {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  return [...new Set(ds.subarray(0x1608, 0x1608 + 0x2c))];
}

/**
 * `DS:29b2`: `can_find_town` for a new party, which `FUN_10b0_053c` copies
 * to party+0x8485. The towns whose byte is 0 start off the map: E3 hides 15
 * (22, 26, 32, 54, 70, 71, 74–79, 86, 87, 92) until a script, a map or a
 * paid answer shows them. Only towns below 120 have a byte.
 */
export function readE3HiddenTowns(exe: Uint8Array): number[] {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const t = ds.subarray(0x29b2, 0x29b2 + 120);
  return [...t.keys()].filter((i) => t[i] === 0);
}

/**
 * What a hidden town's entrance shows as. The outdoor loader (`10d8:4532`)
 * swaps each entrance whose town isn't found for this 12-byte table
 * (`DS:3c0a`, copied to the stack), indexed by terrain − 217, and back once it
 * is. BoE keeps the same thing in a town terrain's `flag1`.
 */
export function readE3HiddenEntrances(exe: Uint8Array): Map<number, number> {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  return new Map([...ds.subarray(0x3c0a, 0x3c0a + 12)].map((t, i) => [217 + i, t]));
}

/** `DS:3850`: each terrain's arena kind, the first of `FUN_10d8_342b`'s tables. */
export const E3_ARENA_KINDS = 0x3850;

export function readE3Terrain(exe: Uint8Array, strings: Map<number, string>): E3TerrainType[] {
  // `terrain_pic[256]`: segment 33 (`1100:00a0`), little-endian int16s.
  const seg33 = readNeSegment(exe, 33);
  const pics = new DataView(seg33.buffer, seg33.byteOffset + 0xa0, E3_TERRAIN_COUNT * 2);
  // `terrain_blocked[256]` at `DS:1c7e`, read by `FUN_1080_14f9` (blocked if >= 3).
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const blocked = ds.subarray(0x1c7e, 0x1c7e + E3_TERRAIN_COUNT);
  const arenas = new DataView(ds.buffer, ds.byteOffset + E3_ARENA_KINDS, E3_TERRAIN_COUNT * 2);
  return Array.from({ length: E3_TERRAIN_COUNT }, (_, t) => ({
    name: strings.get(301 + t) ?? `Terrain ${t}`,
    pic: pics.getInt16(t * 2, true),
    blockage: blocked[t] ?? 0,
    boat: boatPassable(t),
    arena: arenas.getInt16(t * 2, true),
    special: SIGN_TERRAINS.has(t) ? { kind: 'sign' }
      : t >= 247 && t <= 250 ? { kind: 'belt', dir: (t - 247) * 2 } : doorSpecial(t),
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

/**
 * A boat or horse in E3's starting tables: BoE 1997's `boat_record_type`,
 * 10 bytes, little-endian in memory. Record `k` is E3's vehicle `k`; record 0
 * is never used, since `in_boat`/`in_horse` 0 means "none".
 */
export interface E3Vehicle {
  loc: { x: number; y: number };
  town: number;
  exists: boolean;
  /** Someone else's (for sale); false once it is the party's. */
  property: boolean;
}

/**
 * E3's boats and horses as a new game has them: 30 of each, in DGROUP at
 * 0x2be0 and 0x2d0c, which `FUN_10b0_0b7c` copies into the party record
 * (party+0x693a and +0x6a68, with `in_boat` and `in_horse` after each).
 * Outdoor ones (town 200) would need their sector, which the tables leave 0;
 * the only one is boat 0, which is never used.
 */
export function readE3Vehicles(exe: Uint8Array): { boats: E3Vehicle[]; horses: E3Vehicle[] } {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const read = (base: number): E3Vehicle[] => Array.from({ length: 30 }, (_, k) => {
    const r = base + 10 * k;
    return {
      loc: { x: ds[r] ?? 0, y: ds[r + 1] ?? 0 },
      town: (ds[r + 6] ?? 0) | ((ds[r + 7] ?? 0) << 8),
      exists: ds[r + 8] === 1,
      property: ds[r + 9] === 1,
    };
  });
  return { boats: read(0x2be0), horses: read(0x2d0c) };
}

/**
 * The engine's number for each of E3's vehicles, or -1 for one not placed.
 *
 * A map names a vehicle by number, and the loader (OBoE's `loadTownMapData`,
 * ported as is) resizes the list to that number: **it shrinks as well as
 * grows**, so a town that places vehicle 2 after one that placed vehicle 8
 * wipes out 3–8. The engine also copies only the vehicles that exist into
 * the party, closing any gaps. So the numbers must rise in the order the
 * loader meets them, with none missing: by town, then x, then y.
 */
export function vehicleNumbers(list: E3Vehicle[]): number[] {
  const placed = list.map((v, k) => ({ v, k })).filter(({ v, k }) => k > 0 && v.exists && v.town < 200)
    .sort((a, b) => a.v.town - b.v.town || a.v.loc.x - b.v.loc.x || a.v.loc.y - b.v.loc.y || a.k - b.k);
  const out = list.map(() => -1);
  placed.forEach(({ k }, i) => { out[k] = i; });
  return out;
}

export const E3_MONSTER_COUNT = 190;

/**
 * E3's monsters 1–190 as BoE legacy records, ready for the legacy importer's
 * `convertMonster`. Index 0 is the empty monster. The stats are E3's own:
 * segment 39's parallel arrays (`FUN_1090_0000`; FORMATS.md). `pictureNum`
 * is E3's sprite index, for `buildMonsterSheets` to replace.
 *
 * BoE's record has fields E3's lacks, and E3's code answers each:
 * - **radiation, loot**: none. E3's monster record has no such fields and no
 *   code gives a monster either (bladbase, Jeff's export of these monsters,
 *   has none for any of them too).
 * - **attitude**: E3's `place_monster` (`1090:3d56`) makes everything it
 *   places hostile A, except the troglodytes (149–154), hostile B. BoE
 *   reads the template's `default_attitude` there, so that is what it is.
 * - **summon class**: none. E3's summoning spells draw from lists of their
 *   own (`summons` = `exile3`, `src/game/e3Summons.ts`).
 * - **face**: `readE3Faces`.
 */
export function readE3Monsters(exe: Uint8Array, strings: Map<number, string>): LegacyMonster[] {
  const t = readNeSegment(exe, 39);
  const breathDice = readE3BreathDice(exe);
  const faces = readE3Faces(exe);
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u8 = (off: number, n: number) => t[off + n] ?? 0;
  const i16 = (off: number, n: number) => v.getInt16(off + 2 * n, true);
  const resist = (n: number) => [4800, 5000, 5200, 5400]
    .reduce((bits, off, k) => bits | (u8(off, n) === 1 ? 1 << (2 * k) : u8(off, n) >= 2 ? 2 << (2 * k) : 0), 0);
  const out: LegacyMonster[] = [];
  for (let n = 0; n <= E3_MONSTER_COUNT; n++) {
    out.push({
      level: u8(0, n), mName: n === 0 ? '' : strings.get(600 + n) ?? `Monster ${n}`,
      mHealth: i16(200, n), armor: u8(600, n), skill: u8(800, n),
      a: [i16(1000, n), i16(1400, n), i16(1800, n)],
      a1Type: u8(2200, n), a23Type: u8(2400, n), mType: u8(2600, n), speed: u8(2800, n),
      mu: u8(3000, n), cl: u8(3200, n),
      breath: u8(3400, n) === 0 ? 0 : (breathDice[u8(3400, n) % 10] ?? 0) + 2,
      breathType: Math.trunc(u8(3400, n) / 10),
      treasure: u8(3800, n), specSkill: u8(4000, n), poison: u8(3600, n),
      corpseItem: -1, corpseItemChance: -1, immunities: resist(n),
      xWidth: u8(4400, n) || 1, yWidth: u8(4600, n) || 1,
      radiate1: 0, radiate2: 0, defaultAttitude: n >= 149 && n <= 154 ? 3 : 1, summonType: 0,
      defaultFacialPic: faces[n] ?? 0, pictureNum: u8(4200, n),
    });
  }
  return out;
}

/**
 * E3's talking face for each monster, 1-based into TALKPORT.BMP and 0 for
 * none: the words of segment 40 (`1138:0000`), which the talk screen
 * (`1098:984e`) reads by the creature's monster number. With none it draws
 * the monster's sprite, as 1997's `place_talk_str` does. bladbase's faces
 * agree for only 122 of the 176 monsters the two share.
 */
export function readE3Faces(exe: Uint8Array): number[] {
  const t = readNeSegment(exe, 40);
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  return Array.from({ length: E3_MONSTER_COUNT + 1 }, (_, n) => v.getInt16(2 * n, true));
}

/**
 * The faces the talk screen gives particular people over their monster's:
 * 50 (personality, face) pairs at `DS:2364`, 28 used, that `1098:984e`
 * copies and looks the personality up in (E3's own number, 1-based).
 */
export function readE3PersonalityFaces(exe: Uint8Array): Map<number, number> {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const v = new DataView(ds.buffer, ds.byteOffset, ds.byteLength);
  const out = new Map<number, number>();
  for (let i = 0; i < 50; i++) {
    const p = v.getInt16(0x2364 + 4 * i, true);
    if (p > 0) out.set(p, v.getInt16(0x2366 + 4 * i, true));
  }
  return out;
}

/**
 * E3's breath byte holds two numbers (`monst_breathe`, `1018:78ca`): the tens
 * are the kind — 0 fire, 1 cold, 2 magic ("acid" in the monster dialog,
 * `1008:18e7`), the same damage types and missiles as 1997's `type[]` and
 * `missile_t[]` — and the units index this table at `DS:0878`, whose entry
 * plus 2 is the number of d8 rolled. So Exile's dragon, 14, breathes cold for
 * 6d8, not 14d8. BoE's bladbase kept the byte and moved the kind to a field
 * of its own, which is why it reads as a much stronger breath there.
 */
export function readE3BreathDice(exe: Uint8Array): number[] {
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const v = new DataView(ds.buffer, ds.byteOffset, ds.byteLength);
  return Array.from({ length: 10 }, (_, i) => v.getInt16(0x878 + 2 * i, true));
}

/** E3 breathes at 7 squares or closer (`1018:51f0`); 1997 and OBoE at 8. */
export const E3_BREATH_RANGE = 7;

export const E3_ITEM_COUNT = 415;

/**
 * E3's item ability codes → BoE legacy ones, for items with no BoE namesake.
 * Derived by matching E3's items to bladbase's by name and taking, for each
 * E3 code, the BoE code most of its items carry (94 of 103 codes agree
 * throughout; the rest are items BoE retuned). E3 codes seen only on E3-only
 * items (60, 78, 82, 98, 102, 103, 111, 132–135, 168) are absent. 70, 97 and
 * 101 are the Accuracy Rings, Giant Gauntlets and Skill Rings, given BoE's
 * ACCURACY, GIANT_STRENGTH and SKILL for their descriptions only: the engine
 * plays them by E3's own sums (`src/game/e3Items.ts`).
 */
export const E3_ABILITY_TO_LEGACY: Readonly<Record<number, number>> = {
  0: 0, 2: 35, 3: 87, 4: 72, 5: 110, 6: 111, 8: 70, 9: 48, 10: 131, 11: 161, 12: 90, 13: 160,
  14: 0, 16: 32, 17: 158, 18: 71, 19: 124, 20: 88, 21: 91, 22: 112, 23: 113, 24: 87, 25: 49,
  26: 73, 27: 74, 28: 72, 29: 89, 30: 84, 31: 86, 32: 14, 33: 1, 34: 2, 35: 3, 36: 75, 37: 116,
  38: 114, 39: 115, 40: 85, 41: 132, 42: 55, 43: 128, 44: 118, 45: 117, 46: 50, 47: 46, 48: 57,
  49: 51, 50: 2, 51: 5, 52: 150, 53: 151, 54: 152, 55: 153, 56: 157, 57: 155, 58: 156, 59: 77,
  61: 42, 63: 85, 65: 170, 66: 33, 67: 94, 68: 159, 71: 119, 72: 119, 73: 119, 74: 55, 75: 53,
  76: 119, 77: 34, 79: 79, 80: 134, 81: 135, 83: 87, 84: 119, 85: 127, 86: 122, 87: 78, 88: 77,
  89: 120, 90: 84, 91: 119, 92: 172, 93: 11, 94: 55, 95: 56, 96: 43, 99: 40, 100: 80, 110: 52,
  115: 71, 117: 44, 118: 54, 120: 54, 121: 83, 122: 36, 123: 123, 124: 121, 125: 126, 127: 31,
  129: 45, 130: 82, 131: 4, 70: 41, 97: 43, 101: 37,
};

const WEAPON_VARIETIES = new Set([1, 2, 4, 5, 6, 23, 24, 25]);

/** E3's ability codes that curse an item (see `readE3Items`). */
const E3_CURSED = new Set([14, 95, 129]);

/**
 * E3's items as BoE legacy records, for `convertItem`. The numbers are E3's
 * own (segment 38, 59 bytes a record; FORMATS.md). E3 has no ability strength
 * and codes abilities its own way: an item with a namesake in BoE's bladbase
 * (367 of 408) takes its ability, strength, use type, treasure class and
 * curse from there; the rest map E3's code through `E3_ABILITY_TO_LEGACY`
 * with the level as strength. Where E3's code reads the ability differently,
 * the engine asks the item's E3 code instead (`src/game/e3Items.ts`,
 * DIVERGENCES.md #23), and so is Using one (`src/game/e3ItemUse.ts`, E3's
 * `10c0:2c92`). TODO(E3-3): the Lodestone and Airy Stone changing as they are taken
 * (`give_to_pc`, `1070:01d1`: the Lodestone is worn and cursed at once, and
 * both have a byte at +0x13 of the in-memory item rewritten, not yet pinned).
 * `graphicNum` is E3's picture, for `buildItemSheet` to replace.
 */
/** Each E3 item's own ability byte (+10), which `readE3Items` maps to BoE's. */
export function readE3ItemAbilities(exe: Uint8Array): number[] {
  const t = readNeSegment(exe, 38);
  return Array.from({ length: E3_ITEM_COUNT }, (_, i) => t[i * 59 + 10] ?? 0);
}

export function readE3Items(exe: Uint8Array): LegacyItem[] {
  const t = readNeSegment(exe, 38);
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const text = (from: number, len: number) => {
    const b = t.subarray(from, from + len);
    const end = b.indexOf(0);
    return new TextDecoder('windows-1252').decode(end < 0 ? b : b.subarray(0, end));
  };
  const out: LegacyItem[] = [];
  for (let i = 0; i < E3_ITEM_COUNT; i++) {
    const o = i * 59;
    const u8 = (k: number) => t[o + k] ?? 0;
    const variety = v.getInt16(o, true);
    const level = v.getInt16(o + 2, true);
    const fullName = text(o + 19, 25);
    const blad = BLADBASE_ITEMS.get(fullName);
    const weapon = WEAPON_VARIETIES.has(variety);
    const e3Props = (u8(15) ? 1 : 0) | (u8(16) ? 4 : 0);
    out.push({
      variety, itemLevel: level, awkward: u8(4), bonus: u8(5),
      protection: u8(6) > 127 ? u8(6) - 256 : u8(6), charges: u8(7),
      type: weapon ? u8(8) : blad?.[4] ?? 0,
      magicUseType: weapon ? blad?.[2] ?? 0 : u8(8),
      graphicNum: u8(9),
      ability: blad ? blad[0] ?? 0 : E3_ABILITY_TO_LEGACY[u8(10)] ?? 0,
      abilityStrength: blad ? blad[1] ?? 0 : level,
      typeFlag: u8(11), isSpecial: 0, value: v.getInt16(o + 13, true), weight: u8(17),
      specialClass: 0, itemLoc: { x: 0, y: 0 }, fullName, name: text(o + 44, 15),
      treasClass: blad?.[3] ?? 0,
      // Identified and magic are E3's, and so is the curse: E3 has no curse
      // bit, and an item is cursed when its ability is 14 or 95 (the Dancing
      // Boots; `1070:1320` refuses to take either off). Five of its 14s have
      // no curse in bladbase. The Lodestone (129) is cursed here because E3
      // makes it a 14 as it is taken (`give_to_pc`, `1070:01d1`).
      itemProperties: e3Props | (E3_CURSED.has(u8(10)) ? 16 : 0),
    });
  }
  return out;
}
