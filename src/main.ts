/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { animAt, animSchedule, combatPace, setCombatPace } from './game/anim';
import { useItem } from './game/itemUse';
import { dropItemAt, handleDropItem, handleGiveItem } from './game/giveDrop';
import {
  PcChoice, SELECT_PC_CANCEL, SelectPcMode, SelectPcOpts, runSelectPc,
} from './game/selectPc';
import type { SpecialHost } from './game/specials/context';
import { SpecCtx, SpecCtxType } from './game/specials/context';
import { Location, dist, locsEqual, shiftLoc } from './core/location';
import { SpellPat } from './data/pattern';
import { SPELLS, Spell, spellName } from './data/spell';
import { CastStatus, castableSpells } from './game/spellCast';
import { castSpell } from './game/spellTown';
import { combatCastCheck, combatCastSpell } from './game/spellCombat';
import {
  cancelSpellTargeting, castCollected, doCombatCast, placeTarget, spellCastHitReturn,
} from './game/spellCombatTarget';
import { takeAp } from './game/combat';
import { openJobBank } from './game/jobBank';
import { alchemyChoices, makePotion } from './game/alchemy';
import { getDialogDef, loadDialogDefs } from './dialogs/dialogStore';
import { XmlDialog } from './dialogs/xmlDialog';
import { pcInfoDialog } from './dialogs/pcInfoDialog';
import { itemInfoDialog } from './dialogs/itemInfoDialog';
import { STR_DIALOG_DEFS, pictTypeOf, strDialog } from './dialogs/strDialog';
import { storyDialog } from './dialogs/storyDialog';
import { monsterInfoDialog } from './dialogs/monsterInfoDialog';
import { jobBoardDialog } from './dialogs/jobBoardDialog';
import { pickPotionDialog, potionSlot } from './dialogs/pickPotionDialog';
import { questInfoDialog } from './dialogs/questInfoDialog';
import { NOTES_DIALOG_DEFS, adventureNotesDialog, talkNotesDialog } from './dialogs/notesDialogs';
import {
  INPUT_DIALOG_DEFS, errorDialog, numOfItemsDialog, numResponseDialog, textResponseDialog,
} from './dialogs/inputDialogs';
import { setFieldErrorSink } from './dialogs/xmlDialog';
import { PICT_CHOICE_DIALOG_DEFS } from './dialogs/pictChoiceDialog';
import { SPEND_XP_DIALOG_DEFS, spendXpDialog } from './dialogs/spendXpDialog';
import { XpMode } from './game/createPc';
import { setErrorSink } from './game/showError';
import { appendIarrayPref, getBoolPref, iarrayPrefContains } from './platform/prefs';
import { notesRefusal } from './game/notes';
import { ItemWinMode, QUEST_COMPLETED_OFFSET } from './game/itemWindow';
import { BASIC_BUTTON_KEYS } from './game/specials/oneshot';
import { specItemUseable } from './data/quest';
import { trappedMonsters } from './game/soulCrystal';
import { cancelTownTargeting, castTownSpell, startTownTargeting } from './game/spellTarget';
import { CastDialog } from './dialogs/castDialog';
import { forcedCast } from './game/spellRepeat';
import { GetItemsDialog } from './dialogs/getItemsDialog';
import { placeSpellPattern } from './game/spellPatterns';
import { GameMode, isCombat, isOut, isScrollable } from './game/modes';
import { Boom, setBoomSink } from './game/booms';
import { FocusEvent, animPending, setAnimWaiter, setFocusSink } from './game/anim';
import { Missile, setMissileSink } from './game/missileAnim';
import { pickNextPc } from './game/combat';
import { GameRng } from './core/rng';
import { DialogHost } from './dialogs/dialog';
import { STRING_TABLES, getStr, loadStringTables } from './data/strings';
import { TerSpec } from './data/terrain';
import { GameSession } from './game/session';
import { TalkAction } from './game/talk';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { applySave, readSavePreview, saveGame } from './fileio/saveIo';
import {
  SaveSlot, exportSave, getSave, importSave, listSaves, putSave, saveStoreAvailable,
} from './platform/saveStore';
import { AutosaveReason, getAutosavePrefs, setAutosaveSink } from './game/autosave';
import { MENU_SEPARATOR, installMenuBar } from './platform/menu';
import { showStartupScreen } from './platform/startup';
import { readScenarioFromXml } from './fileio/scenarioXml';
import { parseXmlDoc } from './fileio/xml';
import { TOWN_NUM_OUTDOORS } from './universe/party';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { Snd, SoundPlayer } from './platform/sound';
import { setGiveHelp, setLivingSound } from './universe/living';
import { BOE_HEIGHT, BOE_WIDTH, ToolbarButton } from './render/layout';

import { CHROME_SHEETS, Screen } from './render/screen';
import { ShopHit, shopItemInfo } from './render/shopScreen';
import { SheetStore } from './render/sheets';
import { PartyPreset, Player } from './universe/player';
import { doRest } from './game/rest';
import { SpellPick } from './game/spellPick';
import { MainStatus, NUM_SKILLS, Skill, Status } from './universe/skills';
import { Universe } from './universe/universe';

/** Terrain animation ticks at 4 Hz, matching the C++ animation timer. */
const ANIM_INTERVAL_MS = 250;

const DEFAULT_SCENARIO = 'valleydy';

/**
 * `?scenario=` names a scenario directly and skips the startup screen — which
 * is what a direct link, a cross-scenario load and the headless verifier all
 * want. Null means "ask".
 */
function scenarioFromQuery(): string | null {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return q && /^[a-z0-9_-]+$/i.test(q) ? q : null;
}

/**
 * The scenarios shipped in `public/scenarios`. There's no directory listing to
 * fetch over HTTP, so the ids live here; their titles and teasers come out of
 * each one's own `scenario.xml`, so nothing is duplicated but the id.
 */
const BUNDLED_SCENARIOS = ['valleydy', 'stealth', 'zakhazi', 'busywork'];

/**
 * A save for a scenario other than the one running can't be applied in place —
 * the whole world would have to be re-fetched. Instead the slot is parked here
 * and the page reopened on the right scenario, which `main` then notices.
 */
const PENDING_SAVE_KEY = 'exile-js.pendingSave';

/**
 * `?pace=` overrides the combat animation speed: 1 is normal, larger is slow
 * motion, smaller is brisk. See `combatPace` — the default is set there, and
 * `-`/`=` change it while the game is running.
 */
function applyPaceFromQuery(): void {
  const q = new URLSearchParams(window.location.search).get('pace');
  const n = q === null ? NaN : Number(q);
  if (Number.isFinite(n) && n > 0) setCombatPace(n);
}

const LOADING_UI = ['spinner', 'loading-file', 'progress-wrap'];

function hideLoadingUi(): void {
  for (const id of LOADING_UI) document.getElementById(id)?.classList.add('hidden');
}

/** The spinner starts visible; the startup screen hides it and this puts it back. */
function showLoadingUi(): void {
  for (const id of LOADING_UI) document.getElementById(id)?.classList.remove('hidden');
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  canvas.width = BOE_WIDTH;
  canvas.height = BOE_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  applyPaceFromQuery();
  // The startup screen, unless a scenario was named outright. It needs the
  // save list and each scenario's title, both cheap: four small XML headers and
  // one IndexedDB read, against the megabytes the scenario itself will cost.
  let name = scenarioFromQuery();
  let openSlot = window.sessionStorage.getItem(PENDING_SAVE_KEY);
  window.sessionStorage.removeItem(PENDING_SAVE_KEY);
  if (name === null) {
    hideLoadingUi();
    document.body.classList.add('starting');
    status.textContent = 'Choose a game.';
    const headers = await Promise.all(BUNDLED_SCENARIOS.map(async (id) => {
      try {
        const url = `${import.meta.env.BASE_URL}scenarios/${id}/scenario.xml`;
        const hdr = readScenarioFromXml(await parseXmlDoc(await (await fetch(url)).text(), url));
        return { id, title: hdr.title, blurb: hdr.teasers.find((t) => t !== '') ?? '' };
      } catch {
        // A scenario that won't even parse its header is still offered by id,
        // so the screen never comes up empty because of one bad directory.
        return { id, title: id, blurb: '' };
      }
    }));
    const saves = saveStoreAvailable() ? await listSaves() : [];
    const choice = await showStartupScreen(
      document.getElementById('startup-host')!,
      headers,
      saves.map((slot) => ({
        slot: slot.name,
        scenarioId: slot.preview.scenarioId,
        // The scenario's title if it is one of the bundled four, else its id —
        // a save can name a scenario that isn't installed, which is the case
        // the C++ shows "could not be found" for.
        label: `${headers.find((h) => h.id === slot.preview.scenarioId)?.title
          ?? slot.preview.scenarioId} — day ${Math.floor(slot.preview.age / 3700) + 1}`
          + ` (${new Date(slot.savedAt).toLocaleString()})`,
      })),
    );
    name = choice.scenarioId;
    openSlot = choice.slot ?? null;
    document.body.classList.remove('starting');
  }
  showLoadingUi();

  // Progress UI: total starts at the fixed-size loads (opcodes, string
  // tables, dialog defs, sheets, fonts, scenario.xml itself) and grows once
  // the scenario header reveals how many town/sector files are still coming.
  const progressBar = document.getElementById('progress-bar');
  const loadingFile = document.getElementById('loading-file');
  let total = 0;
  let done = 0;
  const addTotal = (n: number): void => { total += n; };
  const tick = (label: string): void => {
    done++;
    if (progressBar) progressBar.style.width = `${Math.min(100, (done / Math.max(1, total)) * 100)}%`;
    if (loadingFile) loadingFile.textContent = label;
    status.textContent = `Loading ${name}… (${done}/${total})`;
  };
  status.textContent = `Loading ${name}…`;

  // Root-relative URLs (`/data/...`) get GH Pages' repo-subpath base prefixed
  // in production builds; import.meta.env.BASE_URL is '/' in dev.
  const fetchText = async (url: string): Promise<string> => {
    const path = url.replace(/^\//, '');
    const text = await (await fetch(import.meta.env.BASE_URL + path)).text();
    tick(path);
    return text;
  };
  // Sheets and fonts don't depend on the scenario data, so kick them off
  // right away instead of waiting behind opcodes/strings/dialogs/scenario.
  const store = new SheetStore();
  const sheets = [
    ...CHROME_SHEETS,
    'ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim',
    'dlogbtnlg', 'dlogbtnmed', 'dlogbtnsm', 'dlogbtnled', 'dlogbtnhelp',
    'dlogbtntall', 'dlgbtnred', 'dlogpics',
    // `scenpics` is PIC_SCEN, which is what a message node with no picture of
    // its own falls back to (the scenario's own icon); `bigscenpics` is the
    // -lg variant, and `staticons` is PIC_STATUS.
    'scenpics', 'bigscenpics',
  ];
  for (let i = 1; i <= 11; i++) sheets.push(`monst${i}`);
  const dialogNames = ['pc-info', 'quest-info', 'get-items', 'item-info', 'many-str', 'monster-info', 'job-board',
    'pick-potion', 'party-death', 'steal-item', ...STR_DIALOG_DEFS, ...NOTES_DIALOG_DEFS,
    ...INPUT_DIALOG_DEFS, ...PICT_CHOICE_DIALOG_DEFS, ...SPEND_XP_DIALOG_DEFS];
  addTotal(1 /* opcodes */ + STRING_TABLES.length + dialogNames.length + sheets.length
    + (document.fonts ? 4 : 0) + 1 /* scenario.xml */);

  const sheetsReady = Promise.all(sheets.map((s) => store.load(s).then((r) => { tick(`data/graphics/${s}.png`); return r; })));
  // Fonts load lazily on first use, so `fonts.ready` alone isn't enough — ask
  // for each face explicitly or the first paint lays out with fallback metrics.
  const fontsReady = document.fonts
    ? Promise.all([
      document.fonts.load('12px BoEPlain').then((r) => { tick('fonts/plain.ttf'); return r; }),
      document.fonts.load('bold 10px BoEBold').then((r) => { tick('fonts/bold.ttf'); return r; }),
      document.fonts.load('18px BoEDungeon').then((r) => { tick('fonts/dungeon.ttf'); return r; }),
      document.fonts.load('12px BoEMaidenword').then((r) => { tick('fonts/maidenword.ttf'); return r; }),
    ]).then(() => document.fonts.ready)
    : Promise.resolve();

  // Shops name their stock out of the string resources while parsing, so
  // strings have to be in place before the scenario loads; opcodes and the
  // dialog defs (the ~60 of 211 the player needs) have no such ordering
  // requirement, so all three load concurrently.
  const [opcodes] = await Promise.all([
    loadOpcodes(fetchText),
    loadStringTables(fetchText),
    loadDialogDefs(fetchText, dialogNames),
  ]);
  const scen = await loadScenario(
    new FetchSource(`${import.meta.env.BASE_URL}scenarios/${name}/`, tick),
    opcodes,
    addTotal,
  );

  await Promise.all([sheetsReady, fontsReady]);

  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  const sound = new SoundPlayer();
  session.sound = sound;
  // iLiving's effects call one_sound/play_sound from deep inside the damage
  // pipeline, where there's no session to hand; the C++ uses globals for the
  // same reason (universe/living.ts).
  /**
   * Sounds ride the animation timeline. The C++ animates by blocking, so a
   * noise raised after `do_missile_anim` is simply heard after the missile has
   * landed; here the game logic runs straight through, so the *host* holds each
   * sound until the queue reaches it. `animAt()` is the wall clock whenever
   * nothing is animating, so out of combat this changes nothing.
   */
  const playSound = (which: number): void => {
    animSchedule(() => sound.play(which), animAt());
  };
  setLivingSound(playSound);
  // Transcript lines wait for their slot too, for the same reason: the C++
  // repaints the pane after the animation, not during it.
  univ.transcriptClock = animAt;
  session.startNewGame();
  const screen = new Screen(ctx, store);
  // `set_stat_window(ITEM_WIN_PC1)` from create_pc_graphics (boe.party.cpp:226)
  // — the panel's list and scroll limit are set before it is first drawn.
  screen.itemWindow.setStatWindowForPc(univ, 0);

  const redraw = (): void => {
    screen.draw(session);
    dialogs.draw();
  };
  const dialogs = new DialogHost(ctx, store, () => redraw());

  /**
   * `showError` / `showWarning` — for the game rules (`game/showError.ts`)
   * and for a text field that won't take what was typed. Both open on top of
   * whatever is up, as the C++'s do with their `parent`.
   */
  const showErrorBox = (str1: string, str2 = '', warning = false): void => {
    void dialogs.runNested(errorDialog(ctx, store, str1, str2, warning)).then(() => redraw());
  };
  setErrorSink(showErrorBox);

  /**
   * `give_help` (strdlog.cpp:182) — the "Instant Help" box, shown once per
   * message unless the player has turned instant help off. What has been seen
   * is a *preference*, not part of the save, so it outlives the game.
   */
  setGiveHelp((help1, help2, forced) => {
    if (!forced && (!getBoolPref('ShowInstantHelp', true)
      || iarrayPrefContains('ReceivedHelp', help1))) return;
    appendIarrayPref('ReceivedHelp', help1);
    if (help2 !== -1) appendIarrayPref('ReceivedHelp', help2);
    const str1 = getStr('help', help1);
    const str2 = help2 > 0 ? getStr('help', help2) : '';
    sound.play(57);
    void dialogs.runNested(strDialog(ctx, store, {
      str1, str2, title: 'Instant Help', pic: 24, picType: 4,
    })).then(() => redraw());
  });
  setFieldErrorSink((message) => showErrorBox(message));

  /**
   * get_text_response (boe.items.cpp:869): a one-line typed answer,
   * lowercased. `lowercase` is false only for this port's own save-slot
   * names, which are not a game answer and keep the player's capitals.
   */
  const askForText = async (prompt: string, lowercase = true): Promise<string> => {
    const { dlg, result } = textResponseDialog(ctx, store, prompt, undefined, lowercase);
    return result(await dialogs.runNested(dlg));
  };

  /** get_num_response (strchoice.cpp:323) — IF_NUM_RESPONSE's number. */
  const askForNum = async (min: number, max: number, prompt: string): Promise<number> => {
    const { dlg, result } = numResponseDialog(ctx, store, min, max, prompt,
      (msg) => showErrorBox(msg));
    return result(await dialogs.runNested(dlg));
  };

  /**
   * The select-PC dialog. Which PCs may be picked is worked out by
   * `game/selectPc.ts`; this only draws the rows and hands back what was
   * clicked, using `select_pc`'s own return codes — 6 for cancel.
   */
  const askSelectPc = async (
    options: PcChoice[],
    prompt: string,
    highlight?: Skill,
  ): Promise<number> => {
    // select-pc.xml marks the best value in the highlighted skill in green.
    const best = Math.max(
      ...options.map((o, i) =>
        o.canPick && highlight !== undefined ? (univ.party.pcs[i]?.skills[highlight] ?? 0) : -1,
      ),
    );
    const rows = options.map((option) => ({
      name: String(option.index),
      key: String(option.index + 1),
      label: option.label,
      disabled: !option.canPick,
      highlight:
        highlight !== undefined &&
        option.canPick &&
        best > 0 &&
        (univ.party.pcs[option.index]?.skills[highlight] ?? 0) === best,
    }));
    const hint =
      highlight !== undefined
        ? `${prompt}\nSkill is shown in (). Highest in green. Type '1'-'6'.`
        : `${prompt}\nType '1'-'6'.`;
    const picked = await dialogs.run({
      text: hint,
      rows,
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel' }],
    });
    const index = Number(picked);
    return Number.isInteger(index) && options[index]?.canPick
      ? index : SELECT_PC_CANCEL;
  };

  /** The whole of `select_pc`, dialog and rules, for the callers below. */
  const selectPc = (
    mode: SelectPcMode, prompt: string, opts: SelectPcOpts = {},
  ): Promise<number> => runSelectPc(univ, mode, prompt, askSelectPc, opts);

  /**
   * `spend_xp(who, mode)` — true if the player kept the changes. Opens on top
   * of whatever is up, since the party editor calls it from inside its own
   * dialog.
   */
  const spendXpFlow = async (who: number, mode: XpMode): Promise<boolean> => {
    const { dlg } = spendXpDialog(ctx, store, univ, who, mode, {
      nest: (screen) => dialogs.runNested(screen),
      redraw,
    });
    return (await dialogs.runNested(dlg)) === 'keep';
  };

  /** `get_num_of_items` (boe.items.cpp:667) — how many out of a stack. */
  const getNumOfItems = async (max: number): Promise<number> => {
    const { dlg, result } = numOfItemsDialog(ctx, store, max);
    return result(await dialogs.runNested(dlg));
  };

  /** attack-friendly.xml — swinging at someone who hasn't done anything yet. */
  session.onConfirmAttackFriendly = async () => {
    const choice = await dialogs.run({
      text: "This creature isn't hostile.\nAttack anyway?",
      escapeButton: 'cancel',
      buttons: [
        { name: 'cancel', label: 'Cancel', key: 'c' },
        { name: 'attack', label: 'Attack', key: 'a' },
      ],
    });
    return choice === 'attack';
  };

  /** boat-bridge.xml — a boat reaching a bridge: go under it, or come ashore. */
  session.onConfirmBoatBridge = async () => {
    const choice = await dialogs.run({
      text: 'Sail under the bridge, or come ashore?',
      escapeButton: 'land',
      buttons: [
        { name: 'land', label: 'Land', key: 'l' },
        { name: 'under', label: 'Under', key: 'u' },
      ],
    });
    return choice === 'under';
  };

  /**
   * `handle_death` (boe.actions.cpp:3713) on the real `party-death.xml` — the
   * whole party has died, and the three ways out of that.
   *
   * The C++ loops until one of them takes: Quit leaves the program, Restart
   * builds a new party, and Restore only returns if a file was actually
   * loaded — cancelling the picker puts the dialog straight back up. That loop
   * is why the dialog has no Escape button: while one is open,
   * `InputRouter.dialogStack` gates every game key and click, so there is no
   * way to go on playing a dead party.
   *
   * The two reloads are how this port gets a genuinely clean Universe, the
   * same reasoning as File > New Game. Quit has nowhere to go in a browser, so
   * it lands on the startup screen — which is where `handle_victory` puts you
   * too, and the closest thing here to leaving the game.
   */
  session.onPartyDeath = () => {
    void (async () => {
      for (;;) {
        const choice = await dialogs.runScreen(
          new XmlDialog(ctx, store, getDialogDef('party-death')));
        if (choice === 'new') {
          window.location.reload();
          return;
        }
        if (choice === 'quit') {
          window.location.href = import.meta.env.BASE_URL;
          return;
        }
        // Restore. `force` skips the "not in combat" refusal: the party can
        // very well have died in a fight, and the C++ only puts that guard on
        // the File menu, not on the picker this dialog opens.
        if (await loadGameFlow(true)) {
          redraw();
          return;
        }
      }
    })();
  };

  /**
   * The tail of `handle_victory` (boe.actions.cpp:1412): back to the startup
   * screen, which here is the page with no `?scenario=` on it. The original
   * announces nothing — the scenario has already said its own goodbye through
   * the message node before the one that ended it — so neither does this.
   */
  session.onVictory = () => {
    window.location.href = import.meta.env.BASE_URL;
  };

  /**
   * Scry Monster's `display_monst` — the monster sheet, on this one creature,
   * with the roster arrows hidden. Queued behind whatever the cast already put
   * on screen (the projectile's own dialogs, in combat).
   */
  session.onShowMonster = (monst) => {
    void dialogs.runScreenQueued(() => monsterInfoDialog(ctx, store, univ, monst))
      .then(() => redraw());
  };

  /**
   * A locked door: ask what to do and who does it, then act. This is the async
   * replacement for the C++ blocking cChoiceDlog + select_pc pair.
   */
  session.onLockedDoor = (where, terrain) => {
    // Bumping the door again while the prompt is up shouldn't stack prompts.
    if (dialogs.active) return;
    void (async () => {
      const choice = await dialogs.run({
        text: 'This door is locked.\nWhat do you do?',
        terPic: scen.terTypes[terrain]?.picture,
        escapeButton: 'leave',
        buttons: [
          { name: 'leave', label: 'Leave', key: 'l' },
          { name: 'bash', label: 'Bash Door', key: 'b' },
          { name: 'pick', label: 'Pick Lock', key: 'p' },
        ],
      });
      if (choice === 'bash') {
        const who = await selectPc(SelectPcMode.ONLY_LIVING, 'Who will bash?',
          { highlight: Skill.STRENGTH });
        if (who < 6) await session.bashDoor(where, who);
      } else if (choice === 'pick') {
        const who = await selectPc(SelectPcMode.ONLY_CAN_LOCKPICK,
          'Who will pick the lock?', { highlight: Skill.LOCKPICKING });
        if (who < 6) session.pickLock(where, who);
      }
      redraw();
    })();
  };

  /**
   * The specials VM's window on the outside world. Everything the C++ does by
   * blocking on a dialog is a promise here.
   */
  session.onRedraw = () => redraw();
  const specialHost: SpecialHost = {
    message: async (str1, str2, title, pic, picType, record) => {
      // `cStrDlog` — the real message box: the node's picture at the top left,
      // one of the eight {1|2}str[-title][-lg] layouts, and a Record button
      // that puts the text in the party's encounter notes.
      // `display_strings.setSound(57)` — every message a special node puts up
      // announces itself. Only those carry a recorder, which is what tells the
      // two apart here.
      if (record) sound.play(57);
      await dialogs.runScreenQueued(strDialog(ctx, store, {
        str1,
        str2,
        title,
        pic,
        picType,
        onRecord: record && (() => {
          sound.play(0);
          let added = false;
          for (const str of record.strs) {
            if (univ.party.record(record.type, str, record.where)) added = true;
          }
          // Only the first string's success is reported, as in the C++.
          if (added) univ.addStringToBuf('Added to encounter notes.');
          redraw();
        }),
      }));
    },
    choice: async (strs, buttons, title, pic, picType) => {
      const text = strs.filter((s) => s.length > 0).join('\n\n');
      const picked = await dialogs.runQueued({
        text: title ? `${title}\n\n${text}` : text,
        // `cThreeChoice::init_pict` (3choice.cpp:159) — a choice dialog raised
        // by a special node carries the node's picture too.
        pic: pic >= 0 ? { type: pictTypeOf(picType), num: pic } : undefined,
        escapeButton: buttons[0]?.name ?? 'okay',
        // Each button carries its control *name* as well as its label, because
        // the name is what a replay records; the two are rarely the same
        // string. `basic_buttons` attaches a letter to several of them —
        // 'y'/'n' most of all — and the dialog answers to those keys.
        buttons: buttons.map((b) => ({ name: b.name, label: b.label, key: b.key })),
      });
      return Math.max(0, buttons.findIndex((b) => b.name === picked));
    },
    story: async (title, first, last, strType, pic, picType) => {
      await dialogs.runScreenQueued(
        () => storyDialog(ctx, store, univ, title, first, last, strType, pic, picType));
    },
    askText: (prompt) => askForText(prompt),
    askNum: askForNum,
    selectPc: askSelectPc,
    getNumOfItems,
    // `start_shop_mode(ex1a, ex1b, str1)` — see the note in `replay/host.ts`.
    startShop: (which, costAdj, shopName) =>
      session.startShopMode(which, costAdj, shopName),
    startTalk: (monsterIndex, personality, monsterType, pic) =>
      session.startTalkMode(monsterIndex, personality, monsterType, pic),
    sound: (which) => sound.play(which),
    rest: (length, hp, sp) => doRest(univ, length, hp, sp, session.isOutdoors, session),
    moveParty: (where) => {
      if (session.inTown) univ.party.townLoc = { ...where };
      else univ.party.outLoc = { ...where };
      session.center = { ...where };
      session.updateExplored(where);
    },
    forceTown: (town, entryDir, where) => {
      // OUT_FORCE_TOWN (boe.specials.cpp:4609): `force_town_enter` and
      // `start_town_mode`, and nothing else. No `end_town_mode`, so the town
      // being left is not remembered — and the entry direction is a real
      // entrance, not `change_level`'s "9 means forced position".
      if (entryDir === 9) session.forceTownEntry(town, where);
      session.startTownMode(town, entryDir);
      session.center = { ...univ.party.townLoc };
    },
    changeLevel: (town, where) => {
      // change_level (boe.specials.cpp:1395): leave, then re-enter elsewhere.
      // The "leave" is a real `end_town_mode(switching_level = true)`, so the
      // level being left goes into the party's four-town memory just as it
      // would if the party had walked out of the gate — take the stairs down
      // and back up and the floor above is as you left it.
      if (where.x >= 0 && where.y >= 0) session.forceTownEntry(town, where);
      session.storeTownOnLeaving();
      session.startTownMode(town, 9);
      session.center = { ...univ.party.townLoc };
    },
    endScenario: () => {
      univ.addStringToBuf('*** The scenario is over. ***');
    },
  };
  session.attachSpecials(specialHost);
  // `set_stat_window_for_pc` from inside the rules: `combat_next_step` moves
  // the item pane to whoever is up (boe.combat.cpp:1823), and so does
  // `start_town_combat`.
  session.onStatWindowForPc = (pc) => { screen.itemWindow.setStatWindowForPc(univ, pc); };

  /**
   * Training — the TRAINING talk node (boe.dlgutil.cpp:991): pick who
   * trains, then `spend_xp` in mode 1 on the real spend-xp.xml.
   */
  session.onTrain = () => {
    if (dialogs.active) return;
    void (async () => {
      const who = await selectPc(SelectPcMode.ONLY_CAN_TRAIN, 'Train who?');
      if (who < 6) await spendXpFlow(who, XpMode.TRAIN);
      redraw();
    })();
  };

  /**
   * The job board (`show_job_bank`, boe.dlgutil.cpp:794), on the real
   * `job-board.xml`. Four offers, a Take beside each, and the dispatcher's
   * mood along the bottom; taking one starts the quest and refills the slot
   * from the board's spares.
   */
  session.onJobBank = (which, title, personality) => {
    if (dialogs.active) return;
    const bank = openJobBank(univ, which);
    void dialogs.runScreen(jobBoardDialog(ctx, store, univ, bank, personality))
      .then(() => redraw());
  };

  /**
   * `pick_trapped_monst` (boe.party.cpp:2450) — soul-crystal.xml, the four
   * slots Capture Soul fills and Simulacrum draws on. Cancelling returns 0,
   * which is what an empty crystal reports too.
   */
  session.onPickTrappedMonst = async () => {
    if (dialogs.active) return 0;
    const held = trappedMonsters(univ);
    if (held.length === 0) return 0;
    const picked = await dialogs.run({
      text: 'The soul crystal holds:\nWhich will you summon?',
      rows: held.map((slot, i) => ({
        name: String(slot.which),
        key: String(i + 1),
        label: `${slot.name} (level ${slot.level})`,
      })),
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel', key: 'c' }],
    });
    const which = Number(picked);
    return Number.isInteger(which) && held.some((h) => h.which === which) ? which : 0;
  };

  /**
   * Alchemy — `handle_alchemy` (boe.actions.cpp:1224) and the two dialogs
   * `do_alchemy` (boe.party.cpp:2284) runs: who mixes, then what. Mixing is a
   * town-only activity, and the mode gates below are the C++'s own wording.
   * The potion picker is the real `pick-potion.xml`.
   */
  const doAlchemyFlow = async (): Promise<void> => {
    if (dialogs.active) return;
    if (session.mode !== GameMode.TOWN) {
      if (isCombat(session.mode)) univ.addStringToBuf('Alchemy: Not in combat.');
      else if (!session.inTown) univ.addStringToBuf('Alchemy: Only in town.');
      else univ.addStringToBuf("Alchemy: Finish what you're doing first.");
      redraw();
      return;
    }
    if (!univ.party.alchemy.some((known) => known)) {
      univ.addStringToBuf('Alchemy: No recipes known.');
      redraw();
      return;
    }
    const who = await selectPc(SelectPcMode.ONLY_LIVING, 'Who will make a potion?',
      { highlight: Skill.ALCHEMY });
    if (who >= 6) {
      redraw();
      return;
    }
    const pc = univ.party.pcs[who]!;
    const choices = alchemyChoices(univ, who);
    const picked = await dialogs.runScreen(pickPotionDialog(ctx, store, pc, choices));
    const which = potionSlot(picked);
    if (which >= 0 && choices.some((c) => c.which === which && c.canMake))
      makePotion(session, who, which, (n) => sound.play(n));
    setStatus();
    redraw();
  };

  /**
   * Saving and loading. The C++ hangs these off the File menu and a native file
   * picker; this port has neither, so the slots live in IndexedDB
   * (`platform/saveStore.ts`) and the picker is a dialog. Ctrl+S saves, Ctrl+L
   * loads, and both slot lists carry an Export/Import row so the very same
   * `.exg` bytes can move to and from the desktop build.
   *
   * `save_party` refuses in combat (boe.actions.cpp's File menu gate), and so
   * does this: half a fight is not a resumable state.
   */
  const slotLabel = (slot: SaveSlot): string => {
    const when = new Date(slot.savedAt);
    const where = slot.preview.townNum >= TOWN_NUM_OUTDOORS
      ? 'Outdoors'
      : scen.towns[slot.preview.townNum]?.name ?? `Town ${slot.preview.townNum}`;
    const day = Math.floor(slot.preview.age / 3700) + 1;
    return `${slot.name} — ${where}, day ${day} (${when.toLocaleString()})`;
  };

  const canSaveNow = (): string | null => {
    if (isCombat(session.mode)) return 'Save: Not in combat.';
    if (session.mode !== GameMode.TOWN && session.mode !== GameMode.OUTDOORS)
      return "Save: Finish what you're doing first.";
    return null;
  };

  /**
   * `talk_notes` / `adventure_notes` (boe.infodlg.cpp:594/530), off the Options
   * menu. An empty journal, or talk notes asked for mid-conversation, is one
   * line in the message buffer rather than a dialog.
   */
  const notesFlow = async (which: 'talk' | 'encounter'): Promise<void> => {
    if (dialogs.active) return;
    const refusal = notesRefusal(univ, session.mode, which);
    if (refusal !== null) {
      univ.addStringToBuf(refusal);
      redraw();
      return;
    }
    await dialogs.runScreen(which === 'talk'
      ? talkNotesDialog(ctx, store, univ)
      : adventureNotesDialog(ctx, store, univ));
    redraw();
  };

  const saveGameFlow = async (): Promise<void> => {
    if (dialogs.active) return;
    const refusal = canSaveNow();
    if (refusal !== null) {
      univ.addStringToBuf(refusal);
      redraw();
      return;
    }
    if (!saveStoreAvailable()) {
      univ.addStringToBuf('Save: no save storage in this browser.');
      redraw();
      return;
    }
    const data = saveGame(univ);
    const slots = await listSaves();
    const picked = await dialogs.run({
      text: 'Save the game in which slot?',
      rows: [
        { name: 'new', label: 'New slot…' },
        { name: 'file', label: 'Export to a file…' },
        ...slots.map((slot) => ({ name: `slot:${slot.name}`, label: `Overwrite ${slotLabel(slot)}` })),
      ],
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel' }],
    });
    if (picked === 'cancel') {
      redraw();
      return;
    }
    if (picked === 'file') {
      exportSave(univ.party.pcs[0]?.name ?? 'exile', data);
      univ.addStringToBuf('Game exported.');
      redraw();
      return;
    }
    const name = picked === 'new'
      ? (await askForText('Name this saved game:', false)).trim()
      : picked.slice('slot:'.length);
    if (name === '') {
      redraw();
      return;
    }
    try {
      await putSave(name, data);
      univ.saveSlot = name;
      univ.addStringToBuf(`Game saved: ${name}.`);
    } catch (err) {
      univ.addStringToBuf(`Save failed: ${String(err)}`);
    }
    redraw();
  };

  /**
   * `try_auto_save`'s back half (boe.fileio.cpp:520). The C++ refuses until
   * there is a file to autosave *beside* — "Autosave: Make a manual save
   * first." — and then rotates through `<name>.auto/1..5`, overwriting the
   * oldest once the ring is full. Here the ring is five IndexedDB slots named
   * after the manual one, and `univ.saveSlot` is `univ.file`.
   *
   * Fire and forget: the trigger sites are inside `increase_age` and
   * `start_town_mode`, neither of which can wait on a promise.
   */
  const autoSlotName = (base: string, n: number): string => `${base}.auto ${n}`;

  const doAutoSave = (reason: AutosaveReason): void => {
    if (!saveStoreAvailable()) return;
    const base = univ.saveSlot;
    if (base === null) {
      univ.addStringToBuf('Autosave: Make a manual save first.');
      return;
    }
    const max = getAutosavePrefs().max;
    void (async () => {
      try {
        const slots = await listSaves();
        const mine = new Map(slots
          .filter((s) => s.name.startsWith(`${base}.auto `))
          .map((s) => [s.name, s]));
        let target = '';
        for (let n = 1; n <= max; n++) {
          if (!mine.has(autoSlotName(base, n))) {
            target = autoSlotName(base, n);
            break;
          }
        }
        if (target === '') {
          // The ring is full, so the oldest goes.
          target = [...mine.values()].sort((a, b) => a.savedAt - b.savedAt)[0]!.name;
        }
        await putSave(target, saveGame(univ));
        univ.addStringToBuf(`Autosave: Game saved (${reason}).`);
      } catch (err) {
        univ.addStringToBuf(`Autosave: Save not completed (${String(err)})`);
      }
      redraw();
    })();
  };
  setAutosaveSink(doAutoSave);

  const resumeAfterLoad = (): void => {
    session.resumeLoadedGame();
    screen.mapVisible = false;
    screen.itemWindow.setStatWindowForPc(univ, 0);
    setStatus();
    redraw();
  };

  /**
   * The Open Game flow. Returns whether a game was actually loaded, which is
   * what the party-death dialog needs to know: `handle_death` re-asks unless
   * the restore took. A cross-scenario load counts as taken — the page is on
   * its way to the other scenario and nothing here should run again.
   *
   * `force` skips the "not in combat" refusal, for the one caller that has to
   * ignore it: a party that died in a fight.
   */
  const loadGameFlow = async (force = false): Promise<boolean> => {
    if (dialogs.active) return false;
    if (!force && isCombat(session.mode)) {
      univ.addStringToBuf('Load: Not in combat.');
      redraw();
      return false;
    }
    const slots = saveStoreAvailable() ? await listSaves() : [];
    const picked = await dialogs.run({
      text: slots.length > 0 ? 'Load which saved game?' : 'No saved games in this browser.',
      rows: [
        { name: 'file', label: 'Import a file…' },
        ...slots.map((slot) => ({ name: `slot:${slot.name}`, label: slotLabel(slot) })),
      ],
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel' }],
    });
    if (picked === 'cancel') {
      redraw();
      return false;
    }

    let data: Uint8Array | null = null;
    if (picked === 'file') {
      const chosen = await importSave();
      data = chosen?.data ?? null;
    } else {
      data = await getSave(picked.slice('slot:'.length));
    }
    if (data === null) {
      redraw();
      return false;
    }
    // A save belongs to one scenario, and swapping scenarios means reloading
    // the whole world — which this port does by restarting on the new one.
    try {
      const preview = readSavePreview(data);
      if (preview.scenarioId !== scen.id) {
        // Another scenario means another world to fetch, so the page reopens on
        // it and picks the slot back up. Only a stored slot can make that trip;
        // an imported file's bytes have nowhere to wait.
        if (picked === 'file') {
          univ.addStringToBuf(
            `That game was played in "${preview.scenarioId}", not "${scen.id}". ` +
            `Open that scenario first, then import it.`);
          redraw();
          return false;
        }
        window.sessionStorage.setItem(PENDING_SAVE_KEY, picked.slice('slot:'.length));
        window.location.href =
          `${import.meta.env.BASE_URL}?scenario=${encodeURIComponent(preview.scenarioId)}`;
        return true;
      }
      applySave(data, univ);
      // The C++ sets `univ.file` from what it loaded, so the autosave keeps
      // rotating alongside the same manual save. An imported file has no slot
      // of its own until it is saved.
      univ.saveSlot = picked === 'file' ? null : picked.slice('slot:'.length);
      resumeAfterLoad();
      univ.addStringToBuf('Game loaded.');
      redraw();
      return true;
    } catch (err) {
      univ.addStringToBuf(`Load failed: ${String(err)}`);
      redraw();
      return false;
    }
  };

  /**
   * The Get action (get_item, boe.items.cpp:258): list what's in reach and let
   * the player take one at a time.
   */
  /**
   * `handle_combat_switch`'s end branch (boe.actions.cpp:1338). Leaving a
   * **town** fight sets `did_something`, so `advance_time` runs a whole town
   * turn behind it — the clock, the upkeep and the monsters. Leaving an
   * outdoor fight does not (:1339 never sets the flag).
   */
  const endCombatFlow = async (): Promise<void> => {
    const wasTown = session.whichCombatType !== 0;
    if (session.endCombat() && wasTown) await session.afterPartyTurn();
    setStatus();
    redraw();
  };

  const getItems = async (): Promise<void> => {
    if (dialogs.active) return;
    // `handle_get_items` (boe.actions.cpp:1389) reaches from the party's
    // square in town and from the **acting PC's** in combat, where it also
    // costs four action points. Gating this on town alone is why "g" after an
    // arena fight said there was nothing here while the loot was in plain
    // sight on the floor.
    const inFight = isCombat(session.mode);
    const from = inFight ? univ.currentPc.combatPos : univ.party.townLoc;
    const { items: reachable, massGet } = session.reachableItems(from);
    if (reachable.length === 0) {
      univ.addStringToBuf('Get: nothing here');
      redraw();
      return;
    }
    // show_get_items: one screen that stays up — pick who is carrying with the
    // PC buttons, take as many things as you like, then Done. The title says
    // which sweep it was: a hostile creature in sight narrows it to adjacent.
    const screen = new GetItemsDialog(ctx, store, session, reachable,
      massGet ? 'Getting all nearby items:' : 'Getting all adjacent items:');
    await dialogs.runScreen(screen);
    // `get_item` asks the townsfolk once, after the screen has closed, and
    // about **the party's square** rather than the item's (boe.items.cpp:283).
    if (screen.stole) session.reportTheft(from);
    // **Rummaging costs a turn.** `handle_get_items` sets `did_something` when
    // `get_item` returns non-zero, and `get_item` returns 1 as soon as there is
    // anything in reach at all — not when something is actually taken
    // (boe.items.cpp:277). So the moment the screen has a row on it, the clock
    // ticks and the monsters get a move once the screen closes. Both the AP and
    // the turn are spent *after* the dialog, because in the C++ the dialog runs
    // inline inside `handle_get_items` and `advance_time` follows it.
    if (inFight) {
      takeAp(univ, 4);
      session.monsterActionsCombat();
    } else await session.afterPartyTurn();
    setStatus();
    redraw();
  };

  /**
   * The Info button beside a PC — `give_pc_info` (boe.infodlg.cpp:476), the
   * real `pc-info.xml` character sheet, running on the dialogxml toolkit.
   * The arrows step through the living party members without closing it.
   */
  const showPcInfo = (which: number): void => {
    if (dialogs.active) return;
    void dialogs.runScreen(pcInfoDialog(ctx, store, univ, which)).then(() => redraw());
  };

  /** `print_cast_status` (boe.party.cpp) — why a PC can't cast, in words. */
  const castStatusLine = (status: CastStatus, kind: string, who: string): string => {
    switch (status) {
      case CastStatus.NO_SKILL: return `Cast: ${who} has no ${kind} training.`;
      case CastStatus.NO_ANAMA: return "Cast: You're an Anama!";
      case CastStatus.NO_ANTIMAGIC: return 'Cast: Not in antimagic field.';
      case CastStatus.NO_SP: return `Cast: ${who} has no spell points.`;
      case CastStatus.NO_ENCUMBERED: return `Cast: ${who} is too encumbered.`;
      case CastStatus.NO_DUMBFOUNDED: return `Cast: ${who} is dumbfounded.`;
      case CastStatus.NO_PARALYZED: return `Cast: ${who} is paralyzed.`;
      case CastStatus.NO_ASLEEP: return `Cast: ${who} is asleep.`;
      default: return `Cast: ${who} can't cast that.`;
    }
  };

  /**
   * `cast_spell` / `combat_cast_*_spell`'s front end — the one dialog from
   * cast-spell.xml, with the caster column, the target column and the spell
   * grid all on screen at once.
   *
   * In combat the caster column is inert and the active PC casts
   * (`can_choose_caster` false); out of combat any PC who can cast may be
   * picked. A spell that needs a square puts the game into targeting mode and
   * the next click finishes it.
   */
  const castSpellFlow = async (type: Skill): Promise<void> => {
    const kind = type === Skill.MAGE_SPELLS ? 'mage' : 'priest';
    if (!session.primeTime) {
      univ.addStringToBuf('Cast: Finish what you are doing first.');
      setStatus();
      redraw();
      return;
    }
    const inFight = isCombat(session.mode);
    if (inFight) {
      // `combat_cast_*_spell` checks the active PC up front, and an encumbered
      // mage loses the AP for trying. Shared with the replay driver, so the
      // picker opens in exactly the same cases on both sides.
      if (!combatCastCheck(session, type)) {
        setStatus();
        redraw();
        return;
      }
    }
    // `pick_spell`'s own prologue decides whether the dialog opens, and prints
    // the reason when it doesn't — the party scan this used to do by hand
    // missed the stored caster and the per-PC lines both.
    if (SpellPick.open(session, type, !inFight) === null) {
      setStatus();
      redraw();
      return;
    }

    const dialog = new CastDialog(ctx, store, session, type, !inFight);
    const picked = await dialogs.runScreen(dialog);
    if (picked !== 'cast') { redraw(); return; }
    // finish_pick_spell's tail: the two refusals, and the bookkeeping the M/P
    // recast shortcut reads back.
    const chosen = dialog.finish();
    if (chosen === null) { setStatus(); redraw(); return; }
    const { spell, caster, target } = chosen;
    session.spellTarget = target;
    if (inFight) await combatCastSpell(session, spell);
    else await session.castTownSpell(caster, spell);
    setStatus();
    redraw();
  };

  /**
   * The **shift-M / shift-P** shortcut: cast the last spell of this kind again,
   * with no picker. `repeat_cast_ok` (boe.party.cpp:521) does the checking and,
   * under the `store-spell-target` flag, restores what it was aimed at.
   */
  const recastFlow = async (type: Skill): Promise<void> => {
    if (dialogs.active) return;
    const forced = forcedCast(session, type);
    if (forced !== null) {
      const { caster, spell } = forced;
      if (spell !== Spell.NONE) {
        if (isCombat(session.mode)) await combatCastSpell(session, spell);
        else await session.castTownSpell(caster, spell);
      }
    }
    setStatus();
    redraw();
  };

  /**
   * A row on the Special Items or Quests page — `show_item_info` (boe.actions
   * .cpp:1528) and the `use_spec_item` the Drop slot carries.
   */
  const handleSpecialPageClick = async (
    row: number, part: 'name' | 'use' | 'info',
  ): Promise<void> => {
    const win = screen.itemWindow;
    const entry = win.specItemArray[row];
    if (entry === undefined) return;
    if (win.mode === ItemWinMode.QUESTS) {
      // Whatever its status, the quest's own number is the low four digits.
      const which = entry % QUEST_COMPLETED_OFFSET;
      if (univ.scenario.quests[which])
        await dialogs.runScreen(questInfoDialog(ctx, store, univ, which));
      redraw();
      return;
    }
    const spec = univ.scenario.specialItems[entry];
    if (!spec) return;
    if (part === 'use') {
      // use_spec_item (boe.specials.cpp:576) — the item is a hook, not a thing
      // in a pack, so all it does is run its node.
      if (specItemUseable(spec) && !isCombat(session.mode))
        await session.runSpecial(
          SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, spec.special, univ.party.getLoc());
    } else {
      // put_spec_item_info's cStrDlog. TODO(M6): it draws the scenario's intro
      // picture beside the text, which needs custom scenario graphics.
      sound.play(57);
      await dialogs.run({
        title: spec.name,
        text: spec.descr,
        escapeButton: 'okay',
        buttons: [{ name: 'okay', label: 'OK' }],
      });
    }
    redraw();
  };

  /** A click on an inventory row: equip/unequip, give, drop, describe, or sell. */
  const handleInventoryClick = async (
    row: number,
    part: 'name' | 'use' | 'give' | 'drop' | 'info' | 'spec',
  ): Promise<void> => {
    if (!session.itemShop && screen.itemWindow.mode >= ItemWinMode.SPECIAL) {
      if (part === 'name' || part === 'use' || part === 'info')
        await handleSpecialPageClick(row, part);
      return;
    }
    const pc = univ.party.pcs[screen.itemPage];
    const item = pc?.items[row];
    if (!pc || !item || item.variety === 0) return;
    if (part === 'use') {
      // handle_use_item (boe.actions.cpp:1099) — only the acting PC's own pack,
      // and it costs the turn (use_item itself decides whether it worked).
      await useItem(session, screen.itemPage, row, specialHost);
    } else if (part === 'spec') {
      session.useItemShop(screen.itemPage, row);
    } else if (part === 'name' && session.itemShop) {
      // While a shopkeeper is waiting, the name isn't an equip toggle.
      univ.addStringToBuf('  Click the button beside the item.');
    } else if (part === 'name') {
      session.toggleEquip(screen.itemPage, row);
    } else if (part === 'drop') {
      // `handle_drop_item` only *arms* the drop in town or combat — the square
      // arrives as the next click on the terrain view.
      await handleDropItem(session, screen.itemPage, row, specialHost);
    } else if (part === 'give') {
      await handleGiveItem(session, screen.itemPage, row, specialHost);
    } else {
      // `display_pc_item` — the real item-info.xml sheet, with the arrows
      // stepping through the rest of this PC's pack.
      await dialogs.runScreen(itemInfoDialog(ctx, store, univ, screen.itemPage, row));
    }
    redraw();
  };

  // Browsers only allow audio after a user gesture, so the first keypress or
  // click is what actually starts it.
  const wakeSound = (): void => {
    void sound.resume().then(async () => {
      await sound.preloadCommon();
      // Terrain that changes when stepped on or used keeps its sound in flag2
      // (a door swinging, for instance). Other specials use flag2 for other
      // things, so only these two kinds contribute.
      const terrainSounds = new Set<number>();
      for (const ter of scen.terTypes)
        if (
          ter.flag2 > 0 &&
          (ter.special === TerSpec.CHANGE_WHEN_STEP_ON || ter.special === TerSpec.CHANGE_WHEN_USED)
        )
          terrainSounds.add(ter.flag2);
      await sound.preloadAll(terrainSounds);
    });
  };
  window.addEventListener('keydown', wakeSound, { once: true });
  canvas.addEventListener('mousedown', wakeSound, { once: true });

  /** What the next direction or view click should do instead of moving. */
  let pending: 'talk' | 'look' | 'use' | 'bash' | 'pick' | null = null;

  /**
   * `handle_use_space_select` / `handle_bash_pick_select` (boe.actions.cpp:930
   * and :959) — arm Use, Bash Door or Pick Lock, or cancel it if it is already
   * armed.
   *
   * All three insist on **MODE_TOWN exactly**, not merely "in a town": with a
   * conversation, a shop, a look or a spell in progress the answer is "Finish
   * what you're doing first." This port's `pending` flag stands in for the
   * MODE_USE_TOWN / MODE_BASH_TOWN / MODE_PICK_TOWN modes, so an armed action
   * of the same kind counts as being in that mode.
   */
  const beginTalk = (): void => {
    // `handle_begin_talk` (boe.actions.cpp:504) says nothing at all outside
    // MODE_TOWN — unlike Use and Bash, which explain themselves.
    if (session.mode !== GameMode.TOWN && pending !== 'talk') return;
    if (pending === 'talk') {
      pending = null;
      univ.addStringToBuf('  Cancelled.');
      return;
    }
    pending = 'talk';
    univ.addStringToBuf('Talk: Select someone.');
  };

  const selectSpace = (what: 'use' | 'bash' | 'pick'): void => {
    const label = what === 'use' ? 'Use' : what === 'bash' ? 'Bash Door' : 'Pick Lock';
    if (session.mode !== GameMode.TOWN && pending !== what) {
      if (isCombat(session.mode)) univ.addStringToBuf(`${label}: not in combat.`);
      else if (isOut(session.mode)) univ.addStringToBuf(`${label}: not outdoors`);
      else univ.addStringToBuf(`${label}: Finish what you're doing first.`);
      return;
    }
    if (pending === what) {
      pending = null;
      univ.addStringToBuf('  Cancelled.');
      return;
    }
    pending = what;
    if (what === 'use') {
      univ.addStringToBuf('Use: Select a space or item.');
      univ.addStringToBuf('  (Hit button again to cancel.)');
    } else {
      univ.addStringToBuf(`${label}: Select a space.`);
    }
  };

  const setStatus = (): void => {
    if (session.shop)
      status.textContent = "Click an item name (or type 'a'-'h') to buy; Esc to leave.";
    else if (session.talk) status.textContent = 'Click a highlighted word, or Done to stop talking.';
    else if (pending === 'talk') status.textContent = 'Talk to whom? (pick a direction)';
    else if (pending === 'look')
      status.textContent =
        'Look: click a space (the border arrows scroll the view). L or Esc cancels.';
    else if (pending === 'use') status.textContent = 'Use what? (pick a direction)';
    else if (pending === 'bash') status.textContent = 'Bash which door? (pick a direction)';
    else if (pending === 'pick')
      status.textContent = 'Pick which lock? (pick a direction)';
    else if (session.missile !== null)
      status.textContent =
        'Aim: click a square (or pick a direction). S or Esc cancels.';
    else if (session.mode === GameMode.COMBAT)
      status.textContent =
        'Combat — arrows move/attack, S shoot, W stand ready, D parry, X hold turn, E end fight.';
    else
      status.textContent =
        `${scen.title} — arrows to move, L look` +
        (session.inTown
          ? ', T talk, U use, B bash, G get, F fight, 1-6 whose pack.'
          : ', U use, R rest, 1-6 whose pack.');
  };

  /** Follow a conversation choice, prompting for a topic when it's "Ask About". */
  const activateTalkWord = async (node: number): Promise<void> => {
    const talk = session.talk;
    if (!talk) return;
    await session.chooseTalkNode(node);
    setStatus();
    redraw();
  };

  /** Buy, inspect, scroll or leave — the shop screen's four actions. */
  const handleShopHit = (hit: ShopHit): void => {
    const shop = session.shop;
    if (!shop) return;
    if (hit.part === 'done') {
      sound.play(Snd.BUTTON);
      session.endShopMode();
    } else if (hit.part === 'scroll') {
      shop.scrollBy(hit.delta);
    } else if (hit.part === 'buy') {
      session.buyShopRow(hit.row);
    } else {
      const info = shopItemInfo(shop, hit.row);
      if (info && !dialogs.active)
        void dialogs.run({
          text: info.text,
          escapeButton: 'okay',
          buttons: [{ name: 'okay', label: 'OK' }],
        }).then(() => redraw());
    }
    setStatus();
    redraw();
  };

  /**
   * handle_begin_look (boe.actions.cpp:470) — Look is a *mode*, not a one-shot
   * prompt. That matters for more than bookkeeping: MODE_LOOK_TOWN and
   * MODE_LOOK_COMBAT are in `scrollableModes`, so while you're looking the
   * twelve pointing arrows appear and the border scrolls the view — which is
   * the only way to look at something the 9x9 window doesn't reach. Pressing
   * the key again cancels, as the original's Escape branch does.
   */
  const beginLook = (): void => {
    if (isLooking()) {
      univ.addStringToBuf('  Cancelled.');
      endLook();
      return;
    }
    if (session.mode === GameMode.OUTDOORS) session.mode = GameMode.LOOK_OUTDOORS;
    else if (session.mode === GameMode.TOWN) session.mode = GameMode.LOOK_TOWN;
    else if (session.mode === GameMode.COMBAT) session.mode = GameMode.LOOK_COMBAT;
    else return;
    pending = 'look';
    univ.addStringToBuf('Look: Select a space.');
  };

  const isLooking = (): boolean => session.mode === GameMode.LOOK_TOWN
    || session.mode === GameMode.LOOK_COMBAT
    || session.mode === GameMode.LOOK_OUTDOORS;

  /** end_look (boe.actions.cpp:448) — back to the mode we came from, and the
   * view back onto the party (the scroll arrows may have moved it). */
  const endLook = (): void => {
    if (session.mode === GameMode.LOOK_TOWN) session.mode = GameMode.TOWN;
    else if (session.mode === GameMode.LOOK_COMBAT) session.mode = GameMode.COMBAT;
    else if (session.mode === GameMode.LOOK_OUTDOORS) session.mode = GameMode.OUTDOORS;
    else return;
    pending = null;
    recentre();
  };

  /**
   * Look at a space: describe it (`do_look`), then search it
   * (`adj_town_look`), then read an adjacent sign if there is one — the three
   * steps `handle_look` runs in that order (boe.actions.cpp:697).
   */
  const lookAt = async (target: { x: number; y: number }): Promise<void> => {
    const ter = session.lookAt(target);
    if (ter < 0) return;
    // Searching an adjacent square in town: runs its special, and opens it if
    // it turns out to be a container with something inside.
    if (session.inTown || isCombat(session.mode)) {
      if (dist(univ.party.townLoc, target) <= 1) {
        const contents = await session.adjTownLook(target);
        redraw();
        if (contents && contents.length > 0 && !dialogs.active) {
          // `get_item(where,6,true)` — the container's own screen, so the
          // theft check asks about the container's square.
          const screen = new GetItemsDialog(ctx, store, session, contents,
            'Looking in container:');
          await dialogs.runScreen(screen);
          if (screen.stole) session.reportTheft(target);
          setStatus();
          redraw();
          return;
        }
      }
    }
    const sign = session.signAt(target);
    if (sign === null || dialogs.active) return;
    await dialogs.run({
      text: sign,
      terPic: scen.terTypes[ter]?.picture,
      escapeButton: 'okay',
      buttons: [{ name: 'okay', label: 'OK' }],
    });
  };

  /**
   * True while a move or Use is still resolving. Both can await a dialog now
   * (a special on the destination square), and the original is strictly serial
   * — it blocks inside check_special_terrain — so a second action mustn't start
   * on top of the first. Without this, holding an arrow key interleaves moves.
   */
  let acting = false;

  /**
   * Whether the game is mid-action and input should be ignored: the party's own
   * half (`acting`), the monsters' (`session.busy`, a queued monster round
   * still playing out), or **an animation still on screen** (`animPending`).
   *
   * The C++ needs none of these — it blocks, and it goes further and throws
   * away anything typed while it does (`flushingInput = true`, set in
   * `damage_pc` right after `boom_space` returns, boe.party.cpp:2669, and
   * again in `do_monster_turn`). Dropping the input rather than buffering it
   * is the behaviour being matched.
   *
   * The animation term is what makes "wait for the blast, then carry on" true
   * for the *player's* own blows as well as the monsters': a swing that sets
   * off an explosion holds the keyboard until the explosion is over, exactly
   * as `boom_space`'s sleep does. It is also what keeps the queue shallow now
   * that `animBook` has no depth cap — the model cannot run away from the
   * screen if the player cannot act.
   */
  const midAction = (): boolean => acting || session.busy || animPending() > 0;

  /**
   * Whether a click on the terrain is a *shot* rather than a step: a loaded
   * missile or a spell waiting for its square. These are the modes that get
   * the targeting crosshair, and the modes whose clicks must be taken as given
   * instead of reduced to one step toward the target.
   */
  /**
   * Modes in which a click on the terrain view means *that square* rather than
   * "step one square toward it". The C++ has no such predicate — its
   * `handle_terrain_screen_actions` tests each mode in turn and only reaches
   * the move branch last (boe.actions.cpp:300) — so this is the list of
   * branches that get there first. Dropping is one of them.
   */
  const isAiming = (): boolean => session.missile !== null
    || session.spellTargeting !== null || session.townTarget !== null
    || session.mode === GameMode.DROP_TOWN || session.mode === GameMode.DROP_COMBAT;

  /**
   * Put the view back where the game keeps it — on the acting PC in combat, on
   * the party in town. Scrolling with the border arrows moves it away, and
   * every targeting mode restores it when it resolves.
   */
  const recentre = (): void => {
    // `party.getLoc()` for the non-combat case, not `townLoc`: outdoors that
    // field still holds wherever the party last stood *in a town* (or in a
    // combat arena), and centring the outdoor view on it drew a 9x9 window of
    // unexplored nothing — the "looking at a sign turns everything black" bug,
    // since ending a look is one of the things that calls this.
    session.center = isCombat(session.mode)
      ? { ...univ.currentPc.combatPos }
      : { ...univ.party.getLoc() };
  };

  /** Act on a target space according to what the player asked for. */
  const actOn = async (target: { x: number; y: number }): Promise<void> => {
    const what = pending;
    pending = null;
    // Dropping is armed by the item panel and lands here
    // (`handle_terrain_screen_actions`' MODE_DROP_* branch, boe.actions.cpp:352).
    if (session.mode === GameMode.DROP_TOWN || session.mode === GameMode.DROP_COMBAT) {
      await dropItemAt(session, target, specialHost);
      setStatus();
      redraw();
      return;
    }
    if (what === 'talk') {
      void session.talkTo(target).then(() => { setStatus(); redraw(); });
      return;
    }
    if (what === 'look') {
      void lookAt(target);
      // Looking is done unless the modifier keys held it open; this port has
      // no quick-look modifier, so every look ends the mode.
      endLook();
      return;
    }
    if (what === 'bash' || what === 'pick') {
      // handle_bash_pick (boe.actions.cpp:976) — the square has to be next to
      // you and has to be something with a lock on it; then who does it.
      const isBash = what === 'bash';
      if (dist(univ.party.townLoc, target) > 1) {
        univ.addStringToBuf('  Must be adjacent.');
        setStatus();
        redraw();
        return;
      }
      if (!session.isUnlockable(target)) {
        univ.addStringToBuf('  Wrong terrain type.');
        setStatus();
        redraw();
        return;
      }
      void (async () => {
        const who = isBash
          ? await selectPc(SelectPcMode.ONLY_LIVING, 'Who will bash?',
            { highlight: Skill.STRENGTH })
          : await selectPc(SelectPcMode.ONLY_CAN_LOCKPICK, 'Who will pick the lock?',
            { highlight: Skill.LOCKPICKING });
        if (who < 6) {
          if (isBash) await session.bashDoor(target, who);
          else session.pickLock(target, who);
        }
        setStatus();
        redraw();
      })();
      return;
    }
    // Targeting a combat spell: the click is where it lands. A multi-target
    // spell collects squares instead, and fires itself once the last is picked.
    if (session.spellTargeting !== null) {
      const fancy = session.mode === GameMode.FANCY_TARGET;
      if (fancy) await placeTarget(session, target);
      else await doCombatCast(session, target);
      // The view snaps back to the caster once the spell goes off
      // (boe.actions.cpp:888) — but not while a multi-target spell is still
      // collecting squares, or scrolling would be undone between each pick.
      if (!fancy) recentre();
      setStatus();
      redraw();
      return;
    }
    // Targeting a town spell: the click is the square the spell lands on.
    // Checked before the missile, since the two modes never overlap and this
    // is the one the party is in outside combat.
    if (session.townTarget !== null) {
      await castTownSpell(session, target);
      // **The cast costs a turn.** `handle_target_space` sets
      // `did_something = true` for every targeting mode but FANCY
      // (boe.actions.cpp:888), and `advance_time` then runs a whole town turn.
      await session.afterPartyTurn();
      recentre();
      setStatus();
      redraw();
      return;
    }
    // Targeting a missile: the click (or arrow key) is the shot, not a move.
    if (session.missile !== null) {
      // **Awaited**, like the two targeting branches above it. `fireMissileAt`
      // runs the shot, its blast and the turn's tail; dropping the promise let
      // the three lines below run against a half-resolved turn. The replay
      // driver already awaits it — this is the browser path catching up. See
      // the `damagingTerrain` entry in PROGRESS.md for what an unawaited
      // promise does to `get_ran`'s call order.
      await session.fireMissileAt(target);
      recentre();
      setStatus();
      redraw();
      return;
    }
    // handle_terrain_screen_actions's offset==0 case (boe.actions.cpp:323):
    // clicking the square you (or the acting PC) are already standing on is
    // Pause/Wait, not a degenerate zero-length move — in combat that's
    // `char_stand_ready`, i.e. clicking your own figure on the battlefield
    // parries. This port's move dispatch below had no such check, so a
    // self-click fell through to the ordinary move code and just wasted the
    // turn without the stand-ready bonus.
    if (what !== 'use') {
      const self = isCombat(session.mode) ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      if (locsEqual(target, self)) {
        await session.pause();
        setStatus();
        redraw();
        return;
      }
    }
    if (midAction()) return;
    acting = true;
    const done = (): void => {
      acting = false;
      setStatus();
      redraw();
    };
    // In combat the arrow keys and clicks drive the current PC, not the party.
    // The move is async because attacking a friendly raises a prompt first.
    if (session.mode === GameMode.COMBAT) {
      if (what === 'use') void session.handleUseSpace(target).then(done, done);
      else void session.combatMove(target).then(done, done);
      return;
    }
    if (what === 'use') void session.handleUseSpace(target).then(done, done);
    else void session.moveTo(target).then(done, done);
  };

  /**
   * display_map / close_map (boe.town.cpp:1594) — the automap is a toggle, and
   * it refuses to open mid-action ("prime_time"; here that's the `acting` flag
   * a pending async move sets).
   */
  const toggleMap = (): void => {
    if (!screen.mapVisible && midAction()) {
      univ.addStringToBuf('Map: Finish what you are doing first.');
      return;
    }
    screen.mapVisible = !screen.mapVisible;
  };

  const router = new InputRouter(canvas, {
    onMove: (dir, key) => {
      // A dialog gets first refusal on the arrows: pc-info.xml's left/right
      // buttons carry `def-key='left'`/`'right'`, and the router turns those
      // into movement before `onKey` ever sees them.
      if (key !== undefined && dialogs.active && dialogs.handleKey(key)) return;
      if (dialogs.active || session.talk || session.shop || midAction()) return;
      const from = session.mode === GameMode.COMBAT || session.missile !== null
        ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      void actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onDrag: (x, y) => {
      if (!screen.mapScreen.dragging) return;
      screen.mapScreen.dragTo(x, y, BOE_WIDTH, BOE_HEIGHT);
      redraw();
    },
    onRelease: () => {
      screen.mapScreen.endDrag();
    },
    onClick: (x, y) => {
      if (dialogs.handleClick(x, y)) return;
      // The map is a separate window in the original, so a click that lands on
      // it never reaches the game screen underneath.
      if (screen.mapVisible && screen.mapScreen.contains(x, y)) {
        // A click anywhere on the map window picks it up, as the WASM build
        // allows ("Allow dragging from anywhere on the map window").
        screen.mapScreen.startDrag(x, y);
        return;
      }
      // The party stats list: clicking a name makes that PC active, the HP and
      // SP columns read themselves out, and the two icons are Info and Trade
      // Places (handle_action's PC-area branch, boe.actions.cpp:1739).
      //
      // This comes *before* the shop, because the C++ dispatches on which
      // window the click landed in and the PC panel is its own window — which
      // is how you switch who's shopping without leaving the shop.
      const pcHit = screen.pcRowHit(x, y);
      if (pcHit) {
        const pc = univ.party.pcs[pcHit.index];
        if (pc && pc.mainStatus !== MainStatus.ABSENT) {
          sound.play(Snd.BUTTON);
          // The HP and SP read-outs are blank for a PC who isn't alive, so a
          // click there does nothing rather than reporting on a corpse.
          const aliveOnly = pcHit.part === 'hp' || pcHit.part === 'sp';
          if (!aliveOnly || pc.mainStatus === MainStatus.ALIVE) {
            if (pcHit.part === 'name') {
              session.switchPc(pcHit.index);
              screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
            } else if (pcHit.part === 'hp') {
              session.printPcHp(pcHit.index);
            } else if (pcHit.part === 'sp') {
              session.printPcSp(pcHit.index);
            } else if (pcHit.part === 'trade') {
              session.tradePlaces(pcHit.index);
              screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
            } else {
              showPcInfo(pcHit.index);
            }
          }
          setStatus();
          redraw();
        }
        return;
      }
      if (session.shop) {
        const hit = screen.shopScreen.hit(session.shop, x, y);
        if (hit) handleShopHit(hit);
        return;
      }
      // The item scrollbar is its own control on the main window, so it is
      // asked before the panel underneath it.
      if (!session.itemShop && screen.itemSbar.handleClick(x, y)) {
        sound.play(Snd.BUTTON);
        screen.itemWindow.scroll = screen.itemSbar.getPosition();
        redraw();
        return;
      }
      // The page buttons along the bottom of the item panel: six PCs, Special
      // Items, Quests and Help (handle_action, boe.actions.cpp:1784).
      if (!session.itemShop) {
        const bottom = screen.itemBottomHit(x, y);
        if (bottom !== null) {
          sound.play(Snd.BUTTON);
          if (bottom === 6) screen.itemWindow.setStatWindow(univ, ItemWinMode.SPECIAL);
          else if (bottom === 7) screen.itemWindow.setStatWindow(univ, ItemWinMode.QUESTS);
          else if (bottom === 8) {
            // TODO(M6): show_dialog_action("help-inventory"), one of the help
            // dialogs the toolkit can now draw but nothing opens yet.
            univ.addStringToBuf('(The inventory help dialog is still to come)');
          } else {
            univ.curPc = bottom;
            screen.itemWindow.setStatWindowForPc(univ, bottom);
          }
          setStatus();
          redraw();
          return;
        }
      }
      // The inventory panel stays live during a conversation — that's how the
      // sell and identify services work, so it gets first refusal.
      const invenHit = screen.inventoryHit(x, y, session.itemShop !== null);
      if (invenHit) {
        sound.play(Snd.BUTTON);
        void handleInventoryClick(invenHit.row, invenHit.part);
        return;
      }
      if (session.talk) {
        const word = screen.talkScreen.wordAt(session.talk, x, y);
        if (word) void activateTalkWord(word.node);
        return;
      }
      const btn = screen.buttonAt(x, y);
      if (btn) {
        sound.play(Snd.BUTTON); // the UI click
        if (btn.btn === ToolbarButton.TALK) {
          beginTalk();
        } else if (btn.btn === ToolbarButton.LOOK) {
          beginLook();
        } else if (btn.btn === ToolbarButton.CAMP) {
          void session.rest();
        } else if (btn.btn === ToolbarButton.USE) {
          selectSpace('use');
        } else if (btn.btn === ToolbarButton.MAP) {
          toggleMap();
        } else if (btn.btn === ToolbarButton.HAND) {
          void getItems();
        } else if (btn.btn === ToolbarButton.SWORD) {
          // The sword is Fight: drop into combat where the party stands.
          if (session.inTown) session.startCombat(univ.party.direction);
          else univ.addStringToBuf("Can't fight out here yet.");
        } else if (btn.btn === ToolbarButton.END) {
          // End combat and regroup.
          void endCombatFlow();
        } else if (btn.btn === ToolbarButton.WAIT) {
          // handle_stand_ready — give up the turn *on guard*, not just idle.
          if (session.mode === GameMode.COMBAT) void session.pause();
        } else if (btn.btn === ToolbarButton.SHIELD) {
          // handle_parry — spend what's left of the turn on defence.
          if (session.mode === GameMode.COMBAT) void session.parry();
        } else if (btn.btn === ToolbarButton.MAGE || btn.btn === ToolbarButton.PRIEST) {
          // The two spellbook buttons are the same flow as the 'm' and 'p'
          // keys — handle_spell_button dispatches on which book.
          void castSpellFlow(btn.btn === ToolbarButton.MAGE
            ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS);
        } else if (btn.btn === ToolbarButton.ACT) {
          // handle_toggle_active — pin the turn to this PC, or release it.
          if (session.mode === GameMode.COMBAT) session.toggleActivePc();
        } else {
          // TODO(M3+): wire the remaining toolbar buttons to real actions.
          univ.addStringToBuf(`(${ToolbarButton[btn.btn]} is not implemented yet)`);
        }
        setStatus();
        redraw();
        return;
      }
      // The border around the terrain grid scrolls the view while aiming —
      // that's what the little arrows around the edge are pointing at
      // (boe.actions.cpp:1711). Checked before the grid, since it's outside it.
      if (isScrollable(session.mode)) {
        const shift = screen.scrollBorderAt(x, y);
        if (shift) {
          session.screenShift(shift.dx, shift.dy);
          redraw();
          return;
        }
      }
      const cell = screen.terrainCellAt(x, y);
      if (cell) {
        // handle_terrain_screen_actions (boe.actions.cpp:301) measures the
        // click from `center` in town and combat, and from the party's square
        // outdoors — not from the acting PC. That matters once the view has
        // been scrolled with the border arrows: the square under the cursor is
        // relative to what's drawn, which is `center`.
        const from = session.isOutdoors ? univ.party.outLoc : session.center;
        const clicked = { x: from.x + cell.q - 4, y: from.y + cell.r - 4 };
        // Look, Talk and Use all act on the square you clicked — handle_talk
        // (boe.actions.cpp:818) takes the destination as given and only needs
        // line of sight. Moving is the one that steps once toward it. A missile
        // or a spell is aimed at the square clicked, at whatever range it will
        // reach — reducing those to one step toward the target made every spell
        // in the game hit the square next to you and nothing else.
        if (pending === null && !isAiming()) {
          const dx = Math.sign(cell.q - 4);
          const dy = Math.sign(cell.r - 4);
          // `if(offset.x == 0 && offset.y == 0) handle_pause()`
          // (boe.actions.cpp:325) — clicking the middle of the view is Wait,
          // and in combat that is Stand Ready: the acting PC guards, and any
          // monster that steps up to them takes a free swing for it. This
          // port dropped the click on the floor instead, so clicking your own
          // figure did nothing at all.
          if (dx === 0 && dy === 0) {
            void actOn(clicked);
            setStatus();
            redraw();
            return;
          }
          void actOn({ x: from.x + dx, y: from.y + dy });
        } else {
          void actOn(clicked);
        }
        setStatus();
        redraw();
      }
    },
    // The targeting overlay follows the cursor, so a move has to repaint — but
    // only while something is actually being aimed, or every mouse twitch
    // redraws the whole 605x430 screen for nothing.
    onHover: (x, y) => {
      if (!isAiming()) {
        if (screen.hover !== null) {
          screen.hover = null;
          redraw();
        }
        return;
      }
      screen.hover = { x, y };
      redraw();
    },
    onHoverEnd: () => {
      if (screen.hover === null) return;
      screen.hover = null;
      redraw();
    },
    onKey: async (key, event) => {
      if (dialogs.handleKey(key)) {
        // Tab moves between a dialog's fields, not the browser's focus, and
        // Backspace/Space mustn't scroll or navigate behind a text field.
        if (key === 'Tab' || key === 'Backspace' || key === ' ') event.preventDefault();
        return;
      }
      // The File menu the original has and this port doesn't: Ctrl+S and
      // Ctrl+L. Checked before everything else so they work in any mode that
      // will have them, and so the browser's own Save Page doesn't fire.
      if ((event.ctrlKey || event.metaKey) && (key === 's' || key === 'S')) {
        event.preventDefault();
        void saveGameFlow();
        return;
      }
      // Ctrl+O, *not* Ctrl+L: Chrome and Firefox reserve Ctrl/Cmd+L for the
      // address bar and a page cannot intercept it — the keydown handler never
      // runs at all, so a load bound there silently does nothing. The File menu
      // is the reliable route; this is the convenience binding.
      if ((event.ctrlKey || event.metaKey) && (key === 'o' || key === 'O')) {
        event.preventDefault();
        void loadGameFlow();
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      // The map window's own key handler: Escape closes it, and it says so.
      if (screen.mapVisible && key === 'Escape') {
        screen.mapVisible = false;
        redraw();
        return;
      }
      if (session.shop) {
        // shop_chars: 'a'-'h' buy the eight visible rows, Escape leaves.
        if (key === 'Escape') {
          handleShopHit({ part: 'done' });
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          handleShopHit({ part: 'scroll', delta: key === 'ArrowUp' ? -1 : 1 });
          return;
        }
        const row = screen.shopScreen.rowForKey(session.shop, key);
        if (row >= 0) handleShopHit({ part: 'buy', row });
        return;
      }
      if (session.talk) {
        // Talking has its own letter shortcuts (talk_chars): l/n/j/b/s/r/d/g/a,
        // with Escape acting as Done and Space as Go Back.
        const preset = session.talk.presetForKey(key);
        if (preset) void activateTalkWord(preset.node);
        return;
      }
      // The play-testing speed knob, and deliberately *above* the mid-action
      // gate: a fight that turns out to be too slow should be speedable
      // without waiting for the round to end. Not a key the original has —
      // its equivalent is the GameSpeed preference — so it is kept to two
      // keys the original leaves unused.
      if (key === '-' || key === '_' || key === '=' || key === '+') {
        const slower = key === '-' || key === '_';
        setCombatPace(combatPace() * (slower ? 1.5 : 1 / 1.5));
        univ.addStringToBuf(`(Combat pace: ${combatPace().toFixed(2)}x, 1 = normal)`);
        redraw();
        return;
      }
      // Nothing below here may run while the party or the monsters are still
      // mid-turn — see `midAction`. Dialogs, shops and conversations are
      // handled above and keep their keys; this only drops the ones that would
      // start a *new* action. It matters more than it used to: a monster round
      // now takes real time, where before it was over within the keystroke.
      if (midAction()) return;
      // handle_keystroke's letters (boe.actions.cpp:2772), which are what a
      // BoE player's fingers already know. Uppercase variants that mean
      // something different in the original (M/P force a recast, L picks a
      // lock, A is alchemy) are noted where they aren't built yet.
      const inCombat = session.mode === GameMode.COMBAT;
      switch (key) {
        case 'f': case 'F':
          // Toggle combat, both ways — the same key in the original.
          if (inCombat) await endCombatFlow();
          else if (session.inTown) session.startCombat(univ.party.direction);
          else univ.addStringToBuf("Combat: can't fight out here yet.");
          break;
        case 'e': case 'E':
          if (inCombat) await endCombatFlow();
          break;
        case ' ':
          // Space is `handle_pause` (boe.actions.cpp:3003): one turn — stand
          // ready in combat, pause otherwise.
          await session.pause();
          break;
        case 'w': case 'W':
          // **w is `handle_wait`, not `handle_pause`** (boe.actions.cpp:3094).
          // They were both wired to `pause` here, so the long wait — up to
          // eighty turns of standing still in town — had no key at all.
          await session.wait();
          break;
        case 'd': case 'D':
          if (inCombat) void session.parry();
          break;
        case 'x': case 'X':
          session.toggleActivePc();
          break;
        case 't':
          beginTalk();
          break;
        case 'l':
          beginLook();
          break;
        case 'u': case 'U':
          selectSpace('use');
          break;
        case 'b': case 'B':
          selectSpace('bash');
          break;
        case 'L':
          selectSpace('pick');
          break;
        case 'r':
          await session.rest();
          break;
        case 'g': case 'G':
          // MODE_TOWN *or* MODE_COMBAT (boe.actions.cpp:3105).
          if (session.inTown || inCombat) void getItems();
          else univ.addStringToBuf('Get: nothing here');
          break;
        case 'a':
          toggleMap();
          break;
        case 's': case 'S':
          // 's' arms a missile and 's' again cancels — one function either
          // way, as in the original, and gated on the same three modes the
          // C++'s keystroke handler checks (boe.actions.cpp:1677). Outside
          // them the key is simply dead.
          if (session.mode === GameMode.COMBAT) session.handleMissile();
          else if (session.mode === GameMode.FIRING || session.mode === GameMode.THROWING) {
            session.handleMissile();
            // The cancel arm alone recentres — `center = current_pc().combat_pos`.
            recentre();
          }
          break;
        case ' ':
          // start_fancy_spell_targeting's "(Hit space to cast.)".
          if (session.mode === GameMode.FANCY_TARGET) await castCollected(session);
          // "(Hit space to rotate.)" — Space turns a wall spell rather than
          // pausing the turn (boe.actions.cpp:3001).
          else if (session.mode === GameMode.SPELL_TARGET) {
            spellCastHitReturn(session);
            redraw();
          }
          break;
        case 'm': case 'M': case 'p': case 'P':
          // While a spell is in the air the same key cancels it, which is what
          // start_spell_targeting's "(Hit 'm' to cancel.)" refers to.
          //
          // **The test is the mode, not whether a spell is armed**
          // (boe.actions.cpp:432). The two are the same question until
          // something changes the mode behind the targeting's back — a debug
          // key does exactly that — and the replay driver had this as a real
          // bug before it was fixed there.
          //
          // The MODE_TOWN_TARGET arm (:412) belongs here too, and was missing:
          // 'm' with a town spell in the air opened the picker again instead of
          // backing out. Note only the combat arm recentres.
          if (session.mode === GameMode.TOWN_TARGET) {
            univ.addStringToBuf('  Cancelled.');
            cancelTownTargeting(session);
          } else if (session.mode === GameMode.SPELL_TARGET
            || session.mode === GameMode.FANCY_TARGET) {
            univ.addStringToBuf('  Cancelled.');
            cancelSpellTargeting(session);
            recentre();
          } else {
            const spellType = key === 'm' || key === 'M'
              ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS;
            // **Capital M and P are the recast shortcut** (boe.actions.cpp:3057)
            // — `spell_forced` and `spell_recast`, which skip the picker
            // entirely and repeat the last spell of that kind. Both keys used
            // to open the picker here, so the shortcut did not exist.
            if (key === 'M' || key === 'P') void recastFlow(spellType);
            else void castSpellFlow(spellType);
          }
          break;
        case 'i': case 'z': case 'Z':
          univ.addStringToBuf("(The inventory panel is always on screen; 1-6 switches whose)");
          break;
        case 'A':
          void doAlchemyFlow();
          break;
        case '9': // Special items
          screen.itemWindow.setStatWindow(univ, ItemWinMode.SPECIAL);
          break;
        case '0': // Jobs/quests
          screen.itemWindow.setStatWindow(univ, ItemWinMode.QUESTS);
          break;
        default:
          if (key >= '1' && key <= '6') {
            // Switch which PC's inventory page is showing.
            univ.curPc = Number(key) - 1;
            screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
          }
          break;
      }
      setStatus();
      redraw();
      if (key === 'Escape' && pending) {
        // Escape out of Look leaves the mode as well as the prompt, which is
        // what puts the view back on the party.
        if (isLooking()) {
          univ.addStringToBuf('  Cancelled.');
          endLook();
          redraw();
        }
        pending = null;
        setStatus();
      }
      if (key === 'Escape' && session.spellTargeting !== null) {
        cancelSpellTargeting(session);
        recentre();
        setStatus();
        redraw();
      }
      if (key === 'Escape' && session.missile !== null) {
        // Escape's cancel arm is `handle_missile` too (boe.actions.cpp:3118),
        // so it prints "  Cancelled." like the **s** key does.
        session.handleMissile();
        recentre();
        setStatus();
        redraw();
      }
    },
  });
  router.attach();

  // The combat animations. The C++ blocks its way through these one at a time —
  // centre on the monster, fly the missile, show the hit — so the whole lot is
  // spread across a shared timeline here (`game/anim.ts`) and played back by
  // one rAF loop. Booking a slot is what keeps a spear visible in flight
  // instead of resolving in the same frame as the damage number.
  const pendingFocus: FocusEvent[] = [];
  let animLoopRunning = false;

  const startAnimLoop = (): void => {
    if (animLoopRunning) return;
    animLoopRunning = true;
    const step = (): void => {
      const now = performance.now();
      // A camera move applies the moment its slot arrives.
      while (pendingFocus.length > 0 && pendingFocus[0]!.at <= now) {
        session.center = { ...pendingFocus.shift()!.center };
      }
      screen.booms = screen.booms.filter((b) => b.expires > now);
      screen.missiles = screen.missiles.filter((m) => m.started + m.dur > now);
      redraw();
      if (pendingFocus.length > 0 || screen.booms.length > 0
        || screen.missiles.length > 0 || animPending() > 0) {
        requestAnimationFrame(step);
        return;
      }
      animLoopRunning = false;
      // The queue has drained: hand the view back to whoever owns it.
      recentreOnParty();
    };
    requestAnimationFrame(step);
  };

  /** Put the camera back where the game logic wants it after an animation. */
  const recentreOnParty = (): void => {
    // Not while the monsters are going: the queue drains between one monster's
    // action and the next, and snapping to the party in that gap would flick
    // the view back and forth all round. The C++ holds the camera on the
    // monsters for the whole turn and restores it afterwards, which here is
    // `finishCombatStep` (combat) or nothing at all (town, where it never
    // moved). Visible only once the turn is paced slowly enough to see.
    if (session.monstersGoing) {
      redraw();
      return;
    }
    const univ2 = session.univ;
    session.center = isCombat(session.mode)
      ? { ...univ2.currentPc.combatPos }
      : { ...univ2.party.getLoc() };
    redraw();
  };

  setBoomSink((boom) => {
    boomWatcher?.(boom);
    screen.booms.push(boom);
    startAnimLoop();
  });
  /**
   * Taps for a headless driver: a script can no longer read what flew or what
   * exploded off `screen.missiles`/`screen.booms` after the fact, because the
   * action it started now waits for those animations and the renderer has
   * swept them up by the time it returns. `__watchAnim` lets it record them as
   * they are raised instead. Null for both clears the tap.
   */
  let missileWatcher: ((m: Missile) => void) | null = null;
  let boomWatcher: ((b: Boom) => void) | null = null;
  setMissileSink((missile) => {
    missileWatcher?.(missile);
    screen.missiles.push(missile);
    startAnimLoop();
  });
  setFocusSink((event) => {
    pendingFocus.push(event);
    startAnimLoop();
  });

  /**
   * How the monsters' turn blocks. `animSettle` asks for this whenever the C++
   * would have called `pause()`, and without a waiter installed — tests,
   * headless runs — it returns at once instead.
   *
   * `startAnimLoop` is kicked here as well as from the sinks: a slot can be
   * booked (the post-action beat books time without drawing anything new) with
   * no boom, missile or camera move to start the loop, and nothing would then
   * repaint while the turn waits on it.
   */
  setAnimWaiter((ms) => {
    startAnimLoop();
    return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
  });

  // A saved game chosen on the startup screen (or parked by a cross-scenario
  // load) is applied now that the world it belongs to is in place. It runs over
  // the new game `startNewGame` just began, which is exactly what
  // `load_party` does to the C++'s freshly-constructed universe.
  if (openSlot !== null) {
    try {
      const data = await getSave(openSlot);
      if (data === null) throw new Error(`no saved game called "${openSlot}"`);
      applySave(data, univ);
      univ.saveSlot = openSlot;
      resumeAfterLoad();
      univ.addStringToBuf(`Game loaded: ${openSlot}.`);
    } catch (err) {
      univ.addStringToBuf(`Load failed: ${String(err)}`);
    }
  }

  hideLoadingUi();
  setStatus();
  redraw();
  setInterval(() => {
    screen.animFrame++;
    redraw();
  }, ANIM_INTERVAL_MS);

  // The File menu. It is the only route to Open that works everywhere, and it
  // is how a player finds any of this — none of it is on the game's own
  // toolbar, which is the original's and has no room.
  const menuHost = document.getElementById('game-menu-bar');
  if (menuHost !== null) {
    installMenuBar(menuHost, [{
      label: 'File',
      items: [
        {
          label: 'New Game',
          action: () => {
            // A reload *is* a new game, and is the one way to get a genuinely
            // clean Universe without rebuilding every reference into it.
            if (window.confirm('Start a new game? Anything unsaved will be lost.')) {
              window.location.reload();
            }
          },
        },
        {
          label: 'Open Game…',
          shortcut: 'Ctrl-O',
          action: () => { void loadGameFlow(); },
        },
        MENU_SEPARATOR,
        {
          label: 'Save Game…',
          shortcut: 'Ctrl-S',
          action: () => { void saveGameFlow(); },
          enabled: () => canSaveNow() === null,
        },
        {
          label: 'Export to a file…',
          action: () => {
            const refusal = canSaveNow();
            if (refusal !== null) {
              univ.addStringToBuf(refusal);
              redraw();
              return;
            }
            exportSave(univ.saveSlot ?? univ.party.pcs[0]?.name ?? 'exile', saveGame(univ));
          },
          enabled: () => canSaveNow() === null,
        },
      ],
    }, {
      // The original's Options menu (boe.menus.hpp's OPTIONS_*); the PC
      // management half of it is still to come.
      label: 'Options',
      items: [
        { label: 'Talk Notes', action: () => { void notesFlow('talk'); } },
        { label: 'Encounter Notes', action: () => { void notesFlow('encounter'); } },
      ],
    }]);
  }

  // Handles for headless verification and manual debugging.
  Object.assign(window as unknown as Record<string, unknown>, {
    __session: session,
    __univ: univ,
    __screen: screen,
    __scen: scen,
    __redraw: redraw,
    // How long the animation queue still has to run. A driver has to wait for
    // this as well as `settled()` — input is dropped while it is non-zero.
    __animPending: animPending,
    // The protective circle, for the verifier's place_spell_pattern check.
    __placePattern: (at: Location) =>
      placeSpellPattern(session, SpellPat.PROT, at, { whoHit: univ.curPc }),
    // Casts a spell without the picker, for spells the verifier wants to reach
    // directly (Word of Recall, whose whole effect is where the party ends up).
    __castSpell: (pcNum: number, spell: Spell) => castSpell(session, pcNum, spell),
    // Arms a town-targeting spell, so the verifier can drive the click path.
    __startTownTargeting: (spell: Spell) => startTownTargeting(session, spell, univ.curPc),
    // Lets the headless verifier watch which sound files actually get played.
    __setLivingSound: (fn: ((which: number) => void) | null) =>
      setLivingSound(fn ?? playSound),
    __dialogs: dialogs,
    // The typed-answer dialogs, so the verifier can drive a real text field
    // with the real keyboard.
    __getNumOfItems: getNumOfItems,
    __askText: (prompt: string) => askForText(prompt),
    __spendXp: (who: number, mode: XpMode) => spendXpFlow(who, mode),
    // Save/load without the picker, so the verifier can round-trip a real game
    // through the real serialiser.
    __saveGame: () => saveGame(univ),
    __loadGame: (data: Uint8Array) => {
      applySave(data, univ);
      resumeAfterLoad();
    },
    __watchAnim: (onMissile: ((m: Missile) => void) | null, onBoom: ((b: Boom) => void) | null) => {
      missileWatcher = onMissile;
      boomWatcher = onBoom;
    },
  });
}

main().catch((err) => {
  hideLoadingUi();
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
