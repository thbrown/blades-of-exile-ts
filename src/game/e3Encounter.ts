/**
 * What Exile III prints as an outdoor fight starts: `FUN_10d0_3fd8` in
 * EXILE3.EXE, called from the encounter code at `1010:435a` with the group's
 * 24-byte record. It says `COMBAT!`, then names each of the group's six
 * many-monster slots in the plural and the seventh, the one that comes
 * alone, as it is. BoE says "You have been attacked!" instead; this is what
 * a scenario with `outdoor-arena` set to `exile3` says (`outCombat.ts`).
 *
 * A plural is one of the twelve E3 spells out (the table at `10d0:4114`),
 * or else the name and an "s" (`"  %ss"`) — so "Wolves" and "Ursagi", and
 * "Slimes", but a name that already ends in "s" gets a second one. Each slot
 * prints on its own, so a group with wolves in two slots says "Wolves"
 * twice. Both are E3's, and kept.
 */

/** `10d0:4114`'s twelve monsters and the plurals at `10d0:3f11`–`3faa`. */
export const E3_PLURALS: ReadonlyMap<number, string> = new Map([
  [17, 'Empire Dervishes'],
  [40, 'Nephilim'],
  [47, 'Slithzerikai'],
  [89, 'Vahnatai'],
  [115, 'Wolves'],
  [143, 'Cockroaches'],
  [144, 'Large Roaches'],
  [145, 'Giant Roaches'],
  [146, 'Mung Roaches'],
  [147, 'Guardian Roaches'],
  [159, 'Golem of Blades'],
  [172, 'Ursagi'],
]);

/** The lines, in order, for a group's seven hostile slots; `name` is a monster's name. */
export function e3EncounterLines(monst: readonly number[], name: (m: number) => string): string[] {
  const lines = ['COMBAT!'];
  for (let i = 0; i < 6; i++) {
    const m = monst[i] ?? 0;
    if (m === 0) continue;
    lines.push(`  ${E3_PLURALS.get(m) ?? `${name(m)}s`}`);
  }
  const alone = monst[6] ?? 0;
  if (alone !== 0) lines.push(`  ${name(alone)}`);
  return lines;
}
