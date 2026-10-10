/**
 * `cParty::cOutdoorCreature` (party.hpp) — a wandering encounter roaming the
 * outdoor map. Ten of these hang off the party, and each one carries a whole
 * encounter definition rather than a single monster: when the party bumps into
 * it, the group is unpacked into an arena full of creatures.
 */

import { Location, loc } from '../core/location';
import { OutWandering, emptyOutWandering } from '../data/outdoors';

export class OutdoorCreature {
  /** Whether this slot holds a group at all. */
  exists = false;
  /** eDirection it is facing, which picks the sprite. */
  direction = 0;
  /** The encounter it will turn into. */
  whatMonst: OutWandering = emptyOutWandering();
  /** Which of the window's four sectors it was spawned in (i_w_c). */
  whichSector: Location = loc(0, 0);
  /** Where it stands, in the 96×96 outdoor window's coordinates. */
  mLoc: Location = loc(0, 0);
  /**
   * The sector it was spawned in, in the world's coordinates — OBoE's
   * `home_sector`, which OBoE declares and saves but never sets. Unlike
   * `whichSector` it stays right as the window shifts. Exile III reads it:
   * its group scripts are global, so a group's chains are the nodes of the
   * zone that defined it, wherever it is met (`group-scripts` = `exile3`).
   * Null when unknown (a save from before it was kept).
   */
  homeSector: Location | null = null;
}
