/**
 * The spells page's rules (`src/pages/spells/spellRules.ts`): every one of
 * the 124 spells Exile III has says what it does, and the numbers it works
 * out are numbers for any caster the page lets the reader set.
 */

import { describe, expect, it } from 'vitest';
import { SPELLS, type Spell } from '../src/data/spell';
import { SKILL_BONUS, SPELL_RULES } from '../src/pages/spells/spellRules';

describe('the spells page’s rules', () => {
  it('cover every spell of both schools', () => {
    const missing: number[] = [];
    for (const base of [0, 100]) {
      for (let i = 0; i < 62; i++) if (SPELLS[(base + i) as Spell] && !SPELL_RULES[(base + i) as Spell]) missing.push(base + i);
    }
    expect(missing).toEqual([]);
  });

  it('work out a number for any caster, level 1–50 and Intelligence 0–20', () => {
    for (const [spell, rule] of Object.entries(SPELL_RULES)) {
      if (!rule?.at) continue;
      for (let level = 1; level <= 50; level += 7) {
        for (const bonus of SKILL_BONUS) expect(rule.at({ level, bonus }), `${spell} L${level} B${bonus}`).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it('read the formulas the code has', () => {
    const at = (s: Spell, level: number, bonus: number) => SPELL_RULES[s]!.at!({ level, bonus });
    // Fireball at level 10, Intelligence bonus 2: P = 6, min(9, 1 + 4 + 2) + 1 = 8 dice.
    expect(at(22 as Spell, 10, 2)).toMatch(/^8d6 /);
    // Flame: min(10, 1 + ⌊P/3⌋ + B) = 1 + 2 + 2 = 5 dice.
    expect(at(11 as Spell, 10, 2)).toMatch(/^5d6 /);
    // Kill: 40 + 2L + three rolls of 0–10.
    expect(at(48 as Spell, 10, 0)).toBe('60–90 (avg 75)');
  });
});
