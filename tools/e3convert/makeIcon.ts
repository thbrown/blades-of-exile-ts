/**
 * Writes `public/exile3-icon.png`, Exile III's own icon (EXILE3.ICO from
 * Spiderweb's installer), which the scenario card shows in its corner before
 * the game has ever been converted. Committed, like `exile3-preview.png`.
 *
 *     npx vite-node tools/e3convert/makeIcon.ts
 */
import { writeFileSync } from 'node:fs';
import { decodeIco } from './cursors';
import { E3_INSTALLER, unpackE3Installer } from './installer';
import { encodePng } from './png';
import { readFileSync } from 'node:fs';

const files = unpackE3Installer(new Uint8Array(readFileSync(E3_INSTALLER)));
const ico = files.get('EXILE3.ICO');
if (!ico) throw new Error('no EXILE3.ICO in the installer');
writeFileSync(new URL('../../public/exile3-icon.png', import.meta.url), encodePng(decodeIco(ico)));
console.log('Wrote public/exile3-icon.png');
