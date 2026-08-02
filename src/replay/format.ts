/**
 * The replay file format — `src/tools/replay.cpp`.
 *
 * A replay is an `<actions>` document holding one element per *semantic* input:
 * not a keystroke or a pixel, but "the party moved to (13,40)", "the button
 * called `done` was clicked". The C++ records these at every point it would
 * otherwise read input, and on playback pulls them back in the same order.
 *
 * That pull discipline is the whole value of the format, and it is why this
 * port keeps it exactly: `pop_next_action(type)` **throws when the next
 * recorded action isn't the kind being asked for**, so a control-flow
 * divergence anywhere in the engine is caught at the first input it changes,
 * rather than silently producing a different game.
 *
 * Two things are stored as text in a shape worth naming: a location is
 * `(x,y)` (`location_from_action`, replay.cpp:322) and a plain number is the
 * element's text (`short_from_action`, :326). Anything richer is child
 * elements, read into a string map (`info_from_action`, :286).
 */

import { Location } from '../core/location';

export interface ReplayAction {
  /** The element name — `move`, `click_control`, `handle_pause`… */
  type: string;
  /** The element's own text, for the actions that carry a bare value. */
  text: string;
  /** Child elements, name → text (`info_from_action`). */
  info: Record<string, string>;
}

export interface Replay {
  /** The seed the game stream was started from (`<srand>`). */
  seed: number | null;
  /** Which scenario the recording was made in — this port's own addition. */
  scenario: string | null;
  /**
   * The `<feature_flags>` block: which feature versions the recording build
   * had. **`null` means the file has no block at all**, which is not the same
   * as an empty one — the C++ replaces its whole set with what it read, so a
   * file with an empty block runs with *every* flag off.
   *
   * Parsed separately from `actions` because a flag can list several versions
   * (`target-lock` has two) and the generic info map keeps only one string per
   * child name.
   */
  featureFlags: Record<string, string[]> | null;
  actions: ReplayAction[];
}

/**
 * `location_from_action` — the text is `(x,y)`.
 *
 * `field` names a child element to read instead, for the actions the C++
 * records as an info map rather than a bare value: `handle_look` carries
 * `destination`, `right_button` and `mods`, and `handle_target_space` carries
 * `destination` and `num_targets_left`. The fallback to the element's own text
 * is deliberate — it is what a recording made by *this* port used to write, and
 * what several of the C++'s older replays write too.
 */
export function locationFromAction(action: ReplayAction, field?: string): Location {
  const text = (field !== undefined ? action.info[field] : undefined) ?? action.text;
  const m = /^\s*\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?\s*$/.exec(text);
  if (m === null) throw new Error(`replay: '${action.type}' is not a location: "${text}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** `short_from_action`. */
export function numberFromAction(action: ReplayAction): number {
  const n = parseInt(action.text, 10);
  if (Number.isNaN(n)) throw new Error(`replay: '${action.type}' is not a number: "${action.text}"`);
  return n;
}

/** `str_to_bool` as the recorder writes it. */
export function boolFromAction(action: ReplayAction): boolean {
  const v = action.text.trim();
  return v === 'true' || v === 'yes' || v === '1';
}

export function locationText(where: { x: number; y: number }): string {
  return `(${where.x},${where.y})`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialise to the same document shape the C++ writes, so a replay recorded
 * here is at least *readable* there. (Running it there needs the startup
 * actions this port has no equivalent of — see `driver.ts`.)
 */
export function writeReplay(replay: Replay): string {
  let out = '<actions>\n';
  if (replay.scenario !== null) out += `    <scenario>${escapeXml(replay.scenario)}</scenario>\n`;
  if (replay.featureFlags !== null) {
    out += '    <feature_flags>\n';
    for (const [flag, versions] of Object.entries(replay.featureFlags)) {
      out += `        <${flag}>\n`;
      for (const v of versions) out += `            <version>${escapeXml(v)}</version>\n`;
      out += `        </${flag}>\n`;
    }
    out += '    </feature_flags>\n';
  }
  if (replay.seed !== null) out += `    <srand>${replay.seed}</srand>\n`;
  for (const action of replay.actions) {
    // The flag block is written above, from `featureFlags`, which keeps the
    // several versions a flag can carry. The action carries the same element
    // flattened to one string per flag, so writing it again would emit a second
    // block with every version dropped.
    if (action.type === 'feature_flags') continue;
    const children = Object.entries(action.info);
    if (children.length === 0) {
      out += action.text === ''
        ? `    <${action.type}/>\n`
        : `    <${action.type}>${escapeXml(action.text)}</${action.type}>\n`;
      continue;
    }
    out += `    <${action.type}>\n`;
    for (const [key, value] of children) {
      out += `        <${key}>${escapeXml(value)}</${key}>\n`;
    }
    out += `    </${action.type}>\n`;
  }
  return out + '</actions>\n';
}

/**
 * Read a replay. Deliberately tolerant about elements this port has never
 * heard of — an unknown action is kept in the list so the *driver* can decide
 * whether it can be run, rather than the parser rejecting whole files.
 */
export function parseReplay(root: Element): Replay {
  // `parseXmlDoc` hands back the root element, not the Document, so this takes
  // the same thing every other reader in `fileio/` does.
  if (root.nodeName !== 'actions') {
    throw new Error(`replay: expected an <actions> document, got <${root.nodeName}>`);
  }
  const replay: Replay = { seed: null, scenario: null, featureFlags: null, actions: [] };
  for (let node = root.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const text = elementText(el);
    if (el.nodeName === 'srand') {
      replay.seed = parseInt(text, 10);
      continue;
    }
    if (el.nodeName === 'scenario') {
      replay.scenario = text;
      continue;
    }
    if (el.nodeName === 'feature_flags') {
      // `<flag><version>a</version><version>b</version></flag>`, so each flag
      // carries a *list*. Still pushed as an action as well, since the C++
      // pops it off the same stream during startup.
      const flags: Record<string, string[]> = {};
      for (let f = el.firstChild; f !== null; f = f.nextSibling) {
        if (f.nodeType !== 1) continue;
        const flag = f as Element;
        const versions: string[] = [];
        for (let v = flag.firstChild; v !== null; v = v.nextSibling) {
          if (v.nodeType !== 1) continue;
          versions.push(elementText(v as Element));
        }
        flags[flag.nodeName] = versions;
      }
      replay.featureFlags = flags;
    }
    const info: Record<string, string> = {};
    for (let child = el.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      info[child.nodeName] = elementText(child as Element);
    }
    replay.actions.push({ type: el.nodeName, text: text.trim(), info });
  }
  return replay;
}

/** An element's own text, ignoring child elements' — `GetTextOrDefault("")`. */
function elementText(el: Element): string {
  let out = '';
  for (let node = el.firstChild; node !== null; node = node.nextSibling) {
    // Text (3) and CDATA (4); child elements contribute nothing.
    if (node.nodeType === 3 || node.nodeType === 4) out += node.nodeValue ?? '';
  }
  return out.trim();
}

/**
 * The pull side — `pop_next_action` (replay.cpp:255) with its two errors kept
 * word for word, since they are what a desync looks like.
 */
export class ReplaySource {
  private at: number;

  /**
   * `from` starts playback partway in, which is how the startup preamble is
   * skipped: `replayStartup` has already acted on those actions by choosing the
   * scenario and the save. Positions reported stay absolute, so an error still
   * names the action's place in the file.
   */
  constructor(private readonly actions: readonly ReplayAction[], from = 0) {
    this.at = from;
  }

  get exhausted(): boolean {
    return this.at >= this.actions.length;
  }

  /** How many actions have been consumed — the position a desync is reported at. */
  get position(): number {
    return this.at;
  }

  get length(): number {
    return this.actions.length;
  }

  /** `has_next_action(type)`: is the next one of this kind, without consuming it? */
  hasNext(type?: string): boolean {
    if (this.exhausted) return false;
    return type === undefined || this.actions[this.at]!.type === type;
  }

  peek(): ReplayAction | null {
    return this.actions[this.at] ?? null;
  }

  pop(expected?: string): ReplayAction {
    if (this.exhausted) throw new Error('Replay error! No action left to pop');
    const next = this.actions[this.at]!;
    if (expected !== undefined && next.type !== expected) {
      throw new Error(
        `Replay error! Expected '${expected}' action next` +
        ` (action ${this.at} is '${next.type}')`);
    }
    this.at++;
    return next;
  }
}
