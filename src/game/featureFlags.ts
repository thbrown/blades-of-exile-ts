/**
 * Feature flags — `feature_flags` (boe.main.cpp:108) and `has_feature_flag`
 * (boe.global.hpp:38).
 *
 * **This is how the C++ reproduces its own history.** Several of its bugs were
 * fixed years after the replays that depend on them were recorded, so rather
 * than choosing between "correct" and "reproducible" it keeps both and lets a
 * flag decide. The build declares which feature versions it supports; a
 * recording writes down the set *it* had; and on playback the recorded set
 * **replaces** the build's entirely, so a flag the recording never mentions is
 * absent and the old behaviour applies.
 *
 * That last rule is the one that matters and the one that is easy to get
 * backwards: an unlisted flag does not mean "default", it means **off**. 58 of
 * the 82 corpus recordings that carry a flag block list
 * `empty-wandering-monster-bug: fixed`, and the two dozen that do not need the
 * bug — so a port that hard-codes either answer is wrong for most of the
 * corpus either way.
 *
 * The live game keeps the defaults below, which is what a build with no replay
 * loaded does.
 */

/**
 * What this build supports, and in which versions — `feature_flags`'s
 * initialiser, ported verbatim. A version listed here is one the engine can
 * actually produce; `setFeatureFlags` refuses a recording that asks for
 * anything else, exactly as `replay_feature_flags` does.
 */
export const SUPPORTED_FEATURES: Readonly<Record<string, readonly string[]>> = {
  // Legacy scenario flags. "required" means it *can* be supported, if the
  // scenario asks for it.
  'resurrection-balm': ['required'],
  // Diagonal conveyor belts and big monster physics.
  'conveyor-belts': ['V2'],
  // Legacy behaviour of the T debug action: it does not move the party outdoors.
  'debug-enter-town': ['move-outdoors'],
  // Legacy behaviour of the X debug action: kills the party with 'Absent'.
  'debug-kill-party': ['V2'],
  // Legacy pacifist spellcasting: the player may select a combat spell and
  // click Cast, and it fails then rather than being refused up front.
  'pacifist-spellcast-check': ['V2'],
  // Target lock. V1 shifts the screen to show the most enemies in range;
  // V2 is V1 but will not shift if that hides enemies already visible.
  'target-lock': ['V1', 'V2'],
  'file-picker-dialog': ['V1'],
  'scenario-meta-format': ['V2'],
  'talk-go-back': ['StackV1'],
  // Bugs several VoDT replays need in order to run faithfully.
  'empty-wandering-monster-bug': ['fixed'],
  'too-many-extra-wandering-monsters-bug': ['fixed'],
  'store-spell-target': ['fixed'],
  'store-spell-caster': ['fixed'],
  // Game balance: Resist Magic used to not help against magic damage.
  'magic-resistance': ['fixed'],
};

/** The set in force. Starts as everything this build supports. */
let current: Record<string, readonly string[]> = { ...SUPPORTED_FEATURES };

/** `has_feature_flag` (boe.global.hpp:38). */
export function hasFeatureFlag(flag: string, version: string): boolean {
  return current[flag]?.includes(version) ?? false;
}

/**
 * `replay_feature_flags` (boe.main.cpp:1087) — install a recording's set, in
 * place of this build's.
 *
 * Throws when the recording needs a version this build cannot produce, which is
 * the C++'s behaviour and the right one: silently running it with the flag off
 * would give a different game and blame the divergence on something else.
 */
export function setFeatureFlags(flags: Record<string, readonly string[]>): void {
  for (const [flag, versions] of Object.entries(flags)) {
    for (const version of versions) {
      if (!SUPPORTED_FEATURES[flag]?.includes(version)) {
        throw new Error(
          `This replay requires a feature that is not supported here: `
          + `${flag} should support '${version}'`);
      }
    }
  }
  current = { ...flags };
}

/**
 * The set in force, for `record_feature_flags` (boe.main.cpp:1071) — a
 * recording writes down what it was made under so it can be replayed against a
 * later build.
 */
export function currentFeatureFlags(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(current).map(([k, v]) => [k, [...v]]));
}

/** Back to what this build supports — what the live game runs on. */
export function resetFeatureFlags(): void {
  current = { ...SUPPORTED_FEATURES };
}
