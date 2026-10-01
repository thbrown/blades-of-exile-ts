/**
 * Town targeting — `start_town_targeting` (boe.party.cpp:2269) and
 * `cast_town_spell` (:1293).
 *
 * A dozen spells don't resolve where they're cast: they ask for a square
 * first. The C++ drops into `MODE_TOWN_TARGET`, remembers which spell is in
 * the air, and finishes the job in `cast_town_spell` when the next click lands.
 * This is the same shape the missile code already uses (`handleMissile` /
 * `fireMissileAt` in `session.ts`).
 *
 * The cost is spent in `cast_town_spell`, not when targeting begins — so
 * cancelling out of targeting is free, and a spell that fails its roll has
 * still been paid for.
 */

import { Location, dist } from '../core/location';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { FieldType } from '../data/fields';
import { ItemAbil } from '../data/item';
import { SpellPat, getBuiltinPattern } from '../data/pattern';
import { Spell, SPELLS, isPriestSide, spellName } from '../data/spell';
import { TerSpec } from '../data/terrain';
import { getProtLevel } from '../universe/inventory';
import { livingSound } from '../universe/living';
import type { Universe } from '../universe/universe';
import { Skill, Trait } from '../universe/skills';
import { SpecCtx } from './specials/context';
import { e3UnlockSpell, e3Unlocks, unlockDoor } from './doors';
import { breakForceCage } from './fieldEffects';
import { GameMode } from './modes';
import { placeSpellPattern } from './spellPatterns';
import { recordMonst } from './soulCrystal';
import type { GameSession } from './session';

/**
 * `combat_percent` (boe.party.cpp:56) — the level-scaled slack the unlock and
 * dispel rolls are measured against. Note it *falls* with level, and the
 * callers subtract it from a constant, so a higher level is a wider target.
 */
export const COMBAT_PERCENT = [
  150, 120, 100, 90, 80, 80, 80, 70, 70, 70,
  70, 70, 67, 62, 57, 52, 47, 42, 40, 40,
];

function combatPercent(level: number): number {
  return COMBAT_PERCENT[Math.max(0, Math.min(19, level))] ?? 40;
}

/** What `start_town_targeting` parks while it waits for a click. */
export interface TownTarget {
  spell: Spell;
  whoCast: number;
  freebie: boolean;
  pattern: SpellPat;
  /** `store_item_spell_level` — the level a spell from an item counts as. */
  itemSpellLevel: number;
  /**
   * `current_spell_range` — a flat 8 for every town spell, set by
   * `do_mage_spell` (boe.party.cpp:631) and `do_priest_spell` (:893) before
   * they hand over. It isn't the spell's own range and it doesn't gate the
   * cast; it's what the targeting overlay draws its reach from.
   */
  range: number;
}

/** The range every town spell targets at (boe.party.cpp:631). */
export const TOWN_SPELL_RANGE = 8;

/**
 * `start_town_targeting` — go into targeting mode with `spell` in the air.
 *
 * The C++ silently substitutes PAT_SINGLE for a rotatable pattern here,
 * because town targeting can't ask which way to face; its own TODO wants an
 * error instead. Kept, since PAT_WALL is the only rotatable builtin.
 */
export function startTownTargeting(
  session: GameSession,
  spell: Spell,
  whoCast: number,
  freebie = false,
  pattern: SpellPat = SpellPat.SINGLE,
  itemSpellLevel = 1,
): void {
  session.univ.addStringToBuf('  Target spell.');
  session.mode = GameMode.TOWN_TARGET;
  session.townTarget = {
    spell,
    whoCast,
    freebie,
    pattern: pattern === SpellPat.WALL ? SpellPat.SINGLE : pattern,
    itemSpellLevel,
    range: TOWN_SPELL_RANGE,
  };
  // `current_pat` (boe.party.cpp:2290), with the same silent WALL → SINGLE.
  session.currentPat = getBuiltinPattern(session.townTarget.pattern);
}

/** Back out of targeting. Nothing has been spent, so nothing is refunded. */
export function cancelTownTargeting(session: GameSession): void {
  if (session.townTarget === null) return;
  const spell = session.townTarget.spell;
  session.townTarget = null;
  session.mode = GameMode.TOWN;
  // `if(town_spell == eSpell::NONE) queue_special(…, spec_target_fail,
  // univ.party.town_loc)` (boe.actions.cpp:420) — as in combat, walking away
  // from a node's targeting is a failure it gets told about.
  if (spell === Spell.NONE) {
    session.specials?.queueSpecial(SpecCtx.TARGET, session.specTargetType,
      session.specTargetFail, session.univ.party.townLoc);
  }
}

/**
 * `cast_town_spell` — the click landed on `where`; resolve whatever was in the
 * air.
 *
 * Returns to TOWN either way: a spell aimed out of the town or into the dark
 * has still been cast, which is what the C++ does.
 */
export async function castTownSpell(session: GameSession, where: Location): Promise<void> {
  const target = session.townTarget;
  if (!target) return;
  session.townTarget = null;
  session.mode = GameMode.TOWN;

  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  // **`whoCast` is not always a PC.** `TOWN_START_TARGETING` puts its `jumpto`
  // there — the node to run when the square is picked — so this only has to
  // resolve for a real spell, and every use of it below is already behind
  // `!freebie`, which a node's targeting never is.
  const pc = univ.party.pcs[target.whoCast];
  const spell = target.spell;
  if (!pc && spell !== Spell.NONE) return;
  const info = SPELLS[spell];

  // Note the comparisons are strict on all four sides, so the town's outermost
  // ring of squares can't be targeted at all.
  const rect = town.record.inTownRect;
  if (where.x <= rect.left || where.x >= rect.right
    || where.y <= rect.top || where.y >= rect.bottom) {
    univ.addStringToBuf("  Can't target outside town.");
    // Note this one *runs* the failure node rather than queueing it, unlike
    // every other refusal below. Kept as written.
    if (spell === Spell.NONE) {
      await session.runSpecial(
        SpecCtx.TARGET, session.specTargetType, session.specTargetFail, where);
    }
    return;
  }

  const adjust = session.canSeeLight(univ.party.townLoc, where);
  if (!target.freebie && pc) pc.curSp -= info?.cost ?? 0;

  const adj = target.freebie || !pc ? 1 : pc.statAdj(Skill.INTELLIGENCE);
  let level = target.freebie || !pc ? target.itemSpellLevel : pc.level;
  if (!target.freebie && pc && (info?.level ?? 0) <= getProtLevel(pc, ItemAbil.MAGERY)
    && !isPriestSide(spell)) level++;
  if (!target.freebie && pc && pc.traits[Trait.ANAMA] && isPriestSide(spell)) level++;

  // `if(adjust <= 4 && !cast_spell_on_space(where, town_spell))` — the square's
  // own `IF_CONTEXT` node gets to cancel the spell, and the C++ then queues the
  // targeting's failure node (boe.party.cpp:1329). It is here, above the
  // sight test, because a square you cannot see cannot intercept.
  if (adjust <= 4 && !(await session.castSpellOnSpace(where, spell))) {
    session.specials?.queueSpecial(
      SpecCtx.TARGET, session.specTargetType, session.specTargetFail, where);
    return;
  }

  // `if(spec_target_options / 10 == 1 && univ.town.is_antimagic(...))`
  // (boe.party.cpp:1335) — a node's targeting can be told to refuse an
  // antimagic square, and only a node's: a real town spell has
  // `spec_target_options` at whatever the last node left, which is 0 for a
  // game that has never run one.
  if (Math.trunc(session.specTargetOptions / 10) === 1
    && town.hasField(where.x, where.y, FieldType.FIELD_ANTIMAGIC)) {
    univ.addStringToBuf('  Target in antimagic field.');
    session.specials?.queueSpecial(
      SpecCtx.TARGET, session.specTargetType, session.specTargetFail, where);
    return;
  }

  // `bool failed = town_spell == eSpell::NONE && adjust > 4;`
  // (boe.party.cpp:1339). Note the town arm is far narrower than combat's: the
  // *only* way a node's targeting fails here is a square it cannot see. The
  // node's own answer is read into `need_redraw` and thrown away.
  const failed = spell === Spell.NONE && adjust > 4;

  if (adjust > 4) {
    univ.addStringToBuf("  Can't see target.");
    if (failed) {
      session.specials?.queueSpecial(
        SpecCtx.TARGET, session.specTargetType, session.specTargetFail, where);
    }
    return;
  }

  const terrain = town.record.terrain[where.x]![where.y]!;
  const terSpec = univ.terrainType(terrain);

  switch (spell) {
    // **Not a spell but a special node targeting** (boe.party.cpp:1345). The
    // node is in `spell_caster`, which `TOWN_START_TARGETING` set to its
    // `jumpto`; unlike combat's arm, the town one does not read the answer.
    case Spell.NONE:
      await session.runSpecial(
        SpecCtx.TARGET, session.specTargetType, session.spellCaster, where);
      break;

    case Spell.SCRY_MONSTER:
    case Spell.CAPTURE_SOUL: {
      const monst = town.monsterAt(where);
      if (!monst) {
        univ.addStringToBuf('  No monster there.');
        break;
      }
      if (spell === Spell.SCRY_MONSTER) {
        univ.party.mNoted.add(monst.number);
        univ.addStringToBuf(`  ${monst.mon.name} noted.`);
        // `adjust_monst_menu()` then `display_monst(0, monst, 0)`: the sheet
        // opens on this one creature, with the roster arrows hidden.
        session.onShowMonster?.(monst);
      } else recordMonst(univ, monst);
      break;
    }

    case Spell.DISPEL_FIELD:
    case Spell.DISPEL_SPHERE:
    case Spell.DISPEL_SQUARE:
      univ.addStringToBuf('  You attempt to dispel.');
      await placeSpellPattern(session, target.pattern, where,
        { field: FieldType.FIELD_DISPEL, whoHit: 7 });
      break;

    case Spell.MOVE_MOUNTAINS:
    case Spell.MOVE_MOUNTAINS_MASS:
      univ.addStringToBuf('  You blast the area.');
      await placeSpellPattern(session, target.pattern, where,
        { field: FieldType.FIELD_SMASH, whoHit: 7 });
      session.updateExplored(univ.party.townLoc);
      break;

    case Spell.BARRIER_FIRE:
    case Spell.BARRIER_FORCE: {
      if (session.sightObscurity(where.x, where.y) === 5 || town.monsterAt(where)) {
        univ.addStringToBuf('  Target space obstructed.');
        break;
      }
      const which = spell === Spell.BARRIER_FIRE
        ? FieldType.BARRIER_FIRE : FieldType.BARRIER_FORCE;
      town.setField(where.x, where.y, which, true);
      // The C++ reads the flag straight back: `set_*_barr` can refuse, and
      // this is how it finds out.
      univ.addStringToBuf(town.hasField(where.x, where.y, which)
        ? '  You create the barrier.' : '  Failed.');
      break;
    }

    case Spell.QUICKFIRE:
      town.setField(where.x, where.y, FieldType.FIELD_QUICKFIRE, true);
      univ.addStringToBuf(town.hasField(where.x, where.y, FieldType.FIELD_QUICKFIRE)
        ? '  You create quickfire.' : '  Failed.');
      break;

    case Spell.ANTIMAGIC:
      univ.addStringToBuf('  You create an antimagic cloud.');
      // Radius 2, but with the corners cut off by that last condition — the
      // cloud is a plus sign with shoulders, not a 5x5 block.
      for (let x = 0; x < town.record.maxDim; x++) {
        for (let y = 0; y < town.record.maxDim; y++) {
          const at = { x, y };
          if (dist(where, at) > 2) continue;
          if (canSee(where, at, session.sightObscurity) >= SIGHT_BLOCKED) continue;
          if (Math.abs(x - where.x) >= 2 && Math.abs(y - where.y) >= 2) continue;
          town.setField(x, y, FieldType.FIELD_ANTIMAGIC, true);
        }
      }
      break;

    case Spell.RITUAL_SANCTIFY:
      // The C++ arm is empty: the work happens in cast_spell_on_space above,
      // which prints "Nothing happens." when the square has no special node.
      univ.addStringToBuf('  Nothing happens.');
      break;

    case Spell.UNLOCK: {
      const e3 = e3Unlocks(univ);
      if (e3) {
        // E3 reads the caster's level as it stands (`10b0:6462`), no magery.
        const pcLevel = target.freebie || !pc ? level : pc.level;
        e3UnlockSpell(univ, e3, where, adj, 135 - combatPercent(pcLevel), livingSound);
        break;
      }
      if (terSpec.special !== TerSpec.UNLOCKABLE) {
        univ.addStringToBuf('  Wrong terrain type.');
        break;
      }
      // flag2 of 10 is the scenario designer's "never openable" marker.
      const r1 = terSpec.flag2 === 10
        ? 10000
        : univ.rng.getRan(1, 1, 100) - 5 * adj + 5 * spellDifficulty(univ)
          + terSpec.flag2 * 7;
      if (r1 < 135 - combatPercent(level)) {
        univ.addStringToBuf('  Door unlocked.');
        livingSound(9);
        unlockDoor(univ, where, terrain);
      } else {
        livingSound(41);
        univ.addStringToBuf("  Didn't work.");
      }
      break;
    }

    case Spell.DISPEL_BARRIER: {
      const fire = town.hasField(where.x, where.y, FieldType.BARRIER_FIRE);
      const force = town.hasField(where.x, where.y, FieldType.BARRIER_FORCE);
      if (fire || force) {
        let r1 = univ.rng.getRan(1, 1, 100) - 5 * adj
          + 5 * Math.trunc(spellDifficulty(univ) / 10)
          + 25 * (town.record.strongBarriers ? 1 : 0);
        // A fire barrier is very slightly easier than a force one.
        if (fire) r1 -= 8;
        if (r1 < 120 - combatPercent(level)) {
          univ.addStringToBuf('  Barrier broken.');
          town.setField(where.x, where.y, FieldType.BARRIER_FIRE, false);
          town.setField(where.x, where.y, FieldType.BARRIER_FORCE, false);
          session.updateExplored(univ.party.townLoc);
        } else {
          // The C++ rolls here and discards it, with its own "why does it even
          // do this?" comment. Kept: it moves the RNG.
          univ.rng.getRan(1, 0, 1);
          livingSound(41);
          univ.addStringToBuf("  Didn't work.");
        }
      } else if (town.hasField(where.x, where.y, FieldType.BARRIER_CAGE)) {
        univ.addStringToBuf('  Cage broken.');
        breakForceCage(session, where);
      } else univ.addStringToBuf('  No barrier there.');
      break;
    }

    default:
      univ.addStringToBuf(
        `  Error: Spell ${spellName(spell)} not implemented for town mode.`);
      break;
  }
}

/**
 * The town difficulty the Unlock and Dispel Barrier spells read. Exile III's
 * (0–150, `townDifficulty` in the converter) is read by both of its arms
 * too, as `difficulty / 10 * 5` (Unlock `10b0:643d`, Dispel Barrier
 * `10b0:6591`), which is the shape Dispel Barrier's roll already has; E3's
 * Unlock has its own (`e3UnlockSpell`). Until 2026-10-01 a `town-difficulty`
 * = `exile3` flag kept both spells off it, on the mistaken reading that E3's
 * spells never looked.
 */
function spellDifficulty(univ: Universe): number {
  return univ.town?.record.difficulty ?? 0;
}
