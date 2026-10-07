/**
 * Keyboard shortcuts a dialog's buttons get for free. **Not in either
 * original** (a play-test request, DIVERGENCES.md §51): there, a prompt's
 * buttons answer only to the keys its definition gives them, so "Yes" is
 * Enter and "No" has no key at all.
 *
 * - **The first letter** of a button's label, underlined on the button, when
 *   the button has no key of its own, nothing else in the dialog already
 *   answers to that letter, and no other button's label starts with it. A
 *   button's own letter key is underlined as well, where its label has it.
 * - **1, 2, 3…** for a short row of buttons (two to five), in reading order —
 *   so 1 is the first choice and 2 the second, whatever they say — unless
 *   something in the dialog already answers to a digit (picking a PC does).
 *
 * A dialog with a text field gets neither: there, typing is for the field.
 */

export interface KeyCandidate {
  name: string;
  /** The label as drawn; `|` breaks a line, as on a button face. */
  label: string;
  /** The button's own key, if it has one (lower case). */
  key: string | null;
  /** Reading order: top to bottom, then left to right. */
  top: number;
  left: number;
}

export interface AutoKeys {
  /** A button's letter, and where in its label to underline it. */
  letters: Map<string, { key: string; index: number }>;
  /** '1'…'5' to the button each one presses. */
  digits: Map<string, string>;
}

const MAX_DIGIT_BUTTONS = 5;

export function autoKeys(candidates: KeyCandidate[], taken: ReadonlySet<string>): AutoKeys {
  const letters = new Map<string, { key: string; index: number }>();
  const digits = new Map<string, string>();

  const first = new Map<string, { key: string; index: number }>();
  const count = new Map<string, number>();
  for (const c of candidates) {
    const index = c.label.search(/[a-z]/i);
    if (index < 0) continue;
    const key = c.label[index]!.toLowerCase();
    count.set(key, (count.get(key) ?? 0) + 1);
    if (c.key === null) first.set(c.name, { key, index });
  }
  for (const [name, letter] of first) {
    if (taken.has(letter.key) || (count.get(letter.key) ?? 0) > 1) continue;
    letters.set(name, letter);
  }
  // A button's own letter key is underlined too, where its label has it, so
  // every key a prompt answers to shows. (It already works; this only draws.)
  for (const c of candidates) {
    if (c.key === null || !/^[a-z]$/.test(c.key)) continue;
    const index = c.label.toLowerCase().indexOf(c.key);
    if (index >= 0) letters.set(c.name, { key: c.key, index });
  }

  const usesDigits = [...taken].some((k) => /^[0-9]$/.test(k));
  if (!usesDigits && candidates.length >= 2 && candidates.length <= MAX_DIGIT_BUTTONS) {
    [...candidates]
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .forEach((c, i) => digits.set(String(i + 1), c.name));
  }
  return { letters, digits };
}

/**
 * Underline one letter of a centred line, as a Windows mnemonic is shown.
 * `lineLeft` is where the line's first character is drawn and `baseline` its
 * baseline; the font must already be set on `ctx`.
 */
export function underlineLetter(
  ctx: CanvasRenderingContext2D, line: string, index: number,
  lineLeft: number, baseline: number, colour: string,
): void {
  const x0 = lineLeft + ctx.measureText(line.slice(0, index)).width;
  const w = ctx.measureText(line[index] ?? '').width;
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x0), baseline + 1, Math.max(1, Math.round(w)), 1);
}
