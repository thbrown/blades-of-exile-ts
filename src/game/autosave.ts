/**
 * `try_auto_save` (boe.fileio.cpp:520) and `check_autosave_trigger` (:513).
 *
 * The game saves itself at six named moments. Each is a separate preference,
 * `Autosave_<reason>`, on top of the master `Autosave` switch — so a player can
 * keep the town-entry autosave and turn off the one that fires every time the
 * party eats. Five default on; **Eat defaults off**, because it happens far
 * more often than the rest.
 *
 * Like `setPrintResult` and `setLivingSound` this is a module-level hook: the
 * call sites are deep inside `increase_age`, `start_town_mode` and
 * `end_combat`, none of which has the host to hand, and the C++ reaches for a
 * global there for exactly the same reason. Left uninstalled — which is what
 * every test does — it is a no-op.
 */

export type AutosaveReason =
  | 'EnterTown'
  | 'ExitTown'
  | 'RestComplete'
  | 'TownWaitComplete'
  | 'EndOutdoorCombat'
  | 'Eat';

/** `autosave_trigger_defaults` (boe.fileio.cpp:504). */
export const AUTOSAVE_TRIGGER_DEFAULTS: Record<AutosaveReason, boolean> = {
  EnterTown: true,
  ExitTown: true,
  RestComplete: true,
  TownWaitComplete: true,
  EndOutdoorCombat: true,
  Eat: false,
};

/** `MAX_AUTOSAVE_DEFAULT` (boe.global.hpp:22) — how many rotate before reuse. */
export const MAX_AUTOSAVE_DEFAULT = 5;

export interface AutosavePrefs {
  /** The master switch, `Autosave`. */
  enabled: boolean;
  /** Per-reason overrides; anything absent falls back to the default above. */
  triggers: Partial<Record<AutosaveReason, boolean>>;
  max: number;
}

export const DEFAULT_AUTOSAVE_PREFS: AutosavePrefs = {
  enabled: true,
  triggers: {},
  max: MAX_AUTOSAVE_DEFAULT,
};

let prefs: AutosavePrefs = DEFAULT_AUTOSAVE_PREFS;
let sink: ((reason: AutosaveReason) => void) | null = null;

export function setAutosavePrefs(next: AutosavePrefs): void {
  prefs = next;
}

export function getAutosavePrefs(): AutosavePrefs {
  return prefs;
}

/** The host installs the thing that actually writes; null disables autosaving. */
export function setAutosaveSink(next: ((reason: AutosaveReason) => void) | null): void {
  sink = next;
}

/** `check_autosave_trigger` — the per-reason preference, defaulted. */
export function autosaveTriggerOn(reason: AutosaveReason): boolean {
  return prefs.triggers[reason] ?? AUTOSAVE_TRIGGER_DEFAULTS[reason];
}

/** `try_auto_save` — the master switch, then the trigger, then the host. */
export function tryAutoSave(reason: AutosaveReason): void {
  if (!prefs.enabled) return;
  if (!autosaveTriggerOn(reason)) return;
  sink?.(reason);
}
