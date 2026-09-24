/**
 * Draws the converted world as one picture, to check the terrain mapping by
 * eye against the real game: every zone's terrain through `terrain.xml`'s
 * pictures and the converted sheets, at 1/`scale` size.
 *
 *   npx vite-node tools/e3convert/renderWorld.ts <out.png> [scale] [zoneX zoneY]
 *
 * With a zone given, draws only that zone, at full size unless told otherwise.
 */

import { writeFileSync } from 'node:fs';
import { buildTerrainSheets, e3TerrainPic } from './graphics';
import { findE3Dir, readE3Files } from './install';
import { readNeResources, readStringTable } from './ne';
import { E3_ZONES_HIGH, E3_ZONES_WIDE, readE3Outdoors } from './outdoor';
import { encodePng } from './png';
import { readE3Terrain } from './tables';

const [out, scaleArg, zx, zy] = process.argv.slice(2);
if (!out) throw new Error('usage: renderWorld.ts <out.png> [scale] [zoneX zoneY]');
const dir = findE3Dir();
if (!dir) throw new Error('no Exile 3 install found');
const files = readE3Files(dir);
const terrain = readE3Terrain(files.exe, readStringTable(readNeResources(files.exe)));
const zones = readE3Outdoors(files.outdoor);
const sheets = buildTerrainSheets(dir);
const one = zx !== undefined && zy !== undefined;
const scale = Number(scaleArg ?? (one ? 1 : 4));
const zonesWide = one ? 1 : E3_ZONES_WIDE;
const zonesHigh = one ? 1 : E3_ZONES_HIGH;
const W = Math.floor((zonesWide * 48 * 28) / scale);
const H = Math.floor((zonesHigh * 48 * 36) / scale);
const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };

for (let zy2 = 0; zy2 < zonesHigh; zy2++) {
  for (let zx2 = 0; zx2 < zonesWide; zx2++) {
    const zone = one ? zones[Number(zy) * E3_ZONES_WIDE + Number(zx)] : zones[zy2 * E3_ZONES_WIDE + zx2];
    if (!zone) continue;
    for (let x = 0; x < 48; x++) {
      for (let y = 0; y < 48; y++) {
        const pic = e3TerrainPic(terrain[zone.terrain[x]![y]!]!.pic);
        const cell = pic >= 2000 ? pic - 2000 : pic - 1000;
        const sheet = sheets[Math.floor(cell / 100)]!;
        const c = cell % 100;
        const sx0 = (c % 10) * 28, sy0 = Math.floor(c / 10) * 36;
        const dx0 = ((zx2 * 48 + x) * 28) / scale, dy0 = ((zy2 * 48 + y) * 36) / scale;
        for (let py = 0; py < 36 / scale; py++) {
          for (let px = 0; px < 28 / scale; px++) {
            const si = ((sy0 + Math.floor(py * scale)) * sheet.width + sx0 + Math.floor(px * scale)) * 4;
            const di = ((Math.floor(dy0) + py) * W + Math.floor(dx0) + px) * 4;
            img.data.set(sheet.data.subarray(si, si + 4), di);
          }
        }
      }
    }
  }
}
writeFileSync(out, encodePng(img));
console.log(`Wrote ${out} (${W}×${H}).`);
