import { describe, expect, it } from 'vitest';
import { e3EncounterLines } from '../src/game/e3Encounter';

describe('Exile III encounter lines (FUN_10d0_3fd8)', () => {
  const names: Record<number, string> = { 7: 'Slime', 115: 'Wolf', 30: 'Bandit Leader', 172: 'Ursag' };
  const name = (m: number): string => names[m] ?? '?';

  it('names the plural slots, E3’s own plurals first, then the one who comes alone', () => {
    expect(e3EncounterLines([7, 115, 0, 0, 0, 0, 30], name))
      .toEqual(['COMBAT!', '  Slimes', '  Wolves', '  Bandit Leader']);
  });

  it('prints a repeated slot twice, and the leader singly even if it has a plural', () => {
    expect(e3EncounterLines([172, 172, 0, 0, 0, 0, 172], name))
      .toEqual(['COMBAT!', '  Ursagi', '  Ursagi', '  Ursag']);
  });
});
