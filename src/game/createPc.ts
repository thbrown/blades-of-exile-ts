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
import { SKILL_GOLD_COST, SKILL_MAX, SKILL_POINT_COST } from '../data/shop';
import { giveHelp, livingSound } from '../universe/living';
import { PictChoiceState } from './pictChoice';
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
 * `xp_dlog_state` + `spend_xp_event_filter` (pc.editors.cpp:311) — the skill
 * grid, held as the C++ holds it: a working copy that only `keep` commits.
 * The same dialog serves creation (mode 0), the trainer (mode 1) and the
 * character editor (mode 2); the modes differ only in what a step costs and
 * whether a trainer will buy back a level.
 */
export class SpendXp {
  skills: number[] = [];
  hp = 0;
  sp = 0;
  /** Gold. In CREATE mode the C++ hands the dialog a flat 20,000 it never spends. */
  gold = 0;
  skp = 0;
  /** `start_skp` — what switching PCs compares against to ask "keep changes?". */
  startSkp = 0;
  /**
   * Set by a click on either mage-spell button of an Anama member who has no
   * mage spells yet, in training: the C++ puts its warning up *before* the
   * change (pc.editors.cpp:625), whichever way the click goes.
   */
  anamaWarning = false;

  constructor(
    private readonly univ: Universe,
    public who: number,
    readonly mode: XpMode,
  ) {
    this.reload(who);
  }

  /** The state half of `do_xp_draw` (pc.editors.cpp:448): read a PC afresh. */
  reload(who: number): void {
    this.who = who;
    const pc = this.univ.party.pcs[who]!;
    this.skills = [...pc.skills];
    this.hp = pc.maxHealth;
    this.sp = pc.maxSp;
    this.gold = this.mode === XpMode.CREATE ? 20000 : this.univ.party.gold;
    this.skp = pc.skillPts;
    this.startSkp = this.skp;
  }

  cur(skill: Skill): number {
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
  cost(skill: Skill): number {
    if (skill === Skill.MAX_HP || skill === Skill.MAX_SP) return 1;
    return SKILL_POINT_COST[skill] ?? 0;
  }

  goldCost(skill: Skill): number {
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
   * than swallowed. `left`/`right` are reported too: switching PCs may need
   * the "keep changes?" box, which is the caller's to show (see `switchPc`).
   *
   * A refused step says why the C++'s way: `give_help(25)` for too few skill
   * points, `give_help(24)` for too little gold, and otherwise sound 1.
   */
  click(id: string, alt = false): 'stay' | 'keep' | 'cancel' | 'info' | 'left' | 'right' {
    this.anamaWarning = false;
    if (id === 'keep') return 'keep';
    if (id === 'cancel') return 'cancel';
    if (id === 'left' || id === 'right') return id;
    if (id === 'help') return 'stay';
    const m = /^(.+)-([pm])$/.exec(id);
    if (!m) return 'stay';
    const which = skillNames.indexOf(m[1] as (typeof skillNames)[number]);
    if (which < 0) return 'stay';
    const skill = which as Skill;
    if (skill === Skill.MAGE_SPELLS && this.mode === XpMode.TRAIN
      && this.univ.party.pcs[this.who]!.traits[Trait.ANAMA]
      && (this.skills[Skill.MAGE_SPELLS] ?? 0) === 0) this.anamaWarning = true;
    if (alt) return 'info';
    const up = m[2] === 'p';
    if (!this.canChange(skill, up)) {
      if (up && this.mode < XpMode.EDIT && this.skp < this.cost(skill)) giveHelp(25, 0);
      else if (up && this.mode === XpMode.TRAIN && this.gold < this.goldCost(skill)) giveHelp(24, 0);
      else livingSound(1);
      return 'stay';
    }
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

  /** Whether switching away needs the "keep changes?" box (pc.editors.cpp:487). */
  get needsConfirm(): boolean {
    return this.skp !== this.startSkp;
  }

  /**
   * `spend_xp_navigate_filter`'s left/right, once any confirmation is over:
   * step to the previous or next *living* PC and read them afresh.
   */
  switchPc(dir: 'left' | 'right'): void {
    let who = this.who;
    do {
      who = dir === 'left' ? (who === 0 ? 5 : who - 1) : (who === 5 ? 0 : who + 1);
    } while (this.univ.party.pcs[who]!.mainStatus !== MainStatus.ALIVE);
    this.reload(who);
  }

  /** `do_xp_keep` (pc.editors.cpp:318). */
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
 *
 * `pick_pc_graphic` hides Cancel in mode 0 — "the player has already put time
 * into stat selection, so they won't want to cancel and lose it".
 */
export class PcGraphicPick extends PictChoiceState {
  static readonly COUNT = 37;

  constructor(start: number) {
    super(PcGraphicPick.COUNT, start);
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
