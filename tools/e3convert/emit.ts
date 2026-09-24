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
import { buildTerrainSheets, e3TerrainPic } from './graphics';
import { readE3Files } from './install';
import { readNeResources, readStringTable } from './ne';
import { E3_ZONES_HIGH, E3_ZONES_WIDE, readE3Outdoors, type E3Outdoor } from './outdoor';
import { readE3Start, readE3Terrain, type E3TerrainType } from './tables';
import { E3_TOWN_COUNT, readE3Towns, type E3Town } from './town';

const BLOCKAGE = ['none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight'];
const LIGHTING = ['lit', 'dark', 'drains', 'none'];
/** Town entrance markers for `start_locs[0..3]` (`loadTownMapData`). */
const ENTRANCE_MARK = ['v', '<', '^', '>'];
/** Plain grass, the ground E3's village builder starts from (`FUN_1040_1600`). */
const GRASS = 2;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    if (!isUnusedLoc(l) && dest >= 0) addMark(marks, l.x, l.y, `@${dest}`);
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

function townXml(t: E3Town, name: string): string {
  const size = townSize(t);
  const r = t.village ? { top: 0, left: 0, bottom: size - 1, right: size - 1 } : t.inTownRect;
  // TODO(E3-2): creatures, preset items and fields, room names.
  return `${XML_HEAD}<town boes="2.0.0">
    <size>${size}</size>
    <name>${esc(name)}</name>
    <bounds top="${r.top}" left="${r.left}" bottom="${r.bottom}" right="${r.right}" />
    <difficulty>0</difficulty>
    <lighting>${LIGHTING[t.lighting] ?? 'lit'}</lighting>
    <flags />
</town>
`;
}

function townMap(t: E3Town): string {
  const size = townSize(t);
  // TODO(E3-2): villages are assembled from 8×8 building blocks by
  // `FUN_1040_1600`; until that is ported they are bare grass.
  const terrain = t.village
    ? Array.from({ length: size }, () => Array<number>(size).fill(GRASS))
    : t.terrain;
  const marks = new Map<string, string>();
  t.startLocs.forEach((l, i) => {
    if (l.x >= 0 && l.x < size && l.y >= 0 && l.y < size) addMark(marks, l.x, l.y, ENTRANCE_MARK[i] ?? '');
  });
  return mapFile(terrain, size, marks);
}

function scenarioXml(start: { town: number; loc: { x: number; y: number } }, outStart: { sector: { x: number; y: number }; loc: { x: number; y: number } }): string {
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
    </game>
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
  write('scenario.xml', scenarioXml(start, findTownEntrance(zones, start.town)));
  write('scenario.spec', '');
  write('terrain.xml', terrainXml(terrain));
  // TODO(E3-2): E3's monster and item tables.
  write('items.xml', `${XML_HEAD}<items boes="2.0.0">\n</items>\n`);
  write('monsters.xml', `${XML_HEAD}<monsters boes="2.0.0">\n</monsters>\n`);

  zones.forEach((z, i) => {
    const base = `out/out${i % E3_ZONES_WIDE}~${Math.floor(i / E3_ZONES_WIDE)}`;
    write(`${base}.xml`, sectorXml(z));
    write(`${base}.map`, sectorMap(z));
    write(`${base}.spec`, '');
  });
  towns.forEach((t) => {
    const base = `towns/town${t.number}`;
    write(`${base}.xml`, townXml(t, townName(strings, t.number)));
    write(`${base}.map`, townMap(t));
    write(`${base}.spec`, '');
    // TODO(E3-2): conversations.
    write(`towns/talk${t.number}.xml`, `${XML_HEAD}<dialogue boes="2.0.0">\n</dialogue>\n`);
  });
  const sheets = buildTerrainSheets(e3Dir);
  sheets.forEach((s, i) => write(`graphics/sheet${i}.png`, encodePng(s)));
  return { sectors: zones.length, towns: towns.length, sheets: sheets.length };
}
