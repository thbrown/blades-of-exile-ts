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
import { GameMode, isCombat } from '../game/modes';
import { GameSession } from '../game/session';
import { SpellPick } from '../game/spellPick';
import { combatCastSpell } from '../game/spellCombat';
import { cancelSpellTargeting, doCombatCast, placeTarget } from '../game/spellCombatTarget';
import { cancelTownTargeting, castTownSpell } from '../game/spellTarget';
import { castSpell } from '../game/spellTown';
import { Skill } from '../universe/skills';
import { Replay, ReplaySource, locationFromAction, numberFromAction } from './format';
import { STARTUP_ACTIONS, decodeReplayFile } from './startup';

export interface ReplayResult {
  /** How many actions were dispatched to a handler. */
  ran: number;
  /** Action types with no handler here, and how often each turned up. */
  unsupported: Record<string, number>;
  /** Where playback stopped, if it stopped early. */
  error: string | null;
  /** The index of the action that failed, or -1. */
  errorAt: number;
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
  const result: ReplayResult = { ran: 0, unsupported: {}, error: null, errorAt: -1 };
  /**
   * The spell picker, while one is open. `handle_spellcast` puts it up and the
   * `click_control`s that follow answer it, which is what the C++'s modal
   * `cDialog::run` does with the same recorded clicks.
   */
  let picking: SpellPick | null = null;

  while (!source.exhausted) {
    const at = source.position;
    const action = source.pop();
    try {
      switch (action.type) {
        case 'move': {
          const dest = locationFromAction(action);
          // **A recorded move is always one square.**
          // `handle_terrain_screen_actions` (boe.actions.cpp:300) builds
          // `move_destination` from the party's own square plus a direction —
          // one step for a key, `get_cur_direction()` for a click — and only
          // then calls `handle_move`. So a destination further away than that
          // does not mean the player travelled: it means **the party is not
          // where the recording's party was**, and everything after it is
          // measuring a different game.
          //
          // This is the single most useful desync detector in the format, and
          // it is worth spending it here rather than letting the step through:
          // `outd_move_party` and `town_move_party` both take the destination
          // at face value, so an undetected drift silently teleports the party
          // and the run keeps "succeeding" for hundreds more actions.
          const from = session.mode === GameMode.COMBAT
            ? session.univ.currentPc.combatPos : session.univ.party.getLoc();
          const step = Math.max(Math.abs(dest.x - from.x), Math.abs(dest.y - from.y));
          if (step > 1) {
            throw new Error(
              `replay desync: the recording stepped to (${dest.x},${dest.y}), `
              + `but the party is at (${from.x},${from.y}) — ${step} squares away`);
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
        case 'handle_rest':
          session.rest();
          break;
        case 'handle_combat_switch':
          // One action for both halves in the C++: it is a toggle, and the
          // direction only matters on the way in.
          if (action.text === '') session.endCombat();
          else session.startCombat(numberFromAction(action) as Direction);
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
          session.chooseTalkNode(Number(action.info.node ?? '-1'));
          break;
        case 'handle_use_space':
          await session.useSpace(locationFromAction(action));
          break;
        case 'handle_switch_pc':
          session.univ.curPc = numberFromAction(action);
          break;
        case 'handle_parry':
          session.parry();
          break;
        case 'handle_toggle_active':
          session.toggleActivePc();
          break;
        case 'handle_missile':
          // load_missile: arms whatever the acting PC has and drops into
          // FIRING/THROWING. The shot itself is the `handle_target_space` that
          // follows.
          session.startMissile();
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
          } else if (session.missile !== null) {
            await session.fireMissileAt(target);
          } else {
            result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
            if (onUnsupported === 'stop') {
              result.error = 'handle_target_space with nothing armed';
              result.errorAt = at;
              return result;
            }
            continue;
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
          if (action.info.spell_forced === 'true') {
            result.unsupported[action.type] = (result.unsupported[action.type] ?? 0) + 1;
            if (onUnsupported === 'stop') {
              result.error = 'handle_spellcast with spell_forced: the recast shortcut is not ported';
              result.errorAt = at;
              return result;
            }
            continue;
          }
          const type = action.info.which_type === 'priest'
            ? Skill.PRIEST_SPELLS : Skill.MAGE_SPELLS;
          // `can_choose_caster` is false in combat: the active PC casts, full
          // stop, and the caster buttons are inert (`pick_spell` is handed
          // `univ.cur_pc` there and 6 out of combat).
          picking = new SpellPick(session, type, !isCombat(session.mode));
          break;
        }
        case 'click_control': {
          const id = action.info.id ?? '';
          options.onClick?.(id, Number(action.info.mods ?? '0'));
          // While the spell picker is up it is modal, so the clicks belong to
          // it — the same way the C++'s `cDialog::run` takes them.
          if (picking !== null) {
            const decided = picking.click(id);
            if (decided === 'cancel') picking = null;
            else if (decided === 'cast') {
              const { spell, caster, target } = picking.choice;
              const inFight = !picking.canChooseCaster;
              picking = null;
              if (spell === Spell.NONE) {
                // finish_pick_spell's `store_spell == 70` arm.
                session.univ.addStringToBuf('Cast: No spell selected.');
                break;
              }
              session.spellTarget = target;
              if (inFight) await combatCastSpell(session, spell);
              else castSpell(session, caster, spell);
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
        case 'display_map':
        case 'close_map':
        case 'close_window':
        case 'set_stat_window':
        case 'show_inventory':
        case 'print_party_stats':
        case 'debug_print_location':
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
    } catch (err) {
      result.error = String(err);
      result.errorAt = at;
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
