/**
 * `increase_age`'s upkeep (boe.actions.cpp:3358) — everything that happens to
 * the party *because time passed*, rather than because they did something.
 *
 * This is what makes a status effect an effect at all. Without it a swamp
 * poisons you, prints that it poisoned you, and then nothing ever comes of it:
 * `status[POISON]` sits there and no turn ever spends it. Same for disease,
 * acid, the slow gain of health and spell points, and blessings wearing off.
 *
 * **The tick rates are the whole design.** Outdoors a turn is a long way, so
 * poison bites every 50 turns and you heal every 100; in town both are much
 * more frequent. `party.age % n === 0` is the test, so the *phase* matters as
 * well as the rate — don't "simplify" these into counters.
 *
 * Not ported here (each is another milestone): `dump_gold` and the autosave
 * that eating triggers. (`push_things` was on that list until 2026-08-30; it
 * lives in `pushThings.ts` now and is called from `afterPartyTurnInner`.)
 */

import { DamageType } from '../data/monster';
import { TRACE_AGE } from '../core/trace';
import { tryAutoSave } from './autosave';
import { ItemAbil, abilGroup, abilHarms } from '../data/item';
import { Lighting } from '../data/town';
import { getProtLevel, hasAbilEquip } from '../universe/inventory';
import { Player } from '../universe/player';
import { MainStatus, PartyStatus, Race, Status, Trait, statusInfo } from '../universe/skills';
import { Party } from '../universe/party';
import { damagePc, hitParty } from './damage';
import { hasAbil } from './alchemy';
import { drainPc } from './itemUse';
import { increaseLight } from './spellTown';
import { GameMode } from './modes';
import type { GameSession } from './session';

/** move_to_zero — step a status one notch toward 0, from either side. */
function moveToZero(pc: Player, which: Status): void {
  const v = pc.status[which] ?? 0;
  if (v > 0) pc.status[which] = v - 1;
  else if (v < 0) pc.status[which] = v + 1;
}

/** The same, for one of the four whole-party effects. */
function partyMoveToZero(party: Party, which: PartyStatus): void {
  const v = party.partyStatus[which];
  if (v > 0) party.partyStatus[which] = v - 1;
  else if (v < 0) party.partyStatus[which] = v + 1;
}

/**
 * take_food (boe.items.cpp:82) — eat `amount` rations and report how many
 * there weren't. The larder is emptied rather than going negative.
 */
export function takeFood(party: Party, amount: number): number {
  const shortfall = amount - party.food;
  if (shortfall > 0) {
    party.food = 0;
    return shortfall;
  }
  party.food -= amount;
  return 0;
}

/**
 * `cParty::has_abil` (party.cpp:651) — does any *living* PC carry an item with
 * this ability and a charge left? Note it asks about the pack, not about what
 * is equipped, which is `has_abil_equip`.
 */
export function partyHasAbil(party: Party, abil: ItemAbil): boolean {
  return party.pcs.some((pc) =>
    pc.mainStatus === MainStatus.ALIVE && hasAbil(pc, abil) !== null);
}

function livePcs(session: GameSession): Player[] {
  return session.univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE);
}

/**
 * do_poison (boe.combat.cpp:4365) — poison bites everyone carrying it, then
 * usually fades by one.
 */
export async function doPoison(session: GameSession): Promise<void> {
  const { univ } = session;
  const poisoned = livePcs(session).filter((pc) => (pc.status[Status.POISON] ?? 0) > 0);
  if (poisoned.length === 0) return;
  univ.addStringToBuf('Poison:');
  for (const pc of poisoned) {
    const r1 = univ.rng.getRan(pc.status[Status.POISON] ?? 0, 1, 6);
    await damagePc(univ, pc, r1, DamageType.POISON, Race.UNKNOWN);
    if (univ.rng.getRan(1, 0, 8) < 6) moveToZero(pc, Status.POISON);
    // The C++ asks the same question twice and only the second one checks the
    // trait, so a hardy PC shakes poison off about twice as fast. Its own
    // comment wonders whether the two conditions were meant to be swapped;
    // they weren't swapped, so neither are they here.
    if (univ.rng.getRan(1, 0, 8) < 6 && pc.traits[Trait.GOOD_CONST]) {
      moveToZero(pc, Status.POISON);
    }
  }
}

/**
 * handle_disease (boe.combat.cpp:4393) — disease rolls a different misery for
 * each sufferer every time it fires.
 */
export function handleDisease(session: GameSession): void {
  const { univ } = session;
  const sick = livePcs(session).filter((pc) => (pc.status[Status.DISEASE] ?? 0) > 0);
  if (sick.length === 0) return;
  univ.addStringToBuf('Disease:');
  for (const pc of sick) {
    const roll = univ.rng.getRan(1, 1, 10);
    switch (roll) {
      case 1: case 2: pc.poison(2, univ.rng); break;
      case 3: case 4: pc.slow(2); break;
      // Roll 5 is `drain_pc(pc, 5)` — five experience, and nothing else; it
      // takes no level. This arm used to print "unaffected", which is what
      // rolls 9 and 10 do.
      case 5: drainPc(pc, 5); break;
      case 6: case 7: pc.curse(3); break;
      case 8: pc.dumbfound(3, univ.rng); break;
      default: univ.addStringToBuf(`  ${pc.name} unaffected.`); break;
    }
    let r1 = univ.rng.getRan(1, 0, 7);
    if (pc.traits[Trait.GOOD_CONST]) r1 -= 2;
    if (r1 <= 0 || hasAbilEquip(pc, ItemAbil.STATUS_PROTECTION, Status.DISEASE)) {
      moveToZero(pc, Status.DISEASE);
    }
  }
}

/**
 * handle_acid (boe.combat.cpp:4435) — acid burns every turn, not on a clock,
 * and always fades by one afterwards.
 */
export async function handleAcid(session: GameSession): Promise<void> {
  const { univ } = session;
  const burning = livePcs(session).filter((pc) => (pc.status[Status.ACID] ?? 0) > 0);
  if (burning.length === 0) return;
  univ.addStringToBuf('Acid:');
  for (const pc of burning) {
    const r1 = univ.rng.getRan(pc.status[Status.ACID] ?? 0, 1, 6);
    await damagePc(univ, pc, r1, DamageType.ACID, Race.UNKNOWN);
    moveToZero(pc, Status.ACID);
  }
}

/**
 * The status/healing half of increase_age, run once per party turn. `mode` is
 * asked rather than `worldIsTown` because the rates key off MODE_OUTDOORS and
 * MODE_TOWN specifically — during combat none of this happens, which is why a
 * long fight doesn't heal anyone.
 */
export async function increaseAgeEffects(session: GameSession): Promise<void> {
  const { univ } = session;
  const { party } = univ;
  // **`is_out()` and `is_town()`, not two equality tests.** `increase_age` has
  // no mode gate of its own — `handle_monster_actions` only reaches it when
  // the party is not in combat — and every branch inside it asks `is_out()` or
  // `is_town()`, both of which are *ranges*. Testing `mode === TOWN` exactly
  // meant the clock stopped dead in any of the town's sub-modes, and the one
  // that matters is `MODE_ITEM_TARGET`: Identify and Recharge spend their
  // spell points and then open the item screen, so the only two spells that
  // pay before they act were also the only two that cost no turn.
  const outdoors = session.isOutdoors;
  const town = session.inTown;
  if (!outdoors && !town) return;

  // **The clock ticks here, not in the move** (boe.actions.cpp:3362). This port
  // used to advance `age` inside `outdMoveParty`/`townMoveParty`, which is one
  // step too early: the C++ ticks at the top of `increase_age`, by which time
  // the move is over and `is_out()` already reflects where the party *ended up*.
  // The turn that walks off the world map into a town is the case that shows
  // it — the C++ charges a **town** turn (+1) because it is in the town by
  // then, and this port charged the outdoor +10. Nine ticks of drift by the
  // 226th random draw of one recording, which is enough to move every
  // `age % n` upkeep (poison, disease, food, healing) onto the wrong turn.
  //
  // Outdoors a step is ten ticks on foot and five on a horse, and the count is
  // rounded down to a multiple of that first.
  if (outdoors) {
    party.age -= party.age % (party.inHorse < 0 ? 10 : 5);
    party.age += 5;
    if (party.inHorse < 0) party.age += 5;
  } else party.age++;

  if (TRACE_AGE) {
    console.log(`      [age] increase_age mode=${session.mode}`
      + ` horse=${party.inHorse} -> ${party.age}`);
  }

  const age = party.age;

  // The party's own lantern burns down a notch, every turn.
  if (party.lightLevel > 0) party.lightLevel--;

  // "decrease monster present counter" (boe.actions.cpp:3377), a `move_to_zero`
  // beside the light level's. It only matters to `monster_placid`, which is why
  // it can live here rather than anywhere more prominent.
  if (party.hostilesPresent > 0) party.hostilesPresent--;

  // --- The party's own spell effects wearing off ----------------------------
  // increase_age's first block (boe.actions.cpp:3379): each is a countdown, and
  // each says so on the turn it runs out. FLIGHT's "you plummet to your deaths"
  // is not ported — flight over impassable ground needs the terrain check the
  // C++ does against the *outdoor* map. TODO(M6).
  //
  // **This sits here, not at the end of the function, because the block below
  // it draws.** It used to be last, with a note saying the reordering was safe
  // because none of it touches the RNG; that stopped being true the moment the
  // radiance roll underneath it was ported.
  if (party.partyStatus[PartyStatus.STEALTH] === 1) {
    univ.addStringToBuf('Your footsteps grow louder.');
  }
  partyMoveToZero(party, PartyStatus.STEALTH);
  if (party.partyStatus[PartyStatus.DETECT_LIFE] === 1) {
    univ.addStringToBuf('You stop detecting monsters.');
  }
  partyMoveToZero(party, PartyStatus.DETECT_LIFE);
  if (party.partyStatus[PartyStatus.FIREWALK] === 1) {
    univ.addStringToBuf('Your feet stop glowing.');
  }
  partyMoveToZero(party, PartyStatus.FIREWALK);
  if (party.partyStatus[PartyStatus.FLIGHT] === 2) {
    univ.addStringToBuf('You are starting to descend.');
  }
  if (party.partyStatus[PartyStatus.FLIGHT] === 1) {
    univ.addStringToBuf('  You land safely.');
  }
  partyMoveToZero(party, PartyStatus.FLIGHT);

  // --- Dark towns: the light drains, and something in the pack may glow -----
  const lighting = univ.townRecord?.lightingType ?? Lighting.LIGHT_NORMAL;
  if (!outdoors && lighting >= Lighting.LIGHT_DRAINS) {
    increaseLight(session, -9);
    if (lighting === Lighting.LIGHT_NONE) {
      if (party.lightLevel > 0) univ.addStringToBuf('Your light is drained.');
      party.lightLevel = 0;
    }
  }
  // A RADIANT item lights itself now and again — **and this draws**, which is
  // why the block above it can't be moved past it (boe.actions.cpp:3417).
  if (town && lighting !== Lighting.LIGHT_NORMAL) {
    let radiance = 0;
    for (const pc of party.pcs) radiance += getProtLevel(pc, ItemAbil.RADIANT);
    if (radiance > 0 && party.lightLevel < radiance && univ.rng.getRan(1, 1, 10) < radiance) {
      univ.addStringToBuf('One of your items is glowing softly!');
      party.lightLevel += radiance * 3;
    }
  }

  // --- The items that do something on their own ------------------------------
  // "Specials countdowns" (boe.actions.cpp:3425). Every five hundredth turn an
  // OCCASIONAL_STATUS item may fire — one `get_ran(1,0,5)` per candidate item,
  // so the *number* of them in the party's packs is part of the draw stream.
  // The C++'s own TODO wonders whether this should call a special node.
  if (age % 500 === 0 && partyHasAbil(party, ItemAbil.OCCASIONAL_STATUS)) {
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

  // "Plants and magic shops" — the random shops restock, which rolls a fresh
  // item for every slot of every random-stock store. That is a *lot* of draws
  // in one turn, and it lands squarely in the middle of this function.
  if (age % 4000 === 0) univ.refreshStoreItems();

  // --- The protections wearing off ------------------------------------------
  // "Protection, etc." (boe.actions.cpp:3451). Every one of these is decayed
  // **every turn**, in town and outdoors alike; this port decayed them only
  // during a combat round (`combat_run_monst`), which is why Resist Magic cast
  // in a fight was still up long after it, out on the road.
  //
  // The `if` is the C++'s, brace-for-brace, and **it is the whole of
  // invulnerability's expiry**: the unbraced body is the *first* `move_to_zero`
  // and nothing else, so INVULNERABLE decays only on a turn when one of the six
  // is down to its last point — and otherwise never. The condition reads like
  // the "an effect wore off" print guard it plainly started life as, sitting
  // one line above a list it does not govern; kept, because a Protection that
  // outlasts the fight is something a player can see. This port had a second,
  // unconditional `move_to_zero(INVULNERABLE)` under it — an invention, and one
  // that let a Wall of Ice hurt a PC the C++ made untouchable nineteen turns
  // earlier.
  for (const pc of party.pcs) {
    const s = (which: Status): number => pc.status[which] ?? 0;
    if (s(Status.INVULNERABLE) === 1 || Math.abs(s(Status.MAGIC_RESISTANCE)) === 1
      || s(Status.INVISIBLE) === 1 || s(Status.MARTYRS_SHIELD) === 1
      || Math.abs(s(Status.ASLEEP)) === 1 || s(Status.PARALYZED) === 1) {
      moveToZero(pc, Status.INVULNERABLE);
    }
    moveToZero(pc, Status.MAGIC_RESISTANCE);
    moveToZero(pc, Status.INVISIBLE);
    moveToZero(pc, Status.MARTYRS_SHIELD);
    moveToZero(pc, Status.ASLEEP);
    moveToZero(pc, Status.PARALYZED);
    if (age % 40 === 0 && s(Status.POISONED_WEAPON) > 0) {
      moveToZero(pc, Status.POISONED_WEAPON);
    }
  }

  // --- Food ------------------------------------------------------------------
  // "Food" (boe.actions.cpp:3467): every thousandth turn the party eats, one
  // ration per living PC. `take_food` empties the larder and reports the
  // shortfall; anyone it couldn't feed starves the *whole party* for
  // `get_ran(3,1,6)`, which is the C++'s own broad brush — the damage isn't
  // per hungry PC.
  if (age % 1000 === 0) {
    const mouths = party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE).length;
    const shortfall = takeFood(party, mouths);
    if (shortfall > 0) {
      univ.addStringToBuf('Starving!');
      session.sound?.play(66);
      await hitParty(univ, univ.rng.getRan(3, 1, 6), DamageType.SPECIAL);
    } else {
      session.sound?.play(6);
      univ.addStringToBuf('You eat.');
      // The one trigger that defaults *off*, since it fires far more often
      // than the rest (autosave_trigger_defaults, boe.fileio.cpp:504).
      tryAutoSave('Eat');
    }
  }

  // --- Poison, disease, acid ------------------------------------------------
  if (party.pcs.some((pc) => (pc.status[Status.POISON] ?? 0) > 0)) {
    if ((outdoors && age % 50 === 0) || (town && age % 20 === 0)) await doPoison(session);
  }
  if (party.pcs.some((pc) => (pc.status[Status.DISEASE] ?? 0) > 0)) {
    if ((outdoors && age % 100 === 0) || (town && age % 25 === 0)) handleDisease(session);
  }
  // Acid has no clock: it burns every single turn.
  if (party.pcs.some((pc) => (pc.status[Status.ACID] ?? 0) > 0)) await handleAcid(session);

  // --- Health ---------------------------------------------------------------
  if (outdoors) {
    if (age % 100 === 0) for (const pc of party.pcs) pc.heal(2);
  } else if (age % 50 === 0) {
    // Bonus health above the maximum wears off one point at a time.
    for (const pc of party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE && pc.curHealth > pc.maxHealth) pc.curHealth--;
    }
    for (const pc of party.pcs) pc.heal(1);
  }

  // --- Spell points, and enlightenment wearing off --------------------------
  if (outdoors) {
    if (age % 80 === 0) {
      for (const pc of party.pcs) pc.restoreSp(2);
      for (const pc of party.pcs) {
        if ((pc.status[Status.DUMB] ?? 0) < 0) pc.status[Status.DUMB]!++;
      }
    }
  } else if (age % 40 === 0) {
    for (const pc of party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE && pc.curSp > pc.maxSp) pc.curSp--;
      if ((pc.status[Status.DUMB] ?? 0) < 0) pc.status[Status.DUMB]!++;
    }
    for (const pc of party.pcs) pc.restoreSp(1);
  }

  // --- The two constitution traits ------------------------------------------
  for (const pc of livePcs(session)) {
    if (pc.traits[Trait.RECUPERATION] && univ.rng.getRan(1, 0, 10) === 1
      && pc.curHealth < pc.maxHealth) pc.heal(2);
    if (pc.traits[Trait.CHRONIC_DISEASE] && univ.rng.getRan(1, 0, 110) === 1) {
      pc.disease(4, univ.rng);
    }
  }

  // --- Blessing, haste and slow burning down; regeneration -------------------
  if (age % 4 === 0) {
    for (const pc of party.pcs) {
      moveToZero(pc, Status.BLESS_CURSE);
      moveToZero(pc, Status.HASTE_SLOW);
      const item = hasAbilEquip(pc, ItemAbil.REGENERATE);
      if (!item) continue;
      if (pc.curHealth >= pc.maxHealth) continue;
      // Outdoors regeneration fires rarely but heals four times as much, so it
      // works out about the same over a journey.
      if (outdoors && univ.rng.getRan(1, 0, 10) !== 5) continue;
      const step = Math.trunc(item.item.abilStrength / 3);
      let j = step === 0 ? univ.rng.getRan(1, 0, 1) : univ.rng.getRan(1, 0, step);
      if (outdoors) j *= 4;
      pc.heal(j);
    }
  }
}
