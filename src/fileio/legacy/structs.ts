/**
 * The legacy `.exs` records — `oldstructs.hpp` (namespace `legacy`), read
 * field by field out of the file.
 *
 * The 1997 game `fread` these structs straight into memory, so the file is the
 * struct layout of whichever machine wrote it: **Mac files are big-endian and
 * Windows files little-endian**, told apart by the four flag bytes at the front
 * (10/20/30/40 for Mac, 20/40/60/80 for Windows — `load_scenario_v1`).
 * The layouts are `#pragma pack(1)`, so there is no padding beyond the explicit
 * `pad_t` bytes.
 *
 * OBoE reads the bytes raw and then byte-swaps a hand-picked list of fields
 * (`porting.cpp`). This reads every multi-byte field in the file's own order
 * instead — what the original did on its native platform. Where OBoE's list
 * misses a field (a scenario monster's `status[15]`, for one), OBoE reads a
 * foreign-endian file wrong and this port doesn't; none of those fields reach
 * anything a scenario uses.
 *
 * Windows also wrote `Rect`s as `RECT` — left, top, right, bottom — and
 * `port_rect` swaps them back; `rect()` does the same.
 */

/**
 * How 8-bit game text becomes a string: `platform` is Mac Roman for a Mac
 * file and Windows-1252 for a Windows one; `latin1` maps each byte to the
 * code point of the same number, which is how a test compares with the C++.
 */
export type LegacyCharset = 'platform' | 'latin1';

export class LegacyReader {
  private readonly view: DataView;
  private readonly decoder: TextDecoder | null;
  pos = 0;

  constructor(readonly data: Uint8Array, readonly isMac: boolean, charset: LegacyCharset = 'platform') {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.decoder = charset === 'latin1' ? null : new TextDecoder(isMac ? 'macintosh' : 'windows-1252');
  }

  /** Bytes as text, in this file's character set, cut at the first NUL. */
  decode(bytes: Uint8Array | number[]): string {
    const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    let end = arr.indexOf(0);
    if (end < 0) end = arr.length;
    const cut = arr.subarray(0, end);
    return this.decoder === null ? String.fromCharCode(...cut) : this.decoder.decode(cut);
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new Error(`the scenario file ends early (wanted ${n} bytes at ${this.pos} of ${this.data.length})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, !this.isMac);
    this.pos += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, !this.isMac);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  u8s(n: number): number[] {
    return Array.from({ length: n }, () => this.u8());
  }

  i8s(n: number): number[] {
    return Array.from({ length: n }, () => this.i8());
  }

  i16s(n: number): number[] {
    return Array.from({ length: n }, () => this.i16());
  }

  /** `legacy::location` — two signed chars. */
  loc(): LegacyLoc {
    return { x: this.i8(), y: this.i8() };
  }

  locs(n: number): LegacyLoc[] {
    return Array.from({ length: n }, () => this.loc());
  }

  /** `legacy::Rect`, with `port_rect`'s swap for a Windows `RECT`. */
  rect(): LegacyRect {
    const a = this.i16();
    const b = this.i16();
    const c = this.i16();
    const d = this.i16();
    return this.isMac
      ? { top: a, left: b, bottom: c, right: d }
      : { top: b, left: a, bottom: d, right: c };
  }

  rects(n: number): LegacyRect[] {
    return Array.from({ length: n }, () => this.rect());
  }

  /** `n` bytes of `char`, cut at the first NUL as `std::string(char*)` would. */
  cstr(n: number): string {
    return this.decode(this.bytes(n));
  }

  /**
   * One of the length-prefixed strings that follow each record:
   * `fread(temp_str, len, 1, file); temp_str[len] = 0`. Past the end of the
   * file `fread` copies what there is and leaves the rest of `temp_str` as the
   * last string left it — so `buf` is that 256-byte buffer, kept by the caller
   * for as long as the C++ function keeps its local.
   */
  lstr(len: number, buf: Uint8Array): string {
    const n = Math.max(0, Math.min(len, this.data.length - this.pos));
    buf.set(this.data.subarray(this.pos, this.pos + n));
    this.pos += n;
    buf[len] = 0;
    return this.decode(buf.subarray(0, len + 1));
  }

  /**
   * A `char[]` field converted with `std::string(field)`, which reads on to the
   * first NUL even past the field's end — into the next field, the next record.
   * The 1997 game did the same whenever it printed one. `end` bounds it at the
   * end of the enclosing block, past which the C++ reads whatever memory follows.
   */
  cstrAt(at: number, end: number): string {
    return this.decode(this.data.subarray(at, end));
  }

  /** Assert a record ended where `sizeof` says it does. */
  expect(start: number, size: number, what: string): void {
    if (this.pos - start !== size) {
      throw new Error(`internal: read ${this.pos - start} bytes of ${what}, sizeof is ${size}`);
    }
  }
}

export interface LegacyLoc { x: number; y: number }
export interface LegacyRect { top: number; left: number; bottom: number; right: number }

export interface LegacySpecial {
  type: number; sd1: number; sd2: number; pic: number; m1: number; m2: number;
  ex1a: number; ex1b: number; ex2a: number; ex2b: number; jumpto: number;
}

export function readSpecial(r: LegacyReader): LegacySpecial {
  const [type, sd1, sd2, pic, m1, m2, ex1a, ex1b, ex2a, ex2b, jumpto] = r.i16s(11) as
    [number, number, number, number, number, number, number, number, number, number, number];
  return { type, sd1, sd2, pic, m1, m2, ex1a, ex1b, ex2a, ex2b, jumpto };
}

export interface LegacyTalkNode {
  personality: number; type: number; link1: number[]; link2: number[]; extras: number[];
}

export interface LegacyTalk {
  strlens: number[];
  nodes: LegacyTalkNode[];
}

/** `talking_record_type` — 1,400 bytes. */
export function readTalk(r: LegacyReader): LegacyTalk {
  const start = r.pos;
  const strlens = r.u8s(200);
  const nodes = Array.from({ length: 60 }, () => ({
    personality: r.i16(),
    type: r.i16(),
    link1: r.u8s(4),
    link2: r.u8s(4),
    extras: r.i16s(4),
  }));
  r.expect(start, 1400, 'talking_record_type');
  return { strlens, nodes };
}

export interface LegacyTerrain {
  picture: number; blockage: number; flag1: number; flag2: number; special: number;
  transToWhat: number; flyOver: number; boatOver: number; blockHorse: number;
  lightRadius: number; stepSound: number; shortcutKey: number;
}

function readTerrain(r: LegacyReader): LegacyTerrain {
  const t: LegacyTerrain = {
    picture: r.i16(), blockage: r.u8(), flag1: r.u8(), flag2: r.u8(), special: r.u8(),
    transToWhat: r.u8(), flyOver: r.u8(), boatOver: r.u8(), blockHorse: r.u8(),
    lightRadius: r.u8(), stepSound: r.u8(), shortcutKey: r.u8(),
  };
  r.skip(3); // res1..res3
  return t;
}

export interface LegacyOutWandering {
  monst: number[]; friendly: number[];
  specOnMeet: number; specOnWin: number; specOnFlee: number; cantFlee: number;
  endSpec1: number; endSpec2: number;
}

function readOutWandering(r: LegacyReader): LegacyOutWandering {
  return {
    monst: r.u8s(7), friendly: r.u8s(3),
    specOnMeet: r.i16(), specOnWin: r.i16(), specOnFlee: r.i16(), cantFlee: r.i16(),
    endSpec1: r.i16(), endSpec2: r.i16(),
  };
}

export interface LegacyOutdoor {
  /** terrain[x][y], as the C++ indexes it. */
  terrain: number[][];
  specialLocs: LegacyLoc[]; specialId: number[];
  exitLocs: LegacyLoc[]; exitDests: number[];
  signLocs: LegacyLoc[];
  wandering: LegacyOutWandering[]; specialEnc: LegacyOutWandering[];
  wanderingLocs: LegacyLoc[];
  infoRect: LegacyRect[];
  strlens: number[];
  specials: LegacySpecial[];
}

/** `outdoor_record_type` — 4,146 bytes. */
export function readOutdoor(r: LegacyReader): LegacyOutdoor {
  const start = r.pos;
  const terrain = Array.from({ length: 48 }, () => r.u8s(48));
  const out: LegacyOutdoor = {
    terrain,
    specialLocs: r.locs(18), specialId: r.u8s(18),
    exitLocs: r.locs(8), exitDests: r.i8s(8),
    signLocs: r.locs(8),
    wandering: Array.from({ length: 4 }, () => readOutWandering(r)),
    specialEnc: Array.from({ length: 4 }, () => readOutWandering(r)),
    wanderingLocs: r.locs(4),
    infoRect: r.rects(8),
    strlens: r.u8s(180),
    specials: Array.from({ length: 60 }, () => readSpecial(r)),
  };
  r.expect(start, 4146, 'outdoor_record_type');
  return out;
}

export interface LegacyCreatureStart {
  number: number; startAttitude: number; startLoc: LegacyLoc; mobile: number;
  timeFlag: number; spec1: number; spec2: number; specEncCode: number; timeCode: number;
  monsterTime: number; personality: number; specialOnKill: number; facialPic: number;
}

function readCreatureStart(r: LegacyReader): LegacyCreatureStart {
  const number = r.u8();
  const startAttitude = r.u8();
  const startLoc = r.loc();
  const mobile = r.u8();
  const timeFlag = r.u8();
  r.skip(2); // extra1, extra2
  return {
    number, startAttitude, startLoc, mobile, timeFlag,
    spec1: r.i16(), spec2: r.i16(), specEncCode: r.i8(), timeCode: r.i8(),
    monsterTime: r.i16(), personality: r.i16(), specialOnKill: r.i16(), facialPic: r.i16(),
  };
}

export interface LegacyItem {
  variety: number; itemLevel: number; awkward: number; bonus: number; protection: number;
  charges: number; type: number; magicUseType: number; graphicNum: number; ability: number;
  abilityStrength: number; typeFlag: number; isSpecial: number; value: number; weight: number;
  specialClass: number; itemLoc: LegacyLoc; fullName: string; name: string; treasClass: number;
  itemProperties: number;
  /** Where the two `char[]` names sit in the file, for `cstrAt`. */
  fullNameAt?: number;
  nameAt?: number;
}

/** `item_record_type` — 66 bytes. */
function readItem(r: LegacyReader): LegacyItem {
  const start = r.pos;
  const variety = r.i16();
  const itemLevel = r.i16();
  const awkward = r.i8();
  const bonus = r.i8();
  const protection = r.i8();
  const charges = r.i8();
  const type = r.i8();
  const magicUseType = r.i8();
  const graphicNum = r.u8();
  const ability = r.u8();
  const abilityStrength = r.u8();
  const typeFlag = r.u8();
  const isSpecial = r.u8();
  r.skip(1); // pad_t xxx
  const item: LegacyItem = {
    variety, itemLevel, awkward, bonus, protection, charges, type, magicUseType, graphicNum,
    ability, abilityStrength, typeFlag, isSpecial,
    value: r.i16(), weight: r.u8(), specialClass: r.u8(), itemLoc: r.loc(),
    // Filled in by readItemData, which knows where the block ends.
    fullName: '', name: '', treasClass: 0, itemProperties: 0,
  };
  item.fullNameAt = r.pos;
  r.skip(25);
  item.nameAt = r.pos;
  r.skip(15);
  item.treasClass = r.u8();
  item.itemProperties = r.u8();
  r.skip(2); // reserved1, reserved2
  r.expect(start, 66, 'item_record_type');
  return item;
}

export interface LegacyPresetItem {
  itemLoc: LegacyLoc; itemCode: number; ability: number;
  charges: number; alwaysThere: number; property: number; contained: number;
}

export interface LegacyTown {
  townChopTime: number; townChopKey: number;
  wandering: number[][]; wanderingLocs: LegacyLoc[];
  specialLocs: LegacyLoc[]; specId: number[];
  signLocs: LegacyLoc[];
  lighting: number;
  startLocs: LegacyLoc[]; exitLocs: LegacyLoc[]; exitSpecs: number[];
  inTownRect: LegacyRect;
  presetItems: LegacyPresetItem[];
  maxNumMonst: number;
  presetFields: { fieldLoc: LegacyLoc; fieldType: number }[];
  specOnEntry: number; specOnEntryIfDead: number;
  timerSpecTimes: number[]; timerSpecs: number[];
  strlens: number[];
  specials: LegacySpecial[];
  difficulty: number;
}

/** `town_record_type` — 3,506 bytes. */
export function readTown(r: LegacyReader): LegacyTown {
  const start = r.pos;
  const town: LegacyTown = {
    townChopTime: r.i16(), townChopKey: r.i16(),
    wandering: Array.from({ length: 4 }, () => r.u8s(4)),
    wanderingLocs: r.locs(4),
    specialLocs: r.locs(50), specId: r.u8s(50),
    signLocs: r.locs(15),
    lighting: r.i16(),
    startLocs: r.locs(4), exitLocs: r.locs(4), exitSpecs: r.i16s(4),
    inTownRect: r.rect(),
    presetItems: Array.from({ length: 64 }, () => ({
      itemLoc: r.loc(), itemCode: r.i16(), ability: r.i16(),
      charges: r.u8(), alwaysThere: r.u8(), property: r.u8(), contained: r.u8(),
    })),
    maxNumMonst: r.i16(),
    presetFields: Array.from({ length: 50 }, () => ({ fieldLoc: r.loc(), fieldType: r.i16() })),
    specOnEntry: r.i16(), specOnEntryIfDead: r.i16(),
    timerSpecTimes: r.i16s(8), timerSpecs: r.i16s(8),
    strlens: r.u8s(180),
    specials: Array.from({ length: 100 }, () => readSpecial(r)),
    difficulty: 0,
  };
  r.skip(4); // specials1, specials2, res1, res2
  town.difficulty = r.i16();
  r.expect(start, 3506, 'town_record_type');
  return town;
}

export interface LegacyTownDetail {
  /** terrain[x][y]. */
  terrain: number[][];
  roomRect: LegacyRect[];
  creatures: LegacyCreatureStart[];
  /** lighting[x / 8][y], one bit per square. */
  lighting: number[][];
}

/** `big_tr_type` / `ave_tr_type` / `tiny_tr_type`, by `town_size` 0/1/2. */
export const TOWN_SIZES = [
  { dim: 64, creatures: 60, bytes: 6056 },
  { dim: 48, creatures: 40, bytes: 3600 },
  { dim: 32, creatures: 30, bytes: 1940 },
] as const;

export function readTownDetail(r: LegacyReader, size: number): LegacyTownDetail {
  const shape = TOWN_SIZES[size];
  if (shape === undefined) throw new Error(`a town has size code ${size}, which isn't 0, 1 or 2`);
  const start = r.pos;
  const detail: LegacyTownDetail = {
    terrain: Array.from({ length: shape.dim }, () => r.u8s(shape.dim)),
    roomRect: r.rects(16),
    creatures: Array.from({ length: shape.creatures }, () => readCreatureStart(r)),
    lighting: Array.from({ length: shape.dim / 8 }, () => r.u8s(shape.dim)),
  };
  r.expect(start, shape.bytes, 'town detail record');
  return detail;
}

export interface LegacyMonster {
  level: number; mName: string; mHealth: number; armor: number; skill: number; a: number[];
  a1Type: number; a23Type: number; mType: number; speed: number; mu: number; cl: number;
  breath: number; breathType: number; treasure: number; specSkill: number; poison: number;
  corpseItem: number; corpseItemChance: number; immunities: number; xWidth: number; yWidth: number;
  radiate1: number; radiate2: number; defaultAttitude: number; summonType: number;
  defaultFacialPic: number; pictureNum: number;
}

/** `monster_record_type` — 108 bytes. */
function readMonster(r: LegacyReader): LegacyMonster {
  const start = r.pos;
  r.skip(1); // m_num
  const level = r.u8();
  const mName = r.cstr(26);
  r.skip(2); // health
  const mHealth = r.i16();
  r.skip(4); // mp, max_mp
  const armor = r.u8();
  const skill = r.u8();
  const a = r.i16s(3);
  const m: LegacyMonster = {
    level, mName, mHealth, armor, skill, a,
    a1Type: r.u8(), a23Type: r.u8(), mType: r.u8(), speed: r.u8(), mu: 0, cl: 0,
    breath: 0, breathType: 0, treasure: 0, specSkill: 0, poison: 0, corpseItem: 0,
    corpseItemChance: 0, immunities: 0, xWidth: 0, yWidth: 0, radiate1: 0, radiate2: 0,
    defaultAttitude: 0, summonType: 0, defaultFacialPic: 0, pictureNum: 0,
  };
  r.skip(1); // ap
  m.mu = r.u8();
  m.cl = r.u8();
  m.breath = r.u8();
  m.breathType = r.u8();
  m.treasure = r.u8();
  m.specSkill = r.u8();
  m.poison = r.u8();
  r.skip(4); // morale, m_morale
  m.corpseItem = r.i16();
  m.corpseItemChance = r.i16();
  r.skip(30); // status[15]
  r.skip(1); // direction
  m.immunities = r.u8();
  m.xWidth = r.u8();
  m.yWidth = r.u8();
  m.radiate1 = r.u8();
  m.radiate2 = r.u8();
  m.defaultAttitude = r.u8();
  m.summonType = r.u8();
  m.defaultFacialPic = r.u8();
  r.skip(3); // res1..res3
  m.pictureNum = r.i16();
  r.expect(start, 108, 'monster_record_type');
  return m;
}

export interface LegacyVehicle {
  loc: LegacyLoc; locInSec: LegacyLoc; sector: LegacyLoc;
  whichTown: number; exists: number; property: number;
}

function readVehicle(r: LegacyReader): LegacyVehicle {
  return {
    loc: r.loc(), locInSec: r.loc(), sector: r.loc(),
    whichTown: r.i16(), exists: r.u8(), property: r.u8(),
  };
}

export interface LegacyScenario {
  outWidth: number; outHeight: number; difficulty: number; introPic: number;
  townSize: number[]; townHidden: number[];
  whereStart: LegacyLoc; outSecStart: LegacyLoc; outStart: LegacyLoc;
  whichTownStart: number;
  townDataSize: number[][];
  townToAddTo: number[]; flagToAddToTown: number[][];
  outDataSize: number[][];
  storeItemRects: LegacyRect[]; storeItemTowns: number[];
  specialItems: number[]; specialItemSpecial: number[];
  rating: number; usesCustomGraphics: number;
  monsters: LegacyMonster[];
  boats: LegacyVehicle[]; horses: LegacyVehicle[];
  terTypes: LegacyTerrain[];
  scenarioTimerTimes: number[]; scenarioTimerSpecs: number[];
  specials: LegacySpecial[];
  scenStrLen: number[];
}

/** `scenario_data_type` — 41,930 bytes. */
export function readScenarioData(r: LegacyReader): LegacyScenario {
  const start = r.pos;
  const outWidth = r.u8();
  const outHeight = r.u8();
  const difficulty = r.u8();
  const introPic = r.u8();
  r.skip(1); // default_ground — the editor's, not the game's
  const townSize = r.u8s(200);
  const townHidden = r.u8s(200);
  r.skip(2); // flag_a
  r.skip(4); // intro_mess_pic, intro_mess_len (unused: OBoE takes intro_pic)
  r.skip(1); // pad_t xxx
  const whereStart = r.loc();
  const outSecStart = r.loc();
  const outStart = r.loc();
  const whichTownStart = r.i16();
  r.skip(2); // flag_b
  const townDataSize = Array.from({ length: 200 }, () => r.i16s(5));
  const townToAddTo = r.i16s(10);
  const flagToAddToTown = Array.from({ length: 10 }, () => r.i16s(2));
  r.skip(2); // flag_c
  const outDataSize = Array.from({ length: 100 }, () => r.i16s(2));
  const storeItemRects = r.rects(3);
  const storeItemTowns = r.i16s(3);
  r.skip(2); // flag_e
  const specialItems = r.i16s(50);
  const specialItemSpecial = r.i16s(50);
  const rating = r.i16();
  const usesCustomGraphics = r.i16();
  r.skip(2); // flag_f
  const monsters = Array.from({ length: 256 }, () => readMonster(r));
  const boats = Array.from({ length: 30 }, () => readVehicle(r));
  const horses = Array.from({ length: 30 }, () => readVehicle(r));
  r.skip(2); // flag_g
  const terTypes = Array.from({ length: 256 }, () => readTerrain(r));
  const scenarioTimerTimes = r.i16s(20);
  const scenarioTimerSpecs = r.i16s(20);
  r.skip(2); // flag_h
  const specials = Array.from({ length: 256 }, () => readSpecial(r));
  r.skip(10 * 44); // storage_shortcuts — the editor's
  r.skip(2); // flag_d
  const scenStrLen = r.u8s(300);
  r.skip(2 + 2 + 2); // flag_i, last_out_edited, last_town_edited
  r.expect(start, 41930, 'scenario_data_type');
  return {
    outWidth, outHeight, difficulty, introPic, townSize, townHidden, whereStart, outSecStart,
    outStart, whichTownStart, townDataSize, townToAddTo, flagToAddToTown, outDataSize,
    storeItemRects, storeItemTowns, specialItems, specialItemSpecial, rating, usesCustomGraphics,
    monsters, boats, horses, terTypes, scenarioTimerTimes, scenarioTimerSpecs, specials, scenStrLen,
  };
}

export interface LegacyItemData {
  items: LegacyItem[];
  monstNames: string[];
  terNames: string[];
}

/** `scen_item_data_type` — 39,200 bytes. */
export function readItemData(r: LegacyReader): LegacyItemData {
  const start = r.pos;
  const end = start + 39200;
  const items = Array.from({ length: 400 }, () => readItem(r));
  for (const item of items) {
    item.fullName = r.cstrAt(item.fullNameAt!, end);
    item.name = r.cstrAt(item.nameAt!, end);
  }
  const monstNames = Array.from({ length: 256 }, () => { const at = r.pos; r.skip(20); return r.cstrAt(at, end); });
  const terNames = Array.from({ length: 256 }, () => { const at = r.pos; r.skip(30); return r.cstrAt(at, end); });
  r.expect(start, 39200, 'scen_item_data_type');
  return { items, monstNames, terNames };
}
