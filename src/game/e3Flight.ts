/**
 * Exile III's flying, and the two special items that go with it. An blades-of-exile-ts
 * extension, not in BoE or OBoE: a scenario with the feature flag
 * `special-items` = `exile3:<node>` gets these (DIVERGENCES.md #36).
 *
 * What E3 can fly over is data: its outdoor move (`1010:7945`) lets a flying
 * party onto a blocked square of terrain 0x16, 0x18–0x23, 0x32–0x40, 0x47,
 * 0x4a, 0x4b or 0x56 (cave wall, mountains, water, lava, pits), which is
 * BoE's own `fly_over`, so the converter sets it. What this file adds:
 *
 * - **Using a special item** (`FUN_10c0_1f96`, E3's special-item button):
 *   the Orb of Thralni (item 6) starts six turns of flight, and the Amulet
 *   of Rapid Returning (item 7) takes the party to Fort Emergence. BoE's
 *   `AFFECT_PARTY_STATUS` can't stand in for the orb: it writes every status
 *   into Stealth (`specials/affect.ts`), and a node can't read where the
 *   party is outdoors. The maps (0–5 and 9) show a picture of the province
 *   in E3, which the port doesn't have; the converter leaves them unusable.
 *   The Wand of Unusual Results (8) is a converter node.
 * - **Two refusals while flying** (`1010:7315`–`7442`): the cave ceilings
 *   near the caves' edges, and the ocean past the surface's edges.
 * - **Landing** (`1010:5be2`): water drowns, mountains and pits kill, and
 *   lava burns, where BoE kills on anything that blocks and nothing else.
 */

import type { Location } from '../core/location';
import { DamageType } from '../data/monster';
import { MainStatus, PartyStatus } from '../universe/skills';
import type { Universe } from '../universe/universe';
import { hitParty } from './damage';
import { slayParty } from './increaseAge';
import type { GameSession } from './session';
import { SpecCtx, SpecCtxType } from './specials/context';

/** The Orb of Thralni and the Amulet of Rapid Returning. */
export const E3_ORB = 6;
export const E3_AMULET = 7;

/** Squares in a zone. */
const Z = 48;
/** The first zone column of the caves (Upper Exile): E3's window corner is 7 there. */
const CAVES_X = 7;

/** The node the amulet runs as the party arrives, from `special-items` = `exile3:<node>`, or null. */
function e3SpecItemNode(univ: Universe): number | null {
  const m = /^exile3:(-?\d+)$/.exec(univ.scenario.featureFlags['special-items'] ?? '');
  return m ? Number(m[1]) : null;
}

export function e3SpecItems(univ: Universe): boolean {
  return e3SpecItemNode(univ) !== null;
}

/** Whether E3 handles Using special item `which` itself. */
export function e3UsesSpecItem(univ: Universe, which: number): boolean {
  return e3SpecItems(univ) && (which === E3_ORB || which === E3_AMULET);
}

/** Where the party is on the whole outdoor map, in squares. */
function globalLoc(univ: Universe): Location {
  const { party } = univ;
  return { x: party.sector.x * Z + party.locInSec.x, y: party.sector.y * Z + party.locInSec.y };
}

/**
 * Using special item 6 or 7 (`FUN_10c0_1f96`, cases 6 and 7). Each refusal
 * is one line of the message area, and none takes a turn.
 */
export async function useE3SpecItem(session: GameSession, which: number): Promise<void> {
  const { univ } = session;
  const { party } = univ;
  const say = (s: string) => univ.addStringToBuf(s);
  if (which === E3_ORB) {
    if (party.partyStatus[PartyStatus.FLIGHT] > 0) return say('Use: Not while already flying.');
    if (!session.isOutdoors) return say('Use orb: Only when outdoors.');
    // Row 0 of E3's window, zone columns 1 and 2: E3 tests the window's
    // corner row and the party's column (`party+0x12e3`, `+0x12e2` and
    // `+0x12e4`), never the row within it. The port's window slides on the
    // same rule as E3's (a step within 6 of its edge), so its corner row
    // is the same one here.
    const col = party.outdoorCorner.x + party.iwc.x;
    if (party.outdoorCorner.y === 0 && col > 0 && col < 3) return say('Use orb: For some reason, it fails.');
    if (party.inBoat >= 0) return say('Use: Leave boat first.');
    if (party.inHorse >= 0) return say('Use: Leave horse first.');
    say('Use: You rub the orb and start flying!');
    party.partyStatus[PartyStatus.FLIGHT] = 6;
    return;
  }
  if (which === E3_AMULET) {
    const g = globalLoc(univ);
    // E3 tests these before being outdoors, so in town they read where the
    // party left the outdoors, as here.
    if (party.sector.x >= CAVES_X) return say('Amulet doesn\'t work.'), say('  You need to be on the surface.');
    // Zone rows 0 and 1 (E3: corner row 0, or corner row 1 with the party in its top half).
    if (g.y < 2 * Z) return say('Amulet doesn\'t work.'), say('  You\'re too far from Fort Emergence.');
    if (!session.isOutdoors) return say('  Can only cast outdoors.');
    if (party.inBoat >= 0) return say('  Not while in boat.');
    if (party.inHorse >= 0) return say('  Not while on horseback.');
    say('  You are moved...');
    // E3's window at zone (7,8), the party at (84,84) in it: zone (8,9)'s
    // (36,36), the fort's entrance in the caves (`FUN_1040_2c2d`). Then
    // `start_town_mode(21, 0)`, the fort's first entrance. E3 also sets a
    // town byte and a DGROUP byte to 7 (`+0x29bd`, `0x6dc9`), not decoded.
    session.positionParty(8, 9, 36, 36);
    const node = e3SpecItemNode(univ);
    if (node !== null && node >= 0) await session.runSpecial(SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, node, party.outLoc);
    session.startTownMode(21, 0);
  }
}

/**
 * Why E3 won't let a flying party onto `dest` (a window square), or null:
 * `1010:7315`–`7442`, run after the window has slid and before the square is
 * tested for blocking. E3 writes them against its window's corner, which
 * stops sliding at column 5 on the surface and sits at 7 in the caves; here
 * they are the whole map's squares that comes to, pinned to those edges.
 */
export function e3FlightRefusal(univ: Universe, dest: Location): string | null {
  const { party, out } = univ;
  const g = { x: party.outdoorCorner.x * Z + dest.x, y: party.outdoorCorner.y * Z + dest.y };
  if (g.x >= CAVES_X * Z) {
    // `+0x12e2 == 7`: within 4 squares of the caves' top (while the window's
    // corner row is 7), 5 of the bottom, 11 of the east and 5 of the west.
    if ((dest.y < 4 && party.outdoorCorner.y === 7) || g.y > 9 * Z + 42 || g.x > CAVES_X * Z + 84 || g.x < CAVES_X * Z + 5) {
      return 'Fly: Ceiling too low.';
    }
  }
  const ter = out.at(dest.x, dest.y);
  // `dest.x > 84 && corner >= 5` is the surface's east edge; in the caves the
  // ceiling test above has already refused anything that far east.
  const east = g.x < CAVES_X * Z && g.x > 5 * Z + 84;
  if (ter >= 0x32 && ter <= 0x40 && (g.y < 4 || g.y > 8 * Z + 84 || east || g.x < 5)) {
    return 'Fly: Not over the ocean!';
  }
  return null;
}

/**
 * Coming down (`1010:5be2`, when the flight counter reaches 1), on the
 * outdoor square the party is over: the port's `increase_age` calls this in
 * place of BoE's "blocked is death".
 */
export async function e3Land(univ: Universe): Promise<void> {
  const { party } = univ;
  const ter = univ.out.at(party.outLoc.x, party.outLoc.y);
  const say = (s: string) => univ.addStringToBuf(s);
  if (ter === 0x56 || (ter >= 0x16 && ter <= 0x23)) {
    say('  You plummet to your deaths.');
    slayParty(party, MainStatus.DEAD);
  } else if (ter === 0x40 || ter === 0x47 || ter === 0x4a || (ter >= 0x32 && ter <= 0x3e)) {
    say('  You fall into the water and');
    say('  rapidly drown.');
    slayParty(party, MainStatus.DEAD);
  } else if (ter === 0x4b) {
    say('  You land in lava!');
    await hitParty(univ, univ.rng.getRan(8, 1, 10), DamageType.FIRE);
  } else {
    say('  You land safely.');
  }
}
