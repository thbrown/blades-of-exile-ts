/**
 * Exile 3's scripted spots, as far as they are data. A zone has 18 and a town
 * 40, each a location and an encounter number. Stepping on one runs the
 * encounter: the outdoor handler is `FUN_10a0_0062` and the town one
 * `FUN_10c0_0000`. Both start with the same generic cases before switching
 * to per-zone or per-town code:
 *
 * | number | what it does |
 * |---|---|
 * | 100–199 | shows one string, `block*300 + (n - 100)` |
 * | 200 and up | shows two, `n - 200` and `n - 199` (the town's 255 is an empty slot) |
 * | 50–59 | nothing |
 * | below 100 | that zone's or town's own code: E3-3 |
 *
 * The string block is `zone / 10 + 80` outdoors. In a town it is
 * `(t - t % 4) / 5 + 52` below town 20, `t / 5 + 52` below 40, and
 * `(t - 40) / 10 + 60` above.
 *
 * A message runs once: the spot is erased afterwards (`FUN_1038_0282`),
 * unless the terrain under it is 209 or more outdoors, or 237 or more in a
 * town. In the engine a one-shot message is `once-disp-msg` with a flag of its
 * own (`spotFlag`).
 *
 * TODO(E3-3): E3 plays sound 57 with each message, and never erases a spot
 * while flag (306, 3) is set.
 */

import { e3SpotFlag } from './flags';

export interface E3Spot { loc: { x: number; y: number }; id: number }

export interface SpotScript {
  /** The `.spec` file. */
  spec: string;
  /** The special strings the nodes' `msg` fields index. */
  strings: string[];
  /** Where each spot's node goes on the map. */
  marks: { x: number; y: number; node: number }[];
}

export function e3TownMessageBlock(t: number): number {
  if (t < 20) return Math.floor((t - (t % 4)) / 5) + 52;
  if (t < 40) return Math.floor(t / 5) + 52;
  return Math.floor((t - 40) / 10) + 60;
}

export function e3ZoneMessageBlock(zone: number): number {
  return Math.floor(zone / 10) + 80;
}

function node(op: string, n: number, sdf: [number, number], msg: [number, number]): string {
  return `@${op} = ${n}
\tsdf ${sdf[0]}, ${sdf[1]}
\tmsg ${msg[0]}, ${msg[1]}, -1
\tpic 0, 4
\tex1 -1, -1, -1
\tex2 -1, -1, -1
\tgoto -1
`;
}

/**
 * The generic message spots of a zone (`place` = `{ zone }`) or a town
 * (`{ town }`). `terrainAt` gives the terrain under a spot, which decides
 * whether its message repeats.
 */
export function e3SpotScript(
  spots: E3Spot[], place: { zone: number } | { town: number },
  strings: Map<number, string>, terrainAt: (x: number, y: number) => number,
): SpotScript {
  const isTown = 'town' in place;
  const block = isTown ? e3TownMessageBlock(place.town) : e3ZoneMessageBlock(place.zone);
  const repeatsFrom = isTown ? 237 : 209;
  const out: SpotScript = { spec: '', strings: [], marks: [] };
  const addString = (id: number) => {
    out.strings.push((strings.get(block * 300 + id) ?? '').replace(/_/g, '"'));
    return out.strings.length - 1;
  };
  const nodes: string[] = [];
  spots.forEach((s, k) => {
    if (s.id < 100 || (isTown && s.id === 255)) return;
    if (s.loc.x === 0 && s.loc.y === 0) return;
    const msg: [number, number] = s.id >= 200
      ? [addString(s.id - 200), addString(s.id - 199)]
      : [addString(s.id - 100), -1];
    const n = nodes.length;
    nodes.push(terrainAt(s.loc.x, s.loc.y) >= repeatsFrom
      ? node('disp-msg', n, [-1, -1], msg)
      : node('once-disp-msg', n, e3SpotFlag(place, k), msg));
    out.marks.push({ x: s.loc.x, y: s.loc.y, node: n });
  });
  out.spec = nodes.join('');
  return out;
}
