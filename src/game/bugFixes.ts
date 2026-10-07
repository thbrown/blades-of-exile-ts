/**
 * The "Fix known bugs" preference — an blades-of-exile-ts extension, in neither 1997's
 * game nor OBoE. The port keeps the originals' bugs by default (`CLAUDE.md`,
 * "Faithful port"); with the preference on, each bug listed here that the
 * user hasn't ruled deliberate plays as it was probably meant to.
 *
 * Numbers 1–99 are Exile III's, as numbered in `E3-SUSPECTED-BUGS.md`; 100 on
 * are kept for the Blades of Exile engine's, when there are any. A scenario
 * script asks through the `if-fixed` opcode (`SpecType.IF_FIXED`), with the
 * number in `ex1a`; engine code calls `bugFixed(n)`.
 *
 * **Off in every replay**: the corpus is recorded against the bugs, and a
 * fix may move the dice. The switch lives here rather than on a session so
 * a loaded game (a new `Universe`) keeps it; `main.ts` sets it from the
 * preference, and the replay driver clears it.
 */

/** What the user has said about a suspected bug. `legit` is never "fixed". */
export type BugRuling = 'undecided' | 'bug' | 'legit';

export interface KnownBug {
  /**
   * One sentence for players: Preferences' "?" lists every entry by it
   * (`dialogs/knownBugsDialog.ts`), so write it as they'd meet the bug.
   */
  title: string;
  ruling: BugRuling;
  /** Why the preference doesn't change it yet, where it doesn't; shown to players too. */
  unwired?: string;
}

export const KNOWN_BUGS: Readonly<Record<number, KnownBug>> = {
  1: { title: "Vilovsky's temple raises Alchemy, though it says Mage Lore", ruling: 'undecided' },
  2: { title: "Gale's Mass Paralysis lesson shows the wrong book", ruling: 'undecided' },
  3: { title: 'A whisper by the stone circle repeats; the others speak once', ruling: 'undecided' },
  4: {
    title: "A beast ambush borrows another place's line", ruling: 'undecided',
    unwired: "there's no line of its own to use",
  },
  5: { title: 'The Dervish Merchant never welcomes you back', ruling: 'undecided' },
  6: { title: 'The Nephilim village forgets that you helped it', ruling: 'undecided' },
  7: { title: 'The river ferry back is free, though it asks 10 gold', ruling: 'undecided' },
  // 8 is withdrawn: Gointz's sale does free his boat (party+0x1307 is boat
  // 2's `property`; E3's boats are at party+0x12ea). It was a port error.
  9: { title: 'Masok skips the first half of his reply', ruling: 'undecided' },
  10: { title: "Stepping onto the army camp's towers takes you to Krizsan", ruling: 'undecided' },
  11: { title: 'The Airy Stone weighs 236 once taken', ruling: 'bug' },
  12: { title: 'Nimble Fingers hinders poisoning, lock picking and traps', ruling: 'bug' },
  13: { title: "Good Constitution doesn't help against disease", ruling: 'undecided' },
  15: { title: 'A stack of returning missiles drops to one when thrown', ruling: 'undecided' },
  16: { title: "Raise Dead and Resurrect don't need a Resurrection Balm", ruling: 'undecided' },
  17: { title: 'Alchemy can use up the wrong item', ruling: 'undecided' },
  18: { title: "The spider altar's ritual can be repeated for experience", ruling: 'undecided' },
  19: { title: 'Moving walls roll over creatures in their way', ruling: 'undecided' },
  22: { title: "The intro movie's death cries never vary", ruling: 'undecided' },
  23: { title: 'The Iceshield wards off fire, not cold', ruling: 'undecided' },
  24: { title: "Skill Rings and Exile III's gauntlets make you miss more", ruling: 'undecided' },
  // The Blades of Exile engine's own, in 1997's and OBoE's `pc_attack` alike.
  100: { title: 'Skill and Giant Strength items make you miss more', ruling: 'undecided' },
};

let enabled = false;

/** Turn the preference's effect on or off (`main.ts`; the replay driver clears it). */
export function setBugFixes(on: boolean): void {
  enabled = on;
}

export function bugFixesOn(): boolean {
  return enabled;
}

/** Whether bug `n` plays fixed: the preference is on and it isn't ruled deliberate. */
export function bugFixed(n: number): boolean {
  const bug = KNOWN_BUGS[n];
  return enabled && bug !== undefined && bug.ruling !== 'legit' && bug.unwired === undefined;
}
