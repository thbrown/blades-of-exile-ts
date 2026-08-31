/**
 * `cTown::set_up_lights` (town.cpp:196) — the town's permanent lighting map.
 *
 * **This runs once, when the scenario file is read** (fileio_scen.cpp:2261,
 * "Don't forget to set up lighting!"), and after that only `alter_space`
 * recomputes it — and only when the terrain's *light radius* changes
 * (boe.locutils.cpp:598). Nothing else touches it: not entering the town, not
 * the doors a previous visit left open.
 *
 * That timing is the whole point and it is load-bearing. A campfire behind a
 * shut door lights nothing past it, and the map remembers that forever: when
 * the party comes back and the door is standing open, the corridor beyond is
 * *still* dark, because the map was built while the door was shut and opening
 * one does not change a light radius. Rebuilding on town entry — which this
 * port did — lit that corridor, `pt_in_light` said yes where the C++ said no,
 * and `can_see_light` returned a real obscurity where the C++ returned 6.
 * Six is enough to keep `do_monsters`' notice roll from ever firing, so the
 * two runs disagreed about which creatures had seen the party.
 *
 * Lives here, free of `GameSession`, because both callers are outside it: the
 * scenario loader and the specials VM.
 */

import { dist, loc } from '../core/location';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { Terrain, TerObstruct } from '../data/terrain';
import { Town } from '../data/town';

/**
 * Terrain with a light radius lights the tiles around it permanently.
 *
 * **The line-of-sight test is not optional**, and leaving it out (a
 * `TODO(M4)` that outlived M4 by four milestones) made every brazier shine
 * through the walls of its own room.
 *
 * Two details that matter: the obscurity function is `light_obscurity`
 * (town.cpp:227), **not** `sight_obscurity` — it knows nothing about webs,
 * crates or barriers, only about terrain that blocks sight (5) or shooting
 * (1) — and the already-lit square is skipped before the `can_see` call, so
 * two overlapping light sources cost one visibility trace, not two.
 */
export function setUpLights(terrainType: (n: number) => Terrain, town: Town): void {
  const dim = town.maxDim;
  const onMap = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < dim && y < dim;
  for (const row of town.lighting) row.fill(0);
  const lightObscurity = (x: number, y: number): number => {
    if (!onMap(x, y)) return 5;
    const blockage = terrainType(town.terrain[x]![y]!).blockage;
    if (blockage === TerObstruct.BLOCK_SIGHT
      || blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT) return 5;
    if (blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT) return 1;
    return 0;
  };
  for (let i = 0; i < dim; i++)
    for (let j = 0; j < dim; j++) {
      const rad = terrainType(town.terrain[i]![j]!).lightRadius;
      if (rad <= 0) continue;
      const source = loc(i, j);
      for (let x = Math.max(0, i - rad); x < Math.min(dim, i + rad + 1); x++)
        for (let y = Math.max(0, j - rad); y < Math.min(dim, j + rad + 1); y++) {
          if (town.lighting[x]![y] !== 0) continue;
          const where = loc(x, y);
          if (dist(where, source) <= rad
            && canSee(source, where, lightObscurity) < SIGHT_BLOCKED) {
            town.lighting[x]![y] = 1;
          }
        }
    }
}
