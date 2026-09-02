import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { DamageType } from '../src/data/monster';
import { TagPage } from '../src/fileio/tagfile';
import { FieldType } from '../src/data/fields';
import { ItemType, presetItem, ItemPreset } from '../src/data/item';
import { QuestStatus } from '../src/data/quest';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import {
  loadSave, openSave, readSavePreview, saveGame, serialiseSave, writeMonster,
} from '../src/fileio/saveIo';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { CreatureStatus, copyMonster } from '../src/universe/creature';
import { EncNoteType, TOWN_NUM_OUTDOORS } from '../src/universe/party';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

/** A fresh game, already standing in the scenario's start town. */
async function newGame(): Promise<GameSession> {
  const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  await session.startNewGame();
  return session;
}

/** Save and load again, giving back the restored universe. */
function roundTrip(univ: Universe): Universe {
  return loadSave(saveGame(univ), scen, new GameRng());
}

describe('the scenario id a save records', () => {
  it('comes from the source directory', () => {
    expect(scen.id).toBe('valleydy');
  });
});

describe('.exg round trip', () => {
  let univ: Universe;

  beforeEach(async () => {
    univ = (await newGame()).univ;
  });

  it('writes the files load_party_v2 looks for', () => {
    const ball = serialiseSave(univ);
    expect(ball.files.map((f) => f.name)).toEqual([
      'save/party.txt',
      'save/pc1.txt', 'save/pc2.txt', 'save/pc3.txt',
      'save/pc4.txt', 'save/pc5.txt', 'save/pc6.txt',
      'save/scenario.txt',
      'save/setup.dat',
      'save/town.txt',
      'save/townmaps.dat',
      'save/out.txt',
      'save/outmaps.dat',
    ]);
  });

  it('gzips, and reads either the gzipped or the plain form', () => {
    const gzipped = saveGame(univ);
    expect([gzipped[0], gzipped[1]]).toEqual([0x1f, 0x8b]);
    expect(openSave(gzipped).has('save/party.txt')).toBe(true);
    expect(openSave(serialiseSave(univ).serialise()).has('save/party.txt')).toBe(true);
  });

  it('restores the party sheet', () => {
    univ.party.gold = 1234;
    univ.party.food = 77;
    univ.party.age = 5555;
    univ.party.easyMode = true;
    univ.party.lightLevel = 9;
    univ.party.totalMKilled = 12;
    univ.party.totalXpGained = 340;
    const back = roundTrip(univ).party;
    expect(back.gold).toBe(1234);
    expect(back.food).toBe(77);
    expect(back.age).toBe(5555);
    expect(back.easyMode).toBe(true);
    expect(back.lightLevel).toBe(9);
    expect(back.totalMKilled).toBe(12);
    expect(back.totalXpGained).toBe(340);
  });

  it('restores the party position, in the town and on the world map', () => {
    univ.party.townLoc = { x: 13, y: 21 };
    univ.party.outLoc = { x: 51, y: 62 };
    univ.party.locInSec = { x: 3, y: 14 };
    univ.party.outdoorCorner = { x: 1, y: 2 };
    univ.party.iwc = { x: 1, y: 0 };
    const back = roundTrip(univ).party;
    expect(back.townLoc).toEqual({ x: 13, y: 21 });
    expect(back.outLoc).toEqual({ x: 51, y: 62 });
    expect(back.locInSec).toEqual({ x: 3, y: 14 });
    expect(back.outdoorCorner).toEqual({ x: 1, y: 2 });
    expect(back.iwc).toEqual({ x: 1, y: 0 });
  });

  it('restores the Stuff Done Flags, including the magic pointers', () => {
    univ.party.stuffDone[7]![3] = 42;
    univ.party.stuffDone[300]![49] = 1;
    univ.party.magicPtrs[0] = 17;
    univ.party.magicPtrs[5] = 9;
    univ.party.pointers.set(101, [4, 5]);
    const back = roundTrip(univ).party;
    expect(back.stuffDone[7]![3]).toBe(42);
    expect(back.stuffDone[300]![49]).toBe(1);
    expect(back.stuffDone[8]![3]).toBe(0);
    expect(back.magicPtrs[0]).toBe(17);
    expect(back.magicPtrs[5]).toBe(9);
    expect(back.pointers.get(101)).toEqual([4, 5]);
  });

  it('restores every PC, their skills, spells, traits and pack', () => {
    const pc = univ.party.pcs[1]!;
    pc.name = 'Testy';
    pc.curHealth = 3;
    pc.maxHealth = 40;
    pc.curSp = 7;
    pc.maxSp = 21;
    pc.experience = 800;
    pc.level = 6;
    pc.skills[3] = 11;
    pc.status[Status.POISON] = 4;
    pc.mageSpells[40] = true;
    pc.priestSpells[3] = false;
    pc.traits[2] = true;
    pc.items[4] = presetItem(ItemPreset.POTION);
    pc.items[4].charges = 3;
    pc.equip[0] = true;

    const back = roundTrip(univ).party.pcs[1]!;
    expect(back.name).toBe('Testy');
    expect(back.mainStatus).toBe(MainStatus.ALIVE);
    expect(back.curHealth).toBe(3);
    expect(back.maxHealth).toBe(40);
    expect(back.curSp).toBe(7);
    expect(back.maxSp).toBe(21);
    expect(back.experience).toBe(800);
    expect(back.level).toBe(6);
    expect(back.skills[3]).toBe(11);
    expect(back.status[Status.POISON]).toBe(4);
    expect(back.mageSpells[40]).toBe(true);
    expect(back.priestSpells[3]).toBe(false);
    expect(back.traits[2]).toBe(true);
    expect(back.equip[0]).toBe(true);
    expect(back.items[4]!.variety).toBe(pc.items[4]!.variety);
    expect(back.items[4]!.name).toBe(pc.items[4]!.name);
    expect(back.items[4]!.charges).toBe(3);
    expect(back.items[5]!.variety).toBe(ItemType.NO_ITEM);
  });

  it('keeps the poisoned weapon pointing at the right slot', () => {
    const pc = univ.party.pcs[0]!;
    pc.items[2] = presetItem(ItemPreset.KNIFE);
    pc.weapPoisoned = pc.items[2]!;
    const back = roundTrip(univ).party.pcs[0]!;
    expect(back.weapPoisoned).toBe(back.items[2]);
  });

  it('restores quests, special items, alchemy and the job boards', () => {
    univ.party.activeQuests.set(2, { status: QuestStatus.COMPLETED, start: 3, source: 1 });
    univ.party.specItems.add(4);
    univ.party.alchemy[6] = true;
    univ.party.jobBanks = [{ jobs: [1, 2, -1, -1, -1, -1], anger: 3, inited: true }];
    univ.party.imprisonedMonst[0] = 55;
    univ.party.mNoted.add(19);
    univ.party.record(EncNoteType.TOWN, 'A note worth keeping', 'Fort Talrus');

    const back = roundTrip(univ).party;
    expect(back.activeQuests.get(2)).toEqual({
      status: QuestStatus.COMPLETED, start: 3, source: 1,
    });
    expect(back.specItems.has(4)).toBe(true);
    expect(back.alchemy[6]).toBe(true);
    expect(back.jobBanks[0]).toEqual({ jobs: [1, 2, -1, -1, -1, -1], anger: 3, inited: true });
    expect(back.imprisonedMonst[0]).toBe(55);
    expect(back.mNoted.has(19)).toBe(true);
    expect(back.specialNotes).toEqual([
      { type: EncNoteType.TOWN, theStr: 'A note worth keeping', where: 'Fort Talrus' },
    ]);
  });

  it('loses which soul-crystal slot a monster was in, as the C++ does', () => {
    // cParty::readFrom reads the slot number and then stores into the *loop
    // counter* instead (party.cpp:993), so a crystal whose earlier slots are
    // empty comes back compacted to the front. Kept, and pinned here.
    univ.party.imprisonedMonst = [0, 0, 77, 0];
    const back = roundTrip(univ).party;
    expect(back.imprisonedMonst).toEqual([77, 0, 0, 0]);
  });

  it('restores the party timers', () => {
    univ.party.partyEventTimers = [
      { time: 0, nodeType: 0, node: -1 },
      { time: 30, nodeType: 2, node: 7 },
    ];
    const back = roundTrip(univ).party;
    // The blank slot is skipped by the writer but its numbering survives.
    expect(back.partyEventTimers[1]).toEqual({ time: 30, nodeType: 2, node: 7 });
  });

  it('restores the town: creatures, dropped items, terrain and fields', () => {
    const town = univ.town!;
    const rat = town.monsters.find((m) => m.isAlive)!;
    rat.health = 2;
    rat.curLoc = { x: 9, y: 9 };
    rat.status[Status.POISON] = 2;
    town.monstHostile = true;
    town.items.push({ ...presetItem(ItemPreset.KNIFE), itemLoc: { x: 8, y: 8 } });
    // On the square the party is standing on, because `setField` enforces the
    // C++'s placement rules now — a wall of fire won't go on a wall.
    const wall = univ.party.townLoc;
    town.setField(wall.x, wall.y, FieldType.WALL_FIRE);
    town.makeExplored(4, 4);
    town.record.terrain[3]![3] = 17;

    const back = roundTrip(univ);
    expect(back.party.townNum).toBe(univ.party.townNum);
    expect(back.town).not.toBeNull();
    expect(back.town!.monstHostile).toBe(true);
    const backRat = back.town!.monsters.find((m) => m.curLoc.x === 9 && m.curLoc.y === 9)!;
    expect(backRat.health).toBe(2);
    // Only living creatures are written; the gaps between them come back dead
    // rather than as blank creatures standing in the town.
    expect(back.town!.monsters.filter((m) => m.isAlive).length)
      .toBe(town.monsters.filter((m) => m.isAlive).length);
    expect(backRat.status[Status.POISON]).toBe(2);
    expect(back.town!.items.some((i) => i.itemLoc.x === 8 && i.itemLoc.y === 8)).toBe(true);
    expect(back.town!.hasField(wall.x, wall.y, FieldType.WALL_FIRE)).toBe(true);
    expect(back.town!.isExplored(4, 4)).toBe(true);
    expect(back.town!.record.terrain[3]![3]).toBe(17);
  });

  it('restores the outdoor window and the explored maps', () => {
    univ.out.terrain[10]![11] = 23;
    univ.out.explored[10]![11] = 1;
    scen.towns[0]!.maps[5]![6] = 1;
    scen.outdoors[0]![0]!.maps[7]![8] = 1;

    const back = roundTrip(univ);
    expect(back.out.terrain[10]![11]).toBe(23);
    expect(back.out.explored[10]![11]).toBe(1);
    expect(scen.towns[0]!.maps[5]![6]).toBe(1);
    expect(scen.towns[0]!.maps[6]![5]).toBe(0);
    expect(scen.outdoors[0]![0]!.maps[7]![8]).toBe(1);
  });

  it('restores unlocked doors and town visibility', () => {
    scen.towns[1]!.doorUnlocked = [{ x: 4, y: 5 }];
    scen.towns[1]!.canFind = true;
    scen.towns[2]!.canFind = false;
    const data = saveGame(univ);
    scen.towns[1]!.doorUnlocked = [];
    scen.towns[1]!.canFind = false;
    scen.towns[2]!.canFind = true;
    loadSave(data, scen, new GameRng());
    expect(scen.towns[1]!.doorUnlocked).toEqual([{ x: 4, y: 5 }]);
    expect(scen.towns[1]!.canFind).toBe(true);
    expect(scen.towns[2]!.canFind).toBe(false);
  });

  it('restores the boats and horses the party owns', () => {
    univ.party.boats = [{
      loc: { x: 3, y: 4 }, sector: { x: 1, y: 1 }, whichTown: 200,
      exists: true, property: false, pic: 0, name: 'boat',
    }];
    univ.party.inBoat = 0;
    const back = roundTrip(univ).party;
    expect(back.inBoat).toBe(0);
    expect(back.boats[0]!.loc).toEqual({ x: 3, y: 4 });
    expect(back.boats[0]!.exists).toBe(true);
    expect(back.boats[0]!.property).toBe(false);
  });

  it('saves a party standing outdoors with no town file at all', () => {
    univ.party.townNum = TOWN_NUM_OUTDOORS;
    univ.town = null;
    const ball = serialiseSave(univ);
    expect(ball.has('save/town.txt')).toBe(false);
    const back = loadSave(ball.serialise(), scen, new GameRng());
    expect(back.party.townNum).toBe(TOWN_NUM_OUTDOORS);
    expect(back.town).toBeNull();
  });

  it('carries the four remembered towns, their slot ring and their dead', async () => {
    // A session of its own: `end_town_mode` only files a town away while the
    // mode really is TOWN, and `univ` above outlived the session that made it.
    const session = await newGame();
    const univ = session.univ;
    const town = univ.town!;
    town.monsters[0]!.active = CreatureStatus.DEAD;
    const aliveBefore = town.monsters.filter((m) => m.isAlive).length;
    session.endTownMode(univ.party.townLoc);
    expect(univ.party.creatureSave[0]!.whichTown).toBe(scen.startTown);
    expect(univ.party.atWhichSaveSlot).toBe(1);

    const back = roundTrip(univ);
    expect(back.party.atWhichSaveSlot).toBe(1);
    expect(back.party.creatureSave.map((p) => p.whichTown))
      .toEqual(univ.party.creatureSave.map((p) => p.whichTown));
    // Only the living are written; slot 0's creature 0 stays dead, and the
    // rest are all still there.
    const restored = back.party.creatureSave[0]!.monsters;
    expect(restored[0]!.isAlive).toBe(false);
    expect(restored.filter((m) => m.isAlive).length).toBe(aliveBefore);
    // A saved creature's page carries no monster stats, so `resumeLoadedGame`
    // has to put them back for the remembered towns as well as the live one.
    new GameSession(back).resumeLoadedGame();
    expect(back.party.creatureSave[0]!.monsters[1]!.mon.name.length).toBeGreaterThan(0);
  });

  it('carries each town\'s kill count, which is what empties a cleaned-out town', () => {
    // The Town records are the shared scenario's, so a round trip reads back
    // onto the same objects: scribble over them between save and load, and
    // what survives is what the file really carried.
    const record = univ.town!.record;
    try {
      record.monstersKilled = 17;
      const bytes = saveGame(univ);
      record.monstersKilled = 3;
      loadSave(bytes, scen, new GameRng());
      expect(record.monstersKilled).toBe(17);

      // Zero is not written at all, so the reader has to clear before it
      // reads — otherwise a town emptied in the old game stays emptied.
      record.monstersKilled = 0;
      const none = saveGame(univ);
      record.monstersKilled = 42;
      loadSave(none, scen, new GameRng());
      expect(record.monstersKilled).toBe(0);
    } finally {
      record.monstersKilled = 0;
    }
  });

  it('survives a second round trip byte for byte', () => {
    univ.party.gold = 999;
    const once = serialiseSave(univ).text('save/party.txt');
    const twice = serialiseSave(roundTrip(univ)).text('save/party.txt');
    expect(twice).toBe(once);
  });
});

/**
 * The axis trap. `encode(vector2d)` (tagfile.hpp:383) writes one line per
 * **row** — one `y`, with the values along it indexed by `x` — while
 * `vector2d::operator[]` hands back a *column*, so the in-memory array is
 * `terrain[x][y]`. Writing the file the other way round transposes the town.
 *
 * A round trip inside this port cannot see that: it reads back exactly what it
 * wrote, so the transpose cancels. It took a save written by the desktop build
 * to expose it — the party lands on the right square with every wall around it
 * in the wrong place. That is why this test asserts against the **file text**
 * rather than against a reloaded universe.
 */
describe('a monster page', () => {
  /**
   * `encodeSparse` over a `std::map<eDamageType,int>` writes the enum's **tag**
   * (monster.cpp:804) — `IMMUNE weap 100`, not `IMMUNE 0 100`. The read side
   * has to match, and the cost of not matching is invisible: `extractSparse`
   * over a map *clears* it, and `resist[dam_type]` on a map default-constructs
   * to **0**, which `damage_monst` reads as total immunity. A monster that came
   * out of a save shrugged off every blow in the game.
   */
  it('round-trips a summoned monster\'s resistances, by damage-type name', async () => {
    const { univ } = await newGame();
    const summon = copyMonster(scen.scenMonsters.find((m) => m.name.length > 0)!);
    summon.resist.fill(100);
    summon.resist[DamageType.FIRE] = 50;
    summon.resist[DamageType.COLD] = 0;
    univ.party.summons = [summon];

    const page = new TagPage();
    writeMonster(page, summon);
    const text = page.serialise();
    expect(text).toContain('IMMUNE weap 100');
    expect(text).toContain('IMMUNE fire 50');
    // Zero is the sparse form's default, so it is the one value not written.
    expect(text).not.toContain('cold');

    const back = roundTrip(univ).party.summons[0]!;
    expect(back.resist[DamageType.WEAPON]).toBe(100);
    expect(back.resist[DamageType.FIRE]).toBe(50);
    expect(back.resist[DamageType.COLD]).toBe(0);
  });
});

describe('the town grid axes, which a round trip cannot check', () => {
  it('writes one TERRAIN line per y, with x along it', async () => {
    const univ = (await newGame()).univ;
    const town = univ.town!;
    const dim = town.record.maxDim;
    // A mark that is only right one way round: two squares that differ, chosen
    // so their transpose is a different pair.
    town.record.terrain[3]![7] = 41;
    town.record.terrain[7]![3] = 42;
    const text = openSave(saveGame(univ)).text('save/town.txt')!;
    const lines = text.split('\f').find((page) => page.startsWith('FIELDS'))!.split('\n')
      .filter((l) => l.startsWith('TERRAIN'))
      .map((l) => l.slice('TERRAIN '.length).split(' ').map(Number));
    expect(lines).toHaveLength(dim);
    // Line 7 (y = 7) holds 41 at position 3 (x = 3), not the other way about.
    expect(lines[7]![3]).toBe(41);
    expect(lines[3]![7]).toBe(42);
  });

  /**
   * `encodeSparse` over a `std::map<eStatus,short>` writes the enum's **tag**
   * (creature.cpp:357), so a creature page says `STATUS haste-slow 1`. This
   * port wrote `STATUS 5 1` and read it back with `tag.int(0)`, which agreed
   * with itself and threw away every status in a save the C++ had written —
   * a hasted monster came back at half its action points and nothing said so.
   */
  it("writes a creature's status by name, as the C++ does", async () => {
    const univ = (await newGame()).univ;
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    monst.status[Status.HASTE_SLOW] = 1;
    const page = openSave(saveGame(univ)).text('save/town.txt')!
      .split('\f').find((p) => p.includes(`LOCATION ${monst.curLoc.x} ${monst.curLoc.y}`))!;
    expect(page).toContain('STATUS haste-slow 1');
  });

  it("reads a C++ save's named creature status", async () => {
    const univ = (await newGame()).univ;
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    monst.status[Status.HASTE_SLOW] = 1;
    monst.status[Status.BLESS_CURSE] = 3;
    const back = roundTrip(univ);
    const there = back.town!.monsters.find(
      (m) => m.curLoc.x === monst.curLoc.x && m.curLoc.y === monst.curLoc.y)!;
    expect(there.status[Status.HASTE_SLOW]).toBe(1);
    expect(there.status[Status.BLESS_CURSE]).toBe(3);
  });

  it('reads a foreign grid back the same way', async () => {
    const univ = (await newGame()).univ;
    univ.town!.record.terrain[3]![7] = 41;
    univ.town!.record.terrain[7]![3] = 42;
    const back = roundTrip(univ);
    expect(back.town!.record.terrain[3]![7]).toBe(41);
    expect(back.town!.record.terrain[7]![3]).toBe(42);
  });
});

describe('the save preview', () => {
  it('reads the scenario, the party and the PCs without a scenario loaded', async () => {
    const univ = (await newGame()).univ;
    univ.party.gold = 4242;
    const preview = readSavePreview(saveGame(univ));
    expect(preview.scenarioId).toBe('valleydy');
    expect(preview.gold).toBe(4242);
    expect(preview.townNum).toBe(univ.party.townNum);
    expect(preview.pcs).toHaveLength(6);
    expect(preview.pcs[0]!.name).toBe(univ.party.pcs[0]!.name);
    expect(preview.pcs[0]!.mainStatus).toBe(MainStatus.ALIVE);
  });

  it('refuses a file that is not a save', () => {
    expect(() => readSavePreview(new Uint8Array(1024))).toThrow(/save\/party.txt/);
  });
});
