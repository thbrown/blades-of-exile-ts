/**
 * Legacy `.exs` scenarios — `load_scenario_v1`, `load_town_v1` and
 * `load_outdoors_v1` (fileio_scen.cpp:248, 2492, 2600), building the same
 * model `loadScenario` builds from a v2 scenario.
 *
 * **What this matches.** OBoE plays a legacy scenario by importing it straight
 * into memory — no trip through its XML — and keeps `is_legacy` set, so the
 * few rules that differ for old scenarios keep their old behaviour. This does
 * the same, shape for shape: fifty special spots with the unused ones parked
 * at `LOC_UNUSED`, twenty scenario timers, every talk node, and so on. That is
 * checkable: `tools/cppharness/dump-scen.sh` prints what the C++ builds from a
 * file, and `test/legacyImport.test.ts` holds this against it for every `.exs`
 * it can find.
 *
 * The bundled four are *not* the oracle, though they started as `.exs` files:
 * OBoE's developers re-saved them and then kept editing — new item
 * descriptions, merged shops, rewritten dialogue, repainted terrain.
 *
 * **The size table.** The file locates each sector and town by summing the
 * sizes the header records (`get_town_offset`). 166 of the 168 archive
 * scenarios have a table that adds up to the file exactly; the copies in the
 * 1997 Windows code release don't, and OBoE can't open those either.
 */

import { FieldType } from '../../data/fields';
import { Item, ItemType } from '../../data/item';
import { Scenario } from '../../data/scenario';
import { captureScenarioState } from '../../data/scenarioState';
import { SECTOR_SIZE, Sector } from '../../data/outdoors';
import { makeSpecItem } from '../../data/quest';
import {
  INFINITE_AMOUNT, Shop, ShopItemType, ShopPreset, ShopPrompt, ShopType, presetShop,
} from '../../data/shop';
import { SpecType, SpecialNode, emptySpecialNode } from '../../data/special';
import { Speech, emptySpeech } from '../../data/talking';
import { Terrain } from '../../data/terrain';
import { PresetField, Town } from '../../data/town';
import { Vehicle, makeVehicle } from '../../data/vehicle';
import { setUpLights } from '../../game/lighting';
import {
  ImportWarn, LEGACY_ROAD, LEGACY_SPECIAL_SPOT, ShopInfo, convertItem, convertMonster,
  convertOutWandering, convertPresetField, convertSpecial, convertTalkNodes, convertTerrain,
  convertTownperson,
} from './convert';
import {
  LegacyCharset, LegacyReader, LegacyScenario, TOWN_SIZES, readItemData, readOutdoor,
  readScenarioData, readTalk, readTown, readTownDetail,
} from './structs';

/** sizeof(scenario_header_flags). */
const HEADER_BYTES = 12;
const SCENARIO_BYTES = 41930;
const ITEM_DATA_BYTES = 39200;

/** `LOC_UNUSED` (area.hpp: AREA_HUGE * 2) — a location slot that isn't in use. */
export const LOC_UNUSED = 256;

/** Which platform wrote a legacy file, from its four flag bytes; null if it isn't one. */
export function legacyPlatform(data: Uint8Array): 'mac' | 'windows' | null {
  const [a, b, c, d] = data;
  if (a === 10 && b === 20 && c === 30 && d === 40) return 'mac';
  if (a === 20 && b === 40 && c === 60 && d === 80) return 'windows';
  return null;
}

export interface LegacyImport {
  scenario: Scenario;
  /** What the C++ would have shown as warnings while loading. */
  warnings: string[];
}

export interface LegacyOptions {
  /**
   * How to read the file's 8-bit text. The platform's own character set by
   * default; `latin1` lets a test compare byte for byte with the C++, which
   * keeps the raw bytes.
   */
  charset?: LegacyCharset;
}

/** `load_scenario_v1`. Throws with a reason if the file can't be read. */
export function loadLegacyScenario(data: Uint8Array, id: string, opts: LegacyOptions = {}): LegacyImport {
  const platform = legacyPlatform(data);
  if (platform === null) throw new Error('This is not a legitimate Blades of Exile scenario.');
  const isMac = platform === 'mac';
  const warnings: string[] = [];
  const warn: ImportWarn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  const r = new LegacyReader(data, isMac, opts.charset ?? 'platform');
  const numTowns = data[11]!;
  r.pos = HEADER_BYTES;
  const old = readScenarioData(r);
  const itemData = readItemData(r);

  // ---- cScenario::import_legacy(scenario_data_type)
  const terMarks: number[] = [];
  const terTypes: Terrain[] = old.terTypes.map((t, i) => {
    const { ter, mark } = convertTerrain(t, i);
    terMarks.push(mark);
    return ter;
  });
  const scenMonsters = old.monsters.map(convertMonster);
  const scenSpecials = specialMap(old.specials.map((s) => convertSpecial(s, warn)));

  // ---- cScenario::import_legacy(scen_item_data_type)
  const scenItems = itemData.items.map(convertItem);
  scenMonsters.forEach((mon, i) => {
    mon.name = itemData.monstNames[i]!;
    if (mon.race === 11 /* UNDEAD */ && mon.name.includes('Skeleton')) mon.race = 20; // SKELETAL
    if (mon.race === 9 /* HUMANOID */ && mon.name.includes('Goblin')) mon.race = 21; // GOBLIN
  });
  terTypes.forEach((ter, i) => { ter.name = itemData.terNames[i]!; });

  // ---- the scenario strings: 270 read, of 300 counted
  const strs: string[] = [];
  const tempStr = new Uint8Array(256);
  for (let i = 0; i < 270; i++) strs.push(r.lstr(old.scenStrLen[i]!, tempStr));
  // "scenario.ter_types[23].fly_over = false" — once everything else is in.
  terTypes[23]!.flyOver = false;

  const scen: Scenario = {
    id,
    title: strs[0]!,
    teasers: [strs[1]!, strs[2]!],
    introMsgs: strs.slice(4, 10),
    introPic: old.introPic,
    numTowns,
    outWidth: old.outWidth,
    outHeight: old.outHeight,
    startTown: old.whichTownStart,
    difficulty: old.difficulty,
    adjustDiff: true,
    featureFlags: {},
    isLegacy: true,
    townStart: { ...old.whereStart },
    outdoorStart: { ...old.outSecStart },
    sectorStart: { ...old.outStart },
    terTypes,
    scenItems,
    scenMonsters,
    towns: [],
    townTalk: [],
    outdoors: [],
    scenSpecials,
    shops: [],
    specialItems: Array.from({ length: 50 }, (_, i) => {
      const item = makeSpecItem();
      item.flags = old.specialItems[i]!;
      item.special = old.specialItemSpecial[i]!;
      item.name = strs[60 + i * 2]!;
      item.descr = strs[61 + i * 2]!;
      return item;
    }),
    quests: [],
    scenarioTimers: old.scenarioTimerTimes.map((time, i) => ({ time, node: old.scenarioTimerSpecs[i]! })),
    initSpec: -1,
    specStrs: strs.slice(160, 260),
    townMods: old.townToAddTo.map((spec, i) => ({
      spec, x: old.flagToAddToTown[i]![0]!, y: old.flagToAddToTown[i]![1]!,
    })),
    storeItemRects: storeItemRects(old),
    boats: legacyVehicles(old.boats),
    horses: legacyVehicles(old.horses),
  };

  // ---- load_outdoors_v1, sector by sector (`get_outdoors_offset`)
  const outBase = HEADER_BYTES + SCENARIO_BYTES + ITEM_DATA_BYTES
    + old.scenStrLen.reduce((a, b) => a + b, 0);
  for (let x = 0; x < old.outWidth; x++) {
    scen.outdoors.push([]);
    for (let y = 0; y < old.outHeight; y++) {
      const secNum = old.outWidth * y + x;
      r.pos = outBase;
      for (let i = 0; i < secNum; i++) r.pos += old.outDataSize[i]![0]! + old.outDataSize[i]![1]!;
      scen.outdoors[x]!.push(loadOutdoor(r, terTypes, terMarks, warn));
    }
  }

  // ---- load_town_v1, town by town (`get_town_offset`)
  const shops: ShopInfo[] = [];
  let townAt = outBase;
  for (let i = 0; i < 100; i++) townAt += old.outDataSize[i]![0]! + old.outDataSize[i]![1]!;
  for (let t = 0; t < numTowns; t++) {
    r.pos = townAt;
    for (let j = 0; j < 5; j++) townAt += old.townDataSize[t]![j]!;
    const { town, talk } = loadTown(r, t, old, terTypes, terMarks, shops, warn);
    scen.towns.push(town);
    scen.townTalk.push(talk);
  }
  // "Enable character creation in starting town"
  const start = scen.towns[scen.startTown];
  if (start !== undefined) start.hasTavern = true;

  // ---- shops: the ones special nodes describe inline, then all of them
  const portShops = (specials: Map<number, SpecialNode>, specStrs: string[]): void => {
    for (const spec of specials.values()) {
      if (spec.type === SpecType.ENTER_SHOP) portShopSpecNode(spec, shops, specStrs);
    }
  };
  portShops(scen.scenSpecials, scen.specStrs);
  // `for(cOutdoors* out : scenario.outdoors)` walks the vector2d's storage,
  // which is row by row (`w * y + x`) — so y outside, x inside.
  for (let y = 0; y < scen.outHeight; y++) {
    for (let x = 0; x < scen.outWidth; x++) {
      const sec = scen.outdoors[x]![y]!;
      portShops(sec.specials, sec.specStrs);
    }
  }
  for (const town of scen.towns) portShops(town.specials, town.specStrs);
  // cScenario::import_legacy(scen_item_data_type): five magic shops and the healer.
  for (let i = 0; i < 5; i++) scen.shops.push(presetShop(ShopPreset.JUNK));
  scen.shops.push(presetShop(ShopPreset.HEALING));
  for (const info of shops) scen.shops.push(buildShop(info, scenItems));

  scen.pristine = captureScenarioState(scen);
  return { scenario: scen, warnings };
}

/** Every node slot, as the vector holds them. */
function specialMap(nodes: SpecialNode[]): Map<number, SpecialNode> {
  return new Map(nodes.map((n, i) => [i, n]));
}

/** `store_item_rects[store_item_towns[i]] = rect` — a map by town, -1 included. */
function storeItemRects(old: LegacyScenario): Scenario['storeItemRects'] {
  const rects: Scenario['storeItemRects'] = new Map();
  old.storeItemRects.forEach((rect, i) => { rects.set(old.storeItemTowns[i]!, { ...rect }); });
  return rects;
}

/** `cVehicle::import_legacy`, for the thirty boats or the thirty horses. */
function legacyVehicles(list: LegacyScenario['boats']): Vehicle[] {
  return list.map((o) => {
    const v = makeVehicle();
    v.whichTown = o.whichTown;
    v.exists = o.exists !== 0;
    v.property = o.property !== 0;
    v.loc = o.whichTown < 200 ? { ...o.loc } : { ...o.locInSec };
    v.sector = { ...o.sector };
    return v;
  });
}

/**
 * The hill-road fix shared by `cOutdoors::import_legacy` and the town import.
 * A road running from grass up a hill used one terrain, and the new set has
 * four joins: 80 is a grass road, 81 a hill road, and 38/40/42/44 the
 * hill-and-grass joins. "It won't catch ones that sit exactly at the edge" —
 * and the bounds are 47 whatever the area's size, as in the C++.
 */
function fixHillRoad(ter: number[][], i: number, j: number, terTypes: Terrain[]): number | null {
  if (ter[i]![j] !== 81 || i <= 0 || i >= 47 || j <= 0 || j >= 47) return null;
  const joins = (connect: number): boolean => connect === 80 || terTypes[connect]?.trimType === 18; // CITY
  if (ter[i + 1]![j] === 81) return joins(ter[i - 1]![j]!) ? 44 : null;
  if (ter[i - 1]![j] === 81) return joins(ter[i + 1]![j]!) ? 40 : null;
  if (ter[i]![j + 1] === 81) return joins(ter[i]![j - 1]!) ? 42 : null;
  if (ter[i]![j - 1] === 81) return joins(ter[i]![j + 1]!) ? 38 : null;
  return null;
}

// ---------------------------------------------------------------- outdoors

function loadOutdoor(r: LegacyReader, terTypes: Terrain[], terMarks: number[], warn: ImportWarn): Sector {
  const old = readOutdoor(r);
  const sec = new Sector();
  // ---- cOutdoors::import_legacy
  sec.ambientSound = 0; // AMBIENT_NONE
  sec.outSound = 0; // cOutdoors() — the XML reader's default is -1, but nothing reads it for NONE
  for (let i = 0; i < SECTOR_SIZE; i++) {
    for (let j = 0; j < SECTOR_SIZE; j++) {
      const t = old.terrain[i]![j]!;
      sec.terrain[i]![j] = t;
      sec.specialSpot[i]![j] = terMarks[t] === LEGACY_SPECIAL_SPOT;
      sec.roads[i]![j] = terMarks[t] === LEGACY_ROAD;
      const fixed = fixHillRoad(old.terrain, i, j, terTypes);
      if (fixed !== null) sec.terrain[i]![j] = fixed;
    }
  }
  sec.specialLocs = old.specialLocs.map((l, i) => (l.x === 100
    ? { x: LOC_UNUSED, y: l.y, spec: -1 }
    : { x: l.x, y: l.y, spec: old.specialId[i]! }));
  sec.cityLocs = old.exitLocs.map((l, i) => ({ x: l.x, y: l.y, spec: old.exitDests[i]! }));
  sec.signLocs = old.signLocs.map((l) => ({ x: l.x, y: l.y, text: '' }));
  sec.areaDesc = old.infoRect.map((rect) => ({ ...rect, descr: '' }));
  sec.wandering = old.wandering.map(convertOutWandering);
  sec.specialEnc = old.specialEnc.map(convertOutWandering);
  sec.wanderingLocs = old.wanderingLocs.map((l) => ({ ...l }));
  sec.specials = specialMap(old.specials.map((s) => convertSpecial(s, warn)));

  // ---- the 108 sector strings
  sec.specStrs = new Array<string>(90).fill('');
  const tempStr = new Uint8Array(256);
  for (let i = 0; i < 108; i++) {
    const s = r.lstr(old.strlens[i]!, tempStr);
    if (i === 0) sec.name = s;
    else if (i === 9) sec.comment = s;
    else if (i < 9) sec.areaDesc[i - 1]!.descr = s;
    else if (i < 100) sec.specStrs[i - 10] = s;
    else sec.signLocs[i - 100]!.text = s;
  }
  return sec;
}

// ---------------------------------------------------------------- towns

function loadTown(
  r: LegacyReader, which: number, scen: LegacyScenario, terTypes: Terrain[], terMarks: number[],
  shops: ShopInfo[], warn: ImportWarn,
): { town: Town; talk: Speech } {
  const old = readTown(r);
  const size = scen.townSize[which]!;
  const shape = TOWN_SIZES[size];
  if (shape === undefined) throw new Error(`town ${which} has size code ${size}`);
  const detail = readTownDetail(r, size);
  const dim = shape.dim;
  const town = new Town(dim);

  // ---- cTown::import_legacy(town_record_type)
  town.townChopTime = old.townChopTime;
  town.townChopKey = old.townChopKey;
  town.startLocs = old.startLocs.map((l) => ({ ...l }));
  town.exits = old.exitLocs.map((l, i) => ({ x: l.x, y: l.y, spec: old.exitSpecs[i]! }));
  town.wanderingLocs = old.wanderingLocs.map((l) => ({ ...l }));
  town.wandering = old.wandering.map((w) => [...w]);
  town.specialLocs = old.specialLocs.map((l, i) => (l.x === 100
    ? { x: LOC_UNUSED, y: l.y, spec: -1 }
    : { x: l.x, y: l.y, spec: old.specId[i]! }));
  // A field of a type the old game didn't have keeps cField's default type.
  town.presetFields = old.presetFields.map((f): PresetField => convertPresetField(f)
    ?? { loc: { x: f.fieldLoc.x, y: f.fieldLoc.y }, type: FieldType.SPECIAL_EXPLORED });
  town.signLocs = old.signLocs.map((l) => ({ x: l.x, y: l.y, text: '' }));
  town.lightingType = old.lighting;
  town.inTownRect = { ...old.inTownRect };
  town.presetItems = old.presetItems.map((p) => ({
    loc: { ...p.itemLoc },
    code: p.itemCode,
    ability: -1, // eEnchant::NONE — `cTown::cItem::import_legacy` leaves the default
    charges: p.ability, // the legacy field is named `ability` but holds the charges
    alwaysThere: p.alwaysThere !== 0,
    property: p.property !== 0,
    contained: p.contained !== 0,
  }));
  town.maxNumMonst = old.maxNumMonst;
  town.specOnEntry = old.specOnEntry;
  town.specOnEntryIfDead = old.specOnEntryIfDead;
  town.specOnHostile = -1;
  town.timers = old.timerSpecTimes.map((time, i) => ({ time, node: old.timerSpecs[i]! }));
  const specials = old.specials.map((s) => convertSpecial(s, warn));
  town.difficulty = old.difficulty;
  town.strongBarriers = town.defyScrying = town.defyMapping = false;

  // ---- cTown::import_legacy(big/ave/tiny_tr_type) — town_import.tpp
  // Unused node slots, for the boat fix below.
  const unused: number[] = [];
  for (let i = 0; i < 100; i++) {
    const s = specials[i]!;
    if (s.type === SpecType.NONE && s.jumpto === -1 && !specials.some((o) => o.jumpto === i)) unused.push(i);
  }
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      const t = detail.terrain[i]![j]!;
      town.terrain[i]![j] = t;
      town.lighting[i]![j] = (detail.lighting[Math.floor(i / 8)]![j]! & (1 << (i % 8))) !== 0 ? 1 : 0;
      if (terMarks[t] === LEGACY_SPECIAL_SPOT) town.presetFields.push({ loc: { x: i, y: j }, type: FieldType.SPECIAL_SPOT });
      if (terMarks[t] === LEGACY_ROAD) town.presetFields.push({ loc: { x: i, y: j }, type: FieldType.SPECIAL_ROAD });
      const fixed = fixHillRoad(detail.terrain, i, j, terTypes);
      if (fixed !== null) town.terrain[i]![j] = fixed;
      if (terTypes[town.terrain[i]![j]!]?.boatOver) {
        // "Boats never triggered specials in the old BoE", so a special on
        // water gets an IF_IN_BOAT guard put in front of it.
        const k = town.specialLocs.findIndex((l) => l.x === i && l.y === j);
        if (k >= 0) {
          const target = town.specialLocs[k]!.spec;
          let slot: number;
          if (unused.length > 0) slot = unused.pop()!;
          else {
            slot = specials.length;
            specials.push(emptySpecialNode());
          }
          town.specialLocs[k]!.spec = slot;
          const node = specials[slot]!;
          node.type = SpecType.IF_IN_BOAT;
          node.ex1b = -1; // any boat
          node.ex1c = -1; // do nothing
          node.jumpto = target; // else jump here
        }
      }
    }
  }
  town.specials = specialMap(specials);
  town.areaDesc = detail.roomRect.map((rect) => ({ ...rect, descr: '' }));
  town.creatures = detail.creatures.map(convertTownperson);
  town.isHidden = scen.townHidden[which]! !== 0;

  // ---- the 140 town strings — trimmed on the right, the one place the C++
  // does ("fixed-width in legacy scenarios")
  town.specStrs = new Array<string>(100).fill('');
  while (town.signLocs.length < 20) town.signLocs.push({ x: 0, y: 0, text: '' });
  const tempStr = new Uint8Array(256);
  for (let i = 0; i < 140; i++) {
    const s = r.lstr(old.strlens[i]!, tempStr).replace(/[ \t\n\r]+$/, ''); // boost trim_right: \v and \f survive it here
    if (i === 0) town.name = s;
    else if (i < 17) town.areaDesc[i - 1]!.descr = s;
    else if (i < 20) town.comment[i - 17] = s;
    else if (i < 120) town.specStrs[i - 20] = s;
    else town.signLocs[i - 120]!.text = s;
  }

  // ---- the dialogue record and its 170 strings
  const talk = emptySpeech();
  if (r.data.length - r.pos < 1400) {
    // "Could not read dialogue record" — the C++ gives up on the town here,
    // with no talk nodes and before it recomputes the lighting. Only a file
    // whose size table overruns its end gets here (Shadow.exs, in the archive).
    warn(`Town ${which}: could not read its dialogue record.`);
    for (const who of talk.people) who.title = 'Unused'; // cPersonality's default
    return { town, talk };
  }
  const oldTalk = readTalk(r);
  const nodeStrs = Array.from({ length: 60 }, () => ({ str1: '', str2: '' }));
  for (let i = 0; i < 170; i++) {
    const s = r.lstr(oldTalk.strlens[i]!, tempStr);
    if (i < 10) talk.people[i]!.title = s;
    else if (i < 20) talk.people[i - 10]!.look = s;
    else if (i < 30) talk.people[i - 20]!.name = s;
    else if (i < 40) talk.people[i - 30]!.job = s;
    else if (i >= 160) talk.people[i - 160]!.dunno = s;
    else if (i % 2 === 0) nodeStrs[(i - 40) / 2]!.str1 = s;
    else nodeStrs[(i - 41) / 2]!.str2 = s;
  }
  // After the strings: a shop is named after its node's first string.
  talk.talkNodes = convertTalkNodes(oldTalk.nodes, nodeStrs, shops, (b) => r.decode(b));

  // "And lastly, calculate lighting."
  setUpLights((n) => terTypes[n]!, town);
  return { town, talk };
}

// ---------------------------------------------------------------- shops

/** `port_shop_spec_node` (fileio_scen.cpp:227). */
function portShopSpecNode(spec: SpecialNode, shops: ShopInfo[], strs: string[]): void {
  let which: number;
  if (spec.ex1b < 4) {
    if (spec.ex1a < 0) spec.ex1a = 1; // "Safeguard against invalid data"
    // The C++ tests `m1 <= strs.size()` — one past the end, which reads past
    // the vector. Treated as no title here.
    const title = spec.m1 >= 0 && spec.m1 < strs.length ? strs[spec.m1]! : '';
    shops.push({ type: (spec.ex1b + 1) as ShopItemType, first: spec.ex1a, count: spec.ex2a, name: title });
    which = shops.length + 5;
  } else if (spec.ex1b === 4) which = 5;
  else which = spec.ex1b - 5;
  spec.ex1a = which;
  spec.ex1b = spec.ex2b;
  spec.ex2a = spec.ex2b = -1;
}

/** The shop-building loop at the end of `load_scenario_v1`. */
function buildShop(info: ShopInfo, items: Item[]): Shop {
  const shop = new Shop();
  shop.name = info.name;
  shop.face = 0;
  if (info.type === ShopItemType.MAGE_SPELL || info.type === ShopItemType.PRIEST_SPELL
    || info.type === ShopItemType.ALCHEMY) shop.face = 43;
  else if (info.type === ShopItemType.ITEM) {
    let food = true;
    for (let i = info.first; i < info.first + info.count && i < items.length; i++) {
      if (items[i]!.variety !== ItemType.FOOD) food = false;
    }
    if (food) shop.face = 42;
  }
  shop.type = ShopType.NORMAL;
  shop.prompt = ShopPrompt.SHOPPING;
  if (info.type === ShopItemType.MAGE_SPELL) shop.prompt = ShopPrompt.MAGE;
  else if (info.type === ShopItemType.PRIEST_SPELL) shop.prompt = ShopPrompt.PRIEST;
  else if (info.type === ShopItemType.ALCHEMY) {
    shop.prompt = ShopPrompt.ALCHEMY;
    shop.type = ShopType.ALLOW_DEAD;
  }
  if (info.type === ShopItemType.ITEM) {
    const end = Math.min(info.first + info.count, items.length);
    for (let i = info.first; i < end; i++) shop.addItem(i, { ...items[i]! }, INFINITE_AMOUNT);
  } else {
    const max = info.type === ShopItemType.ALCHEMY ? 20 : 62;
    const end = Math.min(max, info.first + info.count);
    for (let i = info.first; i < end; i++) shop.addSpecial(info.type, i);
  }
  return shop;
}
