/**
 * The personalities E3 never lets talk. Its talk handler (`1010:26c0`)
 * checks, after "Creature is hostile." and the summoned creature's "No
 * response.", eight personality numbers against a table at `1010:3ba5`, and
 * for each prints a line of its own to the text area instead of opening a
 * conversation:
 *
 * | E3 | line (`1010:`) |
 * |---|---|
 * | 0 | The townsperson doesn't respond. (`0b54`) |
 * | 7 | The guard doesn't respond. (`0b87`) |
 * | 8 | The soldier doesn't respond. (`0bb4`) |
 * | 9 | The creature doesn't respond. (`0be3`) |
 * | 126 | The apprentice isn't allowed. (`0c13`) |
 * | 142 | The Anama member nods in greeting (`0c6c`), with special item 39; else moves quickly on (`0c95`) |
 * | 232 | The undead creature stumbles past. (`0c43`) |
 * | 342 | This person is incoherent. (`0cbe`), in a town numbered below 20 |
 *
 * The converter used to hand personalities 7, 8, 9, 126, 232 and 342 to the
 * engine as real conversations, and talk block 0's slots 6–8 hold E3's
 * placeholders ("n7", "l7"), so Fort Emergence's guards talked gibberish.
 *
 * The engine's own route for a mute creature is BoE's: a personality below
 * zero is `small_talk`, and one past -1000 prints scenario string
 * `-p - 1000` as "Talk: …" — after the hostile and summoned checks, E3's
 * order exactly. 342's town test always holds: only Gale's four towns
 * (16–19) have it. Anama's depends on the party, so it is a HAIL special
 * instead (`e3MuteHail`).
 */

import { partySpecItem, type SpecBuilder, type Step } from '../script';

const SEG = 0x1010;

/** E3 personality → the line's address, for the ones that always say the same. */
const FIXED: ReadonlyMap<number, number> = new Map([
  [0, 0x0b54], [7, 0x0b87], [8, 0x0bb4], [9, 0x0be3],
  [126, 0x0c13], [232, 0x0c43], [342, 0x0cbe],
]);

const ANAMA = 142;
/** `cmp word ptr es:[0x5a], 0` in the party segment: special item 39. */
const ANAMA_TOKEN = partySpecItem(0x5a);

/** The line without its "Talk: ", which the engine's small talk adds back. */
function line(exeString: (seg: number, off: number) => string, off: number): string {
  return exeString(SEG, off).replace(/^Talk:\s*/, '').trim();
}

/**
 * The engine personality for each fixed mute E3 personality: `-(1000 + i)`,
 * `i` the scenario string the line was added as. Adds the strings to `scen`.
 */
export function e3MutePersonalities(
  scen: SpecBuilder, exeString: (seg: number, off: number) => string,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [p, off] of FIXED) {
    let i = scen.text(line(exeString, off));
    // Small talk wants `-p` over 1000 (session.ts `talkTo`), so string 0 won't do.
    if (i === 0) i = scen.text(line(exeString, off));
    out.set(p, -(1000 + i));
  }
  return out;
}

/**
 * Anama's HAIL: its line to the text area, and no conversation. A hostile
 * one falls through to the engine's "Creature is hostile.", which E3 checks
 * first.
 */
export function e3MuteHail(
  b: SpecBuilder, slot: number, p: number, exeString: (seg: number, off: number) => string,
): Step[] | null {
  if (p !== ANAMA) return null;
  const say = (off: number): Step[] => [b.log(SEG, off), b.blockMove()];
  // E3's hostile attitudes are the odd ones.
  return [b.ifCreature(slot, { attitude: 1 }, [], [b.ifCreature(slot, { attitude: 3 }, [],
    [b.ifSpecItem(ANAMA_TOKEN, say(0x0c6c), say(0x0c95))])])];
}
