/**
 * Exile III's saved game (`exile3.sav`, the Windows build), byte for byte.
 *
 * The writer is `FUN_1040_0db6` and the reader `FUN_1040_018e` in EXILE3.EXE,
 * and they are BoE 1997's `save_file`/`load_file` (FILEIO.CPP:440/138) with
 * E3's sizes. Everything is little-endian, the Windows build's own memory
 * written out, in this order:
 *
 * | bytes | what | where in memory |
 * |---|---|---|
 * | 2 × 3 | header words, below | |
 * | 0x8525 | the party record, each byte XOR 0x5c | `1158:0000` |
 * | 0x4000 | `setup[4][64][64]`, the four remembered towns' fields | `1160:a61c` |
 * | 0x722 × 6 | the PCs, each byte XOR 0x6b | `1158:8526` |
 * | 0x2400 | `out_e[96][96]`, the outdoor window's explored squares | `1160:821b` |
 * | 0x2abe, 0x1710, 0x1c4d | in town only: `c_town`, `t_d`, `t_i` | `1160:0000`, `:2abe`, `:41ce` |
 * | 0x1c4d × 3 | the stored items of the three storage rects | `1168:84de` |
 * | 0x9100, 0x6540 | with maps only: towns 0–119's maps, the 90 zones' | `1170:0000`, `:9100` |
 * | 0x1000, 0x1000 | `sfx[64][64]`, `misc_i[64][64]` | `DS:5cb1`, `1160:e61c` |
 * | 0x5a00 | with maps only: villages 120–199's maps | `1168:2000` |
 *
 * **A save can run on past its end.** `save_file` opens an existing file
 * with `_lopen` and only `_lcreat`s a missing one, so nothing truncates: an
 * outdoor save written over an in-town one keeps the old file's last
 * 24,091 bytes (the three town blocks' size). Every save from the original
 * looked at so far is 210,745 bytes, the in-town size with maps. The reader
 * keeps such a tail as `trailing`, so a file writes back the same.
 *
 * The header words are BoE's flags with one changed (`DS:12fc` holds the
 * pairs the reader accepts): **5790 outdoors / 1342 in town**; **5434**
 * (BoE's "in a scenario" was 100/200; E3 writes 5434 always, and also reads
 * 98, for which it runs `FUN_1030_0404` three times); **3422 no maps / 5567
 * maps**. Whether maps are saved is E3's preference (`DS:3d16`).
 *
 * This file only splits and joins those blocks and names the fields of the
 * party, the PCs and their items. What they mean in this port is
 * `e3SaveImport.ts` and `e3SaveExport.ts`, and `tools/e3convert/FORMATS.md`
 * says how each offset was pinned.
 */

export const E3_SAVE_TOWN = 1342;
export const E3_SAVE_OUTDOORS = 5790;
export const E3_SAVE_VERSION = 5434;
/** The other second word `load_file` accepts, an older save's. */
export const E3_SAVE_VERSION_OLD = 98;
export const E3_SAVE_MAPS = 5567;
export const E3_SAVE_NO_MAPS = 3422;

export const E3_PARTY_SIZE = 0x8525;
export const E3_PC_SIZE = 0x722;
export const E3_SETUP_SIZE = 0x4000;
export const E3_OUT_EXPLORED_SIZE = 0x2400;
export const E3_CTOWN_SIZE = 0x2abe;
export const E3_TOWN_DATA_SIZE = 0x1710;
/** 115 items of 63 bytes: `t_i`, and each of the three stored-item lists. */
export const E3_ITEM_LIST_SIZE = 0x1c4d;
export const E3_TOWN_MAPS_SIZE = 0x9100;
export const E3_OUT_MAPS_SIZE = 0x6540;
export const E3_VILLAGE_MAPS_SIZE = 0x5a00;
export const E3_SFX_SIZE = 0x1000;
export const E3_MISC_I_SIZE = 0x1000;

const PARTY_XOR = 0x5c;
const PC_XOR = 0x6b;

export interface E3Save {
  inTown: boolean;
  /** The second header word: `E3_SAVE_VERSION`, or `E3_SAVE_VERSION_OLD`. */
  version: number;
  /** The party record, decrypted. */
  party: Uint8Array;
  setup: Uint8Array;
  /** The six PC records, decrypted. */
  pcs: Uint8Array[];
  outExplored: Uint8Array;
  /** In town only. */
  town: { cTown: Uint8Array; data: Uint8Array; items: Uint8Array } | null;
  storedItems: Uint8Array[];
  /** With maps only. */
  maps: { towns: Uint8Array; zones: Uint8Array; villages: Uint8Array } | null;
  sfx: Uint8Array;
  miscI: Uint8Array;
  /** Whatever followed the save in the file: an older, longer save's tail. */
  trailing: Uint8Array;
}

/** A save with every block present and zeroed, outdoors and without maps. */
export function emptyE3Save(): E3Save {
  return {
    inTown: false,
    version: E3_SAVE_VERSION,
    party: new Uint8Array(E3_PARTY_SIZE),
    setup: new Uint8Array(E3_SETUP_SIZE),
    pcs: Array.from({ length: 6 }, () => new Uint8Array(E3_PC_SIZE)),
    outExplored: new Uint8Array(E3_OUT_EXPLORED_SIZE),
    town: null,
    storedItems: Array.from({ length: 3 }, () => new Uint8Array(E3_ITEM_LIST_SIZE)),
    maps: null,
    sfx: new Uint8Array(E3_SFX_SIZE),
    miscI: new Uint8Array(E3_MISC_I_SIZE),
    trailing: new Uint8Array(0),
  };
}

function word(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(at, true);
}

/** Whether `data` starts like an Exile III save: the three words `load_file` checks. */
export function isE3Save(data: Uint8Array): boolean {
  if (data.length < 6) return false;
  const [a, b, c] = [word(data, 0), word(data, 2), word(data, 4)];
  return (a === E3_SAVE_OUTDOORS || a === E3_SAVE_TOWN)
    && (b === E3_SAVE_VERSION || b === E3_SAVE_VERSION_OLD)
    && (c === E3_SAVE_NO_MAPS || c === E3_SAVE_MAPS);
}

export function readE3Save(data: Uint8Array): E3Save {
  if (!isE3Save(data)) throw new Error('not an Exile III save: its first three words are wrong');
  const inTown = word(data, 0) === E3_SAVE_TOWN;
  const withMaps = word(data, 4) === E3_SAVE_MAPS;
  let at = 6;
  const take = (n: number, xor = 0): Uint8Array => {
    if (at + n > data.length) throw new Error(`Exile III save is cut short: wanted ${n} bytes at ${at}, the file is ${data.length}`);
    const out = data.slice(at, at + n);
    if (xor) for (let i = 0; i < n; i++) out[i]! ^= xor;
    at += n;
    return out;
  };
  const save: E3Save = {
    inTown,
    version: word(data, 2),
    party: take(E3_PARTY_SIZE, PARTY_XOR),
    setup: take(E3_SETUP_SIZE),
    pcs: Array.from({ length: 6 }, () => take(E3_PC_SIZE, PC_XOR)),
    outExplored: take(E3_OUT_EXPLORED_SIZE),
    town: null,
    storedItems: [],
    maps: null,
    sfx: new Uint8Array(0),
    miscI: new Uint8Array(0),
    trailing: new Uint8Array(0),
  };
  if (inTown) save.town = { cTown: take(E3_CTOWN_SIZE), data: take(E3_TOWN_DATA_SIZE), items: take(E3_ITEM_LIST_SIZE) };
  save.storedItems = Array.from({ length: 3 }, () => take(E3_ITEM_LIST_SIZE));
  const towns = withMaps ? take(E3_TOWN_MAPS_SIZE) : null;
  const zones = withMaps ? take(E3_OUT_MAPS_SIZE) : null;
  save.sfx = take(E3_SFX_SIZE);
  save.miscI = take(E3_MISC_I_SIZE);
  if (towns && zones) save.maps = { towns, zones, villages: take(E3_VILLAGE_MAPS_SIZE) };
  save.trailing = data.slice(at);
  return save;
}

export function e3SaveSize(save: Pick<E3Save, 'inTown' | 'maps'> & { trailing?: Uint8Array }): number {
  return 6 + E3_PARTY_SIZE + E3_SETUP_SIZE + 6 * E3_PC_SIZE + E3_OUT_EXPLORED_SIZE
    + (save.inTown ? E3_CTOWN_SIZE + E3_TOWN_DATA_SIZE + E3_ITEM_LIST_SIZE : 0)
    + 3 * E3_ITEM_LIST_SIZE
    + (save.maps ? E3_TOWN_MAPS_SIZE + E3_OUT_MAPS_SIZE + E3_VILLAGE_MAPS_SIZE : 0)
    + E3_SFX_SIZE + E3_MISC_I_SIZE + (save.trailing?.length ?? 0);
}

export function writeE3Save(save: E3Save): Uint8Array {
  if (save.inTown && !save.town) throw new Error('an in-town Exile III save needs its town blocks');
  const out = new Uint8Array(e3SaveSize(save));
  const view = new DataView(out.buffer);
  view.setInt16(0, save.inTown ? E3_SAVE_TOWN : E3_SAVE_OUTDOORS, true);
  view.setInt16(2, save.version, true);
  view.setInt16(4, save.maps ? E3_SAVE_MAPS : E3_SAVE_NO_MAPS, true);
  let at = 6;
  const put = (block: Uint8Array, n: number, xor = 0): void => {
    if (block.length !== n) throw new Error(`Exile III save block is ${block.length} bytes, not ${n}`);
    for (let i = 0; i < n; i++) out[at + i] = block[i]! ^ xor;
    at += n;
  };
  put(save.party, E3_PARTY_SIZE, PARTY_XOR);
  put(save.setup, E3_SETUP_SIZE);
  if (save.pcs.length !== 6) throw new Error('an Exile III save has six PCs');
  for (const pc of save.pcs) put(pc, E3_PC_SIZE, PC_XOR);
  put(save.outExplored, E3_OUT_EXPLORED_SIZE);
  if (save.inTown && save.town) {
    put(save.town.cTown, E3_CTOWN_SIZE);
    put(save.town.data, E3_TOWN_DATA_SIZE);
    put(save.town.items, E3_ITEM_LIST_SIZE);
  }
  for (const list of save.storedItems) put(list, E3_ITEM_LIST_SIZE);
  if (save.maps) {
    put(save.maps.towns, E3_TOWN_MAPS_SIZE);
    put(save.maps.zones, E3_OUT_MAPS_SIZE);
  }
  put(save.sfx, E3_SFX_SIZE);
  put(save.miscI, E3_MISC_I_SIZE);
  if (save.maps) put(save.maps.villages, E3_VILLAGE_MAPS_SIZE);
  out.set(save.trailing, at);
  return out;
}

// --- the maps -----------------------------------------------------------------

/**
 * Where town `t`'s explored bits are: which map block, the byte offset into
 * it, and the town's side. BoE 1997's `town_maps[t][x / 8][y]`, bit `x % 8`
 * (town.c's `make_town_explored`), split by size as E3 sizes its towns:
 * records 0–39 are 64 square, 40–79 48, 80–119 32, and the villages 120–199
 * 48, in the last block.
 */
export function e3TownMapAt(t: number): { block: 'towns' | 'villages'; at: number; dim: number } | null {
  if (t < 0 || t >= 200) return null;
  if (t < 40) return { block: 'towns', at: t * 8 * 64, dim: 64 };
  if (t < 80) return { block: 'towns', at: 40 * 8 * 64 + (t - 40) * 6 * 48, dim: 48 };
  if (t < 120) return { block: 'towns', at: 40 * 8 * 64 + 40 * 6 * 48 + (t - 80) * 4 * 32, dim: 32 };
  return { block: 'villages', at: (t - 120) * 6 * 48, dim: 48 };
}

/** The bit for (x, y) in a `[dim / 8][dim]` map at `at`: byte and mask. */
export function e3MapBit(at: number, dim: number, x: number, y: number): [number, number] {
  return [at + (x >> 3) * dim + y, 1 << (x & 7)];
}

/** Zones are 9 across (`onm`, `y * 9 + x`), each `[6][48]`. */
export const E3_ZONES_ACROSS = 9;
export const E3_ZONE_MAP_SIZE = 6 * 48;

// --- the party record ---------------------------------------------------------

/**
 * Offsets into the party record (segment `1158:`), pinned from E3's
 * `init_party` (`FUN_10b0_053c`), which clears every field in order, and the
 * code that reads each one. The shape is BoE 1997's `party_record_type`
 * with E3's own sizes; where E3 has a field BoE lacks (the job boards), the
 * name is E3's.
 */
export const E3P = {
  /** long: ticks since the game began. */
  AGE: 0x0000,
  /** long. */
  GOLD: 0x0004,
  /** long. */
  FOOD: 0x0008,
  /** i16[60]: special items, 1 if held. */
  SPEC_ITEMS: 0x000c,
  /** u8[310][10]: E3's flags, `stuff_done`. Flag `(a, b)` is byte `a*10 + b`. */
  FLAGS: 0x0084,
  FLAG_ROWS: 310,
  /**
   * u8 x, u8 y, among the flags (304,1–2): where the rest of a split party
   * wait, the square the lone PC left (`FUN_10e0_0806`). (304,0) is set
   * while split, (304,3) is the PC who went.
   */
  SPLIT_LEFT_AT: 0x0c65,
  /** u8[200][8]: a bit per preset item taken, per town. */
  ITEM_TAKEN: 0x0ca0,
  /** i16. */
  LIGHT_LEVEL: 0x12e0,
  /** loc (x, y bytes): the top-left zone of the 2×2 in memory. */
  OUTDOOR_CORNER: 0x12e2,
  /** loc: which of the 2×2 the party is in. */
  IWC: 0x12e4,
  /** loc: the party's square in the 96×96 window. */
  P_LOC: 0x12e6,
  /** loc: the party's square in its zone. */
  LOC_IN_SEC: 0x12e8,
  /** boat_record_type[30], 10 bytes: loc, loc in sector, sector, i16 town (200 outdoors), exists, property. */
  BOATS: 0x12ea,
  /** creature_list_type[4], 0x1594 bytes: 60 creatures of 0x5c, then i16 which_town, i16 friendly. */
  CREATURE_SAVE: 0x1416,
  CREATURE_LIST_SIZE: 0x1594,
  /** i16: the boat the party is in, **0 for none** (boat 0 is never boarded). */
  IN_BOAT: 0x6a66,
  /** horse_record_type[30], as the boats. */
  HORSES: 0x6a68,
  /** i16: the horse, 0 for none. */
  IN_HORSE: 0x6b94,
  /** outdoor_creature_type[10], 0x1f bytes. */
  OUT_C: 0x6b96,
  /** item[5][10] of 63 bytes: the magic shops' stock. */
  MAGIC_STORE_ITEMS: 0x6ccc,
  /** i16[4]: the monsters in the soul crystal. */
  IMPRISONED_MONST: 0x791a,
  /** i16[200]: creatures killed, per town (`is_cleaned_out`). */
  M_KILLED: 0x7922,
  /** u8[256]: monsters the party has met. */
  M_SEEN: 0x7ab2,
  /** u8[120] then i16[120]: the journal, a string number and a day each. */
  JOURNAL_STR: 0x7bb2,
  JOURNAL_DAY: 0x7c2a,
  /** u8[120]: help messages already shown. */
  HELP_RECEIVED: 0x7d1a,
  /** i16[140][2]: encounter notes. */
  SPECIAL_NOTES: 0x7d92,
  /** talk_save[120], 7 bytes, -1 in the first word when empty. */
  TALK_SAVE: 0x7fc2,
  /** long ×4. */
  TOTAL_M_KILLED: 0x830a,
  TOTAL_DAM_DONE: 0x830e,
  TOTAL_XP_GAINED: 0x8312,
  TOTAL_DAM_TAKEN: 0x8316,
  /** i16. */
  DIRECTION: 0x831a,
  /** i16: which of `CREATURE_SAVE` the next town goes in. */
  AT_WHICH_SAVE_SLOT: 0x831c,
  /** u8[17]: alchemy recipes known. */
  ALCHEMY: 0x831e,
  /** The party's four jobs, 12 bytes each (`game/e3Jobs.ts`). */
  JOBS_HELD: 0x832f,
  /** Six boards of four jobs. */
  JOB_BOARDS: 0x835f,
  /** u8[6]: a board the party failed. */
  JOBS_FAILED: 0x847f,
  /** u8[120]: towns 0–119 the party can find (villages are always found). */
  CAN_FIND_TOWN: 0x8485,
  CAN_FIND_TOWNS: 120,
  /** i16[20]: the day each plot event happened, 30000 until it does. */
  KEY_TIMES: 0x84fd,
  KEY_TIME_NEVER: 30000,
} as const;

/** The PC record, 0x722 bytes: BoE 1997's `pc_record_type` with E3's 63-byte items. */
export const E3PC = {
  MAIN_STATUS: 0,
  NAME: 2,
  NAME_LEN: 20,
  /** i16[30]. */
  SKILLS: 22,
  MAX_HEALTH: 82,
  CUR_HEALTH: 84,
  MAX_SP: 86,
  CUR_SP: 88,
  EXPERIENCE: 90,
  SKILL_PTS: 92,
  LEVEL: 94,
  /** i16[15]. */
  STATUS: 96,
  /** 24 items of 63 bytes. */
  ITEMS: 126,
  /** u8[24]. */
  EQUIP: 1638,
  /** u8[62] each. */
  PRIEST_SPELLS: 1662,
  MAGE_SPELLS: 1724,
  WHICH_GRAPHIC: 1786,
  /** i16: the slot last poisoned (0 at first; E3 never clears it). */
  WEAP_POISONED: 1788,
  /** u8[15], never used. */
  ADVAN: 1790,
  /** u8[15]. */
  TRAITS: 1805,
  RACE: 1820,
  EXP_ADJ: 1822,
  DIRECTION: 1824,
} as const;

/**
 * An item in memory, 63 bytes, as `FUN_1068_0886` builds it from the 59-byte
 * table record (`tools/e3convert/tables.ts`): the table's +0–15 at +0–15, +16
 * and +18 zero, magic (table +16) at +17, weight (+17) at +19, class (+18) at
 * +20, a word at +21, and the names (+19, +44) at +23 and +48.
 */
export const E3ITEM = {
  SIZE: 63,
  VARIETY: 0,
  LEVEL: 2,
  AWKWARD: 4,
  BONUS: 5,
  PROTECTION: 6,
  CHARGES: 7,
  /** A weapon's skill (1 edged, 2 bashing, 3 pole), else its magic use type. */
  TYPE: 8,
  GRAPHIC: 9,
  ABILITY: 10,
  TYPE_FLAG: 11,
  IS_SPECIAL: 12,
  VALUE: 13,
  IDENTIFIED: 15,
  /** In a town's list: someone else's (a preset's `property`). Zero in a PC's pack. */
  PROPERTY: 16,
  MAGIC: 17,
  /** In a town's list: in a container (a preset's `contained`). */
  CONTAINED: 18,
  WEIGHT: 19,
  CLASS: 20,
  LOC: 21,
  FULL_NAME: 23,
  FULL_NAME_LEN: 25,
  NAME: 48,
  NAME_LEN: 15,
} as const;

/** Little-endian field access on one of a save's blocks. */
export class E3Bytes {
  private readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8(at: number): number { return this.view.getUint8(at); }
  i8(at: number): number { return this.view.getInt8(at); }
  i16(at: number): number { return this.view.getInt16(at, true); }
  i32(at: number): number { return this.view.getInt32(at, true); }
  setU8(at: number, v: number): void { this.view.setUint8(at, v & 0xff); }
  setI16(at: number, v: number): void { this.view.setInt16(at, v, true); }
  setI32(at: number, v: number): void { this.view.setInt32(at, v, true); }
  loc(at: number): { x: number; y: number } { return { x: this.i8(at), y: this.i8(at + 1) }; }
  setLoc(at: number, where: { x: number; y: number }): void { this.setU8(at, where.x); this.setU8(at + 1, where.y); }
  /** A NUL-terminated string in a fixed field (Windows-1252). */
  str(at: number, len: number): string {
    const b = this.data.subarray(at, at + len);
    const end = b.indexOf(0);
    return new TextDecoder('windows-1252').decode(end < 0 ? b : b.subarray(0, end));
  }
  /** Writes `s` truncated to leave room for its NUL, and zeroes the rest of the field. */
  setStr(at: number, len: number, s: string): void {
    this.data.fill(0, at, at + len);
    for (let i = 0; i < Math.min(s.length, len - 1); i++) {
      const c = s.charCodeAt(i);
      this.data[at + i] = c < 256 ? c : 0x3f;
    }
  }
  sub(at: number, len: number): Uint8Array { return this.data.subarray(at, at + len); }
}

/** `c_town`'s fields the importer needs. */
export const E3CTOWN = {
  /** i16: the town record the party is in. */
  TOWN_NUM: 0x0000,
  /** i16: the town's difficulty, its second string read as a number, 0–150 (`10d8:2089`). */
  DIFFICULTY: 0x0002,
  /** The town's 0x422-byte common record from TOWN.DAT, words swapped (`e3SaveTown.ts`). */
  TOWN: 0x0004,
  /**
   * u8[64][64], `[x][y]`: the town's explored squares, bit 0 (BoE's
   * `c_town.explored`, after the town number, difficulty and the 0x422-byte
   * town record). Only the squares inside the town mean anything.
   */
  EXPLORED: 0x0426,
  /** u8: the whole town has turned on the party. */
  HOSTILE: 0x1426,
  /** `creature_data_type[60]`, `E3CREATURE.SIZE` each. */
  CREATURES: 0x1427,
  /** i16: the town the creatures belong to; then `friendly` (i16) and `in_boat` (u8). */
  WHICH_TOWN: 0x29b7,
  /** loc: the party's square in town. */
  P_LOC: 0x29bc,
  /** The town's name, a string in a 256-byte field (what follows the NUL is left over). */
  NAME: 0x29be,
  NAME_LEN: 0x100,
} as const;

/**
 * A live creature (BoE 1997's `creature_data_type`, E3's sizes), as the
 * town loader builds one: pinned against four saves from the original made
 * in town (2026-10-01).
 */
export const E3CREATURE = {
  SIZE: 0x5c,
  /** i16: 0 absent or dead, 1 present, 2 alerted. */
  ACTIVE: 0,
  /** i16: 0 docile, 1 hostile A, 2 friendly, 3 hostile B. */
  ATTITUDE: 2,
  NUMBER: 4,
  LOC: 5,
  /** The monster's 68-byte record, `FUN_1090_0000` (`e3MonsterRecord`). */
  MONST: 7,
  MOBILE: 75,
  /** i16. */
  SUMMONED: 76,
  /** The 14-byte start record, as in `t_d`. */
  START: 78,
} as const;

/** Offsets in the 68-byte monster record. */
export const E3MONST = {
  SIZE: 0x44,
  HEALTH: 2,
  M_HEALTH: 4,
  MP: 6,
  MAX_MP: 8,
  /** i16: morale and the morale it starts with. */
  MORALE: 28,
  M_MORALE: 30,
  /** i16[15]. */
  STATUS: 34,
  DIRECTION: 64,
} as const;

/**
 * `t_d`, the town's block from TOWN.DAT in the large town's layout whatever
 * the town's size (`FUN_1040_1e1c`): a smaller town fills the start of each
 * part and leaves the rest as the last town had it.
 */
export const E3TD = {
  /** u8[64][64], `[x][y]`. */
  TERRAIN: 0,
  /** 12 rects, Windows order (left, top, right, bottom). */
  ROOM_RECTS: 0x1000,
  /** 12 names of 30 bytes. */
  ROOM_NAMES: 0x1060,
  /** 60 creature starts of 14 bytes (`E3CreatureStart`, words swapped). */
  CREATURES: 0x11c8,
  /** u8[8][64]: row `y / 8`, a bit for each `y % 8`. */
  LIGHTING: 0x1510,
} as const;
