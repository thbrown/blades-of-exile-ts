/**
 * `pick_spell`'s state machine (boe.party.cpp:2133), with no screen attached —
 * which spell each of the 38 grid slots holds, who is casting, who is being
 * aimed at, and what a click on each of the dialog's controls does.
 *
 * It lives here rather than inside `CastDialog` because two very different
 * things have to agree on it: the dialog the player clicks, and the **replay
 * driver**, which has no canvas at all and answers the same screen from the
 * `click_control` ids the C++ recorded (`spell23`, `caster2`, `target3`,
 * `other`, `cast`). Those ids are the C++'s own control names, so this class
 * takes them directly — that is the seam where a recorded game meets this port.
 */

import { NUM_NORMAL_SPELLS, SPELLS, Spell, SpellSelect, spellFromNum } from '../data/spell';
import { MainStatus } from '../universe/skills';
import { isCombat } from './modes';
import { storeFor } from './spellRepeat';
import { CastStatus, pcCanCastSpell, pcCanCastType, printCastStatus } from './spellCast';
import type { GameSession } from './session';
import { Skill } from '../universe/skills';

/**
 * The spell the picker opens on when there is nothing better to open on
 * (boe.party.cpp:62). The priest list has a separate one for combat.
 */
export const DEFAULT_MAGE = Spell.LIGHT;
export const DEFAULT_PRIEST = Spell.HEAL_MINOR;
export const DEFAULT_PRIEST_COMBAT = Spell.BLESS_MINOR;

/** `store_spell_target`'s "nobody chosen". */
export const NO_TARGET = 6;

/** The 38 grid slots, ten to a column bar the last. */
export const SPELL_SLOTS = 38;

/**
 * `spell_index` (boe.party.cpp:103) — which spell each of the 38 grid slots
 * shows on the *second* page. 90 means the slot is empty there, which is how
 * levels 5-7 (eight spells each) fit a grid built for ten.
 */
const SPELL_INDEX = [
  38, 39, 40, 41, 42, 43, 44, 45, 90, 90,
  46, 47, 48, 49, 50, 51, 52, 53, 90, 90,
  54, 55, 56, 57, 58, 59, 60, 61, 90, 90,
  90, 90, 90, 90, 90, 90, 90, 90,
];

/** What the player settled on, read once the dialog closes. */
export interface CastChoice {
  spell: Spell;
  caster: number;
  /** The PC a `needsSelect` spell was aimed at; 6 for "nobody chosen". */
  target: number;
}

/** What a click on the picker decided: keep going, or close with this result. */
export type PickAction = 'stay' | 'cast' | 'cancel';

export class SpellPick {
  page = 0;
  spell: Spell = Spell.NONE;
  caster: number;
  target: number = NO_TARGET;

  /**
   * @param canChooseCaster false in combat, where the active PC casts and the
   *   caster buttons are inert (`pick_spell`'s `can_choose_caster`).
   */
  constructor(
    readonly session: GameSession,
    readonly type: Skill,
    readonly canChooseCaster: boolean,
  ) {
    const { univ } = session;
    const isPriest = type === Skill.PRIEST_SPELLS;
    // **`pc_casting` starts from whoever cast last**, not from the active PC:
    // `store_last_cast_mage`/`_priest`, which `finish_pick_spell` writes on the
    // way out — even on Cancel. 6 means nobody has yet.
    this.caster = session.lastCaster[isPriest ? 1 : 0];
    if (this.caster === NO_TARGET) this.caster = univ.curPc;
    // pick_spell keeps that caster if they can cast, and otherwise walks the
    // party for the first who can.
    if (canChooseCaster
      && pcCanCastType(session, univ.party.pcs[this.caster]!, type) !== CastStatus.OK) {
      const found = univ.party.pcs.findIndex(
        (pc) => pcCanCastType(session, pc, type) === CastStatus.OK);
      if (found >= 0) this.caster = found;
    }
    if (!canChooseCaster) this.caster = univ.curPc;
    // Every one of those assignments is to the `pc_casting` global in the C++
    // (boe.party.cpp:2139-2169), and it outlives the dialog — `repeat_cast_ok`
    // reads it later to decide who the shortcut would cast as.
    session.pcCasting = this.caster;

    // **The picker opens with a spell already selected**, which this port did
    // not do at all — it started on NONE, so a Cast with nothing clicked said
    // "Cast: No spell selected." where the C++ casts the default. That is the
    // observable difference; the recording clicks a spell whose LED is off,
    // gets "Spell not available.", clicks Cast, and the C++ casts what was
    // already selected.
    let want: Spell;
    if (isCombat(session.mode)) {
      // In combat it is *this PC's* last spell, and the priest list has its own
      // combat default when they have none.
      want = univ.party.pcs[this.caster]?.lastCast[type] ?? Spell.NONE;
      if (isPriest && want === Spell.NONE) want = DEFAULT_PRIEST_COMBAT;
    } else {
      want = storeFor(session, type).spell;
    }
    if (want === Spell.NONE) want = isPriest ? DEFAULT_PRIEST : DEFAULT_MAGE;
    // Keep it only if it is still castable — and note the fallback is **not**
    // re-checked, so a caster who can't manage Light still opens on Light.
    if (!this.castableBy(this.caster, want)) want = isPriest ? DEFAULT_PRIEST : DEFAULT_MAGE;
    this.spell = want;

    // The target survives too, if the spell wants one and that PC is still up.
    const stored = session.spellTarget;
    if (stored < NO_TARGET) {
      const needs = (SPELLS[want]?.select ?? SpellSelect.NO) !== SpellSelect.NO;
      const alive = univ.party.pcs[stored]?.mainStatus === MainStatus.ALIVE;
      this.target = needs && alive ? stored : NO_TARGET;
    }

    // Levels 5-7 live on the second page, and the picker opens on whichever
    // page the selected spell is on.
    // `int(default_spell) % 100` — the number within its own list.
    this.page = (want % 100) >= 38 ? 1 : 0;
  }

  /**
   * **`pick_spell`'s prologue — and whether the dialog opens at all.**
   * (boe.party.cpp:2148.) `cast_spell` calls `pick_spell(6, type)`, and its
   * `pc_num == 6` branch keeps the stored caster if they can cast and otherwise
   * walks the party for the first who can. When **nobody** can it prints
   * "Cast: Nobody can." and returns `eSpell::NONE` — so no picker appears, and
   * the three `click_control`s a recording holds for it are **orphans the C++
   * skips**. Missing that was worth 4,000 draws on `VoDT_09-04-2025_09-41-10`,
   * where a party whose only two living members had no spell points opened a
   * picker here and healed somebody.
   *
   * Antimagic is the exception the C++ makes on purpose: it prints and opens
   * the dialog anyway, and skips the party scan (which in combat would spend
   * an encumbrance roll per PC).
   *
   * The combat callers pass `pc_num = univ.cur_pc` and `check_done = true`
   * (boe.combat.cpp:4574, :4793), so neither this branch nor the
   * `!can_choose_caster` refusal below it runs there — `combatCastCheck` is
   * that path's gate. Which is also why this scan costs no dice: every arm of
   * `pc_can_cast_spell` that draws is `is_combat()`-gated.
   *
   * Returns `null` where the C++ returns `eSpell::NONE` without a dialog.
   */
  static open(
    session: GameSession, type: Skill, canChooseCaster: boolean,
  ): SpellPick | null {
    if (!canChooseCaster) return new SpellPick(session, type, canChooseCaster);
    const { univ } = session;
    let who = session.lastCaster[type === Skill.PRIEST_SPELLS ? 1 : 0];
    if (who === NO_TARGET) who = univ.curPc;
    const same = univ.party.pcs[who]
      ? pcCanCastType(session, univ.party.pcs[who]!, type) : CastStatus.NO_UNKNOWN;
    if (same === CastStatus.NO_ANTIMAGIC) {
      printCastStatus(univ, same, type);
    } else if (same !== CastStatus.OK) {
      let found = -1;
      for (const pc of univ.party.pcs) {
        const status = pcCanCastType(session, pc, type);
        if (status === CastStatus.OK) { found = 1; break; }
        // The immutable reasons — no skill, Anama — say nothing; the rest name
        // the PC. `NO_SP` through `NO_ASLEEP` is the C++'s own range test.
        if (status >= CastStatus.NO_SP && status <= CastStatus.NO_ASLEEP) {
          printCastStatus(univ, status, type, pc.name);
        }
      }
      if (found < 0) {
        univ.addStringToBuf('Cast: Nobody can.');
        return null;
      }
    }
    return new SpellPick(session, type, canChooseCaster);
  }

  /** `pc_can_cast_spell(univ.party[i], spell)` for an arbitrary caster. */
  private castableBy(who: number, spell: Spell): boolean {
    const pc = this.session.univ.party.pcs[who];
    return pc ? pcCanCastSpell(this.session, pc, spell) : false;
  }

  get choice(): CastChoice {
    return { spell: this.spell, caster: this.caster, target: this.target };
  }

  /**
   * `finish_pick_spell`'s tail (boe.party.cpp:2050) — the two refusals, and the
   * bookkeeping the shift-M and shift-P recast shortcut later reads back.
   *
   * Returns the choice, or `null` when it refuses. Cast still *closes* the
   * dialog either way; that is the C++'s behaviour and is why this is separate
   * from `click`.
   */
  finish(): CastChoice | null {
    const { univ } = this.session;
    // `store_last_cast_*` is written on **every** way out, refusals included,
    // so the picker opens on the same caster next time.
    this.session.lastCaster[this.type === Skill.PRIEST_SPELLS ? 1 : 0] = this.caster;
    if (this.spell === Spell.NONE) {
      univ.addStringToBuf('Cast: No spell selected.');
      return null;
    }
    const select = SPELLS[this.spell]?.select ?? SpellSelect.NO;
    if (select !== SpellSelect.NO && this.target === NO_TARGET) {
      // The C++ restores the previous target and reopens; here the caller
      // simply gets nothing, and the player casts again.
      univ.addStringToBuf('Cast: Need to select target.');
      return null;
    }
    // `last_cast` / `last_target` — per PC, because in combat the active PC
    // casts and each character remembers their own. A spell that needs no
    // target records 6, not the target that happened to be selected.
    const pc = univ.party.pcs[this.caster];
    if (pc) {
      pc.lastCast[this.type] = this.spell;
      pc.lastTarget[this.type] = select === SpellSelect.NO ? NO_TARGET : this.target;
      // `last_cast_type` goes with them on all three of `finish_pick_spell`'s
      // exits (boe.party.cpp:2061/2070/2089). It decides which of the two the
      // M/P hint offers — and, because the hint asks `pc_can_cast_spell`,
      // whether a terrain redraw in combat costs a die. See `textBar.ts`.
      pc.lastCastType = this.type;
    }
    return this.choice;
  }

  /** The spell in grid slot `i` on the current page, or NONE for an empty slot. */
  spellAt(i: number): Spell {
    const num = this.page === 0 ? i : (SPELL_INDEX[i] ?? 90);
    if (num >= 90 || num >= NUM_NORMAL_SPELLS) return Spell.NONE;
    return spellFromNum(this.type, num);
  }

  /** Whether the chosen caster could cast it — what lights the slot's LED. */
  castable(spell: Spell): boolean {
    const pc = this.session.univ.party.pcs[this.caster];
    return pc ? pcCanCastSpell(this.session, pc, spell) : false;
  }

  /** Whether this spell needs a party member picked before it can be cast. */
  needsTarget(spell: Spell): boolean {
    const select = SPELLS[spell]?.select ?? SpellSelect.NO;
    return select !== SpellSelect.NO;
  }

  // ------------------------------------------------------------ the controls

  /** `pick_spell_caster` — and its rule that changing caster can void the pick. */
  pickCaster(i: number): void {
    if (!this.canChooseCaster) return;
    const pc = this.session.univ.party.pcs[i];
    if (!pc || pcCanCastType(this.session, pc, this.type) !== CastStatus.OK) return;
    this.caster = i;
    this.session.pcCasting = i; // `pick_spell_caster`'s own write (:1955)
    if (this.spell !== Spell.NONE && !this.castable(this.spell)) {
      this.spell = Spell.NONE;
      this.target = NO_TARGET;
    }
  }

  /** `pick_spell_target`. Any of the six, whether or not they can be helped. */
  pickTarget(i: number): void {
    this.target = i;
  }

  /**
   * `pick_spell_select_led` — a click on a grid slot. A slot whose LED is off
   * (an empty slot, or a spell this caster can't manage) is refused and leaves
   * the pick alone, which is the C++'s "Spell not available."
   */
  pickSlot(i: number): void {
    const spell = this.spellAt(i);
    if (spell === Spell.NONE || !this.castable(spell)) return;
    this.spell = spell;
  }

  /** `pick_spell_event_filter`'s "other" — flip between levels 1-4 and 5-7. */
  flipPage(): void {
    this.page = this.page === 0 ? 1 : 0;
  }

  /**
   * A click by the C++'s own control name. This is what the replay driver
   * feeds; the dialog hit-tests rectangles and calls the methods above.
   *
   * Ids are one-based (`spell1` is slot 0), matching `put_spell_led_buttons`.
   * An id this screen doesn't have — `help`, or one of the read-only labels —
   * is ignored rather than refused, since the C++'s dialog swallows those too.
   */
  click(id: string): PickAction {
    if (id === 'cancel') {
      // Cancel writes `store_last_cast_*` too, and restores the target the
      // dialog opened with — which the caller keeps in `session.spellTarget`
      // and this never wrote to, so there is nothing to put back.
      this.session.lastCaster[this.type === Skill.PRIEST_SPELLS ? 1 : 0] = this.caster;
      return 'cancel';
    }
    // **Cast always closes**, even with nothing chosen: `finish_pick_spell`'s
    // `store_spell == 70` arm says "Cast: No spell selected." and toasts the
    // dialog. Leaving it open instead would swallow a recorded click.
    if (id === 'cast') return 'cast';
    if (id === 'other') {
      this.flipPage();
      return 'stay';
    }
    // Only these three are clickable: `pick_spell` attaches handlers to
    // caster1-6, target1-6, the 38 spell LEDs, `other`, `help`, `cast` and
    // `cancel` and to nothing else, so `pc1`..`pc6` (the name labels) and the
    // HP/SP readouts are inert.
    const numbered = /^(spell|caster|target)(\d+)$/.exec(id);
    if (numbered !== null) {
      const n = Number(numbered[2]) - 1;
      if (numbered[1] === 'spell') this.pickSlot(n);
      else if (numbered[1] === 'target') this.pickTarget(n);
      else this.pickCaster(n);
    }
    return 'stay';
  }
}
