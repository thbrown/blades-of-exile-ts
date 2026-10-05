/**
 * `try_auto_save` (boe.fileio.cpp:520) and `check_autosave_trigger` (:513) —
 * redesigned as a save *tree* (`platform/saveStore.ts`), not the C++'s ring of
 * five files. Recorded in `DIVERGENCES.md`.
 *
 * The game saves itself at eight named moments, which can make that save one
 * of the tree's **milestones** (kept for good, and marked in the restore
 * tree). Each is a separate preference, `Autosave_<reason>`. Only the two that
 * mark a real achievement default on: **a quest completed** and **an entry in
 * the events journal** (Exile III's thirty-four plot events). OBoE's six —
 * entering and leaving a town, a rest, a long wait, an outdoor fight's end, a
 * meal — default off since 2026-10-05: they came so often that the milestones
 * marked nothing. The tick saves those moments anyway, as autosaves.
 *
 * On top of those, a **tick** saves after every move, so closing the tab, or
 * going to the main menu, never loses one. Each tree keeps a capped pool of
 * these autosaves (`saveRetention.ts`), so the cost is bounded, and a move
 * that changed nothing isn't written at all (`saveScheduler.ts`).
 *
 * Like `setPrintResult` and `setLivingSound` this is a module-level hook: the
 * call sites are deep inside `increase_age`, `start_town_mode` and
 * `end_combat`, none of which has the host to hand, and the C++ reaches for a
 * global there for exactly the same reason. Left uninstalled — which is what
 * every test does — it is a no-op. The sink must not write anything itself: it
 * only notes that a save is wanted (`saveScheduler.ts`).
 */

export type AutosaveReason =
  | 'QuestComplete'
  | 'Journal'
  | 'EnterTown'
  | 'ExitTown'
  | 'RestComplete'
  | 'TownWaitComplete'
  | 'EndOutdoorCombat'
  | 'Eat';

/**
 * `autosave_trigger_defaults` (boe.fileio.cpp:504), whose six are all on but
 * Eat; here they are off, and this port's two achievements on.
 */
export const AUTOSAVE_TRIGGER_DEFAULTS: Record<AutosaveReason, boolean> = {
  QuestComplete: true,
  Journal: true,
  EnterTown: false,
  ExitTown: false,
  RestComplete: false,
  TownWaitComplete: false,
  EndOutdoorCombat: false,
  Eat: false,
};

/** What the sink is told: a milestone, or the periodic tick. */
export type AutosaveWhy = AutosaveReason | 'Tick';

/**
 * There is no master switch: OBoE's `Autosave` preference is gone, and a
 * stored value of it is ignored. The game always saves itself; only which
 * moments are named milestones is a choice.
 */
export interface AutosavePrefs {
  /** Per-reason overrides; anything absent falls back to the default above. */
  triggers: Partial<Record<AutosaveReason, boolean>>;
}

export const DEFAULT_AUTOSAVE_PREFS: AutosavePrefs = {
  triggers: {},
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

/** `try_auto_save` — the trigger, then the host (there is no master switch). */
export function tryAutoSave(reason: AutosaveReason): void {
  if (!autosaveTriggerOn(reason)) return;
  sink?.(reason);
}

/**
 * The periodic save, called once per move — each pass of `increase_age`, which
 * is a step, a spell, a turn spent, in town as well as outdoors. (Resting
 * calls it once per hour it passes; those fold into one save, because the
 * scheduler only captures between actions.)
 */
export function tickAutoSave(): void {
  sink?.('Tick');
}
