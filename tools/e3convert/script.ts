/**
 * A builder for the special nodes that stand in for Exile 3's scripts. E3's
 * encounters are C code in EXILE3.EXE. E3-3 transcribes them, a town at a
 * time (`towns/`), into chains of the engine's own nodes.
 *
 * A script is a list of **steps**. Each step is compiled with the node that
 * comes after it, so a chain reads top to bottom as the C does, and an `if`
 * wraps the steps it guards. Text is never written here: steps name E3's own
 * strings and dialogs by number. The converter looks them up in the user's
 * copy and appends them to the town's string list, so the committed scripts
 * hold no game text.
 */

import type { E3Dialog } from './ne';
import { e3Flag } from './flags';

export type Flag = [row: number, col: number];

/** A step: given the node to continue with, returns its own first node. */
export type Step = (next: number) => number;

interface NodeFields {
  sdf?: Flag;
  msg?: [number, number?, number?];
  pic?: [number, number];
  ex1?: [number, number?, number?];
  ex2?: [number, number?, number?];
}

/** BoE 1997's `button_strs`, which E3's dialogs name their buttons from. */
const E3_BUTTONS: Record<number, string> = {
  9: 'Leave', 51: 'Take', 60: 'Leave', 61: 'Steal', 62: 'Attack', 63: 'OK', 64: 'Yes', 65: 'No',
  66: 'Step In', 69: 'Climb', 70: 'Flee', 71: 'Onward', 72: 'Answer', 73: 'Drink', 74: 'Approach',
  86: 'Rest', 87: 'Read', 88: 'Pull', 91: 'Push', 92: 'Pray', 93: 'Wait', 99: 'Give',
  100: 'Destroy', 101: 'Pay', 102: 'Free', 104: 'Touch', 129: 'Burn', 130: 'Insert',
  131: 'Remove', 132: 'Accept', 133: 'Refuse', 134: 'Open', 135: 'Close', 136: 'Sit', 137: 'Stand',
};

/** Roughly how much text fits in one dialog on the engine's screen. */
const PAGE = 700;

export interface ScriptSource {
  strings: Map<number, string>;
  dialogs: Map<number, E3Dialog>;
}

export class SpecBuilder {
  private nodes: string[] = [];
  readonly strings: string[] = [];

  constructor(private src: ScriptSource, private buttonIndex: (label: string) => number) {}

  get spec(): string {
    return this.nodes.join('');
  }

  /** Adds a string of the town's, returning its index. */
  text(s: string): number {
    this.strings.push(s.replace(/_/g, '"'));
    return this.strings.length - 1;
  }

  /** E3 string `block * 300 + idx`, as `FUN_10d0_523c` fetches it. */
  e3(block: number, idx: number): number {
    return this.text(this.src.strings.get(block * 300 + idx) ?? '');
  }

  /** A node, returning its number. */
  node(op: string, f: NodeFields, goto: number): number {
    const n = this.nodes.length;
    const three = (v: [number, number?, number?] | undefined) =>
      `${v?.[0] ?? -1}, ${v?.[1] ?? -1}, ${v?.[2] ?? -1}`;
    this.nodes.push(`@${op} = ${n}
\tsdf ${f.sdf?.[0] ?? -1}, ${f.sdf?.[1] ?? -1}
\tmsg ${three(f.msg)}
\tpic ${f.pic?.[0] ?? 0}, ${f.pic?.[1] ?? 4}
\tex1 ${three(f.ex1)}
\tex2 ${three(f.ex2)}
\tgoto ${goto}
`);
    return n;
  }

  /** Runs steps in order, then `next`. */
  seq(steps: Step[]): Step {
    return (next) => steps.reduceRight((after, step) => step(after), next);
  }

  /** Compiles a whole script, which ends the chain. */
  compile(steps: Step[]): number {
    const entry = this.seq(steps)(-1);
    // An empty script still needs a node to point the spot at.
    return entry >= 0 ? entry : this.node('nop', {}, -1);
  }

  // ------------------------------------------------------------ steps

  /** `FUN_1008_37de` / `FUN_1008_3812`: one or two strings of a block. */
  msg(block: number, a: number, b = 0): Step {
    return (next) => this.node('disp-msg', { msg: [this.e3(block, a), b > 0 ? this.e3(block, b) : -1] }, next);
  }

  /** `FUN_10e0_0044`: the same, once, marked by `flag`. */
  onceMsg(flag: Flag, block: number, a: number, b = 0): Step {
    return (next) => this.node('once-disp-msg', { sdf: flag, msg: [this.e3(block, a), b > 0 ? this.e3(block, b) : -1] }, next);
  }

  setFlag(flag: Flag, value: number): Step {
    return (next) => this.node('set-sdf', { sdf: flag, ex1: [value] }, next);
  }

  /** `if (flag == value) { then }`. */
  ifFlagEq(flag: Flag, value: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-sdf-eq', { sdf: flag, ex1: [value, yes] }, no);
    };
  }

  /** `if (flag >= value) { then } else { otherwise }`. */
  ifFlagAtLeast(flag: Flag, value: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-sdf', { sdf: flag, ex1: [value, yes] }, no);
    };
  }

  /**
   * The text controls of dialog `id`, top to bottom, as runs of consecutive
   * strings. E3's dialogs are bigger than the engine's screen allows, so a
   * long one becomes pages of about `PAGE` characters (and at most six
   * paragraphs, all a node shows), each shown in turn.
   */
  private dialogPages(id: number): { pages: number[]; buttons: string[] } {
    const d = this.src.dialogs.get(id);
    if (!d) throw new Error(`E3 dialog ${id} not found`);
    const texts = d.controls.filter((c) => !/^\d+_\d+$/.test(c.text)).sort((a, b) => a.y - b.y || a.x - b.x);
    const buttons = d.controls.filter((c) => /^[01]_\d+$/.test(c.text)).sort((a, b) => a.id - b.id)
      .map((c) => E3_BUTTONS[Number(c.text.split('_')[1])] ?? 'OK');
    const groups: string[][] = [[]];
    let size = 0;
    for (const t of texts) {
      const cur = groups[groups.length - 1]!;
      if (cur.length > 0 && (size + t.text.length > PAGE || cur.length === 6)) {
        groups.push([]);
        size = 0;
      }
      groups[groups.length - 1]!.push(t.text);
      size += t.text.length;
    }
    // A node always reads six strings from its first, so each page is
    // padded to six with blanks.
    const pages = groups.map((g) => {
      const first = this.strings.length;
      for (let i = 0; i < 6; i++) this.text(g[i] ?? '');
      return first;
    });
    return { pages, buttons };
  }

  /** All but the last page, as plain dialogs leading to `last`. */
  private leadPages(pages: number[], last: number): number {
    return pages.slice(0, -1).reduceRight((after, first) => this.node('once-dlog', { msg: [first, -1, 1] }, after), last);
  }

  /** `FUN_1070_31cd` for a dialog with only an OK. */
  dialog(id: number): Step {
    return (next) => {
      const { pages } = this.dialogPages(id);
      return this.leadPages(pages, this.node('once-dlog', { msg: [pages[pages.length - 1]!, -1, 1] }, next));
    };
  }

  /**
   * `FUN_10e0_00ec`: dialog `id` offers `item` with Leave and Take, once,
   * marked by `flag`. `reward` adds food (1000–1999), gold (2000–2999) or a
   * special item (300–399).
   */
  giveItemDialog(id: number, flag: Flag, item: number, reward = 0): Step {
    return (next) => {
      const { pages } = this.dialogPages(id);
      const gold = reward >= 2000 && reward < 3000 ? reward - 2000 : 0;
      const food = reward >= 1000 && reward < 2000 ? reward - 1000 : 0;
      const special = reward >= 300 && reward < 400 ? reward - 300 : -1;
      const last = this.node('once-give-dlog', {
        sdf: flag, msg: [pages[pages.length - 1]!, -1, special], ex1: [item > 0 ? item : -1, gold], ex2: [food, next],
      }, next);
      // A second visit must not replay the lead pages: guard them by the flag.
      const lead = this.leadPages(pages, last);
      return lead === last ? last : this.node('if-sdf', { sdf: flag, ex1: [250, next] }, lead);
    };
  }

  /**
   * A two-button dialog (`FUN_10e0_0097` and friends): the first button is
   * the way out, and the second runs `then`.
   */
  askDialog(id: number, then: Step[]): Step {
    return (next) => {
      const { pages, buttons } = this.dialogPages(id);
      const yes = this.seq(then)(next);
      return this.leadPages(pages, this.node('once-dlog', {
        msg: [pages[pages.length - 1]!, -1, 1], ex1: [this.buttonIndex(buttons[1] ?? 'OK'), yes],
      }, next));
    };
  }

  heal(amount: number): Step {
    return (next) => this.node('hp', { ex1: [amount] }, next);
  }

  restoreSp(amount: number): Step {
    return (next) => this.node('sp', { ex1: [amount, 0] }, next);
  }

  addAge(ticks: number): Step {
    return (next) => this.node('change-time', { ex1: [ticks] }, next);
  }

  /** `if (flag < value) { then } else { otherwise }`. */
  ifFlagBelow(flag: Flag, value: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-sdf', { sdf: flag, ex1: [-1, -1], ex2: [value, yes] }, no);
    };
  }

  /** `if (a > b) { then }`, two flags compared. */
  ifFlagGreater(a: Flag, b: Flag, then: Step[]): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      return this.node('if-sdf-compare', { sdf: a, ex1: [b[0], b[1]], ex2: [-1, yes] }, next);
    };
  }

  /** `if (calc_day() >= day) { then }`. */
  ifDayReached(day: number, then: Step[]): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      return this.node('if-day', { ex1: [day, yes] }, next);
    };
  }

  /** `if (the party has special item k) { then } else { otherwise }`. */
  ifSpecItem(k: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-spec-item', { ex1: [k, yes] }, no);
    };
  }

  giveSpecItem(k: number): Step {
    return (next) => this.node('once-give-spec-item', { ex1: [k, 0] }, next);
  }

  takeSpecItem(k: number): Step {
    return (next) => this.node('once-give-spec-item', { ex1: [k, 1] }, next);
  }

  incFlag(flag: Flag): Step {
    return (next) => this.node('inc-sdf', { sdf: flag, ex1: [1, 0] }, next);
  }

  copyFlag(to: Flag, from: Flag): Step {
    return (next) => this.node('copy-sdf', { sdf: to, ex1: [from[0], from[1]] }, next);
  }

  /** Refuses the step onto the spot (the town handler returning 0). */
  blockMove(): Step {
    return (next) => this.node('block-move', { ex1: [1] }, next);
  }
}

/** A town's flag for its own spot `id` (`t*10 + id`), as the handlers address it. */
export function townSpotFlag(town: number, id: number): Flag {
  return e3Flag(town, id);
}

/** Party-record byte `offset` as a flag (party+0x84 is flag 0). */
export function partyFlag(offset: number): Flag {
  return e3Flag(0, offset - 0x84);
}

/** Party-record word `offset` as a special item (party+0xc is item 0). */
export function partySpecItem(offset: number): number {
  return (offset - 0xc) / 2;
}
