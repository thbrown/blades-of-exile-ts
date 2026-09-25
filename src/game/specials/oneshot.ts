/**
 * The ONCE opcode group — oneshot_spec (boe.specials.cpp:2571).
 *
 * These are the nodes that fire exactly once. The mechanism is a convention
 * rather than a flag: the node names an SDF, refuses to run when it already
 * holds **250**, and writes 250 on the way out. A node that couldn't complete
 * (the party had no room for the item, the player walked away) deliberately
 * skips that write so it can be tried again.
 */

import { SpecType } from '../../data/special';
import { Universe } from '../../universe/universe';
import { GiveStatus, combineThings, giveItem, sortItems } from '../../universe/inventory';
import { printResult } from '../../universe/living';
import { ItemType } from '../../data/item';
import { MainStatus } from '../../universe/skills';
import { ChoiceButton, SpecCtxType, SpecialCtx } from './context';
import { SpecialsEngine, handleMessage } from './vm';
import { reportUnsupported } from './general';
import { isCombat } from '../modes';
import { Skill } from '../../universe/skills';
import { TrapType, runTrap } from '../trap';
import { activateMonsters } from '../monsterPlace';
import { placeOutdWandMonst } from '../wandering';
import { SelectPcMode, runSelectPc } from '../selectPc';

/** The sentinel meaning "this one-shot has fired". */
export const ONCE_DONE = 250;

/** basic_buttons (basicbtns.cpp:18) — a node names its buttons by index. */
export const BASIC_BUTTONS = [
  'Done', 'OK', 'Yes', 'No', 'Ask', 'Keep', 'Cancel', 'Buy', 'Enter', 'Leave',
  'Get', '1', '2', '3', '4', '5', '6', 'Cast', 'Save', 'Take',
  'Stay', 'Steal', 'Attack', 'Step In', 'Climb', 'Flee', 'Onward', 'Answer', 'Drink', 'Approach',
  'Land', 'Under', 'Quit', 'Rest', 'Read', 'Pull', 'Push', 'Pray', 'Wait', 'Give',
  'Destroy', 'Pay', 'Free', 'Touch', 'Burn', 'Insert', 'Remove', 'Accept', 'Refuse', 'Open',
  'Close', 'Sit', 'Stand', 'Left', 'Right', 'Up', 'Down', 'Sell', 'Identify', 'Enchant',
  'Train', 'Heal Party', 'Bash Door', 'Pick Lock', 'Record', 'Climb', 'Restore', 'Restart',
  'Create', 'Choose', 'Go Back',
];

/**
 * The keyboard shortcuts `basic_buttons` attaches to the ones that have them
 * (basicbtns.cpp:18). Done and OK take Enter and Cancel takes Escape, both of
 * which the generic dialog already handles, so only the letters are listed.
 */
export const BASIC_BUTTON_KEYS: Record<string, string> = {
  Yes: 'y', No: 'n', Keep: 'k', Get: 'g',
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
};

function buttonLabel(index: number): string {
  return BASIC_BUTTONS[index] ?? 'OK';
}

/**
 * The buttons of the stock dialog *files* a special node can raise
 * (`cChoiceDlog("basic-portal", …)` and friends).
 *
 * These are the only choice dialogs whose control names are not `btnN`: they
 * come from the XML, and the C++ compares the clicked name against them
 * directly. Order here is the order the XML draws them in, because the index
 * this port's `choice` hands back is a position in this array.
 */
export const XML_BUTTONS: Record<string, ChoiceButton[]> = {
  'basic-trap': [
    { name: 'no', label: 'No', key: 'n' }, { name: 'yes', label: 'Yes', key: 'y' }],
  'basic-portal': [
    { name: 'no', label: 'No', key: 'n' }, { name: 'yes', label: 'Yes', key: 'y' }],
  'basic-button': [
    { name: 'no', label: 'No', key: 'n' }, { name: 'yes', label: 'Yes', key: 'y' }],
  'basic-lever': [{ name: 'leave', label: 'Leave' }, { name: 'pull', label: 'Pull' }],
  // The eight `stairDlogs` (boe.specials.cpp:3815) all carry the same pair.
  stairway: [{ name: 'leave', label: 'Leave' }, { name: 'climb', label: 'Climb' }],
};

/**
 * `cThreeChoice`'s buttons, from up to three `basic_buttons` slots.
 *
 * **The names go by slot, not by drawing order** — `init_buttons`
 * (3choice.cpp:98) writes `btn` + (i + 1) for slot `i`, and skips the empty
 * slots without renumbering — so a node whose first slot is -1 still calls its
 * second button `btn2`. That is the id a recording clicks, which is why the
 * empties have to be counted here rather than filtered out first.
 */
export function threeChoiceButtons(slots: readonly number[]): ChoiceButton[] {
  const out: ChoiceButton[] = [];
  slots.forEach((slot, i) => {
    if (slot < 0) return;
    const label = buttonLabel(slot);
    out.push({ name: `btn${i + 1}`, label, key: BASIC_BUTTON_KEYS[label] });
  });
  return out;
}

/** univ.get_strs(strs[6], ...) — a message and up to five continuations. */
function messageRun(univ: Universe, ctx: SpecialCtx, first: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const str = univ.getStr(ctx.curSpecType, first + i);
    if (str === null) break;
    out.push(str);
  }
  return out;
}

/**
 * `cParty::forced_give` (party.cpp:596) — the item goes into the **first empty
 * slot of the first living PC**, whatever it weighs. Nothing is refused for
 * weight and nothing is said when nobody has room; on success it prints
 * "  Name gets Item." and tidies the pack (`combine_things`, `sort_items`).
 *
 * Kept as written: the loop is over `pc.items`, which includes the scratch
 * slot `give_item` uses for pre-stacking, so a PC with a full pack can still
 * take one this way, into that slot.
 */
export function forcedGive(univ: Universe, itemIndex: number): boolean {
  const item = univ.scenario.scenItems[itemIndex];
  if (!item) return false;
  for (const pc of univ.party.pcs) {
    for (let i = 0; i < pc.items.length; i++) {
      if (pc.mainStatus !== MainStatus.ALIVE || pc.items[i]!.variety !== ItemType.NO_ITEM) continue;
      pc.items[i] = { ...item };
      printResult(`  ${pc.name} gets ${item.ident ? item.fullName : item.name}.`);
      combineThings(pc);
      sortItems(pc);
      return true;
    }
  }
  return false;
}

/**
 * `cParty::give_item(item, true)` (party.cpp:586) — each PC in turn tries an
 * ordinary give, weight and all. ONCE_GIVE_ITEM_DIALOG's "Take" uses this one.
 */
function partyGiveItem(univ: Universe, itemIndex: number): boolean {
  const item = univ.scenario.scenItems[itemIndex];
  if (!item) return false;
  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    const result = giveItem(pc, univ.party, { ...item });
    if (result.status === GiveStatus.OK) {
      if (result.message) univ.addStringToBuf(result.message);
      return true;
    }
  }
  univ.addStringToBuf('  Your party can\'t carry any more.');
  return false;
}

export async function oneshotSpec(
  univ: Universe, ctx: SpecialCtx, engine: SpecialsEngine,
): Promise<void> {
  const spec = ctx.curSpec;
  const { party } = univ;
  let checkMess = true;
  let setSd = true;
  ctx.nextSpec = spec.jumpto;

  // Already fired: stop the chain dead.
  if (party.sdLegit(spec.sd1, spec.sd2) && party.getSdf(spec.sd1, spec.sd2) === ONCE_DONE) {
    ctx.nextSpec = -1;
    return;
  }

  switch (spec.type) {
    case SpecType.ONCE_GIVE_ITEM:
      if (spec.ex1a >= 0 && spec.ex1a < univ.scenario.scenItems.length
        && !forcedGive(univ, spec.ex1a)) {
        // Couldn't take it — leave the flag unset so it's still here later.
        setSd = false;
        if (spec.ex2b >= 0) ctx.nextSpec = spec.ex2b;
      } else {
        if (spec.ex1b > 0) {
          party.gold += spec.ex1b;
          univ.addStringToBuf(`  You get ${spec.ex1b} gold.`);
        }
        if (spec.ex2a > 0) {
          party.food += spec.ex2a;
          univ.addStringToBuf(`  You get ${spec.ex2a} food.`);
        }
      }
      break;

    case SpecType.ONCE_GIVE_SPEC_ITEM:
      if (spec.ex1a < 0 || spec.ex1a > 49) {
        univ.addStringToBuf('Special item is out of range.');
        setSd = false;
      } else if (spec.ex1b === 0) party.specItems.add(spec.ex1a);
      else party.specItems.delete(spec.ex1a);
      ctx.redraw = true;
      break;

    case SpecType.ONCE_NULL:
      setSd = false;
      checkMess = false;
      break;

    case SpecType.ONCE_SET_SDF:
      // The flag write at the bottom is the whole point of this one.
      checkMess = false;
      break;

    case SpecType.ONCE_DISPLAY_MSG:
      break;

    case SpecType.ONCE_DIALOG: {
      checkMess = false;
      if (spec.m1 < 0) break;
      const strs = messageRun(univ, ctx, spec.m1);
      // m3 > 0 gives a first button; it's OK normally, but becomes Leave as
      // soon as either of the other two buttons is defined.
      const buttons: number[] = [];
      if (spec.m3 > 0) buttons.push(spec.ex1a >= 0 || spec.ex2a >= 0 ? 9 : 1);
      else buttons.push(-1);
      buttons.push(spec.ex1a, spec.ex2a);
      const drawn = threeChoiceButtons(buttons);
      if (drawn.length === 0) break;
      const picked = await ctx.host.choice(strs, drawn, '', spec.pic, spec.pictype);
      // The index the host gives back counts only the buttons it drew, so map
      // it back to the node's 1-based slot numbering.
      const slot = buttons.reduce<number[]>((acc, b, i) => {
        if (b >= 0) acc.push(i + 1);
        return acc;
      }, [])[picked] ?? -1;
      if (slot < 0) break;
      if (spec.m3 > 0) {
        // Leaving via the first button doesn't count as having done it.
        if (slot === 1 && (spec.ex1a >= 0 || spec.ex2a >= 0)) setSd = false;
      }
      if (slot === 2) ctx.nextSpec = spec.ex1b;
      if (slot === 3) ctx.nextSpec = spec.ex2b;
      break;
    }

    case SpecType.ONCE_GIVE_ITEM_DIALOG: {
      checkMess = false;
      if (spec.m1 < 0) break;
      const strs = messageRun(univ, ctx, spec.m1);
      // Always the same pair of `basic_buttons` slots: 9 Leave, 19 Take.
      const picked = await ctx.host.choice(
        strs, threeChoiceButtons([9, 19, -1]), '', spec.pic, spec.pictype);
      if (picked === 0) {
        setSd = false;
        ctx.nextSpec = -1;
        break;
      }
      if (spec.ex1a >= 0 && !partyGiveItem(univ, spec.ex1a)) {
        setSd = false;
        ctx.nextSpec = -1;
        break;
      }
      if (spec.ex1b > 0) {
        party.gold += spec.ex1b;
        univ.addStringToBuf(`  You get ${spec.ex1b} gold.`);
      }
      if (spec.ex2a > 0) {
        party.food += spec.ex2a;
        univ.addStringToBuf(`  You get ${spec.ex2a} food.`);
      }
      if (spec.m3 >= 0 && spec.m3 < 50) {
        if (!party.specItems.has(spec.m3)) univ.addStringToBuf('You get a special item.');
        party.specItems.add(spec.m3);
        ctx.redraw = true;
      }
      if (spec.ex2b >= 0) ctx.nextSpec = spec.ex2b;
      break;
    }

    case SpecType.ONCE_TOWN_ENCOUNTER:
      activateMonsters(univ, spec.ex1a);
      break;

    case SpecType.ONCE_OUT_ENCOUNTER:
      // One of the sector's four `special_enc` groups, dropped on the world map
      // near the party. `forced` is true here, which is what lets it use the
      // last creature slot even when the other nine are taken.
      if (spec.ex1a < 0 || spec.ex1a > 3) {
        univ.addStringToBuf('Special outdoor enc. is out of range. Must be 0-3.');
        setSd = false;
      } else {
        const group = univ.out.sector.specialEnc[spec.ex1a];
        if (group) {
          placeOutdWandMonst(
            ctx.session, univ.party.globalToLocal(univ.party.outLoc), group, 1);
        }
      }
      break;

    case SpecType.ONCE_TRAP: {
      checkMess = false;
      // "You've found a trap. Do you want to try to disarm it?" — a *choice*,
      // not a notice, and note the buttons are No first, Yes second.
      let refused: boolean;
      if (spec.m1 >= 0 || spec.m2 >= 0) {
        // The *pair* overload of get_strs, not the six-string run
        // (boe.specials.cpp:2685): exactly m1 and m2. Reading a run here pulled
        // in whatever five strings happened to follow m1 in the town's list,
        // so the commander's chest asked about leaving the scenario.
        const strs = univ.getStrs(ctx.curSpecType, spec.m1, spec.m2)
          .filter((s) => s !== '');
        refused = await ctx.host.choice(
          strs, threeChoiceButtons([3, 2, -1]), '', spec.pic, spec.pictype) === 0;
      } else {
        // basic-trap.xml: the stock question, with its own picture (dlog 27)
        // and Yes/No the other way round from the custom-message branch.
        refused = await ctx.host.choice(
          ["You think you've found a trap.\nDo you try to disarm it?"],
          XML_BUTTONS['basic-trap']!, '', 27, 0, 'basic-trap') === 0;
      }
      if (refused) {
        // Walking away leaves the one-shot flag unset, so the trap is still
        // there next time. This is what made the node fire only once.
        setSd = false;
        ctx.nextSpec = -1;
        ctx.retA = 1;
        break;
      }
      let who = univ.curPc;
      if (!isCombat(ctx.session.mode)) {
        who = await runSelectPc(
          univ, SelectPcMode.ONLY_LIVING, 'Trap! Who will disarm?',
          (options, title, highlight) => ctx.host.selectPc(options, title, highlight),
          { highlight: Skill.DISARM_TRAPS });
        if (who < 0 || who >= 6) {
          ctx.retA = 1;
          setSd = false;
          break;
        }
      }
      const disarmed = await runTrap(ctx.session, who, spec.ex1a as TrapType, spec.ex1b, spec.ex2a);
      // A custom trap that went off hands over to the scenario's own chain.
      if (!disarmed && spec.ex1a === TrapType.CUSTOM) {
        if (spec.jumpto >= 0)
          engine.queueSpecial(ctx.whichMode, ctx.curSpecType, spec.jumpto,
            { x: party.getPtr(10), y: party.getPtr(11) });
        ctx.nextSpec = spec.ex2b;
        ctx.nextSpecType = SpecCtxType.SCEN;
      }
      break;
    }

    default:
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
  // Mark it done — unless the node bailed out and wants another chance.
  if (setSd && party.sdLegit(spec.sd1, spec.sd2))
    party.setSdf(spec.sd1, spec.sd2, ONCE_DONE);
}
