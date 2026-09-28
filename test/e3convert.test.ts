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
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { killMonst } from '../src/game/damage';
import { MainStatus, Race } from '../src/universe/skills';
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
    const hidden = scen.towns.flatMap((t, i) => (t.canFind ? [] : [i]));
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
