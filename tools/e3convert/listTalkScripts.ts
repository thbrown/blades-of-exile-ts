/**
 * Lists Exile 3's scripted talk nodes (types 100 and up): which personality
 * owns each, which towns that personality stands in, and whether
 * `towns/talkScripts.ts` has transcribed it yet. For choosing what E3-3
 * does next.
 *
 *   npx vite-node tools/e3convert/listTalkScripts.ts
 */

import { findE3Dir, readE3Files } from './install';
import { readNeResources, readStringTable } from './ne';
import { readE3Talk } from './talk';
import { readE3Towns } from './town';
import { TALK_SCRIPTS } from './towns/talkScripts';

const dir = findE3Dir();
if (!dir) throw new Error('no Exile 3 install found');
const files = readE3Files(dir);
const talk = readE3Talk(readStringTable(readNeResources(files.exe)));
const where = new Map<number, Set<number>>();
for (const t of readE3Towns(files.town)) {
  for (const c of t.village ? t.village.creatures : t.creatures) {
    if (c.number > 0 && c.personality > 0) where.set(c.personality, (where.get(c.personality) ?? new Set()).add(t.number));
  }
}
const rows = talk.nodes.filter((n) => n.type >= 100).sort((a, b) => a.type - b.type);
for (const n of rows) {
  const who = talk.people[n.pers - 1]?.title ?? '?';
  const towns = [...(where.get(n.pers) ?? [])].join(',');
  console.log(`${TALK_SCRIPTS.has(n.type) ? 'done' : '    '} ${n.type} ${who} (${n.link1}/${n.link2}) towns ${towns}`);
}
