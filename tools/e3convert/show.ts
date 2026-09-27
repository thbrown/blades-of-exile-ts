/**
 * Prints Exile 3's text by the numbers the scripts use, for transcribing:
 *
 *   npx vite-node tools/e3convert/show.ts 56:0x5d 56:0x5e d0xcae s4500
 *
 * `block:i` is message string `block*300 + i` (`FUN_1008_37de`), `dN` is
 * dialog resource N with its controls, `sN` is string N, and `gOFF:N` is N
 * bytes of DGROUP (the data segment) from OFF, and `wSEG:OFF:N` is N words of
 * a code segment, as Ghidra addresses it: a switch's jump table
 * (`w1078:2ed6:27`), and `xSEG:OFF` is the NUL-terminated string there (a
 * script's literal, as `SpecBuilder.log` reads it). Numbers may be hex.
 * The text is the user's own copy's, printed and never written anywhere.
 */

import { findE3Dir, readE3Files } from './install';
import { neAutoDataSegment, readDialogs, readNeResources, readNeSegment, readStringTable } from './ne';

const dir = findE3Dir();
if (!dir) throw new Error('no Exile 3 install');
const exe = readE3Files(dir).exe;
const res = readNeResources(exe);
const ds = readNeSegment(exe, neAutoDataSegment(exe));
const strings = readStringTable(res);
const dialogs = readDialogs(res);
const num = (s: string) => Number(s);

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('d')) {
    const d = dialogs.get(num(arg.slice(1)));
    console.log(`== dialog ${arg.slice(1)}${d ? ` "${d.caption}"` : ' (none)'}`);
    for (const c of d?.controls ?? []) if (c.text) console.log(`  [${c.id}] ${c.text}`);
  } else if (arg.startsWith('g')) {
    const [off, n] = arg.slice(1).split(':').map(num);
    console.log(`== DGROUP ${arg.slice(1)}: ${[...ds.subarray(off ?? 0, (off ?? 0) + (n ?? 16))].join(' ')}`);
  } else if (arg.startsWith('w')) {
    const [seg, off, n] = arg.slice(1).split(':').map((v) => parseInt(v, 16));
    const code = readNeSegment(exe, ((seg ?? 0x1000) - 0x1000) / 8 + 1);
    const v = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const words = Array.from({ length: n ?? 8 }, (_, i) => v.getUint16((off ?? 0) + 2 * i, true).toString(16));
    console.log(`== ${arg.slice(1)}: ${words.map((w, i) => `${i + 1}:${w}`).join(' ')}`);
  } else if (arg.startsWith('x')) {
    const [seg, off] = arg.slice(1).split(':').map((v) => parseInt(v, 16));
    const code = readNeSegment(exe, ((seg ?? 0x1000) - 0x1000) / 8 + 1);
    const end = code.indexOf(0, off);
    console.log(`== ${arg.slice(1)}: ${new TextDecoder('latin1').decode(code.subarray(off, end))}`);
  } else if (arg.startsWith('s')) {
    console.log(`== s${arg.slice(1)}: ${strings.get(num(arg.slice(1))) ?? '(none)'}`);
  } else {
    const [b, i] = arg.split(':').map(num);
    console.log(`== ${arg}: ${strings.get((b ?? 0) * 300 + (i ?? 0)) ?? '(none)'}`);
  }
}
