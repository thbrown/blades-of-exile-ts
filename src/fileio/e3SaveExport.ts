/**
 * Writing the converted Exile III's game as Exile III's own save
 * (`exile3.sav`), so a state reached here can be loaded into the original:
 * the inverse of `e3SaveImport.ts`, over a party record built as E3's
 * `init_party` (`FUN_10b0_053c`) builds a new game's.
 *
 * **In town** E3 also saves `c_town`, `t_d` and `t_i`, the whole town as
 * loaded and played, and its fields; `e3SaveTown.ts` writes them from the
 * town the party stands in. A copy converted before TOWN.DAT went into
 * `e3save.json`, or a place that isn't one of E3's towns, is saved on the
 * outdoor square the party entered from (the party record keeps it, as
 * BoE's does), with a warning.
 *
 * The rest of what this leaves at E3's new-game values is the import's list
 * (`e3SaveImport.ts`), marked the same way here.
 */

import type { Item } from '../data/item';
import { E3_STASHES, vehicleNumbers } from '../../tools/e3convert/tables';
import {
  E3Bytes, E3ITEM, E3P, E3PC, E3_OUT_MAPS_SIZE, E3_TOWN_MAPS_SIZE, E3_VILLAGE_MAPS_SIZE, E3_ZONES_ACROSS,
  E3_ZONE_MAP_SIZE, e3MapBit, e3TownMapAt, emptyE3Save, writeE3Save, type E3Save,
} from './e3save';
import { SECTOR_SIZE } from '../data/outdoors';
import { OUT_MAX_DIM } from '../universe/curOut';
import {
  e3ItemFromTable, e3ItemGraphic, e3TableItemCount, e3TableItemName, E3_TABLE_ITEM_SIZE, unenchantedName,
  type E3SaveDefaults,
} from './e3SaveDefaults';
import { E3_LIST_WHICH_TOWN, E3_MAGIC_SHOPS, E3_MAGIC_SHOP_SLOTS, e3VehicleTable } from './e3SaveImport';
import type { Vehicle } from '../data/vehicle';
import { e3Jobs, e3JobsBase, type E3Job } from '../game/e3Jobs';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { e3CreatureList, e3ItemList, e3TownBlocks, e3TownData, e3TownSpots } from './e3SaveTown';
import { writeE3Notes } from './e3SaveNotes';
import type { Player } from '../universe/player';
import { NUM_INVEN_SLOTS, NUM_SPELLS } from '../universe/player';
import { NUM_SKILLS, Race, Trait } from '../universe/skills';
import type { Universe } from '../universe/universe';

export interface E3Export {
  bytes: Uint8Array;
  warnings: string[];
}

/** The party record of a new game, before the PCs and the dice (`init_party`). */
export function newE3PartyRecord(defaults: E3SaveDefaults): Uint8Array {
  const p = new E3Bytes(new Uint8Array(E3P.KEY_TIMES + 40));
  p.setI32(E3P.GOLD, 200);
  p.setI32(E3P.FOOD, 100);
  p.setI16(E3P.SPEC_ITEMS, 1);
  p.setI16(E3P.SPEC_ITEMS + 2, 1);
  // `init_party` sets bytes 0xc5a–0xc63 and 0xc7e: flags (303, 0–9) and (306, 6).
  for (let i = 0; i < 10; i++) p.setU8(0xc5a + i, 1);
  p.setU8(0xc7e, 1);
  p.setLoc(E3P.OUTDOOR_CORNER, { x: 7, y: 8 });
  p.setLoc(E3P.IWC, { x: 1, y: 1 });
  p.setLoc(E3P.P_LOC, { x: 0x54, y: 0x54 });
  p.setLoc(E3P.LOC_IN_SEC, { x: 0x24, y: 0x24 });
  // Every vehicle slot gets `DS:2bca`/`2bd4` (town 200), and then
  // `FUN_10b0_0b7c` copies E3's tables over every slot not in use.
  for (let k = 0; k < 30; k++) {
    for (const [at, table] of [[E3P.BOATS, defaults.boats], [E3P.HORSES, defaults.horses]] as const) {
      const exists = table[10 * k + 8] !== 0;
      if (exists) p.data.set(table.subarray(10 * k, 10 * k + 10), at + 10 * k);
      else p.setI16(at + 10 * k + 6, 200);
    }
  }
  for (let i = 0; i < 4; i++) p.setI16(E3P.CREATURE_SAVE + i * E3P.CREATURE_LIST_SIZE + 0x1590, 200);
  // FUN_1070_41a4 rolls the magic shops' stock here, and FUN_1008_3c91 the
  // job boards; the jobs are the game's, below.
  // TODO(e3save): out_c. The shops' stock, creature_save and setup are the game's, below.
  p.setU8(E3P.M_SEEN + 0x26, 1);
  p.setU8(E3P.M_SEEN + 0x28, 1);
  p.setU8(E3P.M_SEEN + 0x4e, 1);
  p.setU8(E3P.JOURNAL_STR, 1);
  p.setI16(E3P.JOURNAL_DAY, 1);
  for (let i = 0; i < 120; i++) p.setI16(E3P.TALK_SAVE + 7 * i, -1);
  p.data.set(defaults.canFind.subarray(0, E3P.CAN_FIND_TOWNS), E3P.CAN_FIND_TOWN);
  for (let k = 0; k < 20; k++) p.setI16(E3P.KEY_TIMES + 2 * k, E3P.KEY_TIME_NEVER);
  return p.data;
}

/**
 * The E3 table record an item came from: same full name (or, enchanted, its
 * plain name) and kind, then the best of those by E3 ability and picture.
 * -1 if none.
 */
function e3ItemIndex(defaults: E3SaveDefaults, item: Item): number {
  if (item.e3Item >= 0 && item.e3Item < e3TableItemCount(defaults)) return item.e3Item;
  const graphic = e3ItemGraphic(item.graphicNum);
  for (const name of [item.fullName, unenchantedName(item.fullName)]) {
    let best = -1, bestScore = -1;
    for (let k = 0; k < e3TableItemCount(defaults); k++) {
      const t = new E3Bytes(defaults.itemTable.subarray(k * E3_TABLE_ITEM_SIZE, (k + 1) * E3_TABLE_ITEM_SIZE));
      if (t.i16(0) !== item.variety || e3TableItemName(defaults, k) !== name) continue;
      const score = (item.e3Ability < 0 || t.u8(10) === item.e3Ability ? 2 : 0) + (t.u8(9) === graphic ? 1 : 0);
      if (score > bestScore) { best = k; bestScore = score; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** An item as E3 holds it, or null if E3 has no such item. */
export function itemToE3(defaults: E3SaveDefaults, item: Item): Uint8Array | null {
  const k = e3ItemIndex(defaults, item);
  if (k < 0) return null;
  const rec = e3ItemFromTable(defaults, k);
  const b = new E3Bytes(rec);
  // A scripted variant keeps its own ability (a stamped item: notes.ts).
  if (item.e3Ability >= 0) b.setU8(E3ITEM.ABILITY, item.e3Ability);
  if (e3ItemGraphic(item.graphicNum) >= 0) b.setU8(E3ITEM.GRAPHIC, e3ItemGraphic(item.graphicNum));
  b.setI16(E3ITEM.LEVEL, item.itemLevel);
  b.setU8(E3ITEM.AWKWARD, item.awkward);
  b.setU8(E3ITEM.BONUS, item.bonus);
  b.setU8(E3ITEM.PROTECTION, item.protection);
  b.setU8(E3ITEM.CHARGES, item.charges);
  b.setI16(E3ITEM.VALUE, item.value);
  b.setU8(E3ITEM.WEIGHT, item.weight);
  b.setU8(E3ITEM.IDENTIFIED, item.ident ? 1 : 0);
  b.setU8(E3ITEM.MAGIC, item.magic ? 1 : 0);
  b.setStr(E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN, item.fullName);
  b.setStr(E3ITEM.NAME, E3ITEM.NAME_LEN, item.name);
  return rec;
}

function writePc(defaults: E3SaveDefaults, pc: Player, warnings: string[]): Uint8Array {
  const b = new E3Bytes(new Uint8Array(E3PC.DIRECTION + 2));
  b.setI16(E3PC.MAIN_STATUS, pc.mainStatus);
  b.setStr(E3PC.NAME, E3PC.NAME_LEN, pc.name);
  for (let i = 0; i < NUM_SKILLS; i++) b.setI16(E3PC.SKILLS + 2 * i, pc.skills[i] ?? 0);
  b.setI16(E3PC.MAX_HEALTH, pc.maxHealth);
  b.setI16(E3PC.CUR_HEALTH, pc.curHealth);
  b.setI16(E3PC.MAX_SP, pc.maxSp);
  b.setI16(E3PC.CUR_SP, pc.curSp);
  b.setI16(E3PC.EXPERIENCE, pc.experience);
  b.setI16(E3PC.SKILL_PTS, pc.skillPts);
  b.setI16(E3PC.LEVEL, pc.level);
  for (let i = 0; i < 15; i++) b.setI16(E3PC.STATUS + 2 * i, pc.status[i] ?? 0);
  // E3 leaves the last poisoned slot here, and a new PC has 0.
  let poisoned = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (item.variety === 0) continue;
    const rec = itemToE3(defaults, item);
    if (rec === null) {
      warnings.push(`${pc.name}'s "${item.fullName}" isn't one of Exile III's items, and was left out.`);
      continue;
    }
    b.data.set(rec, E3PC.ITEMS + i * E3ITEM.SIZE);
    b.setU8(E3PC.EQUIP + i, pc.equip[i] ? 1 : 0);
    if (pc.weapPoisoned === item) poisoned = i;
  }
  for (let i = 0; i < NUM_SPELLS; i++) {
    b.setU8(E3PC.PRIEST_SPELLS + i, pc.priestSpells[i] ? 1 : 0);
    b.setU8(E3PC.MAGE_SPELLS + i, pc.mageSpells[i] ? 1 : 0);
  }
  b.setI16(E3PC.WHICH_GRAPHIC, pc.whichGraphic);
  b.setI16(E3PC.WEAP_POISONED, poisoned);
  // E3's PC has fifteen traits and three races. Blades of Exile's Pacifist
  // and Anama Member have no slot, and a Vahnatai would be race 3, past the
  // end of E3's tables, so it goes as human.
  for (let i = 0; i < 15; i++) b.setU8(E3PC.TRAITS + i, pc.traits[i] ? 1 : 0);
  for (const [t, name] of [[Trait.PACIFIST, 'a Pacifist'], [Trait.ANAMA, 'an Anama Member']] as const) {
    if (pc.traits[t]) warnings.push(`${pc.name} is ${name}, which Exile III doesn't have; it was left out.`);
  }
  const e3Race = pc.race >= Race.HUMAN && pc.race <= Race.SLITH ? pc.race : Race.HUMAN;
  if (e3Race !== pc.race) warnings.push(`${pc.name} isn't a species Exile III has, and goes as a human.`);
  b.setI16(E3PC.RACE, e3Race);
  b.setI16(E3PC.EXP_ADJ, pc.expAdj);
  b.setI16(E3PC.DIRECTION, pc.direction);
  return b.data;
}

/** The four towns the party remembers (`readRemembered`, in `e3SaveImport.ts`). */
function writeRemembered(univ: Universe, save: E3Save, defaults: E3SaveDefaults, warnings: string[]): void {
  const { party } = univ;
  const p = new E3Bytes(save.party);
  const { townDat, monsterTable } = defaults;
  p.setI16(E3P.AT_WHICH_SAVE_SLOT, party.atWhichSaveSlot);
  party.creatureSave.forEach((pop, k) => {
    const at = E3P.CREATURE_SAVE + k * E3P.CREATURE_LIST_SIZE;
    if (pop.whichTown < 0 || pop.whichTown >= 200) return;
    if (!townDat || !monsterTable) {
      if (k === 0) warnings.push('The towns the party remembers need a newer copy of Exile III; they were left out.');
      return;
    }
    p.data.set(e3CreatureList(univ, monsterTable, e3TownData(townDat, pop.whichTown, () => 0), pop.monsters, warnings), at);
    p.setI16(at + E3_LIST_WHICH_TOWN, pop.whichTown);
    p.setI16(at + E3_LIST_WHICH_TOWN + 2, pop.hostile ? 1 : 0);
    // The fields as the engine keeps them (the same bits as E3's `misc_i`),
    // and a special square's bit for each spot not yet run.
    const setup = party.setup[k] ?? [];
    for (let x = 0; x < Math.min(64, setup.length); x++) {
      for (let y = 0; y < Math.min(64, setup[x]!.length); y++) save.setup[k * 4096 + 64 * x + y] = setup[x]![y]! & ~2;
    }
    for (const { x, y, flag } of e3TownSpots(townDat, pop.whichTown)) {
      if (party.getSdf(...flag) === 0) save.setup[k * 4096 + 64 * x + y] = save.setup[k * 4096 + 64 * x + y]! | 2;
    }
  });
}

function writeVehicles(list: Vehicle[], p: E3Bytes, at: number, table: Uint8Array): void {
  vehicleNumbers(e3VehicleTable(table)).forEach((n, k) => {
    const v = list[n];
    if (n < 0 || v === undefined) return;
    const r = at + 10 * k;
    p.setI16(r + 6, v.whichTown);
    if (v.whichTown === TOWN_NUM_OUTDOORS) {
      p.setLoc(r + 2, v.loc);
      p.setLoc(r + 4, v.sector);
    } else {
      p.setLoc(r, v.loc);
    }
    p.setU8(r + 8, v.exists ? 1 : 0);
    p.setU8(r + 9, v.property ? 1 : 0);
  });
}

function outVehicle(n: number, table: Uint8Array): number {
  return n < 0 ? 0 : Math.max(0, vehicleNumbers(e3VehicleTable(table)).indexOf(n));
}

function writeJob(p: E3Bytes, at: number, j: E3Job): void {
  p.setI16(at, j.kind);
  p.setI16(at + 4, j.extra);
  p.setI16(at + 6, j.days);
  p.setI16(at + 8, j.target);
  p.setI16(at + 10, j.bank);
}

export function e3SaveRecordFromGame(univ: Universe, defaults: E3SaveDefaults): { save: E3Save; warnings: string[] } {
  const warnings: string[] = [];
  const { party, scenario } = univ;
  const save = emptyE3Save();
  save.party = newE3PartyRecord(defaults);
  const p = new E3Bytes(save.party);
  if (party.townNum !== TOWN_NUM_OUTDOORS) {
    const town = e3TownBlocks(univ, defaults, (item) => itemToE3(defaults, item), warnings);
    if (typeof town === 'string') {
      warnings.push(`Saved outdoors, on the square the party entered the town from: ${town}.`);
    } else {
      save.inTown = true;
      save.town = { cTown: town.cTown, data: town.data, items: town.items };
      save.miscI = town.miscI;
      save.sfx = town.sfx;
    }
  }
  p.setI32(E3P.AGE, party.age);
  p.setI32(E3P.GOLD, party.gold);
  p.setI32(E3P.FOOD, party.food);
  for (let k = 0; k < 60; k++) p.setI16(E3P.SPEC_ITEMS + 2 * k, party.specItems.has(k) ? 1 : 0);
  for (let row = 0; row < E3P.FLAG_ROWS; row++) {
    for (let col = 0; col < 10; col++) {
      const v = party.stuffDone[row]![col]!;
      // Rows 300 on hold what `init_party` set, which no script here does.
      if (row < 300 || v !== 0) p.setU8(E3P.FLAGS + row * 10 + col, v);
    }
  }
  for (let t = 0; t < Math.min(200, scenario.towns.length); t++) {
    const town = scenario.towns[t]!;
    for (let i = 0; i < 64 && i < town.itemTaken.length; i++) {
      if (town.itemTaken[i]) p.setU8(E3P.ITEM_TAKEN + t * 8 + (i >> 3), p.u8(E3P.ITEM_TAKEN + t * 8 + (i >> 3)) | (1 << (i & 7)));
    }
    p.setI16(E3P.M_KILLED + 2 * t, town.monstersKilled);
    if (t < E3P.CAN_FIND_TOWNS) p.setU8(E3P.CAN_FIND_TOWN + t, town.canFind ? 1 : 0);
  }
  p.setI16(E3P.LIGHT_LEVEL, party.lightLevel);
  p.setLoc(E3P.OUTDOOR_CORNER, party.outdoorCorner);
  p.setLoc(E3P.IWC, party.iwc);
  p.setLoc(E3P.P_LOC, party.outLoc);
  p.setLoc(E3P.LOC_IN_SEC, party.locInSec);
  writeVehicles(party.boats, p, E3P.BOATS, defaults.boats);
  writeVehicles(party.horses, p, E3P.HORSES, defaults.horses);
  p.setI16(E3P.IN_BOAT, outVehicle(party.inBoat, defaults.boats));
  p.setI16(E3P.IN_HORSE, outVehicle(party.inHorse, defaults.horses));
  for (let i = 0; i < 4; i++) p.setI16(E3P.IMPRISONED_MONST + 2 * i, party.imprisonedMonst[i] ?? 0);
  for (const m of party.mSeen) if (m >= 0 && m < 256) p.setU8(E3P.M_SEEN + m, 1);
  p.setI32(E3P.TOTAL_M_KILLED, party.totalMKilled);
  p.setI32(E3P.TOTAL_DAM_DONE, party.totalDamDone);
  p.setI32(E3P.TOTAL_XP_GAINED, party.totalXpGained);
  p.setI32(E3P.TOTAL_DAM_TAKEN, party.totalDamTaken);
  p.setI16(E3P.DIRECTION, party.direction);
  for (let k = 0; k < 17; k++) p.setU8(E3P.ALCHEMY + k, party.alchemy[k] ? 1 : 0);
  // E3 fills the boards when it makes a party; this port waits until a board
  // is first looked at (`e3Jobs`). A party that never looked would go out
  // with six empty boards, and E3 only refills them every 4,000 ticks — so
  // they are filled now, and the game keeps the boards it exported.
  const jobs = e3JobsBase(univ) !== null ? e3Jobs(univ) : party.e3Jobs;
  if (jobs) {
    jobs.boards.forEach((board, bank) => board.forEach((j, k) => writeJob(p, E3P.JOB_BOARDS + bank * 0x30 + k * 0xc, j)));
    jobs.held.forEach((j, k) => writeJob(p, E3P.JOBS_HELD + k * 0xc, j));
    jobs.failed.forEach((f, bank) => p.setU8(E3P.JOBS_FAILED + bank, f ? 1 : 0));
  }
  for (const [key, day] of party.keyTimes) {
    if (key >= 1 && key <= 20) p.setI16(E3P.KEY_TIMES + 2 * (key - 1), day);
  }
  writeE3Notes(univ, p, defaults, warnings);
  writeRemembered(univ, save, defaults, warnings);
  for (let i = 0; i < E3_MAGIC_SHOPS; i++) {
    for (let j = 0; j < E3_MAGIC_SHOP_SLOTS; j++) {
      const item = univ.storeItem(i, j);
      const rec = item.variety === 0 ? null : itemToE3(defaults, item);
      if (rec) p.data.set(rec, E3P.MAGIC_STORE_ITEMS + E3ITEM.SIZE * (E3_MAGIC_SHOP_SLOTS * i + j));
      else if (item.variety !== 0) warnings.push(`The "${item.fullName}" in a magic shop isn't one of Exile III's items, and was left out.`);
    }
  }
  save.storedItems = E3_STASHES.map((st) => e3ItemList(party.storedItems.get(st.town) ?? [], (item) => itemToE3(defaults, item),
    warnings, `left in ${scenario.towns[st.town]?.name ?? 'a town'}`));
  save.pcs = party.pcs.slice(0, 6).map((pc) => writePc(defaults, pc, warnings));
  // E3's new PC knows `DS:296c`/`294e`'s spells; an absent slot keeps them.
  save.pcs.forEach((rec, i) => {
    if (party.pcs[i]!.mainStatus !== 0) return;
    rec.set(defaults.priestSpells.subarray(0, 30), E3PC.PRIEST_SPELLS);
    rec.set(defaults.mageSpells.subarray(0, 30), E3PC.MAGE_SPELLS);
  });
  writeMaps(univ, save);
  return { save, warnings };
}

/**
 * The explored squares: `out_e` from the outdoor window, and every town's and
 * zone's map, which E3 saves when its "save maps" preference is on (its
 * default, as BoE's). A town the party stands in has its squares only in
 * `univ.town` until it leaves, so they're added here.
 */
function writeMaps(univ: Universe, save: E3Save): void {
  const { scenario } = univ;
  // `out_e` holds its four zones' maps as well, since E3 pulls them in
  // whenever the window is built (`add_outdoor_maps`), so a load here and a
  // save again write the same bytes.
  const c = univ.party.outdoorCorner;
  for (let x = 0; x < OUT_MAX_DIM; x++) {
    for (let y = 0; y < OUT_MAX_DIM; y++) {
      const zone = scenario.outdoors[c.x + Math.floor(x / SECTOR_SIZE)]?.[c.y + Math.floor(y / SECTOR_SIZE)];
      if (univ.out.explored[x]![y] || zone?.maps[x % SECTOR_SIZE]![y % SECTOR_SIZE]) save.outExplored[x * OUT_MAX_DIM + y] = 1;
    }
  }
  const maps = {
    towns: new Uint8Array(E3_TOWN_MAPS_SIZE),
    zones: new Uint8Array(E3_OUT_MAPS_SIZE),
    villages: new Uint8Array(E3_VILLAGE_MAPS_SIZE),
  };
  const here = univ.party.townNum === TOWN_NUM_OUTDOORS ? null : univ.town;
  scenario.towns.forEach((town, t) => {
    const where = e3TownMapAt(t);
    if (!where) return;
    const live = here?.record === town ? here.explored : null;
    const dim = Math.min(where.dim, town.maxDim);
    for (let x = 0; x < dim; x++) {
      for (let y = 0; y < dim; y++) {
        if (!town.maps[x]![y] && !live?.[x]?.[y]) continue;
        const [at, bit] = e3MapBit(where.at, where.dim, x, y);
        maps[where.block][at]! |= bit;
      }
    }
  });
  // The window's squares count for its zones too, as `save_outdoor_maps`
  // would fold them in when it next moves.
  for (let zx = 0; zx < Math.min(E3_ZONES_ACROSS, scenario.outWidth); zx++) {
    for (let zy = 0; zy < scenario.outHeight; zy++) {
      const sector = scenario.outdoors[zx]![zy]!;
      const base = (zy * E3_ZONES_ACROSS + zx) * E3_ZONE_MAP_SIZE;
      if (base + E3_ZONE_MAP_SIZE > maps.zones.length) continue;
      const ox = (zx - c.x) * SECTOR_SIZE, oy = (zy - c.y) * SECTOR_SIZE;
      const inWindow = ox >= 0 && oy >= 0 && ox < OUT_MAX_DIM && oy < OUT_MAX_DIM;
      for (let x = 0; x < SECTOR_SIZE; x++) {
        for (let y = 0; y < SECTOR_SIZE; y++) {
          if (!sector.maps[x]![y] && !(inWindow && univ.out.explored[ox + x]![oy + y])) continue;
          const [at, bit] = e3MapBit(base, SECTOR_SIZE, x, y);
          maps.zones[at]! |= bit;
        }
      }
    }
  }
  save.maps = maps;
}

export function exportE3Save(univ: Universe, defaults: E3SaveDefaults): E3Export {
  const { save, warnings } = e3SaveRecordFromGame(univ, defaults);
  return { bytes: writeE3Save(save), warnings };
}
