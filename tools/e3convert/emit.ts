/**
 * Writes Exile 3 out as an unpacked v2 scenario tree, the layout of
 * `public/scenarios/<id>/` that the engine loads like any other scenario.
 *
 * Everything E3 keeps as data — terrain, the 90 outdoor zones as sectors,
 * the 200 towns, monsters, items, people, dialogue and shops — and the
 * encounters it keeps as code, transcribed town by town in `towns/` and
 * compiled into special nodes by `SpecBuilder` (`script.ts`).
 */

import { sightingScripts } from './towns/sightings';
import { e3JobStrings } from './jobs';
import { E3_JOB_TARGET_PERSONALITY } from '../../src/game/e3Jobs';
import { encodePng } from './png';
import { readE3Cursors, type E3Cursor } from './cursors';
import { convertItem, convertMonster, convertPresetField } from '../../src/fileio/legacy/convert';
import { buildItemSheet, buildMonsterSheets, buildTerrainSheets, e3TerrainPic } from './graphics';
import { readDialogs, readNeResources, readNeSegment, readSounds, readStringTable } from './ne';
import { E3_ZONES_HIGH, E3_ZONES_WIDE, readE3Outdoors, type E3Outdoor, type E3OutWandering } from './outdoor';
import { ItemAbil } from '../../src/data/item';
import { FieldType } from '../../src/data/fields';
import { DamageType } from '../../src/data/monster';
import { MonstAbil, MonstGen } from '../../src/data/monsterAbility';
import { decodeBmp, type Rgba } from '../../src/fileio/legacy/bmp';
import { PIC_CUSTOM_FULL } from '../../src/data/special';
import { BG_RECTS, E3_PATTERN_SLOTS } from '../../src/render/tiling';
import { E3_ABILITY_TO_LEGACY, E3_BREATH_RANGE, E3_TERRAIN_COUNT, readE3HiddenEntrances, readE3HiddenTowns, readE3ItemAbilities, readE3Items, readE3Monsters, readE3PersonalityFaces, readE3RoadJoins, readE3Start, readE3Terrain, readE3Vehicles, vehicleNumbers, type E3TerrainType, type E3Vehicle } from './tables';
import { E3_TOWN_COUNT, readE3Towns, type E3CreatureStart, type E3PresetItem, type E3Town } from './town';
import { dialogueXml, esc, itemsXml, monstersXml, shopXml, specialItemXml } from './xmlWrite';
import { convertE3Talk, e3Text, readE3Talk, type E3Speaker } from './talk';
import { readE3ShopTables, standardShops } from './shops';
import { e3DayReached, e3Event, e3Flag } from './flags';
import { VILLAGE_SIZE, buildE3Village, ruinableBuildings, villageTemplate, type RuinableBuilding } from './village';
import { ENTRANCE_MARK_SPOT, e3SpotScript, type GroupNodes, type GroupScript, type KillScript, type PlaceScript, type SpotScript, type TalkScript } from './specials';
import { e3TalkStart } from './towns/talkStart';
import { e3GroupForced, e3GroupSteps } from './towns/encounters';
import { e3KillAfter, e3KillCase } from './towns/kills';
import { FORT_ENTRANCES, FORT_START_ZONE, town21 } from './towns/town21';
import { krizsan } from './towns/krizsan';
import { shayder } from './towns/shayder';
import { lorelei } from './towns/lorelei';
import { gale } from './towns/gale';
import { townEntryScript } from './towns/entry';
import { HOSTILE_SCRIPTS } from './towns/hostile';
import { POOL_SPOT, SLIME_POOLS, level2Timers, slimePit } from './towns/slimePit';
import { towerOfMagi } from './towns/towerOfMagi';
import { filthFactory } from './towns/filthFactory';
import { castleTroglo } from './towns/castleTroglo';
import { cavesOfGiants } from './towns/cavesOfGiants';
import { level1Timers, shiftingFloors } from './towns/shiftingFloors';
import { DUNGEON_SCRIPTS, WOLF_PIT_ENTRANCES, agateTimers } from './towns/dungeons';
import { DUNGEON2_SCRIPTS } from './towns/dungeons2';
import { VILLAGE_SCRIPTS } from './towns/villages';
import { newCotra } from './towns/newCotra';
import { tinraya } from './towns/tinraya';
import { PANTS_CLASS, rentarKeep } from './towns/rentarKeep';
import { sharimik } from './towns/sharimik';
import { ZONE_SCRIPTS } from './towns/zones';
import { e3NoteItems, e3NoteSteps, e3StampedItems, isE3NoteAbility } from './notes';
import { DAILY_FLAGS, KILL_SCRIPTS } from './towns/talkScripts';
import { dailyPlot } from './towns/plot';
import { townStatesXml } from './towns/townStates';
import { SpecBuilder, type ScriptSource, type Step } from './script';
import { BASIC_BUTTONS } from '../../src/game/specials/oneshot';
import { makeSpecItem, type SpecItem } from '../../src/data/quest';
import type { Shop } from '../../src/data/shop';

const ATTITUDE = ['docile', 'hostile-a', 'friendly', 'hostile-b'];
const BLOCKAGE = ['none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight'];
const LIGHTING = ['lit', 'dark', 'drains', 'none'];

/** Towns with a clock of their own (`TimerScript`). */
const TIMER_SCRIPTS = new Map([[32, level1Timers], [23, level2Timers], [46, agateTimers]]);
/** Town entrance markers for `start_locs[0..3]` (`loadTownMapData`). */
const ENTRANCE_MARK = ['v', '<', '^', '>'];

/** The towns whose own encounters are transcribed so far (E3-3). */
const TOWN_SCRIPTS = new Map<number, PlaceScript>([
  [21, town21], ...[0, 1, 2, 3].map((t): [number, PlaceScript] => [t, krizsan(t)]),
  ...[4, 5, 6, 7].map((t): [number, PlaceScript] => [t, shayder(t)]),
  ...[8, 9, 10, 11].map((t): [number, PlaceScript] => [t, sharimik(t)]),
  ...[12, 13, 14, 15].map((t): [number, PlaceScript] => [t, lorelei(t)]),
  ...[16, 17, 18, 19].map((t): [number, PlaceScript] => [t, gale(t)]),
  [22, slimePit(22)], [23, slimePit(23)],
  [24, towerOfMagi(24)], [25, towerOfMagi(25)],
  [26, filthFactory(26)], [27, filthFactory(27)],
  [28, castleTroglo(28)], [29, castleTroglo(29)],
  [30, cavesOfGiants(30)], [31, cavesOfGiants(31)],
  ...DUNGEON_SCRIPTS,
  ...DUNGEON2_SCRIPTS,
  ...VILLAGE_SCRIPTS,
  [42, newCotra],
  [35, tinraya(35)], [36, tinraya(36)],
  [38, rentarKeep(38)], [64, rentarKeep(64)],
  [32, shiftingFloors(32)], [33, shiftingFloors(33)], [60, shiftingFloors(60)], [108, shiftingFloors(108)],
]);

/** E3's special items: strings 1801 on, and the engine's limit too. */
const E3_SPECIAL_ITEMS = 50;

/**
 * The monsters E3's `make_town_hostile` gets moving and alerts (1070:2455,
 * mobile and `active` 2), as the `hostile-movers` flag's list; the rest
 * turn hostile where they stand. Of these, 91 and 92 get the guard boost.
 */
const E3_HOSTILE_MOVERS = '12-20,91-98,149-154';
const E3_BOOSTED_GUARDS = [91, 92];

/**
 * The towns E3 enters with the dungeon sound (95) however they are lit:
 * `start_town_mode`'s list (`10d8:0526`–`05d1`). 200 is on it though no town
 * has that number.
 */
const E3_DUNGEON_SOUND = '22-23,25-33,35-38,44-47,50-79,86,200';

/** The game's string tables E3 has lines for (`strings/NAME.txt`). */
export const E3_STRING_OVERRIDES = ['help'];

/** The game sheets E3 replaces with its own: engine name → E3 file. */
export const E3_SHEET_OVERRIDES: readonly [string, string][] = [
  ['dlogpics', 'DLOGPICS.BMP'], ['talkportraits', 'TALKPORT.BMP'],
];

/**
 * E3's background patterns as a `pixpats` to lay over the game's: MIXED.BMP's
 * ten 64×64 patterns, `paint_pattern`'s `{32,168,96,232}` stepped 64 across
 * five and down two (1997 GRAPHUTL.CPP; E3 keeps the same rectangle at
 * `DS:1768`), each at its slot in `E3_PATTERN_SLOTS`, the rest transparent.
 */
function buildE3Patterns(read: E3Read): Rgba {
  const mixed = decodeBmp(read('MIXED.BMP'));
  const out: Rgba = { width: 320, height: 256, data: new Uint8ClampedArray(320 * 256 * 4) };
  E3_PATTERN_SLOTS.forEach((slot, k) => {
    const to = BG_RECTS[slot]!;
    const sx = 32 + 64 * (k % 5), sy = 168 + 64 * Math.floor(k / 5);
    for (let y = 0; y < 64; y++) {
      const from = ((sy + y) * mixed.width + sx) * 4;
      out.data.set(mixed.data.subarray(from, from + 64 * 4), ((to.top + y) * out.width + to.left) * 4);
    }
  });
  return out;
}

/**
 * E3's three panels on the right, which STATAREA.BMP holds one above the
 * other and 1997's `load_main_screen` (GRAPHICS.CPP:766) cuts apart: the
 * party's stats (rows 0-116), the items (116-260) and the transcript
 * (260-398, 256 wide) — OBoE's statarea, inventory and transcript. E3's are
 * light, with their labels painted in.
 */
export const E3_PANELS: readonly [string, number, number, number][] = [
  ['statarea', 0, 116, 271], ['inventory', 116, 260, 271], ['transcript', 260, 398, 256],
];

function e3Panels(read: E3Read): [string, Rgba][] {
  const all = decodeBmp(read('STATAREA.BMP'));
  return E3_PANELS.map(([name, top, bottom, width]) => {
    const img: Rgba = { width, height: bottom - top, data: new Uint8ClampedArray(width * (bottom - top) * 4) };
    for (let y = top; y < bottom; y++) {
      const from = (y * all.width) * 4;
      img.data.set(all.data.subarray(from, from + width * 4), (y - top) * width * 4);
    }
    return [name, img];
  });
}

/**
 * A dialog's picture tag `5_n` as a node's `[pic, pictype]`. The numbering is
 * 1997's `draw_dialog_graphic` (DLOGTOOL.CPP), which E3's (`1028:3856`)
 * shares: under 300 a terrain picture, 400–579 a monster sprite (E3 takes
 * a raw sprite index, under 180), 700 up a dialog picture, 1000 up a talking
 * face, and 900 up one of the ten black-and-white maps and carvings: each is
 * a scenario sheet of its own from `mapBase` (`e3MapSheets`), shown whole
 * (PIC_CUSTOM_FULL, 111).
 */
export function e3DialogPic(tag: number, spritePic: Map<number, number>, mapBase = -1): [number, number] | undefined {
  if (tag < 240) return [e3TerrainPic(tag), 1];
  if (tag >= 400 && tag < 600) {
    const pic = spritePic.get(tag - 400);
    return pic === undefined ? undefined : [pic, 3];
  }
  if (tag >= 700 && tag < 800) return [tag - 700, 4];
  if (tag >= 1000 && tag < 1100) return [tag - 1000, 5];
  if (tag >= 900 && tag < 900 + E3_MAP_COUNT && mapBase >= 0) return [mapBase + tag - 900, PIC_CUSTOM_FULL];
  return undefined;
}

/** How many of DLOGMAPS.BMP's 120×120 cells E3's dialogs use (`5_900`–`5_909`). */
const E3_MAP_COUNT = 10;

/**
 * DLOGMAPS.BMP, 1997's B&W graphic sheet (`draw_dialog_graphic`'s case 9:
 * 120×120 cells, three across), cut into one sheet a picture.
 */
function e3MapSheets(read: E3Read): Rgba[] {
  const all = decodeBmp(read('DLOGMAPS.BMP'));
  return Array.from({ length: E3_MAP_COUNT }, (_, k) => {
    const x0 = 120 * (k % 3), y0 = 120 * Math.floor(k / 3);
    const data = new Uint8ClampedArray(120 * 120 * 4);
    for (let y = 0; y < 120; y++) {
      const from = ((y0 + y) * all.width + x0) * 4;
      data.set(all.data.subarray(from, from + 120 * 4), y * 120 * 4);
    }
    return { width: 120, height: 120, data };
  });
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n';

/**
 * A village's entry (`FUN_1040_1600`'s ruins): each building with a day of
 * its own falls to ruin once that day comes, and every one once the village
 * is overrun (its chop day; 1 or less, from the start). Each is its 8×8
 * square copied in from the village's ruins record (`copy-ter`).
 */
function villageRuinSteps(b: SpecBuilder, t: E3Town, record: number, buildings: RuinableBuilding[]): Step[] {
  const copy = (bd: RuinableBuilding) => b.copyTerrain(record, bd.x, bd.y, 8, 8);
  const own = buildings.filter((bd) => bd.day >= 0).map((bd) => b.ifE3DayReached(bd.day, bd.event, [copy(bd)]));
  if (t.townChopTime <= 0) return own;
  const all = buildings.map(copy);
  return [...own, ...(t.townChopTime <= 1 ? all : [b.ifE3DayReached(t.townChopTime, t.townChopKey, all)])];
}

/** A village's ruins record: its map only, hidden, never entered. */
function ruinTownXml(name: string): string {
  return `${XML_HEAD}<town boes="2.0.0">
    <size>${VILLAGE_SIZE}</size>
    <name>${esc(name)}</name>
    <bounds top="0" left="0" bottom="${VILLAGE_SIZE - 1}" right="${VILLAGE_SIZE - 1}" />
    <difficulty>0</difficulty>
    <lighting>lit</lighting>
    <flags>
        <hidden>true</hidden>
    </flags>
</town>
`;
}

/** One `.map` file: rows are y, columns x, with `marks` appended after a tile's number. */
function mapFile(terrain: number[][], size: number, marks: Map<string, string>): string {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    const cells: string[] = [];
    for (let x = 0; x < size; x++) cells.push(`${terrain[x]?.[y] ?? 0}${marks.get(`${x},${y}`) ?? ''}`);
    rows.push(cells.join(','));
  }
  return rows.join('\n') + '\n';
}

function addMark(marks: Map<string, string>, x: number, y: number, mark: string): void {
  const key = `${x},${y}`;
  marks.set(key, (marks.get(key) ?? '') + mark);
}

/**
 * E3's containers, the terrain list `FUN_1080_0a87` checks (DGROUP 0x1d80):
 * desk, chest, dresser, crystal box, case, box and body. Using one that
 * holds contained items opens it; BoE's `box` special does it on Look.
 */
const E3_CONTAINERS = new Set([155, 167, 174, 197, 199, 208, 209]);

/** A terrain's `<special>`: its E3 door behaviour, in BoE's terms. */
function specialXml(t: E3TerrainType, id: number, hiddenAs: Map<number, number>): string {
  const sp = t.special;
  // A bed (picture 143) shows the party asleep in it, picture 230: BoE 1997's
  // rule, which OBoE's legacy importer keeps as the BED special, and E3's
  // sheet has the same picture there.
  // E3 enters a town when the party's outdoor square is terrain 217–231
  // (`0xd8 < t && t < 0xe8`, exile3.c:4648) and one of the zone's town
  // entrances is there; BoE's `town` special is the same test. flag1 is what
  // a hidden town shows as (`readE3HiddenEntrances`). E3's table stops at
  // 228; it would read past it for 229–231, which no hidden town stands on,
  // so those show as themselves.
  // Right after, E3 refuses towns 8–20, 28–39, 51–79, 99–119 and 146+ while
  // `DS:3d3c` is clear, with "You need to be registered to enter."
  // (`1010:2231`, string `1010:0a3a`): the shareware lock, which a
  // registration key lifted (`1020:4f27`). Spiderweb has made the game free
  // to play, so the port plays it registered and leaves the lock out.
  const [type, f1, f2, f3] = !sp && id >= 217 && id <= 231 ? ['town', hiddenAs.get(id) ?? id, 0, 0]
    : !sp && E3_CONTAINERS.has(id) ? ['box', -1, 0, 0]
    : !sp && t.pic === 143 ? ['bed', e3TerrainPic(230), 0, 0]
    // Lava burns: the move code's arm for terrain 75 (`10c0:15ab`) is BoE's
    // DAMAGING, `get_ran(8,1,10)` fire (flag1 10 sides, flag2 8 dice, flag3
    // fire), sparing a party that flies, sails or is boarding a boat. Terrain
    // 76, the other "Lava", has no arm and never burns. The E3 wording and
    // order are the `lava` feature flag's. This gives up blockage 2: a
    // fire-immune monster may now cross it, where E3 keeps every monster off.
    : !sp && id === 75 ? ['dmg', 10, 8, DamageType.FIRE]
    // E3's blockage 2 keeps monsters off (lava, portals, town entrances);
    // BoE's only means that for counters (`is_special`), so the special says it.
    : !sp && t.blockage === 2 ? ['monst-block', -1, 0, 0]
    : !sp ? ['none', -1, 0, 0]
    : sp.kind === 'sign' ? ['sign', 0, 0, 0]
    : sp.kind === 'belt' ? ['belt', sp.dir, 0, 0]
    : sp.kind === 'step-change' ? ['step-change', sp.to, sp.sound, 0]
    : sp.kind === 'use-change' ? ['use-change', sp.to, sp.sound, 0]
    // BoE's `unlock`: flag2 is the difficulty, 5 and up beyond picking.
    // flag3 is E3's bash limit, under the `bash` = `exile3` flag: E3's bash
    // (`10d8:4224`) breaks the lock at or under 25, or 10 for the basalt door
    // (121), and never for the doors past picking. E3's pick
    // (`FUN_10d8_3f67`) is the `pick-lock` = `exile3` flag's: flag2 only
    // says whether the door can be picked at all.
    : ['unlock', sp.to, sp.pickable ? 1 : 10, !sp.pickable ? 0 : id === 121 ? 10 : 25];
  return `        <special>
            <type>${type}</type>
            <flag>${f1}</flag>
            <flag>${f2}</flag>
            <flag>${f3}</flag>
        </special>`;
}

/**
 * Terrains that turn into one another: E3's lever (`FUN_10e0_0a49` flips 243
 * and 244), which BoE's TOWN_LEVER does through `transform`.
 */
const TRANSFORM = new Map<number, number>([[243, 244], [244, 243]]);

/**
 * E3's roads, by the terrain each is drawn over: cave floor, grass and hills.
 * Their pictures are that ground with only the hub of a road on it, and the
 * arms joining neighbouring roads are drawn in code, as BoE 1997's `place_road`
 * draws them for its own road terrains 202–204 (GRAPHICS.CPP:2164), which are
 * the same three grounds. So they convert as the legacy importer converts
 * BoE's: the terrain keeps its number and takes the plain ground's picture,
 * and every square of it gets the engine's road field, which draws hub and
 * arms. What an arm reaches into is E3's own list (`readE3RoadJoins`),
 * given to the engine as the feature flag `road-joins`.
 */
const E3_ROADS = new Map<number, number>([[232, 0], [233, 2], [234, 36]]);

/** The road field's mark on every road square of a map. */
function addRoadMarks(marks: Map<string, string>, terrain: number[][], size: number): void {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (E3_ROADS.has(terrain[x]?.[y] ?? -1)) addMark(marks, x, y, `&${FieldType.SPECIAL_ROAD}`);
    }
  }
}

/**
 * Terrain 255's blockage is not the table's: E3's town loader sets
 * `blockage[255]` (`DS:1d7d`) for the towns that have it, 4 (stops movement
 * and missiles) in 22, 23 and 46 and 5 (stops sight too) in the rest
 * (10d8:04b8–04c9; 1040:0a04 does the same for a loaded game). The setting
 * outlives the town, but every town with the terrain sets it, so it is
 * per town. The engine's blockage is per terrain, so 255 takes 4 and the
 * other towns get a copy of it that blocks sight, `E3_TER_255_OPAQUE`.
 */
const E3_TER_255_OPAQUE = E3_TERRAIN_COUNT;
const TER_255_SEE_THROUGH = new Set([22, 23, 46]);
const TER_255_TOWNS = new Set([22, 23, 26, 27, 28, 29, 30, 31, 32, 33, 38, 46, 54, 60, 63, 92, 103, 104, 108]);

function withTer255(types: E3TerrainType[]): E3TerrainType[] {
  const t = types[255]!;
  return [...types.slice(0, 255), { ...t, blockage: 4 }, { ...t, blockage: 5 }];
}

/** Town `town`'s map as the engine gets it, with terrain 255 as the loader set it. */
function townTer255(town: number, terrain: number[][]): number[][] {
  const has = terrain.some((col) => col.includes(255));
  if (has && !TER_255_TOWNS.has(town)) throw new Error(`town ${town} has terrain 255 but the loader never sets its blockage`);
  if (!has || TER_255_SEE_THROUGH.has(town)) return terrain;
  return terrain.map((col) => col.map((t) => (t === 255 ? E3_TER_255_OPAQUE : t)));
}

function terrainXml(types: E3TerrainType[], hiddenAs: Map<number, number>): string {
  const out = [XML_HEAD, '<terrains boes="2.0.0">\n'];
  types.forEach((t, id) => {
    const ground = E3_ROADS.get(id);
    const pic = e3TerrainPic(ground === undefined ? t.pic : types[ground]!.pic);
    out.push(`    <terrain id="${id}">
        <name>${esc(t.name)}</name>
        <pic>${pic}</pic>
        <map>${pic}</map>
        <blockage>${BLOCKAGE[t.blockage] ?? 'none'}</blockage>
        <transform>${TRANSFORM.get(id) ?? id}</transform>
        <fly>false</fly>
        <boat>${t.boat}</boat>
        <ride>${t.blockage < 3}</ride>
        <archetype>false</archetype>
        <light>0</light>
        <step-sound>step</step-sound>
        <trim>none</trim>
        <ground>0</ground>
        <trim-for>-1</trim-for>
        <arena>${t.arena}</arena>
${specialXml(t, id, hiddenAs)}
    </terrain>
`);
  });
  out.push('</terrains>\n');
  return out.join('');
}

function isUnusedLoc(l: { x: number; y: number }): boolean {
  // E3 leaves unused entries at (0,0); nothing real sits on a zone's corner.
  return l.x === 0 && l.y === 0;
}

/**
 * The signs with something written on them: location `k` reads string
 * `first + k` (zone `z`'s from 27001 + 20z, town `t`'s from 30005 + 20t).
 */
function signs(locs: { x: number; y: number }[], strings: Map<number, string>, first: number): { k: number; x: number; y: number; text: string }[] {
  return locs.flatMap((l, k) => {
    const text = strings.get(first + k);
    return isUnusedLoc(l) || !text ? [] : [{ k, x: l.x, y: l.y, text: e3Text(text) }];
  });
}

function signXml(s: { k: number; text: string }): string {
  return `    <sign id="${s.k}">${esc(s.text)}</sign>\n`;
}

function areaXml(r: { top: number; left: number; bottom: number; right: number }, name: string): string {
  return `    <area top="${r.top}" left="${r.left}" bottom="${r.bottom}" right="${r.right}">${esc(name)}</area>\n`;
}

/**
 * A zone's monster group: `<wandering>` ones turn up at random, and
 * `<encounter>` ones are placed by scripts. Its script and message are the
 * three nodes (`towns/encounters.ts`).
 */
function outGroupXml(tag: 'wandering' | 'encounter', g: E3OutWandering, nodes: GroupNodes): string {
  const [, end1 = 0, end2 = 0] = g.words;
  const sdf = end1 > 0 && end2 > 0 ? e3Flag(end1, end2) : [-1, -1];
  const monsters = [
    ...g.monst.map((m) => `        <monster>${m}</monster>\n`),
    ...g.friendly.map((m) => `        <monster friendly="true">${m}</monster>\n`),
  ].join('');
  return `    <${tag} can-flee="${g.gap[0] === 1 ? 'false' : 'true'}" force="${e3GroupForced(g)}">
${monsters}        <onmeet>${nodes.meet}</onmeet>
        <onwin>${nodes.win}</onwin>
        <onflee>${nodes.flee}</onflee>
        <sdf x="${sdf[0]}" y="${sdf[1]}" />
    </${tag}>
`;
}

function zoneSigns(z: E3Outdoor, zone: number, strings: Map<number, string>) {
  return signs(z.signLocs, strings, 27001 + 20 * zone);
}

function specStringsXml(script: SpotScript): string {
  return script.strings.map((str, i) => `    <string id="${i}">${esc(str)}</string>\n`).join('');
}

function sectorXml(z: E3Outdoor, zone: number, strings: Map<number, string>, script: SpotScript): string {
  const areas = z.infoRect
    .map((r, i) => ({ r, name: z.areaNames[i] ?? '' }))
    .filter((a) => a.name !== '')
    .map((a) => areaXml(a.r, a.name));
  const groups = [
    ...z.specialEnc.map((g, k) => outGroupXml('encounter', g, script.groups[k]!)),
    ...z.wandering.map((g, k) => outGroupXml('wandering', g, script.groups[z.specialEnc.length + k]!)),
  ];
  return `${XML_HEAD}<sector boes="2.0.0">\n    <name>${esc(z.name)}</name>\n${groups.join('')}${areas.join('')}${zoneSigns(z, zone, strings).map(signXml).join('')}${specStringsXml(script)}</sector>\n`;
}

function sectorMap(z: E3Outdoor, zone: number, strings: Map<number, string>, script: SpotScript): string {
  const marks = new Map<string, string>();
  z.exitLocs.forEach((l, i) => {
    const dest = z.exitDests[i] ?? -1;
    if (!isUnusedLoc(l) && dest >= 0 && dest < E3_TOWN_COUNT) addMark(marks, l.x, l.y, `@${dest}`);
  });
  for (const s of zoneSigns(z, zone, strings)) addMark(marks, s.x, s.y, `!${s.k}`);
  z.wanderingLocs.forEach((l, k) => { if (!isUnusedLoc(l)) addMark(marks, l.x, l.y, `*${k}`); });
  for (const m of script.marks) addMark(marks, m.x, m.y, `:${m.node}`);
  addRoadMarks(marks, z.terrain, 48);
  return mapFile(z.terrain, 48, marks);
}

function townName(strings: Map<number, string>, t: number): string {
  // Each town has a 20-string block from 30001; the first is its name.
  const name = strings.get(30001 + 20 * t);
  return name && name !== 'Name' ? name : `Town ${t}`;
}

function townSize(t: E3Town): number {
  // Villages (records 120+) are built as medium towns (`town_size` 1).
  return t.kind === 'large' ? 64 : t.kind === 'small' ? 32 : 48;
}

/** A town's creatures: the record's own, or a village's. Empty slots have number 0. */
function townCreatures(t: E3Town): E3CreatureStart[] {
  return t.village ? t.village.creatures : t.creatures;
}

/**
 * A creature's `time_flag`, from the town loader's switch (`10d8:0d36`),
 * which is BoE 1997's (TOWN.CPP:314) with the day and event packed into one
 * int16 (`E3CreatureStart.timeCode`).
 */
function creatureTimeXml(c: E3CreatureStart): string {
  const day = (tag: string) => {
    const t = e3DayReached(c.timeCode % 1000, Math.floor(c.timeCode / 1000));
    return `        <time type="${tag}">\n            <day>${t.day}</day>\n${t.event ? `            <event>${t.event}</event>\n` : ''}        </time>\n`;
  };
  // 7 and 8 compare the day with the event's key time directly.
  const event = (tag: string) =>
    `        <time type="${tag}">\n            <event>${e3Event(Math.floor(c.timeCode / 1000))}</event>\n        </time>\n`;
  switch (c.timeFlag) {
    case 1: return day('after-day');
    case 2: return day('until-day');
    // 4–6: one of three places on a rota. The engine's rota turns by the
    // day where E3's (and BoE 1997's) turns every 1,000 ticks of age, and
    // the engine numbers the three C, A, B; the tags follow the legacy
    // importer's mapping (`convertTownperson`).
    case 4: return '        <time type="travel-b" />\n';
    case 5: return '        <time type="travel-c" />\n';
    case 6: return '        <time type="travel-a" />\n';
    case 7: return event('after-event');
    case 8: return event('until-event');
    // 9: only there once the town has been overrun (its `<chop>`).
    case 9: return '        <time type="after-death" />\n';
    // 3 (on its day, turn hostile and become monster `extra1`) is used by no
    // creature E3 ships.
    default: return '';
  }
}

function creatureXml(c: E3CreatureStart, id: number, personality: number, onKill = -1, face?: number, onTalk = -1): string {
  // `spec1`/`spec2` is the creature's death flag: END_DIE sets it, and a town
  // loading leaves out anyone whose flag is set (`10d8:` town setup, which
  // skips row 0 and 200 up). 200–204 are creatures a script brings in
  // (`FUN_1090_4053`, `SpecBuilder.bringIn`): the loader leaves them absent
  // (`10d8:0d36`), which is what an encounter code does.
  const sdf = c.spec1 > 0 && c.spec1 < 200 && c.spec2 < 10 ? e3Flag(c.spec1, c.spec2) : null;
  const code = c.spec1 >= 200 && c.spec1 < 205 ? c.spec1 : 0;
  return `    <creature id="${id}">
        <type>${c.number}</type>
        <attitude>${ATTITUDE[c.startAttitude] ?? 'docile'}</attitude>
        <mobility>${c.mobile}</mobility>
${sdf ? `        <sdf x="${sdf[0]}" y="${sdf[1]}" />\n` : ''}${code ? `        <encounter>${code}</encounter>\n` : ''}${creatureTimeXml(c)}${face ? `        <face>${face - 1}</face>\n` : ''}        <personality>${personality}</personality>
${onKill >= 0 ? `        <onkill>${onKill}</onkill>\n` : ''}${onTalk >= 0 ? `        <ontalk>${onTalk}</ontalk>\n` : ''}    </creature>
`;
}

/**
 * When a town is overrun: E3's villages fall to the monsters on a day unless
 * a plot event comes first (the town loader, `10d8:0f51`), and any town is
 * "cleaned out" once more than `max_num_monst` of its creatures are killed.
 * E3's thrash (`10d8:1057`) is both 1997 builds' exactly: the overrun spares
 * the town's hostile creatures (attitude odd) and brings in its
 * `after-death` ones, the kill count must pass the limit, and nothing says
 * "abandoned". The engine follows 1997 there (DIVERGENCES.md §14).
 */
function chopXml(t: E3Town): string {
  const attrs: string[] = [];
  if (t.townChopTime > 0) {
    const d = e3DayReached(t.townChopTime, t.townChopKey);
    attrs.push(`day="${d.day}"`);
    if (d.event) attrs.push(`event="${d.event}"`);
  }
  attrs.push(`kills="${t.maxNumMonst}"`);
  return `        <chop ${attrs.join(' ')} />\n`;
}

function townSigns(t: E3Town, strings: Map<number, string>) {
  const size = townSize(t);
  return signs(t.signLocs, strings, 30005 + 20 * t.number).filter((s) => s.x < size && s.y < size);
}

/**
 * What a town's XML needs from the tables built beside it. A preset item is
 * laid down as E3's town loader lays it down (`10d8:1531`). Its
 * `ability`, when not -1, is gold's or food's amount and any other item's
 * ability byte (+10), which for a book, note or map says which one it is
 * (`notes.ts`); `charges`, when not 0, replaces the item's own. The engine's
 * preset has one number, `<charges>`, which it reads as gold's and food's
 * amount, so the ability goes there for those and E3's charges otherwise.
 * A preset that gives some other item an ability of its own (six: a Book
 * 65, Iron Gauntlets and a Crude Buckler 14, Robes 16, razordisks 65 and
 * 92) names an item made for it (`e3StampedItems`).
 */
interface TownTables {
  type(p: E3PresetItem): number;
  charges(p: E3PresetItem): number;
  /** Whether town `t` starts off the map (`readE3HiddenTowns`). */
  hidden(t: number): boolean;
  /** The face E3's talk screen gives personality `p` over its monster's, 1-based (`readE3PersonalityFaces`). */
  face(p: number): number | undefined;
}

function townXml(t: E3Town, name: string, personalityOf: Map<string, number>, strings: Map<number, string>, script: SpotScript, tables: TownTables): string {
  const size = townSize(t);
  const r = t.village ? { top: 0, left: 0, bottom: size - 1, right: size - 1 } : t.inTownRect;
  const creatures = townCreatures(t)
    .map((c, i) => (c.number > 0
      ? creatureXml(c, i, personalityOf.get(`${t.number}:${i}`) ?? -1, script.kills[i], tables.face(c.personality), script.talks[i])
      : '')).join('');
  const items = t.presetItems.map((p, i) => (p.itemCode < 0 ? '' : `    <item id="${i}">
        <type>${tables.type(p)}</type>
        <charges>${tables.charges(p)}</charges>
        <always>${p.alwaysThere !== 0}</always>
        <property>${p.property !== 0}</property>
        <contained>${p.contained !== 0}</contained>
    </item>
`)).join('');
  // A town's four wandering groups, kept in place: the engine picks one at
  // random, so an empty one still counts.
  const wandering = t.wandering.some((g) => g.some((m) => m > 0))
    ? t.wandering.map((g) => `    <wandering>\n${g.map((m) => `        <monster>${m}</monster>\n`).join('')}    </wandering>\n`).join('')
    : '';
  const rooms = t.roomRects.map((r, i) => (t.roomNames[i] ? areaXml(r, t.roomNames[i]!) : '')).join('');
  return `${XML_HEAD}<town boes="2.0.0">
    <size>${size}</size>
    <name>${esc(name)}</name>
    <bounds top="${r.top}" left="${r.left}" bottom="${r.bottom}" right="${r.right}" />
    <difficulty>0</difficulty>
    <lighting>${LIGHTING[t.lighting] ?? 'lit'}</lighting>
${script.entry >= 0 ? `    <onenter condition="alive">${script.entry}</onenter>\n    <onenter condition="dead">${script.entryDead}</onenter>\n` : ''}${script.hostile >= 0 ? `    <onoffend>${script.hostile}</onoffend>\n` : ''}${script.timers.map((tm) => `    <timer freq="${tm.freq}">${tm.node}</timer>\n`).join('')}    <flags>
${chopXml(t)}${tables.hidden(t.number) ? '        <hidden>true</hidden>\n' : ''}    </flags>
${wandering}${items}${creatures}${rooms}${townSigns(t, strings).map(signXml).join('')}${specStringsXml(script)}</town>
`;
}

function townMap(
  t: E3Town, terrain: number[][], strings: Map<number, string>, script: SpotScript,
  vehicles: { boats: E3Vehicle[]; horses: E3Vehicle[] },
): string {
  const size = townSize(t);
  const marks = new Map<string, string>();
  const inside = (l: { x: number; y: number }) => l.x >= 0 && l.x < size && l.y >= 0 && l.y < size;
  t.startLocs.forEach((l, i) => {
    if (inside(l)) addMark(marks, l.x, l.y, ENTRANCE_MARK[i] ?? '');
  });
  t.presetItems.forEach((p, i) => {
    if (p.itemCode >= 0 && inside(p.loc)) addMark(marks, p.loc.x, p.loc.y, `@${i}`);
  });
  for (const f of t.presetFields) {
    const field = f.fieldType > 0 ? convertPresetField({ fieldLoc: f.loc, fieldType: f.fieldType }) : null;
    if (field && inside(f.loc)) addMark(marks, f.loc.x, f.loc.y, `&${field.type}`);
  }
  townCreatures(t).forEach((c, i) => {
    if (c.number > 0 && inside(c.startLoc)) addMark(marks, c.startLoc.x, c.startLoc.y, `$${i}`);
  });
  for (const s of townSigns(t, strings)) addMark(marks, s.x, s.y, `!${s.k}`);
  t.wanderingLocs.forEach((l, k) => { if (!isUnusedLoc(l) && inside(l)) addMark(marks, l.x, l.y, `*${k}`); });
  for (const m of script.marks) if (inside(m)) addMark(marks, m.x, m.y, `:${m.node}`);
  // Vehicles are renumbered (`vehicleNumbers`; the map's are one more), and
  // scripts name E3's through the same table. `H`/`B` is someone else's.
  const vehicleMarks = (list: E3Vehicle[], own: string, theirs: string) => {
    const number = vehicleNumbers(list);
    list.forEach((v, k) => {
      const n = number[k]!;
      if (n >= 0 && v.town === t.number && inside(v.loc)) addMark(marks, v.loc.x, v.loc.y, `${v.property ? theirs : own}${n + 1}`);
    });
  };
  vehicleMarks(vehicles.boats, 'b', 'B');
  vehicleMarks(vehicles.horses, 'h', 'H');
  addRoadMarks(marks, terrain, size);
  return mapFile(terrain, size, marks);
}

/**
 * The events journal's entries (`FUN_1008_3780`): entry `e` is string
 * `5100 + e`, and E3 adds 1 to 0x22. Indexed by entry, so a `journal` node's
 * `ex1a` is E3's own number.
 */
export const E3_JOURNAL_ENTRIES = 0x22;
function e3JournalStrings(str: (id: number) => string): string[] {
  return Array.from({ length: E3_JOURNAL_ENTRIES + 1 }, (_, e) => (e === 0 ? '' : str(5100 + e)));
}

/**
 * A town's kill scripts: the town's own (`KILL_SCRIPTS`), then E3's
 * `kill_monst` cases for the creature's `spec1`/`spec2` (`towns/kills.ts`).
 */
function townKillScript(town: number, creatures: E3CreatureStart[]): KillScript {
  const own = KILL_SCRIPTS.get(town);
  return (b, slot) => {
    const c = creatures[slot];
    if (!c || c.number <= 0) return null;
    const boss = e3KillCase(b, town, c.spec1, c.spec2);
    const after = e3KillAfter(b, c.spec1);
    if (!own && !boss && !after.length) return null;
    const key = boss || after.length ? `${c.spec1}:${c.spec2}` : '';
    return { key, steps: [...own?.(b) ?? [], ...boss ?? [], ...after] };
  };
}

/** A town's HAIL specials: E3's personality swaps (`towns/talkStart.ts`). */
function townTalkScript(creatures: E3CreatureStart[]): TalkScript {
  return (b, slot) => {
    const c = creatures[slot];
    const steps = c && c.number > 0 ? e3TalkStart(b, c.personality) : null;
    return steps ? { key: `${c!.personality}`, steps } : null;
  };
}

function scenarioXml(
  start: { town: number; loc: { x: number; y: number } },
  outStart: { sector: { x: number; y: number }; loc: { x: number; y: number } },
  shops: Shop[], specialItems: SpecItem[], specStrings: string[], newDay: number, roadJoins: number[],
  jobBase: number, journal: string[], cursors: E3Cursor[], townCount: number,
): string {
  return `${XML_HEAD}<scenario boes="2.0.0">
    <title>Exile III: Ruined World</title>
    <icon>0</icon>
    <id>exile3</id>
    <version>0.1.0</version>
    <language>en-US</language>
    <author>
        <name>Jeff Vogel</name>
        <email>Spiderweb Software. Converted from vendor/exile3/EXL3INST.EXE by tools/e3convert.</email>
    </author>
    <feature-flags>
        <use-special-spots>exile3</use-special-spots>
        <outdoor-arena>exile3</outdoor-arena>
        <road-joins>${roadJoins.join(',')}</road-joins>
        <job-boards>exile3:${jobBase}</job-boards>
        <monster-sightings>exile3</monster-sightings>
        <hostile-movers>${E3_HOSTILE_MOVERS}</hostile-movers>
        <town-timers>repeat</town-timers>
        <inn>exile3</inn>
        <lava>exile3</lava>
        <backgrounds>exile3</backgrounds>
        <message-pics>exile3</message-pics>
        <message-sounds>exile3</message-sounds>
        <bash>exile3</bash>
        <room-descriptions>exile3</room-descriptions>
        <explode-spots>exile3</explode-spots>
        <pick-lock>exile3</pick-lock>
        <summons>exile3</summons>
        <dungeon-sound>${E3_DUNGEON_SOUND}</dungeon-sound>
        <cursors>${cursors.map((c) => `${c.name}:${c.hotspot.x}:${c.hotspot.y}`).join(',')}</cursors>
    </feature-flags>
    <text>
        <teaser>The surface world is dying. Find out why.</teaser>
        <teaser>Spiderweb's 1997 game, converted from its own installer. Its quests are still being transcribed, a town at a time.</teaser>
    </text>
    <ratings>
        <content>G</content>
        <difficulty>2</difficulty>
    </ratings>
    <flags>
        <adjust-difficulty>true</adjust-difficulty>
        <legacy>false</legacy>
        <custom-graphics>true</custom-graphics>
    </flags>
    <creator>
        <type>oboe</type>
        <version>2.0.0</version>
    </creator>
    <game>
        <num-towns>${townCount}</num-towns>
        <out-width>${E3_ZONES_WIDE}</out-width>
        <out-height>${E3_ZONES_HIGH}</out-height>
        <start-town>${start.town}</start-town>
        <town-start x="${start.loc.x}" y="${start.loc.y}" />
        <outdoor-start x="${outStart.sector.x}" y="${outStart.sector.y}" />
        <sector-start x="${outStart.loc.x}" y="${outStart.loc.y}" />
${shops.map(shopXml).join('')}${specialItems.map(specialItemXml).join('')}        <timer freq="3700">${newDay}</timer>
${townStatesXml()}${specStrings.map((str, i) => `        <string id="${i}">${esc(str)}</string>\n`).join('')}${journal.map((str, i) => (str ? `        <journal id="${i}">${esc(str)}</journal>\n` : '')).join('')}    </game>
</scenario>
`;
}

/**
 * Where the start town opens onto the world: the exit in zone `zone` that
 * leads to it. Fort Emergence has one on each side, and a new game starts on
 * the caves side (`FORT_START_ZONE`).
 */
function findTownEntrance(zones: E3Outdoor[], town: number, zone: number): { sector: { x: number; y: number }; loc: { x: number; y: number } } {
  const z = zones[zone]!;
  const e = z.exitLocs.findIndex((l, k) => z.exitDests[k] === town && !isUnusedLoc(l));
  if (e < 0) throw new Error(`no outdoor entrance in zone ${zone} leads to town ${town}`);
  return { sector: { x: zone % E3_ZONES_WIDE, y: Math.floor(zone / E3_ZONES_WIDE) }, loc: z.exitLocs[e]! };
}

export interface EmitSummary { sectors: number; towns: number; sheets: number }

/** One of the game's files by name (`EXILE3.EXE`, `TER1.BMP`…). */
export type E3Read = (name: string) => Uint8Array;
/** Writes one file of the scenario tree, by its path in the tree. */
export type E3Write = (path: string, data: string | Uint8Array) => void;

/**
 * Converts Exile III, read file by file through `read`, into a scenario tree
 * written through `write`. Pure: no file system, so the same code runs in
 * Node (`emitNode.ts`) and in the player's browser (`src/platform/exile3.ts`).
 * `progress` hears roughly how far along it is, 0 to 1.
 */
export function convertE3(read: E3Read, write: E3Write, progress: (done: number) => void = () => {}): EmitSummary {
  const files = { exe: read('EXILE3.EXE'), outdoor: read('OUTDOOR.DAT'), town: read('TOWN.DAT') };
  const resources = readNeResources(files.exe);
  const strings = readStringTable(resources);
  const vehicles = readE3Vehicles(files.exe);
  const horseNumber = vehicleNumbers(vehicles.horses);
  // The scenario's own node builder, made below; `scenString` reaches it
  // from the town scripts.
  let scen: SpecBuilder | null = null;
  const e3Src: ScriptSource = {
    strings, dialogs: readDialogs(resources),
    scenString: (text) => {
      if (!scen) throw new Error('scenario strings are not ready');
      return scen.text(text);
    },
    horse: (k) => horseNumber[k] ?? -1,
    stampedItem: (item, ability) => {
      const k = stampedIndex(item, ability);
      if (k < 0) throw new Error(`no stamped item ${item} with ability ${ability}: add it to notes.ts's SCRIPT_STAMPS`);
      return stampBase + k;
    },
    noteItem: (item, ability) => {
      const k = noteItems.findIndex(([i, a]) => i === item && a === ability);
      if (k < 0) throw new Error(`no note item ${item} with ability ${ability}: add it to notes.ts's SCRIPT_NOTES`);
      return noteBase + k;
    },
    scenNode: (build) => {
      if (!scen) throw new Error('scenario nodes are not ready');
      return build(scen);
    },
    exeString: (seg, off) => {
      const bytes = readNeSegment(files.exe, (seg - 0x1000) / 8 + 1);
      const end = bytes.indexOf(0, off);
      return new TextDecoder('latin1').decode(bytes.subarray(off, end < 0 ? undefined : end));
    },
  };
  const terrain = readE3Terrain(files.exe, strings);
  const zones = readE3Outdoors(files.outdoor);
  const towns = readE3Towns(files.town);
  const start = readE3Start(files.exe);

  // header.exs: the OBoE marker every unpacked tree carries.
  write('header.exs', new Uint8Array([0x4f, 0x42, 0x4f, 0x45, 0x01, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x04]));
  write('terrain.xml', terrainXml(withTer255(terrain), readE3HiddenEntrances(files.exe)));
  const hiddenTowns = new Set(readE3HiddenTowns(files.exe));
  // Monsters: E3's table through the legacy importer, drawn from E3's own
  // sprites cut into custom sheets after the terrain's.
  const terrainSheets = buildTerrainSheets(read);
  const legacyMonsters = readE3Monsters(files.exe, strings);
  // The sprites E3's dialogs show (`5_4xx`, a raw sprite index, one cell)
  // get cells of their own after the monsters'.
  const dialogSprites = [...new Set([...e3Src.dialogs.values()].flatMap((d) => d.controls)
    .map((c) => /^5_(4\d\d)$/.exec(c.text)).filter((m) => m !== null).map((m) => Number(m[1]) - 400))];
  const monsterArt = buildMonsterSheets(read, [
    ...legacyMonsters.map((m) => ({ pic: m.pictureNum, w: m.xWidth, h: m.yWidth })),
    ...dialogSprites.map((pic) => ({ pic, w: 1, h: 1 })),
  ], terrainSheets.length);
  const spritePic = new Map(dialogSprites.map((x, i) => [x, monsterArt.pics[legacyMonsters.length + i]!]));
  // The maps and carvings go after the items' sheet.
  const mapBase = terrainSheets.length + monsterArt.sheets.length + 1;
  e3Src.dialogPic = (tag) => e3DialogPic(tag, spritePic, mapBase);
  const monsters = legacyMonsters.map((m, n) => {
    const mon = convertMonster(m);
    mon.pictureNum = monsterArt.pics[n]!;
    // E3's `make_town_hostile` gives BoE's guard boost (health ×3, two
    // statuses 8) to monsters 91 and 92 alone (1070:24e6).
    mon.guard = E3_BOOSTED_GUARDS.includes(n);
    const breath = mon.abil[MonstAbil.DAMAGE2];
    if (breath?.gen.type === MonstGen.BREATH) breath.gen.range = E3_BREATH_RANGE;
    return mon;
  });
  // Items: E3's table through the legacy importer, pictured from one custom
  // sheet after the monsters'.
  const itemSheetNum = terrainSheets.length + monsterArt.sheets.length;
  // E3's food isn't in its item table: the food shops sell from a list of
  // their own (shops.ts), which goes on the end.
  const shopTables = readE3ShopTables(files.exe);
  const e3Items = readE3Items(files.exe);
  const foodBase = e3Items.length;
  // After the food, the notes E3's scripts make by stamping a readable
  // ability onto a table item.
  const noteBase = foodBase + shopTables.food.length;
  const isGoldOrFood = (item: number) => e3Items[item]?.variety === 3 || e3Items[item]?.variety === 11;
  const noteItems = e3NoteItems(towns, isGoldOrFood);
  // After the notes, the items given some other ability of their own.
  const tableAbilities = readE3ItemAbilities(files.exe);
  const stampBase = noteBase + noteItems.length;
  const stampedItems = e3StampedItems(towns, isGoldOrFood, (item) => tableAbilities[item] ?? 0);
  const stampedIndex = (item: number, ability: number) =>
    stampedItems.findIndex(([i, a]) => i === item && a === ability);
  const personalityFaces = readE3PersonalityFaces(files.exe);
  const townTables: TownTables = {
    type: (p) => {
      if (isGoldOrFood(p.itemCode) || p.ability < 0) return p.itemCode;
      if (isE3NoteAbility(p.ability)) return noteBase + noteItems.findIndex(([i, a]) => i === p.itemCode && a === p.ability);
      const k = stampedIndex(p.itemCode, p.ability);
      return k < 0 ? p.itemCode : stampBase + k;
    },
    charges: (p) => (isGoldOrFood(p.itemCode) ? p.ability : p.charges > 0 ? p.charges : -1),
    hidden: (t) => hiddenTowns.has(t),
    face: (p) => personalityFaces.get(p),
  };
  const e3Abilities = [...tableAbilities, ...shopTables.food.map(() => 0), ...noteItems.map(([, a]) => a),
    ...stampedItems.map(([, a]) => a)];
  scen = new SpecBuilder(e3Src, (label) => Math.max(0, BASIC_BUTTONS.indexOf(label)));
  // First sightings (towns/sightings.ts): each plague monster's onsight node.
  // A range of monsters shares one script, so one node.
  const sightNodes = new Map<unknown, number>();
  for (const [m, steps] of sightingScripts(scen)) {
    if (!sightNodes.has(steps)) sightNodes.set(steps, scen.compile(steps));
    const mon = monsters[m];
    if (mon) mon.seeSpec = sightNodes.get(steps)!;
  }
  write('monsters.xml', monstersXml(monsters));
  const noteNodes = new Map<number, number>();
  // A stamped item's ability goes through E3's code table, with the level as
  // strength, as for an item with no namesake in BoE (`readE3Items`).
  const stamped = stampedItems.map(([k, a]) => ({
    ...e3Items[k]!, ability: E3_ABILITY_TO_LEGACY[a] ?? 0, abilityStrength: e3Items[k]!.itemLevel,
  }));
  const items = [...e3Items, ...shopTables.food, ...noteItems.map(([k]) => e3Items[k]!), ...stamped].map((old, k) => {
    const it = convertItem(old);
    it.graphicNum = 1000 + itemSheetNum * 100 + old.graphicNum;
    // E3's scripts name kinds of item by `type_flag` (unicorn horns are 111);
    // the engine's item-class nodes read the special class.
    if (old.typeFlag > 0) it.specialClass = old.typeFlag;
    // Pants (variety 22), which a spot in Rentar-Ihrno's keep looks for.
    else if (old.variety === 22) it.specialClass = PANTS_CLASS;
    // A readable item runs its case of E3's switch when used (`notes.ts`):
    // a scenario node, through OBoE's CALL_SPECIAL ability. E3's item chart
    // (1140:0000, read by `FUN_10c0_2c92`) has 10 for all of 0xa0–0xb7:
    // usable anywhere, and `inept_ok`, so a magically inept PC can read.
    const ability = e3Abilities[k] ?? 0;
    // E3's own code, for the rules where E3 and BoE part (`Item.e3Ability`).
    it.e3Ability = ability;
    // Where BoE's rule is E3's with another strength, E3's strength. A ring of
    // regeneration heals 0 to strength/3 in `increase_age`, and E3 0 to level
    // + 1 (`1010:5889`); a uranium bar diseases by its strength, and E3 by 2.
    if (ability === 46) it.abilStrength = 3 * (old.itemLevel + 1);
    if (ability === 110) it.abilStrength = 2;
    if (isE3NoteAbility(ability)) {
      if (!noteNodes.has(ability)) noteNodes.set(ability, scen!.compile(e3NoteSteps(scen!, ability)));
      it.ability = ItemAbil.CALL_SPECIAL;
      it.abilStrength = noteNodes.get(ability)!;
      it.ineptOk = true;
    }
    return it;
  });
  write('items.xml', itemsXml(items));

  // Conversations, and the shops they open.
  const speakers: E3Speaker[] = towns.flatMap((t) => townCreatures(t).flatMap((c, index) =>
    c.number > 0 && c.personality > 0
      ? [{ town: t.number, index, personality: c.personality, extra1: c.extra1, extra2: c.extra2 }] : []));
  const shops = standardShops();
  // The scenario's own specials: scripted replies, and the daily reset their
  // day stamps need.
  const talk = convertE3Talk(readE3Talk(strings), speakers, shopTables, E3_TOWN_COUNT, shops.length, foodBase, scen);
  const newDay = scen.dailyReset(DAILY_FLAGS, dailyPlot(scen));
  e3Src.shop = talk.shop;
  // Special items: a name and a description each, from string 1801.
  const specialItems = Array.from({ length: E3_SPECIAL_ITEMS }, (_, k) => {
    const item = makeSpecItem();
    item.name = strings.get(1801 + 2 * k) ?? '';
    item.descr = strings.get(1802 + 2 * k) ?? '';
    return item;
  });

  // For the browser's test panel (`?debug=1`): E3's spot numbers, so a
  // spot can be matched with its line in `towns/`.
  type DebugSpots = SpotScript['spots'];
  // Flags written `0x…` in the panel are party-record offsets, as in the C.
  const debug = { zones: {} as Record<number, DebugSpots>, towns: {} as Record<number, DebugSpots>, flagOffset: 0x84 };
  zones.forEach((z, i) => {
    const base = `out/out${i % E3_ZONES_WIDE}~${Math.floor(i / E3_ZONES_WIDE)}`;
    const spots = z.specialLocs.map((loc, k) => ({ loc, id: z.specialId[k] ?? 0 }));
    // The converter's own spots on town entrances (`EntranceMark`).
    const marks = [...FORT_ENTRANCES, ...WOLF_PIT_ENTRANCES].filter((e) => e.zone === i);
    const own = ZONE_SCRIPTS.get(i);
    marks.forEach((m, k) => spots.push({ loc: m.loc, id: ENTRANCE_MARK_SPOT + k }));
    // The groups in `sectorXml`'s order: special encounters, then wandering.
    const groupScripts: GroupScript = (b) => [...z.specialEnc, ...z.wandering]
      .map((g) => ({ key: [g.words[0], ...g.words.slice(3)].join(), ...e3GroupSteps(b, g) }));
    const firstMonster = (g: number) => z.specialEnc[g]?.monst.find((m) => m > 0);
    const zoneSrc: ScriptSource = {
      ...e3Src,
      encounterPic: (g) => {
        const m = firstMonster(g);
        const pic = m === undefined ? undefined : monsterArt.pics[m];
        return pic === undefined ? undefined : [pic, 3];
      },
    };
    const script = e3SpotScript(spots, { zone: i }, zoneSrc, (x, y) => z.terrain[x]?.[y] ?? 0, !marks.length ? own
      : (b) => new Map([...own?.(b) ?? [], ...marks.map((m, k): [number, Step[]] => [ENTRANCE_MARK_SPOT + k, [b.setFlag(m.flag, m.value)]])]),
    undefined, undefined, groupScripts);
    write(`${base}.xml`, sectorXml(z, i, strings, script));
    write(`${base}.map`, sectorMap(z, i, strings, script));
    write(`${base}.spec`, script.spec);
    debug.zones[i] = script.spots;
    progress(0.1 + 0.3 * (i + 1) / zones.length);
  });
  const template = villageTemplate(towns);
  // Each village some of whose buildings can fall to ruin, and the hidden
  // record after E3's 200 that holds it in ruins (`village.ts`).
  const ruins = new Map<number, { record: number; buildings: RuinableBuilding[] }>();
  for (const t of towns) {
    if (!t.village) continue;
    const buildings = ruinableBuildings(t.village);
    if (buildings.some((bd) => bd.day >= 0) || (t.townChopTime > 0 && buildings.length > 0)) {
      ruins.set(t.number, { record: E3_TOWN_COUNT + ruins.size, buildings });
    }
  }
  const townCount = E3_TOWN_COUNT + ruins.size;
  const villageZone = new Map<number, number>();
  zones.forEach((z, i) => z.exitDests.forEach((d, e) => {
    if (!isUnusedLoc(z.exitLocs[e]!) && !villageZone.has(d)) villageZone.set(d, i);
  }));
  towns.forEach((t) => {
    const base = `towns/town${t.number}`;
    // A village is built from its record (village.ts), in the caves if its
    // entrance is: E3 decides by the party's zone column.
    const underground = villageZone.get(t.number) !== undefined && villageZone.get(t.number)! % E3_ZONES_WIDE >= 7;
    const terrain = townTer255(t.number, t.village ? buildE3Village(template, t.village, underground, t.number) : t.terrain);
    let spots = t.specialLocs.map((loc, k) => ({ loc, id: t.specId[k] ?? 255 }));
    // The Slime Pit's pools are spots of their own (`towns/slimePit.ts`), in
    // place of the spot 0 two of them had, which does nothing.
    // Replaced in place, and the rest added after, so no other spot's index
    // (which names its once-only flag, `e3SpotFlag`) moves.
    if (t.number === 23) {
      const pool = (l: { x: number; y: number }) => SLIME_POOLS.findIndex(([x, y]) => l.x === x && l.y === y);
      spots = spots.map((s) => (pool(s.loc) >= 0 ? { ...s, id: POOL_SPOT + pool(s.loc) } : s));
      spots.push(...SLIME_POOLS.flatMap(([x, y], i) => (spots.some((s) => s.id === POOL_SPOT + i) ? [] : [{ loc: { x, y }, id: POOL_SPOT + i }])));
    }
    const creatures = townCreatures(t);
    const entry = townEntryScript(t.number, new Set(creatures.map((c) => c.number)),
      creatures.filter((c) => c.number >= 138 && c.number <= 141).map((c) => c.startLoc), t.entryMsg, t.deadMsg);
    const ruin = ruins.get(t.number);
    const script = e3SpotScript(spots, { town: t.number }, { ...e3Src, creatures, terrain },
      (x, y) => terrain[x]?.[y] ?? 0, TOWN_SCRIPTS.get(t.number),
      ruin ? (b, dead) => [...villageRuinSteps(b, t, ruin.record, ruin.buildings), ...entry?.(b, dead) ?? []] : entry,
      townKillScript(t.number, creatures), undefined, HOSTILE_SCRIPTS.get(t.number), TIMER_SCRIPTS.get(t.number),
      townTalkScript(creatures));
    write(`${base}.xml`, townXml(t, townName(strings, t.number), talk.personalityOf, strings, script, townTables));
    write(`${base}.map`, townMap(t, terrain, strings, script, vehicles));
    write(`${base}.spec`, script.spec);
    debug.towns[t.number] = script.spots;
    progress(0.4 + 0.5 * (t.number + 1) / towns.length);
    // Talk block b is talk<b>.xml, whichever town its people live in.
    const speech = talk.speeches[t.number];
    write(`towns/talk${t.number}.xml`, speech ? dialogueXml(speech, t.number) : `${XML_HEAD}<dialogue boes="2.0.0">\n</dialogue>\n`);
    if (ruin) {
      // The village in ruins: never entered, only copied from.
      const ruined = townTer255(t.number, buildE3Village(template, t.village!, underground, t.number, true));
      const rb = `towns/town${ruin.record}`;
      write(`${rb}.xml`, ruinTownXml(`${townName(strings, t.number)} (ruins)`));
      write(`${rb}.map`, mapFile(ruined, VILLAGE_SIZE, new Map()));
      write(`${rb}.spec`, '');
      write(`towns/talk${ruin.record}.xml`, `${XML_HEAD}<dialogue boes="2.0.0">\n</dialogue>\n`);
    }
  });
  write('debug.json', JSON.stringify(debug));
  // E3's job boards (src/game/e3Jobs.ts): their text, as scenario strings.
  // Deliveries match the target's engine personality, E3's less one, so no
  // target may have been cloned for a shop.
  for (const p of E3_JOB_TARGET_PERSONALITY) {
    for (const s of speakers) {
      if (s.personality === p && talk.personalityOf.get(`${s.town}:${s.index}`) !== p - 1)
        throw new Error(`job target personality ${p} was cloned; e3Jobs.ts matches E3's number`);
    }
  }
  const jobBase = scen.strings.length;
  for (const str of e3JobStrings((id) => strings.get(id) ?? '', e3Src.exeString!)) scen.text(str);
  // Last, since the places' scripts may add scenario strings and nodes.
  write('scenario.spec', scen.spec);
  // Last, since the places' scripts can add shops of their own.
  shops.push(...talk.shops);
  const cursors = readE3Cursors(resources);
  write('scenario.xml', scenarioXml(start, findTownEntrance(zones, start.town, FORT_START_ZONE), shops, specialItems, scen.strings, newDay, readE3RoadJoins(files.exe), jobBase, e3JournalStrings((id) => strings.get(id) ?? ''), cursors, townCount));
  const sheets = [...terrainSheets, ...monsterArt.sheets, buildItemSheet(read), ...e3MapSheets(read)];
  sheets.forEach((s, i) => write(`graphics/sheet${i}.png`, encodePng(s)));
  // E3's own sounds, which a scenario's `sounds/SNDn.wav` puts in place of
  // the engine's (OBoE's `ResMgr::sounds.pushPath`). Resource k + 1 is sound
  // k: `play_sound(n)` loads resource n + 1. Twelve of the hundred are not
  // BoE's: 7, 13, 16 (entering a town), 21, 22, 23, 34, 57 (the message box),
  // 78, 79 (swapped), 90 and 99.
  for (const [id, wav] of readSounds(resources)) write(`sounds/SND${id - 1}.wav`, wav);
  for (const c of cursors) write(`cursors/${c.name}.png`, encodePng(c.image));
  // E3's dialog pictures and talking faces, in place of the game's own sheets
  // (OBoE's override sheets, fileio_scen.cpp:2431). Same grids as BoE's:
  // 36×36 four across, and 32×32 ten across. E3 has fewer of each; the
  // engine keeps BoE's beyond them (`installSheetOverrides`).
  for (const [name, bmp] of E3_SHEET_OVERRIDES) write(`graphics/${name}.png`, encodePng(decodeBmp(read(bmp))));
  write('graphics/pixpats.png', encodePng(buildE3Patterns(read)));
  for (const [name, img] of e3Panels(read)) write(`graphics/${name}.png`, encodePng(img));
  write('graphics/textbar.png', encodePng(decodeBmp(read('TEXTBAR.BMP'))));
  // E3's instant help, string block 10 (3000 + n), which its `give_help`
  // (`FUN_1008_38d6`) shows by 1997's numbers — the engine's too — in place
  // of BoE's wording. A number E3 has no string for keeps BoE's.
  write('strings/help.txt', Array.from({ length: 300 }, (_, k) => strings.get(3001 + k) ?? '').join('\n') + '\n');
  progress(1);
  return { sectors: zones.length, towns: towns.length, sheets: sheets.length };
}
