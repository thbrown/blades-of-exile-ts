/**
 * Where a party gets each spell, read out of the scenario as converted:
 *
 * - every PC starts knowing the first thirty of each school
 *   (`BASIC_SPELLS`, what `Player` gives a new one);
 * - spell shops (`ShopItemType.MAGE_SPELL`/`PRIEST_SPELL`), at their own
 *   price, run by whoever's talk node opens them (`TalkNodeType.SHOP`, the
 *   shop in its second number), in whichever towns that person stands;
 * - scripted teaching (`AFFECT_MAGE_SPELL`/`AFFECT_PRIEST_SPELL` that grant
 *   rather than take away), traced back to what runs it: a person's
 *   conversation (`CALL_SCEN_SPEC`/`CALL_TOWN_SPEC`), a special square in a
 *   town, or one outdoors.
 *
 * The trace walks each node's `jumpto`, and on an `if` node (opcodes 130
 * on) its branch targets, so it can name a teacher a branch leads to that
 * the party never takes. It is the same over-reading the node editor
 * would make, and on Exile III it names every teacher the converter writes.
 */

import { SpecType, type SpecialNode } from '../../data/special';
import { Spell } from '../../data/spell';
import { ShopItemType } from '../../data/shop';
import { TalkNodeType } from '../../data/talking';
import type { Scenario } from '../../data/scenario';
import { BASIC_SPELLS } from '../../universe/player';

export type SourceKind = 'start' | 'shop' | 'taught';

export interface Source {
  kind: SourceKind;
  /** Who: a person's title, or a shop's name. */
  who?: string;
  /** Where: towns, or an outdoor zone. */
  where?: string;
  cost?: number;
}

/** A node list and where it belongs, for naming what the trace finds. */
interface List {
  nodes: Map<number, SpecialNode>;
  /** The scenario's own list, which conversations and `CALL_GLOBAL` reach. */
  global: boolean;
}

const IF_FIRST = SpecType.IF_SDF;

/** The nodes a node can go on to, in its own list or (for `CALL_GLOBAL`) the scenario's. */
function next(node: SpecialNode): { local: number[]; global: number[] } {
  const local: number[] = [];
  const global: number[] = [];
  if (node.type === SpecType.CALL_GLOBAL) {
    if (node.jumpto >= 0) global.push(node.jumpto);
    return { local, global };
  }
  if (node.jumpto >= 0) local.push(node.jumpto);
  if (node.type >= IF_FIRST) {
    for (const n of [node.ex1b, node.ex2b, node.ex1c, node.ex2c]) if (n >= 0) local.push(n);
  }
  return { local, global };
}

/** Each spell a list's nodes teach, reached from `start`. */
function taughtFrom(start: number, list: List, scenList: List): Set<Spell> {
  const out = new Set<Spell>();
  const seen = new Set<string>();
  const todo: [number, List][] = [[start, list]];
  while (todo.length) {
    const [n, l] = todo.pop()!;
    const key = `${l.global ? 'g' : 'l'}${n}`;
    if (seen.has(key) || seen.size > 2000) continue;
    seen.add(key);
    const node = l.nodes.get(n);
    if (!node) continue;
    if ((node.type === SpecType.AFFECT_MAGE_SPELL || node.type === SpecType.AFFECT_PRIEST_SPELL)
      && node.ex1b === 0 && node.ex1a >= 0 && node.ex1a < 62) {
      out.add((node.type === SpecType.AFFECT_MAGE_SPELL ? node.ex1a : 100 + node.ex1a) as Spell);
    }
    const { local, global } = next(node);
    for (const k of local) todo.push([k, l]);
    for (const k of global) todo.push([k, scenList]);
  }
  return out;
}

/** "Krizsan" or "Krizsan, Shayder": the distinct names, in order. */
const names = (xs: string[]): string => [...new Set(xs.filter((x) => x))].join(', ');

export function spellSources(scen: Scenario): Map<Spell, Source[]> {
  const out = new Map<Spell, Source[]>();
  const add = (s: Spell, src: Source): void => {
    const list = out.get(s) ?? [];
    if (!list.some((x) => x.kind === src.kind && x.who === src.who && x.where === src.where && x.cost === src.cost)) {
      list.push(src);
    }
    out.set(s, list);
  };
  for (let i = 0; i < BASIC_SPELLS; i++) {
    add(i as Spell, { kind: 'start' });
    add((100 + i) as Spell, { kind: 'start' });
  }

  // Who stands where: a personality's towns.
  const townsOf = new Map<number, string[]>();
  scen.towns.forEach((town) => {
    for (const p of town.creatures) {
      if (p.number <= 0 || p.personality < 0) continue;
      townsOf.set(p.personality, [...(townsOf.get(p.personality) ?? []), town.name]);
    }
  });
  const title = (p: number): string => scen.townTalk[Math.floor(p / 10)]?.people[p % 10]?.title ?? `person ${p}`;
  const scenList: List = { nodes: scen.scenSpecials, global: true };

  scen.townTalk.forEach((speech) => {
    for (const node of speech?.talkNodes ?? []) {
      if (node.personality < 0) continue;
      const where = names(townsOf.get(node.personality) ?? []);
      if (node.type === TalkNodeType.SHOP) {
        const shop = scen.shops[node.extras[1] ?? -1];
        if (!shop) continue;
        for (const e of shop.items) {
          if (e.type !== ShopItemType.MAGE_SPELL && e.type !== ShopItemType.PRIEST_SPELL) continue;
          const s = (e.type === ShopItemType.MAGE_SPELL ? e.index : 100 + e.index) as Spell;
          add(s, { kind: 'shop', who: title(node.personality), where, cost: e.item.value });
        }
      } else if (node.type === TalkNodeType.CALL_SCEN_SPEC || node.type === TalkNodeType.CALL_TOWN_SPEC) {
        const towns = scen.towns.filter((t) => t.creatures.some((p) => p.personality === node.personality));
        const lists: List[] = node.type === TalkNodeType.CALL_SCEN_SPEC
          ? [scenList] : towns.map((t) => ({ nodes: t.specials, global: false }));
        for (const l of lists) {
          for (const s of taughtFrom(node.extras[0] ?? -1, l, scenList)) {
            add(s, { kind: 'taught', who: title(node.personality), where });
          }
        }
      }
    }
  });

  // Special squares in towns and outdoors.
  scen.towns.forEach((town) => {
    const l: List = { nodes: town.specials, global: false };
    for (const loc of town.specialLocs) {
      if (loc.spec < 0) continue;
      for (const s of taughtFrom(loc.spec, l, scenList)) {
        add(s, { kind: 'taught', where: `${town.name} (${loc.x}, ${loc.y})` });
      }
    }
  });
  scen.outdoors.forEach((col) => col.forEach((sector) => {
    const l: List = { nodes: sector.specials, global: false };
    for (const loc of sector.specialLocs) {
      if (loc.spec < 0) continue;
      for (const s of taughtFrom(loc.spec, l, scenList)) {
        add(s, { kind: 'taught', where: `outdoors, ${sector.name || 'the wilds'} (${loc.x}, ${loc.y})` });
      }
    }
  }));
  return out;
}
