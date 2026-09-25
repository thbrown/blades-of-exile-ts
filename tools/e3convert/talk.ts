/**
 * Exile 3's conversations, which it keeps in the string table in the shape
 * of BoE's legacy talk file. Block `b` (0–38) is strings `(120 + b) * 300`
 * on:
 *
 * | offset | holds |
 * |---|---|
 * | +1 … +10 | the ten personalities' names |
 * | +11 + 3i … | look, name and job text for personality i |
 * | +41 + i | its reply to an unknown word |
 * | +51 + 3j | node j: `pers^key1^key2^type^e1^e2^e3^e4^99`, then its two replies (`pers` is global and 1-based) |
 *
 * A creature's personality `p` (1-based; 0 is none) is block `(p-1) / 10`,
 * slot `(p-1) % 10` — the talk code's own arithmetic (`FUN_1020_1d1d`).
 * That is the engine's own scheme shifted by one, so block `b` becomes
 * `talk<b>.xml` and personality `p` becomes `p - 1`.
 *
 * **E3's node types are its own** (`E3Node`), decoded from the jump table at
 * `1020:2e16` (`ghidra/project/talkarms.s`). They are BoE 1997's
 * (DLGUTILS.CPP) in a different order, and most map onto one engine type.
 * Two things don't:
 *
 * - Shops and inns read the **shopkeeper's** `extra1`/`extra2` (what's on
 *   sale; where the bed is), and personalities are shared between towns — one
 *   "weaponsmith" serves six villages from six different lists. The engine
 *   ties a shop to the node, so a personality whose creatures disagree about
 *   their extras is cloned, one copy per list, into talk blocks 39 and up,
 *   which no E3 town uses.
 * - Types 29 and up (only 100+ occur) are scripted: `FUN_1020_2eb0` switches
 *   on the type. They are E3-3's.
 */

import { TalkNodeType, emptyPersonality, emptySpeech, emptyTalkNode, type Personality, type Speech, type TalkNode } from '../../src/data/talking';
import type { Shop } from '../../src/data/shop';
import { e3Flag } from './flags';
import { E3ShopType, HEALER_SHOP, e3Shop, type E3ShopTables } from './shops';

export const E3_TALK_BLOCKS = 39;

/** E3 writes a quotation mark as `_`. */
export function e3Text(s: string | undefined): string {
  return (s ?? '').replace(/_/g, '"');
}

/** E3's talk node types (the arms of `FUN_1020_1d1d`'s switch). */
export enum E3Node {
  REGULAR = 0,
  /** Flag `(e1,e2)` above `e3`: the second reply. */
  DEP_ON_FLAG = 1,
  /** Flag `(e1,e2)` = 1. */
  SET_FLAG = 2,
  /** Price `e1`, quality `e2`; the bed is the innkeeper's extras. */
  INN = 3,
  /** `day_reached(e1, e2)`: the second reply. */
  DEP_ON_TIME = 4,
  SHOP_ARMOR = 5,
  SELL_ARMOR = 6,
  SHOP_WEAPONS = 7,
  SELL_WEAPONS = 8,
  TRAINING = 9,
  /** Pay `e1`; if `e2 > 0`, flag `(e2,e3)` = 1. */
  BUY_INFO = 10,
  SHOP_FOOD = 11,
  SHOP_GENERAL = 12,
  SELL_ITEMS = 13,
  SHOP_MAGE = 14,
  SHOP_PRIEST = 15,
  SHOP_ALCHEMY = 16,
  /** Magic shop `e1` (0–4), price level `e2 + 1`. */
  SHOP_MAGIC = 17,
  SHOP_HEALER = 18,
  /** Price `e1`. */
  IDENTIFY = 19,
  /** Enchantment `e1`. */
  ENCHANT = 20,
  /** Pay `e1`; flag `(e2,e3)` = `e4`. */
  BUY_FLAG = 21,
  /** Price `e1` for special item `e2` (0–59, at party+0xc). */
  BUY_SPEC_ITEM = 22,
  END_FORCE = 23,
  /** Price `e1` to learn where town `e2` is (the byte array at party+0x8485). */
  BUY_TOWN_LOC = 24,
  /** Job board `e1`, unless the party failed a job there (party+0x847f). */
  JOB_BANK = 25,
  /** The speaker leaves: inactive, and its death flag set. */
  END_DIE = 26,
  END_FIGHT = 27,
  /** Not in town `e1`: the second reply. */
  DEP_ON_TOWN = 28,
}

const SHOP_OF: Partial<Record<E3Node, E3ShopType>> = {
  [E3Node.SHOP_WEAPONS]: E3ShopType.WEAPONS,
  [E3Node.SHOP_ARMOR]: E3ShopType.ARMOR,
  [E3Node.SHOP_GENERAL]: E3ShopType.GENERAL,
  [E3Node.SHOP_FOOD]: E3ShopType.FOOD,
  [E3Node.SHOP_MAGE]: E3ShopType.MAGE,
  [E3Node.SHOP_PRIEST]: E3ShopType.PRIEST,
  [E3Node.SHOP_ALCHEMY]: E3ShopType.ALCHEMY,
};

/** Node types whose meaning depends on the speaker's `extra1`/`extra2`. */
function usesExtras(type: number): boolean {
  return type === E3Node.INN || SHOP_OF[type as E3Node] !== undefined;
}

export interface E3TalkNodeRaw {
  /** The personality it belongs to: global, 1-based. */
  pers: number;
  link1: string;
  link2: string;
  type: number;
  extras: number[];
  str1: string;
  str2: string;
}

export function parseE3TalkNode(def: string): Omit<E3TalkNodeRaw, 'str1' | 'str2'> | null {
  const f = def.split('^');
  if (f.length < 8) return null;
  const int = (i: number) => parseInt(f[i] ?? '0', 10) || 0;
  return { pers: int(0), link1: (f[1] ?? '').slice(0, 4), link2: (f[2] ?? '').slice(0, 4), type: int(3), extras: [int(4), int(5), int(6), int(7)] };
}

export interface E3TalkRaw {
  /** Personality `p` (1-based) is `people[p - 1]`. */
  people: Personality[];
  nodes: E3TalkNodeRaw[];
}

export function readE3Talk(strings: Map<number, string>): E3TalkRaw {
  const people: Personality[] = [];
  const nodes: E3TalkNodeRaw[] = [];
  for (let b = 0; b < E3_TALK_BLOCKS; b++) {
    const base = (120 + b) * 300;
    for (let i = 0; i < 10; i++) {
      const p = emptyPersonality();
      p.title = e3Text(strings.get(base + 1 + i));
      p.look = e3Text(strings.get(base + 11 + 3 * i));
      p.name = e3Text(strings.get(base + 12 + 3 * i));
      p.job = e3Text(strings.get(base + 13 + 3 * i));
      p.dunno = e3Text(strings.get(base + 41 + i));
      people.push(p);
    }
    for (let j = 0; base + 51 + 3 * j < base + 300; j++) {
      const def = strings.get(base + 51 + 3 * j);
      if (def === undefined) continue;
      const raw = parseE3TalkNode(def);
      if (!raw || raw.pers < 1) continue;
      nodes.push({ ...raw, str1: e3Text(strings.get(base + 52 + 3 * j)), str2: e3Text(strings.get(base + 53 + 3 * j)) });
    }
  }
  return { people, nodes };
}

/** A creature that can be talked to, wherever it stands. */
export interface E3Speaker {
  town: number;
  index: number;
  /** 1-based, as E3 stores it. */
  personality: number;
  extra1: number;
  extra2: number;
}

export interface E3TalkConversion {
  /** `talk<b>.xml` for every town record. */
  speeches: Speech[];
  /** Shops after the standard six (so shop `6 + i`). */
  shops: Shop[];
  /** The engine personality of each speaker, keyed `town:index`. */
  personalityOf: Map<string, number>;
}

interface Context {
  tables: E3ShopTables;
  foodBase: number;
  shops: Shop[];
  shopIds: Map<string, number>;
  firstShop: number;
}

function shopFor(ctx: Context, type: E3ShopType, first: number, last: number, title: string): number {
  const key = JSON.stringify([type, first, last, title]);
  const known = ctx.shopIds.get(key);
  if (known !== undefined) return known;
  const shop = e3Shop(ctx.tables, type, first, last, title, ctx.foodBase);
  const id = shop ? ctx.firstShop + ctx.shops.length : HEALER_SHOP;
  if (shop) ctx.shops.push(shop);
  ctx.shopIds.set(key, id);
  return id;
}

/** One E3 node as the engine's, spoken by someone with these extras. */
function convertNode(ctx: Context, raw: E3TalkNodeRaw, personality: number, extras: [number, number]): TalkNode {
  const node = emptyTalkNode();
  node.personality = personality;
  node.link1 = raw.link1.padEnd(4, 'x');
  node.link2 = raw.link2.padEnd(4, 'x');
  node.str1 = raw.str1;
  node.str2 = raw.str2;
  const [e1, e2, e3, e4] = raw.extras as [number, number, number, number];
  const set = (type: TalkNodeType, ...x: number[]) => {
    node.type = type;
    node.extras = [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0, x[3] ?? 0];
  };
  const shopType = SHOP_OF[raw.type as E3Node];
  if (shopType !== undefined) {
    // The shop names itself after the node's text, as the engine's does.
    set(TalkNodeType.SHOP, e1, shopFor(ctx, shopType, extras[0], extras[1], raw.str1));
    return node;
  }
  switch (raw.type as E3Node) {
    case E3Node.REGULAR:
      set(TalkNodeType.REGULAR);
      break;
    case E3Node.DEP_ON_FLAG:
      set(TalkNodeType.DEP_ON_SDF, ...e3Flag(e1, e2), e3);
      break;
    case E3Node.SET_FLAG:
      set(TalkNodeType.SET_SDF, ...e3Flag(e1, e2), 1);
      break;
    case E3Node.INN:
      // TODO(E3-3): E3's inn adds 500 to the party's age (`1020:26d8`); the
      // engine's INN adds BoE's 700, which runs the calendar a little fast.
      set(TalkNodeType.INN, e1, e2, extras[0], extras[1]);
      break;
    case E3Node.DEP_ON_TIME:
      // E3's `day_reached` adds 20 days (so did BoE 1997's; OBoE dropped
      // it), so the day is moved here. TODO(E3-3): `e2` is an event key,
      // and E3 treats one that never happened as "not before the day" —
      // the opposite of the engine's DEP_ON_TIME_AND_EVENT, which needs it
      // to have happened. Nothing sets E3's key times until E3-3's scripts
      // do, so for now the event is left out.
      set(TalkNodeType.DEP_ON_TIME, e1 + 20);
      break;
    case E3Node.SELL_ARMOR:
      set(TalkNodeType.SELL_ARMOR);
      break;
    case E3Node.SELL_WEAPONS:
      set(TalkNodeType.SELL_WEAPONS);
      break;
    case E3Node.SELL_ITEMS:
      set(TalkNodeType.SELL_ITEMS);
      break;
    case E3Node.TRAINING:
      set(TalkNodeType.TRAINING);
      break;
    // BUY_INFO and BUY_FLAG: E3 takes the gold every time it is asked. The
    // engine's BUY_SDF says "You've already learned that." instead once the
    // flag is set — the same answer, told a different way.
    case E3Node.BUY_INFO:
      if (e2 > 0) set(TalkNodeType.BUY_SDF, e1, ...e3Flag(e2, e3), 1);
      else set(TalkNodeType.BUY_INFO, e1);
      break;
    case E3Node.BUY_FLAG:
      set(TalkNodeType.BUY_SDF, e1, ...e3Flag(e2, e3), e4);
      break;
    case E3Node.SHOP_MAGIC:
      set(TalkNodeType.SHOP, e2 + 1, e1);
      break;
    case E3Node.SHOP_HEALER:
      set(TalkNodeType.SHOP, e1, HEALER_SHOP);
      break;
    case E3Node.IDENTIFY:
      set(TalkNodeType.IDENTIFY, e1);
      break;
    case E3Node.ENCHANT:
      set(TalkNodeType.ENCHANT, e1);
      break;
    case E3Node.BUY_SPEC_ITEM:
      // E3 says "You already have it." too (`1020:1ce8`).
      set(TalkNodeType.BUY_SPEC_ITEM, e2, e1);
      break;
    case E3Node.BUY_TOWN_LOC:
      // Where E3 repeats the directions to a town the party already knows
      // about, the engine says "You've already learned that."
      set(TalkNodeType.BUY_TOWN_LOC, e1, e2);
      break;
    case E3Node.JOB_BANK:
      // E3's node text is the refusal, shown only if the party has failed a
      // job here; the engine's JOB_BANK shows str2 for that and uses str1 as
      // the board's title. TODO(E3-3): E3's jobs themselves, and its
      // failure flag (party+0x847f) in place of the engine's anger.
      set(TalkNodeType.JOB_BANK, e1);
      node.str2 = raw.str1;
      node.str1 = '';
      break;
    case E3Node.END_FORCE:
      set(TalkNodeType.END_FORCE);
      break;
    case E3Node.END_DIE:
      set(TalkNodeType.END_DIE);
      break;
    case E3Node.END_FIGHT:
      set(TalkNodeType.END_FIGHT);
      break;
    case E3Node.DEP_ON_TOWN:
      set(TalkNodeType.DEP_ON_TOWN, e1);
      break;
    default:
      // TODO(E3-3): the scripted replies, `FUN_1020_2eb0`'s switch on the
      // type. Their text lives in the script, so the node shows nothing yet.
      set(TalkNodeType.REGULAR);
  }
  return node;
}

/**
 * Converts E3's talk into the engine's, with its shops: `firstShop` is the
 * first free shop number, `foodBase` where the food records sit in the item
 * list, and `speakers` every creature with a personality.
 */
export function convertE3Talk(
  raw: E3TalkRaw, speakers: E3Speaker[], tables: E3ShopTables, blocks: number, firstShop: number, foodBase: number,
): E3TalkConversion {
  const ctx: Context = { tables, foodBase, shops: [], shopIds: new Map(), firstShop };
  const speeches = Array.from({ length: blocks }, emptySpeech);
  const personalityOf = new Map<string, number>();
  const nodesOf = new Map<number, E3TalkNodeRaw[]>();
  for (const n of raw.nodes) nodesOf.set(n.pers, [...(nodesOf.get(n.pers) ?? []), n]);

  // Each personality's speakers, grouped by the extras its nodes would read.
  const groups = new Map<number, { extras: [number, number]; speakers: E3Speaker[] }[]>();
  for (const s of speakers) {
    const list = groups.get(s.personality) ?? [];
    const cares = (nodesOf.get(s.personality) ?? []).some((n) => usesExtras(n.type));
    const g = list.find((x) => !cares || (x.extras[0] === s.extra1 && x.extras[1] === s.extra2));
    if (g) g.speakers.push(s);
    else list.push({ extras: [s.extra1, s.extra2], speakers: [s] });
    groups.set(s.personality, list);
  }

  let nextClone = E3_TALK_BLOCKS * 10;
  const emit = (e3Pers: number, id: number, extras: [number, number]) => {
    const block = speeches[Math.floor(id / 10)];
    if (!block) throw new Error(`no talk block for personality ${id}`);
    block.people[id % 10] = { ...(raw.people[e3Pers - 1] ?? emptyPersonality()) };
    for (const n of nodesOf.get(e3Pers) ?? []) block.talkNodes.push(convertNode(ctx, n, id, extras));
  };
  for (let p = 1; p <= raw.people.length; p++) {
    const list = groups.get(p) ?? [];
    list.forEach((g, i) => {
      const id = i === 0 ? p - 1 : nextClone++;
      for (const s of g.speakers) personalityOf.set(`${s.town}:${s.index}`, id);
      emit(p, id, g.extras);
    });
    // Nobody speaks for it, but its words stay where E3 kept them.
    if (list.length === 0) emit(p, p - 1, [0, 0]);
  }
  return { speeches, shops: ctx.shops, personalityOf };
}
