/**
 * `create_pc` (boe.party.cpp:249) — adding a character to the party, which is
 * four dialogs in a row: race and traits, then the skill-point spend, then a
 * portrait, then a name.
 *
 * The rules live here and the caller drives them by **control name**, the same
 * shape `spellPick.ts` uses: the C++'s dialogs are event filters over named
 * controls, a recording replays those names, and a UI hit-tests rectangles and
 * calls the same methods. That keeps the one copy of the rules honest against
 * both.
 *
 * ```
 * create_pc(spot)
 *   party.new_pc(spot)      → a blank cPlayer, ALIVE
 *   pick_race_abil(pc, 0)   → race + 10 advantages + 7 disadvantages
 *   spend_xp(spot, 0)       → the skill grid; false here abandons the PC
 *   pick_pc_graphic(spot,0) → cPictChoice over PC pictures 0-36
 *   pick_pc_name(spot)      → a text field
 *   finish_create()         → racial adjustments and the two start items
 * ```
 *
 * TODO(M8): the player-facing screens. Nothing but the replay driver reaches
 * this yet, so the game still has no way to add a PC by hand.
 */

import { skillNames } from '../data/enumTags';
import { SKILL_GOLD_COST, SKILL_MAX } from '../data/shop';
import { SKILL_POINT_COST } from './training';
import { Player } from '../universe/player';
import { MainStatus, Race, Skill, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';

/** `spend_xp`'s mode argument (pc.editors.cpp:641). */
export enum XpMode {
  /** Creating a new character: skill points, no gold. */
  CREATE = 0,
  /** Training: both. */
  TRAIN = 1,
  /** The character editor: neither. */
  EDIT = 2,
}

/**
 * `cParty::new_pc` (party.cpp:351) — a blank `cPlayer`, made ALIVE.
 *
 * **The three stats start at 1, not 0** (pc.cpp:1011). This port's `Player`
 * fields start every skill at zero, which is right for a slot that is about to
 * be overwritten by a preset or a save and wrong for the one place that reads
 * the defaults.
 */
export function newPc(univ: Universe, spot: number): Player {
  const pc = new Player();
  pc.skills[Skill.STRENGTH] = 1;
  pc.skills[Skill.DEXTERITY] = 1;
  pc.skills[Skill.INTELLIGENCE] = 1;
  pc.mainStatus = MainStatus.ALIVE;
  pc.uniqueId = univ.party.nextPcId++;
  pc.party = univ.party;
  univ.party.pcs[spot] = pc;
  return pc;
}

/**
 * `pick_race_abil` in mode 0 (pc.editors.cpp:247) — the race LED group and the
 * seventeen trait LEDs, all toggles, with `done` keeping and `cancel`
 * discarding.
 *
 * The traits are one array in the C++ too: `good1`-`good10` are `eTrait` 0-9
 * and `bad1`-`bad7` are 10-16, which is why `pick_race_select_led` computes
 * `hit + 10` for the second group.
 */
export class RaceAbilPick {
  race: Race;
  traits: boolean[];

  constructor(private readonly pc: Player) {
    this.race = pc.race;
    this.traits = [...pc.traits];
  }

  /** A click by control name. Returns whether the dialog stays open. */
  click(id: string): 'stay' | 'done' | 'cancel' {
    if (id === 'done') return 'done';
    if (id === 'cancel') return 'cancel';
    // `race` arrives as the group name; the recording carries the LED it
    // selected, so both spellings are accepted.
    const race = /^race([1-4])$/.exec(id);
    if (race) {
      this.race = (Number(race[1]) - 1) as Race;
      return 'stay';
    }
    const good = /^good(\d+)$/.exec(id);
    if (good) {
      const i = Number(good[1]) - 1;
      if (i >= 0 && i < 10) this.traits[i] = !this.traits[i];
      return 'stay';
    }
    const bad = /^bad([1-7])$/.exec(id);
    if (bad) {
      const i = Number(bad[1]) - 1 + 10;
      this.traits[i] = !this.traits[i];
    }
    return 'stay';
  }

  /** `keep_race_traits` (pc.editors.cpp:196). */
  keep(): void {
    this.pc.race = this.race;
    for (let i = 0; i < this.traits.length; i++) this.pc.traits[i] = this.traits[i] ?? false;
  }
}

/** `get_skill_max` (pc.editors.cpp:339) — health and spell points have their own. */
export function xpSkillMax(skill: Skill): number {
  if (skill === Skill.MAX_HP) return 250;
  if (skill === Skill.MAX_SP) return 150;
  return SKILL_MAX[skill] ?? 0;
}

/**
 * `xp_dlog_state` + `spend_xp_event_filter` (pc.editors.cpp:333) — the skill
 * grid, held as the C++ holds it: a working copy that only `keep` commits.
 *
 * `training.ts` covers the same dialog in mode 1 for the shop and predates
 * this; the two agree on the numbers because both read `SKILL_POINT_COST` and
 * `SKILL_GOLD_COST`. TODO(M8): fold the shop's onto this one, which is the
 * faithful shape (per-row `can_change_skill` rather than a caller-side cap).
 */
export class SpendXp {
  skills: number[];
  hp: number;
  sp: number;
  /** Gold. In CREATE mode the C++ hands the dialog a flat 20,000 it never spends. */
  gold: number;
  skp: number;
  startSkp: number;

  constructor(
    private readonly univ: Universe,
    readonly who: number,
    readonly mode: XpMode,
  ) {
    const pc = univ.party.pcs[who]!;
    this.skills = [...pc.skills];
    this.hp = pc.maxHealth;
    this.sp = pc.maxSp;
    this.gold = mode === XpMode.CREATE ? 20000 : univ.party.gold;
    this.skp = pc.skillPts;
    this.startSkp = this.skp;
  }

  private cur(skill: Skill): number {
    if (skill === Skill.MAX_HP) return this.hp;
    if (skill === Skill.MAX_SP) return this.sp;
    return this.skills[skill] ?? 0;
  }

  private orig(skill: Skill): number {
    const pc = this.univ.party.pcs[this.who]!;
    if (skill === Skill.MAX_HP) return pc.maxHealth;
    if (skill === Skill.MAX_SP) return pc.maxSp;
    return pc.skills[skill] ?? 0;
  }

  /** Skill points a step costs. Health and spell points are one point each. */
  private cost(skill: Skill): number {
    if (skill === Skill.MAX_HP || skill === Skill.MAX_SP) return 1;
    return SKILL_POINT_COST[skill] ?? 0;
  }

  private goldCost(skill: Skill): number {
    if (skill === Skill.MAX_HP) return 10;
    if (skill === Skill.MAX_SP) return 15;
    return SKILL_GOLD_COST[skill] ?? 0;
  }

  /** How much one step moves the number: health goes two at a time. */
  private step(skill: Skill): number {
    return skill === Skill.MAX_HP ? 2 : 1;
  }

  /** `can_change_skill` (pc.editors.cpp:350). */
  canChange(skill: Skill, increase: boolean): boolean {
    const max = xpSkillMax(skill);
    let min = 0;
    if (skill === Skill.MAX_HP) min = 6;
    else if (skill === Skill.STRENGTH || skill === Skill.DEXTERITY
      || skill === Skill.INTELLIGENCE) min = 1;
    const cur = this.cur(skill);
    if (increase) {
      if (cur === max) return false;
      if (this.mode < XpMode.EDIT && this.skp < this.cost(skill)) return false;
      if (this.mode === XpMode.TRAIN && this.gold < this.goldCost(skill)) return false;
      return true;
    }
    if (cur === min) return false;
    // **Training cannot sell back a level the PC walked in with**, which is
    // what makes a trainer different from the editor.
    if (this.mode === XpMode.TRAIN && cur === this.orig(skill)) return false;
    return true;
  }

  /**
   * A click by control name: `str-p`, `str-m`, `hp-p`, `sp-m`, `keep`,
   * `cancel`, `left`, `right`, `help`.
   *
   * `alt` is the C++'s `mod_alt`, which opens the skill's description instead
   * of changing it — a dialog of its own, which is why it is reported rather
   * than swallowed.
   */
  click(id: string, alt = false): 'stay' | 'keep' | 'cancel' | 'info' {
    if (id === 'keep') return 'keep';
    if (id === 'cancel') return 'cancel';
    // `help` and the two PC arrows: the arrows are hidden in CREATE mode
    // (`spend_xp` :657), and no other mode reaches this port yet.
    if (id === 'help' || id === 'left' || id === 'right') return 'stay';
    const m = /^(.+)-([pm])$/.exec(id);
    if (!m) return 'stay';
    const which = skillNames.indexOf(m[1] as (typeof skillNames)[number]);
    if (which < 0) return 'stay';
    if (alt) return 'info';
    const skill = which as Skill;
    const up = m[2] === 'p';
    if (!this.canChange(skill, up)) return 'stay';
    const delta = up ? this.step(skill) : -this.step(skill);
    if (skill === Skill.MAX_HP) this.hp += delta;
    else if (skill === Skill.MAX_SP) this.sp += delta;
    else this.skills[skill] = (this.skills[skill] ?? 0) + delta;
    if (this.mode < XpMode.EDIT) {
      this.skp += up ? -this.cost(skill) : this.cost(skill);
      if (this.mode === XpMode.TRAIN) {
        this.gold += up ? -this.goldCost(skill) : this.goldCost(skill);
      }
    }
    return 'stay';
  }

  /** `do_xp_keep` (pc.editors.cpp:305). */
  keep(): void {
    const pc = this.univ.party.pcs[this.who]!;
    for (let i = 0; i < 19; i++) pc.skills[i] = this.skills[i] ?? 0;
    pc.curHealth += this.hp - pc.maxHealth;
    pc.maxHealth = this.hp;
    pc.curSp += this.sp - pc.maxSp;
    pc.maxSp = this.sp;
    if (this.mode === XpMode.TRAIN) this.univ.party.gold = this.gold;
    pc.skillPts = this.skp;
    // The Anama curse, and it is a *training* rule: breaking the oath at
    // creation costs nothing.
    if (pc.traits[Trait.ANAMA] && (pc.skills[Skill.MAGE_SPELLS] ?? 0) > 0
      && this.mode === XpMode.TRAIN) {
      pc.skills[Skill.STRENGTH] = (pc.skills[Skill.STRENGTH] ?? 0) - 2;
      pc.skills[Skill.DEXTERITY] = (pc.skills[Skill.DEXTERITY] ?? 0) - 2;
      pc.skills[Skill.INTELLIGENCE] = (pc.skills[Skill.INTELLIGENCE] ?? 0) - 4;
      pc.skills[Skill.LUCK] = 0;
      pc.traits[Trait.ANAMA] = false;
    }
  }
}

/**
 * `cPictChoice` over PC pictures 0-36 (pictchoice.cpp:43), as `pick_pc_graphic`
 * builds it. Thirty-seven pictures and thirty-six to a page, so there are two
 * pages and the second holds one.
 */
export class PcGraphicPick {
  static readonly PER_PAGE = 36;
  static readonly COUNT = 37;
  page: number;
  cur: number;

  constructor(start: number) {
    this.cur = start < PcGraphicPick.COUNT ? start : 0;
    this.page = Math.trunc(this.cur / PcGraphicPick.PER_PAGE);
  }

  click(id: string): 'stay' | 'done' | 'cancel' {
    if (id === 'done') return 'done';
    // `pick_pc_graphic` hides Cancel in mode 0 — "the player has already put
    // time into stat selection, so they won't want to cancel and lose it".
    if (id === 'cancel') return 'cancel';
    if (id === 'left') {
      this.page = this.page === 0
        ? Math.trunc((PcGraphicPick.COUNT - 1) / PcGraphicPick.PER_PAGE) : this.page - 1;
      return 'stay';
    }
    if (id === 'right') {
      this.page = this.page === Math.trunc((PcGraphicPick.COUNT - 1) / PcGraphicPick.PER_PAGE)
        ? 0 : this.page + 1;
      return 'stay';
    }
    const led = /^led(\d+)$/.exec(id);
    if (led) this.cur = this.page * PcGraphicPick.PER_PAGE + Number(led[1]) - 1;
    // `group` is the LED group itself; the LED that took focus follows it.
    return 'stay';
  }
}

/**
 * `pc_name_event_filter` (boe.party.cpp:2424) — Okay only closes the dialog
 * when the name is usable, so a recording can click it and stay put.
 */
export function pcNameOk(name: string): boolean {
  if (name.length === 0) return false;
  return /^[A-Za-z]/.test(name);
}
