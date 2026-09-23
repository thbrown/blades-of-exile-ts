/**
 * The specials VM's shared vocabulary: what triggered a chain, where its nodes
 * live, and the runtime state threaded through every handler.
 *
 * Enum values are verbatim (special.hpp:121-155) because `.spec` files and save
 * files store them.
 */

import { isCombat } from '../modes';
import type { Universe } from '../../universe/universe';
import { Location, locsEqual } from '../../core/location';
import { SpecType, SpecialNode } from '../../data/special';
import type { GameSession } from '../session';
import type { Skill } from '../../universe/skills';
import type { PcChoice } from '../selectPc';
import type { EncNoteType } from '../../universe/party';

/** eSpecCtx (special.hpp:135) — what caused this chain to run. */
export enum SpecCtx {
  OUT_MOVE = 0, TOWN_MOVE, COMBAT_MOVE, OUT_LOOK, TOWN_LOOK,
  ENTER_TOWN, LEAVE_TOWN, TALK, USE_SPEC_ITEM, TOWN_TIMER,
  SCEN_TIMER, PARTY_TIMER, KILL_MONST, OUTDOOR_ENC, FLEE_ENCOUNTER,
  WIN_ENCOUNTER, TARGET, USE_SPACE, SEE_MONST, MONST_SPEC_ABIL,
  TOWN_HOSTILE, ATTACKING_MELEE, ATTACKING_RANGE, ATTACKED_MELEE, ATTACKED_RANGE,
  HAIL, SHOPPING, DROP_ITEM, STARTUP,
}

/** eSpecCtxType (special.hpp:121) — which list a node number indexes. */
export enum SpecCtxType {
  SCEN = 0,
  OUTDOOR = 1,
  TOWN = 2,
}

/** eSpecCat (special.hpp:152). */
export enum SpecCat {
  INVALID = -1,
  GENERAL, ONCE, AFFECT, IF_THEN, TOWN, RECT, OUTDOOR,
}

/**
 * Category ranges, from the CAT_* definitions in scenario/special-*.cpp. Each
 * category is a contiguous run of type numbers, so a range check is enough.
 */
const CATEGORY_RANGES: [SpecCat, SpecType, SpecType][] = [
  [SpecCat.GENERAL, SpecType.NONE, SpecType.STR_BUF_TO_SIGN],
  [SpecCat.ONCE, SpecType.ONCE_GIVE_ITEM, SpecType.ONCE_TRAP],
  [SpecCat.AFFECT, SpecType.SELECT_TARGET, SpecType.UNSTORE_PC],
  [SpecCat.IF_THEN, SpecType.IF_SDF, SpecType.IF_QUEST],
  [SpecCat.TOWN, SpecType.MAKE_TOWN_HOSTILE, SpecType.TOWN_PLACE_LABEL],
  [SpecCat.RECT, SpecType.RECT_PLACE_FIELD, SpecType.RECT_UNLOCK],
  [SpecCat.OUTDOOR, SpecType.OUT_MAKE_WANDER, SpecType.OUT_MOVE_PARTY],
];

export function categoryOf(type: SpecType): SpecCat {
  for (const [cat, first, last] of CATEGORY_RANGES)
    if (type >= first && type <= last) return cat;
  return SpecCat.INVALID;
}

/**
 * `cStringRecorder` (boe.infodlg.hpp:32) — what the Record button writes into
 * the party's encounter notes: the message's own strings, tagged with which
 * list they belong to and where the party was standing.
 */
export interface MessageRecord {
  type: EncNoteType;
  strs: string[];
  where: string;
}

/**
 * One button of a choice dialog.
 *
 * **`name` is the control's id and `label` is what it says**, and they are
 * rarely the same string. The two kinds of choice dialog name their controls
 * differently:
 *
 *   - `cChoiceDlog("basic-portal", …)` and friends load a dialog *file*, so the
 *     names are whatever its XML calls them — `yes`/`no`, `leave`/`climb`,
 *     `pull`/`leave`, `okay`/`cancel`.
 *   - `cThreeChoice` builds itself from up to three `basic_buttons` slots and
 *     names its controls **`btn1`, `btn2`, `btn3` by slot** (3choice.cpp:106) —
 *     by slot, not by drawing order, so a node that leaves the first slot empty
 *     still has its second button called `btn2`.
 */
export interface ChoiceButton {
  /** The dialog control's id. This is what a recording clicks. */
  name: string;
  /** What the button says. */
  label: string;
  /** The key that presses it, where `basic_buttons` attaches one. */
  key?: string;
}

/**
 * What the VM needs from the host to do anything visible. Everything here is
 * async because the C++ blocks on a dialog and we await one instead.
 */
export interface SpecialHost {
  /**
   * cStrDlog — two paragraphs, a title and a picture. `record` is the payload
   * behind the Record button: the C++ attaches a `cStringRecorder` to every
   * message a special node puts up, and the button only appears when there is
   * one to attach (strdlog.cpp:64).
   */
  message(
    str1: string, str2: string, title: string, pic: number, picType: number,
    record?: MessageRecord,
  ): Promise<void>;
  /**
   * A dialog with up to three buttons; resolves to the index of the one picked.
   *
   * Each button carries a **name as well as a label**, and the distinction is
   * not cosmetic: the name is the dialog control's id, which is what a replay
   * records and what the C++'s own code compares against
   * (`cChoiceDlog(…).show() == "climb"`). Passing labels alone meant every
   * recorded answer looked like a control this port had never drawn, and a
   * scripted stairway, portal, lever or trap failed its whole chain — the
   * single largest class of replay stops.
   */
  choice(
    strs: string[], buttons: ChoiceButton[], title: string, pic: number, picType: number,
  ): Promise<number>;
  /**
   * `story_dialog` (boe.items.cpp:611) — a title and a *range* of strings to
   * page through with Back and Next, on `many-str.xml`.
   */
  story(
    title: string, first: number, last: number,
    strType: SpecCtxType, pic: number, picType: number,
  ): Promise<void>;
  /** get_text_response — a typed answer, for IF_TEXT_RESPONSE. */
  askText(prompt: string): Promise<string>;
  /**
   * get_num_response (strchoice.cpp:323) — a number from `min` to `max`, for
   * IF_NUM_RESPONSE. The dialog itself refuses anything out of range and has
   * no Cancel, so what comes back is in range whenever `min < max`.
   */
  askNum(min: number, max: number, prompt: string): Promise<number>;
  /**
   * The select-PC dialog, given the rows `select_pc` has already worked out.
   *
   * **Only the dialog.** Which PCs may be picked is a game rule with eight
   * modes behind it, so it lives in `game/selectPc.ts` and every caller goes
   * through `runSelectPc` — that is also what keeps the "nobody can be offered"
   * case from raising a dialog the recording never saw. `highlight` is the
   * skill the rows show and mark the best value of.
   *
   * Answers with the PC index, or `select_pc`'s own 6 for cancel and 7 for
   * "all".
   */
  selectPc(options: PcChoice[], title: string, highlight?: Skill): Promise<number>;
  /**
   * `get_num_of_items` (boe.items.cpp:648) — "How many? (0-max)", for splitting
   * a stack of arrows or potions when giving or dropping one.
   */
  getNumOfItems(max: number): Promise<number>;
  /** start_shop_mode, for ENTER_SHOP. */
  startShop(which: number, costAdj: number, name: string): boolean;
  /** start_talk_mode, for START_TALK. */
  startTalk(monsterIndex: number, personality: number, monsterType: number, pic: number): void;
  /** play_sound; a negative number means "asynchronously" as in the C++. */
  sound(which: number): void;
  /** do_rest, for the REST node. */
  rest(length: number, hp: number, sp: number): void;
  /** Move the party, for the town/outdoor relocation nodes. */
  moveParty(where: Location): void;
  /** Change level, for TOWN_STAIR and friends. */
  changeLevel(town: number, where: Location): void;
  /**
   * `OUT_FORCE_TOWN`'s own transition (boe.specials.cpp:4609), which is **not**
   * `change_level`: it is a bare `force_town_enter` + `start_town_mode` with no
   * `end_town_mode` in front of it. The town being left is therefore *not*
   * written into the party's four-town memory, so walking back into it later
   * finds it rebuilt from presets with its dead on their feet again.
   * `entryDir` is 9 for a forced square and a compass entrance otherwise.
   */
  forceTown(town: number, entryDir: number, where: Location): void;
  /** The scenario is over. */
  endScenario(): void;
}

/** The `runtime_state` struct (boe.specials.cpp), plus the async host. */
export interface SpecialCtx {
  /** What triggered this chain. */
  whichMode: SpecCtx;
  /** The node about to run, or -1 to stop. */
  nextSpec: number;
  nextSpecType: SpecCtxType;
  curSpecType: SpecCtxType;
  /** The node currently running, with pointers already resolved. */
  curSpec: SpecialNode;
  /** Where the trigger happened. */
  specLoc: Location;
  /**
   * The two return slots. Their meaning depends on whichMode:
   * movement a=blocked, b=forced; look a=search blocked; talk a,b=strings;
   * encounter a=monsters flee, b=forced.
   */
  retA: number;
  retB: number;
  redraw: boolean;
  /**
   * SELECT_TARGET's choice, or null for "the default target". **Null is not
   * "the whole party"** — resolve it with `defaultTarget` below, which is
   * `current_pc_picked_in_spec_enc` (boe.specials.cpp:4726) fed through
   * `get_target_i` (universe.cpp:1122).
   */
  curTarget: number | null;
  host: SpecialHost;
  /**
   * The running game. The C++ reaches for the `univ` global plus a handful of
   * free functions (`set_town_attitude`, `start_town_combat`…); those live on
   * GameSession here, so a node that needs one gets at it through this.
   */
  session: GameSession;
}

/** A chain waiting for the current one to finish (special_queue). */
export interface PendingSpecial {
  spec: number;
  mode: SpecCtx;
  type: SpecCtxType;
  where: Location;
  triggerTime: number;
}

/** `get_target_i`'s value for "the whole party" (universe.cpp:1124). */
export const TARGET_PARTY = 6;

/**
 * `univ.target_there(where, …)` fed through `get_target_i` — a PC's index, a
 * creature's `100 + slot`, or null for an empty square. `monstOnly` is the
 * `TARG_MONST` argument the `TARGET`/`USE_SPACE`/`HAIL` modes pass.
 *
 * The PC half comes first in `target_there` (universe.cpp:1152), so a square
 * holding both answers with the PC unless `monstOnly` says otherwise.
 */
export function targetIndexAt(univ: Universe, where: Location, monstOnly: boolean): number | null {
  if (!monstOnly) {
    const pc = univ.party.pcs.findIndex(
      (p) => p.isAlive && locsEqual(p.getLoc(), where));
    if (pc >= 0) return pc;
  }
  const town = univ.town;
  if (!town) return null;
  const slot = town.monsters.findIndex(
    (m) => m.isAlive && where.x >= m.curLoc.x && where.x < m.curLoc.x + m.xWidth
      && where.y >= m.curLoc.y && where.y < m.curLoc.y + m.yWidth);
  return slot >= 0 ? 100 + slot : null;
}

/**
 * `get_target_i(current_pc_picked_in_spec_enc(ctx))` (boe.specials.cpp:4726,
 * universe.cpp:1122) — **which living thing a node acts on when
 * `SELECT_TARGET` has not picked one.**
 *
 * The default is not "the whole party", which is what this port assumed until
 * 2026-08-31. In combat it is the **active PC**, and with a split party it is
 * the one member still present. The difference is a whole `hit_party` against
 * a single `damage_pc`, so a `DAMAGE` node that fires mid-fight spends one
 * luck roll in the C++ and up to six here.
 *
 * **The creature half** (boe.specials.cpp:4768). Seven of the trigger modes do
 * not default to a PC at all: `KILL_MONST`, `SEE_MONST`, `MONST_SPEC_ABIL` and
 * the four melee/ranged triggers take whatever is standing on the trigger
 * square, and `TARGET`, `USE_SPACE` and `HAIL` take the **monster** there if
 * there is one. `get_target_i` numbers a creature `100 + slot`
 * (universe.cpp:1129), and nine of the AFFECT opcodes open with
 * `if(pc_num >= 100) break;` — so for those modes the usual answer is *do
 * nothing*, not *do it to everyone*.
 *
 * Falling through to the party instead is not a quiet difference: `AFFECT_XP`
 * on a monster target is silent in the C++ and, here, ran `award_xp` over the
 * whole party — which rolls.
 */
export function defaultTarget(
  univ: Universe, session: GameSession, mode?: SpecCtx, where?: Location,
): number {
  if (mode !== undefined && where !== undefined) {
    switch (mode) {
      case SpecCtx.KILL_MONST: case SpecCtx.SEE_MONST: case SpecCtx.MONST_SPEC_ABIL:
      case SpecCtx.ATTACKED_MELEE: case SpecCtx.ATTACKING_MELEE:
      case SpecCtx.ATTACKED_RANGE: case SpecCtx.ATTACKING_RANGE:
        // A legacy scenario always meant the party (boe.specials.cpp:4771).
        if (univ.scenario.isLegacy) return TARGET_PARTY;
        // "The monster/PC on the trigger space is the target" — either kind.
        return targetIndexAt(univ, where, false) ?? TARGET_PARTY;
      case SpecCtx.TARGET: case SpecCtx.USE_SPACE: case SpecCtx.HAIL:
        // A monster only; a PC standing there is not the target.
        return targetIndexAt(univ, where, true) ?? TARGET_PARTY;
      default:
        break;
    }
  }
  // "originally, it always defaulted to whole party" — hence the legacy flag.
  if (isCombat(session.mode) && !univ.scenario.isLegacy) return univ.curPc;
  if (!univ.party.isSplit()) return TARGET_PARTY;
  // `cParty::pc_present()` (party.cpp:1230): the single present member, or the
  // party when none or more than one is. Note the C++ exempts AFFECT_DEADNESS
  // from the split rule; that arm walks the party itself here either way.
  let found = -1;
  for (let i = 0; i < 6; i++) {
    if (!univ.party.pcPresent(i)) continue;
    if (found < 0) found = i;
    else return TARGET_PARTY;
  }
  return found < 0 ? TARGET_PARTY : found;
}
