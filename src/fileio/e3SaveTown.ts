/**
 * The town blocks of an Exile III save made in town: `c_town`, `t_d` and
 * `t_i`, and the town's `misc_i` and `sfx`, from the town the party stands
 * in (`e3SaveExport.ts`).
 *
 * E3's town loader (`FUN_1040_1e1c`) copies TOWN.DAT's record into `c_town`
 * and its block into `t_d`, and `load_file` reads them back with no reload,
 * so a save carries the town whole. Each part was pinned against four
 * saves from the original made in town (Fort Emergence, Krizsan, the New
 * Factory and Ghikra; 2026-10-01; `test/e3save.test.ts`):
 *
 * - the common record goes in with its words little-endian and its rect in
 *   Windows order: byte for byte as in all four;
 * - `t_d` is the large town's layout whatever the size, each part filled
 *   from its start (terrain and lighting at a stride of 64), and the rest
 *   left as the last town had it, which no reader looks at; a village's map
 *   is the one built on entry, and its room rects are cleared;
 * - a creature is BoE 1997's `creature_data_type`, its monster record built
 *   as `FUN_1090_0000` builds it from segment 39's arrays;
 * - an item is a PC's item record with its square at +21, its preset slot
 *   plus one at +12 (what taking it marks), and property and contained at
 *   +16 and +18;
 * - fields are BoE 1997's bits (FIELDS.CPP): `misc_i` for the special
 *   squares, objects and barriers, the high bits of `c_town.explored` for
 *   walls and clouds, `sfx` for the stains. A special square's bit is what
 *   E3 clears to erase a one-shot spot (`FUN_1038_0282`), so it is set for
 *   each of the record's spots but those the converter's own flag says ran.
 *
 * What isn't carried: a summoned creature's summoner, and the creatures'
 * targets, which E3 works out again.
 */

import { FieldType } from '../data/fields';
import { e3SpotFlag } from '../../tools/e3convert/flags';
import { E3_TOWN_RECORD_SIZE, e3TownGeometry, e3TownOffset } from '../../tools/e3convert/town';
import type { Item } from '../data/item';
import { CreatureStatus, type Creature } from '../universe/creature';
import type { Universe } from '../universe/universe';
import {
  E3Bytes, E3CREATURE, E3CTOWN, E3ITEM, E3MONST, E3TD, E3_CTOWN_SIZE, E3_ITEM_LIST_SIZE, E3_MISC_I_SIZE, E3_SFX_SIZE,
  E3_TOWN_DATA_SIZE,
} from './e3save';
import type { E3SaveDefaults } from './e3SaveDefaults';

export interface E3TownBlocks {
  cTown: Uint8Array;
  data: Uint8Array;
  items: Uint8Array;
  miscI: Uint8Array;
  sfx: Uint8Array;
}

const DIM = 64;
const ITEMS_HELD = 115;
const CREATURES_HELD = 60;
const START_SIZE = 14;
/** E3's records end at 199; the converter's ruins and the like come after. */
const E3_TOWNS = 200;

const swap16 = (b: Uint8Array, at: number): void => { const t = b[at]!; b[at] = b[at + 1]!; b[at + 1] = t; };
/** A Mac rect (top, left, bottom, right, big-endian) as a Windows one, little-endian. */
const rect = (b: Uint8Array, at: number): void => {
  b.set(b.slice(at, at + 4).reverse(), at);
  b.set(b.slice(at + 4, at + 8).reverse(), at + 4);
};
/** A creature start's two words, +10 (the time code) and +12 (the personality). */
const start = (b: Uint8Array, at: number): void => { swap16(b, at + 10); swap16(b, at + 12); };

/** TOWN.DAT's common record for `town` as `c_town` holds it. */
export function e3TownHeader(townDat: Uint8Array, town: number): Uint8Array {
  const o = e3TownOffset(town);
  const b = townDat.slice(o, o + E3_TOWN_RECORD_SIZE);
  swap16(b, 0); swap16(b, 2);
  swap16(b, 0xac);
  for (let k = 0; k < 4; k++) swap16(b, 0xb6 + 2 * k);
  rect(b, 0xc6);
  for (let k = 0; k < 64; k++) { swap16(b, 0xce + 10 * k + 2); swap16(b, 0xce + 10 * k + 4); }
  swap16(b, 0x34e); swap16(b, 0x350);
  for (let k = 0; k < 50; k++) swap16(b, 0x352 + 4 * k + 2);
  for (let k = 0; k < 4; k++) swap16(b, 0x41a + 2 * k);
  return b;
}

/**
 * `t_d` for `town` as the loader fills it, but with `terrain` (the map as it
 * stands) in place of the file's.
 */
export function e3TownData(townDat: Uint8Array, town: number, terrain: (x: number, y: number) => number): Uint8Array {
  const g = e3TownGeometry(town);
  const d = new Uint8Array(E3_TOWN_DATA_SIZE);
  const o = e3TownOffset(town) + E3_TOWN_RECORD_SIZE;
  const dim = g.kind === 'village' ? 48 : g.size;
  for (let x = 0; x < dim; x++) for (let y = 0; y < dim; y++) d[E3TD.TERRAIN + DIM * x + y] = terrain(x, y);
  if (g.kind === 'village') {
    for (let k = 0; k < g.creatures; k++) {
      d.set(townDat.subarray(o + START_SIZE * k, o + START_SIZE * (k + 1)), E3TD.CREATURES + START_SIZE * k);
      start(d, E3TD.CREATURES + START_SIZE * k);
    }
    return d;
  }
  let p = o + g.size * g.size;
  for (let k = 0; k < g.rooms; k++) {
    d.set(townDat.subarray(p + 8 * k, p + 8 * k + 8), E3TD.ROOM_RECTS + 8 * k);
    rect(d, E3TD.ROOM_RECTS + 8 * k);
  }
  p += 8 * g.rooms;
  d.set(townDat.subarray(p, p + 30 * g.rooms), E3TD.ROOM_NAMES);
  p += 30 * g.rooms;
  for (let k = 0; k < g.creatures; k++) {
    d.set(townDat.subarray(p + START_SIZE * k, p + START_SIZE * (k + 1)), E3TD.CREATURES + START_SIZE * k);
    start(d, E3TD.CREATURES + START_SIZE * k);
  }
  p += START_SIZE * g.creatures;
  for (let row = 0; row < g.size / 8; row++) d.set(townDat.subarray(p + g.size * row, p + g.size * (row + 1)), E3TD.LIGHTING + DIM * row);
  return d;
}

/**
 * Monster `n`'s record as `FUN_1090_0000` builds it from segment 39's
 * parallel arrays (200 entries a field). `halved` is party+0xc7f, flag
 * (306, 7), which halves the health.
 */
export function e3MonsterRecord(table: Uint8Array, n: number, halved: boolean): Uint8Array {
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const u8 = (off: number) => table[off + n] ?? 0;
  const i16 = (off: number) => v.getInt16(off + 2 * n, true);
  const r = new E3Bytes(new Uint8Array(E3MONST.SIZE));
  const level = u8(0);
  r.setU8(0, n);
  r.setU8(1, level);
  // `cdq; sub ax, dx; sar ax, 1`: halved toward zero.
  const health = halved ? Math.trunc(i16(0xc8) / 2) : i16(0xc8);
  r.setI16(E3MONST.HEALTH, health);
  r.setI16(E3MONST.M_HEALTH, health);
  r.setU8(10, u8(0x258));
  r.setU8(11, u8(0x320));
  r.setI16(12, i16(0x3e8));
  r.setI16(14, i16(0x578));
  r.setI16(16, i16(0x708));
  r.setU8(18, u8(0x898));
  r.setU8(19, u8(0x960));
  r.setU8(20, u8(0xa28));
  r.setU8(21, u8(0xaf0));
  r.setU8(23, u8(0xbb8));
  r.setU8(24, u8(0xc80));
  // Spell points for a caster: 8 a level, 16 from monster 177 (0xb1) on.
  if (u8(0xbb8) > 0 || u8(0xc80) > 0) {
    const mp = (n >= 0xb1 ? 16 : 8) * level;
    r.setI16(E3MONST.MP, mp);
    r.setI16(E3MONST.MAX_MP, mp);
  }
  r.setU8(25, u8(0xd48));
  r.setU8(26, u8(0xed8));
  r.setU8(27, u8(0xfa0));
  // Morale: 10 a level, and 10 more a level past 20.
  const morale = level * 10 + (level >= 20 ? (level - 20) * 10 : 0);
  r.setI16(28, morale);
  r.setI16(30, morale);
  r.setU8(32, u8(0xe10));
  r.setU8(33, u8(0x1068));
  let immune = 0;
  [0x12c0, 0x1388, 0x1450, 0x1518].forEach((off, k) => {
    if (u8(off) === 1) immune |= 1 << (2 * k);
    if (u8(off) === 2) immune |= 2 << (2 * k);
  });
  r.setU8(65, immune);
  r.setU8(66, u8(0x1130));
  r.setU8(67, u8(0x11f8));
  return r.data;
}

/** An E3 terrain number: the converter's two stand-ins for 255 go back (`withTer255`). */
const e3Terrain = (t: number): number => (t > 255 ? 255 : t);

const MISC_BITS = new Map<FieldType, number>([
  [FieldType.OBJECT_BLOCK, 1], [FieldType.SPECIAL_SPOT, 2], [FieldType.FIELD_WEB, 4], [FieldType.OBJECT_CRATE, 8],
  [FieldType.OBJECT_BARREL, 16], [FieldType.BARRIER_FIRE, 32], [FieldType.BARRIER_FORCE, 64], [FieldType.FIELD_QUICKFIRE, 128],
]);
const EXPLORED_BITS = new Map<FieldType, number>([
  [FieldType.WALL_FORCE, 2], [FieldType.WALL_FIRE, 4], [FieldType.FIELD_ANTIMAGIC, 8], [FieldType.CLOUD_STINK, 16],
  [FieldType.WALL_ICE, 32], [FieldType.WALL_BLADES, 64], [FieldType.CLOUD_SLEEP, 128],
]);
const SFX_BITS = new Map<FieldType, number>([
  [FieldType.SFX_SMALL_BLOOD, 1], [FieldType.SFX_MEDIUM_BLOOD, 2], [FieldType.SFX_LARGE_BLOOD, 4],
  [FieldType.SFX_SMALL_SLIME, 8], [FieldType.SFX_LARGE_SLIME, 16], [FieldType.SFX_ASH, 32],
  [FieldType.SFX_BONES, 64], [FieldType.SFX_RUBBLE, 128],
]);

/**
 * The town blocks for the town the party is in, or a reason they can't be
 * written (the copy predates the tables, or the town isn't one of E3's).
 */
export function e3TownBlocks(
  univ: Universe, defaults: E3SaveDefaults, itemToE3: (item: Item) => Uint8Array | null, warnings: string[],
): E3TownBlocks | string {
  const { townDat, monsterTable } = defaults;
  const town = univ.town;
  const num = univ.party.townNum;
  if (!townDat || !monsterTable) return 'this copy of Exile III was converted before saves in town could be written';
  if (!town || num < 0 || num >= E3_TOWNS) return 'this place is not one of Exile III\'s towns';
  const record = town.record;
  const dim = Math.min(DIM, record.maxDim);
  const party = univ.party;

  const data = e3TownData(townDat, num, (x, y) => e3Terrain(record.terrain[x]?.[y] ?? 0));

  const c = new E3Bytes(new Uint8Array(E3_CTOWN_SIZE));
  c.setI16(E3CTOWN.TOWN_NUM, num);
  c.setI16(E3CTOWN.DIFFICULTY, Math.max(0, Math.min(150, record.difficulty)));
  const header = e3TownHeader(townDat, num);
  c.data.set(header, E3CTOWN.TOWN);
  c.setU8(E3CTOWN.HOSTILE, town.monstHostile ? 1 : 0);

  const miscI = new Uint8Array(E3_MISC_I_SIZE);
  const sfx = new Uint8Array(E3_SFX_SIZE);
  for (let x = 0; x < dim; x++) {
    for (let y = 0; y < dim; y++) {
      let e = town.explored[x]![y] ? 1 : 0, m = 0, s = 0;
      for (const f of town.fields[x]![y]!) {
        e |= EXPLORED_BITS.get(f) ?? 0;
        m |= MISC_BITS.get(f) ?? 0;
        s |= SFX_BITS.get(f) ?? 0;
      }
      c.setU8(E3CTOWN.EXPLORED + DIM * x + y, e);
      miscI[DIM * x + y] = m;
      sfx[DIM * x + y] = s;
    }
  }
  // The special squares, less those E3 would have erased.
  for (const { x, y, flag } of e3TownSpots(townDat, num)) {
    if (party.getSdf(...flag) === 0) miscI[DIM * x + y] = miscI[DIM * x + y]! | 2;
  }

  // The creatures.
  c.data.set(e3CreatureList(univ, monsterTable, data, town.monsters, warnings), E3CTOWN.CREATURES);
  c.setI16(E3CTOWN.WHICH_TOWN, num);
  c.setLoc(E3CTOWN.P_LOC, party.townLoc);
  c.setStr(E3CTOWN.NAME, E3CTOWN.NAME_LEN, record.name);

  const items = e3ItemList(town.items, itemToE3, warnings, 'on the ground');
  return { cTown: c.data, data, items, miscI, sfx };
}

/**
 * A town's creatures as E3's `creature_list_type` holds them, 60 of
 * `E3CREATURE.SIZE`: `c_town`'s (from +0x1427), and each of the four towns
 * the party remembers (`creature_save`, party+0x1416). The record's slots
 * come first, each with its start from `data` (the town's `t_d`), then any
 * creature summoned into the town, in a free slot.
 */
export function e3CreatureList(
  univ: Universe, monsterTable: Uint8Array, data: Uint8Array, monsters: Creature[], warnings: string[],
): Uint8Array {
  const c = new E3Bytes(new Uint8Array(CREATURES_HELD * E3CREATURE.SIZE));
  const halved = univ.party.getSdf(306, 7) !== 0;
  const bySlot = new Map<number, Creature>();
  const extra: Creature[] = [];
  monsters.forEach((m, i) => {
    const slot = m.slot >= 0 ? m.slot : i;
    if (slot < CREATURES_HELD && !bySlot.has(slot) && m.summonTime === 0) bySlot.set(slot, m);
    else if (m.isAlive) extra.push(m);
  });
  const used = new Set<number>();
  const writeCreature = (k: number, m: Creature | undefined, startRec: Uint8Array): void => {
    const at = E3CREATURE.SIZE * k;
    const number = m?.number ?? startRec[0]!;
    if (number === 0) return;
    used.add(k);
    c.setI16(at + E3CREATURE.ACTIVE, m?.isAlive ? Math.min(m.active, CreatureStatus.ALERTED) : 0);
    c.setI16(at + E3CREATURE.ATTITUDE, m?.attitude ?? startRec[1]!);
    c.setU8(at + E3CREATURE.NUMBER, number);
    c.setLoc(at + E3CREATURE.LOC, m?.curLoc ?? { x: startRec[2]!, y: startRec[3]! });
    const mon = e3MonsterRecord(monsterTable, number, halved);
    const r = new E3Bytes(mon);
    if (m?.isAlive) {
      r.setI16(E3MONST.HEALTH, m.health);
      r.setI16(E3MONST.MP, Math.min(m.mp, r.i16(E3MONST.MAX_MP)));
      r.setI16(E3MONST.MORALE, m.morale);
      for (let i = 0; i < 15; i++) r.setI16(E3MONST.STATUS + 2 * i, m.status[i] ?? 0);
      r.setU8(E3MONST.DIRECTION, m.direction < 8 ? m.direction : 0);
    }
    c.data.set(mon, at + E3CREATURE.MONST);
    c.setU8(at + E3CREATURE.MOBILE, startRec[4]!);
    c.setI16(at + E3CREATURE.SUMMONED, m?.summonTime ?? 0);
    c.data.set(startRec, at + E3CREATURE.START);
  };
  for (let k = 0; k < CREATURES_HELD; k++) {
    const startRec = data.slice(E3TD.CREATURES + START_SIZE * k, E3TD.CREATURES + START_SIZE * (k + 1));
    writeCreature(k, bySlot.get(k), startRec);
  }
  for (const m of extra) {
    let k = 0;
    while (k < CREATURES_HELD && used.has(k)) k++;
    if (k === CREATURES_HELD) { warnings.push(`There was no room for the ${m.getName()} in the town's creatures.`); continue; }
    const startRec = new Uint8Array(START_SIZE);
    startRec[0] = m.number;
    startRec[1] = m.attitude;
    startRec[2] = m.curLoc.x; startRec[3] = m.curLoc.y;
    startRec[4] = m.mobile ? 1 : 0;
    new E3Bytes(startRec).setI16(10, -1);
    writeCreature(k, m, startRec);
  }
  return c.data;
}

/**
 * Town `num`'s special squares (`load_town`: each of the record's 40 with x
 * below 100) and the converter flag that says each ran (`e3SpotFlag`): E3
 * clears the square's `misc_i` bit 2 to erase one (`FUN_1038_0282`).
 */
export function e3TownSpots(townDat: Uint8Array, num: number): { x: number; y: number; flag: [number, number] }[] {
  const header = e3TownHeader(townDat, num);
  const out: { x: number; y: number; flag: [number, number] }[] = [];
  for (let k = 0; k < 40; k++) {
    const x = header[0x1c + 2 * k]!, y = header[0x1d + 2 * k]!;
    if (x < 100 && x < DIM && y < DIM) out.push({ x, y, flag: e3SpotFlag({ town: num }, k) });
  }
  return out;
}

/**
 * Items lying in a town as E3 lists them, 115 of 63 bytes: `t_i`, and each
 * of the stashes (`E3_STASHES`). Each keeps its square, its preset slot plus
 * one (`isSpecial`), and whether it is someone else's or in a container.
 * `where` names them in a warning.
 */
export function e3ItemList(list: Item[], itemToE3: (item: Item) => Uint8Array | null, warnings: string[], where: string): Uint8Array {
  const items = new Uint8Array(E3_ITEM_LIST_SIZE);
  let n = 0;
  for (const item of list) {
    if (item.variety === 0) continue;
    if (n === ITEMS_HELD) { warnings.push(`Exile III holds ${ITEMS_HELD} items in a town; the rest ${where} were left out.`); break; }
    const rec = itemToE3(item);
    if (rec === null) { warnings.push(`The "${item.fullName}" ${where} isn't one of Exile III's items, and was left out.`); continue; }
    const b = new E3Bytes(rec);
    b.setU8(E3ITEM.IS_SPECIAL, item.isSpecial);
    b.setU8(E3ITEM.PROPERTY, item.property ? 1 : 0);
    b.setU8(E3ITEM.CONTAINED, item.contained ? 1 : 0);
    b.setLoc(E3ITEM.LOC, item.itemLoc);
    items.set(rec, E3ITEM.SIZE * n++);
  }
  return items;
}
