/**
 * What reading and writing an Exile III save needs from EXILE3.EXE itself,
 * beyond the converted scenario: the converter copies it out
 * (`tools/e3convert/saveDefaults.ts`) into `e3save.json` beside the
 * scenario, so the browser has it too.
 *
 * - **The item table** (segment 38, 415 records of 59 bytes): a save holds
 *   E3's items, and the scenario's are converted ones, whose E3 picture and
 *   ability bytes are gone.
 * - **The boats and horses** a new game starts with (`DS:2be0`, `DS:2d0c`):
 *   the scenario renumbers them (`vehicleNumbers`), and only these say how.
 * - **New-game defaults** `init_party` (`FUN_10b0_053c`) copies in: the towns
 *   that can be found (`DS:29b2`) and a new PC's spells (`DS:296c`, `294e`).
 */

import { E3ITEM } from './e3save';

export const E3_TABLE_ITEM_SIZE = 59;

export interface E3SaveDefaults {
  itemTable: Uint8Array;
  boats: Uint8Array;
  horses: Uint8Array;
  canFind: Uint8Array;
  mageSpells: Uint8Array;
  priestSpells: Uint8Array;
}

const KEYS = ['itemTable', 'boats', 'horses', 'canFind', 'mageSpells', 'priestSpells'] as const;

function toBase64(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function e3SaveDefaultsToJson(d: E3SaveDefaults): string {
  return JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, toBase64(d[k])])));
}

export function e3SaveDefaultsFromJson(text: string): E3SaveDefaults {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const get = (k: (typeof KEYS)[number]): Uint8Array => {
    const v = raw[k];
    if (typeof v !== 'string') throw new Error(`e3save.json has no ${k}`);
    return fromBase64(v);
  };
  return {
    itemTable: get('itemTable'), boats: get('boats'), horses: get('horses'),
    canFind: get('canFind'), mageSpells: get('mageSpells'), priestSpells: get('priestSpells'),
  };
}

export function e3TableItemCount(d: E3SaveDefaults): number {
  return Math.floor(d.itemTable.length / E3_TABLE_ITEM_SIZE);
}

/** Table record `k`'s full name (table +19, 25 bytes). */
export function e3TableItemName(d: E3SaveDefaults, k: number): string {
  const at = k * E3_TABLE_ITEM_SIZE + 19;
  const b = d.itemTable.subarray(at, at + 25);
  const end = b.indexOf(0);
  return new TextDecoder('windows-1252').decode(end < 0 ? b : b.subarray(0, end));
}

/**
 * Table record `k` as E3 holds an item in memory (`FUN_1068_0886`): the
 * 63-byte layout `E3ITEM` names.
 */
export function e3ItemFromTable(d: E3SaveDefaults, k: number): Uint8Array {
  const t = d.itemTable.subarray(k * E3_TABLE_ITEM_SIZE, (k + 1) * E3_TABLE_ITEM_SIZE);
  const out = new Uint8Array(E3ITEM.SIZE);
  out.set(t.subarray(0, 16), 0);
  out[E3ITEM.MAGIC] = t[16]!;
  out[E3ITEM.WEIGHT] = t[17]!;
  out[E3ITEM.CLASS] = t[18]!;
  out.set(t.subarray(19, 44), E3ITEM.FULL_NAME);
  out.set(t.subarray(44, 59), E3ITEM.NAME);
  return out;
}
