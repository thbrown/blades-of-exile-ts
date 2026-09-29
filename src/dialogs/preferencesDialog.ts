/**
 * `pick_preferences` (boe.dlgutil.cpp:1379) on preferences.xml, with the
 * autosave details page (pref-autosave.xml) and "reset instant help"
 * (confirm-reset-help.xml) it opens on top of itself.
 *
 * Only the settings that mean something in a browser are offered. Display
 * alignment and UI scale place the game screen on the page (see
 * `render/desktop.ts`). The minimap scale belongs to OBoE's separate map
 * window, and the in-game file browser, the splash screen and directional-key
 * scrolling aren't things this port has. Those controls are hidden rather than
 * left doing nothing.
 *
 * **Game speed is a divergence, and a deliberate one.** In the C++ it only
 * lengthens a handful of pauses; this port's animation already runs on one
 * play-tested pace knob (`game/anim.ts`), so the four speeds set that knob
 * instead, with Medium as the pace the game ships at. Neither touches a die.
 */

import { AUTOSAVE_TRIGGER_DEFAULTS, AutosavePrefs, AutosaveReason } from '../game/autosave';
import { UI_SCALES, UI_SCALE_FIT, desktop } from '../render/desktop';
import { SheetStore } from '../render/sheets';
import { ModalScreen } from './dialog';
import { DialogControl, DialogDef } from './dialogXml';
import { getDialogDef } from './dialogStore';
import { XmlDialog, measureDialogDef } from './xmlDialog';

export const PREFERENCES_DIALOG_DEFS = ['preferences', 'pref-autosave', 'confirm-reset-help'];

/** The settings this dialog edits, as the host holds them. */
export interface Preferences {
  playSounds: boolean;
  /** `GameSpeed`: 0 fast, 1 medium, 2 slow, 3 quite slow. */
  gameSpeed: number;
  targetLock: boolean;
  showInstantHelp: boolean;
  autosave: AutosavePrefs;
  /** Party settings rather than preferences once a game is running. */
  easyMode: boolean;
  lessWm: boolean;
  /** `DisplayMode`, 0–5. */
  displayMode: number;
  /** `UIScale`: 1, 1.5, 2, 3, 4, or `UI_SCALE_FIT`. */
  uiScale: number;
  /**
   * Exile III's "Show room descriptions more than once" (its dialog 1099,
   * LED 24), a party setting too; undefined where the scenario has no such
   * thing, and the row is left out.
   */
  roomDescriptions?: boolean;
}

/**
 * The row the room descriptions take: "Skip splash screen", which the
 * browser has no use for and never shows, so no other row moves.
 */
const ROOM_DESCRIPTIONS_LED = 'skipsplash';

/** The pace each speed sets; Medium is the pace the game ships at. */
export const GAME_SPEED_PACE = [0.6, 1, 1.5, 2.2];

const SPEED_LEDS = ['fast', 'med', 'slow', 'snail'];
/** The `display` group's LEDs, in `DisplayMode` order (boe.dlgutil.cpp:1392). */
const DISPLAY_LEDS = ['mid', 'tl', 'tr', 'bl', 'br', 'win'];
/** The `scaleui` group's LEDs, `UI_SCALES` order, then `other` for Fit. */
const SCALE_LEDS = ['1', '1_5', '2', '3', '4', 'other'];
/** The display alignment and scale block at the top of the dialog. */
const DESKTOP_BLOCK = [
  'disp-head', 'disp-frame', 'display', 'tl', 'tr', 'mid', 'bl', 'br', 'win',
  'scale-head', 'scaleui-head', 'scaleui',
];
const HIDDEN = [
  'scalemap-head', 'scalemap',
  'keyshift-head', 'keyshift-options', 'target-adjacent', 'screen-shift', 'keyshift-note',
  'fancypicker', 'skipsplash',
];
const TRIGGERS: AutosaveReason[] = [
  'RestComplete', 'TownWaitComplete', 'Eat', 'EnterTown', 'ExitTown', 'EndOutdoorCombat',
];

export interface PreferencesHost {
  nest(screen: ModalScreen): Promise<string>;
  /** `clear_pref("ReceivedHelp")`. */
  resetHelp(): void;
}

/**
 * preferences.xml laid out for this port. The whole definition is taller than
 * a 605×430 desktop, which is all there is in Small Window mode or when the
 * scale fills the page. There the top block, alignment and scale, is removed
 * and everything below it moves up to close the gap. Those two settings are
 * on the View menu as well, so they can always be reached. Built fresh each
 * time from the shared definition, which is left alone.
 */
function browserPreferencesDef(ctx: CanvasRenderingContext2D, compact: boolean, roomDescs: boolean): DialogDef {
  const def = getDialogDef('preferences');
  // Laid out for good before copying: the copy leaves controls out, and the
  // ones placed relative to their predecessor would anchor on the wrong one
  // if it were laid out again.
  measureDialogDef(ctx, def);
  const top = def.byName.get('disp-head')!.rect.top;
  const cut = compact ? def.byName.get('spd-head')!.rect.top - top : 0;
  // The minimap group's LEDs are named '1', '2'… like the UI group's, so
  // it has to leave the definition, not just be hidden, or the names clash.
  const drop = new Set(compact ? [...HIDDEN, ...DESKTOP_BLOCK] : HIDDEN);
  if (roomDescs) drop.delete(ROOM_DESCRIPTIONS_LED);
  const moved = (c: DialogControl): DialogControl => {
    const r = c.rect;
    const rect = r.top >= top + cut ? { ...r, top: r.top - cut, bottom: r.bottom - cut } : r;
    const copy = { ...c, rect } as DialogControl;
    if (copy.kind === 'group') copy.leds = copy.leds.map((l) => moved(l) as typeof l);
    return copy;
  };
  const controls = def.controls.filter((c) => !drop.has(c.name)).map(moved);
  const byName = new Map<string, DialogControl>();
  for (const c of controls) {
    if (c.name) byName.set(c.name, c);
    if (c.kind === 'group') for (const l of c.leds) byName.set(l.name, l);
  }
  return { ...def, controls, byName, measured: true };
}

/**
 * Show the dialog; resolves with the new settings on OK, or null on Cancel.
 * The autosave details are edited on a copy and only kept if both dialogs
 * are OK'd.
 */
export async function preferencesDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, prefs: Preferences, host: PreferencesHost,
): Promise<Preferences | null> {
  const roomDescs = prefs.roomDescriptions !== undefined;
  let dlg = new XmlDialog(ctx, store, browserPreferencesDef(ctx, false, roomDescs));
  const compact = dlg.frame.bottom - dlg.frame.top > desktop.h;
  if (compact) dlg = new XmlDialog(ctx, store, browserPreferencesDef(ctx, true, roomDescs));
  for (const name of compact ? [...HIDDEN, ...DESKTOP_BLOCK] : HIDDEN) {
    if (!(roomDescs && name === ROOM_DESCRIPTIONS_LED)) dlg.hide(name);
  }
  if (roomDescs) dlg.setText(ROOM_DESCRIPTIONS_LED, 'Show room descriptions more than once');
  if (!compact) {
    dlg.setText('other', 'Fit');
    // OBoE's "Small Window (not full screen)" is about an OS window.
    dlg.setText('win', 'Game screen only');
    dlg.setLed(DISPLAY_LEDS[prefs.displayMode] ?? 'mid', 'red');
    const scale = prefs.uiScale === UI_SCALE_FIT ? 5 : UI_SCALES.indexOf(prefs.uiScale);
    dlg.setLed(SCALE_LEDS[scale] ?? '2', 'red');
    for (const id of [...DISPLAY_LEDS, ...SCALE_LEDS]) {
      dlg.attachHandler(id, (me) => { me.setLed(id, 'red'); return 'stay'; });
    }
  }
  const on = (b: boolean) => (b ? 'red' : 'off');
  dlg.setLed(SPEED_LEDS[prefs.gameSpeed] ?? 'med', 'red');
  dlg.setLed('target-lock', on(prefs.targetLock));
  dlg.setLed('nosound', on(!prefs.playSounds));
  dlg.setLed('autosave-toggle', on(prefs.autosave.enabled));
  dlg.setLed('easier', on(prefs.easyMode));
  dlg.setLed('lesswm', on(prefs.lessWm));
  dlg.setLed('nohelp', on(!prefs.showInstantHelp));
  if (roomDescs) dlg.setLed(ROOM_DESCRIPTIONS_LED, on(prefs.roomDescriptions!));
  // A group keeps one lit: clicking the lit speed again mustn't turn it off.
  for (const id of SPEED_LEDS) dlg.attachHandler(id, (me) => { me.setLed(id, 'red'); return 'stay'; });

  let autosave: AutosavePrefs = { ...prefs.autosave, triggers: { ...prefs.autosave.triggers } };
  dlg.attachHandler('autosave-details', () => {
    void autosaveDialog(ctx, store, autosave, host).then((next) => { if (next) autosave = next; });
    return 'stay';
  });
  dlg.attachHandler('resethelp', () => {
    const confirm = new XmlDialog(ctx, store, getDialogDef('confirm-reset-help'));
    void host.nest(confirm).then((answer) => { if (answer === 'yes') host.resetHelp(); });
    return 'stay';
  });

  if ((await host.nest(dlg)) !== 'okay') return null;
  const lit = (id: string): boolean => dlg.getLed(id) !== 'off';
  return {
    playSounds: !lit('nosound'),
    gameSpeed: Math.max(0, SPEED_LEDS.findIndex(lit)),
    targetLock: lit('target-lock'),
    showInstantHelp: !lit('nohelp'),
    autosave: { ...autosave, enabled: lit('autosave-toggle') },
    easyMode: lit('easier'),
    lessWm: lit('lesswm'),
    displayMode: compact ? prefs.displayMode : Math.max(0, DISPLAY_LEDS.findIndex(lit)),
    uiScale: compact ? prefs.uiScale : (UI_SCALES[SCALE_LEDS.findIndex(lit)] ?? UI_SCALE_FIT),
    ...(roomDescs ? { roomDescriptions: lit(ROOM_DESCRIPTIONS_LED) } : {}),
  };
}

/** pref-autosave.xml — the file count and the six triggers. */
async function autosaveDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, prefs: AutosavePrefs, host: PreferencesHost,
): Promise<AutosavePrefs | null> {
  const dlg = new XmlDialog(ctx, store, getDialogDef('pref-autosave'));
  dlg.setNum('max-files', prefs.max);
  for (const t of TRIGGERS) {
    dlg.setLed(t, (prefs.triggers[t] ?? AUTOSAVE_TRIGGER_DEFAULTS[t]) ? 'red' : 'off');
  }
  dlg.attachHandler('okay', (me) => (me.toast(true) ? 'close' : 'stay'));
  if ((await host.nest(dlg)) !== 'okay') return null;
  const triggers: Partial<Record<AutosaveReason, boolean>> = {};
  for (const t of TRIGGERS) triggers[t] = dlg.getLed(t) !== 'off';
  return { enabled: prefs.enabled, triggers, max: Math.max(1, dlg.getTextAsNum('max-files')) };
}
