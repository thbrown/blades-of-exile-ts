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

/**
 * BoE 1997's `button_strs` (DLOGTOOL.CPP:108, GPL), which E3's dialogs name
 * their buttons from: E3 has the same table up to 104 (it is in the EXE at
 * file offset 0x91c00).
 */
const E3_BUTTONS = [
  'Done', 'Ask', ' ', ' ', 'Keep', 'Cancel', '+', '-', 'Buy', 'Leave',
  'Get', '1', '2', '3', '4', '5', '6', 'Cast', ' ', ' ',
  ' ', ' ', ' ', 'Buy', 'Sell', 'Other Spells', 'Buy x10', ' ', ' ', 'Save',
  'Race', 'Train', 'Items', 'Spells', 'Heal Party', '1', '2', '3', '4', '5',
  '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
  '16', 'Take', 'Create', 'Delete', 'Race/Special', 'Skill', 'Name', 'Graphic', 'Bash Door', 'Pick Lock',
  'Leave', 'Steal', 'Attack', 'OK', 'Yes', 'No', 'Step In', ' ', 'Record', 'Climb',
  'Flee', 'Onward', 'Answer', 'Drink', 'Approach', 'Mage Spells', 'Priest Spells', 'Advantages', 'New Game', 'Land',
  'Under', 'Restore', 'Restart', 'Quit', 'Save First', 'Just Quit', 'Rest', 'Read', 'Pull', 'Alchemy',
  '17', 'Push', 'Pray', 'Wait', '', '', 'Delete', 'Graphic', 'Create', 'Give',
  'Destroy', 'Pay', 'Free', 'Next Tip', 'Touch',
];

/** The engine's `Status.DISEASE`, the `ex1c` of an AFFECT_STATUS node. */
const STATUS_DISEASE = 7;
const STATUS_POISON = 2;
/** The engine's `SpellPat.SQUARE`, a 3×3 block. */
export const PAT_SQUARE = 1;

/** Roughly how much text fits in one dialog on the engine's screen. */
const PAGE = 700;

export interface ScriptSource {
  strings: Map<number, string>;
  dialogs: Map<number, E3Dialog>;
  /** The town's creatures, by slot, for `bringIn`. */
  creatures?: { number: number; spec1: number }[];
  /** The engine's number for E3's horse `k` (`vehicleNumbers`). */
  horse?: (k: number) => number;
  /** The NUL-terminated string at `seg:off` in the EXE (a Ghidra address). */
  exeString?: (seg: number, off: number) => string;
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

  /** A node number to fill in later, for a chain that loops back. */
  private reserve(): number {
    this.nodes.push('');
    return this.nodes.length - 1;
  }

  private fill(n: number, op: string, f: NodeFields, goto: number): void {
    const text = this.node(op, f, goto);
    this.nodes[n] = this.nodes.pop()!.replace(`= ${text}\n`, `= ${n}\n`);
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
      .map((c) => E3_BUTTONS[Number(c.text.split('_')[1])] || 'OK');
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
  askDialog(id: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const { pages, buttons } = this.dialogPages(id);
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.leadPages(pages, this.node('once-dlog', {
        msg: [pages[pages.length - 1]!, -1, 1], ex1: [this.buttonIndex(buttons[1] ?? 'OK'), yes],
      }, no));
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
  ifDayReached(day: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-day', { ex1: [day, yes] }, no);
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

  /** `if (the living PCs' skill totals at least value) { then } else { otherwise }`. */
  ifSkillTotal(skill: number, value: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-statistic', { ex1: [value, yes], ex2: [skill, 0] }, no);
    };
  }

  /** `FUN_10b0_366a`: every PC learns spell `s` (priest spell `s - 100` from 100). */
  teachSpell(s: number): Step {
    return (next) => s >= 100
      ? this.node('spell-priest', { ex1: [s - 100, 0] }, next)
      : this.node('spell-mage', { ex1: [s, 0] }, next);
  }

  /**
   * `FUN_1040_2c2d`: where the party comes out when it leaves town, given
   * as E3 does, a zone and a square in the 2×2 window whose corner it is.
   * That is `TOWN_RELOCATE`, whose opcode is `set-sector`; `relocate` is
   * `TOWN_RELOCATE_CREATURE`, which moves a monster.
   */
  exitTo(zx: number, zy: number, x: number, y: number): Step {
    return (next) => this.node('set-sector', {
      ex1: [zx + Math.floor(x / 48), zy + Math.floor(y / 48)], ex2: [x % 48, y % 48],
    }, next);
  }

  /**
   * `FUN_10e0_03ae(7, flag, dlg, kind)`: a trapped container, once. It is
   * BoE 1997's `run_trap` behind an E3 dialog: the party picks who disarms,
   * `kind` 0 is a random trap, and 20 more is a trap three times as strong.
   * Two differences: kind 5 does nothing (BoE's is a sleep ray), and kinds 8
   * and 11 are harder by 10.
   * TODO(E3-3): check kinds 10 and 11 (`FUN_10b0_16e6`, `FUN_1070_23b9`)
   * against BoE's dumbfound and disease.
   */
  trap(id: number, flag: Flag, kind: number): Step {
    return (next) => {
      const { pages } = this.dialogPages(id);
      const strong = kind >= 20;
      const k = strong ? kind - 20 : kind;
      return this.node('once-trap', {
        sdf: flag, msg: [pages[pages.length - 1]!, -1],
        ex1: [k === 5 ? 6 : k, strong ? 2 : 0], ex2: [k === 8 || k === 11 ? 10 : 0],
      }, next);
    };
  }

  /** `FUN_10b0_958e(n, type)`: every living PC takes `n` damage of `type`. */
  damageAll(n: number, type: number): Step {
    return (next) => this.node('damage', { ex1: [0, 1], ex2: [n, type] }, next);
  }

  xp(n: number): Step {
    return (next) => this.node('xp', { ex1: [n, 0] }, next);
  }

  /**
   * `while (FUN_1070_079e(cls)) { body }`: take items of class `cls` one at
   * a time, running `body` for each, then go on. (E3 names the class by
   * `type_flag`, which the converter copies into the item's special class.)
   */
  eachItemOfClass(cls: number, body: Step[]): Step {
    return (next) => {
      const check = this.reserve();
      const loop = this.seq(body)(check);
      this.fill(check, 'if-item-class', { ex1: [cls, loop], ex2: [1] }, next);
      return check;
    };
  }

  /**
   * `FUN_10c0_443a(block, i, block, j, group, flag, spot)`: once, a message
   * and the zone's special encounter `group`. E3 places the group on its
   * marker spot (encounter number `50 + k`); the engine's node places it by
   * the party, which is a step or two away.
   */
  onceEncounter(flag: Flag, block: number, a: number, b: number, group: number): Step {
    return (next) => this.node('once-out-encounter', {
      sdf: flag, msg: [this.e3(block, a), b > 0 ? this.e3(block, b) : -1], ex1: [group],
    }, next);
  }

  gold(n: number): Step {
    return (next) => this.node('gold', { ex1: [n, 0] }, next);
  }

  food(n: number): Step {
    return (next) => this.node('food', { ex1: [n, 0] }, next);
  }

  /**
   * `FUN_1070_0564`: the party is given `item` (the first PC with room);
   * `then` runs if it was taken and `otherwise` if nobody had room.
   */
  giveItem(item: number, then: Step[] = [], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('once-give-item', { ex1: [item, 0], ex2: [0, no] }, yes);
    };
  }

  /**
   * The reply to a scripted talk node (`FUN_1020_2eb0`): strings `4500 + a`
   * and `4500 + b`. A message node run from a conversation becomes its reply.
   */
  reply(a: number, b = 0): Step {
    return this.msg(15, a, b);
  }

  /** `can_find_town[t] = 1`: town `t` shows on the map. */
  townVisible(t: number): Step {
    return (next) => this.node('town-visible', { ex1: [t], ex2: [1] }, next);
  }

  /**
   * A node that clears `flags` at the start of every day, for a scenario
   * `<timer>` of 3700 ticks: a scenario timer fires once, so the node rearms
   * itself as a party timer each time.
   */
  dailyReset(flags: Flag[]): number {
    const clear = this.seq(flags.map((f) => this.setFlag(f, 0)))(-1);
    const self = this.nodes.length;
    return this.node('start-timer-scen', { ex1: [3700, self] }, clear);
  }

  /** `FUN_1080_1b1f`: terrains `a` and `b` trade places at `(x, y)`. */
  swapTer(x: number, y: number, a: number, b: number): Step {
    return (next) => this.node('swap-ter', { ex1: [x, y], ex2: [a, b] }, next);
  }

  /** `if (terrain at (x, y) == t) { then } else { otherwise }`. */
  ifTer(x: number, y: number, t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-ter', { ex1: [x, y], ex2: [t, yes] }, no);
    };
  }

  /**
   * `FUN_1070_0623(n, 1)`: take `n` gold if the party has it, and run
   * `then`; otherwise run `otherwise`. (The engine's node also says "You give
   * up n gold.", which E3 does not.)
   */
  pay(n: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-gold', { ex1: [n, yes], ex2: [1] }, no);
    };
  }

  /**
   * `FUN_10b0_183a(pc, n)` for every PC: BoE 1997's `disease_pc` (the save
   * against level, frailty, sound 66), which is the engine's own.
   */
  diseaseAll(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_DISEASE] }, next);
  }

  /** `FUN_10b0_933f(pc, n)` for every PC: BoE 1997's `poison_pc`, the engine's own. */
  poisonAll(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_POISON] }, next);
  }

  /** Every PC's disease cleared (E3 zeroes the status word directly). */
  cureDiseaseAll(): Step {
    return (next) => this.node('status', { ex1: [8, 0, STATUS_DISEASE] }, next);
  }

  /**
   * `FUN_10c0_4a61(t, x, y)`: the party goes into town `t` at `(x, y)`,
   * without a word. The engine's `TOWN_GENERIC_STAIR` (opcode
   * `button-generic`) with `ex2b` 8 asks nothing, and `ex2c` 3 lets it run
   * from Use and talk as well as a step (still not in combat). It ends the
   * chain, so it must be a script's last step.
   */
  changeTown(t: number, x: number, y: number): Step {
    return () => this.node('button-generic', { ex1: [x, y], ex2: [t, 8, 3] }, -1);
  }

  /**
   * `FUN_1090_4053(code, attitude)`: the creatures whose `spec1` is `code`
   * (200–204, which start absent: `emit.ts`) come in, with `attitude`, or 3
   * for monsters 149–154. The engine's `ONCE_TOWN_ENCOUNTER` brings in the
   * group whose encounter code is `code`, and a `TOWN_SET_ATTITUDE` per slot
   * gives each its attitude.
   * TODO(E3-3): E3 clears each creature's code, so a second call does
   * nothing; the engine's preset keeps its code and could bring one back.
   */
  bringIn(code: number, attitude: number): Step {
    return (next) => {
      const slots = (this.src.creatures ?? []).flatMap((c, i) => (c.number > 0 && c.spec1 === code ? [i] : []));
      const set = slots.reduceRight((after, i) => {
        const n = this.src.creatures![i]!.number;
        return this.node('set-attitude', { ex1: [i, n > 0x94 && n < 0x9b ? 3 : attitude] }, after);
      }, next);
      return this.node('once-town-encounter', { ex1: [code] }, set);
    };
  }

  /**
   * `FUN_10d0_4c8d`: a line in the text area. E3's few literal strings live
   * in its code segments, so they are named by address, as Ghidra gives it.
   */
  log(seg: number, off: number): Step {
    return (next) => this.node('disp-sm-msg', { msg: [this.text(this.src.exeString?.(seg, off) ?? '')] }, next);
  }

  /**
   * `for (i = 0; i < 6; i++) { body(i) }`, each round aimed at PC `i` alone:
   * `SELECT_TARGET` with `ex1a` 10 + i, an exile-js extension, picks the PC
   * without asking. The party is the target again afterwards. The engine
   * runs the body on empty slots too, where E3 tests `main_status > 0`; an
   * empty slot's numbers are never seen.
   */
  eachPc(body: (pc: number) => Step[]): Step {
    return (next) => {
      const done = this.node('select-pc', { ex1: [2] }, next);
      return [0, 1, 2, 3, 4, 5].reduceRight(
        (after, pc) => this.node('select-pc', { ex1: [10 + pc] }, this.seq(body(pc))(after)), done);
    };
  }

  /**
   * Adds `n` (which may be negative) to the target's `skill` (the engine's
   * `Skill`), clamped as the engine clamps. `pic` 101 makes it certain.
   */
  addStat(skill: number, n: number): Step {
    return (next) => this.node('statistic', { pic: [101, 4], ex1: [Math.abs(n), n < 0 ? 1 : 0], ex2: [skill] }, next);
  }

  /** `if (the target's skill >= value) { then } else { otherwise }`. */
  ifStat(skill: number, value: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-statistic', { ex1: [value, yes], ex2: [skill, -1] }, no);
    };
  }

  /** `while (the target's skill >= value) { body }`. */
  whileStat(skill: number, value: number, body: Step[]): Step {
    return (next) => {
      const check = this.reserve();
      const loop = this.seq(body)(check);
      this.fill(check, 'if-statistic', { ex1: [value, loop], ex2: [skill, -1] }, next);
      return check;
    };
  }

  /** Every PC forgets mage spell `s` (the target's, after `eachPc`). */
  forgetSpell(s: number): Step {
    return (next) => this.node('spell-mage', { ex1: [s, 1] }, next);
  }

  /**
   * `FUN_1070_23b9`: BoE 1997's `make_town_hostile`, every creature turns on
   * the party. E3's own also makes certain monsters (12–20, 91–98, 149–154)
   * guards, and ends the game in a few towns (21, 28, 34, 40, 41, 47, 107).
   * TODO(E3-3): those towns' endings, and E3's guards (the engine boosts the
   * monsters marked guard instead).
   */
  makeTownHostile(): Step {
    return (next) => this.node('town-attitude', { ex1: [0, -1], ex2: [1] }, next);
  }

  /** `FUN_1080_1b76(x, y, t)`: the terrain at `(x, y)` becomes `t`. */
  setTer(x: number, y: number, t: number): Step {
    return (next) => this.node('change-ter', { ex1: [x, y], ex2: [t] }, next);
  }

  /**
   * BoE 1997's `place_spell_pattern(pat, spot, 50 + dice + 40 * type, 0, 7)`
   * (E3 calls it through `FUN_1018_99f2(spot, dice)` for fire): `dice` d6 of
   * damage `type` over `pattern` (the engine's `SpellPat`), centred on the
   * spot the script runs at.
   */
  patternBoom(pattern: number, type: number, dice: number): Step {
    return (next) => this.node('spell-pat-boom', { ex1: [-1, -1, pattern], ex2: [type, dice, 1] }, next);
  }

  /** E3's horse `k` becomes the party's (its `property` byte cleared). */
  giveHorse(k: number): Step {
    const n = this.src.horse?.(k) ?? k;
    if (n < 0) throw new Error(`E3 horse ${k} is not placed anywhere`);
    return (next) => this.node('change-horse', { ex1: [n], ex2: [1] }, next);
  }

  /**
   * `switch (flag) { case 0: … case n-1: }` over `cases`, for the scripts
   * that index a table by a counter (the horse dealers).
   */
  switchFlag(flag: Flag, cases: Step[][]): Step {
    return cases.reduceRight<Step>((otherwise, then, v) => this.ifFlagEq(flag, v, then, [otherwise]), (next) => next);
  }

  /**
   * `FUN_10c0_46a4(x, y, 1)`: the party moves to `(x, y)` in this town,
   * with no fade (`TOWN_MOVE_PARTY`, `ex2a` 0). It refuses the step, as E3's
   * callers do.
   */
  moveParty(x: number, y: number): Step {
    return (next) => this.node('move-party', { ex1: [x, y], ex2: [0] }, next);
  }

  /** `if (in_horse > 0) { then } else { otherwise }`: riding any horse. */
  ifOnHorse(then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-horse', { ex1: [-1, -1, yes] }, no);
    };
  }

  /** The party learns alchemy recipe `k` (`party.alchemy[k] = 1`, party+0x831e). */
  learnAlchemy(k: number): Step {
    return (next) => this.node('alchemy', { ex1: [k, 0] }, next);
  }

  /** `if (FUN_10b0_302f() >= value)`: the living PCs' levels, added up. */
  ifLevelTotal(value: number, then: Step[], otherwise: Step[] = []): Step {
    return this.ifSkillTotal(104, value, then, otherwise);
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

/** A zone's flag for its own spot `id` (`2000 + zone*10 + id`, party+0x854 on). */
export function zoneSpotFlag(zone: number, id: number): Flag {
  return e3Flag(200 + zone, id);
}
