/**
 * E3's readable items: books, notes and maps. Using an item whose ability
 * byte (+10) is 0xa0–0xb7 runs one case of `FUN_10c0_2c92`'s switch (the
 * jump table at `cs:3cb1`, indexed by ability − 3). None of them uses the
 * item up; every case leaves by `3c4f` with the use-up flag clear.
 *
 * The ability rarely comes from the item table. A town's preset item names
 * it (the town loader `10d8:1531` writes the preset's `ability` into the
 * item's +10 unless the item is gold or food), and a script stamps it on
 * with `FUN_1070_0464(item, ability)`. So one table item, the Book (29), is
 * a dozen different books; the engine's items carry their ability in the
 * table, so each (item, ability) pair gets an item of its own, appended to
 * items.xml (`e3NoteItems`).
 */

import type { E3Town } from './town';
import { partyFlag as f, type SpecBuilder, type Step } from './script';

/** The abilities `FUN_10c0_2c92` reads: 0xa0 up to the switch's end, 0xb7. */
export function isE3NoteAbility(ability: number): boolean {
  return ability >= 0xa0 && ability <= 0xb7;
}

/**
 * The books: `FUN_1008_3b3f(0x10, a, 0x10, b, "Reading a book.", 57, …)`,
 * two strings of message block 16 under a heading. `[a, b]` by ability.
 * The engine's message has no heading, so "Reading a book." is not shown.
 */
const BOOKS = new Map<number, [number, number]>([
  [0xa0, [1, 2]], [0xa1, [9, 0xa]], [0xa2, [3, 4]], [0xa3, [5, 6]], [0xa4, [7, 8]],
  [0xa5, [0xb, 0xc]], [0xa6, [0xd, 0xe]], [0xaa, [0xf, 0x10]], [0xab, [0x11, 0x12]],
  [0xac, [0x13, 0x14]], [0xad, [0x15, 0x16]], [0xae, [0x17, 0x18]],
]);

/** The maps and letters, each a dialog with only an OK. */
const NOTE_DIALOGS = new Map<number, number>([
  // Anaximander's map ("Come see me as soon as possible"), and the one of
  // the goblin and bandit infestations near Fort Emergence.
  [0xa7, 0x807], [0xa8, 0x804],
  [0xb0, 0xeb0],
  // Aminro's smeared map, the map to Black Halberd Masok sells, and the one
  // on a dead troglodyte.
  [0xb2, 0x116d], [0xb3, 0x3ba], [0xb4, 0x161f],
  [0xb5, 0xcd5], [0xb6, 0xcd6],
]);

/** What using an item with this ability does. */
export function e3NoteSteps(b: SpecBuilder, ability: number): Step[] {
  const book = BOOKS.get(ability);
  if (book) return [b.msg(0x10, book[0], book[1])];
  const dlg = NOTE_DIALOGS.get(ability);
  if (dlg !== undefined) return [b.dialog(dlg)];
  switch (ability) {
    // Jordan's map, which puts town 22 on the map (party+0x849b).
    case 0xa9:
      return [b.dialog(0xd86), b.townVisible(22)];
    // "You may proceed.": the scroll that opens the remote cave's passage
    // (`dungeons.ts`, spot 9 there).
    case 0xaf:
      return [b.msg(0x3f, 0x40), b.setFlag(f(0x35d), 1)];
    // Zalvax's note on the map to Vothkaro, which puts town 54 on the map
    // (party+0x84bb).
    case 0xb1:
      return [b.dialog(0xcf3), b.townVisible(54)];
    // A note, `FUN_1008_3b3f(0x43, 4, 0, 0, "Reading a note.", …)`.
    case 0xb7:
      return [b.msg(0x43, 4)];
    default:
      throw new Error(`ability ${ability} is not one of E3's readable items`);
  }
}

/** The notes the town scripts make with `FUN_1070_0464(item, ability)`. */
const SCRIPT_NOTES: [number, number][] = [
  // Castle Troglo (`castleTroglo.ts`).
  [31, 0xb5], [31, 0xb6],
  // Aminro's (`villages.ts`), Masok's (`talkScripts.ts`) and the
  // troglodytes' (`towns/encounters.ts`).
  [31, 0xb2], [31, 0xb3], [31, 0xb4],
];

/**
 * Every (item, ability) pair that needs a note item of its own: the scripts'
 * and the towns' presets, in a fixed order so item numbers are stable.
 * `isGoldOrFood` says whose preset `ability` is an amount instead.
 */
export function e3NoteItems(towns: E3Town[], isGoldOrFood: (item: number) => boolean): [number, number][] {
  const pairs = new Map<string, [number, number]>(SCRIPT_NOTES.map((p) => [`${p[0]}:${p[1]}`, p]));
  for (const t of towns) {
    for (const p of t.presetItems) {
      if (p.itemCode < 0 || isGoldOrFood(p.itemCode) || !isE3NoteAbility(p.ability)) continue;
      pairs.set(`${p.itemCode}:${p.ability}`, [p.itemCode, p.ability]);
    }
  }
  const scripted = SCRIPT_NOTES.length;
  const rest = [...pairs.values()].slice(scripted).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [...SCRIPT_NOTES, ...rest];
}

/**
 * Items with an ability of their own that isn't a readable one: a town
 * preset whose `ability` differs from its table item's, or a script's
 * `FUN_1070_0464(item, ability)`. Each (item, ability) pair gets an item of
 * its own, as the notes do, appended after them so the notes' numbers stay.
 */
const SCRIPT_STAMPS: [number, number][] = [
  // The plate from an outdoor group (`towns/encounters.ts`, 10c0:0977).
  [0x89, 77],
];

export function e3StampedItems(
  towns: E3Town[], isGoldOrFood: (item: number) => boolean, tableAbility: (item: number) => number,
): [number, number][] {
  const pairs = new Map<string, [number, number]>(SCRIPT_STAMPS.map((p) => [`${p[0]}:${p[1]}`, p]));
  const found: [number, number][] = [];
  for (const t of towns) {
    for (const p of t.presetItems) {
      if (p.itemCode < 0 || p.ability < 0 || isGoldOrFood(p.itemCode) || isE3NoteAbility(p.ability)) continue;
      if (p.ability === tableAbility(p.itemCode)) continue;
      const key = `${p.itemCode}:${p.ability}`;
      if (!pairs.has(key)) found.push([p.itemCode, p.ability]);
      pairs.set(key, [p.itemCode, p.ability]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [...SCRIPT_STAMPS, ...found];
}
