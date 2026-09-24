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
 */

import { TalkNodeType, emptySpeech, emptyTalkNode, type Speech } from '../../src/data/talking';

export const E3_TALK_BLOCKS = 39;

/** E3 writes a quotation mark as `_`. */
export function e3Text(s: string | undefined): string {
  return (s ?? '').replace(/_/g, '"');
}

export interface E3TalkNodeRaw {
  /** The personality it belongs to: global, 1-based. */
  pers: number;
  link1: string;
  link2: string;
  type: number;
  extras: number[];
}

export function parseE3TalkNode(def: string): E3TalkNodeRaw | null {
  const f = def.split('^');
  if (f.length < 8) return null;
  const int = (i: number) => parseInt(f[i] ?? '0', 10) || 0;
  return { pers: int(0), link1: (f[1] ?? '').slice(0, 4), link2: (f[2] ?? '').slice(0, 4), type: int(3), extras: [int(4), int(5), int(6), int(7)] };
}

export function readE3Talk(strings: Map<number, string>): Speech[] {
  const out: Speech[] = [];
  for (let b = 0; b < E3_TALK_BLOCKS; b++) {
    const base = (120 + b) * 300;
    const talk = emptySpeech();
    talk.people.forEach((p, i) => {
      p.title = e3Text(strings.get(base + 1 + i));
      p.look = e3Text(strings.get(base + 11 + 3 * i));
      p.name = e3Text(strings.get(base + 12 + 3 * i));
      p.job = e3Text(strings.get(base + 13 + 3 * i));
      p.dunno = e3Text(strings.get(base + 41 + i));
    });
    for (let j = 0; base + 51 + 3 * j < base + 300; j++) {
      const def = strings.get(base + 51 + 3 * j);
      if (def === undefined) continue;
      const raw = parseE3TalkNode(def);
      if (!raw || raw.pers < 1) continue;
      const node = emptyTalkNode();
      // The node's personality is global and 1-based, like a creature's.
      node.personality = raw.pers - 1;
      node.link1 = raw.link1.padEnd(4, 'x');
      node.link2 = raw.link2.padEnd(4, 'x');
      // TODO(E3-2): E3's own node types (shops, inns, training, flags, and
      // the scripted conversations from 100 up). Until then every node is a
      // plain reply, and shows its text.
      node.type = TalkNodeType.REGULAR;
      node.extras = [...raw.extras];
      node.str1 = e3Text(strings.get(base + 52 + 3 * j));
      node.str2 = e3Text(strings.get(base + 53 + 3 * j));
      talk.talkNodes.push(node);
    }
    out.push(talk);
  }
  return out;
}
