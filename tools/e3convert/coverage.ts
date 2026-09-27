/**
 * How much of Exile 3's quest logic is transcribed: for each town and zone,
 * its scripted spots (encounter numbers below 100) and which have no
 * transcription yet, then the talk scripts left. Reads the converted
 * scenario's `debug.json`, so convert first.
 *
 *   npx vite-node tools/e3convert/coverage.ts          # everything left
 *   npx vite-node tools/e3convert/coverage.ts --all    # done places too
 */

import { readFileSync } from 'node:fs';
import { findE3Dir, readE3Files } from './install';
import { readNeResources, readStringTable } from './ne';
import { E3_ZONES_WIDE } from './outdoor';
import { readE3Talk } from './talk';
import { TALK_SCRIPTS } from './towns/talkScripts';

interface Spot { x: number; y: number; id: number; node: number }
const debug = JSON.parse(readFileSync(new URL('../../public/scenarios/exile3/debug.json', import.meta.url), 'utf8')) as {
  towns: Record<string, Spot[]>; zones: Record<string, Spot[]>;
};
const all = process.argv.includes('--all');
const strings = readStringTable(readNeResources(readE3Files(findE3Dir()!).exe));
const townName = (t: number) => strings.get(30001 + 20 * t) ?? '';

let done = 0;
let left = 0;
const report = (label: string, spots: Spot[]) => {
  const scripted = [...new Map(spots.filter((s) => s.id < 100).map((s) => [s.id, s])).values()];
  const missing = scripted.filter((s) => s.node < 0).map((s) => s.id).sort((a, b) => a - b);
  done += scripted.length - missing.length;
  left += missing.length;
  if (missing.length > 0 || (all && scripted.length > 0)) {
    console.log(`${missing.length ? '    ' : 'done'} ${label}: ${missing.length ? `missing ${missing.join(' ')}` : `${scripted.length} spots`}`);
  }
};
for (const [t, spots] of Object.entries(debug.towns)) report(`town ${t} ${townName(Number(t))}`, spots);
for (const [z, spots] of Object.entries(debug.zones)) report(`zone ${z} (${Number(z) % E3_ZONES_WIDE},${Math.floor(Number(z) / E3_ZONES_WIDE)})`, spots);

const talk = readE3Talk(strings);
const types = [...new Set(talk.nodes.filter((n) => n.type >= 100).map((n) => n.type))];
const talkLeft = types.filter((t) => !TALK_SCRIPTS.has(t));
console.log(`\nspots: ${done} transcribed, ${left} to go (distinct per place)`);
console.log(`talk scripts: ${types.length - talkLeft.length} of ${types.length} done; left: ${talkLeft.join(' ')}`);
