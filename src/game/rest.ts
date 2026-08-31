/**
 * Resting — do_rest (boe.actions.cpp:3288). Inns call it, and so will the Rest
 * command and the sleep terrain specials. Time passes, statuses clear, and the
 * party heals; the parts that need systems this port hasn't built are marked.
 */

import { ItemAbil, abilGroup, abilHarms } from '../data/item';
import { TerSpec } from '../data/terrain';
import { dist } from '../core/location';
import { TRACE_AGE } from '../core/trace';
import { tryAutoSave } from './autosave';
import { hasAbilEquip } from '../universe/inventory';
import { MainStatus, PartyStatus, Status, Trait, statusInfo } from '../universe/skills';
import { Universe } from '../universe/universe';
import { handleDisease, increaseAgeEffects, partyHasAbil } from './increaseAge';
import { NO_ONE } from './combat';
import type { GameSession } from './session';
import { specialIncreaseAge } from './specialIncreaseAge';
import { createWandMonst, doOutdoorMonsters } from './wandering';

/**
 * do_rest — advance the clock by `length` ticks and restore the party.
 *
 * The `session` is only needed for the timers at the end; without one they are
 * skipped, which is what the older callers did.
 *
 * The order below is the C++'s and it matters: **`handle_disease` runs three
 * times before the statuses are cleared**, so it finds the sufferers it is
 * meant to. Clearing first — which this port did — makes all three calls find
 * nobody and draw nothing, and a party that went to bed ill woke up with the
 * draw stream several rolls short.
 */
export function doRest(
  univ: Universe, length: number, hpRestore: number, spRestore: number, isOutdoors = false,
  session?: GameSession,
): void {
  const ageBefore = univ.party.age;
  univ.party.age += length;
  if (TRACE_AGE) console.log(`      [age] do_rest +${length} -> ${univ.party.age}`);

  // "If some players diseased, allow it to progress a bit" — three bouts'
  // worth, each a `get_ran(1,1,10)` and a `get_ran(1,0,7)` per sufferer.
  // Needs the session, so a caller without one still skips it.
  if (session) {
    handleDisease(session);
    handleDisease(session);
    handleDisease(session);
  }

  // Resting clears every timed status, on the party and on each PC. The four
  // party-wide ones were missing here, and **stealth is the one that shows**:
  // `do_monsters` adds 46 to every notice roll while it is up, so a party that
  // rested with Stealth on stayed hidden here and stopped being hidden there.
  const { party } = univ;
  party.partyStatus[PartyStatus.STEALTH] = 0;
  party.partyStatus[PartyStatus.DETECT_LIFE] = 0;
  party.partyStatus[PartyStatus.FIREWALK] = 0;
  // "This one shouldn't be nonzero anyway, since you can't rest while flying."
  party.partyStatus[PartyStatus.FLIGHT] = 0;
  for (const pc of univ.party.pcs) pc.status.fill(0);

  // "Specials countdowns" — the same OCCASIONAL_STATUS sweep `increase_age`
  // does every five hundredth turn, here gated on the rest having *crossed* a
  // 500 boundary. One `get_ran(1,0,5)` per candidate item.
  if ((length > 500 || Math.floor(ageBefore / 500) < Math.floor(univ.party.age / 500))
    && partyHasAbil(party, ItemAbil.OCCASIONAL_STATUS)) {
    for (const pc of party.pcs) {
      for (const item of pc.items) {
        if (item.ability !== ItemAbil.OCCASIONAL_STATUS) continue;
        if ((item.abilData as number) > 15) continue;
        if (!abilGroup(item)) continue;
        if (univ.rng.getRan(1, 0, 5) !== 3) continue;
        let howMuch = item.abilStrength;
        if (abilHarms(item)) howMuch *= -1;
        const which = item.abilData as Status;
        if (statusInfo(which).isNegative) howMuch *= -1;
        party.applyStatusAll(which, howMuch);
      }
    }
  }

  // Plants regrow and magic shops restock every 4000 ticks.
  if (length > 4000 || Math.floor(ageBefore / 4000) < Math.floor(univ.party.age / 4000))
    univ.refreshStoreItems();

  for (const pc of univ.party.pcs) {
    pc.heal(hpRestore);
    pc.restoreSp(spRestore);
  }

  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    if (pc.traits[Trait.RECUPERATION] && pc.curHealth < pc.maxHealth)
      pc.heal(Math.trunc(hpRestore / 5));
    // The roll was already here; what was missing is what it does when it
    // comes up — and `disease()` draws again, so the gap was two draws deep.
    if (pc.traits[Trait.CHRONIC_DISEASE] && univ.rng.getRan(1, 0, 110) === 1) {
      pc.disease(6, univ.rng);
    }

    // Regeneration gear tops the PC up — outdoors it only fires sometimes, but
    // when it does it counts for four times as much.
    const regen = hasAbilEquip(pc, ItemAbil.REGENERATE);
    if (regen && pc.curHealth < pc.maxHealth
      && (!isOutdoors || univ.rng.getRan(1, 0, 10) === 5)) {
      const strength = Math.trunc(regen.item.abilStrength / 3);
      let j = univ.rng.getRan(1, 0, strength);
      if (strength === 0) j = univ.rng.getRan(1, 0, 1);
      if (isOutdoors) j *= 4;
      pc.heal(j);
    }
    // Bonus SP and HP wear off with the rest.
    if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
    if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
  }

  // do_rest's tail (boe.actions.cpp:3353) passes the *whole* length and asks
  // for the chains to be queued, so a week's worth of timers fire once the
  // party is awake rather than from inside the rest.
  if (session) specialIncreaseAge(session, length, true);
}

/** someone_poisoned (boe.actions.cpp:4267) — a *living* PC with poison in them. */
export function someonePoisoned(univ: Universe): boolean {
  return univ.party.pcs.some((pc) =>
    pc.mainStatus === MainStatus.ALIVE && (pc.status[Status.POISON] ?? 0) > 0);
}

/**
 * nearest_monster (boe.actions.cpp:4274) — how far the closest outdoor group
 * is, or 100 when there are none. Only the ten outdoor slots count, which is
 * why this is meaningless in town.
 */
export function nearestMonster(univ: Universe): number {
  let best = 100;
  for (const group of univ.party.outC) {
    if (!group.exists) continue;
    best = Math.min(best, dist(univ.party.outLoc, group.mLoc));
  }
  return best;
}

/**
 * handle_rest (boe.actions.cpp:556) — the outdoor Rest command, which is what
 * the CAMP toolbar button and **r** do. It refuses in a boat, when someone's
 * poisoned, with too little food, with a group already close, on dangerous
 * ground or in the air.
 *
 * **Fifty turns pass before the rest counts.** The loop is the whole point of
 * the command: the clock ticks fifty times (five hundred ticks outdoors), the
 * groups get a coin-flip's worth of movement each turn, a wandering group can
 * turn up, and poison or an approaching monster cuts the night short — in
 * which case *nothing* is restored, because `i` is slammed to 200 and only
 * `i == 50` reaches `do_rest`. So a successful rest is 500 ticks of upkeep
 * **plus** `do_rest`'s 1200, and an interrupted one is only what elapsed
 * before the interruption.
 */
export async function handleRest(session: GameSession): Promise<boolean> {
  const { univ } = session;
  const say = (line: string) => univ.addStringToBuf(line);
  const where = univ.party.outLoc;
  const ter = univ.out.at(where.x, where.y);
  const special = ter === undefined ? TerSpec.NONE : univ.terrainType(ter).special;

  if (univ.party.inBoat >= 0) {
    say('Rest:  Not in boat.');
    return false;
  }
  if (someonePoisoned(univ)) {
    say('Rest: Someone poisoned.');
    return false;
  }
  if (univ.party.food <= 12) {
    say('Rest: Not enough food.');
    return false;
  }
  if (nearestMonster(univ) <= 3) {
    say('Rest: Monster too close.');
    return false;
  }
  if (special === TerSpec.DAMAGING || special === TerSpec.DANGEROUS) {
    say("Rest: It's dangerous here.");
    return false;
  }
  if (univ.party.partyStatus[PartyStatus.FLIGHT] > 0) {
    say('Rest: Not while flying.');
    return false;
  }

  say('Resting...');
  // Sound 20, asynchronously — the negative is the C++'s "don't block" flag.
  session.sound?.play(-20);
  univ.party.food -= 6;

  let i = 0;
  while (i < 50) {
    // `increase_age(false)` — the clock, the upkeep and the timers, exactly as
    // an ordinary turn runs them. There are no fields outdoors, which is why
    // this doesn't call `processFields` the way the long wait does.
    await increaseAgeEffects(session);
    specialIncreaseAge(session, 1);
    session.currentSwitch = NO_ONE;
    if (univ.rng.getRan(1, 1, 2) === 2) doOutdoorMonsters(session);
    if (univ.rng.getRan(1, 1, 70) === 10) createWandMonst(session);
    // Poison can set in from a disease and kill someone in their sleep.
    if (someonePoisoned(univ)) {
      i = 200;
      say('  Someone poisoned.');
    }
    if (nearestMonster(univ) <= 3) {
      i = 200;
      say('  Monsters nearby.');
    }
    i++;
  }

  session.checkGameOver();
  if (i !== 50) return false;
  doRest(univ, 1200, univ.rng.getRan(5, 1, 10), 50, true, session);
  say('  Rest successful.');
  tryAutoSave('RestComplete');
  return true;
}
