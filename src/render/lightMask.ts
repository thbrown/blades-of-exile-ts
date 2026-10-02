/**
 * `apply_light_mask` (NEWGRAPH.CPP:203 in the 1997 Windows release;
 * boe.newgraph.cpp:168 in OBoE) — the black that rounds a dark town's light
 * into pools. The squares the party's light doesn't reach are already black
 * (`canDrawTerrainSpot`); this darkens the lit squares at the edge of the
 * light too, except where an ellipse around a well-lit square, or a block
 * around a very well-lit one, keeps them.
 *
 * **The 1997 shapes, not OBoE's.** OBoE's ellipse is 84 wide by 106 tall at
 * offsets it calls a guess ("I correct the values to make the display ok but
 * I am not sure what are the correct values"); 1997's is three tiles by three
 * (84 × 108) set exactly over the square's neighbours. A player can see the
 * difference, so the original wins (DIVERGENCES.md's rule). OBoE's two other
 * changes are kept: no mask while `fog_lifted`, which 1997 doesn't have, and
 * none while 1997's "no delays" preference is on, which this port doesn't
 * have either.
 *
 * Coordinates here are the original's terrain gworld's, where the 9 × 9 view
 * starts at (13, 13) (`big_to`); the screen moves them onto the canvas.
 */

import type { Location } from '../core/location';
import type { GameSession } from '../game/session';
import { isCombat } from '../game/modes';

export interface MaskRect { left: number; top: number; right: number; bottom: number }

/** `big_to`: the 9 × 9 view in the terrain gworld. */
export const LIGHT_MASK_VIEW: MaskRect = { left: 13, top: 13, right: 265, bottom: 337 };

/** The region: `LIGHT_MASK_VIEW` less every ellipse and block. */
export interface LightMaskShapes { ellipses: MaskRect[]; blocks: MaskRect[] }

/**
 * `light_area` (GRAPHICS.CPP:1751): 1 where the square at `centre + (i − 6,
 * j − 6)` is lit, as `pt_in_light` sees it from the party (or, in combat,
 * `combat_pt_in_light` from any PC), else 0. Null outside a dark town.
 */
export function lightArea(session: GameSession): number[][] | null {
  const town = session.univ.town;
  // `if (is_out()) return; if (c_town.town.lighting == 0) return;`
  if (!town || session.isOutdoors || town.record.lightingType === 0) return null;
  // `if(fog_lifted) return;` — OBoE's; the cutscene flag shows the whole town.
  if (session.fogLifted) return null;
  const combat = isCombat(session.mode);
  const from: Location = session.univ.party.townLoc;
  const centre = session.center;
  return Array.from({ length: 13 }, (_, i) => Array.from({ length: 13 }, (_, j) => {
    const where = { x: centre.x + i - 6, y: centre.y + j - 6 };
    return (combat ? session.combatPtInLight(where) : session.ptInLight(from, where)) ? 1 : 0;
  }));
}

/**
 * The region's shapes from `light_area`, or null when every square of the
 * view is lit (1997's `is_dark` test, which OBoE dropped: there is then no
 * mask at all, not even at the edges). `area` is consumed, as the C++'s is.
 */
export function lightMaskShapes(area: number[][]): LightMaskShapes | null {
  const at = (i: number, j: number) => area[i]![j]!;
  let dark = false;
  for (let i = 2; i < 11; i++) for (let j = 2; j < 11; j++) if (at(i, j) === 0) dark = true;
  if (!dark) return null;
  // A square whose eight neighbours are all lit is 2, and one whose eight are
  // all 2 or better is 3. In place, as the C++ does: a square raised earlier
  // in the sweep still passes the same test, so the order doesn't matter.
  for (const level of [1, 2]) {
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      if (at(i - 1, j - 1) >= level && at(i + 1, j - 1) >= level && at(i - 1, j) >= level && at(i + 1, j) >= level
        && at(i - 1, j + 1) >= level && at(i + 1, j + 1) >= level && at(i, j - 1) >= level && at(i, j + 1) >= level) {
        area[i]![j] = level + 1;
      }
    }
  }
  const ellipses: MaskRect[] = [];
  const blocks: MaskRect[] = [];
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    if (at(i, j) === 2) {
      // `CreateEllipticRgnIndirect({0,0,84,108})`, offset by
      // `(13 + 28 (i − 3), 13 + 36 (j − 3))`: the square and its neighbours.
      const left = 13 + 28 * (i - 3), top = 13 + 36 * (j - 3);
      ellipses.push({ left, top, right: left + 84, bottom: top + 108 });
    }
    if (at(i, j) === 3) {
      // The square and the three right of and below it — and those three, if
      // also 3, are zeroed, so they cut no block of their own. That leaves a
      // shape the plain union wouldn't have, and it is the original's.
      const left = 13 + 28 * (i - 2), top = 13 + 36 * (j - 2);
      blocks.push({ left, top, right: left + 56, bottom: top + 72 });
      if (at(i + 1, j) === 3) area[i + 1]![j] = 0;
      if (at(i + 1, j + 1) === 3) area[i + 1]![j + 1] = 0;
      if (at(i, j + 1) === 3) area[i]![j + 1] = 0;
    }
  }
  return { ellipses, blocks };
}
