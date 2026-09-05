/**
 * `select_pc` (boe.items.cpp:878) — "which party member?", and the eight modes
 * that decide who is allowed to answer.
 *
 * This port had a three-mode stand-in on `GameSession` (`'living' | 'lockpick'
 * | 'train'`) written when only those three callers existed. The give-item
 * action needs `ONLY_CAN_GIVE_FROM_ACTIVE`, which is where the invention showed:
 * it is the mode that knows an item can be *too heavy* for the PC you are
 * handing it to, and in combat that they have to be standing next to you. So the
 * whole enum is ported here, with the candidate loop's fallthroughs kept.
 *
 * **The dialog is not part of this.** The candidate list and the three return
 * codes are, because those are the game rules; drawing six buttons is the
 * caller's job — `main.ts` puts up a real dialog and the replay driver answers
 * from the recording, and both go through `runSelectPc` so they cannot disagree
 * about who was offered.
 */

import { Item } from '../data/item';
import { GiveStatus, giveItem } from '../universe/inventory';
import { ItemAbil, ItemType } from '../data/item';
import { MainStatus, Skill } from '../universe/skills';
import { Player } from '../universe/player';
import { Universe } from '../universe/universe';
import { hasAbil, hasAbilEquip } from '../universe/inventory';

/** `eSelectPC` (boe.items.hpp:39), verbatim and in order. */
export enum SelectPcMode {
  ANY,
  ONLY_LIVING,
  ONLY_LIVING_WITH_ITEM_SLOT,
  /**
   * Not just a free slot but the carrying capacity too, and it stacks charges
   * even when every slot is full. The C++ reads the item out of a global
   * (`item_store`) that the caller has to set first; here it is an argument.
   */
  ONLY_CAN_GIVE,
  /** The same, but in combat only *adjacent* living PCs are offered. */
  ONLY_CAN_GIVE_FROM_ACTIVE,
  ONLY_CAN_LOCKPICK,
  ONLY_CAN_TRAIN,
  ONLY_STONE,
  ONLY_DEAD,
}

/** One row of select-pc.xml: a name, why they can't, and whether they can. */
export interface PcChoice {
  index: number;
  /** The name, with the highlighted skill and the reason appended as the C++ does. */
  label: string;
  canPick: boolean;
  /** The reason on its own — "too far away", "no item slot", "no picks". */
  extra: string;
}

/** `select_pc`'s three non-PC return codes. */
export const SELECT_PC_CANCEL = 6;
export const SELECT_PC_ALL = 7;
/** Nobody could be offered, so the dialog never went up. */
export const SELECT_PC_NONE = 8;

export interface SelectPcOpts {
  /** The item being handed over, for the two `ONLY_CAN_GIVE*` modes. */
  item?: Item;
  /** A skill to show beside each name, the way "who will bash?" shows Strength. */
  highlight?: Skill;
  /** Whose turn it is — `univ.cur_pc`. Defaults to the universe's. */
  curPc?: number;
  /** Whether the game is in combat, which only `ONLY_CAN_GIVE_FROM_ACTIVE` reads. */
  inCombat?: boolean;
}

/** `cPlayer::has_space` — an empty slot in the pack. */
function hasSpace(pc: Player): boolean {
  return pc.items.some((item) => item.variety === ItemType.NO_ITEM);
}

function adjacent(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/**
 * The candidate loop, one row per party member.
 *
 * The C++'s switch leans on fallthrough in three places and on one `if(false)`
 * that exists purely to skip a line while still letting a `case` label land
 * inside it; each is spelled out here rather than reproduced, with the C++'s
 * shape noted where it isn't obvious.
 */
export function selectPcOptions(
  univ: Universe, mode: SelectPcMode, opts: SelectPcOpts = {},
): PcChoice[] {
  const curPc = opts.curPc ?? univ.curPc;
  return univ.party.pcs.map((pc, i) => {
    let canPick = true;
    let extra = '';
    if (pc.mainStatus === MainStatus.ABSENT || pc.mainStatus === MainStatus.FLED) {
      canPick = false;
    }
    // Note the `else`: a split PC is refused *without* the switch running, so
    // no reason is ever shown for one. Everyone else goes through the switch
    // even when the test above already said no.
    if (mode !== SelectPcMode.ANY && pc.mainStatus >= MainStatus.SPLIT) {
      canPick = false;
    } else {
      switch (mode) {
        case SelectPcMode.ONLY_CAN_GIVE_FROM_ACTIVE:
        case SelectPcMode.ONLY_CAN_GIVE: {
          if (mode === SelectPcMode.ONLY_CAN_GIVE_FROM_ACTIVE) {
            // You cannot hand something to yourself, and the row says nothing
            // about why — it simply isn't offered.
            if (i === curPc) { canPick = false; break; }
            const from = univ.party.pcs[curPc];
            if (opts.inCombat === true && pc.isAlive && from
              && !adjacent(from.combatPos, pc.combatPos)) {
              canPick = false;
              extra = 'too far away';
              break;
            }
          }
          // Falls through to ONLY_CAN_GIVE in the C++: can they take it?
          const item = opts.item;
          if (!item) break;
          const status = giveItem(pc, univ.party, item, true).status;
          if (status === GiveStatus.TOO_HEAVY) {
            extra = 'item too heavy';
            canPick = false;
          } else if (status === GiveStatus.NO_SPACE) {
            extra = 'no item slot';
            canPick = false;
          } else if (status === GiveStatus.DEAD) {
            // "Extra info not really needed, and kind of silly to print."
            extra = '';
            canPick = false;
          }
          break;
        }
        case SelectPcMode.ONLY_LIVING_WITH_ITEM_SLOT:
          if (!hasSpace(pc)) {
            canPick = false;
            extra = 'no item slot';
          }
          // The C++'s `if(false)` skips the training block and lands on the
          // ONLY_LIVING test below.
          if (pc.mainStatus !== MainStatus.ALIVE) { canPick = false; extra = ''; }
          break;
        case SelectPcMode.ONLY_CAN_TRAIN:
          if (pc.skillPts > 0) {
            extra = `${pc.skillPts} skill point${pc.skillPts > 1 ? 's' : ''}`;
          } else {
            extra = 'no skill points';
            canPick = false;
          }
          // Falls through to ONLY_LIVING.
          if (pc.mainStatus !== MainStatus.ALIVE) { canPick = false; extra = ''; }
          break;
        case SelectPcMode.ONLY_LIVING:
          if (pc.mainStatus !== MainStatus.ALIVE) { canPick = false; extra = ''; }
          break;
        case SelectPcMode.ONLY_STONE:
          if (pc.mainStatus !== MainStatus.STONE) { canPick = false; extra = ''; }
          break;
        case SelectPcMode.ONLY_DEAD:
          // Note this is "not alive", so stone and dust are offered too.
          if (pc.mainStatus === MainStatus.ALIVE) { canPick = false; extra = ''; }
          break;
        case SelectPcMode.ONLY_CAN_LOCKPICK: {
          if (pc.mainStatus !== MainStatus.ALIVE) { canPick = false; break; }
          // `has_abil` (boe.items.cpp:992), which also wants a charge left.
          const carried = hasAbil(pc, ItemAbil.LOCKPICKS);
          if (!carried) { canPick = false; extra = 'no picks'; break; }
          const equipped = hasAbilEquip(pc, ItemAbil.LOCKPICKS);
          if (!equipped) { canPick = false; extra = 'picks not equipped'; break; }
          const picks = equipped.item;
          extra = `${picks.ident ? picks.fullName : picks.name} x${picks.charges}`;
          break;
        }
        default:
          break;
      }
    }
    let label = pc.name;
    if (opts.highlight !== undefined) label += ` (${pc.skills[opts.highlight] ?? 0})`;
    if (extra) label += `: ${extra}`;
    return { index: i, label, canPick, extra };
  });
}

/**
 * The whole of `select_pc`: work out who can be offered, and only then put the
 * dialog up.
 *
 * **The early return matters to a replay.** With nobody to offer, the C++
 * returns 8 *without showing anything*, so there is no click in the recording
 * to answer it — a host that asked anyway would eat the next real action.
 */
export async function runSelectPc(
  univ: Universe,
  mode: SelectPcMode,
  title: string,
  ask: (options: PcChoice[], title: string, highlight?: Skill) => Promise<number>,
  opts: SelectPcOpts = {},
): Promise<number> {
  const options = selectPcOptions(univ, mode, opts);
  if (!options.some((o) => o.canPick)) {
    // Only these two say why; the rest leave it to the caller.
    if (mode === SelectPcMode.ONLY_CAN_LOCKPICK) {
      univ.addStringToBuf('  No one has lockpicks equipped.');
    } else if (mode === SelectPcMode.ONLY_CAN_TRAIN) {
      univ.addStringToBuf('  No one has skill points.');
    }
    return SELECT_PC_NONE;
  }
  return ask(options, title, opts.highlight);
}
