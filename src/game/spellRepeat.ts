/**
 * Recasting the last spell — the **M** and **P** shortcuts (shift-m, shift-p).
 *
 * `handle_keystroke` (boe.actions.cpp:3057) sets `spell_forced` and
 * `spell_recast` and falls through into the ordinary cast, and the two flags
 * mean slightly different things: `spell_forced` says "don't open the picker,
 * use what is stored", and `spell_recast` says "this came from the shortcut, so
 * check it is still castable first". `handle_menu_spell` sets `spell_forced`
 * without `spell_recast`, which is why the check lives under the second.
 *
 * What is stored is kept in two places, and they are not the same thing:
 *
 *   - **Out of combat**, in the four `store_*` globals, written by
 *     `do_mage_spell`/`do_priest_spell` themselves (boe.party.cpp:631, :894).
 *     They remember the spell, its target and *who cast it*.
 *   - **In combat**, on the PC — `last_cast[type]` and `last_target[type]`,
 *     written by `finish_pick_spell` (boe.party.cpp:2050). Each character
 *     remembers their own, because in combat the active PC casts and there is
 *     no caster to choose.
 *
 * The C++ keeps the first set as globals; here they hang off the session, which
 * has the same lifetime and cannot leak between two games in one process.
 */

import { SPELLS, Spell, SpellSelect } from '../data/spell';
import { MainStatus, Skill } from '../universe/skills';
import { hasFeatureFlag } from './featureFlags';
import { NO_TARGET } from './spellPick';
import { pcCanCastSpell } from './spellCast';
import { isCombat } from './modes';
import type { GameSession } from './session';

/** The out-of-combat half: `store_mage`/`store_priest` and their companions. */
export interface SpellStore {
  spell: Spell;
  /** Which PC cast it (`store_*_caster`). 6 is nobody. */
  caster: number;
  /** Which PC it was aimed at (`store_*_target`). 6 is nobody. */
  target: number;
}

export function emptySpellStore(): SpellStore {
  return { spell: Spell.NONE, caster: NO_TARGET, target: NO_TARGET };
}

/** Which of the two stores a skill uses. */
export function storeFor(session: GameSession, type: Skill): SpellStore {
  return type === Skill.PRIEST_SPELLS ? session.priestStore : session.mageStore;
}

/**
 * `repeat_cast_ok` (boe.party.cpp:521) — may the shortcut fire, and what does
 * it aim at? Returns the caster, or `null` with the refusal already printed.
 *
 * It is a *check*, but not only a check: under the `store-spell-target` flag it
 * also writes `store_spell_target` back, which is what makes a repeated
 * single-target spell hit the same PC again.
 */
export function repeatCastOk(session: GameSession, type: Skill): number | null {
  const { univ } = session;
  if (!session.primeTime) return null;

  const inFight = isCombat(session.mode);
  let whoWouldCast: number;
  if (inFight) {
    whoWouldCast = univ.curPc;
  } else if (hasFeatureFlag('store-spell-caster', 'fixed')) {
    // The fix: recast from whoever cast it, not from whoever the game happens
    // to think is casting now.
    whoWouldCast = storeFor(session, type).caster;
    if (whoWouldCast === NO_TARGET) whoWouldCast = univ.curPc;
  } else {
    whoWouldCast = univ.curPc;
  }

  const caster = univ.party.pcs[whoWouldCast];
  if (!caster) return null;

  const what = inFight
    ? (caster.lastCast[type] ?? Spell.NONE)
    : storeFor(session, type).spell;

  if (what === Spell.NONE) {
    univ.addStringToBuf(
      `Repeat cast: No ${type === Skill.MAGE_SPELLS ? 'mage' : 'priest'} spell stored.`);
    return null;
  }
  if (!pcCanCastSpell(session, caster, what)) {
    univ.addStringToBuf("Repeat cast: Can't cast.");
    return null;
  }

  const select = SPELLS[what]?.select ?? SpellSelect.NO;
  if (hasFeatureFlag('store-spell-target', 'fixed')) {
    // The fix: aim it where it was aimed before. Without the flag
    // `store_spell_target` keeps whatever it happened to hold, which is the
    // behaviour every recording made before the fix depends on.
    session.spellTarget = inFight
      ? (caster.lastTarget[type] ?? NO_TARGET)
      : storeFor(session, type).target;
  }

  if (select !== SpellSelect.NO && session.spellTarget === NO_TARGET) {
    univ.addStringToBuf('Repeat cast: No target stored.');
    return null;
  }
  const target = univ.party.pcs[session.spellTarget];
  // `isAbsent` (damage.hpp:114) is `ABSENT || status > 4` — so FLED, SURFACE
  // and WON count as gone. SELECT_ANY will happily take a dead or dust PC,
  // since raising them is the point; SELECT_ACTIVE wants them on their feet.
  const absent = (s2: MainStatus): boolean =>
    s2 === MainStatus.ABSENT || (s2 as number) > 4;
  if (select === SpellSelect.ANY && (target === undefined || absent(target.mainStatus))) {
    univ.addStringToBuf('Repeat cast: No target stored.');
    return null;
  }
  if (select === SpellSelect.ACTIVE
    && (target === undefined || target.mainStatus !== MainStatus.ALIVE)) {
    univ.addStringToBuf('Repeat cast: No target stored.');
    return null;
  }
  return whoWouldCast;
}

/**
 * What the shortcut will cast — the stored spell for `type`, from whichever of
 * the two stores applies. `Spell.NONE` when there is nothing to repeat.
 */
export function storedSpell(session: GameSession, type: Skill, caster: number): Spell {
  if (isCombat(session.mode)) {
    return session.univ.party.pcs[caster]?.lastCast[type] ?? Spell.NONE;
  }
  return storeFor(session, type).spell;
}
