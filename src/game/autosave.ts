/**
 * `try_auto_save` (boe.fileio.cpp:520) — redesigned as a save *tree*
 * (`platform/saveStore.ts`), not the C++'s ring of five files. Recorded in
 * `DIVERGENCES.md` §47.
 *
 * A **tick** saves after every move (once the walking pauses,
 * `saveScheduler.ts`), so closing the tab, or going to the main menu, never
 * loses one. Each tree keeps a capped pool of these autosaves
 * (`saveRetention.ts`).
 *
 * Two moments make that save a **milestone** — kept for good, and marked in
 * the restore tree: a quest completed, and an entry in the events journal
 * (Exile III's thirty-four plot events). OBoE's six (entering and leaving a
 * town, a rest, a long wait, an outdoor fight's end, a meal) and their
 * `Autosave_<reason>` preferences are gone (2026-10-05): with every move
 * saved they marked nothing, and nothing is left to choose.
 *
 * Like `setPrintResult` and `setLivingSound` this is a module-level hook: the
 * call sites are deep inside the specials, which haven't the host to hand.
 * Left uninstalled — which is what every test does — it is a no-op. The sink
 * must not write anything itself: it only notes that a save is wanted
 * (`saveScheduler.ts`).
 */

export type AutosaveReason = 'QuestComplete' | 'Journal';

/** What the sink is told: a milestone, or the periodic tick. */
export type AutosaveWhy = AutosaveReason | 'Tick';

let sink: ((reason: AutosaveWhy) => void) | null = null;

/** The host installs the thing that actually writes; null disables autosaving. */
export function setAutosaveSink(next: ((reason: AutosaveWhy) => void) | null): void {
  sink = next;
}

/** A milestone. */
export function tryAutoSave(reason: AutosaveReason): void {
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
