/**
 * Prints Exile 3's text by the numbers the scripts use, for transcribing:
 *
 *   npx vite-node tools/e3convert/show.ts 56:0x5d 56:0x5e d0xcae s4500
 *
 * `block:i` is message string `block*300 + i` (`FUN_1008_37de`), `dN` is
 * dialog resource N with its controls, `sN` is string N. Numbers may be hex.
 * The text is the user's own copy's, printed and never written anywhere.
 */

import { findE3Dir, readE3Files } from './install';
import { readDialogs, readNeResources, readStringTable } from './ne';

const dir = findE3Dir();
if (!dir) throw new Error('no Exile 3 install');
const res = readNeResources(readE3Files(dir).exe);
const strings = readStringTable(res);
const dialogs = readDialogs(res);
const num = (s: string) => Number(s);

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('d')) {
    const d = dialogs.get(num(arg.slice(1)));
    console.log(`== dialog ${arg.slice(1)}${d ? ` "${d.caption}"` : ' (none)'}`);
    for (const c of d?.controls ?? []) if (c.text) console.log(`  [${c.id}] ${c.text}`);
  } else if (arg.startsWith('s')) {
    console.log(`== s${arg.slice(1)}: ${strings.get(num(arg.slice(1))) ?? '(none)'}`);
  } else {
    const [b, i] = arg.split(':').map(num);
    console.log(`== ${arg}: ${strings.get((b ?? 0) * 300 + (i ?? 0)) ?? '(none)'}`);
  }
}
