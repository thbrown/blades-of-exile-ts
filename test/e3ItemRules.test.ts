/**
 * The Exile III item list's readings (`src/pages/items/e3ItemRules.ts`) must
 * keep up with the rules they describe: every Use case in E3's `use_item`
 * port and every ability code in E3's item table needs an entry, or the page
 * would say "nothing reads it" about an item the engine does act on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Item, ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { RULE_CODES, combatLine, hasRule, readE3Item } from '../src/pages/items/e3ItemRules';
import { findE3Dir, readE3Files } from '../tools/e3convert/install';
import { readE3ItemAbilities } from '../tools/e3convert/tables';

const scen = { scenMonsters: [] } as unknown as Scenario;

function item(code: number, variety: ItemType, level = 0, name = 'Thing'): Item {
  return { ...defaultItem(), e3Ability: code, variety, itemLevel: level, fullName: name };
}

describe('Exile III item readings', () => {
  it("has an entry for every case of E3's use_item", () => {
    const src = readFileSync(new URL('../src/game/e3ItemUse.ts', import.meta.url), 'utf8');
    const cases = [...src.matchAll(/case (\d+):/g)].map((m) => Number(m[1]));
    expect(cases.length).toBeGreaterThan(50);
    expect(cases.filter((c) => !RULE_CODES.includes(c))).toEqual([]);
  });

  const dir = findE3Dir();
  it.skipIf(!dir)("has an entry for every ability code in E3's item table", () => {
    const codes = new Set(readE3ItemAbilities(readE3Files(dir!).exe));
    expect([...codes].filter((c) => !hasRule(c))).toEqual([]);
  });

  it('reads a healing potion by E3’s numbers, and flags the sheet’s "Drain Health"', () => {
    const r = readE3Item(item(3, ItemType.POTION, 3), 'Drain Health', scen);
    expect(r.effect).toContain('48–96');
    expect(r.verdict).toBe('differs');
    expect(readE3Item(item(3, ItemType.POTION, 3), 'Heal', scen).verdict).toBe('agrees');
  });

  it('compares a cast spell by name, once the string tables are in', () => {
    // Code 45 casts Ravage Spirit; the Prismatic Wand's sheet says Dispel Undead.
    expect(readE3Item(item(45, ItemType.WAND), 'Spell: Dispel Undead', scen).verdict).toBe('differs');
    expect(readE3Item(item(45, ItemType.WAND), 'Spell: Ravage Spirit', scen).verdict).toBe('agrees');
  });

  it('knows venom works on melee blows only', () => {
    expect(readE3Item(item(32, ItemType.ONE_HANDED), 'Poisoned Weapon', scen).verdict).toBe('agrees');
    expect(readE3Item(item(32, ItemType.THROWN_MISSILE), 'Poisoned Weapon', scen).verdict).toBe('differs');
  });

  it('calls a curse hidden only when the name gives nothing away', () => {
    expect(readE3Item(item(14, ItemType.HELM, 0, 'Cursed Helm'), '', scen).verdict).toBe('agrees');
    expect(readE3Item(item(14, ItemType.RING, 0, 'Gold Weight Ring'), '', scen).verdict).toBe('differs');
  });

  it('marks the abilities still run by BoE’s rule as unread', () => {
    expect(readE3Item(item(46, ItemType.RING), 'Regenerate', scen).verdict).toBe('unread');
  });

  it('spells out what the combat numbers mean', () => {
    const sword = { ...item(0, ItemType.ONE_HANDED, 8), bonus: 2 };
    expect(combatLine(sword)).toMatch(/^Hits for 1–8 \+ 2 \(\+2 as the only or main weapon.*to hit \+10/);
    // A two-handed weapon is never in the off hand.
    const great = { ...item(0, ItemType.TWO_HANDED, 12), bonus: 1 };
    expect(combatLine(great)).toMatch(/^Hits for 1–12 \+ 1 \+ 2 \(two-handed/);
    expect(combatLine(great)).not.toContain('off hand');
    const plate = { ...item(0, ItemType.ARMOR, 5), awkward: 2 };
    expect(combatLine(plate)).toMatch(/^blocks 1–5 of each blow; encumbrance 2/);
  });
});
