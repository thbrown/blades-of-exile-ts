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

import { Direction, dist, Location } from '../core/location';
import { GameRng } from '../core/rng';
import { Spell } from '../data/spell';
import { ItemWinMode, ItemWindow } from '../game/itemWindow';
import { takeAp } from '../game/combat';
import { awardPartyXp, killPc } from '../game/damage';
import { GiveStatus, giveItem } from '../universe/inventory';
import { setGiveHelp } from '../universe/living';
import { MainStatus, PartyStatus, isDeadStatus } from '../universe/skills';
import { hasFeatureFlag, setFeatureFlags } from '../game/featureFlags';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { GetItemsPick } from '../game/getItems';
import { SpecCtx, SpecCtxType } from '../game/specials/context';
import { ShopItemType } from '../data/shop';
import { alchemyChoices, makePotion } from '../game/alchemy';
import { potionSlot } from '../dialogs/pickPotionDialog';
import { useItem } from '../game/itemUse';
import { GameMode, isCombat } from '../game/modes';
import { drawTerrain } from '../game/textBar';
import { dropItemAt, handleDropItem, handleGiveItem } from '../game/giveDrop';
import { GameSession } from '../game/session';
import { SpellPick } from '../game/spellPick';
import { combatCastCheck, combatCastSpell } from '../game/spellCombat';
import { cancelSpellTargeting, doCombatCast, placeTarget, spellCastHitReturn } from '../game/spellCombatTarget';
import { cancelTownTargeting, castTownSpell } from '../game/spellTarget';
import { castSpell } from '../game/spellTown';
import { forcedCast } from '../game/spellRepeat';
import { Skill } from '../universe/skills';
import {
  SELECT_PC_ALL, SELECT_PC_CANCEL, SELECT_PC_NONE, SelectPcMode, runSelectPc,
} from '../game/selectPc';
import {
  Replay, ReplayAction, ReplaySource, locationFromAction, numberFromAction,
} from './format';
import { makeReplayHost, popClick, typeInto } from './host';
import { PcGraphicPick, RaceAbilPick, SpendXp, XpMode, newPc, pcNameOk } from '../game/createPc';
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
    /**
     * **`boat-bridge.xml`, and the same shape of hole as the locked door.**
     * A boat reaching a bridge asks "pilot under it or land?"
     * (boe.actions.cpp:4212), and only `main.ts` ever set the hook — so in a
     * replay the party always landed, and the recording's `click_control
     * under` fell through to the driver's switch as if it were a move. The
     * boat then sat on the bridge and every step after it was one square out.
     */
    /**
     * **`attack-friendly.xml`, and the third hole of exactly this shape.**
     * Swinging at a creature that hasn't turned on you yet asks first
     * (boe.combat.cpp:242 → `pc_combat_move`), and only `main.ts` ever set the
     * hook — so in a replay the swing was silently refused and the recording's
     * `click_control cancel` fell out of the dialog and into the driver's own
     * switch, where it bought a main-loop iteration of its own. That iteration
     * is a `draw_terrain`, and in combat a `draw_terrain` is a die: one draw
     * per prompt, which is all it takes to part the streams.
     */
    session.onConfirmAttackFriendly = async (): Promise<boolean> => {
      if (!host) return false;
      const picked = await host.choice(
        ["This creature isn't hostile.", 'Attack anyway?'],
        [{ name: 'cancel', label: 'Cancel' }, { name: 'attack', label: 'Attack' }],
        '', 0, 0);
      return picked === 1;
    };
    /**
     * **`soul-crystal.xml`, and the fifth hole of this shape.**
     * `pick_trapped_monst` (boe.party.cpp:2465) is a `cChoiceDlog` over
     * `cancel` and `pick1`-`pick4`, and its answer is
     * `imprisoned_monst[result[4] - '1']` — the *slot*, not the monster.
     * Simulacrum is the only caller, and without the hook it read 0, cast
     * nothing, and left the recording's `pick4` to fall out into the driver's
     * own switch. `AllMageSpells` casts it at action 401 and the C++ spends
     * **fifty-six draws** there — a whole summon and its missile animation —
     * against this port's two.
     *
     * Note the C++ does not check that the slot it was handed is occupied: the
     * empty buttons are *hidden*, which a player cannot click and a recording
     * never does.
     */
    session.onPickTrappedMonst = async (): Promise<number> => {
      const id = popClick(source, 'the soul crystal', () => { result.answered++; });
      if (id === 'cancel') return 0;
      const slot = /^pick(\d)$/.exec(id);
      if (!slot) return 0;
      return session.univ.party.imprisonedMonst[Number(slot[1]) - 1] ?? 0;
    };
    session.onConfirmBoatBridge = async (): Promise<boolean> => {
      if (!host) return false;
      const picked = await host.choice(
        ['You have come to a dock/bridge.', 'Pilot under it or land?'],
        [{ name: 'under', label: 'Under' }, { name: 'land', label: 'Land' }],
        '', 0, 0);
      return picked === 0;
    };
  }
  /** Whether the open get-items screen owes a turn when it closes. */
  let gettingCostsTurn = false;
  /** Whether the open get-items screen was raised in combat. */
  /** `handle_get_items` took the non-TOWN arm, so `take_ap(4)` is owed. */
  let gettingTakesAp = false;
  /** …and the turn is stepped by the *combat* arm of `handle_monster_actions`. */
  let gettingInCombat = false;
  /**
   * The get-items screen, while one is open — `show_get_items`'s own loop,
   * which unlike the spell picker stays up across many clicks.
   */
  let getting: GetItemsPick | null = null;
  /**
   * `get_item`'s `place` — the square the sweep reached from, which is what
   * the theft check asks the townsfolk about once the screen closes.
   */
  let gettingFrom: Location = { x: 0, y: 0 };
  /**
   * Whether a plain `cChoiceDlog` raised by `show_dialog_action` is up. It has
   * no state and no effect on the game — the help screens, the welcome box —
   * but it *is* modal, so the `click_control` that dismisses it belongs to it
   * and must not be read as a click on the game.
   */
  let helpDialog = false;
  /**
   * Whether one of the journal dialogs (`adventure-notes`, `talk-notes`) is up.
   * Unlike `helpDialog` these stay open across many clicks — they page with
   * `left`/`right` and delete entries with `del` — so it takes the `done` that
   * closes them rather than the first click that arrives.
   */
  let notesDialog = false;
  /**
   * The preferences dialog (`pick_preferences`, boe.dlgutil.cpp:1463), open
   * mid-run. It is modal and stays up across many clicks, and **two of its
   * LEDs are game state rather than preferences**: `easier` and `lesswm` are
   * written straight onto the party when it is dismissed with `okay`
   * (:1409). Both change the draw stream — easy mode halves a creature's
   * health in `assign` and gives ten free days in `day_reached`, and
   * `less_wm` widens the wandering-monster roll to
   * `get_ran(1,1,70 + less_wm * 200)` — so the dialog cannot simply be
   * swallowed the way the help screens are.
   *
   * Every LED is initialised from the current state and the recording only
   * clicks the ones it changes, so these two start where the party is and a
   * dialog that never touches them writes back what was already there. The
   * rest of the controls (display mode, sound, UI scale, game speed) are
   * preferences the C++ hands to `set_pref`; none is game state and none is
   * modelled here.
   */
  let prefsDialog: { easy: boolean; lessWm: boolean } | null = null;

  /**
   * `need_redraw` is declared per `replay_action` (boe.main.cpp:709) and read
   * by `advance_time` at the end of it. A modal pulls its own actions out of
   * the recording, so those are *not* separate `replay_action` calls and must
   * not reset it: the value that reaches `advance_time` is the **opening**
   * action's, which is why the reset is gated on no modal being up.
   *
   * Which handlers set it is a reading of boe.actions.cpp, not a guess — the
   * ground truth is in `BOE_TRACE_MMOVE=1`'s `[advtime] redraw=` column, and
   * PROGRESS.md carries the table it was checked against.
   */
  /**
   * `give_help` (strdlog.cpp:182) is a *preference*, not an unconditional
   * dialog: it shows a help id once and remembers it in the `ReceivedHelp`
   * integer array, and `ShowInstantHelp` turns the whole mechanism off. Both
   * arrive in the recording's `load_prefs`, so a replay can say for certain
   * whether a given `give_help` put a box up and ate a click — which matters,
   * because `handle_new_pc` opens with `give_help(56,0)` and `spend_xp` calls
   * it whenever a step is refused for want of points or gold.
   */
  /** `last_debug_item` — the item index the debug give-item dialog opens on. */
  let lastDebugItem = 0;
  const receivedHelp = new Set<number>();
  let showInstantHelp = true;
  // **Seeded up front, not from the switch below.** `load_prefs` is one of the
  // `STARTUP_ACTIONS` `replayStartup` consumes, so the driver's own arm for it
  // is unreachable and the set stayed empty — which made every one of these
  // boxes look unseen and pop a click the recording never spent. The block is
  // one `key = value` per line; only the two the help mechanism reads are
  // taken, the rest are display and sound.
  {
    const prefs = replay.actions.find((a) => a.type === 'load_prefs')?.text ?? '';
    showInstantHelp = !/^ShowInstantHelp\s*=\s*false/m.test(prefs);
    const got = /^ReceivedHelp\s*=\s*\[([^\]]*)\]/m.exec(prefs);
    for (const n of (got?.[1] ?? '').trim().split(/\s+/)) {
      if (n !== '') receivedHelp.add(Number(n));
    }
  }
  const giveHelp = (help1: number, help2: number): void => {
    if (!showInstantHelp || receivedHelp.has(help1)) return;
    receivedHelp.add(help1);
    if (help2 !== -1) receivedHelp.add(help2);
    // **A help box the recording never answered is dismissed, not fatal.** It
    // is a `1str-title` — a `cStrDlog`, one way out — and the harness's own
    // dismissable set has it for exactly this reason: the box is raised by a
    // *preference*, and a recording made on a machine whose `ReceivedHelp`
    // differed by one id simply has no click here. `AllMageSpells` orphans help
    // 59 and 53; the C++ prints `[orphan] dialog '1str-title' … dismissing it`
    // and carries on. What must **not** happen is letting the click through as
    // a game action, which is the bug this whole mechanism exists to fix.
    if (!source.hasNext('click_control')) return;
    popClick(source, `the instant-help box for ${help1}`, () => { result.answered++; });
  };
  // **And the status effects raise it too**, from the bottom of the pipeline
  // (`cPlayer::web` and its five neighbours, pc.cpp:158-332). Without this the
  // recording's click for the box fell through to the driver's own switch and
  // bought a main-loop iteration — a `draw_terrain`, and in combat a die. One
  // Web on the party is five `web()` calls and one box.
  setGiveHelp(giveHelp);

  /**
   * `get_num_response` (strchoice.cpp:323) — the "type a number, or pick from a
   * list" dialog, replayed by control name. **Two dialogs, not one**: the outer
   * panel has the field, an optional `extra-led` and `okay`/`cancel`, and its
   * `choose` button opens a `cStringChoice` that pages **forty at a time**
   * (`per_page`, strchoice.hpp:31) with one-based LEDs within the page.
   *
   * Returns the number, or null if the outer dialog was cancelled. `ledToggle`
   * is called for a click on `extra-led`, which is how `debug_give_item` reads
   * its "identified" box.
   */
  const popNumResponse = async (
    src: typeof source, what: string, initial: number,
    onAnswered: () => void, listLength: number, ledToggle?: () => void,
  ): Promise<number | null> => {
    // `field_focus` with nothing typed leaves the initial value.
    let value = Number(typeInto(src, `${what} field`, String(initial), onAnswered));
    for (;;) {
      const id = popClick(src, what, onAnswered);
      if (id === 'okay') return value;
      if (id === 'cancel') return null;
      if (id === 'extra-led') { ledToggle?.(); continue; }
      if (id !== 'choose') continue;
      const PER_PAGE = 40;
      const last = Math.max(0, Math.trunc((listLength - 1) / PER_PAGE));
      let cur = value >= 0 && value < listLength ? value : 0;
      let page = Math.trunc(cur / PER_PAGE);
      for (;;) {
        const inner = popClick(src, `${what} list`, onAnswered);
        if (inner === 'done') { value = cur; break; }
        if (inner === 'cancel') break;
        if (inner === 'left') { page = page === 0 ? last : page - 1; continue; }
        if (inner === 'right') { page = page === last ? 0 : page + 1; continue; }
        const led = /^led(\d+)$/.exec(inner);
        if (led) { cur = page * PER_PAGE + Number(led[1]) - 1; continue; }
        // `strings` is the LED group itself; `search` opens a find box this
        // port does not model, and saying so beats guessing.
        if (inner === 'strings') continue;
        throw new Error(`replay: ${what} list was clicked '${inner}', `
          + 'which this port does not model');
      }
    }
  };

  const REDRAWS = new Set([
    'move', 'handle_target_space', 'handle_parry', 'handle_pause',
    'handle_spellcast', 'handle_equip_item', 'handle_use_item',
    'handle_give_item', 'handle_drop_item_id', 'handle_drop_item_location',
    'handle_rest', 'handle_combat_switch', 'handle_use_space',
    'handle_bash_pick', 'handle_pick_lock', 'handle_get_items',
    'handle_alchemy', 'handle_switch_pc_items', 'handle_begin_look',
    'handle_wait',
  ]);

  while (!source.exhausted) {
    const at = source.position;
    const action = source.pop();
    const inModal = picking !== null || getting !== null
      || helpDialog || notesDialog || prefsDialog !== null;
    if (!inModal) session.needRedraw = REDRAWS.has(action.type);
    try {
      // **An abandoned spell picker is a *cancelled* one.** The C++'s picker is
      // a modal `cDialog`, so the only ways out for a player are Cast and
      // Cancel — but a recording can hold `handle_spellcast` followed by
      // something that is not a click, and the oracle's replay driver dismisses
      // the dialog when that happens. Dismissal runs `finish_pick_spell` with
      // `spell_toast` set, which **writes `store_last_cast_mage`**
      // (boe.party.cpp:2041), and the next `pick_spell` opens on that caster
      // rather than on `univ.cur_pc`.
      //
      // This port used to drop the picker on the floor. In
      // `VoDT_20-04-2025_16-01-17` that is the difference between a Long Light
      // paid for by PC 3 and one paid for by PC 4 — and three hundred actions
      // later, a PC with no spell points left casting a spell the C++ refuses.
      if (picking !== null && action.type !== 'click_control') {
        picking.click('cancel');
        picking = null;
      }
      switch (action.type) {
        case 'move': {
          const dest = locationFromAction(action);
          // **A recorded move is not always one square, in any mode.** The
          // driver used to throw here when the destination was more than a step
          // from `center`, on the reasoning that
          // `handle_terrain_screen_actions` (boe.actions.cpp:302) builds every
          // destination as `center` plus one of the eight unit vectors, so a
          // longer one means the party is not where the recording's party was.
          //
          // **The reasoning is right about the *recorder* and wrong about the
          // *replay*.** A replayed `move` never goes through that function: it
          // reaches `handle_move` directly (boe.main.cpp:758), and `handle_move`
          // hands the destination to `pc_combat_move` / `town_move_party` /
          // `outd_move_party`, none of which check adjacency. The C++ therefore
          // teleports the party there and plays on — and the corpus contains
          // recordings where it does exactly that with the two engines' centres
          // *agreeing*: `ZKR-5-16-12-30` action 128 in combat, and
          // `VoDT_04-05-memory-dump-2` action 583 in **town**, where the C++'s
          // own `BOE_TRACE_CENTER` prints `center=(24,28)` and then walks the
          // party to (23,26) two squares away. The guard was an invention, it
          // was the single biggest stopper in the corpus (32 of 87 files), and
          // a rule this port keeps that the C++ does not is a divergence like
          // any other.
          //
          // Desync detection belongs in `scripts/diverge.mjs`, which compares
          // the two draw streams and cannot be fooled by a party that ends up
          // on the recording's square by accident.
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
        case 'handle_alchemy': {
          // `handle_alchemy` (boe.actions.cpp:1224) is three refusals and one
          // real path, and the refusals draw nothing — so the only thing that
          // has to be right here is *whether* the two dialogs go up, since
          // each one eats a `click_control` the driver would otherwise read as
          // a move.
          if (session.mode !== GameMode.TOWN) {
            if (isCombat(session.mode)) {
              session.univ.addStringToBuf('Alchemy: Not in combat.');
            } else if (!session.inTown) {
              session.univ.addStringToBuf('Alchemy: Only in town.');
            } else session.univ.addStringToBuf("Alchemy: Finish what you're doing first.");
            break;
          }
          if (!session.univ.party.alchemy.some((known) => known)) {
            session.univ.addStringToBuf('Alchemy: No recipes known.');
            break;
          }
          const host = session.host;
          if (!host) break;
          const who = await runSelectPc(session.univ, SelectPcMode.ONLY_LIVING,
            'Who will make a potion?', (rows, title, hl) => host.selectPc(rows, title, hl),
            { highlight: Skill.ALCHEMY });
          if (who >= 6) break;
          // `alch_choice` is the second modal: its answer is `potionN`, and
          // `cancel` walks away having mixed nothing.
          const choices = alchemyChoices(session.univ, who);
          const picked = source.pop('click_control');
          result.answered++;
          const which = potionSlot(picked.info.id ?? '');
          if (which >= 0 && choices.some((c) => c.which === which && c.canMake)) {
            makePotion(session, who, which);
          }
          break;
        }
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
            // **Starting a town fight costs a turn too**, and for the same
            // reason as ending one: the start branch sets `did_something = true`
            // (boe.actions.cpp:1335), so `advance_time` runs
            // `handle_monster_actions` on the way out — and by then the mode is
            // MODE_COMBAT, so it takes the combat arm and steps the round with
            // `combat_next_step`. The C++ spends thirteen `get_ran(1,1,100)`
            // there on `VoDT_04-05-2025_16-32-10` action 877 where this port
            // spent nothing and went straight on to the next recorded action.
            //
            // **Only when the fight actually starts.** The two refusals above
            // it — in a boat, on horseback — print a line and leave
            // `did_something` false (:1322, :1326), so the clock does not move;
            // charging a turn for them cost `ASR_11-05-2025_07-55-19` twenty
            // thousand draws, because the party was mounted and every recorded
            // toggle after that was one turn out.
            if (session.startCombat(session.univ.party.direction)) {
              await session.afterPartyTurn();
            }
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
        case 'handle_look': {
          // **`handle_look` is three steps, not one** (boe.actions.cpp:682):
          // `do_look` describes the square, then — in town or combat, and only
          // for an adjacent square — `adj_town_look` *searches* it, and last
          // a sign on it is read. This port had only the first, so a look at a
          // scripted square never ran its TOWN_LOOK special and a look into a
          // chest never opened it. The recording's clicks that answered those
          // two dialogs then landed on nothing, and the party walked on
          // without the loot: in `ASR_19-05-2025_19-38-44` that was two
          // scrolls of Flame, and two hundred actions later a `handle_use_item`
          // used whatever had shifted into slot 0 instead of casting them.
          const where = locationFromAction(action, 'destination');
          const ter = session.lookAt(where);
          if (ter < 0) break;
          if ((session.inTown || isCombat(session.mode))
            && dist(session.univ.party.townLoc, where) <= 1) {
            const contents = await session.adjTownLook(where);
            // `get_item(where,6,true)` — the container's own screen, which
            // stays up across the clicks that empty it. It costs no turn:
            // `handle_look` never sets `did_something`.
            if (contents && contents.length > 0) {
              getting = new GetItemsPick(session, contents);
              gettingFrom = where;
            }
          }
          break;
        }
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
          await session.handleUseSpace(locationFromAction(action));
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
          // **No mode gate here**: `replay_action` calls `handle_parry`
          // straight (boe.main.cpp:1103), where the `d` key and the SHIELD
          // button both gate on `MODE_COMBAT`. A recording made in a fight can
          // therefore replay a parry the party is no longer in a fight for,
          // and the oracle charges the turn for it.
          await session.parry();
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
              // still wanted when the click happened, and **the C++ assigns
              // it** — `num_targets_left = lexical_cast<short>(info[...])`,
              // boe.main.cpp:909, right before it calls `handle_target_space`.
              // The recorded number is *input*, not an assertion.
              //
              // This port used to compare and throw instead, on the reasoning
              // that the count falls out of the caster's level and the spell's
              // own table (`fancyTargetCount`) and so disagreeing about it is a
              // real divergence. That reasoning is sound and the check still
              // found nothing wrong: on `ZKR_16-05-2025_15-19-17` this port
              // matched the recording exactly for five clicks — 6, 5, 4, 3, 2 —
              // and then the recording jumped to **0** with one placement in
              // between. `place_target` moves the count by one, so a recording
              // that steps 2 → 0 is not describing an engine that disagreed
              // with this one; it is a stream this port cannot reconstruct and
              // the C++ does not try to. Three files stopped on it.
              //
              // So: assign, as the C++ does, and keep the comparison as a
              // trace (`DBGFANCY=1`) for anyone who wants to see the two
              // numbers side by side.
              const left = Number(action.info.num_targets_left ?? '0');
              if (process.env.DBGFANCY) {
                // eslint-disable-next-line no-console
                console.log(`      [ntl] rec=${left}`
                  + ` ours=${session.spellTargeting.targetsLeft}`);
              }
              session.spellTargeting.targetsLeft = left;
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
            //
            // **Doing nothing is not the same as costing nothing, though.**
            // `handle_target_space` sets `did_something = true` for every mode
            // but FANCY *whether or not any of its four branches fired*
            // (boe.actions.cpp:888), so the main loop's `advance_time` runs
            // `handle_monster_actions` and **the turn passes**. A recording
            // reaches this in town when `pick_spell` refused to open — the
            // clicks for the dialog that never appeared are orphans, and the
            // `handle_target_space` behind them still burns the turn.
            // `ASR_20-05-2025_08-49-39` action 986 is the case: the C++'s clock
            // goes 41,896 → 41,897 over an action that casts nothing.
            //
            // **And it does it in combat too**, where `did_something` reaches
            // `combat_next_step` rather than `do_monsters` — which is what
            // hands the turn to the next PC. This was a `TODO(M8)` on the
            // reasoning that nothing had been shown to need it;
            // `VoDT-5-11` needs it. Lenny arms a missile with 0 action points,
            // the shot never fires, and the C++'s `pick_next_pc` moves on to
            // Bart while this port left Lenny holding the turn — so every PC
            // afterwards was one behind, and the spells the recording meant
            // for Kat were cast by Adrianna, who could not afford them.
            await session.afterPartyTurn();
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
            // **The dual-caster hint toggle** (boe.actions.cpp:385). On replay
            // `spell_forced = spell_recast = info["spell_forced"]`
            // (boe.main.cpp:903), so this fires whenever the shortcut is used
            // in combat by a PC whose last cast was the *other* kind: it moves
            // the M/P hint over and returns without casting anything. It also
            // decides whether the next terrain redraw costs a die, since
            // `text_bar_text` asks `pc_can_cast_spell` about exactly this
            // field — see `textBar.ts`.
            if (isCombat(session.mode) && session.univ.currentPc.lastCastType !== type) {
              session.univ.currentPc.lastCastType = type;
              break;
            }
            // **The gate runs on the recast path too**, and this port skipped
            // it there. `pc_can_cast_spell(current_pc, type)` is the *first*
            // line of `combat_cast_mage_spell` (boe.combat.cpp:4554), above
            // the `if(!spell_forced)` that chooses between the picker and the
            // stored spell — so shift-M pays the encumbrance roll exactly as
            // **m** does. One draw per recast, and a recording full of them
            // drifts a draw at a time.
            if (isCombat(session.mode) && !combatCastCheck(session, type)) break;
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
          // Out of combat the picker only opens if somebody can cast: see
          // `SpellPick.open`. When it refuses, the `click_control`s the
          // recording holds for the dialog are orphans, and the C++ skips them
          // — which is what `picking === null` makes this driver do too.
          picking = SpellPick.open(session, type, !isCombat(session.mode));
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
        case 'adventure_notes':
          // `adventure_notes` (boe.infodlg.cpp:530). **The dialog only opens
          // when there is something in it**: an empty journal prints one line
          // and returns, so no clicks follow and nothing must be swallowed.
          if (session.univ.party.specialNotes.length === 0) {
            session.univ.addStringToBuf('Nothing in your journal.');
            break;
          }
          notesDialog = true;
          break;
        case 'talk_notes':
          // `talk_notes` (:594). Same shape, plus a refusal while a
          // conversation is on screen.
          if (session.mode === GameMode.TALKING) {
            session.univ.addStringToBuf("Talking notes: Can't read while talking.");
            break;
          }
          // TODO(M8): `univ.party.talk_save` — the conversation journal — is
          // not modelled here, so this port cannot tell an empty one from a
          // full one and always assumes the dialog opened. That is the safe
          // way round: a modal that swallows its own clicks costs nothing if
          // it was never really up, while missing one feeds the dialog's
          // buttons to the game as if they were moves.
          notesDialog = true;
          break;
        case 'pick_preferences':
          prefsDialog = {
            easy: session.univ.party.easyMode,
            lessWm: session.univ.party.lessWm,
          };
          break;
        case 'click_control': {
          const id = action.info.id ?? '';
          if (prefsDialog) {
            // A `cLed` toggles when clicked; a `cLedGroup`'s members select
            // instead, and the recording clicks the group's id and then the
            // member. Only these two ids are worth tracking — the others are
            // preferences — so everything else is swallowed as the modal's.
            if (id === 'easier') prefsDialog.easy = !prefsDialog.easy;
            else if (id === 'lesswm') prefsDialog.lessWm = !prefsDialog.lessWm;
            else if (id === 'okay' || id === 'cancel') {
              // `prefs_event_filter` writes nothing back on cancel (:1389).
              if (id === 'okay') {
                session.univ.party.easyMode = prefsDialog.easy;
                session.univ.party.lessWm = prefsDialog.lessWm;
              }
              prefsDialog = null;
            }
            break;
          }
          if (helpDialog) {
            helpDialog = false;
            break;
          }
          // The journal pages under `left`/`right` and deletes under `del`;
          // only `done` closes it (`attachClickHandlers`, boe.infodlg.cpp:615).
          if (notesDialog) {
            if (id === 'done' || id === 'cancel') notesDialog = false;
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
              // `get_item` asks the question after the screen has closed, not
              // as each item leaves the floor.
              if (getting.stole) session.reportTheft(gettingFrom);
              getting = null;
              if (gettingCostsTurn) {
                gettingCostsTurn = false;
                // **`take_ap(4)` is *after* the dialog** (boe.actions.cpp:1401):
                // `get_item` blocks there, so the acting PC keeps their points
                // for as long as the pile is on screen. Charging them when the
                // screen opened left a PC on zero while they were still picking,
                // which changes what `pick_next_pc` does next.
                if (gettingTakesAp) takeAp(session.univ, 4);
                // **The turn is stepped by whichever arm of
                // `handle_monster_actions` the *mode* selects**, which is not
                // the same question as which arm of `handle_get_items` took
                // the points: outdoors takes the points and still steps the
                // clock through `increase_age` and `do_monsters`.
                if (gettingInCombat) session.monsterActionsCombat();
                else await session.afterPartyTurn();
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
        case 'error':
          // The recording's own tombstone: the C++ writes one when a fatal
          // error dialog goes up and then *stops recording*, so it is always
          // the last action in the file. Its replay arm is a comment —
          // "recorded for debugging only. It should be triggered by replaying
          // the actions" (boe.main.cpp:1120) — so a replay that reaches it
          // without having crashed simply ends.
          break;
        case 'load_prefs':
          // Read up front instead — it is a `STARTUP_ACTIONS` member, so
          // `replayStartup` has already consumed it and this arm never runs.
          // See `readHelpPrefs` above.
          break;
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
          // **`post_load` puts the item pane back on PC 1** (`set_stat_window
          // (ITEM_WIN_PC1)`, boe.actions.cpp:3214), and the pane is whose pack
          // every item action indexes. A recording that flipped to PC 4's pack,
          // loaded a game and then gave item 0 away gave it *from PC 4* here and
          // from PC 1 there — and in `VoDT-5-11` the two happened to be the same
          // PC the recording was giving *to*, so `whoTo === pcNum` made the give
          // a silent no-op and the potion it should have handed over was still
          // in the wrong pack ten actions later when the recording used it.
          win.setStatWindow(session.univ, ItemWinMode.PC1);
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
          // changes the page, since the turn order decides who acts. The gates
          // (prime time, and a PC who is actually alive) live in the session —
          // see `switchPcItems`, which is what this used to be missing.
          if (session.switchPcItems(numberFromAction(action))) {
            win.setStatWindow(session.univ, numberFromAction(action) as ItemWinMode);
          }
          break;
        case 'handle_equip_item': {
          const slot = numberFromAction(action);
          // **The E button is not always Equip** (boe.actions.cpp:1083). With
          // "Use Space" armed, clicking beside an item *uses* it instead —
          // three action points, not one, and the mode drops back to TOWN. The
          // C++ even says so in the transcript. Without this branch a
          // recording that armed Use and then clicked an item equipped it here
          // and used it there, and the two equipped sets never agreed again.
          if (session.mode === GameMode.USE_TOWN) {
            session.univ.addStringToBuf(
              "Note: Clicking 'U' button by item uses the item.");
            await useItem(session, win.pcPage, slot, session.host ?? undefined);
            session.mode = GameMode.TOWN;
            takeAp(session.univ, 3);
            break;
          }
          // `prime_time()` (boe.actions.cpp:295) is the gate on all of these:
          // outdoors, town or combat, and nothing half-finished. Equipping
          // costs one action point, using costs three.
          if (session.primeTime) {
            session.toggleEquip(win.pcPage, slot);
            takeAp(session.univ, 1);
          } else if (session.itemShop !== null) {
            // `stat_screen_mode > MODE_SHOP` — an identify, sell, enchant or
            // recharge screen is up, and the C++ does **nothing at all** here,
            // not even the refusal. Its own comment says it isn't sure why.
          } else session.univ.addStringToBuf("Equip: Finish what you're doing first.");
          break;
        }
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
        case 'handle_new_pc': {
          // `handle_new_pc` (boe.actions.cpp:3680) — the Create PC button.
          // Three refusals, then `give_help(56,0)` and `create_pc(6,nullptr)`,
          // which is four dialogs in a row. The rules are in `game/createPc.ts`;
          // this feeds them the recording's control names.
          if (!session.inTown) {
            session.univ.addStringToBuf('Add PC: Town mode only.');
            break;
          }
          const spot = session.univ.party.pcs
            .findIndex((p) => p.mainStatus === MainStatus.ABSENT);
          if (spot < 0) {
            session.univ.addStringToBuf('Add PC: You already have 6 PCs.');
            break;
          }
          if (!session.univ.townRecord?.hasTavern) {
            session.univ.addStringToBuf('Add PC: You cannot add new characters in '
              + 'this town. Try in the town you started in.');
            break;
          }
          giveHelp(56, 0);

          const pc = newPc(session.univ, spot);

          // `pick_race_abil(pc, 0)` — race and the seventeen traits.
          const race = new RaceAbilPick(pc);
          for (;;) {
            const id = popClick(source, 'the race-and-traits dialog',
              () => { result.answered++; });
            const what = race.click(id);
            if (what === 'done') { race.keep(); break; }
            if (what === 'cancel') break;
          }

          // `spend_xp(spot, 0)` — and **a false return abandons the PC**
          // (boe.party.cpp:258), which is why Cancel puts the slot back to
          // ABSENT rather than leaving a half-built character in the party.
          const xp = new SpendXp(session.univ, spot, XpMode.CREATE);
          let kept = false;
          for (;;) {
            const act = source.pop('click_control');
            result.answered++;
            const what = xp.click(act.info.id ?? '',
              (Number(act.info.mods ?? '0') & 1) !== 0);
            if (what === 'info') {
              // `display_skills` / the About Health and About Spell Points
              // boxes: one more click closes whichever went up.
              popClick(source, 'the skill description box', () => { result.answered++; });
              continue;
            }
            if (what === 'keep') { xp.keep(); kept = true; break; }
            if (what === 'cancel') break;
          }
          if (!kept) {
            pc.mainStatus = MainStatus.ABSENT;
            break;
          }

          // `pick_pc_graphic(spot, 0)` — a `cPictChoice` over PC pictures
          // 0-36 with Cancel hidden.
          const pic = new PcGraphicPick(pc.whichGraphic);
          for (;;) {
            const id = popClick(source, 'the PC graphic picker',
              () => { result.answered++; });
            const what = pic.click(id);
            if (what === 'done') { pc.whichGraphic = pic.cur; break; }
            if (what === 'cancel') break;
          }

          // `pick_pc_name(spot)` — Okay only closes when the name is usable,
          // so this loops rather than taking the first click as final.
          for (;;) {
            const typed = typeInto(source, 'the PC name field', pc.name,
              () => { result.answered++; });
            const id = popClick(source, 'the PC name dialog', () => { result.answered++; });
            if (id === 'okay' && pcNameOk(typed)) { pc.name = typed; break; }
            if (id !== 'okay') break;
            pc.name = typed;
          }

          pc.mainStatus = MainStatus.ALIVE;
          // `if(overall_mode != MODE_STARTUP) finish_create();` — a PC built
          // during party creation is finalised later, one added to a live
          // party is finalised now.
          if (session.mode !== GameMode.STARTUP) pc.finishCreate();
          pc.curHealth = pc.maxHealth;
          pc.curSp = pc.maxSp;
          win.setStatWindowForPc(session.univ, session.univ.curPc);
          break;
        }
        case 'handle_drop_pc': {
          // `handle_drop_pc` (boe.actions.cpp:3646) — the Delete PC button. Two
          // refusals, then `select_pc(ANY)` and a **yes/no confirmation**, and
          // only then `kill_pc(..., ABSENT)`. `ANY` is the point: this is the
          // one selector that offers dead, stoned and dust PCs, since deleting
          // one is exactly what you would want to do with them.
          if (!session.primeTime) {
            session.univ.addStringToBuf('Delete PC: Finish what you are doing first.');
            break;
          }
          if (isCombat(session.mode)) {
            session.univ.addStringToBuf('Delete PC: Not in combat.');
            break;
          }
          const dlg = session.host;
          if (!dlg) break;
          const choice = await runSelectPc(session.univ, SelectPcMode.ANY,
            'Delete who?', (rows, title, hl) => dlg.selectPc(rows, title, hl));
          if (choice >= 6) break;
          // `delete-pc-confirm`, whose buttons are named `yes` and `no` — the
          // control names, not their labels, as everywhere else here.
          const picked = await dlg.choice(
            ['Delete this character?'],
            [{ name: 'yes', label: 'Yes' }, { name: 'no', label: 'No' }], '', 0, 0);
          const pc = session.univ.party.pcs[choice];
          if (picked === 0 && pc) {
            session.univ.addStringToBuf('Delete PC: OK.');
            killPc(session.univ, pc, MainStatus.ABSENT);
          } else session.univ.addStringToBuf('Delete PC: Cancelled.');
          break;
        }
        case 'new_party': {
          // `new_party` (boe.actions.cpp:3723) — File > New Game *while a game
          // is running*. With a party in memory it opens `restart-game`, a
          // two-button confirm whose controls are `okay` and `cancel`, and
          // **cancelling makes the whole action a no-op**: no turn, no draw,
          // nothing touched. That is the arm the corpus exercises
          // (`ASR_20-05-2025_07-20-41` presses it 3,382 actions in and backs
          // out), and the one worth being exact about, because the C++ charges
          // nothing for it either — `new_party` returns before `advance_time`.
          const dlg = session.host;
          if (!dlg) break;
          const picked = await dlg.choice(
            ['Starting over will discard any unsaved progress.',
              'Are you sure you want to do this?'],
            [{ name: 'okay', label: 'New Game' }, { name: 'cancel', label: 'Cancel' }],
            '', 0, 0);
          if (picked !== 0) break;
          // TODO(M8): the confirmed arm drops to the startup screen and runs
          // `start_new_game()`, which is the same flow `pick_a_scen` needs and
          // which this driver does not have yet. Stopping is the honest answer
          // — carrying on with the old party would make every action after this
          // a different game.
          result.unsupported['new_party (confirmed)'] =
            (result.unsupported['new_party (confirmed)'] ?? 0) + 1;
          result.error = "'new_party' was confirmed: the recording starts a fresh game here";
          result.errorAt = at;
          return result;
        }
        case 'cancel_item_target':
          // Leaving an identify or recharge queue (boe.actions.cpp:2579). **It
          // costs a turn** — the C++'s comment is "Time passes because a spell
          // was cast", since Identify and Recharge pay their spell points when
          // the screen opens and the clock is charged when it closes.
          if (session.endItemShop()) await session.afterPartyTurn();
          break;
        // The debug keys. They are not cheats a recording can be waved past:
        // each one changes real party state, and half the corpus's long
        // recordings press at least one.
        case 'use_spec_item': {
          // `use_spec_item` (boe.specials.cpp:578) — the 9 pane's special
          // items. One line: run the item's **scenario** special at the
          // party's square, in the `USE_SPEC_ITEM` context. It costs no turn,
          // takes no charge, and the item stays; everything it does it does
          // through the node.
          const which = numberFromAction(action);
          const spec = session.univ.scenario.specialItems[which]?.special ?? -1;
          if (spec < 0) break;
          await session.runSpecialRaw(SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN,
            spec, session.univ.party.getLoc());
          break;
        }
        case 'menu_give_help':
          // `menu_give_help(n)` is `give_help(n, 0, help_forced = true)`
          // (boe.main.cpp:1894) — **forced**, so it ignores both the
          // `ReceivedHelp` list and the `ShowInstantHelp` preference and always
          // puts the box up. It still records the id, so the id is still added.
          receivedHelp.add(numberFromAction(action));
          popClick(source, 'the Help menu box', () => { result.answered++; });
          break;
        case 'journal':
          // `journal()` (boe.infodlg.cpp:653). **It is always empty in this
          // build**: `add_to_journal(short)` exists and nothing calls it — no
          // special opcode reaches it — so the function takes its early return
          // every time, prints one line and opens no dialog. Ported as the
          // early return, with the entries themselves left out: a `<journal>`
          // node in a scenario is parsed and never fired.
          session.univ.addStringToBuf('Nothing in your events journal.');
          break;
        case 'show_debug_help':
          // boe.actions.cpp:2627 — the panel of debug keys. **Every button
          // toasts and does nothing else while replaying** — the C++'s own
          // comment says "In a replay, the action will have been recorded next
          // anyway" — so all this owes is the one click that closed it.
          popClick(source, 'the debug help panel', () => { result.answered++; });
          break;
        case 'debug_heal':
          // boe.actions.cpp:2541. `revive_all_dead(false)` is the *partial*
          // arm: the dead come back and then the party is healed 250 and given
          // 100 spell points **through the normal caps**, where
          // `debug_heal_plus_extra`'s `true` arm sets health to maximum and
          // spell points to a flat 100 regardless.
          session.univ.party.gold += 100;
          session.univ.party.food += 100;
          for (const pc of session.univ.party.pcs) {
            if (isDeadStatus(pc.mainStatus)) pc.mainStatus = MainStatus.ALIVE;
          }
          session.univ.party.healAll(250);
          session.univ.party.restoreSpAll(100);
          session.univ.addStringToBuf('Debug: Heal party.');
          break;
        case 'debug_clean_up':
          // `univ.party.clear_bad_status()` (:2430) — every PC, every effect.
          for (const pc of session.univ.party.pcs) pc.clearBadStatus();
          session.univ.addStringToBuf('Debug: You get cleaned up!');
          break;
        case 'debug_stealth_detect_life_firewalk': {
          // :2440 — ten turns of each, added rather than set.
          const st = session.univ.party.partyStatus;
          st[PartyStatus.STEALTH] += 10;
          st[PartyStatus.DETECT_LIFE] += 10;
          st[PartyStatus.FIREWALK] += 10;
          session.univ.addStringToBuf('Debug: Stealth, Detect Life, Firewalk!');
          break;
        }
        case 'debug_fly':
          // :2453 — and it is outdoors only, with its own refusal.
          if (session.mode !== GameMode.OUTDOORS) {
            session.univ.addStringToBuf('Debug: Can only fly outdoors.');
          } else {
            session.univ.party.partyStatus[PartyStatus.FLIGHT] += 10;
            session.univ.addStringToBuf('Debug: You start flying!');
          }
          break;
        case 'debug_magic_map': {
          // :2379 — the whole of whichever map the party is standing on.
          const { univ } = session;
          if (session.mode === GameMode.OUTDOORS) {
            for (const row of univ.out.explored) row.fill(1);
          } else if (univ.town) {
            for (let x = 0; x < univ.town.record.maxDim; x++)
              for (let y = 0; y < univ.town.record.maxDim; y++) univ.town.makeExplored(x, y);
          }
          univ.addStringToBuf('Debug:  Magic Map.');
          break;
        }
        case 'debug_refresh_stores':
          session.univ.refreshStoreItems();
          session.univ.addStringToBuf('Debug: Refreshed jobs/shops.');
          break;
        case 'debug_increase_age':
          // :2503 — and the two lines are printed *before* the clock moves.
          session.univ.addStringToBuf('Debug: Increase age.');
          session.univ.addStringToBuf('  It is now 1 day later.');
          session.univ.party.age += 3700;
          break;
        case 'debug_towns_forget':
          // :2514 — the four saved town populations are orphaned by setting
          // their town number out of range, so every town repopulates.
          session.univ.addStringToBuf('DEBUG: Towns have short memory.');
          session.univ.addStringToBuf('Your deeds have been forgotten.');
          for (const pop of session.univ.party.creatureSave) pop.whichTown = TOWN_NUM_OUTDOORS;
          break;
        case 'debug_hurt_party': {
          // :2327 — `select_pc(ONLY_LIVING, …, all_option = true)`, where **7
          // means everyone**; the wound is "half your maximum, or what you have
          // already, whichever is lower".
          const dlg = session.host;
          if (!dlg) break;
          const who = await runSelectPc(session.univ, SelectPcMode.ONLY_LIVING,
            'Hurt who?', (rows, title, hl) => dlg.selectPc(rows, title, hl));
          // `select_pc(..., all_option = true)` adds an "All" button, which the
          // replay host already maps to `SELECT_PC_ALL` = 7.
          if (who === SELECT_PC_CANCEL || who === SELECT_PC_NONE) break;
          session.univ.party.pcs.forEach((pc, i) => {
            if (i === who || (pc.isAlive && who === SELECT_PC_ALL)) {
              pc.curHealth = Math.min(pc.curHealth, Math.trunc(pc.maxHealth / 2));
            }
          });
          break;
        }
        case 'debug_step_through':
          // :2247 — a scripting-debug toggle. Nothing in this port reads it
          // yet (the C++ pauses on each special node), but it is universe
          // state a recording sets. TODO(M8) if a node ever has to stop.
          session.univ.nodeStepThrough = !session.univ.nodeStepThrough;
          session.univ.addStringToBuf(session.univ.nodeStepThrough
            ? 'Debug: Step-through enabled' : 'Debug: Step-through disabled');
          break;
        case 'debug_leave_town':
          // :2258 — `end_town_mode(false, {0,0}, debug_leave = true)`, which is
          // the arm that skips the exit specials and the boundary maths and
          // simply puts the party back where it came from.
          if (session.mode === GameMode.OUTDOORS) {
            session.univ.addStringToBuf("Debug - Leave Town: You're not in town!");
            break;
          }
          session.univ.addStringToBuf('Debug: Reunite party and leave town.');
          session.debugLeaveTown();
          break;
        case 'debug_enter_town': {
          // boe.actions.cpp:2396 — `get_num_response` over every town name,
          // then `start_town_mode(town, dir, debug_enter = true)`, which skips
          // the town's entry specials. With the `debug-enter-town` feature flag
          // at `move-outdoors` the party is first repositioned onto the town's
          // **first** outdoor entrance, so that leaving puts it somewhere sane.
          const { univ } = session;
          const value = await popNumResponse(
            source, 'the debug town number', 0, () => { result.answered++; },
            univ.scenario.towns.length);
          if (value === null || value < 0) break;
          if (hasFeatureFlag('debug-enter-town', 'move-outdoors')) {
            // `find_town_entrances` sweeps the sectors in x-then-y order and
            // takes the first `city_locs` entry naming this town.
            outer: for (let x = 0; x < univ.scenario.outWidth; x++) {
              for (let y = 0; y < univ.scenario.outHeight; y++) {
                const sector = univ.scenario.outdoors[x]?.[y];
                if (!sector) continue;
                const at = sector.cityLocs.find((c) => c.spec === value);
                if (at) { session.positionParty(x, y, at.x, at.y); break outer; }
              }
            }
          }
          const dir = univ.party.direction === Direction.N ? 2
            : univ.party.direction === Direction.S ? 0
              : univ.party.direction < Direction.S ? 3 : 1;
          session.startTownMode(value, dir, true);
          break;
        }
        case 'debug_ghost_mode':
          // boe.actions.cpp:2467 — walk through walls. Nothing else in this
          // port reads it yet, but it is universe state a recording can set.
          session.univ.ghostMode = !session.univ.ghostMode;
          session.univ.addStringToBuf(
            session.univ.ghostMode ? 'Debug: Ghost mode ON.' : 'Debug: Ghost mode OFF.');
          break;
        case 'debug_heal_plus_extra': {
          // boe.actions.cpp:2553 — gold, food, a full revive, 25 xp each, every
          // spell, and the shops restocked. `revive_all_dead(true)` is the
          // *full restore* arm: health to maximum and **spell points to a flat
          // 100**, not to `max_sp` (:2532).
          const { univ } = session;
          univ.party.gold += 100;
          univ.party.food += 100;
          for (const pc of univ.party.pcs) {
            if (isDeadStatus(pc.mainStatus)) pc.mainStatus = MainStatus.ALIVE;
            pc.curHealth = pc.maxHealth;
            pc.curSp = 100;
          }
          awardPartyXp(univ, 25);
          for (const pc of univ.party.pcs) {
            pc.mageSpells.fill(true);
            pc.priestSpells.fill(true);
          }
          univ.refreshStoreItems();
          univ.addStringToBuf('Debug: Add stuff and heal.');
          break;
        }
        case 'debug_give_item': {
          // boe.actions.cpp:2166 — `get_num_response` over every scenario item,
          // with an `identified` LED that starts **on**. The chosen item is
          // given to the current PC with `GIVE_ALLOW_OVERLOAD`, and if that
          // fails, to anyone who will take it.
          const { univ } = session;
          let ident = true;
          const value = await popNumResponse(
            source, 'the debug give-item dialog', lastDebugItem,
            () => { result.answered++; }, univ.scenario.scenItems.length,
            () => { ident = !ident; });
          if (value === null) break;
          lastDebugItem = value;
          const template = univ.scenario.scenItems[value];
          if (template === undefined) break;
          // `scen_items[i].ident = ident` around the give, then put back — so
          // it is the *copy in the pack* that comes out identified.
          const item = { ...template, ident };
          const pc = univ.currentPc;
          let given = giveItem(pc, univ.party, item, false, true).status === GiveStatus.OK;
          if (!given) {
            univ.addStringToBuf(`Debug: can't give to ${pc.name}`);
            given = univ.party.pcs.some((other) =>
              giveItem(other, univ.party, item, false, true).status === GiveStatus.OK);
          }
          if (!given) {
            univ.addStringToBuf(`Debug: can't give anyone ${template.fullName}`);
          }
          break;
        }
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
        case 'handle_info_request': {
          // `handle_info_request` (boe.dlgutil.cpp:510) — the little **?**
          // beside a shop row. It changes nothing at all: every arm opens a
          // description box and closes it again. What it *does* do is eat the
          // click that closes that box, and four of the shop item types open
          // no box, so whether there is a click to eat depends on the row.
          const shop = session.shop;
          const entry = shop?.shop.getItem(numberFromAction(action));
          const silent = entry === undefined
            || entry.type === ShopItemType.EMPTY
            || entry.type === ShopItemType.TREASURE
            || entry.type === ShopItemType.CLASS
            || entry.type === ShopItemType.OPT_ITEM;
          if (!silent) {
            // The two paged dialogs — `display_spells` and the item info — have
            // arrows of their own, so anything but the closing click is read
            // as one of those and the loop goes round again.
            for (;;) {
              const id = popClick(source, 'the shop item description box',
                () => { result.answered++; });
              if (id !== 'left' && id !== 'right') break;
            }
          }
          break;
        }
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
          // boe.actions.cpp:1389. **The split is `MODE_TOWN` against
          // *everything else*, not town against combat.** Only the town arm
          // sweeps from `univ.party.town_loc`; the `else` sweeps from
          // `univ.current_pc().combat_pos` and spends `take_ap(4)` — and
          // outdoors falls into that `else` too, where `combat_pos` is a stale
          // leftover from the last fight and the town data behind it is
          // whatever was last loaded. So pressing **g** on the world map
          // rummages the square the acting PC stood on in their last battle,
          // finds whatever was dropped there, and **charges a turn for it**.
          // It reads like a bug and it is kept: this port asked from
          // `town_loc` outdoors, found nothing, charged nothing, and its clock
          // fell six ticks behind the C++'s for the rest of
          // `VoDT_09-04-2025_09-41-10` — outdoors `increase_age` rounds down to
          // a multiple of ten before adding ten, so one skipped turn is not one
          // tick but however many the rounding swallows.
          const inFight = session.mode !== GameMode.TOWN;
          const from = inFight
            ? session.univ.currentPc.combatPos : session.univ.party.townLoc;
          const { items } = session.reachableItems(from);
          // `DBGGET=1` — which arm this took, the square it swept and how many
          // items answered; the pair to the harness's `BOE_TRACE_GET=1`
          // `[getitem]`. Worth having because the two arms differ only in the
          // square, and outdoors that square is a stale `combat_pos` whose
          // value neither engine prints anywhere else.
          if (process.env.DBGGET) {
            // eslint-disable-next-line no-console
            console.log(`      [getitem] mode=${session.mode}`
              + ` town=${session.univ.party.townNum}`
              + ` cur_pc=${session.univ.curPc}`
              + ` from=(${from.x},${from.y}) items=${items.length}`);
          }
          // `get_item` only puts the screen up when there is something to put
          // on it, so with an empty square the `click_control`s that would have
          // answered it are simply not in the recording either.
          getting = items.length > 0 ? new GetItemsPick(session, items) : null;
          gettingFrom = from;
          // **Rummaging costs a turn**, and it is spent when the screen closes:
          // `get_item` runs the dialog inline and `handle_get_items` sets
          // `did_something` from its return, which is 1 as soon as there was
          // anything in reach — not when something was actually taken
          // (boe.items.cpp:277). With no screen there is nothing to close, so
          // the turn is charged here instead.
          // **The turn is stepped when the screen *closes*, in combat as well as
          // in town.** The C++ runs `get_item`'s dialog inline, so `take_ap(4)`
          // happens first and `did_something` — and therefore
          // `combat_next_step` — only after the last click has been answered.
          // This port raises the screen and returns, so calling
          // `afterCombatAction` here advanced `cur_pc` while the pile was still
          // on screen; `GetItemsPick.usable` refuses any PC but the acting one
          // in combat, so the carrier silently moved on to the next PC and
          // every item went into the wrong pack.
          if (getting !== null) gettingCostsTurn = true;
          gettingTakesAp = inFight;
          gettingInCombat = isCombat(session.mode);
          if (inFight && getting === null) {
            // **The four points are taken whether or not there was anything
            // there, and the *turn* is not** (boe.actions.cpp:1401 against
            // :1403). `take_ap(4)` sits above the `if(j > 0)` that sets
            // `did_something`, so rummaging an empty square in combat costs the
            // PC every point they had and still leaves them active on zero —
            // `combat_next_step` never runs, so nobody takes over. This port
            // advanced the turn regardless, which handed the item pane to the
            // next PC; `handle_equip_item` is given `stat_window`, so the
            // equips that followed went into the wrong pack.
            // **Nothing in reach: no screen, so the four points are spent
            // here** — and the turn is *not* stepped, because `did_something`
            // stays false (boe.actions.cpp:1401 against :1403). A PC who
            // rummages an empty square in combat spends every point they had
            // and stays active on zero.
            takeAp(session.univ, 4);
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
      // **`redraw_everything()` runs once per main-loop iteration, and a replay
      // runs exactly one action per iteration** (boe.main.cpp:1452 and :1513).
      // It is `redraw_screen(REFRESH_ALL)`, whose default branch ends in
      // `draw_text_bar()` (boe.graphics.cpp:628) — and *that* spends an
      // encumbrance roll per equipped awkward item once the acting PC has cast
      // anything, because `text_bar_text` asks `pc_can_cast_spell` which of
      // "Recast X" and "Cannot recast" to print. See `textBar.ts`: the rule was
      // ported long ago and nothing called it.
      //
      // This is the one redraw of the five that is *structural* rather than
      // scattered: once per iteration, after the action. The gates inside
      // `text_bar_text` make it free for most of a recording — out of combat,
      // or with a PC who has never cast, nothing is drawn at all.
      //
      // **A click a modal swallows is not an iteration.** The C++'s dialogs run
      // their own event loop and *pull* actions out of the recording
      // themselves, so `handle_spellcast` plus the four `click_control`s that
      // work the casting dialog are **one** trip round the main loop, not five
      // — its `[advtime]` line (`BOE_TRACE_MMOVE=1`) prints once for the whole
      // group, after the click that closes the dialog. Testing "is a modal
      // still up now?" reproduces that exactly: the opening action and every
      // click inside are skipped, and the closing one fires.
      const modalUp = picking !== null || getting !== null
        || helpDialog || notesDialog || prefsDialog !== null;
      if (!modalUp) {
        // `advance_time`'s tail: `if(need_redraw) draw_terrain();`
        // (boe.actions.cpp:1931), which runs *before* the main loop's redraw
        // below it and is the fifth of the five sites round a combat cast.
        if (session.needRedraw) drawTerrain(session);
        drawTerrain(session);
      }
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
