/**
 * The Exile 3 converter end to end: convert the game (unpacked from the
 * committed installer, `vendor/exile3/`) into a scratch directory and load the
 * result with the engine's own loader.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import type { Scenario } from '../src/data/scenario';
import { ItemAbil, ItemType } from '../src/data/item';
import { MonstTime } from '../src/data/monster';
import { ShopItemType, ShopPrompt } from '../src/data/shop';
import { TalkNodeType } from '../src/data/talking';
import { SpecType } from '../src/data/special';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir } from '../tools/e3convert/install';
import { neAutoDataSegment, readNeSegment } from '../tools/e3convert/ne';
import { GameRng } from '../src/core/rng';
import { Town } from '../src/data/town';
import { Universe } from '../src/universe/universe';
import { PartyPreset } from '../src/universe/player';
import { GameSession } from '../src/game/session';
import { Direction } from '../src/core/location';
import {
  createE3OutCombatTerrain, E3_ARENA_GROUND, E3_ARENA_ODDS, E3_ARENA_STAMP_LOCS, E3_ARENA_WALLS,
  E3_CAVE_LAKE, E3_CAVE_PILLAR, E3_MNTN_PILLAR, E3_SURF_LAKE,
} from '../src/game/e3Arena';

const dir = findE3Dir();

describe.skipIf(!dir)('Exile 3 converted', () => {
  const out = mkdtempSync(join(tmpdir(), 'e3convert-'));
  let scen: Scenario;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    const opcodes = buildOpcodeTable(
      readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'));
    scen = await loadScenario(new FsSource(out), opcodes);
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('starts where a new game of Exile 3 does', () => {
    expect(scen.title).toBe('Exile III: Ruined World');
    expect(scen.startTown).toBe(21);
    expect(scen.towns[21]?.name).toBe('Fort Emergence');
    // The sector-level start is the fort's entrance on the caves side, so
    // the south gate leads back down toward Exile (`towns/town21.ts`).
    expect(scen.outdoorStart).toEqual({ x: 8, y: 9 });
    expect(scen.sectorStart).toEqual({ x: 36, y: 36 });
    // Both of the fort's entrances note which side the party came in by.
    expect(scen.outdoors[8]![9]!.specialLocs.some((s) => s.x === 36 && s.y === 36)).toBe(true);
    expect(scen.outdoors[1]![8]!.specialLocs.some((s) => s.x === 20 && s.y === 25)).toBe(true);
  });

  it("enters towns by E3's town terrains, 217 to 231", () => {
    for (let t = 217; t <= 231; t++) expect(scen.terTypes[t]?.special).toBe(TerSpec.TOWN_ENTRANCE);
    expect(scen.terTypes[216]?.special).not.toBe(TerSpec.TOWN_ENTRANCE);
    // Krizsan's gate, (19..21, 33) of zone (2,9).
    const sector = scen.outdoors[2]![9]!;
    expect(scen.terTypes[sector.terrain[20]![33]!]?.special).toBe(TerSpec.TOWN_ENTRANCE);
    expect(sector.cityLocs.find((c) => c.x === 20 && c.y === 33)?.spec).toBe(0);
  });

  it('lets the party walk into every town from the world', async () => {
    // From each square beside an entrance that can be stood on, one step in.
    // Town 92 (the roaches' pit, zone 46) is ringed by trees in E3's data.
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const toward: [number, number, Direction][] = [[0, 1, Direction.N], [0, -1, Direction.S], [-1, 0, Direction.E], [1, 0, Direction.W]];
    const missed: string[] = [];
    for (let sx = 0; sx < scen.outWidth; sx++) for (let sy = 0; sy < scen.outHeight; sy++) {
      const sector = scen.outdoors[sx]![sy]!;
      for (const city of sector.cityLocs) {
        let entered = false;
        for (const [dx, dy, dir] of toward) {
          const x = city.x + dx, y = city.y + dy;
          if (x < 0 || y < 0 || x > 47 || y > 47 || sector.cityLocs.some((c) => c.x === x && c.y === y)) continue;
          if (scen.terTypes[sector.terrain[x]![y]!]!.blockage >= TerObstruct.BLOCK_MOVE) continue;
          session.debugLeaveTown();
          session.positionParty(sx, sy, x, y);
          await session.move(dir);
          if (session.inTown && session.univ.party.townNum === city.spec) { entered = true; break; }
        }
        if (!entered) missed.push(`town ${city.spec} at (${sx},${sy}) ${city.x},${city.y}`);
      }
    }
    // Tinraya's gate is two squares wide, and its west one is only reached
    // through the east.
    expect(missed).toEqual(['town 35 at (1,1) 28,15', 'town 92 at (1,5) 19,32']);
  });

  it('draws roads as ground with the road field, as BoE 1997 does', () => {
    // A grass road takes grass's picture; the hub and arms come from the field.
    expect(scen.terTypes[233]?.picture).toBe(scen.terTypes[2]?.picture);
    expect(scen.terTypes[232]?.picture).toBe(scen.terTypes[0]?.picture);
    expect(scen.terTypes[234]?.picture).toBe(scen.terTypes[36]?.picture);
    const sector = scen.outdoors[2]![5]!;
    expect(sector.terrain[46]![1]).toBe(233);
    expect(sector.roads[46]![1]).toBe(true);
    expect(sector.roads[45]![1]).toBe(false);
    // Arms reach into what E3's list names: bridges, doors, towns, walkways.
    const joins = scen.featureFlags['road-joins']!.split(',').map(Number);
    for (const t of [65, 103, 219, 221, 232, 233, 234, 245]) expect(joins).toContain(t);
    expect(joins).not.toContain(2);
  });

  it("marks E3's containers, so the dresser in the first room can be searched", () => {
    expect(scen.terTypes[174]?.name).toBe('Dresser');
    expect(scen.terTypes[174]?.special).toBe(TerSpec.IS_A_CONTAINER);
    const gold = scen.towns[21]!.presetItems.find((p) => p.loc.x === 58 && p.loc.y === 4);
    expect(gold).toMatchObject({ code: 0, charges: 40, contained: true });
  });

  it('lays out 90 zones as a 9×10 world with their names', () => {
    expect(scen.outWidth).toBe(9);
    expect(scen.outHeight).toBe(10);
    expect(scen.outdoors[0]?.[0]?.name).toBe('Northwestern Valorim');
    expect(scen.outdoors[1]?.[0]?.cityLocs.map((c) => c.spec)).toEqual([62, 63, 63]);
  });

  it('keeps E3 terrain: its names, pictures, blockage and doors', () => {
    expect(scen.terTypes[0]?.name).toBe('Cave Floor');
    expect(scen.terTypes[5]?.picture).toBe(1005);
    expect(scen.terTypes[5]?.blockage).toBe(TerObstruct.BLOCK_MOVE_AND_SIGHT);
    // Animated: E3 picture 303 (rocks in water) is the fourth animation.
    expect(scen.terTypes[74]?.picture).toBe(2000 + 300 + 4 * 3);
    expect(scen.terTypes[74]?.boatOver).toBe(true);
    // A closed door opens into an open one; a locked one needs picking.
    expect(scen.terTypes[103]?.special).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
    expect(scen.terTypes[103]?.flag1).toBe(107);
    expect(scen.terTypes[107]?.name).toBe('Open Door');
    expect(scen.terTypes[104]?.special).toBe(TerSpec.UNLOCKABLE);
  });

  it("builds outdoor arenas from E3's own tables", () => {
    // The engine's copies of FUN_10d8_342b's tables match EXILE3.EXE's.
    const exe = new Uint8Array(readFileSync(join(dir as string, 'EXILE3.EXE')));
    const ds = readNeSegment(exe, neAutoDataSegment(exe));
    const words = (at: number, n: number) => Array.from({ length: n }, (_, i) => ds[at + 2 * i]! | (ds[at + 2 * i + 1]! << 8));
    expect(words(0x3a50, 14)).toEqual(E3_ARENA_GROUND);
    expect(words(0x3a6c, 14)).toEqual(E3_ARENA_WALLS);
    expect(Array.from({ length: 14 }, (_, a) => words(0x3ae6 + 20 * a, 10))).toEqual(E3_ARENA_ODDS);
    expect(Array.from({ length: 15 }, (_, i) => [ds[0x3a88 + 2 * i], ds[0x3a89 + 2 * i]])).toEqual(E3_ARENA_STAMP_LOCS);
    const bytes = (at: number) => Array.from(ds.subarray(at, at + 16));
    expect([bytes(0x3aa6), bytes(0x3ab6), bytes(0x3ac6), bytes(0x3ad6)])
      .toEqual([E3_CAVE_PILLAR, E3_MNTN_PILLAR, E3_SURF_LAKE, E3_CAVE_LAKE]);
    // Each terrain carries its arena kind, and the scenario asks for E3's arenas.
    expect(scen.featureFlags['outdoor-arena']).toBe('exile3');
    expect(scen.terTypes.map((t) => t.combatArena)).toEqual(words(0x3850, 256).map((w) => (w << 16) >> 16));
    // A grass arena is grass and E3's plants inside E3's border, and nothing
    // from BoE's numbering (BoE's border is 90, E3's swamp).
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const arena = new Town(48);
    createE3OutCombatTerrain(univ, arena, 2, 0);
    expect(arena.terrain[0]![5]).toBe(86);
    const inside = new Set(arena.terrain.slice(9, 35).flatMap((col) => col.slice(9, 35)));
    for (const t of inside) expect([2, 3, 4, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 90, 91, 93, 94]).toContain(t);
    // A road is paved with walkway down the middle.
    createE3OutCombatTerrain(univ, arena, 233, 0);
    expect(arena.terrain[20]![20]).toBe(245);
  });

  it("has E3's monsters, with E3's own stats and sprites", () => {
    expect(scen.scenMonsters).toHaveLength(191);
    const guard = scen.scenMonsters[12]!;
    expect(guard.name).toBe('Guard');
    expect([guard.level, guard.health, guard.armor]).toEqual([30, 140, 30]);
    // E3's guard swings 2d10, where BoE's bladbase rebalanced it to 3d10.
    expect(guard.attacks[0]).toMatchObject({ dice: 2, sides: 10 });
    expect(guard.pictureNum).toBeGreaterThanOrEqual(1400); // a custom sheet after the terrain's
    const giant = scen.scenMonsters[54]!;
    expect(giant.name).toBe('Cave Giant');
    expect([giant.xWidth, giant.yWidth]).toEqual([1, 2]);
    expect(scen.scenMonsters[177]?.name).toBe('Rentar-Ihrno');
  });

  it("has E3's items, and the things lying about its towns", () => {
    // E3's 415, then the fifteen food records its food shops sell from,
    // then the notes its scripts make readable (E3_NOTE_ITEMS), which show
    // their dialog through a scenario special.
    expect(scen.scenItems).toHaveLength(432);
    expect(scen.scenItems[430]).toMatchObject({ fullName: 'Piece of Paper', ability: ItemAbil.CALL_SPECIAL });
    expect(scen.scenItems[415]).toMatchObject({ fullName: 'Crude Rations', variety: ItemType.FOOD, itemLevel: 10, value: 24 });
    const knife = scen.scenItems[41]!;
    expect(knife.fullName).toBe('Bronze Knife');
    expect([knife.itemLevel, knife.value, knife.weight]).toEqual([4, 16, 7]);
    expect(knife.graphicNum).toBeGreaterThanOrEqual(1000);
    const krizsan = scen.towns[0]!;
    expect(krizsan.presetItems[0]).toMatchObject({ code: 9, loc: { x: 6, y: 19 }, alwaysThere: true });
    expect(krizsan.presetFields.length).toBeGreaterThan(0);
  });

  it("has E3's conversations, keyed to its people", () => {
    // E3 personalities are 1-based; the fort's official (20) is Anaximander,
    // the engine's 19, in talk block 1.
    const official = scen.towns[21]!.creatures.find((c) => c.number === 33)!;
    expect(official.personality).toBe(19);
    const who = scen.townTalk[1]!.people[9]!;
    expect(who.title).toBe('Anaximander');
    expect(who.job).toMatch(/^"It is my job to give you instruction/);
    const nodes = scen.townTalk[1]!.talkNodes.filter((n) => n.personality === 19);
    expect(nodes.map((n) => n.link1)).toContain('surf');
  });

  it('opens shops stocked from the shopkeeper, at E3\'s prices', () => {
    // The five magic shops and the healer come first, as in any scenario.
    expect(scen.shops[5]?.prompt).toBe(ShopPrompt.HEALING);
    const shopOf = (town: number, x: number, y: number) => {
      const who = scen.towns[town]!.creatures.find((c) => c.startLoc.x === x && c.startLoc.y === y)!;
      const node = scen.townTalk[Math.floor(who.personality / 10)]!.talkNodes
        .find((n) => n.personality === who.personality && n.type === TalkNodeType.SHOP)!;
      return { node, shop: scen.shops[node.extras[1]!]! };
    };
    // Jinx in Krizsan sells entries 30–49 of E3's list, at price level 3.
    const jinx = shopOf(0, 18, 26);
    expect(jinx.shop.name).toBe("Jinx's Weaponry");
    expect(jinx.node.extras[0]).toBe(3);
    expect(jinx.shop.items.map((e) => e.item.fullName)).toContain('Bronze Knife');
    // Velnas sells E3's low-level spells, which BoE never sold, at E3's price.
    const velnas = shopOf(16, 15, 27).shop;
    expect(velnas.prompt).toBe(ShopPrompt.MAGE);
    expect(velnas.items[0]).toMatchObject({ type: ShopItemType.MAGE_SPELL, index: 6, item: { value: 1500 } });
  });

  it('gives a personality shared by villages one copy per shop', () => {
    // E3's personality 1 is a weaponsmith in six villages, each with its own stock.
    const smiths = [127, 132].map((t) => scen.towns[t]!.creatures.find((c) => c.personality >= 0 && c.startLoc.x === (t === 127 ? 39 : 15))!);
    expect(smiths[0]!.personality).toBe(0);
    expect(smiths[1]!.personality).toBeGreaterThanOrEqual(390);
  });

  it("has E3's special items", () => {
    expect(scen.specialItems).toHaveLength(50);
    expect(scen.specialItems[16]?.name).toBe('Silver Key');
  });

  it('makes people come and go, and villages fall, on E3\'s days', () => {
    // Two in the fort wait for plot event 4 (the engine's key 5).
    const waiting = scen.towns[21]!.creatures.filter((c) => c.timeFlag === MonstTime.APPEAR_WHEN_EVENT);
    expect(waiting.map((c) => c.timeCode)).toEqual([5, 5, 5]);
    // Delis falls on E3's day 60, which is the engine's 80.
    expect(scen.towns[121]!.townChopTime).toBe(80);
    expect(scen.towns[121]!.creatures.some((c) => c.timeFlag === MonstTime.APPEAR_AFTER_CHOP)).toBe(true);
  });

  it('builds the villages from their building blocks', () => {
    // Delan: grass, walls, houses and a dock, not a bare field.
    const delan = scen.towns[120]!;
    const tiles = new Set(delan.terrain.flat());
    expect(tiles.size).toBeGreaterThan(20);
    // Every village has a way in: exits past town 127 are unsigned bytes.
    const entrances = scen.outdoors.flat().flatMap((o) => o?.cityLocs.map((c) => c.spec) ?? []);
    expect(entrances.filter((t) => t >= 128).length).toBe(49);
  });

  it('has signs to read and rooms with names', () => {
    const krizsan = scen.towns[0]!;
    const sign = krizsan.signLocs[0]!;
    expect(sign.text).toBe('KRIZSAN SHIPYARD');
    expect(scen.terTypes[krizsan.terrain[sign.x]![sign.y]!]?.special).toBe(TerSpec.IS_A_SIGN);
    expect(krizsan.areaDesc.map((a) => a.descr)).toContain("Jinx's Smithy");
    const zone = scen.outdoors[0]![0]!;
    expect(zone.signLocs[0]?.text).toMatch(/^VALORIM IS DECLARED UNDER QUARANTINE/);
  });

  it('has wandering monsters, in towns and on the world', () => {
    // Around Fort Emergence: a group that stops coming once flag (307,3) is set.
    const zone = scen.outdoors[1]![8]!;
    expect(zone.wandering[0]).toMatchObject({ monst: [0, 0, 0, 0, 138, 139, 140], endSpec1: 307, endSpec2: 3, cantFlee: true });
    expect(zone.wanderingLocs[0]).toEqual({ x: 42, y: 42 });
    expect(scen.towns[11]!.wandering[0]).toEqual([149, 149, 150, 150]);
  });

  it('turns E3\'s message spots into one-shot special nodes', () => {
    const krizsan = scen.towns[0]!;
    const spot = krizsan.specialLocs.find((l) => l.x === 24 && l.y === 7)!;
    const node = krizsan.specials.get(spot.spec)!;
    expect(node.type).toBe(SpecType.ONCE_DISPLAY_MSG);
    expect(krizsan.specStrs[node.m1]).toMatch(/^This is the inn's common room/);
    // A flag of the converter's own, in a column E3 never uses.
    expect([node.sd1, node.sd2]).toEqual([0, 16]);
  });

  it("runs Fort Emergence's own scripts: Anaximander's briefing first", () => {
    const fort = scen.towns[21]!;
    const office = fort.specialLocs.find((l) => l.x === 5 && l.y === 7)!;
    // The dispatcher's guard first: spot 1's own flag at 20 means done.
    const guard = fort.specials.get(office.spec)!;
    expect([guard.type, guard.sd1, guard.sd2, guard.ex1a]).toEqual([SpecType.IF_SDF_EQ, 21, 1, 20]);
    const first = fort.specials.get(guard.jumpto)!;
    // Then E3's flag (307,0): not yet briefed.
    expect(first.type).toBe(SpecType.IF_SDF_EQ);
    expect([first.sd1, first.sd2, first.ex1a]).toEqual([307, 0, 0]);
    const briefing = fort.specials.get(first.ex1b)!;
    expect(briefing.type).toBe(SpecType.ONCE_DIALOG);
    expect(fort.specStrs[briefing.m1]).toMatch(/^You pass through the door/);
  });

  it('turns scripted replies into scenario specials, with a new day each 3700 ticks', () => {
    // Levy (E3 personality 21) pays an allowance: talk type 100.
    const node = scen.townTalk[2]!.talkNodes.find((n) => n.personality === 20 && n.link1 === 'allo')!;
    expect(node.type).toBe(TalkNodeType.CALL_SCEN_SPEC);
    const first = scen.scenSpecials.get(node.extras[0]!)!;
    expect(first.type).toBe(SpecType.IF_SDF_EQ);
    expect(scen.scenarioTimers).toEqual([{ time: 3700, node: expect.any(Number) }]);
  });

  it('places the fort\'s people', () => {
    const fort = scen.towns[21]!;
    expect(fort.creatures.filter((c) => c.number > 0).length).toBeGreaterThan(40);
  });

  it('has all 200 towns, their maps sized by record number', () => {
    expect(scen.towns).toHaveLength(200);
    expect(scen.towns[0]?.maxDim).toBe(64);
    expect(scen.towns[45]?.maxDim).toBe(48);
    expect(scen.towns[80]?.maxDim).toBe(32);
    expect(scen.towns[120]?.name).toBe('Delan');
  });
});

/**
 * What the browser does (src/platform/exile3Worker.ts): unpack the committed
 * installer, convert in memory, pack a `.boes`, and load it as an installed
 * package — with its graphics sheets.
 */
describe("Exile III converted in memory, as the browser does", () => {
  it('packs a .boes the engine loads', async () => {
    const { gzipSync } = await import('fflate');
    const { convertE3 } = await import('../tools/e3convert/emit');
    const { E3_INSTALLER, unpackE3Installer } = await import('../tools/e3convert/installer');
    const { writeTar } = await import('../src/fileio/tarball');
    const { loadScenarioPackage } = await import('../src/fileio/scenarioPackage');
    const files = unpackE3Installer(new Uint8Array(readFileSync(E3_INSTALLER)));
    const entries: { name: string; data: Uint8Array }[] = [];
    let last = 0;
    convertE3((n) => files.get(n)!, (path, data) => {
      entries.push({ name: `scenario/${path}`, data: typeof data === 'string' ? new TextEncoder().encode(data) : data });
    }, (done) => { last = done; });
    expect(last).toBe(1);
    const opcodes = buildOpcodeTable(
      readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'));
    const loaded = await loadScenarioPackage(
      { id: 'exile3', fileName: 'exile3.boes', kind: 'boes', data: gzipSync(writeTar(entries)) }, opcodes);
    expect(loaded.scenario.title).toBe('Exile III: Ruined World');
    expect(loaded.scenario.towns.length).toBe(200);
    expect(loaded.sheets.length).toBe(12);
  }, 120000);
});
