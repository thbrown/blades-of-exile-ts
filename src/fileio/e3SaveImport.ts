/**
 * Loading an Exile III save (`exile3.sav`) into the converted Exile III:
 * E3's party record and PCs (`e3save.ts`) laid onto a fresh game, as
 * `applySave` lays an `.exg`.
 *
 * Most of it is one to one, because the converter keeps E3's numbers: E3's
 * flag bytes are the engine's SDFs (`tools/e3convert/flags.ts`), its special
 * items, alchemy recipes, monsters and towns keep their indices, its plot
 * events are keys one higher, and a PC record is BoE 1997's. Two things are
 * renumbered and mapped back: the boats and horses (`vehicleNumbers`), and the
 * items, which are matched by name against the scenario's.
 *
 * What a save holds that this doesn't read yet (each marked where it would go):
 * - the town the party stands in. `c_town` (its creatures, their health and
 *   positions, and its items) is not read: the party is put back on its
 *   square and the town is entered afresh, with no entry special;
 * - the four remembered towns' creatures (`creature_save`), the wandering
 *   groups outdoors (`out_c`), the magic shops' stock, the journal and the
 *   encounter and talk notes (E3 keeps string numbers; the engine keeps
 *   text) and the stored items;
 * - the converter's own flags, in SDF columns 10–49 (`flags.ts`): a one-shot
 *   spot E3 erased, the daily stamps and the day counts. Only the town states
 *   (`e3TownState`) are worked out again, since they follow from the day.
 */

import type { Location } from '../core/location';
import type { Item } from '../data/item';
import { defaultItem } from '../data/item';
import { TOWN_STATES } from '../../tools/e3convert/towns/townStates';
import { e3DayReached, e3TownState } from '../../tools/e3convert/flags';
import { vehicleNumbers, type E3Vehicle } from '../../tools/e3convert/tables';
import {
  E3Bytes, E3CTOWN, E3ITEM, E3P, E3PC, E3_ZONES_ACROSS, E3_ZONE_MAP_SIZE, e3MapBit, e3TownMapAt, readE3Save, type E3Save,
} from './e3save';
import { SECTOR_SIZE } from '../data/outdoors';
import type { Scenario } from '../data/scenario';
import { OUT_MAX_DIM } from '../universe/curOut';
import {
  E3_TABLE_ITEM_SIZE, e3ItemGraphic, e3TableItemCount, unenchantedName, type E3SaveDefaults,
} from './e3SaveDefaults';
import { freshenForLoad } from './saveIo';
import type { Vehicle } from '../data/vehicle';
import type { E3Job } from '../game/e3Jobs';
import { E3_JOBS_HELD, E3_JOBS_PER_BOARD, E3_JOB_BANKS } from '../game/e3Jobs';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import type { Player } from '../universe/player';
import { NUM_INVEN_SLOTS, NUM_SPELLS } from '../universe/player';
import { NUM_SKILLS, NUM_TRAITS } from '../universe/skills';
import type { Universe } from '../universe/universe';
import { FieldType } from '../data/fields';

export interface E3Import {
  /**
   * The engine's town to enter, and where, when the save was made in town,
   * with its stains as E3 saved them (`sfx`, 64 by 64): `applyE3TownDecals`
   * lays them on once the town is entered.
   */
  town: { num: number; loc: Location; decals: Uint8Array } | null;
  /** What couldn't be carried over, for the transcript. */
  warnings: string[];
}

/** E3's vehicle tables as the converter reads them (`readE3Vehicles`). */
export function e3VehicleTable(table: Uint8Array): E3Vehicle[] {
  const b = new E3Bytes(table);
  return Array.from({ length: 30 }, (_, k) => ({
    loc: { x: b.u8(10 * k), y: b.u8(10 * k + 1) },
    town: b.i16(10 * k + 6),
    exists: b.u8(10 * k + 8) === 1,
    property: b.u8(10 * k + 9) === 1,
  }));
}

/**
 * An E3 item record as the engine's item: the scenario's item of the same
 * name, kind and E3 ability (so a scripted variant, a note or a stamped item,
 * comes back as itself), with the save's own numbers on top, since
 * enchanting and use change them. Null for an empty slot or one the scenario
 * has no item for.
 */
export function e3ItemToItem(univ: Universe, rec: Uint8Array, defaults: E3SaveDefaults): Item | null {
  const b = new E3Bytes(rec);
  const variety = b.i16(E3ITEM.VARIETY);
  if (variety === 0) return null;
  const fullName = b.str(E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN);
  const ability = b.u8(E3ITEM.ABILITY);
  const graphic = b.u8(E3ITEM.GRAPHIC);
  const record = e3TableRecordOf(defaults, rec);
  const named = (name: string) => univ.scenario.scenItems.filter((it) => it.fullName === name && it.variety === variety);
  const same = named(fullName).length > 0 ? named(fullName) : named(unenchantedName(fullName));
  const base = same.find((it) => it.e3Item === record && it.e3Ability === ability)
    ?? same.find((it) => it.e3Item === record)
    ?? same.find((it) => it.e3Ability === ability && e3ItemGraphic(it.graphicNum) === graphic)
    ?? same.find((it) => it.e3Ability === ability) ?? same[0];
  if (!base) return null;
  const item: Item = { ...defaultItem(), ...base, itemLoc: { x: 0, y: 0 } };
  if (record >= 0) item.e3Item = record;
  item.fullName = fullName;
  // The save's own picture: E3 gives a potion one the table doesn't
  // (an unidentified Weak Strength P., 30 in the table, was 32).
  if (e3ItemGraphic(item.graphicNum) >= 0) item.graphicNum += graphic - e3ItemGraphic(item.graphicNum);
  // An enchantment's ability (a blessed blade's 3) is E3's own code; the
  // engine's ability stays the base item's. TODO(e3save): enchantments.
  item.e3Ability = ability;
  item.itemLevel = b.i16(E3ITEM.LEVEL);
  item.awkward = b.i8(E3ITEM.AWKWARD);
  item.bonus = b.i8(E3ITEM.BONUS);
  item.protection = b.i8(E3ITEM.PROTECTION);
  item.charges = b.i8(E3ITEM.CHARGES);
  item.value = b.i16(E3ITEM.VALUE);
  item.weight = b.u8(E3ITEM.WEIGHT);
  item.ident = b.u8(E3ITEM.IDENTIFIED) !== 0;
  item.magic = b.u8(E3ITEM.MAGIC) !== 0;
  item.name = b.str(E3ITEM.NAME, E3ITEM.NAME_LEN);
  return item;
}

/**
 * The table record an item in a save was made from: of the records with its
 * kind and plain name, the one agreeing with it on the most of the bytes the
 * table holds (class included, which tells the two Brews of Lethe apart).
 * -1 if none has its kind and name.
 */
export function e3TableRecordOf(defaults: E3SaveDefaults, rec: Uint8Array): number {
  const b = new E3Bytes(rec);
  const name = unenchantedName(b.str(E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN));
  // The in-memory record's bytes that the table has, by table offset.
  const pairs: [number, number][] = [
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [11, 11],
    [13, 13], [14, 14], [16, E3ITEM.MAGIC], [17, E3ITEM.WEIGHT], [18, E3ITEM.CLASS],
  ];
  let best = -1, bestScore = -1;
  for (let k = 0; k < e3TableItemCount(defaults); k++) {
    const t = defaults.itemTable.subarray(k * E3_TABLE_ITEM_SIZE, (k + 1) * E3_TABLE_ITEM_SIZE);
    const tb = new E3Bytes(t);
    if (tb.i16(0) !== b.i16(E3ITEM.VARIETY) || tb.str(19, 25) !== name) continue;
    const score = pairs.filter(([ti, ri]) => t[ti] === rec[ri]).length;
    if (score > bestScore) { best = k; bestScore = score; }
  }
  return best;
}

function readPc(univ: Universe, pc: Player, rec: Uint8Array, defaults: E3SaveDefaults, warnings: string[]): void {
  const b = new E3Bytes(rec);
  pc.mainStatus = b.i16(E3PC.MAIN_STATUS);
  pc.name = b.str(E3PC.NAME, E3PC.NAME_LEN);
  for (let i = 0; i < NUM_SKILLS; i++) pc.skills[i] = b.i16(E3PC.SKILLS + 2 * i);
  pc.maxHealth = b.i16(E3PC.MAX_HEALTH);
  pc.curHealth = b.i16(E3PC.CUR_HEALTH);
  pc.maxSp = b.i16(E3PC.MAX_SP);
  pc.curSp = b.i16(E3PC.CUR_SP);
  pc.experience = b.i16(E3PC.EXPERIENCE);
  pc.skillPts = b.i16(E3PC.SKILL_PTS);
  pc.level = b.i16(E3PC.LEVEL);
  for (let i = 0; i < 15; i++) pc.status[i] = b.i16(E3PC.STATUS + 2 * i);
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const rec = b.sub(E3PC.ITEMS + i * E3ITEM.SIZE, E3ITEM.SIZE);
    const item = e3ItemToItem(univ, rec, defaults);
    if (item === null && new E3Bytes(rec).i16(E3ITEM.VARIETY) !== 0) {
      warnings.push(`${pc.name}'s "${new E3Bytes(rec).str(E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN)}" has no match in the scenario.`);
    }
    pc.items[i] = item ?? defaultItem();
    pc.equip[i] = item !== null && b.u8(E3PC.EQUIP + i) !== 0;
  }
  for (let i = 0; i < NUM_SPELLS; i++) {
    pc.priestSpells[i] = b.u8(E3PC.PRIEST_SPELLS + i) !== 0;
    pc.mageSpells[i] = b.u8(E3PC.MAGE_SPELLS + i) !== 0;
  }
  pc.whichGraphic = b.i16(E3PC.WHICH_GRAPHIC);
  // The slot last poisoned, which E3 never clears: it counts only while the
  // poison (status 0) lasts.
  const poisoned = b.i16(E3PC.WEAP_POISONED);
  pc.weapPoisoned = (pc.status[0] ?? 0) > 0 && poisoned >= 0 && poisoned < NUM_INVEN_SLOTS
    && pc.items[poisoned]!.variety !== 0 ? pc.items[poisoned]! : null;
  for (let i = 0; i < NUM_TRAITS; i++) pc.traits[i] = i < 15 && b.u8(E3PC.TRAITS + i) !== 0;
  pc.race = b.i16(E3PC.RACE);
  pc.expAdj = b.i16(E3PC.EXP_ADJ);
  pc.direction = b.i16(E3PC.DIRECTION);
}

function readVehicles(list: Vehicle[], p: E3Bytes, at: number, table: Uint8Array): void {
  const numbers = vehicleNumbers(e3VehicleTable(table));
  numbers.forEach((n, k) => {
    const v = list[n];
    const r = at + 10 * k;
    // A slot not in use is E3's table's vehicle still: a new game's record
    // has none, and they appear once the party has played (2026-10-01).
    if (n < 0 || v === undefined || p.u8(r + 8) === 0) return;
    v.whichTown = p.i16(r + 6);
    v.loc = v.whichTown === TOWN_NUM_OUTDOORS ? p.loc(r + 2) : p.loc(r);
    v.sector = p.loc(r + 4);
    v.exists = p.u8(r + 8) !== 0;
    v.property = p.u8(r + 9) !== 0;
  });
}

/** E3's index of a boat or horse the party is in (0 for none) as the engine's (-1). */
function inVehicle(k: number, table: Uint8Array): number {
  return k > 0 ? vehicleNumbers(e3VehicleTable(table))[k] ?? -1 : -1;
}

function readJob(p: E3Bytes, at: number): E3Job {
  return { kind: p.i16(at), extra: p.i16(at + 4), days: p.i16(at + 6), target: p.i16(at + 8), bank: p.i16(at + 10) };
}

/** Lays `save` onto `univ`, which must hold the converted Exile III. */
export function applyE3SaveRecord(save: E3Save, univ: Universe, defaults: E3SaveDefaults): E3Import {
  const warnings: string[] = [];
  const { scenario } = univ;
  freshenForLoad(univ);
  const party = univ.party;
  // What `Universe`'s constructor gives a new game and a save then overwrites.
  party.boats = scenario.boats.filter((v) => v.exists).map((v) => ({ ...v }));
  party.horses = scenario.horses.filter((v) => v.exists).map((v) => ({ ...v }));
  for (const town of scenario.towns) town.canFind = !town.isHidden;
  univ.refreshStoreItems();
  // TODO(e3save): creature_save, out_c, the magic shops' stock, the journal,
  // the notes and the stored items.

  const p = new E3Bytes(save.party);
  party.age = p.i32(E3P.AGE);
  party.gold = p.i32(E3P.GOLD);
  party.food = p.i32(E3P.FOOD);
  for (let k = 0; k < 60; k++) if (p.i16(E3P.SPEC_ITEMS + 2 * k) > 0) party.specItems.add(k);
  for (let row = 0; row < E3P.FLAG_ROWS; row++) {
    for (let col = 0; col < 10; col++) party.stuffDone[row]![col] = p.u8(E3P.FLAGS + row * 10 + col);
  }
  for (let t = 0; t < Math.min(200, scenario.towns.length); t++) {
    const town = scenario.towns[t]!;
    for (let i = 0; i < 64 && i < town.itemTaken.length; i++) {
      town.itemTaken[i] = (p.u8(E3P.ITEM_TAKEN + t * 8 + (i >> 3)) & (1 << (i & 7))) !== 0;
    }
    town.monstersKilled = p.i16(E3P.M_KILLED + 2 * t);
    if (t < E3P.CAN_FIND_TOWNS) town.canFind = p.u8(E3P.CAN_FIND_TOWN + t) !== 0;
  }
  party.lightLevel = p.i16(E3P.LIGHT_LEVEL);
  party.outdoorCorner = p.loc(E3P.OUTDOOR_CORNER);
  party.iwc = p.loc(E3P.IWC);
  party.outLoc = p.loc(E3P.P_LOC);
  party.locInSec = p.loc(E3P.LOC_IN_SEC);
  readVehicles(party.boats, p, E3P.BOATS, defaults.boats);
  readVehicles(party.horses, p, E3P.HORSES, defaults.horses);
  party.inBoat = inVehicle(p.i16(E3P.IN_BOAT), defaults.boats);
  party.inHorse = inVehicle(p.i16(E3P.IN_HORSE), defaults.horses);
  for (let i = 0; i < 4; i++) party.imprisonedMonst[i] = p.i16(E3P.IMPRISONED_MONST + 2 * i);
  for (let m = 0; m < 256; m++) if (p.u8(E3P.M_SEEN + m) !== 0) party.mSeen.add(m);
  party.totalMKilled = p.i32(E3P.TOTAL_M_KILLED);
  party.totalDamDone = p.i32(E3P.TOTAL_DAM_DONE);
  party.totalXpGained = p.i32(E3P.TOTAL_XP_GAINED);
  party.totalDamTaken = p.i32(E3P.TOTAL_DAM_TAKEN);
  party.direction = p.i16(E3P.DIRECTION);
  for (let k = 0; k < party.alchemy.length; k++) party.alchemy[k] = k < 17 && p.u8(E3P.ALCHEMY + k) !== 0;
  party.e3Jobs = {
    boards: Array.from({ length: E3_JOB_BANKS }, (_, bank) => Array.from({ length: E3_JOBS_PER_BOARD },
      (_, j) => readJob(p, E3P.JOB_BOARDS + bank * 0x30 + j * 0xc))),
    held: Array.from({ length: E3_JOBS_HELD }, (_, j) => readJob(p, E3P.JOBS_HELD + j * 0xc)),
    failed: Array.from({ length: E3_JOB_BANKS }, (_, bank) => p.u8(E3P.JOBS_FAILED + bank) !== 0),
  };
  for (let k = 0; k < 20; k++) {
    const day = p.i16(E3P.KEY_TIMES + 2 * k);
    if (day !== E3P.KEY_TIME_NEVER) party.keyTimes.set(k + 1, day);
  }
  // The converter's town states, which E3 works out on entering the town.
  // TODO(e3save): its other flags (one-shot spots, daily stamps, day counts).
  TOWN_STATES.forEach((g, k) => {
    let state = 0;
    g.days.forEach((day, i) => {
      const t = e3DayReached(day, g.event);
      if (party.dayReached(t.day, t.event)) state = i + 1;
    });
    party.setSdf(...e3TownState(k), state);
  });

  save.pcs.forEach((rec, i) => readPc(univ, party.pcs[i]!, rec, defaults, warnings));

  if (save.maps) readMaps(save.maps, scenario);
  let town: E3Import['town'] = null;
  if (save.town) {
    const c = new E3Bytes(save.town.cTown);
    let num = c.i16(E3CTOWN.TOWN_NUM);
    const loc = c.loc(E3CTOWN.P_LOC);
    // The town's squares seen so far, which E3 folds into its map only on
    // leaving: into the record's map here, which entering it reads back.
    const record = scenario.towns[num];
    if (record) {
      for (let x = 0; x < Math.min(64, record.maxDim); x++) {
        for (let y = 0; y < Math.min(64, record.maxDim); y++) {
          if (c.u8(E3CTOWN.EXPLORED + x * 64 + y) & 1) record.maps[x]![y] = 1;
        }
      }
    }
    // A declining town's later records are the first one's `<town-flag>`.
    TOWN_STATES.forEach((g, k) => {
      if (num >= g.town && num < g.town + 4) {
        party.setSdf(...e3TownState(k), num - g.town);
        num = g.town;
      }
    });
    // TODO(e3save): c_town's creatures and t_i's items, instead of a fresh town.
    town = { num, loc, decals: save.sfx };
    warnings.push('The town is entered afresh: its creatures and items are not read from the save yet.');
  }
  party.townNum = TOWN_NUM_OUTDOORS;
  univ.town = null;
  // The last game's window goes, or its squares would land in this one's zones.
  for (const col of univ.out.explored) col.fill(0);
  univ.out.build();
  // `out_e`, the window as it was: a save without maps has only this, and
  // one with them may hold squares seen since the window last moved. Folded
  // into the zones, so they stay when the window slides off and back.
  for (let x = 0; x < OUT_MAX_DIM; x++) {
    for (let y = 0; y < OUT_MAX_DIM; y++) if (save.outExplored[x * OUT_MAX_DIM + y]) univ.out.explored[x]![y] = 1;
  }
  univ.out.saveMaps();
  return { town, warnings };
}

/** Every town's and zone's explored squares, from the save's map blocks. */
function readMaps(maps: NonNullable<E3Save['maps']>, scenario: Scenario): void {
  scenario.towns.forEach((town, t) => {
    const where = e3TownMapAt(t);
    if (!where) return;
    const block = maps[where.block];
    const dim = Math.min(where.dim, town.maxDim);
    for (let x = 0; x < dim; x++) {
      for (let y = 0; y < dim; y++) {
        const [at, bit] = e3MapBit(where.at, where.dim, x, y);
        town.maps[x]![y] = (block[at]! & bit) !== 0 ? 1 : 0;
      }
    }
  });
  for (let zx = 0; zx < Math.min(E3_ZONES_ACROSS, scenario.outWidth); zx++) {
    for (let zy = 0; zy < scenario.outHeight; zy++) {
      const sector = scenario.outdoors[zx]![zy]!;
      const base = (zy * E3_ZONES_ACROSS + zx) * E3_ZONE_MAP_SIZE;
      if (base + E3_ZONE_MAP_SIZE > maps.zones.length) continue;
      for (let x = 0; x < SECTOR_SIZE; x++) {
        for (let y = 0; y < SECTOR_SIZE; y++) {
          const [at, bit] = e3MapBit(base, SECTOR_SIZE, x, y);
          sector.maps[x]![y] = (maps.zones[at]! & bit) !== 0 ? 1 : 0;
        }
      }
    }
  }
}

export function applyE3Save(data: Uint8Array, univ: Universe, defaults: E3SaveDefaults): E3Import {
  return applyE3SaveRecord(readE3Save(data), univ, defaults);
}

/**
 * A town saved by E3, entered afresh (`E3Import.town`), with the stains the
 * save holds in place of the ones it was entered with: the blood and slime
 * the dead left, the ash, bones and rubble. E3's `sfx` byte has a bit for
 * each, in the engine's order from `SFX_SMALL_BLOOD` (`e3SaveTown.ts`
 * writes the same).
 */
export function applyE3TownDecals(univ: Universe, decals: Uint8Array): void {
  const town = univ.town;
  if (!town) return;
  const dim = Math.min(64, town.record.maxDim);
  for (let x = 0; x < dim; x++) {
    for (let y = 0; y < dim; y++) {
      const bits = decals[64 * x + y] ?? 0;
      for (let k = 0; k < 8; k++) town.setField(x, y, FieldType.SFX_SMALL_BLOOD + k, false);
      for (let k = 0; k < 8; k++) if (bits & (1 << k)) town.setField(x, y, FieldType.SFX_SMALL_BLOOD + k);
    }
  }
}
