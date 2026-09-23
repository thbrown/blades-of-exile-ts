/**
 * `pick_preferences` (boe.dlgutil.cpp:1379) on preferences.xml, with the
 * autosave details page (pref-autosave.xml) and "reset instant help"
 * (confirm-reset-help.xml) it opens on top of itself.
 *
 * Only the settings that mean something in a browser are offered. The window
 * alignment and the two scale groups belong to a desktop window; the in-game
 * file browser, the splash screen and directional-key scrolling aren't things
 * this port has. Those controls are hidden rather than left doing nothing.
 *
 * **Game speed is a divergence, and a deliberate one.** In the C++ it only
 * lengthens a handful of pauses; this port's animation already runs on one
 * play-tested pace knob (`game/anim.ts`), so the four speeds set that knob
 * instead, with Medium as the pace the game ships at. Neither touches a die.
 */

import { AUTOSAVE_TRIGGER_DEFAULTS, AutosavePrefs, AutosaveReason } from '../game/autosave';
import { SheetStore } from '../render/sheets';
import { ModalScreen } from './dialog';
import { DialogControl, DialogDef } from './dialogXml';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

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
}

/** The pace each speed sets; Medium is the pace the game ships at. */
export const GAME_SPEED_PACE = [0.6, 1, 1.5, 2.2];

const SPEED_LEDS = ['fast', 'med', 'slow', 'snail'];
const HIDDEN = [
  'disp-head', 'disp-frame', 'display', 'tl', 'tr', 'mid', 'bl', 'br', 'win',
  'scale-head', 'scaleui-head', 'scaleui', 'scalemap-head', 'scalemap',
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
 * preferences.xml laid out for this port. The definition is taller than the
 * 605×430 game window (OBoE's window is bigger), and its top block — window
 * alignment and scale — is desktop-only; so that block is removed and
 * everything below it moves up to close the gap. Built fresh each time from
 * the shared definition, which is left alone.
 */
function browserPreferencesDef(): DialogDef {
  const def = getDialogDef('preferences');
  const top = def.byName.get('disp-head')!.rect.top;
  const cut = def.byName.get('spd-head')!.rect.top - top;
  const drop = new Set(HIDDEN);
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
  return { ...def, controls, byName };
}

/**
 * Show the dialog; resolves with the new settings on OK, or null on Cancel.
 * The autosave details are edited on a copy and only kept if both dialogs
 * are OK'd.
 */
export async function preferencesDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, prefs: Preferences, host: PreferencesHost,
): Promise<Preferences | null> {
  const dlg = new XmlDialog(ctx, store, browserPreferencesDef());
  for (const name of HIDDEN) dlg.hide(name);
  const on = (b: boolean) => (b ? 'red' : 'off');
  dlg.setLed(SPEED_LEDS[prefs.gameSpeed] ?? 'med', 'red');
  dlg.setLed('target-lock', on(prefs.targetLock));
  dlg.setLed('nosound', on(!prefs.playSounds));
  dlg.setLed('autosave-toggle', on(prefs.autosave.enabled));
  dlg.setLed('easier', on(prefs.easyMode));
  dlg.setLed('lesswm', on(prefs.lessWm));
  dlg.setLed('nohelp', on(!prefs.showInstantHelp));
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
