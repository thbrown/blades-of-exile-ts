/**
 * Exile III's own saves (`src/fileio/e3save.ts`): the container, and a game
 * of the converted Exile III carried out to an `exile3.sav` and back in.
 *
 * `E3_SAV=<file>` also reads a save made by the original game, and checks
 * that writing it back gives the same bytes.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import {
  E3CREATURE, E3CTOWN, E3ITEM, E3MONST, E3P, E3PC, E3TD, E3_PARTY_SIZE, E3_PC_SIZE, E3_SAVE_OUTDOORS, E3_SAVE_TOWN, E3Bytes,
  emptyE3Save, isE3Save, readE3Save, writeE3Save,
} from '../src/fileio/e3save';
import { e3MonsterRecord, e3TownData, e3TownHeader } from '../src/fileio/e3SaveTown';
import { e3TownGeometry } from '../tools/e3convert/town';
import { FieldType } from '../src/data/fields';
import { e3SaveDefaultsFromJson, e3SaveDefaultsToJson, type E3SaveDefaults } from '../src/fileio/e3SaveDefaults';
import {
  applyE3Save, applyE3TownCreatures, applyE3TownDecals, applyE3TownItems, applyE3TownTerrain,
} from '../src/fileio/e3SaveImport';
import { exportE3Save, newE3PartyRecord } from '../src/fileio/e3SaveExport';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir, readE3Files } from '../tools/e3convert/install';
import { readE3SaveDefaults } from '../tools/e3convert/saveDefaults';
import { partyFlag } from '../tools/e3convert/script';
import { QuestRunner, loadExile3 } from './support/e3Quest';
import { e3Jobs } from '../src/game/e3Jobs';
import { applySave, saveGame } from '../src/fileio/saveIo';
import { Race, Status, Trait } from '../src/universe/skills';
import { CreatureStatus } from '../src/universe/creature';
import { EncNoteType } from '../src/universe/party';
import { e3SpotFlag } from '../tools/e3convert/flags';
import { defaultItem } from '../src/data/item';

describe('the exile3.sav container', () => {
  it('writes an outdoor save of the right size and reads it back', () => {
    const save = emptyE3Save();
    save.party[0x1234] = 7;
    save.pcs[3]![5] = 9;
    const bytes = writeE3Save(save);
    expect(bytes.length).toBe(6 + 0x8525 + 0x4000 + 6 * 0x722 + 0x2400 + 3 * 0x1c4d + 0x2000);
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(E3_SAVE_OUTDOORS);
    expect(isE3Save(bytes)).toBe(true);
    // The party is XOR 0x5c on disk, a PC 0x6b.
    expect(bytes[6 + 0x1234]).toBe(7 ^ 0x5c);
    expect(bytes[6 + E3_PARTY_SIZE + 0x4000 + 3 * E3_PC_SIZE + 5]).toBe(9 ^ 0x6b);
    const back = readE3Save(bytes);
    expect(back.party[0x1234]).toBe(7);
    expect(back.pcs[3]![5]).toBe(9);
    expect(writeE3Save(back)).toEqual(bytes);
  });

  it('round-trips the in-town and map blocks', () => {
    const save = emptyE3Save();
    save.inTown = true;
    save.town = { cTown: new Uint8Array(0x2abe).fill(1), data: new Uint8Array(0x1710).fill(2), items: new Uint8Array(0x1c4d).fill(3) };
    save.maps = { towns: new Uint8Array(0x9100).fill(4), zones: new Uint8Array(0x6540).fill(5), villages: new Uint8Array(0x5a00).fill(6) };
    const bytes = writeE3Save(save);
    const back = readE3Save(bytes);
    expect(back.inTown).toBe(true);
    expect(back.town!.data[0]).toBe(2);
    expect(back.maps!.villages[0]).toBe(6);
    expect(writeE3Save(back)).toEqual(bytes);
  });

  it("keeps what follows a save, as E3's untruncated overwrite leaves it", () => {
    const bytes = writeE3Save(emptyE3Save());
    const longer = new Uint8Array(bytes.length + 24091).fill(0xaa);
    longer.set(bytes);
    const back = readE3Save(longer);
    expect(back.trailing.length).toBe(24091);
    expect(writeE3Save(back)).toEqual(longer);
  });

  it('refuses what is not one', () => {
    expect(isE3Save(new Uint8Array([0x1f, 0x8b, 0, 0, 0, 0]))).toBe(false);
    expect(() => readE3Save(writeE3Save(emptyE3Save()).subarray(0, 1000))).toThrow(/cut short/);
  });

  it('names the party record to its end and the PC record to its end', () => {
    expect(E3P.KEY_TIMES + 2 * 20).toBe(E3_PARTY_SIZE);
    expect(E3PC.DIRECTION + 2).toBe(E3_PC_SIZE);
    expect(E3PC.ITEMS + 24 * 63).toBe(E3PC.EQUIP);
  });
});

const dir = findE3Dir();

describe.skipIf(!dir)('a converted Exile III game, out to exile3.sav and back', () => {
  const out = mkdtempSync(join(tmpdir(), 'e3save-'));
  let scen: Scenario;
  let defaults: E3SaveDefaults;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    scen = await loadExile3(out);
    defaults = e3SaveDefaultsFromJson(readFileSync(join(out, 'e3save.json'), 'utf8'));
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("ships the EXE's tables the converter read", () => {
    const files = readE3Files(dir as string);
    const fromExe = readE3SaveDefaults(files.exe, files.town, files.outdoor);
    expect(e3SaveDefaultsToJson(defaults)).toBe(e3SaveDefaultsToJson(fromExe));
    expect(defaults.itemTable.length).toBe(415 * 59);
  });

  it("builds a new game's record as init_party does", () => {
    const p = new E3Bytes(newE3PartyRecord(defaults));
    expect(p.data.length).toBe(E3_PARTY_SIZE);
    expect(p.i32(E3P.GOLD)).toBe(200);
    expect(p.loc(E3P.OUTDOOR_CORNER)).toEqual({ x: 7, y: 8 });
    expect(p.i16(E3P.KEY_TIMES + 38)).toBe(30000);
    expect(p.i16(E3P.TALK_SAVE + 7 * 119)).toBe(-1);
    // Krizsan's two boats are E3's table's, in town 0.
    const boats = [...Array(30).keys()].filter((k) => p.u8(E3P.BOATS + 10 * k + 8) === 1);
    expect(boats.length).toBeGreaterThan(0);
  });

  it('carries the party, its PCs, flags, items and place across', async () => {
    const q = new QuestRunner(scen);
    await q.outdoorsAt(3 * 48 + 20, 6 * 48 + 30);
    const { party } = q;
    party.gold = 1234;
    party.food = 77;
    party.age = 3700 * 40 + 12;
    q.setFlag(0x259, 1);
    q.setFlag(0x56e, 2);
    party.specItems.add(5);
    party.keyTimes.set(3, 61);
    party.alchemy[4] = true;
    const pc = party.pcs[1]!;
    pc.name = 'Testa';
    pc.level = 14;
    pc.experience = 321;
    pc.mageSpells[40] = true;
    const sword = scen.scenItems.findIndex((it) => /Steel Broadsword/.test(it.fullName));
    expect(sword).toBeGreaterThanOrEqual(0);
    pc.items[3] = { ...scen.scenItems[sword]!, charges: 0, ident: true, bonus: 3 };
    pc.equip[3] = true;
    expect(party.townNum).toBe(200);

    const { bytes, warnings } = exportE3Save(q.univ, defaults);
    expect(warnings).toEqual([]);
    expect(isE3Save(bytes)).toBe(true);

    const back = new QuestRunner(scen);
    const res = applyE3Save(bytes, back.univ, defaults);
    expect(res.town).toBeNull();
    const b = back.party;
    expect(b.gold).toBe(1234);
    expect(b.food).toBe(77);
    expect(b.age).toBe(3700 * 40 + 12);
    expect(back.flag(0x259)).toBe(1);
    expect(back.flag(0x56e)).toBe(2);
    expect(b.specItems.has(5)).toBe(true);
    expect(b.keyTimes.get(3)).toBe(61);
    expect(b.alchemy[4]).toBe(true);
    expect(b.outdoorCorner).toEqual(party.outdoorCorner);
    expect(b.locInSec).toEqual(party.locInSec);
    expect(b.outLoc).toEqual(party.outLoc);
    const bpc = b.pcs[1]!;
    expect(bpc.name).toBe('Testa');
    expect(bpc.level).toBe(14);
    expect(bpc.experience).toBe(321);
    expect(bpc.mageSpells[40]).toBe(true);
    expect(bpc.items[3]!.fullName).toBe(scen.scenItems[sword]!.fullName);
    expect(bpc.items[3]!.bonus).toBe(3);
    expect(bpc.equip[3]).toBe(true);
    // Every PC's pack comes back whole.
    party.pcs.forEach((pc, i) => {
      expect(b.pcs[i]!.items.map((it) => it.fullName)).toEqual(pc.items.map((it) => it.fullName));
      expect(b.pcs[i]!.skills).toEqual(pc.skills);
      expect(b.pcs[i]!.priestSpells).toEqual(pc.priestSpells);
    });
    // And writing the import out again changes nothing.
    expect(exportE3Save(back.univ, defaults).bytes).toEqual(bytes);
  });

  it("says what of a Blades of Exile PC Exile III can't hold", async () => {
    const q = new QuestRunner(scen);
    await q.outdoorsAt(3 * 48 + 20, 6 * 48 + 30);
    const [a, b] = q.party.pcs;
    a!.race = Race.VAHNATAI;
    b!.traits[Trait.PACIFIST] = true;
    b!.traits[Trait.ANAMA] = true;
    const { bytes, warnings } = exportE3Save(q.univ, defaults);
    expect(warnings).toEqual([
      `${a!.name} isn't a species Exile III has, and goes as a human.`,
      `${b!.name} is a Pacifist, which Exile III doesn't have; it was left out.`,
      `${b!.name} is an Anama Member, which Exile III doesn't have; it was left out.`,
    ]);
    const back = new QuestRunner(scen);
    applyE3Save(bytes, back.univ, defaults);
    expect(back.party.pcs[0]!.race).toBe(Race.HUMAN);
    expect(back.party.pcs[1]!.traits[Trait.PACIFIST]).toBe(false);
    expect(back.party.pcs[1]!.traits[Trait.ANAMA]).toBe(false);
  });

  it('puts the vehicles back in their own slots', async () => {
    const q = new QuestRunner(scen);
    expect(q.party.boats.length).toBeGreaterThan(0);
    q.party.boats[0]!.property = false;
    const { bytes } = exportE3Save(q.univ, defaults);
    const back = new QuestRunner(scen);
    applyE3Save(bytes, back.univ, defaults);
    expect(back.party.boats.map((v) => [v.whichTown, v.loc, v.property]))
      .toEqual(q.party.boats.map((v) => [v.whichTown, v.loc, v.property]));
  });

  it('carries the journal, the encounter notes and the conversation notes, as E3 numbers them', async () => {
    const q = new QuestRunner(scen);
    // A new game's journal has entry 1, as `init_party` writes it.
    expect(q.party.journal.map((e) => [e.theStr, e.day])).toEqual([[scen.journalStrs[1], 1]]);
    const save = readE3Save(exportE3Save(q.univ, defaults).bytes);
    const p = new E3Bytes(save.party);
    expect([p.u8(E3P.JOURNAL_STR), p.i16(E3P.JOURNAL_DAY)]).toEqual([1, 1]);
    // Out of order as E3 adds them; a sprite's two-part message in Guhkbar's
    // caves (list 64); a script's own (list 14); a regular node's pair, its
    // second empty; a paid node's chosen second reply alone (type 24); a name.
    [[5, 3], [4, 3]].forEach(([e, day], i) => { p.setU8(E3P.JOURNAL_STR + 1 + i, e!); p.setI16(E3P.JOURNAL_DAY + 2 + 2 * i, day!); });
    [[64, 39], [64, 40], [14, 72]].forEach(([a, b], i) => { p.setI16(E3P.SPECIAL_NOTES + 4 * i, a!); p.setI16(E3P.SPECIAL_NOTES + 4 * i + 2, b!); });
    [[48, 41, 187, 188], [91, 0, 68, 0], [21, 21, 12, 0]].forEach(([who, town, s1, s2], i) => {
      const at = E3P.TALK_SAVE + 7 * i;
      p.setI16(at, who!); p.setU8(at + 2, town!); p.setI16(at + 3, s1!); p.setI16(at + 5, s2!);
    });
    const bytes = writeE3Save(save);
    const back = new QuestRunner(scen);
    expect(applyE3Save(bytes, back.univ, defaults).warnings).toEqual([]);
    expect(back.party.journal.map((e) => e.day)).toEqual([1, 3, 3]);
    // E3 doesn't say where; the town of list 64 whose messages hold it.
    const sprite = back.party.specialNotes[0]!;
    expect(sprite.theStr).toMatch(/^The tiny sprite/);
    expect(sprite.type).toBe(EncNoteType.TOWN);
    expect(scen.towns.find((t) => t.name === sprite.where)?.specStrs).toContain(sprite.theStr);
    expect(back.party.specialNotes[2]!.theStr).toMatch(/^Suddenly, he remembers/);
    expect(back.party.talkSave[1]).toMatchObject({ whoSaid: 'Strange Wizard', str2: '' });
    expect(back.party.talkSave[1]!.str1).toMatch(/^He shakes his head/);
    expect(back.party.talkSave[0]!.str2).toBe('');
    const again = readE3Save(exportE3Save(back.univ, defaults).bytes).party;
    expect(again.subarray(E3P.JOURNAL_STR, E3P.HELP_RECEIVED)).toEqual(save.party.subarray(E3P.JOURNAL_STR, E3P.HELP_RECEIVED));
    expect(again.subarray(E3P.SPECIAL_NOTES, E3P.TOTAL_M_KILLED)).toEqual(save.party.subarray(E3P.SPECIAL_NOTES, E3P.TOTAL_M_KILLED));
  });

  it("keeps what is left in E3's three stashes, in the game and across a save", async () => {
    // Fort Emergence keeps two corners; towns 102 and 111 the whole town.
    expect(scen.storeItemRects.get(21)).toEqual([{ left: 22, top: 30, right: 28, bottom: 35 }, { left: 57, top: 0, right: 63, bottom: 8 }]);
    expect(scen.storeItemRects.get(102)).toHaveLength(1);
    expect(scen.storeItemRects.get(111)).toHaveLength(1);
    const q = new QuestRunner(scen);
    await q.enter(21, { x: 58, y: 5 });
    const sword = scen.scenItems.findIndex((it) => /Steel Broadsword/.test(it.fullName));
    const drop = (x: number, y: number) => q.town.items.push({ ...scen.scenItems[sword]!, itemLoc: { x, y }, isSpecial: 0 });
    drop(58, 4);
    drop(25, 32);
    drop(40, 20);
    await q.enter(22);
    expect(q.party.storedItems.get(21)?.map((it) => it.itemLoc)).toEqual([{ x: 58, y: 4 }, { x: 25, y: 32 }]);
    const bytes = exportE3Save(q.univ, defaults).bytes;
    const back = new QuestRunner(scen);
    applyE3Save(bytes, back.univ, defaults);
    expect(back.party.storedItems.get(21)?.map((it) => [it.fullName, it.itemLoc]))
      .toEqual(q.party.storedItems.get(21)?.map((it) => [it.fullName, it.itemLoc]));
    // Back in the fort, the two kept are lying where they were dropped.
    await back.enter(21, { x: 58, y: 5 });
    expect(back.town.items.filter((it) => it.fullName === scen.scenItems[sword]!.fullName).map((it) => it.itemLoc))
      .toEqual([{ x: 58, y: 4 }, { x: 25, y: 32 }]);
  });

  it('remembers the towns the party left: the dead stay dead, and a spot that ran stays done', async () => {
    const q = new QuestRunner(scen);
    await q.enter(4, { x: 30, y: 30 });
    const victim = q.town.monsters.find((m) => m.isAlive)!;
    victim.active = CreatureStatus.DEAD;
    const spot = q.town.record.specialLocs.findIndex((l) => l.x < 100);
    q.party.setSdf(...e3SpotFlag({ town: 4 }, spot), 250);
    await q.enter(22);
    const slot = q.party.creatureSave.findIndex((pop) => pop.whichTown === 4);
    expect(slot).toBeGreaterThanOrEqual(0);
    const back = new QuestRunner(scen);
    expect(applyE3Save(exportE3Save(q.univ, defaults).bytes, back.univ, defaults).warnings).toEqual([]);
    expect(back.party.creatureSave[slot]!.whichTown).toBe(4);
    expect(back.party.atWhichSaveSlot).toBe(q.party.atWhichSaveSlot);
    expect(back.party.getSdf(...e3SpotFlag({ town: 4 }, spot))).toBe(250);
    await back.enter(4, { x: 30, y: 30 });
    expect(back.town.monsters.find((m) => m.slot === victim.slot)?.isAlive).toBe(false);
    expect(back.town.monsters.filter((m) => m.isAlive).length).toBe(q.party.creatureSave[slot]!.monsters.filter((m) => m.isAlive).length);
  });

  it('carries the groups wandering outdoors, each as its zone converted it', async () => {
    const q = new QuestRunner(scen);
    await q.outdoorsAt(3 * 48 + 20, 6 * 48 + 30);
    const c = q.univ.party.outC[0]!;
    const { x, y } = q.party.outdoorCorner;
    const sector = scen.outdoors[x + 1]![y]!;
    const k = sector.wandering.findIndex((w) => w.monst.some((m) => m > 0));
    expect(k).toBeGreaterThanOrEqual(0);
    Object.assign(c, { exists: true, direction: 3, whatMonst: structuredClone(sector.wandering[k]!), whichSector: { x: 1, y: 0 }, mLoc: { x: 60, y: 20 } });
    const back = new QuestRunner(scen);
    expect(applyE3Save(exportE3Save(q.univ, defaults).bytes, back.univ, defaults).warnings).toEqual([]);
    expect(back.party.outC[0]).toEqual(c);
    expect(back.party.outC.slice(1).some((g) => g.exists)).toBe(q.party.outC.slice(1).some((g) => g.exists));
  });

  it("carries the magic shops' stock, so a save reloads the same wares", async () => {
    const q = new QuestRunner(scen);
    const wares = (u: typeof q.univ) => [...Array(50).keys()].map((k) => u.storeItem(Math.floor(k / 10), k % 10).fullName);
    expect(wares(q.univ).filter((n) => n !== '').length).toBeGreaterThan(0);
    // One bought out.
    const sold = wares(q.univ).findIndex((n) => n !== '');
    q.univ.setStoreItem(Math.floor(sold / 10), sold % 10, defaultItem());
    const back = new QuestRunner(scen);
    expect(applyE3Save(exportE3Save(q.univ, defaults).bytes, back.univ, defaults).warnings).toEqual([]);
    expect(wares(back.univ)).toEqual(wares(q.univ));
  });

  it('fills the job boards of a party that never looked at one, as E3 fills them for a new party', async () => {
    const q = new QuestRunner(scen);
    expect(q.party.e3Jobs ?? null).toBeNull();
    const { bytes } = exportE3Save(q.univ, defaults);
    const p = new E3Bytes(readE3Save(bytes).party);
    const posted = [...Array(6 * 4).keys()].filter((k) => p.i16(E3P.JOB_BOARDS + k * 0xc) !== 0);
    expect(posted.length).toBeGreaterThan(0);
    // And the game keeps the boards it exported.
    const back = new QuestRunner(scen);
    applyE3Save(bytes, back.univ, defaults);
    expect(back.party.e3Jobs?.boards).toEqual(q.party.e3Jobs?.boards);
  });

  it('refills the boards of a game imported from a save with none posted, as the exporter used to write them', async () => {
    const q = new QuestRunner(scen);
    const save = readE3Save(exportE3Save(q.univ, defaults).bytes);
    // The exporter before 2026-10-07: every board, held job and failed flag empty.
    save.party.fill(0, E3P.JOBS_HELD, E3P.JOBS_FAILED + 6);
    const back = new QuestRunner(scen);
    applyE3Save(writeE3Save(save), back.univ, defaults);
    expect(back.party.e3Jobs).toBeNull();
    expect(e3Jobs(back.univ).boards.flat().some((j) => j.kind > 0)).toBe(true);
    // …and an in-progress game saved here with them empty comes back the same way.
    back.party.e3Jobs = { ...e3Jobs(back.univ), boards: e3Jobs(back.univ).boards.map((b) => b.map((j) => ({ ...j, kind: 0 }))) };
    const again = new QuestRunner(scen);
    applySave(saveGame(back.univ), again.univ);
    expect(again.party.e3Jobs).toBeNull();
    expect(e3Jobs(again.univ).boards.flat().some((j) => j.kind > 0)).toBe(true);
  });

  it('carries the explored maps: towns of every size, the villages, the zones and the window', async () => {
    const q = new QuestRunner(scen);
    const marks: [number, number, number][] = [[3, 63, 1], [45, 47, 40], [90, 31, 5], [150, 47, 47]];
    for (const [t, x, y] of marks) scen.towns[t]!.maps[x]![y] = 1;
    scen.outdoors[2]![7]!.maps[47]![0] = 1;
    q.univ.out.explored[95]![95] = 1;
    const { bytes } = exportE3Save(q.univ, defaults);
    const save = readE3Save(bytes);
    expect(save.maps).not.toBeNull();
    const back = new QuestRunner(scen);
    applyE3Save(bytes, back.univ, defaults);
    for (const [t, x, y] of marks) {
      expect(scen.towns[t]!.maps[x]![y], `town ${t}`).toBe(1);
      expect(scen.towns[t]!.maps[x]![y === 0 ? 1 : y - 1], `town ${t}`).toBe(0);
    }
    expect(scen.outdoors[2]![7]!.maps[47]![0]).toBe(1);
    expect(scen.outdoors[2]![7]!.maps[46]![0]).toBe(0);
    expect(back.univ.out.explored[95]![95]).toBe(1);
    // A save without maps still has the window's squares.
    save.maps = null;
    const bare = new QuestRunner(scen);
    applyE3Save(writeE3Save(save), bare.univ, defaults);
    expect(bare.univ.out.explored[95]![95]).toBe(1);
    expect(scen.towns[3]!.maps[63]![1]).toBe(0);
  });

  it('enters the town a save was made in, a declining one through its state', async () => {
    const q = new QuestRunner(scen);
    const save = readE3Save(exportE3Save(q.univ, defaults).bytes);
    save.inTown = true;
    const cTown = new Uint8Array(0x2abe);
    new DataView(cTown.buffer).setInt16(0, 6, true);
    cTown[0x29bc] = 30;
    cTown[0x29bd] = 31;
    cTown[0x426 + 30 * 64 + 31] = 1; // c_town.explored[30][31]
    save.town = { cTown, data: new Uint8Array(0x1710), items: new Uint8Array(0x1c4d) };
    const back = new QuestRunner(scen);
    const res = applyE3Save(writeE3Save(save), back.univ, defaults);
    // Shayder's third record is its first, in state 2.
    expect(res.town).toMatchObject({ num: 4, loc: { x: 30, y: 31 } });
    expect(back.party.getSdf(294, 11)).toBe(2);
    expect(partyFlag(0xc00)).toEqual([294, 0]);
    // The squares it had seen go on the record the party was in.
    expect(scen.towns[6]!.maps[30]![31]).toBe(1);
    expect(scen.towns[6]!.maps[31]![30]).toBe(0);
  });

  it('saves in town: the record, the creatures where they stand, the items, the fields and the spots still to run', async () => {
    const q = new QuestRunner(scen);
    await q.enter(4, { x: 30, y: 30 });
    const live = q.town.monsters.filter((m) => m.isAlive);
    const mover = live[0]!;
    mover.curLoc = { x: 31, y: 32 };
    mover.health = Math.max(1, mover.health - 1);
    mover.status[Status.POISON] = 3;
    mover.morale = 4;
    // One killed before the save, which a fresh entry would bring back.
    const victim = live[1]!;
    victim.active = CreatureStatus.DEAD;
    q.town.items.push({ ...q.town.items[0]!, itemLoc: { x: 12, y: 13 }, isSpecial: 0 });
    q.town.setField(29, 29, FieldType.OBJECT_CRATE, true);
    q.town.setField(28, 29, FieldType.WALL_FIRE, true);
    // A stain, which E3 keeps in the save's `sfx`.
    q.town.setField(31, 31, FieldType.SFX_LARGE_SLIME, true);
    // A one-shot spot that has run is erased; the others are still there.
    const spots = e3TownHeader(defaults.townDat!, 4);
    const k = [...Array(40).keys()].find((i) => spots[0x1c + 2 * i]! < 64 && spots[0x1c + 2 * i]! > 0)!;
    const j = [...Array(40).keys()].find((i) => i !== k && spots[0x1c + 2 * i]! < 64 && spots[0x1c + 2 * i]! > 0)!;
    q.party.setSdf(4, 10 + k, 250);
    const { bytes, warnings } = exportE3Save(q.univ, defaults);
    expect(warnings.filter((w) => /outdoors/.test(w))).toEqual([]);
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(E3_SAVE_TOWN);
    const save = readE3Save(bytes);
    const c = new E3Bytes(save.town!.cTown);
    expect(c.i16(E3CTOWN.TOWN_NUM)).toBe(4);
    expect(c.loc(E3CTOWN.P_LOC)).toEqual({ x: 30, y: 30 });
    expect(c.str(E3CTOWN.NAME, 30)).toBe('Shayder');
    expect(c.i16(E3CTOWN.WHICH_TOWN)).toBe(4);
    const active = [...Array(60).keys()].filter((i) => c.i16(E3CTOWN.CREATURES + E3CREATURE.SIZE * i) > 0);
    expect(active.length).toBe(live.length - 1);
    const at = E3CTOWN.CREATURES + E3CREATURE.SIZE * mover.slot;
    expect(c.loc(at + E3CREATURE.LOC)).toEqual({ x: 31, y: 32 });
    expect(c.u8(at + E3CREATURE.NUMBER)).toBe(mover.number);
    expect(c.i16(at + E3CREATURE.MONST + E3MONST.HEALTH)).toBe(mover.health);
    const items = [...Array(115).keys()].filter((i) => save.town!.items[63 * i] || save.town!.items[63 * i + 1]);
    expect(items.length).toBe(q.town.items.filter((it) => it.variety !== 0).length);
    const last = new E3Bytes(save.town!.items.subarray(63 * items.at(-1)!, 63 * items.at(-1)! + 63));
    expect(last.loc(E3ITEM.LOC)).toEqual({ x: 12, y: 13 });
    expect(save.miscI[64 * 29 + 29]! & 8).toBe(8);
    expect(c.u8(E3CTOWN.EXPLORED + 64 * 28 + 29) & 4).toBe(4);
    const bit = (i: number) => save.miscI[64 * spots[0x1c + 2 * i]! + spots[0x1d + 2 * i]!]! & 2;
    expect(bit(k)).toBe(0);
    expect(bit(j)).toBe(2);
    // The terrain as it stands.
    expect(save.town!.data[E3TD.TERRAIN + 64 * 30 + 30]).toBe(q.town.record.terrain[30]![30]);
    // And it loads back here, in Shayder.
    const back = new QuestRunner(scen);
    const res = applyE3Save(bytes, back.univ, defaults);
    expect({ num: res.town?.num, loc: res.town?.loc }).toEqual({ num: 4, loc: { x: 30, y: 30 } });
    // The town is entered afresh, and then wears the save's stains.
    back.session.resumeInSavedTown(res.town!.num, res.town!.loc);
    applyE3TownDecals(back.univ, res.town!.decals);
    expect(back.town.hasField(31, 31, FieldType.SFX_LARGE_SLIME)).toBe(true);
    expect(back.town.hasField(31, 31, FieldType.SFX_SMALL_SLIME)).toBe(false);
    // And its creatures as they were: the dead stay dead, the living where they stood.
    expect(back.town.monsters.find((m) => m.slot === victim.slot)!.isAlive).toBe(true);
    applyE3TownCreatures(back.univ, res.town!.cTown);
    expect(back.town.monsters.find((m) => m.slot === victim.slot)!.isAlive).toBe(false);
    const moved = back.town.monsters.find((m) => m.slot === mover.slot)!;
    expect(moved.curLoc).toEqual({ x: 31, y: 32 });
    expect(moved.health).toBe(mover.health);
    expect(moved.status[Status.POISON]).toBe(3);
    expect(moved.morale).toBe(4);
    expect(back.town.monsters.filter((m) => m.isAlive).length).toBe(live.length - 1);
    // And its items: the one dropped at (12,13) is still there, the rest where they lay.
    const before = q.town.items.filter((it) => it.variety !== 0);
    expect(applyE3TownItems(back.univ, res.town!.items, defaults)).toEqual([]);
    expect(back.town.items.map((it) => [it.fullName, it.itemLoc, it.isSpecial, it.property, it.contained]))
      .toEqual(before.map((it) => [it.fullName, it.itemLoc, it.isSpecial, it.property, it.contained]));
  });

  /**
   * Saves from the original: `E3_SAV` is a file or a directory of them. Each
   * must write back byte for byte, come in with every item matched, and go
   * back out with the same party, PCs and flags.
   */
  const real = process.env['E3_SAV'];
  const realFiles = (): string[] => {
    if (!real || !existsSync(real)) return [];
    return statSync(real).isDirectory()
      ? readdirSync(real).filter((f) => /\.sav$/i.test(f)).map((f) => join(real, f)) : [real];
  };
  it.skipIf(!real || !existsSync(real))('reads saves from the original, writes the same bytes, and carries them across', () => {
    for (const file of realFiles()) {
      const bytes = new Uint8Array(readFileSync(file));
      const save = readE3Save(bytes);
      expect(writeE3Save(save), file).toEqual(bytes);
      const p = new E3Bytes(save.party);
      // The window square is the zone square plus which of the 2x2 it is in.
      const iwc = p.loc(E3P.IWC), inSec = p.loc(E3P.LOC_IN_SEC), win = p.loc(E3P.P_LOC);
      expect([win.x, win.y], file).toEqual([iwc.x * 48 + inSec.x, iwc.y * 48 + inSec.y]);

      const back = new QuestRunner(scen);
      const res = applyE3Save(bytes, back.univ, defaults);
      expect(res.warnings.filter((w) => /no match/.test(w)), file).toEqual([]);
      if (res.town) {
        // The town's creatures as E3 left them: each slot dead or alive, and where.
        back.session.resumeInSavedTown(res.town.num, res.town.loc);
        applyE3TownCreatures(back.univ, res.town.cTown);
        applyE3TownTerrain(back.univ, res.town.data);
        // The items on the ground, every one matched and where it lay.
        expect(applyE3TownItems(back.univ, res.town.items, defaults), file).toEqual([]);
        const onGround = [...Array(115).keys()]
          .map((k) => new E3Bytes(save.town!.items.subarray(63 * k, 63 * k + 63)))
          .filter((r) => r.i16(E3ITEM.VARIETY) !== 0);
        expect(back.town.items.map((it) => it.itemLoc), file).toEqual(onGround.map((r) => r.loc(E3ITEM.LOC)));
        // The map as E3 left it: an opened portcullis is still open.
        const dim = Math.min(64, back.town.record.maxDim);
        for (let x = 0; x < dim; x++) {
          for (let y = 0; y < dim; y++) {
            expect(Math.min(255, back.town.record.terrain[x]![y]!), `${file} (${x},${y})`)
              .toBe(save.town!.data[E3TD.TERRAIN + 64 * x + y]);
          }
        }
        const c = new E3Bytes(save.town!.cTown);
        for (let k = 0; k < 60; k++) {
          const at = E3CTOWN.CREATURES + E3CREATURE.SIZE * k;
          if (c.u8(at + E3CREATURE.NUMBER) === 0) continue;
          const m = back.town.monsters.find((x) => x.slot === k);
          const alive = c.i16(at + E3CREATURE.ACTIVE) > 0;
          expect(m?.isAlive ?? false, `${file} creature ${k}`).toBe(alive);
          if (alive) expect(m!.curLoc, `${file} creature ${k}`).toEqual(c.loc(at + E3CREATURE.LOC));
        }
      }
      const out = readE3Save(exportE3Save(back.univ, defaults).bytes);
      const o = new E3Bytes(out.party);
      for (const at of [E3P.AGE, E3P.GOLD, E3P.FOOD]) expect(o.i32(at), `${file} +${at}`).toBe(p.i32(at));
      expect(out.party.subarray(E3P.FLAGS, E3P.FLAGS + 3000), file).toEqual(save.party.subarray(E3P.FLAGS, E3P.FLAGS + 3000));
      expect(out.party.subarray(E3P.SPEC_ITEMS, E3P.FLAGS), file).toEqual(save.party.subarray(E3P.SPEC_ITEMS, E3P.FLAGS));
      expect(out.party.subarray(E3P.KEY_TIMES, E3P.KEY_TIMES + 40), file).toEqual(save.party.subarray(E3P.KEY_TIMES, E3P.KEY_TIMES + 40));
      expect(out.party.subarray(E3P.ALCHEMY, E3P.ALCHEMY + 17), file).toEqual(save.party.subarray(E3P.ALCHEMY, E3P.ALCHEMY + 17));
      expect(out.party.subarray(E3P.JOBS_HELD, E3P.CAN_FIND_TOWN), file).toEqual(save.party.subarray(E3P.JOBS_HELD, E3P.CAN_FIND_TOWN));
      // The journal, the encounter notes and the conversation notes, every one read and written back.
      expect(res.warnings.filter((w) => /journal|notes/i.test(w)), file).toEqual([]);
      expect(out.party.subarray(E3P.JOURNAL_STR, E3P.HELP_RECEIVED), file).toEqual(save.party.subarray(E3P.JOURNAL_STR, E3P.HELP_RECEIVED));
      // The stashes: every item in, and out again in the same order and places.
      const stash = (list: Uint8Array) => [...Array(115).keys()].map((k) => new E3Bytes(list.subarray(63 * k, 63 * k + 63)))
        .filter((r) => r.i16(E3ITEM.VARIETY) !== 0).map((r) => [r.str(E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN), r.loc(E3ITEM.LOC)]);
      save.storedItems.forEach((list, k) => expect(stash(out.storedItems[k]!), `${file} stash ${k}`).toEqual(stash(list)));
      // The magic shops' stock, slot by slot, every byte but what E3 leaves
      // stale: a bought-out slot's record, the word where an item last lay,
      // and what follows a name's NUL.
      const shops = (party: Uint8Array) => {
        const c = party.slice(E3P.MAGIC_STORE_ITEMS, E3P.MAGIC_STORE_ITEMS + 50 * 63);
        for (let k = 0; k < 50; k++) {
          if (c[63 * k] === 0 && c[63 * k + 1] === 0) c.fill(0, 63 * k, 63 * k + 63);
          c.fill(0, 63 * k + E3ITEM.LOC, 63 * k + E3ITEM.LOC + 2);
          const end = c.indexOf(0, 63 * k + E3ITEM.FULL_NAME);
          if (end >= 0 && end < 63 * k + E3ITEM.FULL_NAME + 25) c.fill(0, end, 63 * k + E3ITEM.FULL_NAME + 25);
          const e2 = c.indexOf(0, 63 * k + E3ITEM.NAME);
          if (e2 >= 0 && e2 < 63 * k + E3ITEM.NAME + 15) c.fill(0, e2, 63 * k + E3ITEM.NAME + 15);
        }
        return c;
      };
      expect(shops(out.party), file).toEqual(shops(save.party));
      // The four towns remembered: which, whether hostile, and who in each is
      // alive, as what, with what attitude (an empty slot's bytes are stale);
      // and their fields and spots, inside each town (past it, `misc_i` is
      // whatever the last bigger town left).
      const remembered = (party: Uint8Array, setup: Uint8Array) => [0, 1, 2, 3].map((k) => {
        const b = new E3Bytes(party), base = E3P.CREATURE_SAVE + k * E3P.CREATURE_LIST_SIZE;
        const town = b.i16(base + 0x1590), dim = scen.towns[town]?.maxDim ?? 0;
        const alive = [...Array(60).keys()].map((i) => base + i * E3CREATURE.SIZE)
          .filter((at) => b.i16(at) > 0 && b.u8(at + E3CREATURE.NUMBER) > 0)
          .map((at) => [b.u8(at + E3CREATURE.NUMBER), b.i16(at + E3CREATURE.ATTITUDE)]);
        const fields = [...Array(dim * dim).keys()].map((i) => setup[k * 4096 + 64 * Math.floor(i / dim) + (i % dim)]);
        return { town, hostile: b.i16(base + 0x1592), alive, fields };
      });
      expect(remembered(out.party, out.setup), file).toEqual(remembered(save.party, save.setup));
      expect(o.i16(E3P.AT_WHICH_SAVE_SLOT), file).toBe(p.i16(E3P.AT_WHICH_SAVE_SLOT));
      // The groups wandering outdoors, every one matched to its zone's and written back the same.
      expect(res.warnings.filter((w) => /group outdoors/.test(w)), file).toEqual([]);
      const groups = (party: Uint8Array) => [...Array(10).keys()].map((k) => party.subarray(E3P.OUT_C + 31 * k, E3P.OUT_C + 31 * k + 31))
        .map((r) => (r[0] ? [...r] : []));
      expect(groups(out.party), file).toEqual(groups(save.party));
      // A reply number E3 left stale, whose string is empty, reads as nothing (e3SaveNotes.ts).
      const notes = (party: Uint8Array) => {
        const b = new E3Bytes(party.slice(E3P.SPECIAL_NOTES, E3P.TOTAL_M_KILLED));
        for (let i = 0; i < 120; i++) {
          const at = E3P.TALK_SAVE - E3P.SPECIAL_NOTES + 7 * i, who = b.i16(at);
          for (const r of [at + 3, at + 5]) {
            const n = b.i16(r);
            const id = n >= 1000 ? 15 * 300 + n - 1000 : (120 + Math.floor((who - 1) / 10)) * 300 + n;
            if (who > 0 && n > 0 && !defaults.strings!.get(id)) b.setI16(r, 0);
          }
        }
        return b.data;
      };
      expect(notes(out.party), file).toEqual(notes(save.party));
      if (!save.inTown) {
        expect(out.party.subarray(E3P.OUTDOOR_CORNER, E3P.BOATS), file).toEqual(save.party.subarray(E3P.OUTDOOR_CORNER, E3P.BOATS));
      }
      save.pcs.forEach((pc, i) => {
        // Everything but the poisoned slot, which E3 leaves stale, and the
        // bytes after a name's NUL, which E3 copies from a stack buffer.
        const mask = (r: Uint8Array) => {
          const c = r.slice();
          c[E3PC.WEAP_POISONED] = c[E3PC.WEAP_POISONED + 1] = 0;
          const clearAfterNul = (at: number, len: number) => { const end = c.indexOf(0, at); if (end >= 0 && end < at + len) c.fill(0, end, at + len); };
          clearAfterNul(E3PC.NAME, E3PC.NAME_LEN);
          for (let k = 0; k < 24; k++) {
            // The word at +21 is where the item last lay, which E3 leaves.
            c.fill(0, E3PC.ITEMS + k * E3ITEM.SIZE + E3ITEM.LOC, E3PC.ITEMS + k * E3ITEM.SIZE + E3ITEM.LOC + 2);
            clearAfterNul(E3PC.ITEMS + k * E3ITEM.SIZE + E3ITEM.FULL_NAME, E3ITEM.FULL_NAME_LEN);
            clearAfterNul(E3PC.ITEMS + k * E3ITEM.SIZE + E3ITEM.NAME, E3ITEM.NAME_LEN);
          }
          return c;
        };
        const a = mask(out.pcs[i]!), b = mask(pc);
        const at = a.findIndex((v, k) => v !== b[k]);
        expect(at < 0 ? '' : `+${at}: ${[...a.slice(at, at + 8)]} vs ${[...b.slice(at, at + 8)]}`, `${file} PC ${i}`).toBe('');
      });
    }
  });

  it.skipIf(!realFiles().some((f) => readE3Save(new Uint8Array(readFileSync(f))).inTown))(
    "builds a town's blocks as the original's saves made in town hold them", () => {
      const townDat = defaults.townDat!, table = defaults.monsterTable!;
      for (const file of realFiles()) {
        const save = readE3Save(new Uint8Array(readFileSync(file)));
        if (!save.town) continue;
        const c = new E3Bytes(save.town.cTown);
        const num = c.i16(E3CTOWN.TOWN_NUM);
        expect(save.town.cTown.subarray(E3CTOWN.TOWN, E3CTOWN.TOWN + 0x422), file).toEqual(e3TownHeader(townDat, num));
        expect(c.i16(E3CTOWN.DIFFICULTY), file).toBe(scen.towns[num]!.difficulty);
        // t_d, with the save's own terrain, over the parts the town fills.
        const g = e3TownGeometry(num);
        const d = e3TownData(townDat, num, (x, y) => save.town!.data[64 * x + y]!);
        const parts: [number, number][] = [[E3TD.ROOM_RECTS, 8 * g.rooms], [E3TD.CREATURES, 14 * g.creatures]];
        for (let row = 0; row < g.size / 8; row++) if (num < 40) parts.push([E3TD.LIGHTING + 64 * row, g.size]);
        for (const [at, len] of parts) expect(d.subarray(at, at + len), `${file} +${at}`).toEqual(save.town.data.subarray(at, at + len));
        // Each creature's monster record, but for what play changes.
        const halved = save.party[0xc7f] !== 0;
        for (let k = 0; k < 60; k++) {
          const at = E3CTOWN.CREATURES + E3CREATURE.SIZE * k;
          const n = c.u8(at + E3CREATURE.NUMBER);
          if (n === 0) continue;
          const mine = e3MonsterRecord(table, n, halved);
          const theirs = save.town.cTown.slice(at + E3CREATURE.MONST, at + E3CREATURE.MONST + E3MONST.SIZE);
          for (const r of [mine, theirs]) {
            r.fill(0, E3MONST.HEALTH, E3MONST.HEALTH + 2);
            r.fill(0, E3MONST.MP, E3MONST.MP + 2);
            r.fill(0, E3MONST.STATUS, E3MONST.DIRECTION + 1);
          }
          expect([...mine], `${file} creature ${k} (monster ${n})`).toEqual([...theirs]);
          expect(c.u8(at + E3CREATURE.MOBILE), `${file} creature ${k}`).toBe(c.u8(at + E3CREATURE.START + 4));
        }
      }
    });

  it.skipIf(!realFiles().some((f) => (readE3Save(new Uint8Array(readFileSync(f))).party[0] ?? 0) < 100))(
    "builds a new game's record as the original's, but for what the first turns change", () => {
      const file = realFiles().find((f) => new E3Bytes(readE3Save(new Uint8Array(readFileSync(f))).party).i32(E3P.AGE) < 100) ?? '';
      const save = readE3Save(new Uint8Array(readFileSync(file)));
      const mine = newE3PartyRecord(defaults);
      const differ: number[] = [];
      for (let i = 0; i < mine.length; i++) if (mine[i] !== save.party[i]) differ.push(i);
      const inBlock = (at: number, from: number, len: number) => at >= from && at < from + len;
      // The age, the flags the first turns set, and the vehicles, which a new
      // game's record has none of yet (E3 copies its table in later; the
      // exporter writes them, as every later save has them).
      const unexplained = differ.filter((i) => i >= 4 && !inBlock(i, E3P.FLAGS, 3100)
        && !inBlock(i, E3P.BOATS, 300) && !inBlock(i, E3P.HORSES, 300)
        // the magic shops' stock, which E3 rolls and this leaves empty, and
        // the help messages the first turns showed.
        && !inBlock(i, E3P.MAGIC_STORE_ITEMS, 5 * 10 * 63) && !inBlock(i, E3P.HELP_RECEIVED, 120)
        // and the party's facing, and the job boards, which E3 rolls too.
        && !inBlock(i, E3P.DIRECTION, 2) && !inBlock(i, E3P.JOB_BOARDS, 6 * 0x30));
      expect(unexplained.map((i) => `0x${i.toString(16)}`)).toEqual([]);
      // And a new PC's spells are the defaults, priest then mage.
      for (const pc of save.pcs) {
        expect(pc.subarray(E3PC.PRIEST_SPELLS, E3PC.PRIEST_SPELLS + 30)).toEqual(defaults.priestSpells);
        expect(pc.subarray(E3PC.MAGE_SPELLS, E3PC.MAGE_SPELLS + 30)).toEqual(defaults.mageSpells);
      }
    });
});
