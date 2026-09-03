/**
 * Casting in combat — `combat_cast_mage_spell` (boe.combat.cpp:4517),
 * `combat_cast_priest_spell` (:4745) and the two `combat_immed_*_cast`
 * functions under them (:4596, :4798).
 *
 * The important difference from town casting: **there is no caster to choose.**
 * The C++ calls `pick_spell(univ.cur_pc, …)`, which sets `can_choose_caster`
 * false — in combat the active PC is the one casting, full stop. Out of combat
 * `cast_spell` passes 6 instead, which is what opens the caster buttons.
 *
 * `combat_cast_*_spell` is really a dispatcher on the spell's `refer`:
 *
 * - `REFER_YES`   — the town implementation does the work; spend 6 AP first.
 * - `REFER_IMMED` — a combat-only effect that resolves at once, below.
 * - `REFER_TARGET`/`REFER_FANCY` — ask for a square, then `do_combat_cast`.
 */

import { dist } from '../core/location';
import { DamageType } from '../data/monster';
import { SpellPat } from '../data/pattern';
import { Spell, SPELLS, SpellRefer, spellName } from '../data/spell';
import { ItemAbil } from '../data/item';
import { FieldType } from '../data/fields';
import { getProtLevel } from '../universe/inventory';
import { livingSound } from '../universe/living';
import { MainStatus, Skill, Status, Trait } from '../universe/skills';
import { takeAp } from './combat';
import { CastStatus, pcCanCastType, printCastStatus } from './spellCast';
import { hasTrappedMonst } from './soulCrystal';
import { damageMonst, damagePc, handleMarkedDamage } from './damage';
import { runBoomAnim, startBoomAnim } from './booms';
import { animSettle } from './anim';
import { placeSpellPattern } from './spellPatterns';
import { doMageSpell, doPriestSpell } from './spellTown';
import { startFancySpellTargeting, startSpellTargeting } from './spellCombatTarget';
import { SIGHT_BLOCKED } from '../core/sight';
import { drawTerrain } from './textBar';
import type { GameSession } from './session';

/**
 * The AP a spell costs, win or lose — and **the two schools charge
 * differently**: `combat_cast_mage_spell` spends `take_ap(6)`
 * (boe.combat.cpp:4610 and :4622) where `combat_cast_priest_spell` spends
 * `take_ap(5)` (:4811 and :4823). This port charged 6 for both, which is one
 * action point a round too many for every priest in the corpus.
 */
const MAGE_AP = 6;
const PRIEST_AP = 5;

/**
 * `poison_weapon` — the Envenom effect. The C++ helper also prints and picks a
 * sound; only the status matters here.
 */
function poisonWeapon(session: GameSession, pcNum: number, howMuch: number): void {
  const pc = session.univ.party.pcs[pcNum];
  if (!pc) return;
  pc.status[Status.POISONED_WEAPON] = (pc.status[Status.POISONED_WEAPON] ?? 0) + howMuch;
}

/**
 * `do_shockwave` (boe.combat.cpp:4261) — unblockable damage to everything
 * within ten squares *except* whoever is standing on the centre, and the
 * further away the harder it lands.
 */
export async function doShockwave(session: GameSession, target: { x: number; y: number }): Promise<void> {
  const { univ } = session;
  // `start_missile_anim()` … `do_explosion_anim(5,0)` … `end_missile_anim()` …
  // `handle_marked_damage()` (boe.combat.cpp:4293/4303). The volley was never
  // opened here, so every hit `damage_pc`/`damage_monst` collected was dropped
  // — and with it `do_explosion_anim`'s **eleven** `draw_terrain()`s, which in
  // combat each spend the status bar's encumbrance roll. The sound is 5,
  // passed rather than looked up from the boom type.
  startBoomAnim();
  try {
  for (const pc of univ.party.pcs) {
    const d = dist(target, pc.combatPos);
    if (d <= 0 || d >= 11 || pc.mainStatus !== MainStatus.ALIVE) continue;
    await damagePc(univ, pc, univ.rng.getRan(2 + Math.trunc(d / 2), 1, 6), DamageType.UNBLOCKABLE);
  }
  for (const monst of univ.town?.monsters ?? []) {
    if (!monst.isAlive) continue;
    const d = dist(target, monst.curLoc);
    if (d <= 0 || d >= 11) continue;
    if (session.canSeeLight(target, monst.curLoc) >= SIGHT_BLOCKED) continue;
    await damageMonst(univ, monst, univ.curPc,
      univ.rng.getRan(2 + Math.trunc(d / 2), 1, 6), DamageType.UNBLOCKABLE, { session });
  }
  } finally {
    runBoomAnim(univ.rng, () => drawTerrain(session), 5);
    await animSettle();
    await handleMarkedDamage(univ, session);
  }
}

/**
 * `combat_immed_mage_cast` — the mage spells that resolve the moment they are
 * cast, with no square to pick.
 *
 * The single-target arms read `store_spell_target`, the PC chosen in the
 * casting dialog. As in `spellTown.ts`, and for the same reason, the caster
 * stands in for that until the dialog exists.
 */
export async function combatImmedMageCast(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): Promise<void> {
  const { univ } = session;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  const bonus = freebie ? 1 : caster.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : caster.level;
  if (!freebie && (info.level ?? 0) <= getProtLevel(caster, ItemAbil.MAGERY)) level++;
  const spend = (): void => { if (!freebie) caster.curSp -= info.cost ?? 0; };
  // `store_spell_target` — the PC the casting dialog aimed at.
  const target = univ.party.pcs[session.spellTarget] ?? caster;

  switch (spellNum) {
    case Spell.SHOCKWAVE:
      spend();
      univ.addStringToBuf('  The ground shakes!');
      await doShockwave(session, caster.combatPos);
      break;

    case Spell.HASTE_MINOR:
    case Spell.HASTE:
    case Spell.STRENGTH:
    case Spell.ENVENOM:
    case Spell.RESIST_MAGIC: {
      spend();
      livingSound(4);
      if (spellNum === Spell.ENVENOM) {
        poisonWeapon(session, univ.party.pcs.indexOf(target), 3 + bonus);
        univ.addStringToBuf(`  ${target.name} receives venom.`);
      } else if (spellNum === Spell.STRENGTH) {
        // Strength is a *negative* curse — the same status, pushed the good way.
        target.curse(-3);
        univ.addStringToBuf(`  ${target.name} stronger.`);
      } else if (spellNum === Spell.RESIST_MAGIC) {
        target.status[Status.MAGIC_RESISTANCE] =
          (target.status[Status.MAGIC_RESISTANCE] ?? 0) + 5 + bonus;
        univ.addStringToBuf(`  ${target.name} resistant.`);
      } else {
        // Haste is negative slow, likewise.
        target.slow(spellNum === Spell.HASTE_MINOR
          ? -2 : -Math.max(2, Math.trunc(level / 2) + bonus));
        univ.addStringToBuf(`  ${target.name} hasted.`);
      }
      break;
    }

    case Spell.HASTE_MAJOR:
    case Spell.BLESS_MAJOR:
      spend();
      for (const pc of univ.party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        pc.slow(-(spellNum === Spell.HASTE_MAJOR
          ? 1 + Math.trunc(level / 8) + bonus : 3 + bonus));
        if (spellNum === Spell.BLESS_MAJOR) {
          poisonWeapon(session, univ.party.pcs.indexOf(pc), 2);
          pc.curse(-4);
        }
      }
      univ.addStringToBuf(spellNum === Spell.HASTE_MAJOR
        ? '  Party hasted.' : '  Party blessed!');
      break;

    case Spell.SLOW_GROUP:
    case Spell.FEAR_GROUP:
    case Spell.PARALYSIS_MASS:
    case Spell.SLEEP_MASS: {
      spend();
      livingSound(spellNum === Spell.FEAR_GROUP ? 54 : 25);
      univ.addStringToBuf(
        spellNum === Spell.SLOW_GROUP ? '  Enemy slowed:'
          : spellNum === Spell.FEAR_GROUP ? '  Enemy scared:'
            : spellNum === Spell.PARALYSIS_MASS ? '  Enemy paralyzed:'
              : '  Enemy drowsy:');
      for (const monst of univ.town?.monsters ?? []) {
        if (!monst.isAlive || monst.isFriendly) continue;
        if (dist(caster.combatPos, monst.curLoc) > (info.range ?? 0)) continue;
        if (session.canSeeLight(caster.combatPos, monst.curLoc) >= SIGHT_BLOCKED) continue;
        switch (spellNum) {
          case Spell.FEAR_GROUP:
            monst.scare(univ.rng.getRan(Math.trunc(level / 3), 1, 8));
            break;
          case Spell.SLOW_GROUP:
            monst.slow(5 + bonus);
            break;
          case Spell.PARALYSIS_MASS:
            monst.sleep(Status.PARALYZED, 1000, 15, univ.rng);
            break;
          default:
            monst.sleep(Status.ASLEEP, 8, 15, univ.rng);
            break;
        }
      }
      break;
    }

    case Spell.BLADE_AURA:
      // Note: no cost — it's a scenario-granted spell.
      await placeSpellPattern(session, SpellPat.RADIUS_2, caster.combatPos,
        { field: FieldType.WALL_BLADES, whoHit: 6 });
      break;

    case Spell.FLAME_AURA:
      await placeSpellPattern(session, SpellPat.OPEN_SQUARE, caster.combatPos,
        { damage: { type: DamageType.FIRE, dice: 6 }, whoHit: pcNum });
      break;

    default:
      univ.addStringToBuf(
        `  Error: Mage spell ${spellName(spellNum)} not implemented for combat mode.`);
      break;
  }
}

/** `combat_immed_priest_cast` — the priest half of the same. */
export async function combatImmedPriestCast(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): Promise<void> {
  const { univ } = session;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  const bonus = freebie ? 1 : caster.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : caster.level;
  if (!freebie && caster.traits[Trait.ANAMA]) level++;
  const spend = (): void => { if (!freebie) caster.curSp -= info.cost ?? 0; };
  const target = univ.party.pcs[session.spellTarget] ?? caster;

  switch (spellNum) {
    case Spell.BLESS_MINOR:
    case Spell.BLESS:
      spend();
      livingSound(4);
      target.curse(-(spellNum === Spell.BLESS_MINOR
        ? 2 : Math.max(2, Math.trunc((level * 3) / 4) + 1 + bonus)));
      break;

    case Spell.BLESS_PARTY:
      spend();
      for (const pc of univ.party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        pc.curse(-Math.trunc(level / 3));
      }
      livingSound(4);
      break;

    case Spell.AVATAR:
      spend();
      univ.addStringToBuf(`  ${caster.name} is an avatar!`);
      caster.avatar();
      break;

    case Spell.CURSE_ALL:
    case Spell.CHARM_MASS:
    case Spell.PESTILENCE:
      spend();
      livingSound(24);
      for (const monst of univ.town?.monsters ?? []) {
        if (!monst.isAlive || monst.isFriendly) continue;
        // Note: unlike the mage group spells, this one does *not* check line of
        // sight. The C++ has a TODO asking whether it should; kept as-is.
        if (dist(caster.combatPos, monst.curLoc) > (info.range ?? 0)) continue;
        if (spellNum === Spell.CURSE_ALL) monst.curse(3 + bonus);
        else if (spellNum === Spell.CHARM_MASS) {
          monst.sleep(Status.CHARM, 0, 28 - bonus, univ.rng);
        } else monst.disease(3 + bonus);
      }
      break;

    case Spell.PROTECTIVE_CIRCLE:
      spend();
      livingSound(24);
      univ.addStringToBuf('  Protective field created.');
      await placeSpellPattern(session, SpellPat.PROT, caster.combatPos, { whoHit: 6 });
      break;

    case Spell.AUGMENTATION:
      // Note: no cost, in the C++ too — a scenario-granted spell.
      univ.addStringToBuf('  Health augmented!');
      target.curHealth += univ.rng.getRan(3, 1, 6);
      break;

    case Spell.NIRVANA: {
      univ.addStringToBuf('  Enlightened!');
      const i = univ.rng.getRan(3, 1, 6);
      // A negative DUMB is enlightenment; note the truncation toward zero, so
      // a roll under 3 gives no mental boost at all — only the points.
      target.applyStatus(Status.DUMB, Math.trunc(i / -3));
      target.curSp += i * 2;
      break;
    }

    default:
      univ.addStringToBuf(
        `  Error: Priest spell ${spellName(spellNum)} not implemented for combat mode.`);
      break;
  }
}

/**
 * The gate `combat_cast_mage_spell` / `combat_cast_priest_spell` run **before**
 * they open the picker (boe.combat.cpp:4523, :4751): can the active PC cast
 * anything of this kind at all?
 *
 * This port had no equivalent, so an Anama or a fighter with no mage skill got
 * the spell list anyway, picked nothing castable, and cast whatever the dialog
 * defaulted to — the failure surfaced afterwards instead of stopping the whole
 * action. Returns false when the picker must not open.
 *
 * *Gotcha*: an encumbered mage **loses six action points for trying**, and is
 * the only refusal that costs anything.
 */
export function combatCastCheck(session: GameSession, type: Skill): boolean {
  const { univ } = session;
  const pc = univ.currentPc;
  const status = pcCanCastType(session, pc, type);
  if (status === CastStatus.OK) return true;
  // The C++ prints the reason with no PC name here — see `printCastStatus`'s
  // note about the missing separator that leaves.
  printCastStatus(univ, status, type, pc.name);
  // **Only the mage pays for being encumbered.** `combat_cast_mage_spell`
  // has the `NO_CAST_ENCUMBERED` arm — "Oops, trying to cast a mage spell
  // while encumbered takes your AP!", `take_ap(6)` and `return true`
  // (boe.combat.cpp:4566) — and `combat_cast_priest_spell` has no such arm at
  // all (:4788): its refusal prints and leaves the turn alone. This port
  // charged both, so an encumbered priest lost six points a try.
  if (status === CastStatus.NO_ENCUMBERED && type === Skill.MAGE_SPELLS) {
    takeAp(univ, MAGE_AP);
    // `return true` from the refusal is `did_something`, so this one does owe
    // `handle_monster_actions`.
    session.monsterActionsCombat();
  }
  return false;
}

/**
 * `combat_cast_mage_spell` / `combat_cast_priest_spell` — cast `spellNum` as
 * the active PC, dispatching on the spell's `refer`.
 *
 * Picking the spell is the caller's job; the C++ opens `pick_spell` here.
 */
export async function combatCastSpell(
  session: GameSession, spellNum: Spell, freebie = false,
): Promise<void> {
  const { univ } = session;
  const pcNum = univ.curPc;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  if (caster.traits[Trait.PACIFIST] && !info.peaceful) {
    univ.addStringToBuf("Cast: You're a pacifist!");
    return;
  }

  // Simulacrum picks its monster *before* anything else happens — before the
  // "casts" line, and before any AP or spell points are spent. Its cost is the
  // chosen monster's level (the spell's own cost is -1), which is why it is
  // also the one spell that can be refused for want of points this late.
  if (spellNum === Spell.SIMULACRUM) {
    if (!hasTrappedMonst(univ.party)) {
      univ.addStringToBuf('Simulacrum: You need to cast Capture');
      univ.addStringToBuf('  Soul on a creature first.');
      return;
    }
    const which = (await session.onPickTrappedMonst?.()) ?? 0;
    if (which === 0) return;
    const mon = which >= 10000
      ? univ.party.summons[which - 10000]
      : univ.scenario.scenMonsters[which];
    if (!mon) return;
    if (caster.curSp < mon.level) {
      univ.addStringToBuf('Cast: Not enough spell points.');
      return;
    }
    session.sumMonst = which;
    session.sumMonstCost = mon.level;
  }

  const isPriest = info.type === Skill.PRIEST_SPELLS
    || (spellNum >= 100 && info.type === undefined);
  univ.addStringToBuf(`${caster.name} casts ${spellName(spellNum)}.`);

  const cost = isPriest ? PRIEST_AP : MAGE_AP;

  switch (info.refer) {
    case SpellRefer.YES:
      // The town implementation does the work; the AP go first either way.
      takeAp(univ, cost);
      // `draw_terrain(2)` between the AP and the spell (boe.combat.cpp:4611,
      // :4812). Not free: both casters set
      // `combat_posing_monster = current_working_monster = univ.cur_pc` on the
      // line above `print_spell_cast`, so mode 2 gets past its early-out for
      // the whole of the cast.
      drawTerrain(session);
      if (isPriest) doPriestSpell(session, pcNum, spellNum, freebie);
      else doMageSpell(session, pcNum, spellNum, freebie);
      // Casting is a free function, not a GameSession method, so it has to
      // trigger the turn advance itself. **`monsterActionsCombat`, not
      // `afterCombatAction`**: `combat_cast_mage_spell` returns
      // `did_something` and it is `advance_time` that steps the round, through
      // `handle_monster_actions` — whose combat arm draws before it steps.
      session.monsterActionsCombat();
      break;

    case SpellRefer.IMMED:
      takeAp(univ, cost);
      drawTerrain(session);
      if (isPriest) await combatImmedPriestCast(session, pcNum, spellNum, freebie);
      else await combatImmedMageCast(session, pcNum, spellNum, freebie);
      session.monsterActionsCombat();
      break;

    case SpellRefer.TARGET:
      startSpellTargeting(session, spellNum, freebie);
      break;

    case SpellRefer.FANCY:
      startFancySpellTargeting(session, spellNum, freebie);
      break;

    default:
      univ.addStringToBuf(
        `  Error: Spell ${spellName(spellNum)} has no way to be cast.`);
      break;
  }
}
