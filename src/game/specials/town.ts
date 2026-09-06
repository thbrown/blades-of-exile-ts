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
import { drawTerrain } from '../textBar';
import type { GameSession } from '../session';
import { alterSpace, reportUnsupported } from './general';
import { setTownAttitude } from '../townAttitude';
import { placeMonster } from '../monsterPlace';
import { SELECT_PC_CANCEL, SelectPcMode, runSelectPc } from '../selectPc';
import { isCombat } from '../modes';
import { Spell } from '../../data/spell';
import { SpellPat } from '../../data/pattern';
import { startFancySpellTargeting, startSpellTargeting } from '../spellCombatTarget';
import { startTownTargeting } from '../spellTarget';
import { createWandMonst } from '../wandering';
import { handleMessage } from './vm';
import { XML_BUTTONS, threeChoiceButtons } from './oneshot';
import { boomSpace, runBoomAnim, startBoomAnim } from '../booms';
import { hitSpace } from '../processFields';
import { radiusDamage } from '../damage';
import { DamageType } from '../../data/monster';

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
/**
 * `stairDlogs` (boe.specials.cpp:3841) — the eight stairway dialogs
 * `TOWN_GENERIC_STAIR` picks between with `ex2b`, **in the C++'s order**, and
 * their text taken verbatim from the XML this port already ships in
 * `public/data/dialogs/`. What used to be here was eight invented strings in a
 * different order, so a scenario's "stairway heading up" read as "a pit".
 */
const STAIR_PROMPTS = [
  'You find a stairway heading up.',
  'You find a stairway heading down.',
  "The passageway you're walking down slopes sharply upward here.",
  "The passageway you're walking down slopes sharply downward here.",
  'You find a stairway heading up. The steps are covered with a thin layer of'
    + ' slick, unpleasant slime.',
  'You find a stairway heading down. You will have to be careful - the steps'
    + ' are covered with a thin layer of slick, unpleasant slime.',
  "The passageway you're walking down slopes upward into darkness.",
  "The passageway you're walking down slopes downward here, descending steeply"
    + ' into total darkness.',
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
      // `redraw` is set on both arms in the C++ (boe.specials.cpp:3884), which
      // is why it sits outside the refusal here.
      if (isCombat(ctx.session.mode)) refuse('Not while in combat.');
      else {
        ctx.retA = 1;
        teleportParty(univ, ctx, at,
          ctx.whichMode === SpecCtx.TALK || spec.ex2a === 0 ? 1 : 0);
      }
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

    /**
     * `TOWN_HIT_SPACE` (boe.specials.cpp:3910) and `TOWN_EXPLODE_SPACE`
     * (:3916) — one square, or a radius of them.
     *
     * Both refuse to fire from a conversation: a node reached through TALK has
     * no square to aim at (`l` is wherever the party last was), so blowing it
     * up mid-sentence would be arbitrary.
     *
     * `TOWN_EXPLODE_SPACE`'s radius is in **`spec.pic`**, not one of the extras
     * — the picture field standing in for a number, as it does for the jump on
     * `GIVE_ITEM`.
     */
    case SpecType.TOWN_HIT_SPACE:
      if (ctx.whichMode === SpecCtx.TALK) break;
      // **`l`, not `ex1a`/`ex1b`** — the square the node was *run at*, which
      // for a terrain special is the one the party stepped on. Most of the
      // opcodes around this one name their square in the extras; these two do
      // not, which is why they refuse to fire from a conversation.
      await hitSpace(
        ctx.session, ctx.specLoc, spec.ex2a, spec.ex2b as DamageType, 1, 1, univ.curPc);
      ctx.redraw = true;
      break;

    case SpecType.TOWN_EXPLODE_SPACE:
      if (ctx.whichMode === SpecCtx.TALK) break;
      await radiusDamage(
        ctx.session, ctx.specLoc, spec.pic, spec.ex2a, spec.ex2b as DamageType);
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
      // `fog_lifted = spec.ex1a` (boe.specials.cpp:4292) — an int assigned to a
      // `bool`, so **any non-zero value lifts it** and zero puts it back.
      //
      // It is a flag that lives for the rest of this action and is cleared at
      // the tail of `advance_time`; while it is up, `party_can_see` is just
      // "is it on screen". This port used to walk the town marking every square
      // **explored**, which is a different thing entirely — permanent, saved
      // with the game, and the opposite polarity — so a cutscene that showed
      // you one corner of a dungeon handed you the whole map for good.
      ctx.session.fogLifted = spec.ex1a !== 0;
      ctx.redraw = true;
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
      // **These two are one `case` here and two in the C++, and they differ on
      // the decline path.** Merging them gave the generic portal the custom
      // one's "No" behaviour, which blocks the move — see the branch below.
      const generic = spec.type === SpecType.TOWN_GENERIC_PORTAL;
      // `check_mess` is cleared unconditionally by `TOWN_PORTAL`
      // (boe.specials.cpp:4053) and only inside the two refusal branches by
      // `TOWN_GENERIC_PORTAL` (:3956) — and `refuse` below already clears it.
      if (!generic) checkMess = false;
      if (!generic && spec.m1 < 0) break;
      if (ctx.whichMode !== SpecCtx.TOWN_MOVE && ctx.whichMode !== SpecCtx.TOWN_LOOK) {
        refuse("Can't teleport now.");
        break;
      }
      const strs = generic ? [PORTAL_PROMPT] : messageRun(univ, ctx, spec.m1);
      // Custom text gets `cThreeChoice` with slots 9 (Leave) and 8 (Enter);
      // the generic portal gets basic-portal.xml, whose buttons are No/Yes.
      const buttons = generic
        ? XML_BUTTONS['basic-portal']! : threeChoiceButtons([9, 8, -1]);
      const picked = await ctx.host.choice(strs, buttons, '', spec.pic, spec.pictype);
      if (picked === 0) {
        // **Declining a *generic* portal does not stop the party stepping onto
        // the square, and does not end the chain.** `TOWN_GENERIC_PORTAL`'s
        // "No" arm touches neither `ret_a` nor `next_spec` — the C++ sets
        // `*ctx.ret_a = 1` only inside the "yes" branch (boe.specials.cpp:3972),
        // and the 1997 original is the same (`SPECIALS.CPP:2584`, `*a = 1`
        // under `FCD(870,0) == 2` alone). Only `TOWN_PORTAL`, the custom-text
        // variant, blocks on decline (:4073).
        //
        // Getting this wrong left the party one square short for the rest of
        // the run: `ZKR_15-05-2025_18-04-58` declines a portal at (11,33),
        // stayed on (11,34) here and stepped onto (11,33) there, so the
        // recording's next move was a real move on one side and a no-op on the
        // other — visible only as two missing `play_ambient_sound` draws at the
        // very end of a 1,033-action recording.
        if (!generic) {
          ctx.nextSpec = -1;
          if (isMoveMode(ctx.whichMode)) ctx.retA = 1;
        }
      } else {
        ctx.retA = 1;
        // The C++ writes `which_mode == TALK ? 1 : spec.ex2a` here
        // (boe.specials.cpp:3974), but the refusal above has already sent every
        // context but TOWN_MOVE and TOWN_LOOK away — the TALK arm is dead.
        teleportParty(univ, ctx, at, spec.ex2a);
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
      const townStair = spec.type === SpecType.TOWN_STAIR;
      if (townStair && spec.m1 < 0 && spec.ex2b !== 1) break;
      // `ex2c` 1 and 2 let a stair be taken *during* a fight; anything else
      // refuses (boe.specials.cpp:3983 and :4090).
      if (spec.ex2c !== 1 && spec.ex2c !== 2 && isCombat(ctx.session.mode)) {
        refuse("Can't change level in combat.");
        break;
      }
      // ex2c relaxes the context rules: 2 and 3 allow it outside a move.
      if (spec.ex2c !== 2 && spec.ex2c !== 3 && ctx.whichMode !== SpecCtx.TOWN_MOVE) {
        refuse("Can't change level now.");
        break;
      }
      // **The two node types skip the prompt on different tests**, and this
      // port used `ex2b != 1` for both. `TOWN_STAIR` does skip on
      // `ex2b == 1` (:4105, where `i` is forced to 2 — "go"), but
      // `TOWN_GENERIC_STAIR` asks unless **`ex2b >= 8`** (:3999), with a
      // negative clamped up to 0 first. So a generic stair with `ex2b == 1` —
      // "You find a stairway heading down." — was climbed here without a word,
      // and one with `ex2b >= 8` put up a dialog the recording never answered.
      let take = true;
      if (townStair) {
        if (spec.ex2b !== 1) {
          // `cThreeChoice` from slots 20 (Stay) and 24 (Step In); index 1 goes.
          take = (await ctx.host.choice(messageRun(univ, ctx, spec.m1),
            threeChoiceButtons([20, 24, -1]), '', spec.pic, spec.pictype)) === 1;
        }
      } else {
        const which = Math.max(0, spec.ex2b);
        if (which < 8) {
          // One of the eight stairway dialogs, whose pair is Leave/Climb —
          // index 1 is Climb.
          take = (await ctx.host.choice([STAIR_PROMPTS[which] ?? STAIR_PROMPTS[0]!],
            XML_BUTTONS['stairway']!, '', spec.pic, spec.pictype)) === 1;
        }
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

    /**
     * `TOWN_START_TARGETING` (boe.specials.cpp:4295) — **a node asking the
     * player to pick a square.** It arms the same targeting the spells use,
     * with `eSpell::NONE` in the air, and the click that lands runs the node
     * this one names.
     *
     * The three arms are the C++'s: out of combat it is *town* targeting,
     * whose `who_c` is the node to run (there is no caster); in combat a
     * `ex1c > 1` means **fancy**, that many squares, and anything else is a
     * single square.
     */
    case SpecType.TOWN_START_TARGETING: {
      ctx.nextSpec = -1;
      if (spec.ex1a < 0 || spec.ex1a > 7) {
        // TODO(M3): `showError` is a modal, which needs dialogxml. The text
        // goes to the message buffer meanwhile, so a broken scenario still
        // says why nothing happened.
        univ.addStringToBuf('  Error: Invalid spell pattern (0 - 7).');
        break;
      }
      if (spec.ex1c > 1 && !isCombat(ctx.session.mode)) {
        univ.addStringToBuf('  Target: Only in combat');
        break;
      }
      const pat = spec.ex1a as SpellPat;
      if (!isCombat(ctx.session.mode)) {
        startTownTargeting(ctx.session, Spell.NONE, spec.jumpto, true, pat);
      } else if (spec.ex1c > 1) {
        startFancySpellTargeting(ctx.session, Spell.NONE, true, 1, spec.ex1b, pat, spec.ex1c);
      } else {
        startSpellTargeting(ctx.session, Spell.NONE, true, 1, spec.ex1b, pat);
      }
      // `spell_caster = spec.jumpto` — for a node's targeting this is not a PC
      // at all but the node to run when the square is picked.
      ctx.session.spellCaster = spec.jumpto;
      ctx.session.specTargetType = ctx.curSpecType;
      ctx.session.specTargetFail = spec.ex2a;
      // `spec_target_options`: **units** are "may target an obstructed square",
      // **tens** are the antimagic rule — 1 refuses an antimagic square in town,
      // 2 is the combat arm's `allow_antimagic = false`, which is what it
      // already was, so that half of the C++ does nothing at all.
      //
      // The tens digit is `if(ex2c > 0) += 20; else if(ex2c == 0) += 10;` —
      // a *negative* `ex2c` adds neither, leaving the tens at 0 and turning
      // the town antimagic refusal off as well. Kept as written.
      ctx.session.specTargetOptions = (spec.ex2b > 0 ? 1 : 0)
        + (spec.ex2c > 0 ? 20 : spec.ex2c === 0 ? 10 : 0);
      break;
    }

    default:
      // What is left in this category, as of 2026-09-06: TOWN_RUN_MISSILE,
      // TOWN_MONST_ATTACK, TOWN_BOOM_SPACE, TOWN_SFX_BURST,
      // TOWN_SPELL_PAT_FIELD, TOWN_SPELL_PAT_BOOM and
      // TOWN_RELOCATE_CREATURE. The list is worth keeping honest — the same
      // sweep over `CATEGORY_RANGES` that produced it will produce the next
      // one.
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
 * teleport_party (boe.specials.cpp:1348). Any forcecage the party was in
 * breaks, and the party fades out of one square and in at the other.
 *
 * **The fade is nine explosions and then fourteen**, all on the party's square,
 * all `place_type = 1` so each is thrown up to 25px off it. That costs
 * 8 + 18 + 13 + 28 draws — `add_explosion`'s per-slot offset roll (the first
 * slot of a volley doesn't roll) and `do_explosion_anim`'s two scatter rolls
 * per queued boom — which is why leaving the animation out was not free.
 *
 * `mode` is the C++'s: 0 fades both ways, 2 only out, 3 only in, 1 neither,
 * and combat forces 1.
 */
function teleportParty(
  univ: Universe, ctx: SpecialCtx, where: { x: number; y: number }, mode: number,
): void {
  if (isCombat(ctx.session.mode)) mode = 1;
  const fadeOut = mode === 0 || mode === 2;
  const fadeIn = mode === 0 || mode === 3;

  for (const pc of univ.party.pcs) pc.status[Status.FORCECAGE] = 0;

  if (fadeOut) fade(ctx.session, univ, univ.party.townLoc, 9);
  ctx.host.moveParty(where);
  // The C++ runs the fade-in on `center`, which `teleport_party` has just set
  // to the destination — the same square the party now stands on.
  if (fadeIn) fade(ctx.session, univ, univ.party.townLoc, 14);
}

/** One half of `teleport_party`'s fade: `n` scattered explosions, played. */
function fade(
  session: GameSession, univ: Universe, at: { x: number; y: number }, n: number,
): void {
  startBoomAnim();
  // `add_explosion(l, -1, 1, 1, 0, 0)` — no damage number, scattered, boom
  // type 1.
  for (let i = 0; i < n; i++) {
    boomSpace({ x: at.x, y: at.y }, 1, -1, 0, univ.rng, { placeType: 1 });
  }
  // `do_explosion_anim(5, 1)` and then `(5, 2)`, and **neither names a sound**:
  // the 5 is the definition's unnamed, unread first parameter, and the third —
  // the real one — defaults to -1, so boom type 1 looks up file 10. This port
  // was passing the 5 along and playing file 5.
  //
  // The two calls split the eleven frames between them, `t < 6` then `t >= 6`,
  // and `special_draw == 2` skips the scatter rolls and the sound so only the
  // first pays them. Eleven redraws and one set of rolls in total, which is
  // what one `runBoomAnim` already spends.
  runBoomAnim(univ.rng, () => drawTerrain(session));
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
