/**
 * The three lists of things the party has been told, in an Exile III save:
 * the events journal, the encounter notes and the conversation notes. E3
 * keeps string *numbers* in each, as BoE 1997 did, and the engine keeps the
 * text, as OBoE does, so both directions go through E3's strings
 * (`E3SaveDefaults.strings`) or the scenario's journal entries.
 *
 * - **The journal** (party+0x7bb2, +0x7c2a): 120 entries, an entry number and
 *   the day (`calc_day`, 1 on the first). Entry `e` is the scenario's
 *   `<journal id="e">`, string 5100 + `e` in E3 (`FUN_1008_3780`). Empty is 0.
 * - **The encounter notes** (+0x7d92): 140 `(list, number)` pairs, each one
 *   string, `get_str(list, number)` (`FUN_1008_3023`); the Record button on a
 *   message keeps its one or two strings as one note each (`1008:2890`), as
 *   the engine's does. Empty is a list below 1. E3 doesn't say where a note
 *   was found; a message spot's list is its place's block
 *   (`e3TownMessageBlock`, `e3ZoneMessageBlock`), and of those towns or
 *   zones (or, for a script's own list, of all of them) the one whose
 *   strings hold the text is the place.
 * - **The conversation notes** (+0x7fc2): 120 of 7 bytes, personality i16
 *   (1-based, -1 empty), town u8, then the two replies, i16 each
 *   (`FUN_1008_3168`): a reply below 1000 is string `k` of the speaker's
 *   talk block, `get_str(120 + (p − 1) / 10, k)`, 1000 and up is
 *   `get_str(15, k − 1000)`, and 0 or less is nothing. The speaker is
 *   `get_str(120 + (p − 1) / 10, (p − 1) % 10 + 1)`, its title. What a node
 *   leaves to record is its pair, 52 + 3j and 53 + 3j (`1020:2597`), or for
 *   some types the one it chose and 0 (`ONE_REPLY`); a look, name or job is
 *   the one string and 0 (`1020:2525`).
 *
 * **What doesn't come back**: a reply number whose string is empty, which
 * E3 leaves when an arm doesn't set the second (`1020:4b0a` with one
 * string), reads as nothing and goes out as 0.
 */

import { E3Bytes, E3P, E3_ZONES_ACROSS } from './e3save';
import type { E3SaveDefaults } from './e3SaveDefaults';
import { e3Text } from '../../tools/e3convert/talk';
import { e3TownMessageBlock, e3ZoneMessageBlock } from '../../tools/e3convert/specials';
import { EncNoteType, type EncNote, type JournalEntry, type TalkNote } from '../universe/party';
import type { Universe } from '../universe/universe';

const JOURNAL_HELD = 120;
const NOTES_HELD = 140;
const TALK_HELD = 120;
const TALK_SIZE = 7;
/** E3's towns, which keep the engine's numbers; later records are the converter's. */
const E3_TOWNS = 200;
const TALK_LIST = 120;
const SHARED_TALK_LIST = 15;
/** A talk block's nodes: node `j`'s definition is string 51 + 3j, its replies the two after. */
const NODE_STRS = 52;

/**
 * The E3 node types that record one reply (the arms of the switch at
 * `1020:2e16`): each moves the second string over the first when its test
 * or payment chooses it, then clears the second — the dependent ones (1 and
 * 4) and the paid ones (10, 21, 22, 24, 28) in the tail at `1020:2983` and
 * their own (`2afb`, `2b88`, `2bfd`, `2d67`), the inn at `2728`. The rest
 * record both, or put up a screen of their own and leave nothing (-1).
 */
const ONE_REPLY = new Set([1, 3, 4, 10, 21, 22, 24, 28]);

function str(defaults: E3SaveDefaults, list: number, k: number): string {
  return e3Text(defaults.strings?.get(list * 300 + k));
}

const indexes = new WeakMap<Map<number, string>, Map<string, number[]>>();

/** Every string id whose text is `text`, lowest first. */
function idsOf(defaults: E3SaveDefaults, text: string): number[] {
  const strings = defaults.strings;
  if (!strings || text === '') return [];
  let index = indexes.get(strings);
  if (!index) {
    index = new Map();
    for (const [id, s] of strings) {
      const t = e3Text(s);
      const ids = index.get(t);
      if (ids) ids.push(id);
      else index.set(t, [id]);
    }
    indexes.set(strings, index);
  }
  return index.get(text) ?? [];
}

/** The `k` of `list` whose text is `text`, or -1. */
function strIndex(defaults: E3SaveDefaults, list: number, text: string): number {
  const id = idsOf(defaults, text).find((i) => Math.floor(i / 300) === list);
  return id === undefined ? -1 : id % 300;
}

interface Place { type: EncNoteType; name: string; strs: string[]; block: number }

function places(univ: Universe): Place[] {
  const { scenario } = univ;
  const out: Place[] = scenario.towns.slice(0, E3_TOWNS).map((t, k) => ({
    type: EncNoteType.TOWN, name: t.name, strs: t.specStrs, block: e3TownMessageBlock(k),
  }));
  scenario.outdoors.forEach((col, x) => col.forEach((sector, y) => {
    if (x < E3_ZONES_ACROSS) {
      out.push({ type: EncNoteType.OUT, name: sector.name, strs: sector.specStrs, block: e3ZoneMessageBlock(y * E3_ZONES_ACROSS + x) });
    }
  }));
  return out;
}

/** Where a message of list `list` was found, as the engine names it. */
function placeOf(all: Place[], list: number, text: string): { type: EncNoteType; where: string } {
  const own = all.filter((p) => p.block === list);
  const place = own.find((p) => p.strs.includes(text)) ?? all.find((p) => p.strs.includes(text)) ?? own[0];
  return place ? { type: place.type, where: place.name } : { type: EncNoteType.SCEN, where: '' };
}

export function readE3Notes(univ: Universe, p: E3Bytes, defaults: E3SaveDefaults, warnings: string[]): void {
  const { party, scenario } = univ;
  const journal: JournalEntry[] = [];
  for (let i = 0; i < JOURNAL_HELD; i++) {
    const e = p.u8(E3P.JOURNAL_STR + i);
    if (e === 0) continue;
    const theStr = scenario.journalStrs[e];
    if (theStr) journal.push({ day: p.i16(E3P.JOURNAL_DAY + 2 * i), theStr, inScen: scenario.id });
    else warnings.push(`Journal entry ${e} isn't one of the scenario's.`);
  }
  party.journal = journal;
  if (!defaults.strings) {
    warnings.push('The encounter and conversation notes need a newer copy of Exile III; they were left out.');
    return;
  }
  const all = places(univ);
  const notes: EncNote[] = [];
  for (let i = 0; i < NOTES_HELD; i++) {
    const list = p.i16(E3P.SPECIAL_NOTES + 4 * i);
    if (list < 1) continue;
    const theStr = str(defaults, list, p.i16(E3P.SPECIAL_NOTES + 4 * i + 2));
    if (theStr !== '') notes.push({ ...placeOf(all, list, theStr), theStr });
  }
  party.specialNotes = notes;
  const talk: TalkNote[] = [];
  for (let i = 0; i < TALK_HELD; i++) {
    const at = E3P.TALK_SAVE + TALK_SIZE * i;
    const who = p.i16(at);
    if (who < 1) continue;
    const list = TALK_LIST + Math.floor((who - 1) / 10);
    const reply = (n: number) => (n >= 1000 ? str(defaults, SHARED_TALK_LIST, n - 1000) : n > 0 ? str(defaults, list, n) : '');
    talk.push({
      whoSaid: str(defaults, list, ((who - 1) % 10) + 1),
      inTown: scenario.towns[p.u8(at + 2)]?.name ?? '',
      str1: reply(p.i16(at + 3)),
      str2: reply(p.i16(at + 5)),
      inScen: scenario.id,
    });
  }
  party.talkSave = talk;
}

export function writeE3Notes(univ: Universe, p: E3Bytes, defaults: E3SaveDefaults, warnings: string[]): void {
  const { party, scenario } = univ;
  // A new game's journal has entry 1 (`init_party`); the party's own replaces it.
  p.setU8(E3P.JOURNAL_STR, 0);
  p.setI16(E3P.JOURNAL_DAY, 0);
  let j = 0;
  for (const entry of party.journal) {
    const e = scenario.journalStrs.indexOf(entry.theStr);
    if (e < 1 || entry.inScen !== scenario.id || j === JOURNAL_HELD) continue;
    p.setU8(E3P.JOURNAL_STR + j, e);
    p.setI16(E3P.JOURNAL_DAY + 2 * j, entry.day);
    j++;
  }
  if (!defaults.strings) {
    if (party.specialNotes.length || party.talkSave.length) {
      warnings.push('The encounter and conversation notes need a newer copy of Exile III; they were left out.');
    }
    return;
  }
  const all = places(univ);
  let n = 0, lost = 0;
  for (const note of party.specialNotes) {
    // The place's own block first; then any list that has the words.
    const own = all.filter((pl) => pl.type === note.type && pl.name === note.where).map((pl) => pl.block);
    const ids = idsOf(defaults, note.theStr);
    const id = ids.find((i) => own.includes(Math.floor(i / 300))) ?? ids[0];
    if (id === undefined || n === NOTES_HELD) {
      lost++;
      continue;
    }
    p.setI16(E3P.SPECIAL_NOTES + 4 * n, Math.floor(id / 300));
    p.setI16(E3P.SPECIAL_NOTES + 4 * n + 2, id % 300);
    n++;
  }
  if (lost) warnings.push(`${lost} of the encounter notes aren't Exile III's own words, and were left out.`);
  let t = 0;
  lost = 0;
  for (const note of party.talkSave) {
    const rec = note.inScen === scenario.id && t < TALK_HELD ? talkRecord(univ, defaults, note) : null;
    if (!rec) {
      lost++;
      continue;
    }
    const at = E3P.TALK_SAVE + TALK_SIZE * t;
    p.setI16(at, rec.who);
    p.setU8(at + 2, rec.town);
    p.setI16(at + 3, rec.str1);
    p.setI16(at + 5, rec.str2);
    t++;
  }
  if (lost) warnings.push(`${lost} of the conversation notes aren't Exile III's own words, and were left out.`);
}

/** A conversation note as E3's numbers: the first personality whose title and words match. */
function talkRecord(univ: Universe, defaults: E3SaveDefaults, note: TalkNote):
  { who: number; town: number; str1: number; str2: number } | null {
  const towns = univ.scenario.towns.slice(0, E3_TOWNS);
  for (let who = 1; who <= 10 * (158 - TALK_LIST + 1); who++) {
    const list = TALK_LIST + Math.floor((who - 1) / 10);
    if (str(defaults, list, ((who - 1) % 10) + 1) !== note.whoSaid) continue;
    const reply = (text: string): number | null => {
      if (text === '') return 0;
      const k = strIndex(defaults, list, text);
      if (k >= 0) return k;
      const shared = strIndex(defaults, SHARED_TALK_LIST, text);
      return shared >= 0 ? 1000 + shared : null;
    };
    let str1 = reply(note.str1), str2 = reply(note.str2);
    if (str1 === null || str2 === null) continue;
    // One of a node's replies: what that node's type leaves (`ONE_REPLY`).
    if (str1 >= NODE_STRS && str1 < 1000 && (str1 - NODE_STRS) % 3 < 2) {
      const a = NODE_STRS + 3 * Math.floor((str1 - NODE_STRS) / 3);
      const type = Number((defaults.strings?.get(list * 300 + a - 1) ?? '').split('^')[3]);
      const chose = str1 === a + 1 && note.str1 !== str(defaults, list, a);
      if (ONE_REPLY.has(type)) [str1, str2] = [chose ? a + 1 : a, 0];
      else if (str2 === 0 || str2 === a + 1) [str1, str2] = [a, a + 1];
    }
    // Two towns can share a name (a declining town's records): the one
    // whose people include the speaker.
    const named = towns.map((t, k) => (t.name === note.inTown ? k : -1)).filter((k) => k >= 0);
    const town = named.find((k) => towns[k]!.creatures.some((c) => c.personality === who - 1)) ?? named[0] ?? 0;
    return { who, town, str1, str2 };
  }
  return null;
}
