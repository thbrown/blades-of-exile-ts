/**
 * Writes Exile 3 out as an unpacked v2 scenario tree, the layout of
 * `public/scenarios/<id>/` that the engine loads like any other scenario.
 *
 * E3-1 scope: the world's shape. Terrain, the 90 outdoor zones as sectors
 * with their names, areas and town entrances, and all 200 towns' maps and
 * entrances. Monsters, items, people, dialogue and every scripted encounter
 * are later milestones, marked `TODO(E3-2)` / `TODO(E3-3)` where they would go.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png';
import { convertItem, convertMonster, convertPresetField } from '../../src/fileio/legacy/convert';
import { buildItemSheet, buildMonsterSheets, buildTerrainSheets, e3TerrainPic } from './graphics';
import { readE3Files } from './install';
import { readDialogs, readNeResources, readNeSegment, readStringTable } from './ne';
import { E3_ZONES_HIGH, E3_ZONES_WIDE, readE3Outdoors, type E3Outdoor, type E3OutWandering } from './outdoor';
import { readE3Items, readE3Monsters, readE3Start, readE3Terrain, type E3TerrainType } from './tables';
import { E3_TOWN_COUNT, readE3Towns, type E3CreatureStart, type E3Town } from './town';
import { dialogueXml, esc, itemsXml, monstersXml, shopXml, specialItemXml } from './xmlWrite';
import { convertE3Talk, e3Text, readE3Talk, type E3Speaker } from './talk';
import { readE3ShopTables, standardShops } from './shops';
import { e3DayReached, e3Event, e3Flag } from './flags';
import { buildE3Village, villageTemplate } from './village';
import { e3SpotScript, type PlaceScript, type SpotScript } from './specials';
import { town21 } from './towns/town21';
import { krizsan } from './towns/krizsan';
import { shayder } from './towns/shayder';
import { ZONE_SCRIPTS } from './towns/zones';
import { DAILY_FLAGS } from './towns/talkScripts';
import { SpecBuilder, type ScriptSource } from './script';
import { BASIC_BUTTONS } from '../../src/game/specials/oneshot';
import { makeSpecItem, type SpecItem } from '../../src/data/quest';
import type { Shop } from '../../src/data/shop';

const ATTITUDE = ['docile', 'hostile-a', 'friendly', 'hostile-b'];
const BLOCKAGE = ['none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight'];
const LIGHTING = ['lit', 'dark', 'drains', 'none'];
/** Town entrance markers for `start_locs[0..3]` (`loadTownMapData`). */
const ENTRANCE_MARK = ['v', '<', '^', '>'];

/** The towns whose own encounters are transcribed so far (E3-3). */
const TOWN_SCRIPTS = new Map<number, PlaceScript>([
  [21, town21], ...[0, 1, 2, 3].map((t): [number, PlaceScript] => [t, krizsan(t)]),
  ...[4, 5, 6, 7].map((t): [number, PlaceScript] => [t, shayder(t)]),
]);

/** E3's special items: strings 1801 on, and the engine's limit too. */
const E3_SPECIAL_ITEMS = 50;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n';

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

/** A terrain's `<special>`: its E3 door behaviour, in BoE's terms. */
function specialXml(t: E3TerrainType): string {
  const sp = t.special;
  const [type, f1, f2, f3] = !sp ? ['none', -1, 0, 0]
    : sp.kind === 'sign' ? ['sign', 0, 0, 0]
    : sp.kind === 'step-change' ? ['step-change', sp.to, sp.sound, 0]
    // BoE's `unlock`: flag2 is the difficulty, 5 and up beyond picking and
    // bashing; flag3 1 lets it be bashed. TODO(E3-3): E3 rolls its own pick
    // (`FUN_10d8_3f67`: success over 35 on its roll), not BoE's formula.
    : ['unlock', sp.to, sp.pickable ? 1 : 10, sp.pickable ? 1 : 0];
  return `        <special>
            <type>${type}</type>
            <flag>${f1}</flag>
            <flag>${f2}</flag>
            <flag>${f3}</flag>
        </special>`;
}

function terrainXml(types: E3TerrainType[]): string {
  const out = [XML_HEAD, '<terrains boes="2.0.0">\n'];
  types.forEach((t, id) => {
    const pic = e3TerrainPic(t.pic);
    out.push(`    <terrain id="${id}">
        <name>${esc(t.name)}</name>
        <pic>${pic}</pic>
        <map>${pic}</map>
        <blockage>${BLOCKAGE[t.blockage] ?? 'none'}</blockage>
        <transform>${id}</transform>
        <fly>false</fly>
        <boat>${t.boat}</boat>
        <ride>${t.blockage < 3}</ride>
        <archetype>false</archetype>
        <light>0</light>
        <step-sound>step</step-sound>
        <trim>none</trim>
        <ground>0</ground>
        <trim-for>-1</trim-for>
        <arena>0</arena>
${specialXml(t)}
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
 * `<encounter>` ones are placed by scripts. TODO(E3-3): the meeting script
 * (`+10`), and `(+18, +20)` and `+22`, whose meaning is still open
 * (outdoor.ts).
 */
function outGroupXml(tag: 'wandering' | 'encounter', g: E3OutWandering): string {
  const [, end1 = 0, end2 = 0] = g.words;
  const sdf = end1 > 0 && end2 > 0 ? e3Flag(end1, end2) : [-1, -1];
  const monsters = [
    ...g.monst.map((m) => `        <monster>${m}</monster>\n`),
    ...g.friendly.map((m) => `        <monster friendly="true">${m}</monster>\n`),
  ].join('');
  return `    <${tag} can-flee="${g.gap[0] === 1 ? 'false' : 'true'}" force="false">
${monsters}        <onmeet>-1</onmeet>
        <onwin>-1</onwin>
        <onflee>-1</onflee>
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
  // TODO(E3-3): the encounters below 100, which are each zone's own code.
  const groups = [...z.specialEnc.map((g) => outGroupXml('encounter', g)), ...z.wandering.map((g) => outGroupXml('wandering', g))];
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

function creatureXml(c: E3CreatureStart, id: number, personality: number): string {
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
${sdf ? `        <sdf x="${sdf[0]}" y="${sdf[1]}" />\n` : ''}${code ? `        <encounter>${code}</encounter>\n` : ''}${creatureTimeXml(c)}        <personality>${personality}</personality>
    </creature>
`;
}

/**
 * When a town is overrun: E3's villages fall to the monsters on a day unless
 * a plot event comes first (the town loader, `10d8:0f51`), and any town is
 * "cleaned out" once more than `max_num_monst` of its creatures are killed.
 * TODO(E3-3): E3's overrun spares the town's hostile creatures (attitude
 * odd) as well as its `after-death` ones; the engine's spares only the
 * latter.
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

function townXml(t: E3Town, name: string, personalityOf: Map<string, number>, strings: Map<number, string>, script: SpotScript): string {
  const size = townSize(t);
  const r = t.village ? { top: 0, left: 0, bottom: size - 1, right: size - 1 } : t.inTownRect;
  const creatures = townCreatures(t)
    .map((c, i) => (c.number > 0 ? creatureXml(c, i, personalityOf.get(`${t.number}:${i}`) ?? -1) : '')).join('');
  // Preset items: the legacy field called `ability` holds the charges, as in
  // BoE (`loadLegacy.ts`); -1 is an empty slot.
  const items = t.presetItems.map((p, i) => (p.itemCode < 0 ? '' : `    <item id="${i}">
        <type>${p.itemCode}</type>
        <charges>${p.ability}</charges>
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
    <flags>
${chopXml(t)}    </flags>
${wandering}${items}${creatures}${rooms}${townSigns(t, strings).map(signXml).join('')}${specStringsXml(script)}</town>
`;
}

function townMap(t: E3Town, terrain: number[][], strings: Map<number, string>, script: SpotScript): string {
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
  return mapFile(terrain, size, marks);
}

function scenarioXml(
  start: { town: number; loc: { x: number; y: number } },
  outStart: { sector: { x: number; y: number }; loc: { x: number; y: number } },
  shops: Shop[], specialItems: SpecItem[], specStrings: string[], newDay: number,
): string {
  return `${XML_HEAD}<scenario boes="2.0.0">
    <title>Exile III: Ruined World</title>
    <icon>0</icon>
    <id>exile3</id>
    <version>0.1.0</version>
    <language>en-US</language>
    <author>
        <name>Jeff Vogel</name>
        <email>Spiderweb Software. Converted from the user's own copy by tools/e3convert.</email>
    </author>
    <text>
        <teaser>Exile III: Ruined World (1997), converted to run in exile-js.</teaser>
        <teaser>The world and its towns only, so far: no people, monsters or quests yet.</teaser>
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
        <num-towns>${E3_TOWN_COUNT}</num-towns>
        <out-width>${E3_ZONES_WIDE}</out-width>
        <out-height>${E3_ZONES_HIGH}</out-height>
        <start-town>${start.town}</start-town>
        <town-start x="${start.loc.x}" y="${start.loc.y}" />
        <outdoor-start x="${outStart.sector.x}" y="${outStart.sector.y}" />
        <sector-start x="${outStart.loc.x}" y="${outStart.loc.y}" />
${shops.map(shopXml).join('')}${specialItems.map(specialItemXml).join('')}        <timer freq="3700">${newDay}</timer>
${specStrings.map((str, i) => `        <string id="${i}">${esc(str)}</string>\n`).join('')}    </game>
</scenario>
`;
}

/** Where the start town opens onto the world: the zone exit that leads to it. */
function findTownEntrance(zones: E3Outdoor[], town: number): { sector: { x: number; y: number }; loc: { x: number; y: number } } {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!;
    for (let e = 0; e < z.exitLocs.length; e++) {
      const l = z.exitLocs[e]!;
      if (z.exitDests[e] === town && !isUnusedLoc(l)) {
        return { sector: { x: i % E3_ZONES_WIDE, y: Math.floor(i / E3_ZONES_WIDE) }, loc: l };
      }
    }
  }
  throw new Error(`no outdoor entrance leads to town ${town}`);
}

export interface EmitSummary { sectors: number; towns: number; sheets: number }

export function emitScenario(e3Dir: string, outDir: string): EmitSummary {
  const files = readE3Files(e3Dir);
  const resources = readNeResources(files.exe);
  const strings = readStringTable(resources);
  const e3Src: ScriptSource = {
    strings, dialogs: readDialogs(resources),
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

  const write = (rel: string, data: string | Uint8Array): void => {
    const full = join(outDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, data);
  };

  // header.exs: the OBoE marker every unpacked tree carries.
  write('header.exs', new Uint8Array([0x4f, 0x42, 0x4f, 0x45, 0x01, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x04]));
  write('terrain.xml', terrainXml(terrain));
  // Monsters: E3's table through the legacy importer, drawn from E3's own
  // sprites cut into custom sheets after the terrain's.
  const terrainSheets = buildTerrainSheets(e3Dir);
  const legacyMonsters = readE3Monsters(files.exe, strings);
  const monsterArt = buildMonsterSheets(e3Dir,
    legacyMonsters.map((m) => ({ pic: m.pictureNum, w: m.xWidth, h: m.yWidth })), terrainSheets.length);
  const monsters = legacyMonsters.map((m, n) => {
    const mon = convertMonster(m);
    mon.pictureNum = monsterArt.pics[n]!;
    return mon;
  });
  write('monsters.xml', monstersXml(monsters));
  // Items: E3's table through the legacy importer, pictured from one custom
  // sheet after the monsters'.
  const itemSheetNum = terrainSheets.length + monsterArt.sheets.length;
  // E3's food isn't in its item table: the food shops sell from a list of
  // their own (shops.ts), which goes on the end.
  const shopTables = readE3ShopTables(files.exe);
  const e3Items = readE3Items(files.exe);
  const foodBase = e3Items.length;
  const items = [...e3Items, ...shopTables.food].map((old) => {
    const it = convertItem(old);
    it.graphicNum = 1000 + itemSheetNum * 100 + old.graphicNum;
    // E3's scripts name kinds of item by `type_flag` (unicorn horns are 111);
    // the engine's item-class nodes read the special class.
    if (old.typeFlag > 0) it.specialClass = old.typeFlag;
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
  const scen = new SpecBuilder(e3Src, (label) => Math.max(0, BASIC_BUTTONS.indexOf(label)));
  const talk = convertE3Talk(readE3Talk(strings), speakers, shopTables, E3_TOWN_COUNT, shops.length, foodBase, scen);
  const newDay = scen.dailyReset(DAILY_FLAGS);
  write('scenario.spec', scen.spec);
  shops.push(...talk.shops);
  // Special items: a name and a description each, from string 1801.
  const specialItems = Array.from({ length: E3_SPECIAL_ITEMS }, (_, k) => {
    const item = makeSpecItem();
    item.name = strings.get(1801 + 2 * k) ?? '';
    item.descr = strings.get(1802 + 2 * k) ?? '';
    return item;
  });
  write('scenario.xml', scenarioXml(start, findTownEntrance(zones, start.town), shops, specialItems, scen.strings, newDay));

  zones.forEach((z, i) => {
    const base = `out/out${i % E3_ZONES_WIDE}~${Math.floor(i / E3_ZONES_WIDE)}`;
    const spots = z.specialLocs.map((loc, k) => ({ loc, id: z.specialId[k] ?? 0 }));
    const script = e3SpotScript(spots, { zone: i }, e3Src, (x, y) => z.terrain[x]?.[y] ?? 0, ZONE_SCRIPTS.get(i));
    write(`${base}.xml`, sectorXml(z, i, strings, script));
    write(`${base}.map`, sectorMap(z, i, strings, script));
    write(`${base}.spec`, script.spec);
  });
  const template = villageTemplate(towns);
  const villageZone = new Map<number, number>();
  zones.forEach((z, i) => z.exitDests.forEach((d, e) => {
    if (!isUnusedLoc(z.exitLocs[e]!) && !villageZone.has(d)) villageZone.set(d, i);
  }));
  towns.forEach((t) => {
    const base = `towns/town${t.number}`;
    // A village is built from its record (village.ts), in the caves if its
    // entrance is: E3 decides by the party's zone column.
    const underground = villageZone.get(t.number) !== undefined && villageZone.get(t.number)! % E3_ZONES_WIDE >= 7;
    const terrain = t.village ? buildE3Village(template, t.village, underground, t.number) : t.terrain;
    const spots = t.specialLocs.map((loc, k) => ({ loc, id: t.specId[k] ?? 255 }));
    const script = e3SpotScript(spots, { town: t.number }, { ...e3Src, creatures: townCreatures(t) },  (x, y) => terrain[x]?.[y] ?? 0, TOWN_SCRIPTS.get(t.number));
    write(`${base}.xml`, townXml(t, townName(strings, t.number), talk.personalityOf, strings, script));
    write(`${base}.map`, townMap(t, terrain, strings, script));
    write(`${base}.spec`, script.spec);
    // Talk block b is talk<b>.xml, whichever town its people live in.
    const speech = talk.speeches[t.number];
    write(`towns/talk${t.number}.xml`, speech ? dialogueXml(speech, t.number) : `${XML_HEAD}<dialogue boes="2.0.0">\n</dialogue>\n`);
  });
  const sheets = [...terrainSheets, ...monsterArt.sheets, buildItemSheet(e3Dir)];
  sheets.forEach((s, i) => write(`graphics/sheet${i}.png`, encodePng(s)));
  return { sectors: zones.length, towns: towns.length, sheets: sheets.length };
}
