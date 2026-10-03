/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { setBugFixes } from './game/bugFixes';
import { animAt, animSchedule, combatPace, setCombatPace } from './game/anim';
import { useItem } from './game/itemUse';
import { dropItemAt, handleDropItem, handleGiveItem } from './game/giveDrop';
import {
  PcChoice, SELECT_PC_CANCEL, SelectPcMode, SelectPcOpts, runSelectPc,
} from './game/selectPc';
import type { SpecialHost } from './game/specials/context';
import { SpecCtx, SpecCtxType } from './game/specials/context';
import { Direction, Location, dist, locsEqual, shiftLoc } from './core/location';
import { pcGraphic } from './render/pcPics';
import { SpellPat } from './data/pattern';
import { SPELLS, Spell, SpellSelect, spellFromNum, spellName } from './data/spell';
import { CastStatus, castableSpells, pcCanCastSpell } from './game/spellCast';
import { castSpell } from './game/spellTown';
import { combatCastCheck, combatCastSpell } from './game/spellCombat';
import {
  cancelSpellTargeting, castCollected, doCombatCast, placeTarget, spellCastHitReturn,
} from './game/spellCombatTarget';
import { takeAp } from './game/combat';
import { openJobBank } from './game/jobBank';
import { e3JobsBase } from './game/e3Jobs';
import { alchemyChoices, makePotion } from './game/alchemy';
import { getDialogDef, hasDialogDef, loadDialogDefs } from './dialogs/dialogStore';
import { XmlDialog } from './dialogs/xmlDialog';
import { pcInfoDialog } from './dialogs/pcInfoDialog';
import { itemInfoDialog } from './dialogs/itemInfoDialog';
import { STR_DIALOG_DEFS, pictTypeOf, strDialog } from './dialogs/strDialog';
import { CHOICE_DIALOG_DEFS, threeChoiceDialog } from './dialogs/threeChoiceDialog';
import { storyDialog } from './dialogs/storyDialog';
import { monsterInfoDialog } from './dialogs/monsterInfoDialog';
import { e3JobBoardDialog, jobBoardDialog } from './dialogs/jobBoardDialog';
import { pickPotionDialog, potionSlot } from './dialogs/pickPotionDialog';
import { questInfoDialog } from './dialogs/questInfoDialog';
import { NOTES_DIALOG_DEFS, adventureNotesDialog, eventJournalDialog, talkNotesDialog } from './dialogs/notesDialogs';
import {
  INPUT_DIALOG_DEFS, errorDialog, numOfItemsDialog, numResponseDialog, textResponseDialog,
} from './dialogs/inputDialogs';
import { setFieldErrorSink } from './dialogs/xmlDialog';
import { PICT_CHOICE_DIALOG_DEFS } from './dialogs/pictChoiceDialog';
import { SPEND_XP_DIALOG_DEFS, spendXpDialog } from './dialogs/spendXpDialog';
import {
  PARTY_EDITOR_DIALOG_DEFS, PartyEditorHost, confirmDeletePc, createPc, pickPcGraphic,
  pickPcName, pickRaceAbil, startNewParty,
} from './dialogs/partyEditor';
import { XpMode } from './game/createPc';
import {
  LIBRARY_DIALOG_DEFS, alchemyHelpDialog, alchemyKnownDialog, choiceDialog, pcSpellsDialog,
  skillInfoDialog, spellInfoDialog, tipOfDayDialog,
} from './dialogs/libraryDialogs';
import { setErrorSink } from './game/showError';
import {
  appendIarrayPref, clearPref, getBoolPref, getFloatPref, getIntPref, iarrayPrefContains, readAutosavePrefs,
  setPref,
} from './platform/prefs';
import { fitCanvasToPage } from './platform/pageLayout';
import { startMapWindow } from './platform/mapWindow';
import { installDebugPanel } from './platform/debugPanel';
import {
  EXILE3_CARD, EXILE3_ID, EXILE3_PICTURES, EXILE3_SHEET_OVERRIDES, EXILE3_STRING_OVERRIDES, exile3Served, prepareExile3,
} from './platform/exile3';
import { WorldMapFeed } from './render/worldMap';
import { GAME_SPEED_PACE, PREFERENCES_DIALOG_DEFS, preferencesDialog } from './dialogs/preferencesDialog';
import { setTargetLockPref } from './game/targetMode';
import { NotesKind, notesRefusal } from './game/notes';
import { ItemWinMode, QUEST_COMPLETED_OFFSET } from './game/itemWindow';
import { BASIC_BUTTON_KEYS } from './game/specials/oneshot';
import { trappedMonsters } from './game/soulCrystal';
import { cancelTownTargeting, castTownSpell, startTownTargeting } from './game/spellTarget';
import { CastDialog } from './dialogs/castDialog';
import { forcedCast, storeFor } from './game/spellRepeat';
import { GetItemsDialog } from './dialogs/getItemsDialog';
import { placeSpellPattern } from './game/spellPatterns';
import { GameMode, isCombat, isOut, isScrollable, isTown } from './game/modes';
import { Boom, setBoomSink } from './game/booms';
import { FocusEvent, animPending, setAnimWaiter, setFocusSink } from './game/anim';
import { Missile, setMissileSink } from './game/missileAnim';
import { pickNextPc } from './game/combat';
import { GameRng, launchSeed, seedForLaunch } from './core/rng';
import { DialogHost, type TouchChoice, type TouchView } from './dialogs/dialog';
import { STRING_TABLES, getStr, loadStringTables, overrideStrings, stringCount } from './data/strings';
import { Colours } from './render/colours';
import { TerSpec } from './data/terrain';
import { GameSession } from './game/session';
import { TalkAction } from './game/talk';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { applyPartySave, applySave, previewOfUniverse, readSavePreview, saveGame, serialiseSave } from './fileio/saveIo';
import { aroundWaitFade } from './platform/waitFade';
import { gunzipSync } from 'fflate';
import { sameTarContents } from './fileio/tarball';
import { SnapKind, lineage, roles } from './platform/saveRetention';
import {
  TreeInfo, createTree, exportSave, getPartyInMemory, getTree, getSnapshot, importSave, listTrees,
  SnapInfo, getSnapInfo, listSnaps, newestSnapshot, appendSnapshot, setSnapshotThumb, saveStoreAvailable, setHead, setPartyActiveScenario, setPartyInMemory, renameTree, deleteTree,
} from './platform/saveStore';
import { SaveScheduler } from './platform/saveScheduler';
import { browseTree, exportTreeZip, importAsTree, placeOf } from './platform/saveActions';
import {
  AUTOSAVE_TRIGGER_DEFAULTS, AutosaveReason, getAutosavePrefs, setAutosavePrefs,
  setAutosaveSink,
} from './game/autosave';
import { MENU_SEPARATOR, MenuItem, installFullScreenButton, installMenuBar, installMenuToggle } from './platform/menu';
import { StartupLibrary, StartupScenario, StartupSaveActions, showStartupScreen } from './platform/startup';
import { LibraryCatalog, libraryUrl } from './fileio/libraryCatalog';
import {
  InstalledScenario, getInstalledScenario, installScenario, listInstalledScenarios,
  scenarioStoreAvailable, setScenarioPreview,
} from './platform/scenarioStore';
import { LoadedPackage, ScenarioPackage, identifyScenarioFiles, loadScenarioPackage } from './fileio/scenarioPackage';
import { PackedSource } from './fileio/packedSource';
import { isE3Save } from './fileio/e3save';
import { e3SaveDefaultsFromJson, type E3SaveDefaults } from './fileio/e3SaveDefaults';
import { applyE3Save } from './fileio/e3SaveImport';
import { exportE3Save } from './fileio/e3SaveExport';
import { Scenario } from './data/scenario';
import { noScenario, readScenarioFromXml } from './fileio/scenarioXml';
import { parseXmlDoc } from './fileio/xml';
import { TOWN_NUM_OUTDOORS } from './universe/party';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { Snd, SoundPlayer } from './platform/sound';
import { installCustomSheets, installSheetOverrides, loadCustomSheets } from './render/customPics';
import { captureSaveThumb, captureTerrainView } from './render/preview';
import { BG_DARK, BG_LIGHT, setDefaultDialogBackground, setExile3Dialogs } from './render/tiling';
import { changeCursor, cursorCss, setScenarioCursors } from './platform/cursors';
import { giveHelp, setGiveHelp, setLivingSound } from './universe/living';
import { killPc } from './game/damage';
import { BOE_HEIGHT, BOE_WIDTH, COMPACT_HEIGHT, ITEM_SBAR_RECT, ToolbarButton, WIN_RECTS, gameScreen } from './render/layout';

import { CHROME_SHEETS, Screen, toolbarButtons, toolbarMode } from './render/screen';
import { TouchSheet } from './platform/touchSheet';
import { TouchControls, setTouchControls, touchControlsOn } from './platform/touchControls';
import { openTouchLayoutPanel } from './platform/touchLayout';
import { type Aiming, aimSpaceAction, autoAim, currentAim, moveAim, talkAim } from './game/aimCursor';
import { E3_PATTERN_SLOTS, tilePattern } from './render/tiling';
import { E3MovieScreen } from './render/e3MovieScreen';
import {
  DEFAULT_UI_SCALE, DisplayMode, UI_SCALES, UI_SCALE_FIT, desktop, placeBesideGame,
} from './render/desktop';
import { MAP_DEFAULT_POS, MAP_H, MAP_W } from './render/mapScreen';
import { CAPTION_H, WINDOW_TITLES, drawCaption, inRect, windowFrames, type ChromeFlavour } from './render/windowChrome';
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
/**
 * The URL a game gets once the startup screen hands it over, so the browser's
 * Back button leaves the game for the main menu. Reloading `?play=<id>` goes
 * back into the game (the tree it was last saved into, `TREE_KEY`); with
 * nothing kept for that scenario, or on `?party=`, it shows the main menu and drops the
 * parameter.
 */
const GAME_PARAMS = ['play', 'party'] as const;

function urlWith(param: (typeof GAME_PARAMS)[number] | null, value = ''): string {
  const q = new URLSearchParams(window.location.search);
  for (const p of GAME_PARAMS) q.delete(p);
  if (param !== null) q.set(param, value);
  const search = q.toString();
  return `${window.location.pathname}${search === '' ? '' : `?${search}`}`;
}

function scenarioFromQuery(): string | null {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return q && /^[a-z0-9_-]+$/i.test(q) ? q : null;
}

/**
 * The scenarios shipped in `public/scenarios`. There's no directory listing to
 * fetch over HTTP, so the ids live here; their titles and teasers come out of
 * each one's own `scenario.xml`, so nothing is duplicated but the id.
 *
 * `exile3` is generated rather than committed: `tools/e3convert/ensure.ts`
 * converts it from Spiderweb's own installer (`vendor/exile3/`) before
 * `npm run dev`. The published site leaves the converted copy out (it is a
 * modified one: vendor/exile3/README.md) and serves the installer instead,
 * which the browser converts on first play (platform/exile3.ts).
 */
const BUNDLED_SCENARIOS = ['valleydy', 'stealth', 'zakhazi', 'busywork', 'exile3'];

/**
 * A save for a scenario other than the one running can't be applied in place —
 * the whole world would have to be re-fetched. Instead the slot is parked here
 * and the page reopened on the right scenario, which `main` then notices.
 */
// The project's old name, kept: renaming it would lose what players have stored.
const PENDING_SAVE_KEY = 'exile-js.pendingSave';
/**
 * The tree this tab's game is saved into, so a reload of `?play=` picks it
 * back up at its newest snapshot. Per tab (sessionStorage), as the URL is.
 */
const TREE_KEY = 'exile-js.tree';

/**
 * The newest move of a game whose page went away before it could be written
 * into the tree (`SaveScheduler.flush`): its tree, kind and reason, and the
 * gzipped `.exg` in base64. localStorage, not sessionStorage, so closing the
 * tab and coming back by the main menu loses nothing either. The next load of
 * that tree adds it (`adoptUnsaved`).
 */
const UNSAVED_KEY = 'exile-js.unsaved';

/**
 * An Exile III save (`exile3.sav`) picked on the startup screen. It can only
 * be read with Exile III loaded, so it is parked here — base64, with its file
 * name — and the page opened on Exile III, which reads it and starts a tree.
 */
const PENDING_E3_SAVE_KEY = 'exile-js.pendingE3Save';

function toBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Two gzipped `.exg`s hold the same game: compared unzipped, and without the times they were written. */
function sameGame(a: Uint8Array, b: Uint8Array): boolean {
  return sameTarContents(gunzipSync(a), gunzipSync(b));
}

/**
 * Restart on the party-death dialog: `start_new_game`, the party editor and
 * then the startup screen. The page reloads to get a clean Universe, and this
 * tells the reloaded page to go straight to the editor.
 */
const PENDING_NEW_PARTY_KEY = 'exile-js.pendingNewParty';

/**
 * Where the scenario library's `catalog.json` lives: the bucket in a
 * production build (`VITE_LIBRARY_URL`), else `/library/`, which the dev
 * server fills from `library/dist` (vite.config.ts).
 */
const LIBRARY_URL: string = (import.meta.env['VITE_LIBRARY_URL'] as string | undefined)
  ?? `${import.meta.env.BASE_URL}library/catalog.json`;

/** The library for the startup screen; null if there's no catalog to read. */
async function loadLibrary(
  installed: Set<string>, withoutGraphics: Set<string>,
): Promise<StartupLibrary | null> {
  try {
    const resp = await fetch(LIBRARY_URL);
    if (!resp.ok) return null;
    const catalog = await resp.json() as LibraryCatalog;
    // An install that should have custom graphics but was stored without
    // them counts as not installed, so the next click installs it again.
    // Scenarios whose `.bmp` was MacBinary-wrapped were stored that way
    // before the loader learnt to unwrap it.
    for (const e of catalog.scenarios) {
      if (e.customGraphics && withoutGraphics.has(e.id)) installed.delete(e.id);
    }
    return {
      entries: catalog.scenarios.filter((e) => !BUNDLED_SCENARIOS.includes(e.id)),
      url: (path) => libraryUrl(LIBRARY_URL, path),
      installed,
      install: async (entry) => {
        const download = await fetch(libraryUrl(LIBRARY_URL, entry.file));
        if (!download.ok) throw new Error(`download failed (${download.status})`);
        const data = new Uint8Array(await download.arrayBuffer());
        const pkg = identifyScenarioFiles([{ name: entry.file, data }])
          .find((p) => p.fileName === entry.package);
        if (pkg === undefined) throw new Error(`${entry.package} isn't in the download`);
        await installScenario(pkg);
        installed.add(pkg.id);
      },
    };
  } catch {
    return null;
  }
}

/** An installed scenario as the startup screen lists it. */
function startupEntry(scen: InstalledScenario): StartupScenario {
  return {
    id: scen.id, title: scen.title, blurb: scen.blurb, icon: scen.introPic,
    ...(scen.preview ? { preview: URL.createObjectURL(new Blob([scen.preview as BlobPart], { type: 'image/png' })) } : {}),
  };
}

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
  // The status line goes with them: it reports loading, and in play it would
  // only be a footer under the game.
  document.body.classList.add('playing');
}

/** The spinner starts visible; the startup screen hides it and this puts it back. */
function showLoadingUi(): void {
  for (const id of LOADING_UI) document.getElementById(id)?.classList.remove('hidden');
  document.body.classList.remove('playing');
}

async function main(): Promise<void> {
  // The pop-out map is this same page with none of the game in it.
  if (new URLSearchParams(window.location.search).get('popout') === 'map') {
    hideLoadingUi();
    startMapWindow();
    return;
  }
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
  /** The snapshot to open once the world is loaded: a tree, and one of its saves (absent: the newest). */
  type OpenTarget = { treeId: string; seq?: number };
  let openTarget = null as OpenTarget | null;
  try {
    const parked = JSON.parse(window.sessionStorage.getItem(PENDING_SAVE_KEY) ?? 'null') as OpenTarget | null;
    if (parked !== null && typeof parked.treeId === 'string') openTarget = parked;
  } catch { /* nothing parked */ }
  window.sessionStorage.removeItem(PENDING_SAVE_KEY);
  const newPartyPending = window.sessionStorage.getItem(PENDING_NEW_PARTY_KEY) !== null;
  window.sessionStorage.removeItem(PENDING_NEW_PARTY_KEY);
  /**
   * Make New Party from the startup screen: the party editor with no scenario
   * loaded at all, as the C++'s `start_new_game` runs it, then back to the
   * startup screen with the result in memory.
   */
  let makingParty = false;
  /** The party in memory, when the startup screen is taking it into a scenario. */
  let enteringParty: Uint8Array | null = null;
  /**
   * A reload of a game's page (`?play=<id>`) goes back into that game, at the
   * newest snapshot of the tree it was being saved into, rather than to the
   * main menu.
   */
  let resuming = false;
  const playing = new URLSearchParams(window.location.search).get('play');
  let pendingE3: { name: string; data: Uint8Array } | null = null;
  try {
    const parked = JSON.parse(window.sessionStorage.getItem(PENDING_E3_SAVE_KEY) ?? 'null') as
      { name: string; data: string } | null;
    if (name === null && parked !== null && playing === EXILE3_ID) {
      pendingE3 = { name: parked.name, data: fromBase64(parked.data) };
      name = playing;
    }
  } catch { /* nothing parked */ }
  window.sessionStorage.removeItem(PENDING_E3_SAVE_KEY);
  // A save parked by a cross-scenario load names its scenario the same way.
  if (name === null && openTarget !== null && playing !== null) name = playing;
  if (name === null && openTarget === null && playing !== null && saveStoreAvailable()) {
    const kept = window.sessionStorage.getItem(TREE_KEY);
    const tree = kept === null ? null : await getTree(kept).catch(() => null);
    if (tree !== null && tree.scenarioId !== '' && tree.scenarioId === playing) {
      openTarget = { treeId: tree.id };
      resuming = true;
      name = playing;
      window.addEventListener('popstate', () => { window.location.reload(); });
    }
  }
  if (name === null && openTarget === null && newPartyPending) {
    window.history.replaceState(null, '', urlWith('party', 'new'));
    makingParty = true;
    name = '';
  }
  if (name === null) {
    if (GAME_PARAMS.some((p) => new URLSearchParams(window.location.search).has(p))) {
      window.history.replaceState(null, '', urlWith(null));
    }
    hideLoadingUi();
    document.body.classList.add('starting');
    status.textContent = 'Choose a game.';
    const headers = (await Promise.all(BUNDLED_SCENARIOS.map(async (id) => {
      try {
        const url = `${import.meta.env.BASE_URL}scenarios/${id}/scenario.xml`;
        const hdr = readScenarioFromXml(await parseXmlDoc(await (await fetch(url)).text(), url));
        return {
          id, title: hdr.title, blurb: hdr.teasers.find((t) => t !== '') ?? '',
          icon: id === EXILE3_ID ? EXILE3_CARD.icon : hdr.introPic as number | string,
          // Made by scripts/scenario-previews.mjs; the card drops it if missing.
          preview: id === EXILE3_ID ? EXILE3_CARD.preview : `${import.meta.env.BASE_URL}scenarios/${id}/preview.png`,
        };
      } catch {
        // Exile III is converted only on the dev server; elsewhere its card
        // is fixed, and choosing it converts it (platform/exile3.ts).
        if (id === EXILE3_ID) return EXILE3_CARD;
        // A scenario that won't even parse its header is still offered by id,
        // so the screen never comes up empty because of one bad directory.
        return { id, title: id, blurb: '' };
      }
    })));
    // The player's own library follows the bundled four.
    const added: StartupScenario[] = [];
    const installedIds = new Set<string>();
    const withoutGraphics = new Set<string>();
    if (scenarioStoreAvailable()) {
      for (const scen of await listInstalledScenarios()) {
        // Exile III's converted copy is kept in the same store, but its card
        // is the bundled one, with its committed picture.
        if (scen.id === EXILE3_ID) continue;
        added.push(startupEntry(scen));
        installedIds.add(scen.id);
        if (!scen.hasGraphics) withoutGraphics.add(scen.id);
      }
    }
    const library = scenarioStoreAvailable() ? await loadLibrary(installedIds, withoutGraphics) : null;
    const games = saveStoreAvailable() ? await listTrees() : [];
    const inMemory = saveStoreAvailable() ? await getPartyInMemory() : null;
    // Each PC's picture, cut from the game's own sheets as the party editor
    // draws it. A custom one (1000+) belongs to a scenario and isn't to hand.
    const portraitSheets = new SheetStore();
    const portrait = async (pic: number): Promise<HTMLCanvasElement | undefined> => {
      const g = pic < 1000 ? pcGraphic(pic, Direction.N) : null;
      if (g === null) return undefined;
      const sheet = await portraitSheets.load(g.sheetName).catch(() => null);
      if (sheet === null) return undefined;
      const art = document.createElement('canvas');
      art.width = g.rect.right - g.rect.left;
      art.height = g.rect.bottom - g.rect.top;
      art.getContext('2d')!.drawImage(
        sheet, g.rect.left, g.rect.top, art.width, art.height, 0, 0, art.width, art.height);
      return art;
    };
    const partyPcs = inMemory === null ? null : await Promise.all(readSavePreview(inMemory.data).pcs
      .filter((pc) => pc.mainStatus !== MainStatus.ABSENT)
      .map(async (pc) => ({
        name: pc.name,
        level: pc.level,
        race: pc.race,
        alive: pc.mainStatus === MainStatus.ALIVE,
        health: pc.health,
        maxHealth: pc.maxHealth,
        sp: pc.sp,
        maxSp: pc.maxSp,
        picture: await portrait(pc.graphic),
      })));
    const known = (id: string): { title: string; icon?: number | string } | undefined =>
      headers.find((h) => h.id === id) ?? added.find((h) => h.id === id)
        ?? library?.entries.find((e) => e.id === id);
    const titleOf = (id: string): string | undefined => known(id)?.title;
    const when = (at: number): string =>
      new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    // The newest save in the scenario the party in memory is off in, to resume.
    const activeId = inMemory?.activeScenario;
    const resumeGame = activeId === undefined ? undefined
      : games.find((game) => game.scenarioId === activeId);
    const saveActions: StartupSaveActions = {
      browse: (id) => browseTree(id, titleOf(games.find((g) => g.id === id)?.scenarioId ?? '') ?? '', true),
      rename: renameTree,
      remove: deleteTree,
      importFile: async () => {
        const picked = await importSave();
        if (picked === null) return null;
        if (isE3Save(picked.data)) {
          window.sessionStorage.setItem(PENDING_E3_SAVE_KEY, JSON.stringify({
            name: picked.name.replace(/\.sav$/i, ''), data: toBase64(picked.data),
          }));
          window.sessionStorage.removeItem(TREE_KEY);
          window.location.href = urlWith('play', EXILE3_ID);
          return null;
        }
        const outcome = await importAsTree(picked);
        if ('error' in outcome) {
          window.alert(outcome.error);
          return null;
        }
        return outcome.treeId;
      },
    };
    const choice = await showStartupScreen(document.getElementById('startup-host')!, {
      official: headers,
      added,
      tree: games.map((game) => {
        const id = game.scenarioId;
        const icon = known(id)?.icon;
        const { cover } = game;
        const saves = `${game.count} save${game.count === 1 ? '' : 's'}`;
        return {
          id: game.id,
          scenarioId: id,
          name: game.name,
          // The scenario's title if it is installed, else its id — a save can
          // name a scenario that isn't, which is the case the C++ shows "could
          // not be found" for. A party between scenarios lists who is in it:
          // loading one makes it the party in memory.
          label: id === ''
            ? `Party: ${cover.preview.pcs.filter((pc) => pc.name !== '').map((pc) => pc.name).join(', ')}`
            : titleOf(id) ?? id,
          detail: id === ''
            ? 'Between scenarios'
            : `Day ${Math.floor(cover.preview.age / 3700) + 1}${cover.place === '' ? '' : ` · ${cover.place}`}`,
          when: `${when(cover.savedAt)} · ${saves}`,
          ...(cover.thumb ? { thumb: URL.createObjectURL(new Blob([cover.thumb as BlobPart], { type: 'image/webp' })) } : {}),
          ...(icon !== undefined ? { icon } : {}),
        };
      }),
      ...(saveStoreAvailable() ? { saveActions } : {}),
      ...(library ? { library } : {}),
      ...(saveStoreAvailable() ? {
        party: {
          pcs: partyPcs,
          forget: () => setPartyInMemory(null),
          ...(activeId !== undefined ? {
            active: {
              title: titleOf(activeId) ?? activeId,
              ...(resumeGame !== undefined ? {
                resume: { scenarioId: activeId, treeId: resumeGame.id, label: `${resumeGame.name}, ${when(resumeGame.cover.savedAt)}` },
              } : {}),
            },
          } : {}),
        },
      } : {}),
    });
    if (choice.tree !== undefined && choice.scenarioId === '') {
      // A party-only save: `finish_load_party` makes it the party in memory and
      // stays on the startup screen (boe.fileio.cpp:66).
      const game = await getTree(choice.tree.id);
      const seq = choice.tree.seq ?? await newestSnapshot(choice.tree.id).catch(() => null) ?? game?.head ?? 1;
      const data = await getSnapshot(choice.tree.id, seq);
      if (data !== null) await setPartyInMemory(data);
      window.location.reload();
      return;
    }
    // Whatever game this tab was keeping belongs to the game being left.
    window.sessionStorage.removeItem(TREE_KEY);
    // A history entry for the game, so Back returns to this menu. The page
    // reloads to get there, which is how this port gets a clean Universe.
    window.history.pushState(null, '', choice.party === 'make'
      ? urlWith('party', 'new')
      : urlWith('play', choice.scenarioId));
    window.addEventListener('popstate', () => { window.location.reload(); });
    makingParty = choice.party === 'make';
    if (choice.party === 'enter') enteringParty = inMemory?.data ?? null;
    name = choice.scenarioId;
    openTarget = choice.tree === undefined ? null
      : { treeId: choice.tree.id, ...(choice.tree.seq !== undefined ? { seq: choice.tree.seq } : {}) };
    document.body.classList.remove('starting');
  }
  showLoadingUi();
  /** `DisplayMode` and `UIScale`, OBoE's two window preferences. */
  const fitDesktop = (): boolean => fitCanvasToPage(canvas,
    getIntPref('DisplayMode', DisplayMode.CENTRE), getFloatPref('UIScale', DEFAULT_UI_SCALE));
  fitDesktop();

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
    // draw_startup's picture, behind the party editor at the start of a game.
    'startup',
    // The pictures in help-outdoor, help-combat and help-town (PIC_FULL 1400-1402).
    'outhelp', 'fighthelp', 'townhelp',
  ];
  for (let i = 1; i <= 11; i++) sheets.push(`monst${i}`);
  const dialogNames = ['pc-info', 'quest-info', 'get-items', 'item-info', 'many-str', 'monster-info', 'job-board',
    'pick-potion', 'party-death', 'steal-item', 'select-pc', 'attack-friendly', 'boat-bridge',
    'locked-door-action', 'soul-crystal', 'view-sign', ...CHOICE_DIALOG_DEFS, 'removed-special-items', 'keep-stored-items', 'congrats-save', ...STR_DIALOG_DEFS, ...NOTES_DIALOG_DEFS,
    ...INPUT_DIALOG_DEFS, ...PICT_CHOICE_DIALOG_DEFS, ...SPEND_XP_DIALOG_DEFS,
    ...PARTY_EDITOR_DIALOG_DEFS, ...LIBRARY_DIALOG_DEFS, ...PREFERENCES_DIALOG_DEFS];
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
  // A bundled scenario is fetched file by file; anything else is a package
  // the player installed, already whole in IndexedDB.
  const bundledUrl = `${import.meta.env.BASE_URL}scenarios/${name}/`;
  let isBundled = BUNDLED_SCENARIOS.includes(name);
  // Exile III: the dev server serves it converted; anywhere else the browser
  // converts Spiderweb's installer once and keeps it (platform/exile3.ts).
  let exile3Package: ScenarioPackage | null = null;
  if (name === EXILE3_ID && !makingParty && !(await exile3Served())) {
    isBundled = false;
    exile3Package = await prepareExile3((what, done) => {
      status.textContent = done > 0 && done < 1 ? `${what} ${Math.round(done * 100)}%` : what;
    });
    status.textContent = '';
  }
  let scen: Scenario;
  let packageSheets: LoadedPackage['sheets'] = [];
  let packageSounds: LoadedPackage['sounds'] = new Map();
  let packageCursors: LoadedPackage['cursors'] = new Map();
  let packageOverrides: LoadedPackage['overrides'] = new Map();
  let packageStrings: LoadedPackage['strings'] = new Map();
  let installedPreview = true;
  let installedPackage: ScenarioPackage | null = null;
  if (makingParty) {
    scen = noScenario();
  } else if (isBundled) {
    scen = await loadScenario(new FetchSource(bundledUrl, tick), opcodes, addTotal);
  } else {
    const installed = exile3Package ?? (scenarioStoreAvailable() ? await getInstalledScenario(name) : null);
    if (installed === null) throw new Error(`the scenario "${name}" isn't installed`);
    installedPackage = installed;
    const loaded = await loadScenarioPackage(installed, opcodes, addTotal);
    scen = loaded.scenario;
    packageSheets = loaded.sheets;
    packageSounds = loaded.sounds;
    packageCursors = loaded.cursors;
    packageOverrides = loaded.overrides;
    packageStrings = loaded.strings;
    for (const w of loaded.warnings) console.warn(`${name}: ${w}`);
    installedPreview = (await listInstalledScenarios()).find((s) => s.id === name)?.preview !== undefined;
  }

  await Promise.all([sheetsReady, fontsReady]);
  // The scenario's own graphics — `load_spec_graphics_v2`, or the legacy
  // `.bmp` cut into sheets. Not ticked: how many sheets there are is only
  // known now, after the bar was sized.
  if (isBundled) await loadCustomSheets(store, scen, new FetchSource(bundledUrl));
  else await installCustomSheets(store, packageSheets);
  // Its replacements for the game's own sheets. As with sounds, a bundled
  // scenario can't be listed, and only a served Exile III has any.
  if (!isBundled) await installSheetOverrides(store, packageOverrides);
  else if (name === EXILE3_ID) {
    const src = new FetchSource(bundledUrl);
    await installSheetOverrides(store, new Map(await Promise.all([...EXILE3_SHEET_OVERRIDES, ...EXILE3_PICTURES].map(
      async (n) => [n, await src.getBinary(`graphics/${n}.png`)] as [string, Uint8Array]))));
  }

  // Its lines for the game's string tables; again only Exile III, served, has
  // any: its instant help (`EXILE3_STRING_OVERRIDES`).
  if (!isBundled) for (const [n, text] of packageStrings) overrideStrings(n, text);
  else if (name === EXILE3_ID) {
    const src = new FetchSource(bundledUrl);
    for (const n of EXILE3_STRING_OVERRIDES) overrideStrings(n, await src.getText(`strings/${n}.txt`));
  }

  // A fresh roll every launch, as Exile III's `srand` at startup gives it, or
  // the one `?seed=` pins. Said in the console so a play-test can be rerun.
  const rng = new GameRng();
  const seed = launchSeed(window.location.search);
  seedForLaunch(rng, seed);
  console.info(`blades-of-exile-ts: dice seed ${seed} (add ?seed=${seed} to the URL to replay it)`);
  const univ = new Universe(scen, rng, PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  const sound = new SoundPlayer();
  // The scenario's own sounds. A package lists its files; a bundled scenario
  // is fetched file by file and can't be listed, and asking for a sound it
  // doesn't have is a failed request the console reports. None of the
  // bundled library ships sounds, and a served Exile III ships all hundred
  // (tools/e3convert, `sounds/SND0–99.wav`), so that is the one asked.
  const bytes = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;
  const scenSounds = new Map<number, () => Promise<ArrayBuffer>>();
  if (!isBundled) {
    for (const [n, wav] of packageSounds) scenSounds.set(n, () => Promise.resolve(bytes(wav)));
  } else if (name === EXILE3_ID) {
    const src = new FetchSource(bundledUrl);
    for (let n = 0; n < 100; n++) scenSounds.set(n, async () => bytes(await src.getBinary(`sounds/SND${n}.wav`)));
  }
  sound.setScenarioSounds(scenSounds);
  // `cDialog::defaultBackground`: Exile III's dialogs are light, with black
  // text, on its own pattern (render/tiling.ts, `E3_PATTERN_SLOTS`).
  setDefaultDialogBackground(scen.featureFlags['backgrounds'] === 'exile3' ? BG_LIGHT : BG_DARK);
  setExile3Dialogs(scen.featureFlags['backgrounds'] === 'exile3');
  setScenarioCursors(scen.featureFlags['cursors'], (n) => {
    const png = packageCursors.get(n);
    return isBundled || !png ? `${bundledUrl}cursors/${n}.png`
      : URL.createObjectURL(new Blob([bytes(png)], { type: 'image/png' }));
  });
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
  // A new game chosen on the startup screen builds its party first — the
  // C++'s `start_new_game`, which runs before a scenario is entered — so
  // `startNewGame` (put_party_in_scen) waits for the editor, further down.
  // A direct `?scenario=` link and a saved game skip the editor.
  const buildParty = scenarioFromQuery() === null && openTarget === null && enteringParty === null
    && pendingE3 === null;
  if (!buildParty && enteringParty === null) session.startNewGame();
  const screen = new Screen(ctx, store);
  // The windows' title bars: each game's own, by the scenario's look.
  const chromeFlavour = (): ChromeFlavour =>
    univ.scenario.featureFlags['backgrounds'] === 'exile3' ? 'exile3' : 'boe';
  screen.mapScreen.captionH = CAPTION_H;
  // The map has a system menu, so its caption carries the game's icon.
  const windowIcons: Record<ChromeFlavour, HTMLImageElement> = {
    boe: new Image(), exile3: new Image(),
  };
  windowIcons.boe.src = `${import.meta.env.BASE_URL}data/graphics/boe-icon.png`;
  windowIcons.exile3.src = EXILE3_CARD.icon;
  /** Whether the map was the last window clicked, which makes its caption the active one. */
  let mapFocused = false;
  // With no scenario there is no game screen to draw, only the backdrop the
  // party editor sits on — from the very first redraw.
  if (makingParty) screen.startupBackdrop = true;
  // `set_stat_window(ITEM_WIN_PC1)` from create_pc_graphics (boe.party.cpp:226)
  // — the panel's list and scroll limit are set before it is first drawn.
  screen.itemWindow.setStatWindowForPc(univ, 0);

  // Where the pointer is on the canvas, for `change_cursor`; null off it.
  let pointer: { x: number; y: number } | null = null;
  let shownCursor = '';
  // Made once the toolbar's handler exists, below; redraws before then skip it.
  let touchPads: TouchControls | undefined;
  /** The inventory and party sheets, made once their handlers exist. */
  let touchSheet: TouchSheet | undefined;
  /**
   * The aim the keyboard cursor belongs to (`game/aimCursor.ts`). A new
   * spell, missile or multi-target pick puts the cursor back on the nearest
   * enemy; nothing aimed, and there's no cursor.
   */
  let aimToken: unknown = null;
  let aimPicks = -1;
  /**
   * Talk's aim (`talkAim`), with touch controls on and Talk armed. Filled in
   * once `pending` exists, below; until then nothing is armed.
   */
  let talkAimNow: () => Aiming | null = () => null;
  /** What's being aimed: a spell, a missile, or (by finger) whom to talk to. */
  const aimNow = (): Aiming | null => currentAim(session) ?? talkAimNow();
  const syncAim = (): void => {
    const aim = aimNow();
    screen.aimTalk = aim?.targets === 'people';
    if (!aim) {
      screen.aimAt = null;
      aimToken = null;
      return;
    }
    if (aim.token === aimToken && aim.picks === aimPicks && screen.aimAt !== null) return;
    aimToken = aim.token;
    aimPicks = aim.picks;
    screen.aimAt = autoAim(session, aim);
  };
  /**
   * View → Hide Toolbar: the compact screen (`COMPACT_HEIGHT`), except while
   * a conversation or a shop has the whole left column. A change of height
   * refits the canvas, so the game grows or shrinks to the window.
   */
  const syncCompact = (): void => {
    const on = getBoolPref('HideToolbar') && !screen.startupBackdrop;
    screen.compact = on;
    const h = on && !session.talk && !session.shop ? COMPACT_HEIGHT : BOE_HEIGHT;
    if (h === gameScreen.h) return;
    gameScreen.h = h;
    fitDesktop();
  };
  /**
   * Opening a saved game starts a new one first (`load_party` over a fresh
   * universe, below) and only then reads the save out of IndexedDB. Anything
   * drawn in between — a resize, a sheet arriving — would flash the new
   * game's opening screen under the spinner, so nothing is drawn until the
   * save is in place.
   */
  let holdFrames = openTarget !== null || pendingE3 !== null;
  const redraw = (): void => {
    if (holdFrames) return;
    syncCompact();
    syncAim();
    // The desktop around the game screen gets the same background pattern.
    // OBoE's put_background tiles its whole window (boe.graphics.cpp:683).
    // It's tiled in the game screen's coordinates, so the pattern runs on
    // into the screen without a seam. The game screen is then drawn over it
    // at its offset, and that offset stays set afterwards. The map and
    // dialogs belong to the desktop, so they're drawn without it.
    ctx.setTransform(1, 0, 0, 1, desktop.gameX, desktop.gameY);
    if (desktop.w !== BOE_WIDTH || desktop.h !== gameScreen.h) {
      const whole = {
        left: -desktop.gameX, top: -desktop.gameY,
        right: desktop.w - desktop.gameX, bottom: desktop.h - desktop.gameY,
      };
      const pats = store.get('pixpats');
      if (pats) tilePattern(ctx, pats, screen.backgroundIndex(session), whole);
      else {
        ctx.fillStyle = '#000';
        ctx.fillRect(whole.left, whole.top, whole.right - whole.left, whole.bottom - whole.top);
      }
    }
    screen.draw(session);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (screen.mapVisible) {
      screen.mapScreen.draw(session);
      const flavour = chromeFlavour();
      const icon = windowIcons[flavour];
      drawCaption(ctx, screen.mapScreen.window, WINDOW_TITLES[flavour].map, {
        flavour, active: mapFocused && dialogs.active === null, icon: icon.complete ? icon : null,
      });
    }
    dialogs.draw();
    ctx.restore();
    worldMap.update();
    const css = cursorCss(changeCursor(session.mode, pointer?.x ?? null, pointer?.y ?? null,
      dialogs.active !== null));
    if (css !== shownCursor) {
      canvas.style.cursor = css;
      shownCursor = css;
    }
    touchPads?.sync();
    touchSheet?.sync(touchControlsOn());
  };
  const dialogs = new DialogHost(ctx, store, () => redraw());
  windowFrames.on = true;
  dialogs.chrome = () => {
    const flavour = chromeFlavour();
    return { flavour, title: WINDOW_TITLES[flavour].dialog };
  };
  for (const icon of Object.values(windowIcons)) icon.addEventListener('load', () => redraw());
  // The pop-out map, if one is open; it hears about every redraw.
  const worldMap = new WorldMapFeed(store, () => session, () => univ.scenario.title);
  worldMap.attach();
  // Exposed now rather than with the other handles at the end of `main`:
  // a new party is built in dialogs before the game has even started.
  Object.assign(window as unknown as Record<string, unknown>, { __dialogs: dialogs, __univ: univ });

  /**
   * `showError` / `showWarning` — for the game rules (`game/showError.ts`)
   * and for a text field that won't take what was typed. Both open on top of
   * whatever is up, as the C++'s do with their `parent`.
   */
  const showErrorBox = (str1: string, str2 = '', warning = false): void => {
    void dialogs.runNested(errorDialog(ctx, store, str1, str2, warning)).then(() => redraw());
  };
  setErrorSink(showErrorBox);

  // The player's preferences, as `init_prefs` reads them. `?pace=` on the URL
  // still wins over the saved game speed, which is what the verifier uses.
  const applyPrefs = (): void => {
    sound.enabled = getBoolPref('PlaySounds', true);
    if (new URLSearchParams(window.location.search).get('pace') === null) {
      setCombatPace(GAME_SPEED_PACE[getIntPref('GameSpeed', 1)] ?? 1);
    }
    setTargetLockPref(getBoolPref('TargetLock', true));
    setBugFixes(getBoolPref('FixBugs', false));
    const reasons = Object.keys(AUTOSAVE_TRIGGER_DEFAULTS);
    setAutosavePrefs(readAutosavePrefs(reasons, AUTOSAVE_TRIGGER_DEFAULTS));
    // OBoE's master switch is gone; a stored `false` would only confuse.
    clearPref('Autosave');
  };
  applyPrefs();

  /** File › Preferences — `pick_preferences`. */
  const preferencesFlow = async (): Promise<void> => {
    const auto = getAutosavePrefs();
    const next = await preferencesDialog(ctx, store, {
      playSounds: getBoolPref('PlaySounds', true),
      gameSpeed: getIntPref('GameSpeed', 1),
      targetLock: getBoolPref('TargetLock', true),
      showInstantHelp: getBoolPref('ShowInstantHelp', true),
      autosave: auto,
      easyMode: univ.party.easyMode,
      lessWm: univ.party.lessWm,
      displayMode: getIntPref('DisplayMode', DisplayMode.CENTRE),
      uiScale: getFloatPref('UIScale', DEFAULT_UI_SCALE),
      fixBugs: getBoolPref('FixBugs', false),
      // Exile III's party+0xc7b, kept where it keeps it (tools/e3convert, specials.ts).
      ...(univ.scenario.featureFlags['room-descriptions'] === 'exile3'
        ? { roomDescriptions: univ.party.getSdf(306, 3) !== 0 } : {}),
    }, {
      nest: (screen) => dialogs.runNested(screen),
      resetHelp: () => clearPref('ReceivedHelp'),
    });
    if (next) {
      setPref('PlaySounds', next.playSounds);
      setPref('GameSpeed', next.gameSpeed);
      setPref('TargetLock', next.targetLock);
      setPref('ShowInstantHelp', next.showInstantHelp);
      setPref('FixBugs', next.fixBugs);
      for (const [reason, on] of Object.entries(next.autosave.triggers)) {
        setPref(`Autosave_${reason}`, on);
      }
      // A game is running, so these two are the party's, not preferences
      // (boe.dlgutil.cpp:1408).
      univ.party.easyMode = next.easyMode;
      univ.party.lessWm = next.lessWm;
      if (next.roomDescriptions !== undefined) univ.party.setSdf(306, 3, next.roomDescriptions ? 1 : 0);
      applyPrefs();
      setDesktopPrefs(next.displayMode, next.uiScale);
    }
    redraw();
  };

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
    // select_pc's dialog half (boe.items.cpp:896), on select-pc.xml: the
    // caller's prompt is the title, as the original's `char_select_pc` took one
    // too (items.c:1245). A PC who can't be picked loses their button, and
    // their name as well unless there is a reason to show beside it.
    const dlg = new XmlDialog(ctx, store, getDialogDef('select-pc'));
    if (prompt) dlg.setText('title', prompt);
    let highest = 0;
    let last = 0;
    let allEqual = true;
    for (const option of options) {
      const n = option.index + 1;
      const pc = univ.party.pcs[option.index];
      dlg.setText(`pc${n}`, option.label);
      if (highlight !== undefined && pc?.isAlive) {
        const skill = pc.skills[highlight] ?? 0;
        if (skill > highest) highest = skill;
        if (skill !== last) allEqual = false;
        last = skill;
      }
      if (!option.canPick) {
        dlg.hide(`pick${n}`);
        if (!option.extra) dlg.hide(`pc${n}`);
      }
    }
    if (highlight !== undefined) {
      dlg.setText('hint', dlg.getText('hint').replace('{{skill}}', getStr('skills', highlight * 2 + 1)));
      for (const option of options) {
        const skill = univ.party.pcs[option.index]?.skills[highlight] ?? 0;
        if (skill === highest && !allEqual) dlg.setColour(`pc${option.index + 1}`, Colours.LIGHT_GREEN);
      }
    } else {
      dlg.hide('hint');
    }
    // `allow_choose_all` is only ever true for the debug menu's three commands.
    dlg.hide('pick-all');
    dlg.hide('all');
    const picked = await dialogs.runNested(dlg);
    const index = Number(picked.replace(/^pick/, '')) - 1;
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

  const partyHost: PartyEditorHost = {
    ctx, store, univ,
    nest: (screen) => dialogs.runNested(screen),
    spendXp: (who, mode) => spendXpFlow(who, mode),
    redraw: () => redraw(),
  };

  /** Options › Change PC Graphic — `handle_new_pc_graphic` (boe.actions.cpp:4408). */
  const newPcGraphicFlow = async (): Promise<void> => {
    const choice = await selectPc(SelectPcMode.ANY, 'New graphic for who?');
    if (choice < 6) await pickPcGraphic(partyHost, choice, 1);
    redraw();
  };

  /** Options › Rename PC — `handle_rename_pc` (boe.actions.cpp:4418). */
  const renamePcFlow = async (): Promise<void> => {
    const choice = await selectPc(SelectPcMode.ANY, 'Rename who?');
    if (choice < 6) await pickPcName(partyHost, choice);
    redraw();
  };

  /**
   * Options › Add a New PC — `handle_new_pc` (boe.actions.cpp:3698). Town
   * only, and only in a town with a tavern.
   */
  const newPcFlow = async (): Promise<void> => {
    if (!isTown(session.mode)) {
      univ.addStringToBuf('Add PC: Town mode only.');
    } else if (univ.party.freeSpace() === 6) {
      univ.addStringToBuf('Add PC: You already have 6 PCs.');
    } else if (univ.town?.record.hasTavern) {
      giveHelp(56, 0);
      await createPc(partyHost, 6, false);
    } else {
      univ.addStringToBuf(
        'Add PC: You cannot add new characters in this town. Try in the town you started in.');
    }
    screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
    redraw();
  };

  /** Options › Delete PC — `handle_drop_pc` (boe.actions.cpp:3674). */
  const dropPcFlow = async (): Promise<void> => {
    if (!session.primeTime) {
      univ.addStringToBuf('Delete PC: Finish what you are doing first.');
    } else if (isCombat(session.mode)) {
      univ.addStringToBuf('Delete PC: Not in combat.');
    } else {
      const choice = await selectPc(SelectPcMode.ANY, 'Delete who?');
      if (choice < 6) {
        if (await confirmDeletePc(partyHost)) {
          univ.addStringToBuf('Delete PC: OK.');
          killPc(univ, univ.party.pcs[choice]!, MainStatus.ABSENT);
        } else {
          univ.addStringToBuf('Delete PC: Cancelled.');
        }
      }
    }
    redraw();
  };

  /** `show_dialog_action(xml)` — a help page, the welcome, About. */
  const showDialogAction = async (name: string): Promise<void> => {
    await dialogs.runNested(choiceDialog(ctx, store, name));
    redraw();
  };

  /** `print_party_stats` (boe.text.cpp:678) — Options › Party Statistics. */
  const printPartyStats = (): void => {
    const { party } = univ;
    univ.addStringToBuf('PARTY STATS:');
    univ.addStringToBuf(`  Number of kills: ${party.totalMKilled}`);
    if (isTown(session.mode) || (isCombat(session.mode) && session.whichCombatType === 1)) {
      univ.addStringToBuf(`  Kills in this town: ${univ.town?.record.monstersKilled ?? 0}`);
    }
    univ.addStringToBuf(`  Total experience: ${party.totalXpGained}`);
    univ.addStringToBuf(`  Total damage done: ${party.totalDamDone}`);
    univ.addStringToBuf(`  Total damage taken: ${party.totalDamTaken}`);
    redraw();
  };

  /**
   * `tip_of_day` — the Library's Tip of the Day. It draws a die, as the C++'s
   * does, and "See tips upon startup" is the `GiveIntroHint` preference.
   */
  const tipOfDayFlow = async (): Promise<void> => {
    const { dlg, showAtStart } = tipOfDayDialog(ctx, store, univ.rng, stringCount('tips'),
      getBoolPref('GiveIntroHint', true));
    await dialogs.runNested(dlg);
    setPref('GiveIntroHint', showAtStart());
    redraw();
  };

  /**
   * `handle_menu_spell` (boe.actions.cpp:2027) — a spell chosen from the Mage
   * or Priest menu: the current PC casts it, with no picker. It is stored as
   * the thing to recast, and a spell that needs a PC asks for one first.
   */
  const menuSpellFlow = async (spell: Spell): Promise<void> => {
    const info = SPELLS[spell];
    const type = info?.type ?? Skill.MAGE_SPELLS;
    if (!session.primeTime) {
      univ.addStringToBuf('Cast: Finish what you are doing first.');
      redraw();
      return;
    }
    const pcNum = univ.curPc;
    const pc = univ.currentPc;
    session.pcCasting = pcNum;
    pc.lastCast[type] = spell;
    pc.lastCastType = type;
    const stored = storeFor(session, type);
    stored.spell = spell;
    stored.caster = pcNum;
    const selectModes: Partial<Record<SpellSelect, SelectPcMode>> = {
      [SpellSelect.ACTIVE]: SelectPcMode.ONLY_LIVING,
      [SpellSelect.ANY]: SelectPcMode.ANY,
      [SpellSelect.DEAD]: SelectPcMode.ONLY_DEAD,
      [SpellSelect.STONE]: SelectPcMode.ONLY_STONE,
    };
    const selectMode = selectModes[info?.select ?? SpellSelect.NO];
    if (selectMode !== undefined) {
      const target = await selectPc(selectMode, 'Cast spell on who?');
      if (target === 6) { redraw(); return; }
      session.spellTarget = target;
    }
    if (isCombat(session.mode)) {
      if (combatCastCheck(session, type)) await combatCastSpell(session, spell);
    } else {
      await session.castTownSpell(pcNum, spell);
    }
    setStatus();
    redraw();
  };

  /** `adjust_spell_menus` — what the current PC can cast, in spell order. */
  const spellMenuItems = (type: Skill): MenuItem[] => {
    const pc = univ.currentPc;
    const items: MenuItem[] = [];
    for (let i = 0; i < 62; i++) {
      const spell = spellFromNum(type, i);
      if (!pcCanCastSpell(session, pc, spell)) continue;
      items.push({ label: spellName(spell), action: () => { void menuSpellFlow(spell); } });
    }
    return items;
  };

  /**
   * File › New Game — `new_party` (boe.actions.cpp:3723): restart-game.xml,
   * then back to the startup screen, where a new party is built. The startup
   * screen is a page of its own here, so "back to it" is a navigation.
   */
  const newPartyFlow = async (): Promise<void> => {
    const confirm = new XmlDialog(ctx, store, getDialogDef('restart-game'));
    confirm.setText('warning', confirm.getText('warning').replace('{{action}}', 'Starting over'));
    if ((await dialogs.runNested(confirm)) === 'cancel') return;
    window.location.href = import.meta.env.BASE_URL;
  };

  /**
   * File › Main Menu: back to the startup screen, which keeps the party in
   * memory. Not in the original, where the startup screen was only reached by
   * winning, dying or starting over; it asks the same question New Game does.
   */
  const mainMenuFlow = async (): Promise<void> => {
    // The game is saved on the way out, so there is nothing to lose — unless
    // it can't be saved just now (a fight), which is when the question the
    // original's New Game asks still needs asking.
    if (autosaving() && canSaveNow() === null && !midAction()) {
      try {
        await scheduler.saveIfChanged('MainMenu');
        window.location.href = urlWith(null);
        return;
      } catch (err) {
        univ.addStringToBuf(`Autosave: Save not completed (${String(err)})`);
        redraw();
      }
    }
    const confirm = new XmlDialog(ctx, store, getDialogDef('restart-game'));
    confirm.setText('warning', confirm.getText('warning').replace('{{action}}', 'Going to the main menu'));
    confirm.setText('okay', 'Main Menu');
    if ((await dialogs.runNested(confirm)) === 'cancel') return;
    window.location.href = urlWith(null);
  };

  /** `get_num_of_items` (boe.items.cpp:667) — how many out of a stack. */
  const getNumOfItems = async (max: number): Promise<number> => {
    const { dlg, result } = numOfItemsDialog(ctx, store, max);
    return result(await dialogs.runNested(dlg));
  };

  /** attack-friendly.xml — swinging at someone who hasn't done anything yet. */
  session.onConfirmAttackFriendly = async () => {
    const choice = await dialogs.runNested(
      new XmlDialog(ctx, store, getDialogDef('attack-friendly')));
    return choice === 'attack';
  };

  /** boat-bridge.xml — a boat reaching a bridge: go under it, or come ashore. */
  session.onConfirmBoatBridge = async () => {
    // boat-bridge.xml names no escape button, so Escape does nothing here,
    // as in OBoE: the question has to be answered.
    const choice = await dialogs.runNested(
      new XmlDialog(ctx, store, getDialogDef('boat-bridge')));
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
   * same reasoning as File > New Game. Restart is `start_new_game` in both
   * originals — the party editor, then the startup screen — so it reloads
   * into the editor; it used to reload the game page, which picked the game
   * back up from the tree it was being saved into. Quit has nowhere to go in a browser, so
   * it lands on the startup screen — which is where `handle_victory` puts you
   * too, and the closest thing here to leaving the game.
   */
  session.onPartyDeath = () => {
    void (async () => {
      for (;;) {
        const choice = await dialogs.runScreen(
          new XmlDialog(ctx, store, getDialogDef('party-death')));
        // Both leave no party in memory, as `do_abort` does (boe.actions.cpp:3307).
        if (choice === 'new') {
          if (saveStoreAvailable()) await setPartyInMemory(null);
          window.sessionStorage.removeItem(TREE_KEY);
          window.sessionStorage.setItem(PENDING_NEW_PARTY_KEY, '1');
          window.location.href = urlWith(null);
          return;
        }
        if (choice === 'quit') {
          if (saveStoreAvailable()) await setPartyInMemory(null);
          window.sessionStorage.removeItem(TREE_KEY);
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
  /**
   * Exile III's intro movie, "Exile (verb) - ..." (`render/e3MovieScreen.ts`),
   * on a new game only: E3's New Game plays it before the party is made
   * (`10c8:00b7`), and a saved game never gets here. Escape, a click or the
   * touch overlay's Skip ends it. Its dice are a stream of its own, so the
   * game's draws — and every replay — are where they would be without it.
   */
  const playExile3Intro = async (): Promise<void> => {
    const dice = new GameRng();
    dice.seedGame(Date.now() >>> 0);
    const movie = new E3MovieScreen(ctx, store, univ.scenario, {
      sound: (n) => sound.play(n),
      repaint: () => redraw(),
      background: (c, rect) => {
        const pats = store.get('pixpats');
        // E3's pattern 0, the grey stone: the movie loop's
        // `paint_pattern(0, 1, rect, 0)` (`1098:0ea0`–`0eb3`).
        if (pats) tilePattern(c, pats, E3_PATTERN_SLOTS[0]!, rect);
        else {
          c.fillStyle = '#000';
          c.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        }
      },
      ran: (min, max) => dice.getRan(1, min, max),
      prompt: () => !touchControlsOn(),
    });
    await dialogs.runScreenQueued(() => {
      // Closes itself at the end; a skip closes it first and stops it here.
      void movie.play().then(
        () => dialogs.answerScreen(movie, 'done'),
        (e: unknown) => {
          console.error(e);
          dialogs.answerScreen(movie, 'done');
        });
      return movie;
    });
    movie.skip();
    redraw();
  };

  /**
   * `put_party_in_scen`'s intro (boe.party.cpp:231): `custom_choice_dialog`
   * with the scenario's intro messages, its intro picture (PIC_SCEN) and
   * `basic_buttons[0]`, Done — shown if any of the messages has text.
   */
  session.onScenarioIntro = async () => {
    if (name === EXILE3_ID) await playExile3Intro();
    const { introMsgs, introPic, introMessPic } = univ.scenario;
    if (!introMsgs.some((m) => m !== '')) return;
    // The C++ redraws the game screen first (`redraw_screen`, boe.party.cpp:220),
    // so the start town is what the dialog sits over.
    redraw();
    // Trailing empty strings are dropped; the rest are the dialog's paragraphs.
    const strs = [...introMsgs];
    while (strs.length > 0 && strs[strs.length - 1] === '') strs.pop();
    // `custom_choice_dialog` with `basic_buttons[0]`, Done, alone.
    await dialogs.runScreenQueued(() => threeChoiceDialog(ctx, store, strs,
      [{ name: 'btn1', label: 'Done' }], introMessPic ?? introPic, 6 /* PIC_SCEN */));
  };

  session.onVictory = () => {
    void (async () => {
      // `handle_victory` empties `scen_name` first, so what "Save First" writes
      // is the party alone — the same bytes that become the party in memory.
      const party = saveGame(univ, true);
      const thumb = await captureSaveThumb(canvas);
      const choice = await dialogs.runScreen(new XmlDialog(ctx, store, getDialogDef('congrats-save')));
      if (choice === 'save' && saveStoreAvailable()) {
        const slot = (await askForText('Name this saved party:', false)).trim();
        // A party between scenarios is a tree of one.
        if (slot !== '') {
          await createTree(slot, {
            data: party, preview: { ...previewOfUniverse(univ), scenarioId: '', townNum: TOWN_NUM_OUTDOORS },
            thumb, kind: 'manual', reason: 'Victory', place: '',
          });
        }
      }
      if (saveStoreAvailable()) await setPartyInMemory(party);
      window.location.href = import.meta.env.BASE_URL;
    })();
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
      // locked-door-action.xml (boe.specials.cpp:485). Its picture is the
      // file's own door, terrain 112, whatever the door looks like: OBoE
      // doesn't set it.
      const choice = await dialogs.runNested(
        new XmlDialog(ctx, store, getDialogDef('locked-door-action')));
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
    message: async (str1, str2, title, pic, picType, record, snd = 57) => {
      // `cStrDlog` — the real message box: the node's picture at the top left,
      // one of the eight {1|2}str[-title][-lg] layouts, and a Record button
      // that puts the text in the party's encounter notes.
      // `display_strings.setSound(57)` — every message a special node puts up
      // announces itself. Only those carry a recorder, which is what tells the
      // two apart here.
      if (record) sound.play(snd);
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
    choice: async (strs, buttons, _title, pic, picType, xml) => {
      // A stock prompt opens its own definition (`cChoiceDlog("basic-trap")`),
      // picture and wording included; everything else is a `cThreeChoice`
      // laid out from the node's strings and `basic_buttons`. Either way the
      // answer is a control *name*, which is what a replay records.
      const picked = await dialogs.runScreenQueued(async () => xml && hasDialogDef(xml)
        ? new XmlDialog(ctx, store, getDialogDef(xml))
        : threeChoiceDialog(ctx, store, strs, buttons, pic, picType));
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
    // Exile III's own boards (game/e3Jobs.ts).
    if (e3JobsBase(univ) !== null) {
      void dialogs.runScreen(e3JobBoardDialog(ctx, store, univ, which)).then(() => redraw());
      return;
    }
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
    // soul-crystal.xml, filled as pick_trapped_monst fills it: an empty slot
    // loses its button and keeps "(spot empty)".
    const dlg = new XmlDialog(ctx, store, getDialogDef('soul-crystal'));
    for (let slot = 0; slot < 4; slot++) {
      const h = held.find((m) => m.slot === slot);
      if (!h) {
        dlg.hide(`pick${slot + 1}`);
        continue;
      }
      dlg.setText(`slot${slot + 1}`, h.name);
      dlg.setText(`lvl${slot + 1}`, String(h.level));
    }
    const picked = await dialogs.runNested(dlg);
    const slot = Number(picked.replace(/^pick/, '')) - 1;
    return held.find((m) => m.slot === slot)?.which ?? 0;
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
  const treeLabel = (game: TreeInfo): string => {
    const where = placeOf({ place: game.cover.place, townNum: game.cover.preview.townNum });
    const day = Math.floor(game.cover.preview.age / 3700) + 1;
    return `${game.name} — ${where}, day ${day} (${new Date(game.cover.savedAt).toLocaleString()})`;
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
  const notesFlow = async (which: NotesKind): Promise<void> => {
    if (dialogs.active) return;
    const refusal = notesRefusal(univ, session.mode, which);
    if (refusal !== null) {
      univ.addStringToBuf(refusal);
      redraw();
      return;
    }
    await dialogs.runScreen(which === 'talk' ? talkNotesDialog(ctx, store, univ)
      : which === 'events' ? eventJournalDialog(ctx, store, univ)
        : adventureNotesDialog(ctx, store, univ));
    redraw();
  };

  /**
   * This tab's game is being saved into tree `id` (null: not yet). Kept in
   * sessionStorage as well, so reloading `?play=` finds it again.
   */
  const rememberTree = (id: string | null): void => {
    univ.treeId = id;
    try {
      if (id === null) window.sessionStorage.removeItem(TREE_KEY);
      else window.sessionStorage.setItem(TREE_KEY, id);
    } catch { /* private mode: a reload just goes to the menu */ }
  };

  /** The name a brand-new tree gets: what the player typed, else the lead PC's. */
  let nextTreeName: string | null = null;
  const placeNow = (): string => univ.party.townNum < TOWN_NUM_OUTDOORS && univ.town !== null
    ? scen.towns[univ.party.townNum]?.name ?? '' : 'Outdoors';

  /**
   * The autosave back half (`try_auto_save`, boe.fileio.cpp:520), redesigned:
   * `autosave.ts` only notes that a save is wanted, and the scheduler writes it
   * into the game's tree when the game is at an idle, savable moment. See
   * `platform/saveScheduler.ts` for how it keeps that off the frame budget.
   */
  let autosaveFailed = false;
  const scheduler = new SaveScheduler({
    ready: () => !dialogs.active && !midAction() && canSaveNow() === null,
    capture: () => {
      if (!univ.party.pcs.some((pc) => pc.isAlive)) return null;
      return {
        raw: serialiseSave(univ).serialise(),
        preview: previewOfUniverse(univ),
        place: placeNow(),
        thumb: captureSaveThumb(canvas),
      };
    },
    treeId: () => univ.treeId,
    setTreeId: rememberTree,
    treeName: () => {
      const typed = nextTreeName;
      nextTreeName = null;
      return typed ?? `${univ.party.pcs.find((pc) => pc.name !== '')?.name ?? 'Adventurers'}'s party`;
    },
    saved: ({ kind, reason }) => {
      autosaveFailed = false;
      // The tick is every move; only the named moments say so. The first
      // save, as a game starts, is the tree's root and goes unremarked.
      if (kind === 'milestone' && reason !== 'Start') univ.addStringToBuf(`Autosave: Game saved (${reason}).`);
      redraw();
    },
    park: ({ treeId, data, kind, reason }) => {
      try {
        window.localStorage.setItem(UNSAVED_KEY, JSON.stringify({ treeId, kind, reason, data: toBase64(data) }));
      } catch { /* full or private: the tree's last write is what there is */ }
    },
    unpark: () => {
      try { window.localStorage.removeItem(UNSAVED_KEY); } catch { /* nothing kept */ }
    },
    // Every save, and every one not written, with where the time went.
    log: (line) => { console.log(line); },
    failed: (err) => {
      // Once, not every tick: a full disk would otherwise fill the log.
      if (autosaveFailed) return;
      autosaveFailed = true;
      univ.addStringToBuf(`Autosave: Save not completed (${String(err)})`);
      redraw();
    },
  });
  /**
   * Whether this game is written into a tree as it goes: always, where there
   * is somewhere to keep it. A direct `?scenario=` link used to wait for a
   * save of the player's own first, as OBoE insists; it starts afresh each
   * load, so each load of one is now a game (a card) of its own.
   */
  const autosaving = (): boolean => saveStoreAvailable();
  /** The last thing said about why the game isn't autosaving, so it is said once. */
  let offNoted: string | null = null;
  const noteAutosaveOff = (why: string | null): void => {
    if (why === offNoted) return;
    offNoted = why;
    console.log(why === null ? '[save] autosaving: every move is saved' : `[save] not autosaving: ${why}`);
  };
  setAutosaveSink((why) => {
    if (!autosaving()) { noteAutosaveOff('this browser has no IndexedDB to keep saves in'); return; }
    noteAutosaveOff(null);
    scheduler.request(why, why === 'Tick' ? 'auto' : 'milestone');
  });
  // The page is going away or out of sight: get the newest state down now, so a
  // reload picks the game up where it was, not where the last tick left it.
  if (saveStoreAvailable()) {
    const leaving = (): void => {
      if (autosaving()) scheduler.flush('Leaving');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') leaving();
    });
    window.addEventListener('pagehide', leaving);
  }
  // For the verifiers, like `__univ`.
  Object.assign(window as unknown as Record<string, unknown>, { __scheduler: scheduler });
  /**
   * `await __saveReport()` in the console: this game's tree, counted by what
   * each save is to it and why it was taken, and every gap in game time
   * between a save and its parent on the line being played — for finding
   * moves that weren't saved.
   */
  Object.assign(window as unknown as Record<string, unknown>, {
    __saveReport: async (): Promise<void> => {
      if (univ.treeId === null) { console.log('[save] this game has no tree yet'); return; }
      const tree = await getTree(univ.treeId);
      const snaps = await listSnaps(univ.treeId);
      const roleBy = roles(snaps);
      const tally = (key: (s: SnapInfo) => string): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const sn of snaps) out[key(sn)] = (out[key(sn)] ?? 0) + 1;
        return out;
      };
      console.log(`[save] tree "${tree?.name}": ${snaps.length} saves, head #${tree?.head}, cap ${tree?.maxAuto ?? 'default'}`);
      console.log('[save] by role', tally((sn) => roleBy.get(sn.seq) ?? '?'));
      console.log('[save] by kind and reason', tally((sn) => `${sn.kind}/${sn.reason}`));
      const byId = new Map(snaps.map((sn) => [sn.seq, sn]));
      const line = [...lineage(snaps, tree?.head ?? 0)].map((seq) => byId.get(seq)!).reverse();
      const gaps = line.slice(1).map((sn, i) => ({ seq: sn.seq, from: line[i]!.gameAge, to: sn.gameAge, reason: sn.reason }))
        .filter((g) => g.to - g.from > 1);
      console.log(`[save] the played line: ${line.length} saves, game time ${line[0]?.gameAge} to ${line.at(-1)?.gameAge};`
        + ` ${gaps.length} gaps of more than one turn (an outdoor step is 10 turns, resting many):`);
      console.table(gaps.slice(0, 60));
    },
  });

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
    // A game's first save names it; after that, Save adds to its tree.
    if (univ.treeId === null) {
      const typed = (await askForText('Name this saved game:', false)).trim();
      redraw();
      if (typed === '') return;
      nextTreeName = typed;
    }
    try {
      const seq = await scheduler.saveNow('Manual', 'manual');
      univ.addStringToBuf(seq === null ? 'Save: nothing to save.' : 'Game saved.');
    } catch (err) {
      univ.addStringToBuf(`Save failed: ${String(err)}`);
    }
    redraw();
  };

  /**
   * Make the live game the snapshot `seq` of tree `treeId` (absent: its
   * newest), and carry on saving into that tree — a branch, if the snapshot
   * isn't a leaf. Another scenario means another world to fetch, so the page
   * reopens on it and picks the snapshot back up.
   */
  const restoreFrom = async (treeId: string, seq?: number): Promise<boolean> => {
    const game = await getTree(treeId);
    if (game === null) {
      univ.addStringToBuf('Load: that saved game no longer exists.');
      redraw();
      return false;
    }
    const at = seq ?? game.head;
    const data = await getSnapshot(treeId, at);
    if (data === null) {
      univ.addStringToBuf('Load: that save is missing.');
      redraw();
      return false;
    }
    try {
      const preview = readSavePreview(data);
      if (preview.scenarioId === '' && saveStoreAvailable()) {
        // A party between scenarios: `finish_load_party` puts it in memory and
        // goes back to the startup screen (boe.fileio.cpp:66).
        await setPartyInMemory(data);
        window.location.href = import.meta.env.BASE_URL;
        return true;
      }
      if (preview.scenarioId !== scen.id) {
        window.sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ treeId, seq: at }));
        window.location.href = urlWith('play', preview.scenarioId);
        return true;
      }
      applySave(data, univ);
      await setHead(treeId, at);
      rememberTree(treeId);
      resumeAfterLoad();
      await markLoaded(treeId, at);
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
   * The game in memory is save `seq` of `treeId`, just loaded: so it isn't
   * saved again until it changes, and an identical save of a lesser kind
   * doesn't demote it.
   */
  const markLoaded = async (treeId: string, seq: number): Promise<void> => {
    const info = await getSnapInfo(treeId, seq).catch(() => null);
    scheduler.loaded(treeId, seq, info?.kind ?? 'auto', serialiseSave(univ).serialise());
  };

  /**
   * A move parked as the page went away (`UNSAVED_KEY`) becomes tree
   * `treeId`'s newest save, a child of its head, unless the head is already
   * that game. Resolves with its seq, or null if there was none for this tree.
   */
  const adoptUnsaved = async (treeId: string): Promise<number | null> => {
    type Parked = { treeId: string; kind: SnapKind; reason: string; data: string };
    const read = (): Parked | null => {
      try {
        return JSON.parse(window.localStorage.getItem(UNSAVED_KEY) ?? 'null') as Parked | null;
      } catch { return null; }
    };
    const parked = read();
    if (parked === null || parked.treeId !== treeId) return null;
    try {
      const data = fromBase64(parked.data);
      const game = await getTree(treeId);
      if (game === null) return null;
      const head = await getSnapshot(treeId, game.head);
      // The write landed after all, just not in time to say so.
      if (head !== null && sameGame(head, data)) return null;
      const preview = readSavePreview(data);
      const { snap } = await appendSnapshot(treeId, {
        data, preview, kind: parked.kind, reason: parked.reason,
        place: preview.townNum < TOWN_NUM_OUTDOORS ? scen.towns[preview.townNum]?.name ?? '' : 'Outdoors',
      });
      return snap.seq;
    } finally {
      window.localStorage.removeItem(UNSAVED_KEY);
    }
  };

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
  /**
   * What Exile III's own saves need from the EXE (`e3save.json`, which the
   * converter writes beside the scenario), or null for any other scenario
   * or a copy converted before it was written.
   */
  const e3SaveDefaults = async (): Promise<E3SaveDefaults | null> => {
    if (scen.id !== EXILE3_ID) return null;
    try {
      const text = installedPackage !== null
        ? await new PackedSource(installedPackage.id, installedPackage.data).getText('e3save.json')
        : await new FetchSource(bundledUrl).getText('e3save.json');
      return e3SaveDefaultsFromJson(text);
    } catch {
      return null;
    }
  };

  /** Open Game with an `exile3.sav` (`fileio/e3SaveImport.ts`). */
  const loadE3Save = async (data: Uint8Array, name = 'Exile III game'): Promise<boolean> => {
    const defaults = await e3SaveDefaults();
    if (defaults === null) {
      univ.addStringToBuf(scen.id === EXILE3_ID
        ? 'Load: this copy of Exile III was converted before its saves could be read. Convert it again.'
        : 'Load: that is an Exile III save. Play Exile III, then open it.');
      redraw();
      return false;
    }
    const res = applyE3Save(data, univ, defaults);
    rememberTree(null);
    scheduler.reset();
    resumeAfterLoad();
    if (res.town) session.resumeInSavedTown(res.town.num, res.town.loc);
    for (const w of res.warnings) univ.addStringToBuf(w);
    univ.addStringToBuf('Exile III game loaded.');
    redraw();
    // It becomes a game of this browser's, with a tree of its own: saved at
    // once, and autosaved from then on.
    if (saveStoreAvailable()) {
      nextTreeName = name;
      scheduler.request('Start', 'milestone');
    }
    return true;
  };

  /** File > Export as Exile III Save… (`fileio/e3SaveExport.ts`). */
  const exportE3SaveFlow = async (): Promise<void> => {
    const refusal = canSaveNow();
    if (refusal !== null) {
      univ.addStringToBuf(refusal);
      redraw();
      return;
    }
    const defaults = await e3SaveDefaults();
    if (defaults === null) {
      univ.addStringToBuf('Export: this copy of Exile III was converted before its saves could be written. Convert it again.');
      redraw();
      return;
    }
    const { bytes, warnings } = exportE3Save(univ, defaults);
    exportSave('EXILE3.SAV', bytes);
    for (const w of warnings) univ.addStringToBuf(w);
    univ.addStringToBuf('Exported as an Exile III save.');
    redraw();
  };

  const loadGameFlow = async (force = false): Promise<boolean> => {
    if (dialogs.active) return false;
    if (!force && isCombat(session.mode)) {
      univ.addStringToBuf('Load: Not in combat.');
      redraw();
      return false;
    }
    const games = saveStoreAvailable() ? await listTrees() : [];
    const rows = [{ name: 'file', label: 'Import a file…' }];
    for (const game of games) {
      rows.push({ name: `tree:${game.id}`, label: treeLabel(game) });
      if (game.count > 1) rows.push({ name: `older:${game.id}`, label: `      ↳ Older saves of ${game.name}…` });
    }
    const picked = await dialogs.run({
      text: games.length > 0 ? 'Load which saved game?' : 'No saved games in this browser.',
      rows,
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel' }],
    });
    if (picked === 'cancel') {
      redraw();
      return false;
    }

    try {
      if (picked === 'file') {
        const chosen = await importSave();
        if (chosen === null) {
          redraw();
          return false;
        }
        if (isE3Save(chosen.data)) return await loadE3Save(chosen.data, chosen.name.replace(/\.sav$/i, ''));
        // Any file becomes a tree of its own, then opens like one.
        const outcome = await importAsTree(chosen);
        if ('error' in outcome) {
          univ.addStringToBuf(outcome.error);
          redraw();
          return false;
        }
        return await restoreFrom(outcome.treeId);
      }
      if (picked.startsWith('older:')) {
        const id = picked.slice('older:'.length);
        // Not the game being played: that one can't be deleted from under itself.
        const seq = await browseTree(id, scen.title, id !== univ.treeId);
        if (seq === null || seq === 'deleted') {
          redraw();
          return false;
        }
        return await restoreFrom(id, seq);
      }
      return await restoreFrom(picked.slice('tree:'.length));
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
  /**
   * `handle_combat_switch` (boe.actions.cpp:1312) — the f key, the sword and
   * the End button: into a fight from town, out of one in combat, and nothing
   * anywhere else. **Starting a town fight costs a turn** (`did_something`,
   * :1335), which the replay driver has always charged and the live key and
   * button did not: the monsters sat out the round the fight began.
   */
  const combatSwitchFlow = async (): Promise<void> => {
    if (session.mode === GameMode.TOWN) {
      if (session.startCombat(univ.party.direction)) await session.afterPartyTurn();
    } else if (session.mode === GameMode.COMBAT) {
      await endCombatFlow();
      return;
    }
    setStatus();
    redraw();
  };

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
    void dialogs.runScreen(pcInfoDialog(ctx, store, univ, which, (what, pc) => {
      if (what === 'trait') void pickRaceAbil(partyHost, univ.party.pcs[pc]!, 1);
      else if (what === 'seealch') void dialogs.runNested(alchemyKnownDialog(ctx, store, univ));
      else void dialogs.runNested(pcSpellsDialog(ctx, store, univ, pc,
        what === 'seemage' ? 'mage' : 'priest'));
    })).then(() => redraw());
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
    dialog.onDescribe = (kind, num) => {
      void dialogs.runNested(spellInfoDialog(ctx, store, univ, kind, num)).then(redraw);
    };
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
      await session.useSpecItem(entry);
    } else {
      // `put_spec_item_info` (boe.infodlg.cpp:703): a cStrDlog with the
      // item's name for a title and the scenario's intro picture beside it.
      sound.play(57);
      await dialogs.runNested(strDialog(ctx, store, {
        str1: spec.descr, title: spec.name, pic: univ.scenario.introPic, picType: 6,
      }));
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

  /**
   * The item panel's page buttons (handle_action, boe.actions.cpp:1784): six
   * PCs, Special Items, Quests and Help. The canvas and the touch sheet both
   * come here.
   */
  const pressItemBottom = (bottom: number): void => {
    sound.play(Snd.BUTTON);
    if (bottom === 6) screen.itemWindow.setStatWindow(univ, ItemWinMode.SPECIAL);
    else if (bottom === 7) screen.itemWindow.setStatWindow(univ, ItemWinMode.QUESTS);
    else if (bottom === 8) {
      void showDialogAction('help-inventory');
    } else if (session.switchPcItems(bottom)) {
      screen.itemWindow.setStatWindowForPc(univ, bottom);
    }
    setStatus();
    redraw();
  };

  /**
   * A PC row's parts (handle_action's PC-area branch, boe.actions.cpp:1739):
   * the name makes them active, HP and SP read out, and the two icons are Info
   * and Trade Places. The canvas and the touch sheet both come here.
   */
  const pressPcRow = (index: number, part: 'name' | 'hp' | 'sp' | 'info' | 'trade'): void => {
    const pc = univ.party.pcs[index];
    if (!pc || pc.mainStatus === MainStatus.ABSENT) return;
    sound.play(Snd.BUTTON);
    // The HP and SP read-outs are blank for a PC who isn't alive, so a
    // click there does nothing rather than reporting on a corpse.
    const aliveOnly = part === 'hp' || part === 'sp';
    if (!aliveOnly || pc.mainStatus === MainStatus.ALIVE) {
      if (part === 'name') {
        session.switchPc(index);
        screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
      } else if (part === 'hp') {
        session.printPcHp(index);
      } else if (part === 'sp') {
        session.printPcSp(index);
      } else if (part === 'trade') {
        session.tradePlaces(index);
        screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
      } else {
        showPcInfo(index);
      }
    }
    setStatus();
    redraw();
  };

  /**
   * The party and inventory panels, blown up for a finger
   * (`platform/touchSheet.ts`): a tap on either panel opens it over the game
   * at the screen's size, and a tap there is the panel's own click, in the
   * order the canvas asks: the party rows, then the item scrollbar, the page
   * buttons along the bottom and the rows.
   */
  let sheetOpen: 'inventory' | 'party' | null = null;
  const clickPanel = (x: number, y: number): void => {
    const pcHit = screen.pcRowHit(x, y);
    if (pcHit) {
      pressPcRow(pcHit.index, pcHit.part);
      return;
    }
    if (session.shop) return;
    if (!session.itemShop && screen.itemSbar.handleClick(x, y)) {
      sound.play(Snd.BUTTON);
      screen.itemWindow.scroll = screen.itemSbar.getPosition();
      redraw();
      return;
    }
    // As on the canvas: during a service, the six PCs only.
    const bottom = screen.itemBottomHit(x, y);
    if (bottom !== null && (!session.itemShop || bottom < 6)) {
      pressItemBottom(bottom);
      return;
    }
    const invenHit = screen.inventoryHit(x, y, session.itemShop !== null);
    if (!invenHit) return;
    sound.play(Snd.BUTTON);
    // Using an item can go on to ask for a target, which is on the game screen.
    if (invenHit.part === 'use') sheetOpen = null;
    void handleInventoryClick(invenHit.row, invenHit.part);
    redraw();
  };
  touchSheet = new TouchSheet({
    panel: () => {
      if (sheetOpen === null || dialogs.active || document.body.classList.contains('starting')) return null;
      // Dropping arms a square to drop on; the sheet gets out of the way.
      if (session.mode === GameMode.DROP_TOWN || session.mode === GameMode.DROP_COMBAT) {
        sheetOpen = null;
        return null;
      }
      return sheetOpen === 'inventory' ? WIN_RECTS.inven : WIN_RECTS.pcStats;
    },
    source: () => ({ canvas, x: desktop.gameX, y: desktop.gameY }),
    tap: clickPanel,
    close: () => {
      sheetOpen = null;
      redraw();
    },
  });

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
  /** A fresh one each time Talk is armed, so its cursor starts over. */
  let talkToken = {};
  talkAimNow = () => (pending === 'talk' && touchControlsOn() ? talkAim(session, talkToken) : null);

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
    talkToken = {};
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

  /**
   * A conversation, for a finger (`platform/touchDialog.ts`): the reply's
   * lit words down the left, the preset words down the right. Only words the
   * talk screen actually drew, so nothing is offered that a click couldn't
   * reach.
   */
  const talkTouchView = (): TouchView | null => {
    const talk = session.talk;
    if (!talk) return null;
    const seen = new Set<string>();
    const left: TouchChoice[] = [];
    const right: TouchChoice[] = [];
    for (const word of talk.words) {
      if (word.rect === null) continue;
      if (word.preset) {
        right.push({ name: `talk:${word.node}`, label: word.word });
        continue;
      }
      const key = `${word.word.toLowerCase()}:${word.node}`;
      if (seen.has(key)) continue;
      seen.add(key);
      left.push({ name: `talk:${word.node}`, label: word.word });
    }
    // Done last, after a rule, as every strip ends on its way out.
    const done = right.findIndex((c) => c.label === 'Done');
    if (done >= 0 && done < right.length - 1) right.push(...right.splice(done, 1));
    if (done >= 0) right[right.length - 1]!.section = '';
    return { left, leftHeading: left.length ? 'Topics' : 'No new topics', right, rightFollowsPad: true };
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
      void session.buyShopRow(hit.row).then(() => redraw());
    } else {
      const info = shopItemInfo(shop, hit.row);
      if (info && !dialogs.active) {
        const screen = info.kind === 'item' ? itemInfoDialog(ctx, store, univ, 6, 0, info.item)
          : info.kind === 'alchemy' ? alchemyHelpDialog(ctx, store)
            : info.kind === 'spell' ? spellInfoDialog(ctx, store, univ, info.school, info.level)
              : info.kind === 'skill' ? skillInfoDialog(ctx, store, info.skill as Skill)
                : strDialog(ctx, store,
                  { str1: info.text, title: info.title, pic: info.pic, picType: info.picType });
        void dialogs.runScreen(screen).then(() => redraw());
      }
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
    // do_sign (boe.dlgutil.cpp:1277): view-sign.xml, with the sign's own
    // terrain as its picture.
    const dlg = new XmlDialog(ctx, store, getDialogDef('view-sign'));
    dlg.setPictType('ter', 'ter', scen.terTypes[ter]?.picture ?? 0);
    dlg.setText('sign', sign);
    await dialogs.runNested(dlg);
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
    // The last move's end, saved before this one changes it (`saveScheduler.ts`).
    scheduler.captureIfPending();
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
    // The first opening, and the first after the desktop changes shape, puts
    // the map beside the game screen if there is room. After that it stays
    // where the player dragged it.
    if (screen.mapVisible && !mapPlaced) {
      screen.mapScreen.pos = placeBesideGame(desktop, MAP_W, MAP_H + CAPTION_H, MAP_DEFAULT_POS);
      mapPlaced = true;
    }
  };
  let mapPlaced = false;
  /** Lay the desktop out again, and move the map to suit if it changed. */
  const refitDesktop = (): void => {
    if (!fitDesktop()) return;
    mapPlaced = false;
    if (screen.mapVisible) {
      screen.mapScreen.pos = placeBesideGame(desktop, MAP_W, MAP_H + CAPTION_H, MAP_DEFAULT_POS);
      mapPlaced = true;
    }
    redraw();
  };
  // A resize, or going full screen, is the page changing shape under it.
  window.addEventListener('resize', refitDesktop);
  /** Preferences and the View menu both set these two. */
  const setDesktopPrefs = (mode: number, scale: number): void => {
    setPref('DisplayMode', mode);
    setPref('UIScale', scale);
    refitDesktop();
  };

  /**
   * A toolbar button, pressed: `handle_action`'s toolbar switch
   * (boe.actions.cpp:1630), with its mode guards — a button pressed in a mode
   * it has no business in does nothing, as in the original. The canvas's
   * toolbar and the touch pads both come here.
   */
  const pressToolbar = (which: ToolbarButton): void => {
    sound.play(Snd.BUTTON); // the UI click
    const mode = session.mode;
    switch (which) {
      case ToolbarButton.MAGE: case ToolbarButton.PRIEST:
        // handle_spell_button dispatches on which book — the m/p keys' flow.
        void castSpellFlow(which === ToolbarButton.MAGE
          ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS);
        break;
      case ToolbarButton.LOOK:
        beginLook();
        break;
      case ToolbarButton.SHIELD:
        // handle_parry — spend what's left of the turn on defence.
        if (mode === GameMode.COMBAT) void session.parry();
        break;
      case ToolbarButton.TALK:
        if (mode === GameMode.TOWN || mode === GameMode.TALK_TOWN) beginTalk();
        break;
      case ToolbarButton.CAMP:
        if (mode === GameMode.OUTDOORS) void session.rest();
        break;
      case ToolbarButton.SCROLL: case ToolbarButton.MAP:
        // display_map — and "do not call advance_time".
        toggleMap();
        break;
      case ToolbarButton.BAG: case ToolbarButton.HAND:
        if (mode === GameMode.TOWN || mode === GameMode.COMBAT) void getItems();
        break;
      case ToolbarButton.SAVE:
        if (mode === GameMode.OUTDOORS) void saveGameFlow();
        break;
      case ToolbarButton.USE:
        if (mode === GameMode.TOWN || mode === GameMode.USE_TOWN) selectSpace('use');
        break;
      case ToolbarButton.WAIT:
        // handle_stand_ready — give up the turn *on guard*, not just idle.
        if (mode === GameMode.COMBAT) void session.pause();
        break;
      case ToolbarButton.LOAD:
        if (mode === GameMode.OUTDOORS) void loadGameFlow();
        break;
      case ToolbarButton.SHOOT:
        // handle_missile — the 's' key's flow, arm and cancel alike.
        if (mode === GameMode.COMBAT) session.handleMissile();
        else if (mode === GameMode.FIRING || mode === GameMode.THROWING) {
          session.handleMissile();
          recentre();
        }
        break;
      case ToolbarButton.SWORD: case ToolbarButton.END:
        void combatSwitchFlow();
        break;
      case ToolbarButton.ACT:
        // handle_toggle_active — pin the turn to this PC, or release it.
        if (mode === GameMode.COMBAT) session.toggleActivePc();
        break;
      default:
        break;
    }
    setStatus();
    redraw();
  };

  touchPads = new TouchControls({
    // Hidden wherever the canvas's toolbar can't be clicked either: under a
    // dialog, in a shop or a conversation — and on the main menu.
    mode: () => (document.body.classList.contains('starting') || dialogs.active || session.shop || session.talk
      ? null : toolbarMode(session)),
    buttons: toolbarButtons,
    press: (which) => {
      if (dialogs.active || session.shop || session.talk) return;
      pressToolbar(which);
    },
    sheet: () => store.get('buttons'),
    aiming: () => (screen.aimAt !== null && aimNow() !== null
      ? { space: aimSpaceAction(session) } : null),
    spells: {
      dialog: () => (dialogs.active instanceof CastDialog ? dialogs.active : null),
      answer: (dialog, name) => dialogs.answerScreen(dialog, name),
    },
    dialog: {
      // The cast dialog has strips of its own.
      view: () => (document.body.classList.contains('starting') || dialogs.active instanceof CastDialog
        ? null : dialogs.active ? dialogs.touchView() : session.talk ? talkTouchView() : null),
      press: (name) => {
        const talkWord = /^talk:(-?\d+)$/.exec(name);
        if (talkWord) {
          if (session.talk && !dialogs.active) void activateTalkWord(Number(talkWord[1]));
          return;
        }
        sound.play(Snd.BUTTON);
        dialogs.touchPress(name);
      },
      type: (field, text) => dialogs.touchType(field, text),
      enter: () => { dialogs.handleKey('Enter'); },
    },
  });

  /**
   * A press on the item or shop scrollbar's thumb starts dragging it
   * (`cScrollbar::handle_mouse_pressed`); game-screen coordinates.
   */
  const startScrollThumb = (x: number, y: number): boolean => {
    const started = session.shop
      ? screen.shopScreen.startThumbDrag(session.shop, x, y)
      : !session.itemShop && screen.itemSbar.startThumbDrag(x, y);
    if (started) redraw();
    return started;
  };
  /** The held thumb follows the pointer; true if one is held. */
  const dragScrollThumb = (y: number): boolean => {
    if (session.shop) {
      const delta = screen.shopScreen.thumbDragDelta(session.shop, y);
      if (delta === null) return false;
      if (delta !== 0) { session.shop.scrollBy(delta); redraw(); }
      return true;
    }
    if (!screen.itemSbar.dragTo(y)) return false;
    if (screen.itemWindow.scroll !== screen.itemSbar.getPosition()) {
      screen.itemWindow.scroll = screen.itemSbar.getPosition();
      redraw();
    }
    return true;
  };

  const router = new InputRouter(canvas, {
    onMove: (dir, key) => {
      // A dialog gets first refusal on the arrows: pc-info.xml's left/right
      // buttons carry `def-key='left'`/`'right'`, and the router turns those
      // into movement before `onKey` ever sees them.
      if (key !== undefined && dialogs.active && dialogs.handleKey(key)) return;
      if (dialogs.active || session.talk || session.shop || midAction()) return;
      // While a spell or missile is aimed, a direction moves its cursor
      // instead of acting on the square beside the caster, as the original's
      // arrows do; Enter then takes the cursor's square as a click would.
      const aim = screen.aimAt !== null ? aimNow() : null;
      if (screen.aimAt !== null && aim !== null) {
        screen.aimAt = moveAim(session, screen.aimAt, dir, aim);
        screen.hover = null;
        redraw();
        return;
      }
      const from = session.mode === GameMode.COMBAT || session.missile !== null
        ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      void actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onDrag: (x, y) => {
      if (dialogs.handleDrag(x, y)) return;
      if (dragScrollThumb(y - desktop.gameY)) return;
      if (!screen.mapScreen.dragging) return;
      screen.mapScreen.dragTo(x, y, desktop.w, desktop.h);
      redraw();
    },
    onRelease: () => {
      dialogs.handleRelease();
      screen.mapScreen.endDrag();
      if (screen.itemSbar.dragging || screen.shopScreen.sbar.dragging) {
        screen.itemSbar.endDrag();
        screen.shopScreen.sbar.endDrag();
        redraw();
      }
    },
    // A finger sliding: what a press there would have started dragging, in
    // the click's own order — a dialog's caption first, and the map only
    // with no dialog up.
    onDragStart: (dx, dy) => {
      if (dialogs.startCaptionDrag(dx, dy)) return true;
      if (dialogs.active) return false;
      if (startScrollThumb(dx - desktop.gameX, dy - desktop.gameY)) return true;
      if (!screen.mapVisible || !screen.mapScreen.contains(dx, dy)) return false;
      screen.mapScreen.startDrag(dx, dy);
      mapFocused = true;
      redraw();
      return true;
    },
    // The router speaks desktop coordinates. Dialogs and the map live there;
    // everything else is on the game screen and is offset from it.
    onWheel: (dx, dy, notches) => {
      if (dialogs.handleWheel(dx, dy, notches)) return true;
      if (document.body.classList.contains('starting')) return false;
      const x = dx - desktop.gameX;
      const y = dy - desktop.gameY;
      // `item_sbar`'s wheel area is the inventory and its bar
      // (`inventory_events_rect`, boe.main.cpp:378), and `shop_sbar`'s the shop.
      if (session.shop) {
        if (!screen.shopScreen.wheelScrolls(session.shop, x, y)) return false;
        if (notches !== 0) { handleShopHit({ part: 'scroll', delta: notches }); redraw(); }
        return true;
      }
      const inven = WIN_RECTS.inven;
      const overInven = x >= inven.left && y >= inven.top && x < ITEM_SBAR_RECT.right && y < ITEM_SBAR_RECT.bottom;
      if (session.itemShop || !overInven || screen.itemSbar.getMaximum() === 0) return false;
      if (notches !== 0) {
        screen.itemSbar.handleWheel(-notches);
        screen.itemWindow.scroll = screen.itemSbar.getPosition();
        redraw();
      }
      return true;
    },
    onClick: (dx, dy, right = false, held) => {
      if (dialogs.handleClick(dx, dy, { right, ...held })) return;
      // The map is a separate window in the original, so a click that lands on
      // it never reaches the game screen underneath.
      if (screen.mapVisible && screen.mapScreen.contains(dx, dy)) {
        // A click anywhere on the map window picks it up, as the WASM build
        // allows ("Allow dragging from anywhere on the map window").
        screen.mapScreen.startDrag(dx, dy);
        if (!mapFocused) { mapFocused = true; redraw(); }
        return;
      }
      if (mapFocused) { mapFocused = false; redraw(); }
      const x = dx - desktop.gameX;
      const y = dy - desktop.gameY;
      // The desktop around the game screen is only background.
      if (x < 0 || y < 0 || x >= BOE_WIDTH || y >= gameScreen.h) return;
      // The party stats list: clicking a name makes that PC active, the HP and
      // SP columns read themselves out, and the two icons are Info and Trade
      // Places (handle_action's PC-area branch, boe.actions.cpp:1739).
      //
      // This comes *before* the shop, because the C++ dispatches on which
      // window the click landed in and the PC panel is its own window — which
      // is how you switch who's shopping without leaving the shop.
      // With touch controls, a tap anywhere on the party or item panel opens
      // its sheet (`touchSheet`) instead: the panels' own buttons are a few
      // pixels wide at a phone's scale.
      // Only while the pads are actually on screen: touch controls can be on
      // by default (a touch-only pointer) at a moment the pads are hidden.
      const magnify = touchControlsOn() && touchPads?.visible() === true;
      if (magnify && inRect(WIN_RECTS.pcStats, x, y)) {
        sheetOpen = 'party';
        redraw();
        return;
      }
      if (magnify && inRect(WIN_RECTS.inven, x, y)) {
        sheetOpen = 'inventory';
        redraw();
        return;
      }
      const pcHit = screen.pcRowHit(x, y);
      if (pcHit) {
        pressPcRow(pcHit.index, pcHit.part);
        return;
      }
      if (session.shop) {
        const hit = screen.shopScreen.hit(session.shop, x, y);
        if (hit) handleShopHit(hit);
        return;
      }
      // The item scrollbar is its own control on the main window, so it is
      // asked before the panel underneath it.
      if (startScrollThumb(x, y)) return;
      if (!session.itemShop && screen.itemSbar.handleClick(x, y)) {
        sound.play(Snd.BUTTON);
        screen.itemWindow.scroll = screen.itemSbar.getPosition();
        redraw();
        return;
      }
      // The page buttons along the bottom of the item panel: six PCs, Special
      // Items, Quests and Help (handle_action, boe.actions.cpp:1784). While a
      // service (sell, identify…) has the panel, only the six PCs: they are
      // how the player picks whose things to show, as the C++ lets them
      // (`handle_switch_pc_items` allows MODE_TALKING).
      const bottom = screen.itemBottomHit(x, y);
      if (bottom !== null && (!session.itemShop || bottom < 6)) {
        pressItemBottom(bottom);
        return;
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
        pressToolbar(btn.btn);
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
        // **A right-click looks** at the square, whatever else is going on
        // (1997 ACTIONS.CPP's "Looking at something", `right_button == TRUE`;
        // OBoE's "quick look", boe.actions.cpp:318). No mode, no prompt and
        // no recentring: the view stays where it was. Not while aiming, where
        // the click would have to go somewhere.
        if (right && !isAiming() && (pending === null || pending === 'look') && !midAction()) {
          void lookAt(clicked).then(() => { setStatus(); redraw(); });
          setStatus();
          redraw();
          return;
        }
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
    onHover: (dx, dy) => {
      const x = dx - desktop.gameX;
      const y = dy - desktop.gameY;
      pointer = { x, y };
      if (!isAiming()) {
        // The cursor follows the pointer even when nothing else on screen does.
        const css = cursorCss(changeCursor(session.mode, x, y, dialogs.active !== null));
        if (css !== shownCursor) {
          canvas.style.cursor = css;
          shownCursor = css;
        }
        if (screen.hover !== null) {
          screen.hover = null;
          redraw();
        }
        return;
      }
      screen.hover = { x, y };
      // The keyboard's cursor follows the mouse, so the arrows carry on from
      // wherever it was pointing.
      const cell = screen.terrainCellAt(x, y);
      if (cell && screen.aimAt !== null) {
        screen.aimAt = { x: session.center.x + cell.q - 4, y: session.center.y + cell.r - 4 };
      }
      redraw();
    },
    onHoverEnd: () => {
      pointer = null;
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
      // The last move's end, saved before this key changes it (`saveScheduler.ts`).
      scheduler.captureIfPending();
      // Enter shoots at the aim cursor's square — the click on it, exactly.
      if (key === 'Enter' && screen.aimAt !== null && aimNow() !== null) {
        void actOn(screen.aimAt);
        setStatus();
        redraw();
        return;
      }
      // handle_keystroke's letters (boe.actions.cpp:2772), which are what a
      // BoE player's fingers already know. Uppercase variants that mean
      // something different in the original (M/P force a recast, L picks a
      // lock, A is alchemy) are noted where they aren't built yet.
      const inCombat = session.mode === GameMode.COMBAT;
      switch (key) {
        case 'f': case 'F':
          // Toggle combat, both ways — the same key in the original, and only
          // in town or combat (boe.actions.cpp:3155).
          await combatSwitchFlow();
          break;
        case 'e': case 'E':
          if (inCombat) await endCombatFlow();
          break;
        case ' ':
          // boe.actions.cpp:3010. **This was two `case ' '` arms**, and a
          // switch only ever takes the first: Space paused in every mode, so
          // a multi-target spell's "(Hit space to cast.)" and a wall's
          // "(Hit space to rotate.)" never happened, and Space with a spell
          // or missile in the air spent the turn instead.
          if (session.mode === GameMode.FANCY_TARGET) {
            // start_fancy_spell_targeting's "(Hit space to cast.)".
            await castCollected(session);
          } else if (session.mode === GameMode.SPELL_TARGET) {
            // "(Hit space to rotate.)" — a wall spell turns.
            spellCastHitReturn(session);
            redraw();
          } else if (session.mode === GameMode.ITEM_TARGET) {
            // `cancel_item_target`: Identify or Recharge's panel closes, and the
            // turn the spell owes is charged — as the replay driver does it.
            if (session.endItemShop()) await session.afterPartyTurn();
            setStatus();
            redraw();
          } else if (session.mode === GameMode.TOWN || session.mode === GameMode.COMBAT
            || session.mode === GameMode.OUTDOORS) {
            // `handle_pause`: one turn — stand ready in combat, pause otherwise.
            await session.pause();
          }
          break;
        case 'w': case 'W':
          // **w is `handle_wait`, not `handle_pause`** (boe.actions.cpp:3094).
          // They were both wired to `pause` here, so the long wait — up to
          // eighty turns of standing still in town — had no key at all.
          // Only a wait that will pass time gets the night; the refusals are
          // one line and no fade.
          if (session.mode === GameMode.TOWN && !session.partySeesAMonst()) {
            acting = true;
            try {
              await aroundWaitFade(canvas, () => session.wait(), redraw);
            } finally {
              acting = false;
            }
          } else {
            await session.wait();
          }
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
      // The turn's last animation is over: if the game is at rest, save it now.
      scheduler.captureIfPending();
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

  if (buildParty) {
    if (makingParty) status.textContent = 'Make a party.';
    hideLoadingUi();
    refitDesktop(); // the progress bar's room is the canvas's now
    screen.startupBackdrop = true;
    redraw();
    if (!(await startNewParty(partyHost))) {
      // Cancelled, or nobody left: "if no PCs left, forget it" — back to the
      // startup screen with no party in memory.
      if (!makingParty) {
        window.location.href = import.meta.env.BASE_URL;
        return;
      }
      await setPartyInMemory(null);
      window.location.href = import.meta.env.BASE_URL;
      return;
    }
    // `start_new_game` ends by keeping the finished party (`party_in_memory`,
    // and `do_save(true)`), before any scenario has touched it.
    session.finishNewParty();
    if (saveStoreAvailable()) await setPartyInMemory(saveGame(univ, true));
    if (makingParty) {
      window.location.href = import.meta.env.BASE_URL;
      return;
    }
    if (saveStoreAvailable()) await setPartyActiveScenario(scen.id);
    screen.startupBackdrop = false;
    session.beginScenario();
    screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
  }

  // The party in memory, into the scenario the startup screen picked
  // (`put_party_in_scen`). Its dialogs come up over the startup art, as the
  // C++'s do: until `enterScenario` moves it, the party still stands where
  // its last scenario left it, a sector this world may not have. Drawing the
  // game screen then threw from the status bar (`CurOut.sector`) and left
  // only the terrain drawn, when the last scenario had more sectors.
  if (enteringParty !== null) {
    hideLoadingUi();
    refitDesktop();
    applyPartySave(enteringParty, univ);
    screen.startupBackdrop = true;
    redraw();
    await session.enterWithParty({
      removedSpecialItems: async () => {
        await dialogs.runScreen(new XmlDialog(ctx, store, getDialogDef('removed-special-items')));
      },
      keepStoredItems: async () =>
        (await dialogs.runScreen(new XmlDialog(ctx, store, getDialogDef('keep-stored-items')))) === 'yes',
      entered: () => { screen.startupBackdrop = false; },
    });
    screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
    if (saveStoreAvailable()) await setPartyActiveScenario(scen.id);
  }

  // A saved game chosen on the startup screen (or parked by a cross-scenario
  // load) is applied now that the world it belongs to is in place. It runs over
  // the new game `startNewGame` just began, which is exactly what
  // `load_party` does to the C++'s freshly-constructed universe.
  let needsThumb: { treeId: string; seq: number } | null = null;
  if (openTarget !== null) {
    try {
      const game = await getTree(openTarget.treeId);
      if (game === null) throw new Error('that saved game no longer exists');
      // A move that never reached the tree is its newest save now; then the
      // save asked for, else (a reload) where the tab was, else (a card on
      // the main menu) the save played last, by the clock.
      const adopted = await adoptUnsaved(game.id).catch(() => null);
      const at = openTarget.seq ?? adopted
        ?? (resuming ? game.head : await newestSnapshot(game.id) ?? game.head);
      const data = await getSnapshot(game.id, at);
      if (data === null) throw new Error('that save is missing');
      applySave(data, univ);
      await setHead(game.id, at);
      rememberTree(game.id);
      resumeAfterLoad();
      await markLoaded(game.id, at);
      // A move picked back up was written with no picture (the page was
      // going); it gets one once it is on screen, below.
      if (adopted !== null && at === adopted) needsThumb = { treeId: game.id, seq: adopted };
      if (!resuming) univ.addStringToBuf(`Game loaded: ${game.name}.`);
    } catch (err) {
      univ.addStringToBuf(`${resuming ? "Couldn't pick the game back up" : 'Load failed'}: ${String(err)}`);
    }
  }
  if (pendingE3 !== null) await loadE3Save(pendingE3.data, pendingE3.name);
  // A new game is saved as soon as it can be — after whatever the scenario
  // opens with — so it is on the main menu from the start: its tree's root.
  if (univ.treeId === null && autosaving()) scheduler.request('Start', 'milestone');
  holdFrames = false;
  hideLoadingUi();
  refitDesktop();
  setStatus();
  redraw();
  if (needsThumb !== null) {
    const { treeId, seq } = needsThumb;
    void captureSaveThumb(canvas).then((thumb) => thumb === null ? undefined : setSnapshotThumb(treeId, seq, thumb))
      .catch(() => undefined);
  }
  // An installed scenario's first fresh start leaves behind a picture of where
  // it begins, for the startup screen. Taken now, before anything the
  // scenario opens with can put a dialog over it.
  if (!isBundled && !installedPreview && openTarget === null && scenarioStoreAvailable()) {
    void captureTerrainView(canvas).then((png) => (png ? setScenarioPreview(name, png) : undefined));
  }
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
          label: 'Main Menu',
          action: () => { void mainMenuFlow(); },
        },
        {
          label: 'New Game',
          action: () => { void newPartyFlow(); },
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
            const data = saveGame(univ);
            void (async () => {
              const game = univ.treeId !== null && saveStoreAvailable() ? await getTree(univ.treeId) : null;
              exportSave(game?.name ?? univ.party.pcs[0]?.name ?? 'exile', data);
            })();
          },
          enabled: () => canSaveNow() === null,
        },
        ...(scen.id === EXILE3_ID ? [{
          label: 'Export as Exile III Save…',
          action: () => { void exportE3SaveFlow(); },
          enabled: () => canSaveNow() === null,
        }] : []),
        MENU_SEPARATOR,
        { label: 'Preferences…', action: () => { void preferencesFlow(); } },
      ],
    }, {
      // Not one of the original's menus. It carries Preferences' display
      // alignment and UI scale, which the dialog can only show on a desktop
      // tall enough for all of it.
      label: 'View',
      items: [
        { label: 'Map in New Window', action: () => worldMap.open() },
        MENU_SEPARATOR,
      ],
      dynamic: () => {
        const mode = getIntPref('DisplayMode', DisplayMode.CENTRE);
        const scale = getFloatPref('UIScale', DEFAULT_UI_SCALE);
        const tick = (on: boolean, label: string): string => `${on ? '✓' : '\u2003'} ${label}`;
        const modes: [DisplayMode, string][] = [
          [DisplayMode.CENTRE, 'Center'], [DisplayMode.TOP_LEFT, 'Top Left'],
          [DisplayMode.TOP_RIGHT, 'Top Right'], [DisplayMode.BOTTOM_LEFT, 'Bottom Left'],
          [DisplayMode.BOTTOM_RIGHT, 'Bottom Right'], [DisplayMode.SMALL_WINDOW, 'Game Screen Only'],
        ];
        const touch = touchControlsOn();
        return [
          // On by default on a phone or tablet (`touchControlsOn`).
          { label: tick(touch, 'Touch Controls'), action: () => { setTouchControls(!touch); redraw(); } },
          { label: '\u2003 Touch Controls Layout…', action: openTouchLayoutPanel, enabled: () => touchControlsOn() },
          {
            // Not in the original: the screen without its toolbar, cut short
            // so it scales up larger (`COMPACT_HEIGHT`). The keys and the
            // touch pads still do everything the toolbar did.
            label: tick(getBoolPref('HideToolbar'), 'Hide Toolbar'),
            action: () => { setPref('HideToolbar', !getBoolPref('HideToolbar')); redraw(); },
          },
          MENU_SEPARATOR,
          ...modes.map(([m, label]): MenuItem => ({
            label: tick(mode === m, label), action: () => setDesktopPrefs(m, scale),
          })),
          MENU_SEPARATOR,
          ...[...UI_SCALES, UI_SCALE_FIT].map((s): MenuItem => ({
            label: tick(scale === s, s === UI_SCALE_FIT ? 'Scale to Fit' : `Scale ${s}×`),
            action: () => setDesktopPrefs(mode, s),
          })),
        ];
      },
    }, {
      // The original's Options menu (boe.menus.hpp's OPTIONS_*).
      label: 'Options',
      items: [
        { label: 'Change PC Graphic…', action: () => { void newPcGraphicFlow(); } },
        { label: 'Rename PC…', action: () => { void renamePcFlow(); } },
        { label: 'Add a New PC…', action: () => { void newPcFlow(); } },
        { label: 'Delete PC…', action: () => { void dropPcFlow(); } },
        MENU_SEPARATOR,
        { label: 'Talk Notes', action: () => { void notesFlow('talk'); } },
        { label: 'Encounter Notes', action: () => { void notesFlow('encounter'); } },
        // `journal` (boe.infodlg.cpp:653). Nothing in OBoE adds an entry; the
        // blades-of-exile-ts opcode `journal` does.
        { label: 'Journal', action: () => { void notesFlow('events'); } },
        { label: 'Party Statistics', action: printPartyStats },
      ],
    }, {
      label: 'Actions',
      items: [
        { label: 'Alchemy…', action: () => { void doAlchemyFlow(); } },
        {
          label: 'Wait',
          action: () => {
            if (dialogs.active || midAction()) return;
            void session.wait().then(() => { setStatus(); redraw(); });
          },
        },
        { label: 'Map', action: () => { toggleMap(); redraw(); } },
      ],
    }, {
      // `adjust_monst_menu` (boe.menus.win.cpp:140): the monsters the party
      // has noted, in number order, each opening the roster at its own page.
      label: 'Monsters',
      items: [
        { label: 'About Monsters', action: () => { giveHelp(12, 0, true); } },
        MENU_SEPARATOR,
      ],
      dynamic: () => [...univ.party.mNoted].sort((a, b) => a - b).map((num, i) => ({
        label: univ.scenario.scenMonsters[num]?.name ?? `Monster ${num}`,
        action: () => {
          void dialogs.runNested(monsterInfoDialog(ctx, store, univ, undefined, i))
            .then(() => redraw());
        },
      })),
    }, {
      label: 'Mage Spells',
      items: [
        { label: 'About Mage Spells', action: () => { giveHelp(9, 0, true); } },
        MENU_SEPARATOR,
      ],
      dynamic: () => spellMenuItems(Skill.MAGE_SPELLS),
    }, {
      label: 'Priest Spells',
      items: [
        { label: 'About Priest Spells', action: () => { giveHelp(9, 0, true); } },
        MENU_SEPARATOR,
      ],
      dynamic: () => spellMenuItems(Skill.PRIEST_SPELLS),
    }, {
      label: 'Library',
      items: [
        {
          label: 'Mage Spells',
          action: () => { void dialogs.runNested(spellInfoDialog(ctx, store, univ, 'mage')).then(redraw); },
        },
        {
          label: 'Priest Spells',
          action: () => { void dialogs.runNested(spellInfoDialog(ctx, store, univ, 'priest')).then(redraw); },
        },
        {
          label: 'Skills',
          action: () => { void dialogs.runNested(skillInfoDialog(ctx, store)).then(redraw); },
        },
        {
          label: 'Alchemy',
          action: () => { void dialogs.runNested(alchemyHelpDialog(ctx, store)).then(redraw); },
        },
        MENU_SEPARATOR,
        { label: 'Tip of the Day', action: () => { void tipOfDayFlow(); } },
        { label: 'Introduction', action: () => { void showDialogAction('welcome'); } },
      ],
    }, {
      label: 'Help',
      items: [
        { label: 'Outdoors', action: () => { void showDialogAction('help-outdoor'); } },
        { label: 'Town', action: () => { void showDialogAction('help-town'); } },
        { label: 'Combat', action: () => { void showDialogAction('help-combat'); } },
        { label: 'Barriers and Fields', action: () => { void showDialogAction('help-fields'); } },
        { label: 'Hints', action: () => { void showDialogAction('help-hints'); } },
        { label: 'Magic', action: () => { void showDialogAction('help-magic'); } },
        MENU_SEPARATOR,
        { label: 'About Blades of Exile', action: () => { void showDialogAction('about-boe'); } },
      ],
    }]);
    installMenuToggle(menuHost, refitDesktop);
    installFullScreenButton(menuHost);
    // The bar is hidden while empty, so the canvas has just moved down.
    refitDesktop();
  }

  // `?debug=1`: the test panel beside the game (platform/debugPanel.ts).
  if (new URLSearchParams(window.location.search).has('debug')) {
    void installDebugPanel(session, scen.id, redraw);
  }

  // Handles for headless verification and manual debugging.
  Object.assign(window as unknown as Record<string, unknown>, {
    __session: session,
    __univ: univ,
    __screen: screen,
    __scen: scen,
    __redraw: redraw,
    __desktop: desktop,
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
