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
  title: string;
  ruling: BugRuling;
  /** Why the preference doesn't change it yet, where it doesn't. */
  unwired?: string;
}

export const KNOWN_BUGS: Readonly<Record<number, KnownBug>> = {
  1: { title: "Vilovsky's temple raises Alchemy, though it says Mage Lore", ruling: 'undecided' },
  2: { title: "Gale's Mass Paralysis spot shows Pachtar's book", ruling: 'undecided' },
  3: { title: 'Zone 1, spot 3 marks its flag in the opposite order to its neighbours', ruling: 'undecided' },
  4: {
    title: "Zone 10, spot 2 uses zone 2's block for its line", ruling: 'undecided',
    unwired: "zone 10's own block has no such string, so there's nothing to fix it to",
  },
  5: {
    title: "The Dervish Merchant's welcome back is never reached", ruling: 'undecided',
    unwired: "the fix goes in Baziron's reward at the start of a conversation (1020:163a), which isn't ported",
  },
  6: { title: 'The Nephilim village never remembers the party helped', ruling: 'undecided' },
  7: { title: 'The river ferry back is free, though it says 10 gold', ruling: 'undecided' },
  // 8 is withdrawn: Gointz's sale does free his boat (party+0x1307 is boat
  // 2's `property`; E3's boats are at party+0x12ea). It was a port error.
  9: { title: "Masok's first line is overwritten before it is shown", ruling: 'undecided' },
  10: { title: "The army camp's towers lead to Krizsan", ruling: 'undecided' },
  11: { title: 'The Airy Stone weighs 236 once taken', ruling: 'bug' },
  12: { title: "Exile III's poisons and lock picking help everyone but the nimble", ruling: 'bug' },
  13: { title: 'Good Constitution does nothing to end disease in Exile III', ruling: 'undecided' },
  15: { title: 'A stack of returning missiles drops to one after a throw', ruling: 'undecided' },
  16: { title: 'Raise Dead and Resurrect need no Resurrection Balm', ruling: 'undecided' },
  17: { title: "Alchemy takes the second ingredient's charge from the wrong item", ruling: 'undecided' },
  18: { title: "The Ritual of Sanctification on the spiders' altar can be repeated", ruling: 'undecided' },
  19: { title: 'A moving wall looks for a creature on its own square, not the one ahead', ruling: 'undecided' },
  22: { title: "The intro movie's dying creatures never roll their death cry", ruling: 'undecided' },
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
