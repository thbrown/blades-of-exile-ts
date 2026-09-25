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
import { readNeResources, readStringTable } from './ne';
import { E3_ZONES_HIGH, E3_ZONES_WIDE, readE3Outdoors, type E3Outdoor } from './outdoor';
import { readE3Items, readE3Monsters, readE3Start, readE3Terrain, type E3TerrainType } from './tables';
import { E3_TOWN_COUNT, readE3Towns, type E3CreatureStart, type E3Town } from './town';
import { dialogueXml, esc, itemsXml, monstersXml, shopXml, specialItemXml } from './xmlWrite';
import { convertE3Talk, readE3Talk, type E3Speaker } from './talk';
import { readE3ShopTables, standardShops } from './shops';
import { e3DayReached, e3Event, e3Flag } from './flags';
import { buildE3Village, villageTemplate } from './village';
import { makeSpecItem, type SpecItem } from '../../src/data/quest';
import type { Shop } from '../../src/data/shop';

const ATTITUDE = ['docile', 'hostile-a', 'friendly', 'hostile-b'];
const BLOCKAGE = ['none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight'];
const LIGHTING = ['lit', 'dark', 'drains', 'none'];
/** Town entrance markers for `start_locs[0..3]` (`loadTownMapData`). */
const ENTRANCE_MARK = ['v', '<', '^', '>'];

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

function sectorXml(z: E3Outdoor): string {
  const areas = z.infoRect
    .map((r, i) => ({ r, name: z.areaNames[i] ?? '' }))
    .filter((a) => a.name !== '')
    .map((a) => `    <area top="${a.r.top}" left="${a.r.left}" bottom="${a.r.bottom}" right="${a.r.right}">${esc(a.name)}</area>\n`);
  // TODO(E3-2): wandering and special-encounter groups, once monsters convert.
  // TODO(E3-3): signs' text and the special encounters (`special_id`).
  return `${XML_HEAD}<sector boes="2.0.0">\n    <name>${esc(z.name)}</name>\n${areas.join('')}</sector>\n`;
}

function sectorMap(z: E3Outdoor): string {
  const marks = new Map<string, string>();
  z.exitLocs.forEach((l, i) => {
    const dest = z.exitDests[i] ?? -1;
    if (!isUnusedLoc(l) && dest >= 0 && dest < E3_TOWN_COUNT) addMark(marks, l.x, l.y, `@${dest}`);
  });
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
  // skips row 0 and 200 up). TODO(E3-3): 200–204 are creatures a script
  // brings in (`FUN_1090_4053`); they start absent.
  const sdf = c.spec1 > 0 && c.spec1 < 200 && c.spec2 < 10 ? e3Flag(c.spec1, c.spec2) : null;
  return `    <creature id="${id}">
        <type>${c.number}</type>
        <attitude>${ATTITUDE[c.startAttitude] ?? 'docile'}</attitude>
        <mobility>${c.mobile}</mobility>
${sdf ? `        <sdf x="${sdf[0]}" y="${sdf[1]}" />\n` : ''}${creatureTimeXml(c)}        <personality>${personality}</personality>
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

function townXml(t: E3Town, name: string, personalityOf: Map<string, number>): string {
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
  // TODO(E3-2): room names.
  return `${XML_HEAD}<town boes="2.0.0">
    <size>${size}</size>
    <name>${esc(name)}</name>
    <bounds top="${r.top}" left="${r.left}" bottom="${r.bottom}" right="${r.right}" />
    <difficulty>0</difficulty>
    <lighting>${LIGHTING[t.lighting] ?? 'lit'}</lighting>
    <flags>
${chopXml(t)}    </flags>
${items}${creatures}</town>
`;
}

function townMap(t: E3Town, villageTerrain: number[][] | null): string {
  const size = townSize(t);
  const terrain = villageTerrain ?? t.terrain;
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
  return mapFile(terrain, size, marks);
}

function scenarioXml(
  start: { town: number; loc: { x: number; y: number } },
  outStart: { sector: { x: number; y: number }; loc: { x: number; y: number } },
  shops: Shop[], specialItems: SpecItem[],
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
${shops.map(shopXml).join('')}${specialItems.map(specialItemXml).join('')}    </game>
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
  const strings = readStringTable(readNeResources(files.exe));
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
  write('scenario.spec', '');
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
    return it;
  });
  write('items.xml', itemsXml(items));

  // Conversations, and the shops they open.
  const speakers: E3Speaker[] = towns.flatMap((t) => townCreatures(t).flatMap((c, index) =>
    c.number > 0 && c.personality > 0
      ? [{ town: t.number, index, personality: c.personality, extra1: c.extra1, extra2: c.extra2 }] : []));
  const shops = standardShops();
  const talk = convertE3Talk(readE3Talk(strings), speakers, shopTables, E3_TOWN_COUNT, shops.length, foodBase);
  shops.push(...talk.shops);
  // Special items: a name and a description each, from string 1801.
  const specialItems = Array.from({ length: E3_SPECIAL_ITEMS }, (_, k) => {
    const item = makeSpecItem();
    item.name = strings.get(1801 + 2 * k) ?? '';
    item.descr = strings.get(1802 + 2 * k) ?? '';
    return item;
  });
  write('scenario.xml', scenarioXml(start, findTownEntrance(zones, start.town), shops, specialItems));

  zones.forEach((z, i) => {
    const base = `out/out${i % E3_ZONES_WIDE}~${Math.floor(i / E3_ZONES_WIDE)}`;
    write(`${base}.xml`, sectorXml(z));
    write(`${base}.map`, sectorMap(z));
    write(`${base}.spec`, '');
  });
  const template = villageTemplate(towns);
  const villageZone = new Map<number, number>();
  zones.forEach((z, i) => z.exitDests.forEach((d, e) => {
    if (!isUnusedLoc(z.exitLocs[e]!) && !villageZone.has(d)) villageZone.set(d, i);
  }));
  towns.forEach((t) => {
    const base = `towns/town${t.number}`;
    write(`${base}.xml`, townXml(t, townName(strings, t.number), talk.personalityOf));
    // A village is built from its record (village.ts), in the caves if its
    // entrance is: E3 decides by the party's zone column.
    const underground = villageZone.get(t.number) !== undefined && villageZone.get(t.number)! % E3_ZONES_WIDE >= 7;
    write(`${base}.map`, townMap(t, t.village ? buildE3Village(template, t.village, underground, t.number) : null));
    write(`${base}.spec`, '');
    // Talk block b is talk<b>.xml, whichever town its people live in.
    const speech = talk.speeches[t.number];
    write(`towns/talk${t.number}.xml`, speech ? dialogueXml(speech, t.number) : `${XML_HEAD}<dialogue boes="2.0.0">\n</dialogue>\n`);
  });
  const sheets = [...terrainSheets, ...monsterArt.sheets, buildItemSheet(e3Dir)];
  sheets.forEach((s, i) => write(`graphics/sheet${i}.png`, encodePng(s)));
  return { sectors: zones.length, towns: towns.length, sheets: sheets.length };
}
