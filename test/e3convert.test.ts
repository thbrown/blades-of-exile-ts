/**
 * The Exile 3 converter end to end: convert the game (unpacked from the
 * committed installer, `vendor/exile3/`) into a scratch directory and load the
 * result with the engine's own loader.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import type { Scenario } from '../src/data/scenario';
import { ItemAbil, ItemType, useMagic } from '../src/data/item';
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
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { killMonst } from '../src/game/damage';
import { makeTownHostile } from '../src/game/townAttitude';
import { MainStatus, Race, Status } from '../src/universe/skills';
import { Direction } from '../src/core/location';
import {
  createE3OutCombatTerrain, E3_ARENA_GROUND, E3_ARENA_ODDS, E3_ARENA_STAMP_LOCS, E3_ARENA_WALLS,
  E3_CAVE_LAKE, E3_CAVE_PILLAR, E3_MNTN_PILLAR, E3_SURF_LAKE,
} from '../src/game/e3Arena';

import {
  E3_JOB_BANK_LOCS, E3_JOB_TARGET_LOCS, E3_JOB_TARGET_PERSONALITY, deliverE3Jobs, e3JobKill, e3JobText,
  e3Jobs, e3JobsBase, e3JobsTick, e3ZoneDistance, takeE3Job,
} from '../src/game/e3Jobs';
import { readE3JobTables } from '../tools/e3convert/jobs';
import { GENERATORS } from '../tools/e3convert/towns/shiftingFloors';
import { e3DayCount, e3TownState } from '../tools/e3convert/flags';
import { specialIncreaseAge } from '../src/game/specialIncreaseAge';
import { loadSave, saveGame } from '../src/fileio/saveIo';
import { SpecCtx, SpecCtxType } from '../src/game/specials/context';
import { partyFlag } from '../tools/e3convert/script';

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
    // Every town found, so the hidden ones' entrances are there to walk into.
    for (const town of scen.towns) town.canFind = true;
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

  it("hides E3's fifteen towns until something shows them", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    // E3's own 200; the villages' ruins records after them are hidden too.
    const hidden = scen.towns.slice(0, 200).flatMap((t, i) => (t.canFind ? [] : [i]));
    expect(scen.towns.slice(200).every((t) => !t.canFind)).toBe(true);
    expect(hidden).toEqual([22, 26, 32, 54, 70, 71, 74, 75, 76, 77, 78, 79, 86, 87, 92]);
    // Town 22's entrance, zone 84 (3,9) at (22,41), is terrain 223, which
    // shows as 26 while hidden (DS:3c0a) and can't be walked into.
    expect(scen.terTypes[223]!.flag1).toBe(26);
    const party = session.univ.party;
    const walkIn = async (): Promise<number> => {
      session.debugLeaveTown();
      session.positionParty(3, 9, 22, 42);
      const shown = session.univ.out.at(48 * (3 - party.outdoorCorner.x) + 22, 48 * (9 - party.outdoorCorner.y) + 41);
      await session.move(Direction.N);
      return session.inTown ? party.townNum : shown;
    };
    expect(await walkIn()).toBe(26);
    scen.towns[22]!.canFind = true;
    expect(await walkIn()).toBe(22);
    scen.towns[22]!.canFind = false;
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

  it("burns on terrain 75, E3's lava, and not on 76", () => {
    expect(scen.terTypes[75]).toMatchObject({ name: 'Lava', special: TerSpec.DAMAGING, flag1: 10, flag2: 8, flag3: 1 });
    expect(scen.terTypes[76]?.special).toBe(TerSpec.BLOCKED_TO_MONSTERS);
    expect(scen.featureFlags['lava']).toBe('exile3');
    // Fort Emergence, where the play-test found it cold.
    expect(scen.towns[21]!.terrain.some((col) => col.includes(75))).toBe(true);
  });

  it("enters E3's lit dungeons with the dungeon sound", () => {
    expect(scen.featureFlags['dungeon-sound']).toBe('22-23,25-33,35-38,44-47,50-79,86,200');
  });

  it("gives each dialog E3's own picture", async () => {
    const { e3DialogPic, E3_PANELS, E3_SHEET_OVERRIDES } = await import('../tools/e3convert/emit');
    const { e3TerrainPic } = await import('../tools/e3convert/graphics');
    const { EXILE3_SHEET_OVERRIDES } = await import('../src/platform/exile3');
    const sprites = new Map([[12, 1468]]);
    expect(e3DialogPic(722, sprites)).toEqual([22, 4]);
    expect(e3DialogPic(1003, sprites)).toEqual([3, 5]);
    expect(e3DialogPic(38, sprites)).toEqual([e3TerrainPic(38), 1]);
    expect(e3DialogPic(412, sprites)).toEqual([1468, 3]);
    expect(e3DialogPic(905, sprites)).toBeUndefined();
    // The maps and carvings: a sheet each from `mapBase`, shown whole.
    expect(e3DialogPic(905, sprites, 12)).toEqual([17, 111]);
    expect(e3DialogPic(910, sprites, 12)).toBeUndefined();
    expect(EXILE3_SHEET_OVERRIDES).toEqual([
      ...E3_SHEET_OVERRIDES.map(([n]) => n), 'pixpats', ...E3_PANELS.map(([n]) => n), 'textbar']);
    // The nodes carry them: dialog pictures, E3 terrain and E3 sprites. (No
    // dialog with a face has been transcribed yet.)
    const kinds = new Set<number>();
    for (const node of [...scen.scenSpecials.values(), ...scen.towns.flatMap((t) => [...t.specials.values()])]) {
      if (node.pic !== 0 || node.pictype !== 4) kinds.add(node.pictype);
    }
    expect([...kinds]).toEqual(expect.arrayContaining([1, 3, 4]));
  });

  it("tiles the window with E3's own patterns", async () => {
    const { e3Background, E3_PATTERN_SLOTS, BG_LIGHT } = await import('../src/render/tiling');
    expect(scen.featureFlags['backgrounds']).toBe('exile3');
    // E3's dialog pattern, 2, is OBoE's light dialog background, which E3
    // makes the default.
    expect(E3_PATTERN_SLOTS[2]).toBe(BG_LIGHT);
    expect(E3_PATTERN_SLOTS).not.toContain(5);
    expect(e3Background('out', true, 0)).toBe(E3_PATTERN_SLOTS[0]);
    expect(e3Background('out', false, 0)).toBe(E3_PATTERN_SLOTS[7]);
    expect(e3Background('fight', true, 0)).toBe(E3_PATTERN_SLOTS[9]);
    expect(e3Background('town', true, 21)).toBe(E3_PATTERN_SLOTS[4]);
    expect(e3Background('town', true, 22)).toBe(E3_PATTERN_SLOTS[5]);
    expect(new Set(E3_PATTERN_SLOTS).size).toBe(10);
  });

  it("gives E3's locked doors its bash limits", () => {
    expect(scen.featureFlags['bash']).toBe('exile3');
    // Stone and adobe break at 25 or under, basalt at 10; past picking, never.
    expect([104, 136, 121, 105, 106].map((t) => scen.terTypes[t]?.flag3)).toEqual([25, 25, 10, 0, 0]);
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
    // And Use closes an open one again, in all three styles of wall.
    for (const base of [101, 118, 133]) {
      expect(scen.terTypes[base + 6]?.special).toBe(TerSpec.CHANGE_WHEN_USED);
      expect(scen.terTypes[base + 6]?.flag1).toBe(base + 2);
      expect(scen.terTypes[base + 6]?.flag2).toBe(59);
    }
  });

  it('closes an open door when the party uses it', async () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(21, FORCED_ENTRY);
    const town = univ.town!;
    const at = univ.party.townLoc;
    const door = { x: at.x + 1, y: at.y };
    town.record.terrain[door.x]![door.y] = 107;
    expect(await session.handleUseSpace(door)).toBe(true);
    expect(town.record.terrain[door.x]![door.y]).toBe(103);
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
    // (256 is the converter's copy of 255, which only towns use.)
    expect(scen.terTypes.slice(0, 256).map((t) => t.combatArena)).toEqual(words(0x3850, 256).map((w) => (w << 16) >> 16));
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

  it("runs E3's job boards: generated jobs, taken, delivered and failed", async () => {
    // The engine's copies of E3's tables match EXILE3.EXE's.
    const exe = new Uint8Array(readFileSync(join(dir as string, 'EXILE3.EXE')));
    const tables = readE3JobTables(exe);
    expect(tables.personality).toEqual(E3_JOB_TARGET_PERSONALITY);
    expect(tables.targetLocs).toEqual(E3_JOB_TARGET_LOCS);
    expect(tables.bankLocs).toEqual(E3_JOB_BANK_LOCS);

    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const univ = session.univ;
    expect(e3JobsBase(univ)).not.toBeNull();
    const state = e3Jobs(univ);
    const offered = state.boards.flat().filter((j) => j.kind > 0);
    expect(offered.length).toBeGreaterThan(8);
    for (const j of offered) {
      expect(E3_JOB_TARGET_PERSONALITY[j.target]).toBeGreaterThan(0);
      expect(e3ZoneDistance(E3_JOB_BANK_LOCS[j.bank]!, E3_JOB_TARGET_LOCS[j.target]!)).toBeGreaterThan(0);
      expect(e3JobText(univ, j, false).text).toMatch(/^(Rush )?(Message|Delivery|Magical Supplies): We need someone to .* within \d+ days\. .*Pay is \d+ gold\.$/);
    }

    // A message job, taken from board 0 on day 1, to Kessle in Krizsan.
    Object.assign(state.boards[0]![0]!, { kind: 1, target: 0, days: 10 });
    expect(e3JobText(univ, state.boards[0]![0]!, false).text).toBe(
      'Message: We need someone to convey an important message to Kessle the Innkeeper, in Krizsan, within 10 days. Pay is 60 gold.');
    expect(takeE3Job(univ, state, 0, 0)).toBe(true);
    expect(state.boards[0]![0]!.kind).toBe(0);
    expect(state.held[0]).toMatchObject({ kind: 1, days: 11, bank: 0 });
    expect(e3JobText(univ, state.held[0]!, true).text).toContain('You must convey an important message to Kessle');

    // It saves and loads.
    const loaded = loadSave(saveGame(univ), scen, new GameRng());
    expect(loaded.party.e3Jobs).toEqual(state);

    // Talking to Kessle pays for it.
    const gold = univ.party.gold;
    await deliverE3Jobs(session, E3_JOB_TARGET_PERSONALITY[0]! - 1);
    expect(univ.party.gold).toBe(gold + 60);
    expect(state.held[0]!.kind).toBe(0);

    // A supplies job wants its monster slain first.
    state.held[1] = { kind: 3, extra: 58, days: 30, target: 0, bank: 1 };
    await deliverE3Jobs(session, E3_JOB_TARGET_PERSONALITY[0]! - 1);
    expect(state.held[1]!.kind).toBe(3);
    e3JobKill(session, 58);
    expect(state.held[1]!.extra).toBe(-1);
    await deliverE3Jobs(session, E3_JOB_TARGET_PERSONALITY[0]! - 1);
    expect(state.held[1]!.kind).toBe(0);

    // A job past its last day fails, and its board turns the party away.
    state.held[2] = { kind: 2, extra: 3, days: univ.party.calcDay(), target: 5, bank: 2 };
    const before = univ.party.age;
    univ.party.age += 3700;
    e3JobsTick(session, before);
    expect(state.held[2]!.kind).toBe(0);
    expect(state.failed[2]).toBe(true);
    // Crossing 4,000 ticks rolls the boards afresh.
    const boards = JSON.stringify(state.boards);
    const at = univ.party.age;
    univ.party.age = Math.ceil((at + 1) / 4000) * 4000;
    e3JobsTick(session, at);
    expect(JSON.stringify(state.boards)).not.toBe(boards);
  });

  it('says what a plague monster is the first time the party sees one', async () => {
    expect(scen.featureFlags['monster-sightings']).toBe('exile3');
    // Every slime shares one sighting; an ordinary monster has none.
    const slime = scen.scenMonsters[0x8a]!.seeSpec;
    expect(slime).toBeGreaterThanOrEqual(0);
    expect(scen.scenMonsters[0x8d]!.seeSpec).toBe(slime);
    expect(scen.scenMonsters[1]!.seeSpec).toBe(-1);
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: string[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    const party = session.univ.party;
    // Anaximander's report waits on party+0xc83, which the sighting sets.
    await session.runSpecial(SpecCtx.SEE_MONST, SpecCtxType.SCEN, slime, { x: 0, y: 0 });
    expect(party.getSdf(...partyFlag(0xc83))).toBe(1);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^This is very odd/);
    // Once only.
    await session.runSpecial(SpecCtx.SEE_MONST, SpecCtxType.SCEN, slime, { x: 0, y: 0 });
    expect(said).toHaveLength(1);
  });

  it("runs E3's boss kills: the Alien Slime's death is what Anaximander hears of", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const dialogs: number[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? () => Promise.resolve() : () => Promise.resolve(0)),
    }) as never);
    session.startTownMode(23, FORCED_ENTRY);
    const univ = session.univ;
    // E3's spec2 0xc9, on the slime in slot 41 alone.
    const slime = univ.town!.monsters[41]!;
    expect(slime.number).toBe(0x8e);
    expect(slime.specialOnKill).toBeGreaterThanOrEqual(0);
    expect(univ.town!.monsters.filter((m) => m.specialOnKill === slime.specialOnKill)).toHaveLength(1);
    killMonst(univ, slime, 0, MainStatus.DEAD, session);
    await session.settled();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(univ.party.getSdf(...partyFlag(0xc85))).toBe(1);
    expect(univ.party.journal.map((e) => e.theStr)).toEqual([expect.stringMatching(/^Destroyed magical creature/)]);
    // Every other creature in the lair is gone with it.
    expect(univ.town!.monsters.filter((m) => m.isAlive)).toHaveLength(0);
    void dialogs;
  });

  it("runs E3's outdoor group scripts: the Nephilim patrol, and a lair's loot", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: string[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    const univ = session.univ;
    session.debugLeaveTown();
    // Zone 76, (4,8): both wandering groups are script 0x6e.
    session.positionParty(4, 8, 24, 24);
    const meet = async () => {
      const slot = univ.party.outC[0]!;
      slot.exists = true;
      slot.whatMonst = scen.outdoors[4]![8]!.wandering[0]!;
      slot.mLoc = { x: univ.party.outLoc.x + 1, y: univ.party.outLoc.y };
      return session.checkOutdoorEncounter();
    };
    // A Nephil among the living: the patrol lets the party be.
    univ.party.pcs[0]!.race = Race.NEPHIL;
    expect(await meet()).toBe(false);
    expect(said.pop()).toMatch(/see you have a Nephil/);
    // Without one, it attacks.
    for (const pc of univ.party.pcs) pc.race = Race.HUMAN;
    expect(await meet()).toBe(true);
    expect(said.pop()).toMatch(/perfectly understandable that they attack/);

    // Zone 5's special group (script 0x8c) pays out when beaten.
    const lair = scen.outdoors[5]![0]!.specialEnc[0]!;
    expect(lair.specOnWin).toBeGreaterThanOrEqual(0);
    expect(lair.forced).toBe(false);
    session.positionParty(5, 0, 24, 24);
    const gold = univ.party.gold;
    await session.runSpecial(SpecCtx.WIN_ENCOUNTER, SpecCtxType.OUTDOOR, lair.specOnWin, univ.party.locInSec);
    expect(univ.party.gold).toBe(gold + 600);
    expect(said.pop()).toMatch(/You search the bodies. You find gold/);
    expect(univ.party.pcs.flatMap((pc) => pc.items).some((it) => it.fullName === 'Orb of Sight')).toBe(true);
    // Zone 74's special group (script 99) comes for the party from anywhere.
    expect(scen.outdoors[2]![8]!.specialEnc[0]!.forced).toBe(true);
  });

  it("drowns whoever stands in the Filth Factory's trench as the flow restarts", async () => {
    // The countdown's chain is the scenario node that asks for town 26.
    const chain = [...scen.scenSpecials].find(([, n]) => n.type === SpecType.IF_TOWN_NUM && n.ex1a === 26)![0];
    const halted = partyFlag(0x191);
    const setUp = async () => {
      const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      const said: string[] = [];
      session.attachSpecials(new Proxy({}, {
        get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
      }) as never);
      session.startTownMode(26, 0);
      await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
      said.length = 0;
      session.univ.party.setSdf(...halted, 1);
      const flow = () => session.runSpecial(SpecCtx.SCEN_TIMER, SpecCtxType.SCEN, chain, { x: 0, y: 0 });
      return { session, said, party: session.univ.party, flow };
    };
    const alive = (party: Universe['party']) => party.pcs.map((pc) => pc.mainStatus === MainStatus.ALIVE);

    // Town mode, beside the trench: a warning, and nobody hurt.
    let t = await setUp();
    t.party.townLoc = { x: 48, y: 37 };
    await t.flow();
    expect(t.said).toHaveLength(1);
    expect(alive(t.party).every(Boolean)).toBe(true);

    // Town mode, in it: the whole party is gone.
    t = await setUp();
    t.party.townLoc = { x: 48, y: 34 };
    await t.flow();
    expect(t.said).toHaveLength(1);
    expect(t.party.isAlive()).toBe(false);

    // Combat, with the party's square in the trench but only PC 1 in it:
    // the warning, then PC 1 drowns, alone.
    t = await setUp();
    t.party.townLoc = { x: 48, y: 34 };
    expect(t.session.startCombat(Direction.N)).toBe(true);
    t.party.pcs.forEach((pc, i) => { pc.combatPos = { x: 44 + i, y: 38 }; });
    t.party.pcs[1]!.combatPos = { x: 50, y: 35 };
    await t.flow();
    expect(t.said).toHaveLength(2);
    expect(t.party.pcs[1]!.mainStatus).toBe(MainStatus.DEAD);
    expect(alive(t.party).filter(Boolean)).toHaveLength(5);
  });

  it("rests at an inn as E3 does: 500 ticks, and statuses stay", () => {
    expect(scen.featureFlags['inn']).toBe('exile3');
    const t = scen.townTalk.findIndex((talk) => talk.talkNodes.some(
      (n) => n.type === TalkNodeType.INN && n.personality >= 0));
    expect(t).toBeGreaterThanOrEqual(0);
    const index = scen.townTalk[t]!.talkNodes.findIndex(
      (n) => n.type === TalkNodeType.INN && n.personality >= 0);
    const node = scen.townTalk[t]!.talkNodes[index]!;
    const [price, b, x, y] = node.extras;
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const { party } = session.univ;
    session.startTownMode(t, FORCED_ENTRY);
    session.startTalkMode(-1, node.personality, 0, -1);
    party.gold = price! + 100;
    party.pcs.forEach((pc) => { pc.curHealth = 1; });
    party.pcs[0]!.status[Status.POISON] = 3;
    const age = party.age;
    session.chooseTalkNode(index);
    expect(party.gold).toBe(100);
    expect(party.age).toBe(age + 500);
    expect(party.pcs[0]!.curHealth).toBe(Math.min(1 + 30 * b!, party.pcs[0]!.maxHealth));
    expect(party.pcs[0]!.status[Status.POISON]).toBe(3);
    expect(party.townLoc).toEqual({ x, y });
  });

  it("ends the game where E3 does as a town turns hostile, and moves only E3's movers", async () => {
    const setUp = (town: number) => {
      const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      const said: string[] = [];
      session.attachSpecials(new Proxy({}, {
        get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
      }) as never);
      session.startTownMode(town, FORCED_ENTRY);
      return { session, said, party: session.univ.party };
    };
    // Fort Emergence: the guards haul the party off.
    const fort = setUp(21);
    const still = fort.session.univ.town!.monsters.filter((m) => m.isAlive && !m.mobile);
    makeTownHostile(fort.session);
    await vi.waitFor(() => expect(fort.party.isAlive()).toBe(false));
    expect(fort.said.join(' ')).toMatch(/very bad place to cause trouble/);
    expect(fort.party.pcs.every((pc) => pc.mainStatus === MainStatus.ABSENT)).toBe(true);
    // Only monsters 12–20, 91–98 and 149–154 get moving.
    const movers = new Set([...Array(9).keys()].map((k) => k + 12).concat([91, 92, 93, 94, 95, 96, 97, 98, 149, 150, 151, 152, 153, 154]));
    expect(still.length).toBeGreaterThan(0);
    for (const m of still) expect(m.mobile).toBe(movers.has(m.number));
    expect(scen.scenMonsters.flatMap((m, i) => (m?.guard ? [i] : []))).toEqual([91, 92]);

    // Erika's Tower: the amulets (special item 32) save the party.
    const erika = setUp(47);
    erika.party.specItems.add(32);
    makeTownHostile(erika.session);
    await vi.waitFor(() => expect(erika.said.join(' ')).toMatch(/amulets protected you/));
    expect(erika.party.isAlive()).toBe(true);
  });

  it("runs the Tower of Shifting Floors' golem generators every eighth tick", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: string[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    session.startTownMode(32, 0);
    await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
    const town = session.univ.town!;
    const party = session.univ.party;
    const golems = () => town.monsters.filter((m) => m.isAlive && m.number >= 159 && m.number <= 163);
    const before = golems().length;
    const clangs = () => session.univ.transcript.filter((l) => l.includes('distant clang')).length;
    // Ten multiples of 8, one tick at a time: a golem each, and never between.
    party.age -= party.age % 8;
    for (let tick = 1; tick <= 80; tick++) {
      party.age++;
      specialIncreaseAge(session);
      await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
      expect(golems().length).toBe(before + Math.floor(tick / 8));
    }
    expect(clangs()).toBe(10);
    // Each one stands north of a generator, hostile and hunting.
    const north = new Set(GENERATORS.map((g) => `${g.x},${g.y - 1}`));
    for (const m of golems().slice(-10)) {
      expect(north.has(`${m.curLoc.x},${m.curLoc.y}`)).toBe(true);
      expect(m.isFriendly).toBe(false);
    }
    // A generator whose flag is set makes nothing (E3 never sets one).
    for (const g of GENERATORS) party.setSdf(...g.flag, 1);
    party.age += 8;
    specialIncreaseAge(session, 8);
    await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
    expect(golems().length).toBe(before + 10);
  });

  it("moves where the party comes out as it takes a passage to another building", async () => {
    // Each passage answers its dialog's second button, and the party comes
    // out by the door of the building it arrives in.
    const through = async (town: number, spot: { x: number; y: number }) => {
      const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      session.attachSpecials(new Proxy({}, {
        get: (_, k) => (k === 'choice' ? () => Promise.resolve(1) : () => Promise.resolve(0)),
      }) as never);
      session.startTownMode(town, FORCED_ENTRY);
      await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
      const s = scen.towns[town]!.specialLocs.find((l) => l.x === spot.x && l.y === spot.y)!;
      await session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, s.spec, spot);
      const { party } = session.univ;
      return { sector: party.sector, loc: party.locInSec };
    };
    const at = (town: number, id: number) => {
      const spots = JSON.parse(readFileSync(join(out, 'debug.json'), 'utf8')) as { towns: Record<string, { id: number; x: number; y: number }[]> };
      return spots.towns[town]!.find((s) => s.id === id)!;
    };
    // The Tower of Shifting Floors (32) and its basement (108) have two doors in zone 14.
    expect(await through(32, at(32, 12))).toEqual({ sector: { x: 5, y: 1 }, loc: { x: 34, y: 4 } });
    expect(await through(108, at(108, 15))).toEqual({ sector: { x: 5, y: 1 }, loc: { x: 34, y: 14 } });
    // Sulfras's lair (57) leads to the other two lairs, in zone 28.
    expect(await through(57, at(57, 11))).toEqual({ sector: { x: 1, y: 3 }, loc: { x: 36, y: 24 } });
    expect(await through(57, at(57, 12))).toEqual({ sector: { x: 1, y: 3 }, loc: { x: 38, y: 25 } });
  });

  it("keeps the converter's own flags off E3's bytes", () => {
    // Columns 0–9 are E3's; the town states once sat on the generators' flags.
    const own = [0, 1, 2, 3, 4].flatMap((k) => [e3TownState(k), e3DayCount(k)]);
    for (const [, col] of own) expect(col).toBeGreaterThanOrEqual(10);
    const key = ([r, c]: readonly number[]) => `${r},${c}`;
    const generators = new Set(GENERATORS.map((g) => key(g.flag)));
    for (const f of own) expect(generators.has(key(f))).toBe(false);
  });

  it("greets a party that walks in, and runs E3's other entry cases", async () => {
    const setUp = () => {
      const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      const said: string[] = [];
      session.attachSpecials(new Proxy({}, {
        get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
      }) as never);
      const enter = async (town: number, dir: number): Promise<string> => {
        said.length = 0;
        session.startTownMode(town, dir);
        await vi.waitFor(() => expect(session.specials!.busy).toBe(false));
        return said.join(' ');
      };
      return { session, enter, party: session.univ.party };
    };
    // The Slime Pit (22): its greeting, and none for a party a script put
    // there; once the slime is dead (0xc85), the cleared-out message.
    const pit = setUp();
    const greeting = await pit.enter(22, 0);
    expect(greeting).not.toBe('');
    expect(await pit.enter(22, FORCED_ENTRY)).toBe('');
    pit.party.setSdf(...partyFlag(0xc85), 1);
    const cleared = await pit.enter(22, 0);
    expect(cleared).not.toBe('');
    expect(cleared).not.toBe(greeting);
    expect(pit.session.univ.transcript).toContain('Area has been cleaned out.');
    expect(pit.session.univ.town!.monsters.some((m) => m.isAlive)).toBe(false);

    // Castle Troglo (28): docile and still until stage 7, hostile after.
    const troglo = setUp();
    await troglo.enter(28, 0);
    const living = () => troglo.session.univ.town!.monsters.filter((m) => m.isAlive);
    expect(living().length).toBeGreaterThan(0);
    expect(living().every((m) => m.attitude === 0 && !m.mobile)).toBe(true);
    troglo.party.setSdf(...partyFlag(0x1a4), 7);
    await troglo.enter(28, 0);
    expect(living().every((m) => m.attitude === 3)).toBe(true);
    expect(living().some((m) => m.mobile)).toBe(true);

    // Wolfrider Warren (82) opens (4,20) only to a party that came in by entrance 3.
    const warren = setUp();
    await warren.enter(82, 0);
    expect(warren.session.univ.town!.record.terrain[4]![20]).not.toBe(0x8d);
    await warren.enter(82, 3);
    expect(warren.session.univ.town!.record.terrain[4]![20]).toBe(0x8d);
  });

  it("tests whether a town shows on the map, as E3's scripts do", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: string[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    const univ = session.univ;
    session.debugLeaveTown();
    // Zone 45 (0,5), spot 8 at (31,37): the roaches' hills, which find the
    // lair once the Filth Factory (town 26) shows on the map.
    session.positionParty(0, 5, 31, 37);
    const step = async (): Promise<string> => {
      said.length = 0;
      await session.runSpecial(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 23, univ.party.locInSec);
      return said.join(' ');
    };
    const hidden = await step();
    expect(hidden).not.toBe('');
    scen.towns[26]!.canFind = true;
    try {
      const shown = await step();
      expect(shown).not.toBe('');
      expect(shown).not.toBe(hidden);
    } finally {
      scen.towns[26]!.canFind = false;
    }
  });

  it("counts the demon plot down by turns, from day 160 to the party's end", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: string[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (s: string) => { said.push(s); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    const univ = session.univ;
    const settle = async () => { while (session.specials!.busy) await new Promise((r) => setTimeout(r, 0)); };
    const turn = async () => { univ.party.age++; specialIncreaseAge(session, 1); await settle(); };
    session.debugLeaveTown();
    univ.party.age = 160 * 3700;
    await session.runSpecial(SpecCtx.SCEN_TIMER, SpecCtxType.SCEN, scen.scenarioTimers[0]!.node, univ.party.outLoc);
    await settle();
    expect(univ.party.getSdf(...partyFlag(0xc91))).toBe(1);
    expect([univ.party.getSdf(292, 10), univ.party.getSdf(292, 11)]).toEqual([20, 0]);
    // Three turns: 1997, Anaximander's first report.
    for (let i = 0; i < 3; i++) await turn();
    expect([univ.party.getSdf(292, 10), univ.party.getSdf(292, 11)]).toEqual([19, 97]);
    expect(said.at(-1)).toMatch(/^Suddenly, without warning/);
    // At 1, away from the Tower, the party is lost.
    univ.party.setSdf(292, 10, 0);
    univ.party.setSdf(292, 11, 2);
    await turn();
    expect(univ.party.pcs.some((pc) => pc.mainStatus === MainStatus.ALIVE)).toBe(false);
  });

  it("moves the horses from all four of a declining town's records, and no boat", () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const { party } = session.univ;
    const mod = scen.townMods.find((m) => m.spec === 0)!;
    expect([mod.span, mod.rehome]).toEqual([4, 'horses']);
    party.horses = [{ ...party.horses[0]!, exists: true, whichTown: 1 }] as never;
    party.boats = [{ ...party.boats[0]!, exists: true, whichTown: 0 }] as never;
    party.setSdf(mod.x, mod.y, 2);
    session.startTownMode(0, FORCED_ENTRY, true);
    expect(party.townNum).toBe(2);
    expect(party.horses[0]!.whichTown).toBe(2);
    expect(party.boats[0]!.whichTown).toBe(0);
  });

  it("swaps in a declining town's later record by day, as E3's loader does", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    session.attachSpecials(new Proxy({}, { get: () => () => Promise.resolve(0) }) as never);
    const univ = session.univ;
    expect(scen.townMods.map((m) => m.spec)).toEqual([0, 4, 8, 12, 16]);
    const newDay = scen.scenarioTimers[0]!.node;
    /** Day `day` begins, and the party walks into Krizsan (record 0). */
    const krizsanOn = async (day: number): Promise<number> => {
      univ.party.age = (day - 1) * 3700;
      await session.runSpecial(SpecCtx.SCEN_TIMER, SpecCtxType.SCEN, newDay, univ.party.outLoc);
      session.startTownMode(0, FORCED_ENTRY);
      // Its entry chain (the slimes' decals) runs on its own; the next
      // day's timer would queue behind it.
      while (session.specials!.busy) await new Promise((r) => setTimeout(r, 0));
      return univ.party.townNum;
    };
    // E3's days 10, 25 and 55, plus day_reached's 20.
    expect(await krizsanOn(29)).toBe(0);
    expect(await krizsanOn(30)).toBe(1);
    expect(await krizsanOn(45)).toBe(2);
    // The slime dies (event 0) on day 50: the decline stops there.
    univ.party.keyTimes.set(1, 50);
    expect(await krizsanOn(80)).toBe(2);
    // Had it died after day 75, it would have been too late.
    univ.party.keyTimes.set(1, 76);
    expect(await krizsanOn(80)).toBe(3);

    // Lorelei marks itself visited, for Anaximander's report.
    session.startTownMode(12, FORCED_ENTRY);
    await session.settled();
    expect(univ.party.getSdf(...partyFlag(0x105))).toBe(1);
    // Terrain 255 blocks sight in most of the towns that have it, not in the Slime Pit.
    const has255 = (t: number, ter: number) => scen.towns[t]!.terrain.some((col) => col.includes(ter));
    expect(has255(23, 255)).toBe(true);
    expect(has255(26, 256)).toBe(true);
    expect(has255(26, 255)).toBe(false);
    expect(scen.terTypes[255]!.blockage).toBe(TerObstruct.BLOCK_MOVE_AND_SHOOT);
    expect(scen.terTypes[256]!.blockage).toBe(TerObstruct.BLOCK_MOVE_AND_SIGHT);
  });

  it('gives the other kill cases to the creatures that carry them', () => {
    const onKill = (t: number) => scen.towns[t]!.creatures.filter((c) => c.specialOnKill >= 0).length;
    expect(onKill(60)).toBe(1); // the golems' crystal
    expect(onKill(58)).toBe(4); // the four whose last death says so
    expect(onKill(36)).toBe(4); // the third kill clears the town
    expect(onKill(1)).toBe(0); // ordinary death flags only
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
    // then the books, notes and maps its scripts and towns make readable
    // (notes.ts), which show their text through a scenario special.
    expect(scen.scenItems.length).toBeGreaterThan(470);
    expect(scen.scenItems[430]).toMatchObject({ fullName: 'Piece of Paper', ability: ItemAbil.CALL_SPECIAL });
    expect(scen.scenItems[415]).toMatchObject({ fullName: 'Crude Rations', variety: ItemType.FOOD, itemLevel: 10, value: 24 });
    const knife = scen.scenItems[41]!;
    expect(knife.fullName).toBe('Bronze Knife');
    expect([knife.itemLevel, knife.value, knife.weight]).toEqual([4, 16, 7]);
    expect(knife.graphicNum).toBeGreaterThanOrEqual(1000);
    const krizsan = scen.towns[0]!;
    expect(krizsan.presetItems[0]).toMatchObject({ code: 9, loc: { x: 6, y: 19 }, alwaysThere: true });
    expect(krizsan.presetFields.length).toBeGreaterThan(0);
    // A preset's `ability` is gold's amount; its charges byte is its own.
    const darts = scen.towns.flatMap((t) => t.presetItems).filter((p) => scen.scenItems[p.code]?.fullName === 'Iron Darts');
    expect(darts.map((p) => p.charges)).toContain(50);
  });

  it("reads E3's books, notes and maps, which the towns' presets name", async () => {
    const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    const said: unknown[] = [];
    session.attachSpecials(new Proxy({}, {
      get: (_, k) => (k === 'message' ? (...a: unknown[]) => { said.push(a); return Promise.resolve(); } : () => Promise.resolve(0)),
    }) as never);
    const notes = scen.scenItems.filter((it) => it.ability === ItemAbil.CALL_SPECIAL);
    expect(notes.length).toBeGreaterThan(40);
    // A magically inept PC can read them: E3's item chart (segment 1140,
    // which `FUN_10c0_2c92` indexes by ability) has 10 — `inept_ok`, usable
    // anywhere — for every readable ability, 0xa0–0xb7.
    const exe = new Uint8Array(readFileSync(join(dir as string, 'EXILE3.EXE')));
    const chart = readNeSegment(exe, (0x1140 - 0x1000) / 8 + 1);
    for (let a = 0xa0; a <= 0xb7; a++) expect(chart[2 * a]! | (chart[2 * a + 1]! << 8)).toBe(10);
    expect(notes.every((it) => it.ineptOk && !useMagic(it))).toBe(true);
    expect(scen.scenItems.filter((it) => it.ineptOk)).toHaveLength(notes.length);
    // The scroll in town 72 (a Piece of Paper made 0xaf): "You may proceed.",
    // and the remote cave's passage opens (party+0x35d).
    const scroll = scen.towns[72]!.presetItems.map((p) => scen.scenItems[p.code]!).find((it) => it.ability === ItemAbil.CALL_SPECIAL)!;
    await session.runSpecial(SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, scroll.abilStrength, { x: 0, y: 0 });
    expect(JSON.stringify(said)).toContain('You may proceed.');
    expect(session.univ.party.getSdf(...partyFlag(0x35d))).toBe(1);
    // Jordan's map (0xa9, town 46) puts town 22 on the map.
    const map = scen.towns[46]!.presetItems.map((p) => scen.scenItems[p.code]!).find((it) => it.fullName === scroll.fullName && it.ability === ItemAbil.CALL_SPECIAL)!;
    expect(session.univ.scenario.towns[22]!.canFind).toBe(false);
    await session.runSpecial(SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, map.abilStrength, { x: 0, y: 0 });
    expect(session.univ.scenario.towns[22]!.canFind).toBe(true);
    session.univ.scenario.towns[22]!.canFind = false;
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
    // First, "Show room descriptions more than once" (flag (306, 3)): unset,
    // the one-shot message; set, a plain one while the spot is still there.
    const pref = krizsan.specials.get(spot.spec)!;
    expect([pref.type, pref.sd1, pref.sd2, pref.ex1a]).toEqual([SpecType.IF_SDF_EQ, 306, 3, 0]);
    const node = krizsan.specials.get(pref.ex1b)!;
    expect(node.type).toBe(SpecType.ONCE_DISPLAY_MSG);
    const again = krizsan.specials.get(pref.jumpto)!;
    expect([again.type, again.sd1, again.sd2, again.ex1a]).toEqual([SpecType.IF_SDF_EQ, node.sd1, node.sd2, 250]);
    expect(krizsan.specials.get(again.jumpto)!.type).toBe(SpecType.DISPLAY_MSG);
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

  it("ruins a village's buildings once their day has come (copy-ter)", async () => {
    const village = scen.towns[147]!;
    const ruins = scen.towns.find((t) => t.name === `${village.name} (ruins)`)!;
    const kept = village.terrain.map((col) => [...col]);
    const differs = (a: number[][], b: number[][]) => a.some((col, x) => col.some((ter, y) => ter !== b[x]![y]));
    try {
      expect(differs(village.terrain, ruins.terrain)).toBe(true);
      // Day 1: nothing has fallen yet.
      const quiet = new Proxy({}, { get: () => () => Promise.resolve(0) }) as never;
      const early = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      early.attachSpecials(quiet);
      early.startTownMode(147, FORCED_ENTRY);
      while (early.specials!.busy) await new Promise((r) => setTimeout(r, 0));
      expect(differs(village.terrain, kept)).toBe(false);
      // Day 400, no plague stopped: every dated building has fallen, and each
      // square that changed now matches the ruins record.
      const late = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
      late.attachSpecials(quiet);
      late.univ.party.age = 3700 * 400;
      late.startTownMode(147, FORCED_ENTRY);
      while (late.specials!.busy) await new Promise((r) => setTimeout(r, 0));
      expect(differs(village.terrain, kept)).toBe(true);
      village.terrain.forEach((col, x) => col.forEach((ter, y) => {
        if (ter !== kept[x]![y]) expect(ter).toBe(ruins.terrain[x]![y]);
      }));
    } finally {
      kept.forEach((col, x) => { village.terrain[x] = col; });
    }
  });

  it('has all 200 towns, their maps sized by record number', () => {
    // And, after them, the 22 villages' ruins records (`village.ts`).
    expect(scen.towns).toHaveLength(222);
    expect(scen.towns[200]?.name).toMatch(/ \(ruins\)$/);
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
    expect(loaded.scenario.towns.length).toBe(222);
    // Terrain, monsters and items, then the ten maps and carvings.
    expect(loaded.sheets.length).toBe(22);
    // Its instant help, in its own words, over the game's.
    expect(loaded.strings.get('help')?.split('\n')[0]).toMatch(/^Welcome to Exile III/);
    // E3's own hundred sounds, in place of the engine's; 16, entering a town,
    // is one of the twelve that differ.
    expect([...loaded.sounds.keys()].sort((a, b) => a - b)).toEqual([...Array(100).keys()]);
    const boe16 = new Uint8Array(readFileSync(new URL('../public/data/sounds/SND16.wav', import.meta.url)));
    expect(loaded.sounds.get(16)).not.toEqual(boe16);
    expect(new TextDecoder().decode(loaded.sounds.get(16)!.subarray(0, 4))).toBe('RIFF');
    // Its dialog pictures, talking faces, patterns and panels, over the game's.
    expect([...loaded.overrides.keys()].sort()).toEqual(
      ['dlogpics', 'inventory', 'pixpats', 'statarea', 'talkportraits', 'textbar', 'transcript']);
    // And its fourteen cursors, each one the flag names.
    const named = loaded.scenario.featureFlags['cursors']!.split(',').map((e) => e.split(':')[0]);
    expect([...loaded.cursors.keys()].sort()).toEqual([...named].sort());
    expect(named).toHaveLength(14);
  }, 120000);
});
