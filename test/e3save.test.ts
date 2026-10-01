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
  E3ITEM, E3P, E3PC, E3_PARTY_SIZE, E3_PC_SIZE, E3_SAVE_OUTDOORS, E3Bytes, emptyE3Save, isE3Save, readE3Save, writeE3Save,
} from '../src/fileio/e3save';
import { e3SaveDefaultsFromJson, e3SaveDefaultsToJson, type E3SaveDefaults } from '../src/fileio/e3SaveDefaults';
import { applyE3Save } from '../src/fileio/e3SaveImport';
import { exportE3Save, newE3PartyRecord } from '../src/fileio/e3SaveExport';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir, readE3Files } from '../tools/e3convert/install';
import { readE3SaveDefaults } from '../tools/e3convert/saveDefaults';
import { partyFlag } from '../tools/e3convert/script';
import { QuestRunner, loadExile3 } from './support/e3Quest';
import { Race, Trait } from '../src/universe/skills';

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
    const fromExe = readE3SaveDefaults(readE3Files(dir as string).exe);
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

  it('enters the town a save was made in, a declining one through its state', async () => {
    const q = new QuestRunner(scen);
    const save = readE3Save(exportE3Save(q.univ, defaults).bytes);
    save.inTown = true;
    const cTown = new Uint8Array(0x2abe);
    new DataView(cTown.buffer).setInt16(0, 6, true);
    cTown[0x29bc] = 30;
    cTown[0x29bd] = 31;
    save.town = { cTown, data: new Uint8Array(0x1710), items: new Uint8Array(0x1c4d) };
    const back = new QuestRunner(scen);
    const res = applyE3Save(writeE3Save(save), back.univ, defaults);
    // Shayder's third record is its first, in state 2.
    expect(res.town).toEqual({ num: 4, loc: { x: 30, y: 31 } });
    expect(back.party.getSdf(294, 11)).toBe(2);
    expect(partyFlag(0xc00)).toEqual([294, 0]);
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
      const out = readE3Save(exportE3Save(back.univ, defaults).bytes);
      const o = new E3Bytes(out.party);
      for (const at of [E3P.AGE, E3P.GOLD, E3P.FOOD]) expect(o.i32(at), `${file} +${at}`).toBe(p.i32(at));
      expect(out.party.subarray(E3P.FLAGS, E3P.FLAGS + 3000), file).toEqual(save.party.subarray(E3P.FLAGS, E3P.FLAGS + 3000));
      expect(out.party.subarray(E3P.SPEC_ITEMS, E3P.FLAGS), file).toEqual(save.party.subarray(E3P.SPEC_ITEMS, E3P.FLAGS));
      expect(out.party.subarray(E3P.KEY_TIMES, E3P.KEY_TIMES + 40), file).toEqual(save.party.subarray(E3P.KEY_TIMES, E3P.KEY_TIMES + 40));
      expect(out.party.subarray(E3P.ALCHEMY, E3P.ALCHEMY + 17), file).toEqual(save.party.subarray(E3P.ALCHEMY, E3P.ALCHEMY + 17));
      expect(out.party.subarray(E3P.JOBS_HELD, E3P.CAN_FIND_TOWN), file).toEqual(save.party.subarray(E3P.JOBS_HELD, E3P.CAN_FIND_TOWN));
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
