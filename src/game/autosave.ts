/**
 * `try_auto_save` (boe.fileio.cpp:520) and `check_autosave_trigger` (:513) —
 * redesigned as a save *tree* (`platform/saveStore.ts`), not the C++'s ring of
 * five files. Recorded in `DIVERGENCES.md`.
 *
 * The game saves itself at six named moments, which are the tree's
 * **milestones**. Each is a separate preference, `Autosave_<reason>`, on top of
 * the master `Autosave` switch — so a player can keep the town-entry autosave
 * and turn off the one that fires every time the party eats. Five default on;
 * **Eat defaults off**, because it happens far more often than the rest.
 *
 * On top of those, a **tick** saves every `Autosave_Every` moves — by default
 * every one, so closing the tab, or going to the main menu, never loses a
 * move. Older saves thin out (`saveRetention.ts`), so the cost is bounded,
 * and a move that changed nothing isn't written at all (`saveScheduler.ts`).
 *
 * Like `setPrintResult` and `setLivingSound` this is a module-level hook: the
 * call sites are deep inside `increase_age`, `start_town_mode` and
 * `end_combat`, none of which has the host to hand, and the C++ reaches for a
 * global there for exactly the same reason. Left uninstalled — which is what
 * every test does — it is a no-op. The sink must not write anything itself: it
 * only notes that a save is wanted (`saveScheduler.ts`).
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

/** A save every this many moves, by default. */
export const AUTOSAVE_EVERY_DEFAULT = 1;

/** The most one game's saves may take up, in megabytes, by default. */
export const AUTOSAVE_BUDGET_MB_DEFAULT = 10;

/** What the sink is told: a milestone, or the periodic tick. */
export type AutosaveWhy = AutosaveReason | 'Tick';

export interface AutosavePrefs {
  /** The master switch, `Autosave`. */
  enabled: boolean;
  /** Per-reason overrides; anything absent falls back to the default above. */
  triggers: Partial<Record<AutosaveReason, boolean>>;
  /** The tick: save every this many turns of game time; 0 turns it off. */
  every: number;
  /** The most one tree may take up, in MB. */
  budgetMb: number;
}

export const DEFAULT_AUTOSAVE_PREFS: AutosavePrefs = {
  enabled: true,
  triggers: {},
  every: AUTOSAVE_EVERY_DEFAULT,
  budgetMb: AUTOSAVE_BUDGET_MB_DEFAULT,
};

let prefs: AutosavePrefs = DEFAULT_AUTOSAVE_PREFS;
let sink: ((reason: AutosaveWhy) => void) | null = null;

export function setAutosavePrefs(next: AutosavePrefs): void {
  prefs = next;
}

export function getAutosavePrefs(): AutosavePrefs {
  return prefs;
}

/** The host installs the thing that actually writes; null disables autosaving. */
export function setAutosaveSink(next: ((reason: AutosaveWhy) => void) | null): void {
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

let movesSinceTick = 0;

/**
 * The periodic save, called once per move — each pass of `increase_age`, which
 * is a step, a spell, a turn spent. (Resting calls it once per hour it passes;
 * the host coalesces those into one write.)
 */
export function tickAutoSave(): void {
  if (!prefs.enabled || prefs.every <= 0) return;
  if (++movesSinceTick < prefs.every) return;
  movesSinceTick = 0;
  sink?.('Tick');
}
