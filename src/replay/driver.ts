/**
 * The replay driver — `replay_action` (boe.main.cpp:647) and the loop that
 * feeds it (:1353).
 *
 * The C++ dispatches on the action's element name into the same `handle_*`
 * functions the keyboard and mouse call. This port dispatches into
 * `GameSession`, which is where the rules live; the key handling in `main.ts`
 * is the UI layer above it and has nothing a replay needs.
 *
 * Two properties are kept deliberately:
 *
 *   - **Actions are pulled, and a mismatch throws.** The driver asks the source
 *     for what it needs; a control-flow divergence anywhere in the engine shows
 *     up as the wrong action type at the first input it changes, instead of
 *     quietly producing a different game.
 *   - **Nothing is skipped silently.** An action this port has no handler for
 *     is counted and reported by name, so `runReplay`'s result is an honest
 *     statement of what was and wasn't exercised — the same discipline as the
 *     `TODO(Mn)` markers.
 */

import { Direction } from '../core/location';
import { GameRng } from '../core/rng';
import { Spell } from '../data/spell';
import { ItemWinMode, ItemWindow } from '../game/itemWindow';
import { takeAp } from '../game/combat';
import { setFeatureFlags } from '../game/featureFlags';
import { GetItemsPick } from '../game/getItems';
import { useItem } from '../game/itemUse';
import { GameMode, isCombat, isOut } from '../game/modes';
import { dropItemAt, handleDropItem, handleGiveItem } from '../game/giveDrop';
import { GameSession } from '../game/session';
import { SpellPick } from '../game/spellPick';
import { combatCastCheck, combatCastSpell } from '../game/spellCombat';
import { cancelSpellTargeting, doCombatCast, placeTarget, spellCastHitReturn } from '../game/spellCombatTarget';
import { cancelTownTargeting, castTownSpell } from '../game/spellTarget';
import { castSpell } from '../game/spellTown';
import { forcedCast } from '../game/spellRepeat';
import { Skill } from '../universe/skills';
import { SelectPcMode, runSelectPc } from '../game/selectPc';
import {
  Replay, ReplayAction, ReplaySource, locationFromAction, numberFromAction,
} from './format';
import { makeReplayHost } from './host';
import { STARTUP_ACTIONS, decodeReplayFile } from './startup';

/**
 * `easter_egg_messages` (boe.actions.cpp:2588). Recorded, its comment says,
 * "because it allows forcing the text buffer into a specific state which I'm
 * debugging" — which is exactly what makes it worth having here.
 */
const EASTER_EGG_MESSAGES = [
  'If Valorim ...',
  'You want to save ...',
  'Back up your save files ...',
  'Burma Shave.',
];

export interface ReplayResult {
  /** How many actions were dispatched to a handler. */
  ran: number;
  /** Action types with no handler here, and how often each turned up. */
  unsupported: Record<string, number>;
  /** Where playback stopped, if it stopped early. */
  error: string | null;
  /** The index of the action that failed, or -1. */
  errorAt: number;
  /**
   * How many actions the *dialogs* consumed rather than the driver's switch.
   * The host pulls from the same stream, so a run that finished the file has
   * `ran + answered === actions`, and treating `ran` alone as the total makes a
   * complete run look one action short for every message box it dismissed.
   */
  answered: number;
}

export interface ReplayOptions {
  /**
   * What to do with an action this port can't run. `stop` is the strict
   * reading — any gap invalidates everything after it, because the game state
   * has diverged from the recording. `skip` is for surveying a file to see how
   * far the port could get, which is what curating the C++'s own replays needs.
   */
  onUnsupported?: 'stop' | 'skip';
  /** Answers `click_control`; the driver only records which id came up. */
  onClick?: (id: string, mods: number) => void;
  /**
   * The action to start at. `replayStartup` reports how many leading actions
   * are the splash screen and the file picker rather than the game; the caller
   * has already acted on them by building the session, so playback resumes
   * after them. Positions in the result stay absolute.
   */
  from?: number;
  /**
   * A `load_party` reached mid-run — the recording loaded a saved game partway
   * through, which several of the C++'s own replays do (twice in a row, in one
   * case). It is a real state change, not window furniture, so without a
   * handler it counts as a gap rather than being skipped. The caller supplies
   * it because only the caller can say what applying a save means here: it may
   * name a different scenario, whose files have to be fetched first.
   */
  onLoadParty?: (save: Uint8Array) => void | Promise<void>;
  /**
   * Leave the session's scripting alone instead of attaching the replay host.
   *
   * The default — attaching it — is what the C++ does, and running without it
   * is what made the corpus look like a rules problem: with scripting off, a
   * special that blocks a step never gets the chance to unblock it, and the
   * party stops one square short of the recording for reasons that have nothing
   * to do with movement. This escape hatch exists for a caller that has already
   * installed a host of its own.
   */
  keepSpecials?: boolean;
  /**
   * Called after each action is dispatched, for tracing. The driver cannot be
   * stepped from outside — a replay has to run in one pass now that the dialog
   * host pulls from the same stream, so slicing the file per action would leave
   * a message box with nothing to answer it.
   */
  onStep?: (at: number, action: ReplayAction) => void;
}

/**
 * Replay into a live session. The caller is responsible for the session having
 * been built on the replay's scenario and seed — `applyReplaySeed` below does
 * the seed half.
 */
export async function runReplay(
  session: GameSession,
  replay: Replay,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const source = new ReplaySource(replay.actions, options.from ?? 0);
  const onUnsupported = options.onUnsupported ?? 'stop';
  const result: ReplayResult = {
    ran: 0, unsupported: {}, error: null, errorAt: -1, answered: 0,
  };
  // **The recording's feature flags replace this build's, wholesale**
  // (`replay_feature_flags`, boe.main.cpp:1087). A flag the file does not
  // mention is *off*, not defaulted — and a file with no block at all runs with
  // every flag off, which is why the absent case clears rather than leaving
  // the defaults alone. Installed per run, so one replay cannot leak its set
  // into the next.
  setFeatureFlags(replay.featureFlags ?? {});
  // **Scripting on, answered from the recording.** The host pulls from this
  // same source, which is how the C++'s modal dialogs behave: `cDialog::run`
  // pops actions off the stream the outer handler is walking, so a message
  // raised mid-move eats the click that dismissed it and the move goes on.
  if (options.keepSpecials !== true) {
    session.attachSpecials(makeReplayHost(session, source, {
      onAnswered: () => { result.answered++; },
    }));
  }
  /**
   * The spell picker, while one is open. `handle_spellcast` puts it up and the
   * `click_control`s that follow answer it, which is what the C++'s modal
   * `cDialog::run` does with the same recorded clicks.
   */
  let picking: SpellPick | null = null;
  /**
   * `stat_window` and the list behind it. The C++ keeps these as globals beside
   * the item pane; here they live on the renderer, which a headless driver has
   * none of — so it keeps its own, which is all the item actions need.
   */
  const win = new ItemWindow();
  // The rules move the pane too — `combat_next_step` and `start_town_combat`
  // both call `set_stat_window_for_pc`, so the driver has to be reachable from
  // in there or a recording equips out of whichever pack was last on screen.
  session.onStatWindowForPc = (pc) => { win.setStatWindowForPc(session.univ, pc); };
  /**
   * **The locked-door prompt, which the driver had no answer for at all.**
   * Walking into a locked door defers to `onLockedDoor`, and only `main.ts`
   * ever set it — so in a replay the door said nothing, the bash never
   * happened, and the recording's two clicks (`bash`, then `pick1` from the
   * select-PC dialog) fell on the floor. The next move stepped into a door
   * that was still shut and the run desynced two squares later, which reads
   * as a movement bug and is not one.
   *
   * The button names are the C++'s controls, not their labels — the same rule
   * the choice host follows.
   */
  if (options.keepSpecials !== true) {
    const host = session.host;
    session.onLockedDoor = async (where): Promise<void> => {
      if (!host) return;
      const picked = await host.choice(
        ['This door is locked.', 'What do you do?'],
        [{ name: 'leave', label: 'Leave' },
          { name: 'bash', label: 'Bash Door' },
          { name: 'pick', label: 'Pick Lock' }],
        '', 0, 0);
      const choice = ['leave', 'bash', 'pick'][picked] ?? 'leave';
      if (choice === 'bash') {
        const who = await runSelectPc(session.univ, SelectPcMode.ONLY_LIVING,
          'Who will bash?', (rows, title, hl) => host.selectPc(rows, title, hl),
          { highlight: Skill.STRENGTH });
        if (who < 6) await session.bashDoor(where, who);
      } else if (choice === 'pick') {
        const who = await runSelectPc(session.univ, SelectPcMode.ONLY_CAN_LOCKPICK,
          'Who will pick the lock?', (rows, title, hl) => host.selectPc(rows, title, hl),
          { highlight: Skill.LOCKPICKING });
        if (who < 6) session.pickLock(where, who);
      }
    };
  }
  /** Whether the open get-items screen owes a turn when it closes. */
  let gettingCostsTurn = false;
  /**
   * The get-items screen, while one is open — `show_get_items`'s own loop,
   * which unlike the spell picker stays up across many clicks.
   */
  let getting: GetItemsPick | null = null;
  /**
   * Whether a plain `cChoiceDlog` raised by `show_dialog_action` is up. It has
   * no state and no effect on the game — the help screens, the welcome box —
   * but it *is* modal, so the `click_control` that dismisses it belongs to it
   * and must not be read as a click on the game.
   */
  let helpDialog = false;

  while (!source.exhausted) {
    const at = source.position;
    const action = source.pop();
    try {
      switch (action.type) {
        case 'move': {
          const dest = locationFromAction(action);
          // **Outside combat, a recorded move is one square — from `center`.**
          // `handle_terrain_screen_actions` (boe.actions.cpp:302) opens with
          // `location cur_loc = is_out() ? univ.party.out_loc : center;` and
          // builds `move_destination` from *that* plus a direction — one step
          // for a key, `get_cur_direction()` for a click, and that function
          // only ever returns the eight unit vectors. So a longer destination
          // means **the party is not where the recording's party was**, and
          // everything after it is measuring a different game. It is the single
          // most useful desync detector in the format, and worth spending here
          // rather than letting the step through: `outd_move_party` and
          // `town_move_party` take the destination at face value, so an
          // undetected drift silently teleports the party and the run keeps
          // "succeeding" for hundreds more actions.
          //
          // Two corrections, both found on `ZKR-5-16-12-30`:
          //
          // - **The origin is `center`, not the party or the acting PC.** They
          //   come apart the moment `screen_shift` scrolls the view, since
          //   scrolling moves the centre and nobody else.
          // - **In combat the invariant does not hold at all**, so the check is
          //   skipped there. A replayed `move` reaches `handle_move` directly
          //   (boe.main.cpp:758), never through the function that built the
          //   one-step destination, and the corpus contains destinations two
          //   squares from a centre the C++ itself prints — replay
          //   `ZKR-5-16-12-30` with `BOE_TRACE_CENTER=1` and read action 128.
          //   `pc_combat_move` then assigns `combat_pos = destination` outright
          //   (boe.combat.cpp:319), so the C++ *teleports* the PC there and
          //   plays on. Refusing it cost this file 65 of its 190 actions.
          const from = isOut(session.mode)
            ? session.univ.party.outLoc : session.center;
          const step = Math.max(Math.abs(dest.x - from.x), Math.abs(dest.y - from.y));
          if (step > 1 && session.mode !== GameMode.COMBAT) {
            throw new Error(
              `replay desync: the recording stepped to (${dest.x},${dest.y}), `
              + `but the view is centred on (${from.x},${from.y}) — ${step} squares away`);
          }
          // `handle_move`'s first branch (boe.actions.cpp:750): **in combat a
          // move drives the acting PC, not the party.** The driver used to send
          // every recorded move to `moveTo`, which is the town/outdoor path, so
          // the moment a recording entered a fight every step was refused —
          // "Blocked: north" over and over, with everything after it meaningless.
          if (session.mode === GameMode.COMBAT) await session.combatMove(dest);
          else await session.moveTo(dest);
          break;
        }
        case 'handle_pause':
          await session.pause();
          break;
        case 'spell_cast_hit_return':
          // Space while a wall spell is aimed: it turns the wall
          // (boe.combat.cpp:5038). Recorded under this name because the C++
          // records it inside the function rather than at the keystroke.
          spellCastHitReturn(session);
          break;
        case 'handle_rest':
          await session.rest();
          break;
        case 'handle_wait':
          // The long wait, which is **w** and not Space. Up to eighty turns
          // pass here, so it is one of the biggest single state changes a
          // recording can contain.
          await session.wait();
          break;
        case 'arrow_button_click':
          // Cosmetic, and the C++ says so in as many words at the recording
          // site (boe.graphics.cpp:497): "In a replay, this action is purely
          // cosmetic, for playing the animation and sound accompanying a click
          // on a button whose real action is recorded afterward." It draws the
          // button depressed and returns true; the click it belongs to arrives
          // as the next action. The rectangle it carries is where the button
          // was on screen, which this port lays out for itself.
          break;
        case 'handle_combat_switch':
          // **The C++ records this with empty text, always** — `record_action
          // ("handle_combat_switch", "")` (boe.actions.cpp:1317). It is a pure
          // mode toggle and carries no argument at all.
          //
          // This port used to read the text and treat "" as "end combat", so it
          // could **never start a fight**: every recorded toggle took the end
          // branch. A recording that entered combat then went on playing town
          // moves here, and the first thing that needed a fight — a missile —
          // said "Shoot: Only in combat." with fifty actions of nonsense behind
          // it.
          //
          // The direction is the party's own facing, set by the last move, not
          // anything the recording states.
          if (session.mode === GameMode.TOWN) {
            session.startCombat(session.univ.party.direction);
          } else if (session.mode === GameMode.COMBAT) {
            // **Ending a town fight costs a turn.** `handle_combat_switch`
            // sets `did_something = true` on that branch (boe.actions.cpp:1362)
            // and `advance_time` then runs a whole town turn — increase_age,
            // do_monsters, do_monster_turn — because the mode is TOWN again by
            // the time it looks. Without it this port's upkeep ran one action
            // late for the rest of the recording: the next `move` spent the
            // draws the C++ spent here.
            //
            // Only the town branch. The outdoor one (:1339) never sets the
            // flag, so leaving an outdoor fight is free.
            const wasTown = session.whichCombatType !== 0;
            if (session.endCombat() && wasTown) await session.afterPartyTurn();
          }
          break;
        case 'handle_look':
          session.lookAt(locationFromAction(action, 'destination'));
          break;
        case 'handle_talk':
          await session.talkTo(locationFromAction(action));
          break;
        case 'click_talk_rect':
          // The C++ records the whole word rect — the text, its rectangle, its
          // colour and its node — but only `node` is a game input; the rest is
          // what the click has to *draw* while it flashes (`click_talk_rect`,
          // boe.newgraph.cpp:951), and the caller then runs `handle_talk_node`.
          // Ask About is `node` -1 here as it is there, and its topic arrives
          // as the `field_input` that follows.
          await session.chooseTalkNode(Number(action.info.node ?? '-1'));
          break;
        case 'handle_use_space':
          await session.useSpace(locationFromAction(action));
          break;
        case 'handle_switch_pc': {
          // **It moves the item pane too** (boe.actions.cpp:1043): the same
          // branch that sets `cur_pc` calls `set_stat_window_for_pc`, and
          // `give_thing`/`drop_item`/`use_item` are all handed `stat_window`,
          // not `cur_pc`. Assigning only `cur_pc` here left the pane on PC 0,
          // so a give three hundred actions later split the wrong PC's stack
          // and raised a "how many?" the recording never answered.
          const which = numberFromAction(action);
          session.switchPc(which);
          if (session.univ.curPc === which) win.setStatWindowForPc(session.univ, which);
          break;
        }
        case 'handle_parry':
          session.parry();
          break;
        case 'handle_toggle_active':
          session.toggleActivePc();
          break;
        case 'handle_missile':
          // A toggle: in COMBAT it arms whatever the acting PC has and drops
          // into FIRING/THROWING, and in those two it cancels the aim again.
          // The shot itself is the `handle_target_space` that follows.
          session.handleMissile();
          break;
        case 'handle_target_space': {
          // One action for every kind of targeting the C++ has. Only the
          // missile half is reachable here: a spell gets to targeting through
          // `handle_spellcast`, whose spell picker is a dialog, and that is the
          // next piece of this work.
          const target = locationFromAction(action, 'destination');
          // Four modes reach `handle_target_space`, and which one the party is
          // in decides what the square means. The order here is main.ts's,
          // which is the C++'s: the modes never overlap.
          if (session.spellTargeting !== null) {
            // A FANCY spell collects squares and fires itself once it has the
            // last one; `num_targets_left` is the recording's own count of how
            // many are still to come, and it is checked rather than trusted —
            // a mismatch means the port worked out a different number of
            // targets from the caster's level, which is a real divergence.
            const fancy = session.spellTargeting.targetsLeft > 0;
            if (fancy) {
              // `num_targets_left` is how many squares a multi-target spell
              // still wanted when the click happened. **The C++ assigns it**
              // from the recording, overwriting whatever the engine worked out;
              // this port compares instead, because that number falls out of
              // the caster's level and the spell's own table
              // (`fancyTargetCount`), and disagreeing about it is exactly the
              // kind of divergence these files exist to catch.
              const left = Number(action.info.num_targets_left ?? '0');
              const want = session.spellTargeting.targetsLeft;
              if (left !== want) {
                throw new Error(
                  `replay: this spell still wants ${want} targets, the recording says ${left}`);
              }
              await placeTarget(session, target);
            } else await doCombatCast(session, target);
          } else if (session.townTarget !== null) {
            await castTownSpell(session, target);
            // **A town cast charges a turn.** `handle_target_space` sets
            // `did_something = true` for every targeting mode but FANCY
            // (boe.actions.cpp:888) and `advance_time` runs the town's upkeep
            // and `do_monsters` on the way out. Without it this port's clock
            // ran one tick behind for the rest of the recording, and every
            // creature took one turn fewer than the C++ gave it — visible in
            // `[domonst]` as a missing line at the same square, one age apart,
            // and in the draw stream as `select_active_pc`'s run of
            // `get_ran(1,0,5)` that this side never made.
            await session.afterPartyTurn();
          } else if (session.missile !== null) {
            await session.fireMissileAt(target);
          } else {
            // **Nothing armed is not an error — the C++ does nothing here too.**
            // `handle_target_space` (boe.actions.cpp:866) tests four modes and
            // plain MODE_COMBAT is none of them, so it falls through all of
            // them, recentres and sets the mode back to MODE_COMBAT. It is what
            // a player gets for clicking a square after a shot that never
            // armed: pressing **s** with no bow prints "Fire: Equip a missile."
            // and leaves the mode alone, and the click that was going to be the
            // shot lands on nothing.
            //
            // The driver used to stop here, which cost seven files — on the
            // reading that a square being targeted with nothing armed meant this
            // port had failed to arm something the recording armed. It can mean
            // that, but the *recording* cannot tell the two apart, and the
            // format catches the real case anyway: a missile this port failed
            // to fire changes what the player does next, so it surfaces at the
            // following action rather than here.
          }
          break;
        }
        case 'screen_shift':
          // Scrolling the view while aiming. It moves no one, but it is not a
          // no-op either: what the party can *see* from the scrolled view is
          // what the targeting modes are allowed to reach.
          session.screenShift(
            Number(action.info.dx ?? '0'), Number(action.info.dy ?? '0'));
          break;
        // Entering look or talk mode. In the C++ these are `overall_mode`
        // changes that print a prompt; the work is done by the `handle_look` /
        // `handle_talk` that follows. This port has no session-level look or
        // talk *mode* — main.ts holds a `pending` flag instead — so there is
        // nothing here to change and nothing that can diverge.
        case 'handle_begin_look':
        case 'handle_begin_talk':
          break;
        case 'handle_spellcast': {
          // Three quite different things share this one action name.
          //
          // In a targeting mode it is a **cancel** — `handle_spellcast`'s
          // MODE_TOWN_TARGET / MODE_SPELL_TARGET arms print "  Cancelled." and
          // go back, with no dialog at all (boe.actions.cpp:412, :442).
          if (session.townTarget !== null || session.spellTargeting !== null) {
            session.univ.addStringToBuf('  Cancelled.');
            if (session.townTarget !== null) cancelTownTargeting(session);
            else cancelSpellTargeting(session);
            break;
          }
          // Otherwise it opens `pick_spell`, and the choice arrives as the
          // `click_control`s that follow. `spell_forced` is the "hit m again to
          // recast" shortcut, which this port has no equivalent of (see the
          // TODO(M6) on the transcript's right-hand half) — it is read so that
          // a file using it fails honestly rather than silently casting the
          // wrong thing.
          const type = action.info.which_type === 'priest'
            ? Skill.PRIEST_SPELLS : Skill.MAGE_SPELLS;
          // `spell_forced` is **shift-M / shift-P**, the recast shortcut
          // (boe.actions.cpp:3057): no picker, no clicks — it casts what is
          // stored. `spell_recast` rides with it from the keyboard, and is what
          // makes `repeat_cast_ok` run first; `handle_menu_spell` sets
          // `spell_forced` alone, which is why the check hangs off the second.
          if (action.info.spell_forced === 'true') {
            const forced = forcedCast(session, type);
            if (forced === null) break;
            const { caster, spell } = forced;
            if (spell === Spell.NONE) break;
            if (isCombat(session.mode)) await combatCastSpell(session, spell);
            else await session.castTownSpell(caster, spell);
            break;
          }
          // **In combat the picker does not always open.**
          // `combat_cast_*_spell` asks whether the active PC can cast anything
          // of this kind *before* reaching `pick_spell` and returns with no
          // dialog if not, which is why an Anama pressing **m** gets a refusal
          // and nothing else.
          if (isCombat(session.mode) && !combatCastCheck(session, type)) break;
          // `can_choose_caster` is false in combat: the active PC casts, full
          // stop, and the caster buttons are inert (`pick_spell` is handed
          // `univ.cur_pc` there and 6 out of combat).
          picking = new SpellPick(session, type, !isCombat(session.mode));
          break;
        }
        case 'show_dialog_action':
          // `show_dialog_action` (boe.actions.cpp:287) is the whole of it:
          // `cChoiceDlog(xml_file).show()`. The named dialogs are the help
          // screens and the welcome box — no state, no draws, one button — so
          // there is nothing to model except the **modality**: the
          // `click_control` that follows dismisses this and is not a click on
          // the game behind it.
          helpDialog = true;
          break;
        case 'click_control': {
          const id = action.info.id ?? '';
          if (helpDialog) {
            helpDialog = false;
            break;
          }
          options.onClick?.(id, Number(action.info.mods ?? '0'));
          // While the spell picker is up it is modal, so the clicks belong to
          // it — the same way the C++'s `cDialog::run` takes them.
          // The get-items screen is modal in the same way, and it stays open:
          // the six PC buttons, the eight lettered rows and the arrows all
          // answer here until `done` closes it.
          if (getting !== null) {
            if (getting.click(id) === 'done') {
              getting = null;
              if (gettingCostsTurn) {
                gettingCostsTurn = false;
                await session.afterPartyTurn();
              }
            }
            break;
          }
          if (picking !== null) {
            const decided = picking.click(id);
            if (decided === 'cancel') picking = null;
            else if (decided === 'cast') {
              const inFight = !picking.canChooseCaster;
              // `finish_pick_spell`'s tail: its two refusals, and the
              // `last_cast`/`last_target` the recast shortcut reads back.
              const chosen = picking.finish();
              picking = null;
              if (chosen === null) break;
              const { spell, caster, target } = chosen;
              session.spellTarget = target;
              if (inFight) await combatCastSpell(session, spell);
              else await session.castTownSpell(caster, spell);
            }
          }
          break;
        }
        // Recorded by the C++ but carrying no game state: preferences, the
        // window furniture, and the seed/scenario this port reads up front.
        case 'load_prefs':
        case 'feature_flags':
        case 'srand':
        case 'scenario':
        case 'change_fps':
          break;
        // Views, not moves. The automap and the character sheet are drawn from
        // the universe and change nothing in it — `draw_map` and `give_pc_info`
        // read state and paint. The C++ records them because they are windows
        // it has to open and close on the way through, and this port has no
        // window to open from a headless driver. Nothing diverges by skipping
        // them: no clock, no RNG draw, no action points.
        // The file picker itself carries nothing: the slot it chose arrives as
        // the `click_control`s after it, and the bytes as the `load_party`
        // after those.
        case 'fancy_file_picker':
          break;
        case 'load_party': {
          if (!options.onLoadParty) {
            result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
            if (onUnsupported === 'stop') {
              result.error = 'load_party mid-run, and no onLoadParty handler';
              result.errorAt = at;
              return result;
            }
            continue;
          }
          await options.onLoadParty(decodeReplayFile(action.text));
          break;
        }
        // **`set_stat_window` is not a view, and treating it as one was wrong.**
        // It was in the no-op list below on the reasoning that it only decides
        // what the item pane paints — but `stat_window` is also *whose pack*
        // every item action indexes into: `handle_equip_item` is
        // `equip_item(stat_window, item_hit)`, and so are use, drop and give
        // (boe.actions.cpp:1090, :1108). Skipping it meant a recording that
        // flipped to another PC's pack and equipped something would equip the
        // wrong PC's item, silently.
        case 'set_stat_window':
          win.setStatWindow(session.univ, numberFromAction(action) as ItemWinMode);
          break;
        case 'handle_switch_pc_items':
          // boe.actions.cpp:1051 — the six tabs under the item pane. Out of
          // combat this also changes who is *active*; in combat it only
          // changes the page, since the turn order decides who acts.
          if (!isCombat(session.mode)) session.univ.curPc = numberFromAction(action);
          win.setStatWindow(session.univ, numberFromAction(action) as ItemWinMode);
          break;
        case 'handle_equip_item':
          // `prime_time()` (boe.actions.cpp:295) is the gate on all of these:
          // outdoors, town or combat, and nothing half-finished. Equipping
          // costs one action point, using costs three.
          if (session.primeTime) {
            session.toggleEquip(win.pcPage, numberFromAction(action));
            takeAp(session.univ, 1);
          } else session.univ.addStringToBuf("Equip: Finish what you're doing first.");
          break;
        case 'handle_use_item':
          if (!session.primeTime) {
            session.univ.addStringToBuf("Use item: Finish what you're doing first.");
            break;
          }
          // **With the host**, which it used to run without: an item that asks
          // who to heal, or puts a book's text up, blocks in the C++ and the
          // recording answers it. Passing nothing meant those branches did
          // nothing at all and the run carried on with a different game.
          // The AP and the turn are inside `useItem` now, next to the rule that
          // decides whether the turn is spent at all.
          await useItem(session, win.pcPage, numberFromAction(action), session.host ?? undefined);
          break;
        case 'handle_give_item':
          // `give_thing` puts select-pc.xml up, which the host answers from
          // this same stream.
          await handleGiveItem(session, win.pcPage, numberFromAction(action), session.host);
          break;
        case 'handle_drop_item_id':
          // Only *arms* the drop in town or combat — `handle_drop_item_location`
          // below is where it lands. Outdoors there is no square to pick and it
          // happens here, behind the confirmation.
          await handleDropItem(session, win.pcPage, numberFromAction(action), session.host);
          break;
        case 'handle_drop_item_location':
          await dropItemAt(session, locationFromAction(action), session.host);
          break;
        case 'handle_use_space_select':
          // The **U** button: a mode toggle that only decides how the next
          // click on the terrain view is read (boe.actions.cpp:929). The click
          // itself arrives as `handle_use_space`, which does the work — so this
          // is two transcript lines and a mode.
          if (session.mode === GameMode.TOWN) {
            session.univ.addStringToBuf('Use: Select a space or item.');
            session.univ.addStringToBuf('  (Hit button again to cancel.)');
            session.mode = GameMode.USE_TOWN;
          } else if (session.mode === GameMode.USE_TOWN) {
            session.mode = GameMode.TOWN;
            session.univ.addStringToBuf('  Cancelled.');
          }
          break;
        case 'handle_bash_select':
        case 'handle_pick_select': {
          // `handle_bash_pick_select` (boe.actions.cpp:959) — the BASH and PICK
          // buttons, the same mode toggle as `handle_use_space_select` above
          // and with the same two transcript lines. **The cancel arm tests
          // both modes, not the one that matches the button**: pressing PICK
          // while Bash is armed cancels the bash rather than swapping to a
          // pick, which is the C++'s `overall_mode == MODE_BASH_TOWN ||
          // overall_mode == MODE_PICK_TOWN` and is kept.
          const bash = action.type === 'handle_bash_select';
          if (session.mode === GameMode.BASH_TOWN || session.mode === GameMode.PICK_TOWN) {
            session.univ.addStringToBuf('  Cancelled.');
            session.mode = GameMode.TOWN;
          } else {
            session.mode = bash ? GameMode.BASH_TOWN : GameMode.PICK_TOWN;
            session.univ.addStringToBuf(
              bash ? 'Bash Door: Select a space.' : 'Pick Lock: Select a space.');
          }
          break;
        }
        case 'handle_bash':
        case 'handle_pick': {
          // `handle_bash_pick` (boe.actions.cpp:976) — the click that follows.
          // Its two refusals come before the select-PC dialog, so a click on
          // the wrong square costs nothing and asks nobody; **the mode goes
          // back to TOWN either way**, including after a refusal, which is why
          // it is set outside the branch here as it is there.
          const bash = action.type === 'handle_bash';
          const where = locationFromAction(action);
          const from = session.univ.party.getLoc();
          // `adjacent` (boe.locutils.cpp:82) is Chebyshev and counts the
          // square you are standing on, which is what lets you bash a door you
          // have already walked into.
          const near = Math.max(Math.abs(from.x - where.x), Math.abs(from.y - where.y)) <= 1;
          const dlg = session.host;
          if (!near) {
            session.univ.addStringToBuf('  Must be adjacent.');
          } else if (!session.isUnlockable(where)) {
            session.univ.addStringToBuf('  Wrong terrain type.');
          } else {
            const who = await runSelectPc(
              session.univ,
              bash ? SelectPcMode.ONLY_LIVING : SelectPcMode.ONLY_CAN_LOCKPICK,
              bash ? 'Who will bash?' : 'Who will pick the lock?',
              (rows, title, hl) => dlg!.selectPc(rows, title, hl),
              { highlight: bash ? Skill.STRENGTH : Skill.LOCKPICKING });
            // 8 is select_pc's "nobody can", and it has already said so.
            if (who === 8) break;
            if (who === 6) {
              session.univ.addStringToBuf('  Cancelled.');
              session.mode = GameMode.TOWN;
              break;
            }
            if (bash) await session.bashDoor(where, who);
            else session.pickLock(where, who);
          }
          session.mode = GameMode.TOWN;
          await session.afterPartyTurn();
          break;
        }
        case 'cancel_item_target':
          // Leaving a shop's identify or recharge queue (boe.actions.cpp:2576).
          // The C++ prints which one it was from `stat_screen_mode`; this port
          // keeps that on `session.itemShop`.
          session.endItemShop();
          break;
        case 'toggle_debug_mode':
          // `univ.debug_mode` gates the debug keys. Nothing else reads it, but
          // it is party state and a recording can turn it on mid-run.
          session.univ.debugMode = !session.univ.debugMode;
          session.univ.addStringToBuf(
            session.univ.debugMode ? 'Debug mode ON.' : 'Debug mode OFF.');
          break;
        case 'easter_egg':
          // Recorded, the C++'s comment says, "because it allows forcing the
          // text buffer into a specific state which I'm debugging."
          session.univ.addStringToBuf(
            EASTER_EGG_MESSAGES[numberFromAction(action)] ?? '');
          break;
        case 'field_focus':
        case 'field_input':
          // A text field taking focus (field.cpp:59), and a keystroke into it.
          // Focus decides which field the input belongs to; every dialog this
          // driver answers has one field, so there is nothing to choose
          // between — and those dialogs consume their own `field_input`s while
          // answering. One that reaches *here* belongs to a window the driver
          // never opened: in practice the save-game picker at the end of a
          // session, where the name typed changes no game state.
          break;
        case 'scrollbar_setPosition': {
          // `cScrollbar::setPosition` (scrollbar.cpp:52). The C++ looks the bar
          // up by name in `event_listeners` and sets it; here the three that
          // carry game state are set directly and the transcript's is a view.
          //
          // *Worth knowing*: the position is recorded **before it is clamped**,
          // deliberately — the C++'s own comment says "so replays will verify
          // that clamping still works" — so a recorded position can be past the
          // end and clamping it is the behaviour under test.
          const name = action.info.name ?? '';
          const want = Number(action.info.newPos ?? '0');
          const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, n));
          if (name === 'inventory-scrollbar') {
            win.scroll = clamp(want, win.scrollMax);
          } else if (name === 'shop-scrollbar') {
            // The shop's row clicks are *relative* to this, so unlike the
            // inventory's — whose recorded item indices are already absolute —
            // this one is a real input and not a view.
            if (session.shop) session.shop.scroll = clamp(want, session.shop.maxScroll);
          } else if (name !== 'transcript-scrollbar') {
            // The transcript's bar is pure view. Anything else is not, and is
            // reported rather than guessed at — including the recordings that
            // carry a **corrupt name**: `setPosition` falls back to the parent
            // pane's name and, when that is empty too, writes whatever was in
            // the uninitialised `name` field, so a few files name their bar with
            // a run of random bytes.
            result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
            if (onUnsupported === 'stop') {
              result.error = `scrollbar_setPosition for an unmodelled bar '${name}'`;
              result.errorAt = at;
              return result;
            }
          }
          break;
        }
        // The shop, in the four actions it is played with.
        case 'click_shop_item':
        case 'click_shop_item_help':
          // Cosmetic, exactly like `arrow_button_click`: `click_shop_rect`
          // (boe.newgraph.cpp:671) draws the row pressed, plays a sound, draws
          // it unpressed, and changes nothing. The purchase it belongs to
          // arrives as the `handle_sale` after it. The rectangle it carries is
          // where the row was on screen.
          break;
        case 'handle_sale':
          // **An absolute index into the shop**, not a screen row — the row a
          // player clicked depends on where the scrollbar sits, and the C++
          // works in `active_shop.getItem(i)`.
          session.buyShopItem(numberFromAction(action));
          break;
        case 'handle_item_shop_action':
          // Selling, identifying or recharging one of your *own* items, at a
          // shop that offers the service. Indexed into the pack on show.
          session.useItemShop(win.pcPage, numberFromAction(action));
          break;
        case 'end_shop_mode':
          session.endShopMode();
          break;
        case 'handle_trade_places':
          session.tradePlaces(numberFromAction(action));
          break;
        case 'handle_get_items': {
          // boe.actions.cpp:1389. In town the sweep is from the party's square,
          // in combat from the **acting PC's** — and there it costs four action
          // points whether or not anything was picked up.
          const inFight = isCombat(session.mode);
          const from = inFight
            ? session.univ.currentPc.combatPos : session.univ.party.townLoc;
          const { items } = session.reachableItems(from);
          // `get_item` only puts the screen up when there is something to put
          // on it, so with an empty square the `click_control`s that would have
          // answered it are simply not in the recording either.
          getting = items.length > 0 ? new GetItemsPick(session, items) : null;
          // **Rummaging costs a turn**, and it is spent when the screen closes:
          // `get_item` runs the dialog inline and `handle_get_items` sets
          // `did_something` from its return, which is 1 as soon as there was
          // anything in reach — not when something was actually taken
          // (boe.items.cpp:277). With no screen there is nothing to close, so
          // the turn is charged here instead.
          if (getting !== null) gettingCostsTurn = !inFight;
          if (inFight) {
            takeAp(session.univ, 4);
            session.afterCombatAction();
          }
          break;
        }
        case 'display_map':
        case 'close_map':
        case 'close_window':
        case 'show_inventory':
        case 'print_party_stats':
        case 'debug_print_location':
        // `show_item_info` and `give_pc_info` open the item and character
        // sheets. Both read the universe and paint it; neither takes a turn.
        case 'show_item_info':
        case 'give_pc_info':
          break;
        default: {
          result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
          if (onUnsupported === 'stop') {
            // A startup action reached *here* rather than in the preamble means
            // the recording loaded a save or changed scenario mid-run. That is
            // a real game action, and skipping it would give a different game
            // from the one recorded — so it is a gap like any other, and says
            // so with the reason attached.
            result.error = STARTUP_ACTIONS.has(action.type)
              ? `'${action.type}' mid-run: the recording restarts or reloads here`
              : `no handler for '${action.type}'`;
            result.errorAt = at;
            return result;
          }
          continue;
        }
      }
      // **Wait for the action to finish before reading the next one.** The C++
      // is single-threaded and blocking, so a special chain or a monster round
      // always completes before `handle_action` is entered again. Here those
      // are async and some are launched fire-and-forget, so without this the
      // next action interleaves with the last one's tail and the run stops
      // being reproducible — the same actions replayed twice give different
      // RNG draw counts. The live UI enforces the same rule through
      // `flushingInput`, which drops keystrokes while anything is still going.
      await session.settled();
      options.onStep?.(at, action);
    } catch (err) {
      result.error = String(err);
      result.errorAt = at;
      if (process.env.TRACE && err instanceof Error) console.error(err.stack);
      return result;
    }
    result.ran++;
  }
  return result;
}

/**
 * The RNG a replay has to be *built* on. The C++ pops `<srand>` during startup,
 * before the party or the scenario exist (boe.main.cpp:1174), and that ordering
 * is the whole point: constructing a Universe and starting a game already draws
 * thousands of numbers, so seeding afterwards rewinds the stream and every
 * replayed action then reads from the wrong place. Handing back the rng rather
 * than re-seeding a live session makes that mistake impossible to write.
 *
 * **Only the game stream is seeded** — the C++ records one `<srand>` and leaves
 * `unique_rand` alone, because it is deliberately not reproducible.
 */
export function rngForReplay(replay: Replay): GameRng {
  const rng = new GameRng();
  if (replay.seed !== null) rng.seedGame(replay.seed);
  return rng;
}

/**
 * The seeding a recording that opens by **loading a save** needs instead.
 *
 * `rngForReplay` above is right for a recording that starts a new game: the
 * C++ seeds before the party exists and then plays, so this port has to draw
 * the same numbers for the same reasons from the very first one. A recording
 * that loads a save is the opposite shape — the C++ *never starts a game*, so
 * the thousands of draws `startNewGame` makes rolling shop stock have no
 * counterpart on that side at all, and seeding before them puts the whole
 * stream thousands of numbers out of step. It surfaces first as the town's
 * wandering townspeople walking off in different directions, and eventually as
 * one of them standing on a square the recording walked through.
 *
 * So: build the session however it needs to be built, then call this, then
 * apply the save.
 *
 * **The one extra draw is not a fudge.** `init_boe` seeds and then does
 * `std::cout << game_rand() << std::endl;` (boe.main.cpp:1247) — a debug print
 * of the first number, unconditional, in the build the recordings were made
 * with. It consumes a draw, so the stream every recorded action reads from
 * starts one number in. `get_ran`'s call order is part of the spec and this is
 * a call.
 */
export function seedLoadedReplay(rng: GameRng, replay: Replay): void {
  if (replay.seed === null) return;
  rng.seedGame(replay.seed);
  rng.game.next();
  rng.gameDraws++;
}
