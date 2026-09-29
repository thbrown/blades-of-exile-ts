/**
 * Exile III's own `use_item` (`FUN_10c0_2c92`, src/game/e3ItemUse.ts): E3's
 * items go by E3's switch and its use codes, not by BoE's abilities.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Item, ItemAbil, ItemType, ItemUse, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { e3UsesOwnRules, offersUse } from '../src/game/e3ItemUse';
import { useItem } from '../src/game/itemUse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { Skill, Status, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;
beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
});

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  for (const pc of s.univ.party.pcs) {
    pc.items = pc.items.map(() => defaultItem());
    pc.equip.fill(false);
    pc.traits[Trait.MAGICALLY_INEPT] = false;
  }
  return s;
}

/** An E3 item in slot 0 of PC `who`: E3 code `e3Ability`, at `itemLevel`. */
function held(s: GameSession, e3Ability: number, itemLevel: number, item: Partial<Item> = {}, who = 3): Item {
  const made: Item = {
    ...defaultItem(), variety: ItemType.POTION, name: 'Potion', fullName: 'Potion', ident: true,
    charges: 2, itemLevel, e3Ability, ...item,
  };
  s.univ.party.pcs[who]!.items[0] = made;
  return made;
}

const said = (s: GameSession): string => s.univ.transcript.join('\n');

describe("Exile III's use_item (src/game/e3ItemUse.ts)", () => {
  it('a healing potion heals, whatever use type BoE was handed', async () => {
    // The converter leaves E3's byte +8 (1, "drinkable") in the use type,
    // which BoE reads as HARM_ONE — by BoE's path this potion hurt.
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    pc.maxHealth = 200;
    pc.curHealth = 10;
    const potion = held(s, 3, 3, { ability: ItemAbil.AFFECT_HEALTH, abilStrength: 8, magicUseType: ItemUse.HARM_ONE });
    await useItem(s, 3, 0);
    expect(said(s)).toContain('You are healed.');
    // (get_ran(1,0,6) + 6) × (level × 2 + 2): 48 to 96 at level 3.
    expect(pc.curHealth - 10).toBeGreaterThanOrEqual(48);
    expect(pc.curHealth - 10).toBeLessThanOrEqual(96);
    expect(potion.charges).toBe(1);
  });

  it("gates by E3's use codes and keeps the charge when refused", async () => {
    const s = inTown();
    // A Wand of Flame (5): combat only.
    const wand = held(s, 5, 0, { variety: ItemType.WAND, charges: 8 });
    await useItem(s, 3, 0);
    expect(said(s)).toContain('Use: Not while in town.');
    expect(wand.charges).toBe(8);
    // Code 9 (the Lifesaver Amulet) can't be used at all.
    held(s, 9, 0, { variety: ItemType.NECKLACE });
    await useItem(s, 3, 0);
    expect(said(s)).toContain("Use: Can't use this item.");
  });

  it('a magically inept PC may use only the codes marked inept-OK', async () => {
    const s = inTown();
    s.univ.party.pcs[3]!.traits[Trait.MAGICALLY_INEPT] = true;
    held(s, 3, 0);
    await useItem(s, 3, 0);
    expect(said(s)).toContain("Use: Can't - magically inept.");
    // A candle (12) is 10 in the chart: anywhere, inept or not.
    held(s, 12, 1, { variety: ItemType.TOOL });
    await useItem(s, 3, 0);
    expect(said(s)).toContain('You have light.');
  });

  it('the Potion of Doom takes one off each stat and poisons', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    const before = [Skill.STRENGTH, Skill.DEXTERITY, Skill.INTELLIGENCE].map((k) => pc.skills[k]!);
    held(s, 29, 0);
    await useItem(s, 3, 0);
    expect(said(s)).toContain('You burn in agony.');
    expect([Skill.STRENGTH, Skill.DEXTERITY, Skill.INTELLIGENCE].map((k) => pc.skills[k]!))
      .toEqual(before.map((v) => (v > 0 ? v - 1 : v)));
    expect(pc.status[Status.POISON] ?? 0).toBeGreaterThan(0);
  });

  it('Dust of Hiding hides only its user (E3 loops, but writes one PC)', async () => {
    const s = inTown();
    held(s, 87, 0);
    await useItem(s, 3, 0);
    // 6, then one off as the turn passes.
    const hidden = s.univ.party.pcs.map((p) => p.status[Status.INVISIBLE] ?? 0);
    expect(hidden).toEqual([0, 0, 0, 5, 0, 0]);
  });

  it('Scroll: Magic Res. protects everyone, and Brew of Battle sets, not adds', async () => {
    const s = inTown();
    held(s, 36, 0, { variety: ItemType.SCROLL });
    await useItem(s, 3, 0);
    // At least 4 each, less the turn that passes.
    for (const p of s.univ.party.pcs) expect(p.status[Status.MAGIC_RESISTANCE]).toBeGreaterThanOrEqual(3);
    const pc = s.univ.party.pcs[3]!;
    pc.status[Status.BLESS_CURSE] = 20;
    held(s, 115, 0);
    await useItem(s, 3, 0);
    expect(pc.status[Status.BLESS_CURSE]).toBeLessThanOrEqual(8);
    expect(pc.status[Status.BLESS_CURSE]).toBeGreaterThanOrEqual(7);
    expect(pc.status[Status.HASTE_SLOW]).toBeGreaterThanOrEqual(7);
  });

  it("a poison goes on the weapon at the item's level", async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    pc.items[1] = { ...defaultItem(), variety: ItemType.ONE_HANDED, name: 'sword' };
    pc.equip[1] = true;
    // A poison is 11 in E3's chart: combat only (BoE lets it be used anywhere).
    held(s, 8, 6, { variety: ItemType.WEAPON_POISON });
    await useItem(s, 3, 0);
    expect(said(s)).toContain('Use: Not while in town.');
    s.mode = GameMode.COMBAT;
    await useItem(s, 3, 0);
    expect(said(s)).toContain('You poison your weapon.');
    // Strong Poison is level 6: 6, or 3 if put on badly.
    expect([3, 6]).toContain(pc.status[Status.POISONED_WEAPON]);
  });

  it('leaves the notes and the Skribbane Herb to their own paths', () => {
    expect(e3UsesOwnRules(3)).toBe(true);
    expect(e3UsesOwnRules(-1)).toBe(false);
    expect(e3UsesOwnRules(135)).toBe(false);
    expect(e3UsesOwnRules(0xa8)).toBe(false);
  });

  it('offers USE by the use code, so an E3 code with no BoE namesake has one', () => {
    // The wines (60) converted with no BoE ability at all.
    const wine = { ...defaultItem(), variety: ItemType.POTION, e3Ability: 60 };
    expect(offersUse(wine)).toBe(true);
    expect(offersUse({ ...wine, e3Ability: 9 })).toBe(false);
  });
});
