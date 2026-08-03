/**
 * The TOWN opcode group — townmode_spec (boe.specials.cpp:3814). Levers,
 * portals, stairs, terrain locks and creature manipulation: the nodes that
 * make a dungeon behave like a dungeon.
 *
 * Several of them refuse to work outside the right context — you can't take a
 * staircase mid-conversation, or teleport during combat — and when they refuse
 * during a move they also block the step.
 */

import { Attitude } from '../../data/monster';
import { SpecType } from '../../data/special';
import { TerSpec } from '../../data/terrain';
import { CreatureStatus } from '../../universe/creature';
import { Status } from '../../universe/skills';
import { Universe } from '../../universe/universe';
import { SpecCtx, SpecCtxType, SpecialCtx } from './context';
import { alterSpace, reportUnsupported } from './general';
import { setTownAttitude } from '../townAttitude';
import { placeMonster } from '../monsterPlace';
import { SELECT_PC_CANCEL, SelectPcMode, runSelectPc } from '../selectPc';
import { isCombat } from '../modes';
import { createWandMonst } from '../wandering';
import { handleMessage } from './vm';
import { XML_BUTTONS, threeChoiceButtons } from './oneshot';

/** The three contexts that mean "the party is walking somewhere". */
function isMoveMode(mode: SpecCtx): boolean {
  return mode === SpecCtx.OUT_MOVE || mode === SpecCtx.TOWN_MOVE || mode === SpecCtx.COMBAT_MOVE;
}

/** The contexts a lever can be pulled from. */
function isHandsOnMode(mode: SpecCtx): boolean {
  return isMoveMode(mode) || mode === SpecCtx.OUT_LOOK || mode === SpecCtx.TOWN_LOOK;
}

/** basic-portal / basic-button — the stock yes-or-no prompts. */
const PORTAL_PROMPT = 'You see a shimmering portal. Do you wish to enter it?';
const BUTTON_PROMPT = 'You see a button. Do you want to press it?';
const STAIR_PROMPTS = [
  'You see a staircase going down. Do you want to climb down it?',
  'You see a staircase going up. Do you want to climb up it?',
  'You see a passage leading downward. Do you want to enter it?',
  'You see a passage leading upward. Do you want to enter it?',
  'You see a hole in the ceiling. Do you want to climb up into it?',
  'You see a pit. Do you want to climb down into it?',
  'You see a slimy tunnel leading down. Do you want to enter it?',
  'You see a gate. Do you want to enter it?',
];

export async function townSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  const town = univ.town;
  let checkMess = true;
  ctx.nextSpec = spec.jumpto;

  /** The square this node names. */
  const at = { x: spec.ex1a, y: spec.ex1b };

  /** Refuse in the wrong context, blocking the step if we're mid-move. */
  const refuse = (why: string): void => {
    univ.addStringToBuf(why);
    if (isMoveMode(ctx.whichMode)) ctx.retA = 1;
    ctx.nextSpec = -1;
    checkMess = false;
  };

  switch (spec.type) {
    case SpecType.MAKE_TOWN_HOSTILE: {
      if (spec.ex2a < 0 || spec.ex2a > 3) {
        univ.addStringToBuf('Invalid attitude (0-3).');
        break;
      }
      // ex1a/ex1b are the slot range set_town_attitude works over; 0/-1 (the
      // default pair for "everyone") is what make_town_hostile passes.
      setTownAttitude(ctx.session, spec.ex1a, spec.ex1b, spec.ex2a as Attitude);
      ctx.redraw = true;
      break;
    }

    case SpecType.TOWN_MOVE_PARTY:
      ctx.retA = 1;
      teleportParty(univ, ctx, at);
      ctx.redraw = true;
      break;

    case SpecType.TOWN_RELOCATE:
      // Not a town move at all, despite the name and the group it sits in:
      // it is `position_party(ex1a, ex1b, ex2a, ex2b)` (boe.specials.cpp:4109),
      // which moves the party across the *outdoor* map — ex1a/ex1b are the
      // sector, ex2a/ex2b the square inside it. Nothing is redrawn and no
      // message is checked, because the party is standing in a town when this
      // runs; what it changes is where they come out.
      ctx.session.positionParty(spec.ex1a, spec.ex1b, spec.ex2a, spec.ex2b);
      break;

    case SpecType.TOWN_SET_CENTER:
      ctx.host.moveParty(at);
      ctx.redraw = true;
      break;

    case SpecType.TOWN_LOCK_SPACE:
    case SpecType.TOWN_UNLOCK_SPACE: {
      // Both flip the square to its counterpart type, if it's the right kind.
      const ter = town?.record.terrain[at.x]?.[at.y];
      if (ter === undefined) break;
      const info = univ.scenario.terTypes[ter];
      const wanted = spec.type === SpecType.TOWN_LOCK_SPACE
        ? TerSpec.LOCKABLE : TerSpec.UNLOCKABLE;
      if (info?.special === wanted) alterSpace(univ, at.x, at.y, info.flag1);
      ctx.redraw = true;
      break;
    }

    case SpecType.TOWN_CREATE_WANDERING:
      // The same roll the clock makes every turn, forced by a node
      // (boe.specials.cpp:3892): a wandering group appears at one of the town's
      // wandering points, or on the world map if the party is outdoors.
      createWandMonst(ctx.session);
      ctx.redraw = true;
      break;

    case SpecType.TOWN_PLACE_MONST:
      // ex2a is the monster; **ex2b is `forced`**, not an attitude — it lets
      // the creature land on a square something is already standing on
      // (boe.monster.cpp:1116).
      placeMonster(ctx.session, spec.ex2a, at, spec.ex2b > 0);
      ctx.redraw = true;
      break;

    case SpecType.TOWN_DESTROY_MONST: {
      if (spec.ex1a < 0 || spec.ex1b < 0) break;
      const monst = town?.monsterAt(at);
      if (monst) monst.active = CreatureStatus.DEAD;
      ctx.redraw = true;
      break;
    }

    case SpecType.TOWN_NUKE_MONSTS:
      // ex1a: a specific type, 0 for all, -1 friendly only, -2 hostile only.
      for (const monst of town?.monsters ?? []) {
        if (!monst.isAlive) continue;
        const match = monst.number === spec.ex1a || spec.ex1a === 0
          || (spec.ex1a === -1 && monst.isFriendly)
          || (spec.ex1a === -2 && !monst.isFriendly);
        if (match) monst.active = CreatureStatus.DEAD;
      }
      ctx.redraw = true;
      break;

    case SpecType.TOWN_SET_ATTITUDE: {
      // One creature only, named by its **slot** in ex1a with the attitude in
      // ex1b — despite the name, MAKE_TOWN_HOSTILE is the group version.
      const monsters = town?.monsters ?? [];
      if (spec.ex1a < 0 || spec.ex1a >= monsters.length) {
        univ.addStringToBuf(
          `Tried to change the attitude of nonexistent monster ${spec.ex1a} of 0...${monsters.length}`);
        break;
      }
      if (spec.ex1b < 0 || spec.ex1b > 3) {
        univ.addStringToBuf('Invalid attitude (0-3).');
        break;
      }
      monsters[spec.ex1a]!.attitude = spec.ex1b as Attitude;
      ctx.redraw = true;
      break;
    }

    case SpecType.TOWN_CHANGE_LIGHTING:
      if (town && spec.ex1a >= 0 && spec.ex1a <= 3) {
        town.record.lightingType = spec.ex1a;
        ctx.redraw = true;
      }
      break;

    case SpecType.TOWN_LIFT_FOG:
      // ex1a: 0 lifts the fog, anything else puts it back.
      if (town) {
        for (let x = 0; x < town.record.maxDim; x++)
          for (let y = 0; y < town.record.maxDim; y++)
            if (spec.ex1a === 0) town.makeExplored(x, y);
        ctx.redraw = true;
      }
      break;

    case SpecType.TOWN_GENERIC_LEVER:
      if (!isHandsOnMode(ctx.whichMode)) {
        refuse("Can't use lever now.");
        break;
      }
      // The lever's square transforms into whatever it turns into.
      if (await pullLever(univ, ctx)) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.TOWN_LEVER: {
      checkMess = false;
      if (spec.m1 < 0) break;
      if (!isHandsOnMode(ctx.whichMode)) {
        refuse("Can't use lever now.");
        break;
      }
      const strs = messageRun(univ, ctx, spec.m1);
      // `basic_buttons` slots 9 (Leave) and 35 (Pull), boe.specials.cpp:4015.
      const picked = await ctx.host.choice(
        strs, threeChoiceButtons([9, 35, -1]), '', spec.pic, spec.pictype);
      if (picked === 0) ctx.nextSpec = -1;
      else {
        transformSpace(univ, ctx);
        ctx.nextSpec = spec.ex1b;
      }
      break;
    }

    case SpecType.TOWN_GENERIC_PORTAL:
    case SpecType.TOWN_PORTAL: {
      checkMess = false;
      if (spec.type === SpecType.TOWN_PORTAL && spec.m1 < 0) break;
      if (ctx.whichMode !== SpecCtx.TOWN_MOVE && ctx.whichMode !== SpecCtx.TOWN_LOOK) {
        refuse("Can't teleport now.");
        break;
      }
      const strs = spec.type === SpecType.TOWN_PORTAL
        ? messageRun(univ, ctx, spec.m1) : [PORTAL_PROMPT];
      // Custom text gets `cThreeChoice` with slots 9 (Leave) and 8 (Enter);
      // the generic portal gets basic-portal.xml, whose buttons are No/Yes.
      const buttons = spec.type === SpecType.TOWN_PORTAL
        ? threeChoiceButtons([9, 8, -1]) : XML_BUTTONS['basic-portal']!;
      const picked = await ctx.host.choice(strs, buttons, '', spec.pic, spec.pictype);
      if (picked === 0) {
        ctx.nextSpec = -1;
        if (isMoveMode(ctx.whichMode)) ctx.retA = 1;
      } else {
        ctx.retA = 1;
        teleportParty(univ, ctx, at);
        ctx.redraw = true;
      }
      break;
    }

    case SpecType.TOWN_GENERIC_BUTTON: {
      const picked = await ctx.host.choice(
        [BUTTON_PROMPT], XML_BUTTONS['basic-button']!, '', spec.pic, spec.pictype);
      if (picked === 1) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.TOWN_GENERIC_STAIR:
    case SpecType.TOWN_STAIR: {
      checkMess = false;
      if (spec.type === SpecType.TOWN_STAIR && spec.m1 < 0 && spec.ex2b !== 1) break;
      // ex2c relaxes the context rules: 2 and 3 allow it outside a move.
      if (spec.ex2c !== 2 && spec.ex2c !== 3 && ctx.whichMode !== SpecCtx.TOWN_MOVE) {
        refuse("Can't change level now.");
        break;
      }
      let take = true;
      if (spec.ex2b !== 1) {
        const strs = spec.type === SpecType.TOWN_STAIR
          ? messageRun(univ, ctx, spec.m1)
          : [STAIR_PROMPTS[Math.max(0, Math.min(7, spec.ex2b))] ?? STAIR_PROMPTS[0]!];
        // TOWN_STAIR builds `cThreeChoice` from slots 20 (Stay) and 24
        // (Step In); the generic one loads one of the eight stairway dialogs,
        // whose pair is Leave/Climb. Either way index 1 is "go".
        const buttons = spec.type === SpecType.TOWN_STAIR
          ? threeChoiceButtons([20, 24, -1]) : XML_BUTTONS['stairway']!;
        take = (await ctx.host.choice(strs, buttons, '', spec.pic, spec.pictype)) === 1;
      }
      ctx.retA = 1;
      if (!take) {
        ctx.nextSpec = -1;
        break;
      }
      ctx.host.changeLevel(spec.ex2a, at);
      ctx.nextSpec = -1;
      break;
    }

    case SpecType.TOWN_PLACE_ITEM: {
      const item = univ.scenario.scenItems[spec.ex2a];
      if (item && town) {
        town.items.push({
          ...item,
          itemLoc: { ...at },
          // ex2b marks it as someone's property rather than free to take.
          property: spec.ex2b > 0,
        });
        ctx.redraw = true;
      }
      break;
    }

    case SpecType.TOWN_SPLIT_PARTY: {
      // Note what does *not* clear `checkMess`: reached from a conversation,
      // and a split that actually happened, both show the node's message. Only
      // the two refusals and a cancelled select-PC suppress it.
      if (ctx.whichMode === SpecCtx.TALK) break;
      if (isCombat(ctx.session.mode)) {
        refuse('Not while in combat.');
        break;
      }
      if (univ.party.isSplit()) {
        refuse('Party is already split.');
        break;
      }
      // Note the return slot is set **before** the dialog is answered, so
      // cancelling still blocks the step that triggered this.
      const who = await runSelectPc(
        univ, SelectPcMode.ONLY_LIVING, 'Which character goes?',
        (options, title, highlight) => ctx.host.selectPc(options, title, highlight));
      if (isMoveMode(ctx.whichMode)) ctx.retA = 1;
      if (who === SELECT_PC_CANCEL) {
        checkMess = false;
        break;
      }
      // An 8 — nobody could be offered — falls through here as a PC index and
      // `start_split` refuses it, which is how "Party already split!" gets
      // printed for a party with nobody alive. The C++'s test is `!= 6`.
      univ.curPc = who;
      ctx.nextSpec = -1;
      if (univ.party.startSplit(spec.ex1a, spec.ex1b, who)) ctx.host.sound(spec.ex2a);
      else univ.addStringToBuf('Party already split!');
      ctx.session.updateExplored(univ.party.townLoc);
      ctx.session.center = { ...univ.party.townLoc };
      ctx.redraw = true;
      break;
    }

    case SpecType.TOWN_REUNITE_PARTY:
      checkMess = false;
      if (isCombat(ctx.session.mode)) {
        univ.addStringToBuf('Not while in combat.');
        break;
      }
      if (isMoveMode(ctx.whichMode)) ctx.retA = 1;
      ctx.nextSpec = -1;
      // **The two messages are the wrong way round**, and it is the C++'s
      // doing: `end_split` returns true when it *did* something, so a
      // successful reunion says "Party already together!" and a node that
      // found nobody split says "You are reunited." Kept.
      if (univ.party.endSplit()) {
        univ.addStringToBuf('Party already together!');
        ctx.host.sound(spec.ex1a);
      } else univ.addStringToBuf('You are reunited.');
      // *Gotcha*: `if(spec.ex2a);` is an **empty statement** in the C++
      // (boe.specials.cpp:4159). Its comment says ex2a should bring the others
      // to the party rather than the reverse, and it does nothing whatever.
      if (spec.ex2a) break;
      if (univ.party.leftIn === -1 || univ.party.townNum === univ.party.leftIn) {
        univ.party.townLoc = { ...univ.party.leftAt };
        ctx.session.updateExplored(univ.party.townLoc);
        ctx.session.center = { ...univ.party.townLoc };
        for (const pc of univ.party.pcs) pc.status[Status.FORCECAGE] = 0;
      } else {
        ctx.host.changeLevel(univ.party.leftIn, univ.party.leftAt);
      }
      ctx.redraw = true;
      break;

    case SpecType.TOWN_TIMER_START:
      // Note there's no `checkMess` here, unlike its scenario-level twin — a
      // TOWN_TIMER_START node prints nothing. That asymmetry is the C++'s
      // (boe.specials.cpp:4170 against :2266).
      univ.party.startTimer(spec.ex1a, spec.ex1b, SpecCtxType.TOWN);
      break;

    default:
      // Combat effects, monster placement, spell patterns and party splitting
      // all wait on M5.
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}

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
 * teleport_party (boe.specials.cpp:1346), minus the explosion animation. Any
 * forcecage the party was in breaks.
 */
function teleportParty(univ: Universe, ctx: SpecialCtx, where: { x: number; y: number }): void {
  for (const pc of univ.party.pcs) pc.status[Status.FORCECAGE] = 0;
  ctx.host.moveParty(where);
}

/** handle_lever — the square becomes whatever it transforms into. */
async function pullLever(univ: Universe, ctx: SpecialCtx): Promise<boolean> {
  const picked = await ctx.host.choice(
    ['You see a lever. Do you want to pull it?'], XML_BUTTONS['basic-lever']!, '', -1, 0);
  if (picked !== 1) return false;
  transformSpace(univ, ctx);
  return true;
}

/** Turn the trigger square into its trans_to_what counterpart. */
function transformSpace(univ: Universe, ctx: SpecialCtx): void {
  const x = univ.party.getPtr(10);
  const y = univ.party.getPtr(11);
  const ter = univ.town?.record.terrain[x]?.[y];
  if (ter === undefined) return;
  const to = univ.scenario.terTypes[ter]?.transToWhat ?? -1;
  if (to >= 0) alterSpace(univ, x, y, to);
  ctx.redraw = true;
}
