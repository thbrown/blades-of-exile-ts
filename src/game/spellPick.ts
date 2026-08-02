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
import { CastStatus, pcCanCastSpell, pcCanCastType } from './spellCast';
import type { GameSession } from './session';
import { Skill } from '../universe/skills';

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
    this.caster = session.univ.curPc;
    // pick_spell keeps the current caster if they can cast, and otherwise
    // walks the party for the first who can.
    if (canChooseCaster
      && pcCanCastType(session, session.univ.party.pcs[this.caster]!, type) !== CastStatus.OK) {
      const found = session.univ.party.pcs.findIndex(
        (pc) => pcCanCastType(session, pc, type) === CastStatus.OK);
      if (found >= 0) this.caster = found;
    }
  }

  get choice(): CastChoice {
    return { spell: this.spell, caster: this.caster, target: this.target };
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
    if (id === 'cancel') return 'cancel';
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
