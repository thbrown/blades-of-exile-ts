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
import { DamageType } from '../../src/data/monster';
import { FieldType } from '../../src/data/fields';
import { e3Event, e3Flag } from './flags';
import { E3ShopType } from './shops';

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

/** E3's split-party flag, party+0xc64 (`FUN_10e0_0806` sets it). */
const SPLIT: Flag = e3Flag(0, 0xc64 - 0x84);

/** The engine's `Status.DISEASE`, the `ex1c` of an AFFECT_STATUS node. */
/** BoE's trap types (`eTrapType`) that E3's kinds become. */
const TRAP_ALERT = 8;
const TRAP_CUSTOM = 13;
const STATUS_DISEASE = 7;
const STATUS_POISON = 2;
const STATUS_DUMB = 9;
const STATUS_CURSE = 1;
const STATUS_SLOW = 3;
const STATUS_PARALYZED = 12;
const STATUS_ASLEEP = 11;
/** The engine's `SpellPat.SQUARE`, a 3×3 block. */
export const PAT_SQUARE = 1;

/** Roughly how much text fits in one dialog on the engine's screen. */
const PAGE = 700;

export interface ScriptSource {
  strings: Map<number, string>;
  dialogs: Map<number, E3Dialog>;
  /** The town's terrain as converted, `[x][y]`, for `replaceTerrain`. */
  terrain?: number[][];
  /** The town's creatures, by slot, for `bringIn` and the kill scripts. */
  creatures?: { number: number; spec1: number; spec2: number; mobile?: number; startLoc?: { x: number; y: number } }[];
  /**
   * Adds a string to the *scenario's* list, returning its index: a few
   * nodes (IF_NUM_RESPONSE's prompt) read theirs from there, wherever they run.
   */
  scenString?: (s: string) => number;
  /** The engine's number for E3's horse `k` (`vehicleNumbers`). */
  horse?: (k: number) => number;
  /** The NUL-terminated string at `seg:off` in the EXE (a Ghidra address). */
  exeString?: (seg: number, off: number) => string;
  /**
   * Builds a chain in the *scenario's* specials with the scenario's own
   * builder, returning its first node: for scenario timers a town starts.
   */
  scenNode?: (build: (s: SpecBuilder) => number) => number;
  /** The engine's item for E3's `item` given readable `ability` (`notes.ts`). */
  noteItem?: (item: number, ability: number) => number;
  /** The engine's item for E3's `item` given some other `ability` (`notes.ts`, `e3StampedItems`). */
  stampedItem?: (item: number, ability: number) => number;
  /** Spot `id`'s own converter flag (`e3SpotFlag`), for `eraseSpot`. */
  spotFlag?: (id: number) => Flag;
  /**
   * The node picture `[pic, pictype]` for a dialog's picture tag `5_n`
   * (1997's `draw_dialog_graphic` numbering), or undefined to keep the
   * default. See `e3DialogPic` in emit.ts.
   */
  dialogPic?: (tag: number) => [number, number] | undefined;
  /**
   * The picture a zone's special encounter `group` meets the party with: its
   * first monster's (`FUN_10c0_443a` passes `400 +` that monster's sprite).
   */
  encounterPic?: (group: number) => [number, number] | undefined;
  /** Where this place's spot `id` is (`FUN_10e0_07b7`), for scripts that test its square. */
  spotLoc?: (id: number) => { x: number; y: number } | undefined;
  /** The engine's number for an E3 shop (`E3TalkConversion.shop`). */
  shop?: (type: E3ShopType, first: number, last: number, title: string) => number;
}

/** The dialog tag a block message shows: see `SpecBuilder.msg`. */
export const MSG_PIC = 0x2c4;
/** Anaximander's reports, block 14 (`FUN_1008_386f`), show his sprite. */
export const ANAX_PIC = 0x1af;

function msgPic(block: number): number {
  return block === 0xe ? ANAX_PIC : MSG_PIC;
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

  /**
   * A loop: `body` runs, and wherever it places `again` control returns to
   * its start. (The start is a `nop` node, filled in once the body exists.)
   */
  loop(body: (again: Step) => Step[]): Step {
    return (next) => {
      const head = this.reserve();
      this.fill(head, 'nop', {}, this.seq(body(() => head))(next));
      return head;
    };
  }

  /** Compiles a whole script, which ends the chain. */
  compile(steps: Step[]): number {
    const entry = this.seq(steps)(-1);
    // An empty script still needs a node to point the spot at.
    return entry >= 0 ? entry : this.node('nop', {}, -1);
  }

  // ------------------------------------------------------------ steps

  /**
   * `FUN_1008_37de` / `FUN_1008_3812`: one or two strings of a block. The
   * picture is a dialog tag, and the message routine chooses it: dialog
   * picture 8 (`0x2c4`) for these, and Anaximander's sprite (`0x1af`) for
   * his reports, block 14 (`FUN_1008_386f`). A few scripts call the dialog
   * directly with a picture of their own, and pass it. The engine shows it
   * under the `message-pics` flag. The routine's last argument is a sound,
   * 57 but for a handful, which the engine plays under `message-sounds`.
   */
  msg(block: number, a: number, b = 0, pic = msgPic(block), sound = 57): Step {
    return (next) => this.node('disp-msg', {
      msg: [this.e3(block, a), b > 0 ? this.e3(block, b) : -1], pic: this.src.dialogPic?.(pic),
      ex2: [-1, -1, sound === 57 ? -1 : sound],
    }, next);
  }

  /** `FUN_10e0_0044`: the same, once, marked by `flag` — through `FUN_1008_3812`, so picture 8. */
  onceMsg(flag: Flag, block: number, a: number, b = 0, sound = 57): Step {
    return (next) => this.node('once-disp-msg', {
      sdf: flag, msg: [this.e3(block, a), b > 0 ? this.e3(block, b) : -1], pic: this.src.dialogPic?.(msgPic(block)),
      ex2: [-1, -1, sound === 57 ? -1 : sound],
    }, next);
  }

  /**
   * `FUN_1008_3780(e)`: events-journal entry `e`, dated today, with "Something
   * was added to your journal." The engine's `journal` opcode is an exile-js
   * one (`SpecType.ADD_JOURNAL`); the text is the scenario's `<journal>`.
   */
  journal(e: number): Step {
    return (next) => this.node('journal', { ex1: [e] }, next);
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
  private dialogPages(id: number): { pages: number[]; buttons: string[]; pic?: [number, number] } {
    const d = this.src.dialogs.get(id);
    if (!d) throw new Error(`E3 dialog ${id} not found`);
    // The dialog's picture: its first `5_n` control. A node shows one, and
    // twenty of E3's dialogs have two.
    const tag = d.controls.filter((c) => /^5_\d+$/.test(c.text)).sort((a, b) => a.id - b.id)[0];
    const pic = tag ? this.src.dialogPic?.(Number(tag.text.slice(2))) : undefined;
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
    return { pages, buttons, ...(pic ? { pic } : {}) };
  }

  /** All but the last page, as plain dialogs leading to `last`. */
  private leadPages(pages: number[], last: number, pic?: [number, number]): number {
    return pages.slice(0, -1).reduceRight((after, first) => this.node('once-dlog', { msg: [first, -1, 1], pic }, after), last);
  }

  /** `FUN_1070_31cd` for a dialog with only an OK. */
  dialog(id: number): Step {
    return (next) => {
      const { pages, pic } = this.dialogPages(id);
      return this.leadPages(pages, this.node('once-dlog', { msg: [pages[pages.length - 1]!, -1, 1], pic }, next), pic);
    };
  }

  /**
   * `FUN_10e0_00ec`: dialog `id` offers `item` with Leave and Take, once,
   * marked by `flag`. `reward` adds food (1000–1999), gold (2000–2999) or a
   * special item (300–399).
   */
  giveItemDialog(id: number, flag: Flag, item: number, reward = 0): Step {
    return (next) => {
      const { pages, pic } = this.dialogPages(id);
      const gold = reward >= 2000 && reward < 3000 ? reward - 2000 : 0;
      const food = reward >= 1000 && reward < 2000 ? reward - 1000 : 0;
      const special = reward >= 300 && reward < 400 ? reward - 300 : -1;
      const last = this.node('once-give-dlog', {
        sdf: flag, msg: [pages[pages.length - 1]!, -1, special], ex1: [item > 0 ? item : -1, gold], ex2: [food, next], pic,
      }, next);
      // A second visit must not replay the lead pages: guard them by the flag.
      const lead = this.leadPages(pages, last, pic);
      return lead === last ? last : this.node('if-sdf', { sdf: flag, ex1: [250, next] }, lead);
    };
  }

  /**
   * A two-button dialog (`FUN_10e0_0097` and friends): the first button is
   * the way out, and the second runs `then`.
   */
  askDialog(id: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const { pages, buttons, pic } = this.dialogPages(id);
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.leadPages(pages, this.node('once-dlog', {
        msg: [pages[pages.length - 1]!, -1, 1], ex1: [this.buttonIndex(buttons[1] ?? 'OK'), yes], pic,
      }, no), pic);
    };
  }

  /**
   * A three-button dialog (`FUN_1070_31cd` read as 1, 2 or 3): the first
   * button is the way out and runs `first`, the second runs `second` and
   * the third `third`.
   */
  choiceDialog(id: number, second: Step[], third: Step[], first: Step[] = []): Step {
    return (next) => {
      const { pages, buttons, pic } = this.dialogPages(id);
      const two = this.seq(second)(next);
      const three = this.seq(third)(next);
      const one = this.seq(first)(next);
      return this.leadPages(pages, this.node('once-dlog', {
        msg: [pages[pages.length - 1]!, -1, 1],
        ex1: [this.buttonIndex(buttons[1] ?? 'OK'), two],
        ex2: [this.buttonIndex(buttons[2] ?? 'OK'), three], pic,
      }, one), pic);
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

  /**
   * E3's own `day_reached(day, event)` (`FUN_10d0_54b8`): true once
   * `calc_day() >= day + 20`, unless plot event `event` happened *before*
   * that day. An event that never happened (key time 30000) stops nothing,
   * and event 8 is none. The engine's IF_EVENT_OCCURRED reads an unset event
   * as "no" (DIVERGENCES.md #9), so the test is built from two of them:
   * "happened no earlier than the day", else "happened at all".
   */
  ifE3DayReached(day: number, event: number, then: Step[], otherwise: Step[] = []): Step {
    const d = day + 20;
    if (event === 8) return this.ifDayReached(d, then, otherwise);
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      const key = e3Event(event);
      const happenedAtAll = this.node('if-event', { ex1: [0, key], ex2: [-1, no] }, yes);
      const notBefore = this.node('if-event', { ex1: [d, key], ex2: [-1, yes] }, happenedAtAll);
      return this.node('if-day', { ex1: [d, notBefore] }, no);
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
   * Kinds 1–4, 7 and 9 are 1997's; 5 and 6 do nothing, as in 1997. The rest
   * are E3's own (10e0:06cf on), and 8 and 11 are harder by 10:
   *   - 8 wakes the town's hostile creatures (attitude 1, `active` 2) under
   *     "An alarm goes off!!!", where 1997's turns the town hostile: a custom
   *     trap, whose chain does it;
   *   - 10 dumbfounds all six by 2 (`FUN_10b0_16e6`, 1997's `dumbfound_pc`),
   *     however strong the trap, where 1997's adds twice the level;
   *   - 11 is the alarm that turns the town hostile (`FUN_1070_23b9`), under
   *     the same words — 1997's alert, not its prick of disease.
   */
  trap(id: number, flag: Flag, kind: number): Step {
    return (next) => {
      const { pages, pic } = this.dialogPages(id);
      const strong = kind >= 20;
      const k = strong ? kind - 20 : kind;
      const level = strong && k !== 10 ? 2 : 0;
      const custom = k === 8 ? this.alarmWakes() : -1;
      const type = k === 5 ? 6 : k === 8 ? TRAP_CUSTOM : k === 11 ? TRAP_ALERT : k;
      return this.node('once-trap', {
        sdf: flag, msg: [pages[pages.length - 1]!, -1],
        ex1: [type, level], ex2: [k === 8 || k === 11 ? 10 : 0, custom], pic,
      }, next);
    };
  }

  /** E3's trap 8, as a scenario node: the alarm that wakes the hostile creatures. */
  private alarmWakes(): number {
    if (!this.src.scenNode) throw new Error('trap 8 needs ScriptSource.scenNode');
    return this.src.scenNode((s) => s.compile([s.log(0x10e0, 0x321), s.setCreature(-1, 'wake', 0, 1)]));
  }

  /** `FUN_10b0_958e(n, type)`: every living PC takes `n` damage of `type`. */
  damageAll(n: number, type: number): Step {
    return (next) => this.node('damage', { ex1: [0, 1], ex2: [n, type] }, next);
  }

  xp(n: number): Step {
    return (next) => this.node('xp', { ex1: [n, 0] }, next);
  }

  /**
   * The target loses `n` experience (AFFECT_XP's drain, `drain_pc`). E3
   * subtracts from the word directly; the engine's drain floors at 0 and
   * skips the dead, so guard it with `ifStat(CUR_XP, n + 1)` for E3's test.
   */
  drainXp(n: number): Step {
    return (next) => this.node('xp', { ex1: [n, 1] }, next);
  }

  /**
   * `FUN_10b0_95db(mode)`: BoE 1997's `slay_party`, every living PC's
   * `main_status` becomes `mode` (0 gone, 2 dead, 3 dust, 4 stone), which
   * ends the game. Aimed at one PC (after `eachPc`, or the active PC in
   * combat, the engine's default target) it is `FUN_10b0_9e2d(pc, mode)`.
   */
  slayParty(mode: 0 | 2 | 3 | 4): Step {
    const kill: Record<number, number> = { 0: 5, 2: 0, 3: 1, 4: 2 };
    return (next) => this.node('death', { ex1: [kill[mode]!, 1] }, next);
  }

  /** `if (FUN_1070_079e(cls))`: take one item of class `cls`, and if there was one, `then`. */
  ifTakeItemOfClass(cls: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-item-class', { ex1: [cls, yes], ex2: [1] }, no);
    };
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
      sdf: flag, msg: [a > 0 ? this.e3(block, a) : -1, b > 0 ? this.e3(block, b) : -1], ex1: [group],
      pic: this.src.encounterPic?.(group),
    }, next);
  }

  gold(n: number): Step {
    return (next) => this.node('gold', { ex1: [n, 0] }, next);
  }

  /** `party.gold -= n` without a word (AFFECT_GOLD's take, which stops at 0). */
  takeGold(n: number): Step {
    return (next) => this.node('gold', { ex1: [n, 1] }, next);
  }

  /** `if (party.gold >= n)`, taking nothing (IF_HAS_GOLD with `ex2a` 0). */
  ifGold(n: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-gold', { ex1: [n, yes], ex2: [0] }, no);
    };
  }

  food(n: number): Step {
    return (next) => this.node('food', { ex1: [n, 0] }, next);
  }

  /**
   * `while (FUN_1070_0401(item) && n < max)`: the party is given `item` again
   * and again until nobody has room, at most `max` times, counted in `count`.
   */
  giveItemUntilFull(item: number, max: number, count: Flag): Step {
    return (next) => {
      const head = this.reserve();
      const again = this.seq([this.incFlag(count), this.ifFlagBelow(count, max, [() => head])])(next);
      this.fill(head, 'once-give-item', { ex1: [item, 0], ex2: [0, next] }, again);
      return this.setFlag(count, 0)(head);
    };
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

  /** A reply that is a literal in E3's code (`strcpy` into the reply), not a string. */
  replyLiteral(seg: number, off: number): Step {
    return (next) => this.node('disp-msg', { msg: [this.text(this.src.exeString?.(seg, off) ?? '')] }, next);
  }

  /**
   * `FUN_1020_0082(type, first, last, cost, title)`, BoE's `start_shop_mode`,
   * called from a spot: `ENTER_SHOP` on the converted shop, `cost` its price
   * level, the title an EXE string at `seg:off`. Types 5–9 are the five
   * magic shops, which are the scenario's first five.
   */
  shop(type: E3ShopType, first: number, last: number, cost: number, seg: number, off: number): Step {
    return (next) => {
      const title = this.src.exeString?.(seg, off) ?? '';
      const magic = type >= E3ShopType.MAGIC_SHOPS && type < E3ShopType.MAGE;
      const id = magic ? type - E3ShopType.MAGIC_SHOPS : this.src.shop?.(type, first, last, title);
      if (id === undefined) throw new Error('no shops here: ScriptSource.shop is missing');
      return this.node('start-shop', { ex1: [id, 0], ex2: [0, cost], msg: [this.text(title)] }, next);
    };
  }

  /**
   * `FUN_10c0_4652(x, y)`: outdoors, the party moves to `(x, y)` in the
   * sector it stands in (OUT_MOVE_PARTY, whose coordinates are the same).
   */
  outMoveParty(x: number, y: number): Step {
    return (next) => this.node('out-move-party', { ex1: [x, y] }, next);
  }

  /**
   * `if (can_find_town[t])`, a byte test at party+0x8485+t: town `t` shows on
   * the map. The engine's `if-town-visible` is an exile-js opcode
   * (`SpecType.IF_TOWN_VISIBLE`), the reading half of `town-visible`.
   */
  ifTownVisible(t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-town-visible', { ex1: [t, yes] }, no);
    };
  }

  /**
   * The town loader's `entry_dir` (its second argument) is from `lo` to `hi`:
   * 0–3 an entrance, 9 a script's move (`FUN_10c0_4a61`). The engine's
   * `if-entry-dir` is an exile-js opcode (`SpecType.IF_ENTRY_DIR`).
   */
  ifEntryDir(lo: number, hi: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-entry-dir', { ex1: [lo, hi, yes] }, no);
    };
  }

  /**
   * A test of creature `slot`'s record (+0 `active`, +2 attitude, stride
   * 0x5c from 1160:1427): `here` it is present (`active > 0`), `attitude`
   * present with `attitude`, `waiting` its group not yet brought in, and
   * `fewerThan` — any slot — the town has fewer than that many present. The
   * engine's `if-creature` is an exile-js opcode (`SpecType.IF_CREATURE`).
   */
  ifCreature(
    slot: number, test: 'here' | 'waiting' | { attitude: number } | { fewerThan: number },
    then: Step[], otherwise: Step[] = [],
  ): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      const ex2: [number, number?] = test === 'here' ? [0] : test === 'waiting' ? [2]
        : 'attitude' in test ? [1, test.attitude] : [3, test.fewerThan];
      return this.node('if-creature', { ex1: [slot, yes], ex2 }, no);
    };
  }

  /**
   * A write to creature `slot`'s record, where it is present: `wake` sets
   * `active` 2 (hunting), `health` sets +9, `remove` clears `active`, and
   * `die` clears it and sets its death flag (`spec1`/`spec2`). Slot -1 is
   * every creature, -2 the one being talked to; `attitude` keeps to those
   * with it. The engine's `town-creature` is an exile-js opcode
   * (`SpecType.TOWN_SET_CREATURE`).
   */
  setCreature(slot: number, what: 'wake' | 'health' | 'remove' | 'die', value = 0, attitude?: number): Step {
    const code = { wake: 0, health: 1, remove: 2, die: 3 }[what];
    return (next) => this.node('town-creature', { ex1: [slot, code, value], ex2: [attitude === undefined ? 0 : attitude + 1] }, next);
  }

  /** `if (entry_dir < 9)`: the party walked in, rather than a script putting it here. */
  ifWalkedIn(then: Step[]): Step {
    return this.ifEntryDir(0, 8, then);
  }

  /** `can_find_town[t] = 1`: town `t` shows on the map (or, `on` false, stops showing). */
  townVisible(t: number, on = true): Step {
    return (next) => this.node('town-visible', { ex1: [t], ex2: [on ? 1 : 0] }, next);
  }

  /**
   * A node that clears `flags` at the start of every day, and runs `also`,
   * for a scenario `<timer>` of 3700 ticks: a scenario timer fires once, so
   * the node rearms itself as a party timer each time.
   */
  dailyReset(flags: Flag[], also: Step[] = []): number {
    const clear = this.seq([...flags.map((f) => this.setFlag(f, 0)), ...also])(-1);
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

  /** The target is diseased by `n` (AFFECT_STATUS, BoE's `disease_pc` with its saving roll). */
  disease(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_DISEASE] }, next);
  }

  /** `FUN_10b0_933f(pc, n)` for every PC: BoE 1997's `poison_pc`, the engine's own. */
  poisonAll(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_POISON] }, next);
  }

  /**
   * `FUN_10b0_16e6(pc, n)`: BoE 1997's `dumbfound_pc`, the target (every PC
   * unless one is picked) dumbfounded by `n`, with the engine's saving roll.
   */
  dumbfound(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_DUMB] }, next);
  }

  /**
   * `FUN_10b0_1bec(pc, n)`: BoE 1997's `slow_pc`, the target (every PC
   * unless one is picked) slowed by `n`. E3 slows and then curses each PC
   * in turn where the pair of nodes does every PC for one, then the other;
   * neither rolls, so only the order of the log lines differs.
   */
  slow(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_SLOW] }, next);
  }

  /**
   * `FUN_10b0_19dd(pc, n, 11, adjust)`: `sleep_pc`, the target put to sleep
   * for `n`. E3's saving roll, `get_ran(1, 0, 100) + adjust` against
   * `30 + 2 × level`, is 1997's, which the engine has (`sleep-save`,
   * DIVERGENCES.md §17). E3's protections are its own item abilities —
   * 118 makes a PC immune, and 120 or 127 takes 2 off `n` (`10b0:1a14`) —
   * which `Player.sleep` reads off `Item.e3Ability` (DIVERGENCES.md #23).
   */
  sleep(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_ASLEEP] }, next);
  }

  /**
   * `FUN_10b0_19dd(pc, n, 12, adjust)`: `sleep_pc` paralysing the target for
   * `n`, with `sleep`'s saving roll. E3's ability 120 makes a PC immune,
   * as `sleep` says.
   */
  paralyze(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_PARALYZED] }, next);
  }

  /**
   * `fry_party`: every PC's `main_status` to 0, absent, so the party is
   * gone and the game over (the engine's party-death check). AFFECT_DEADNESS
   * with `ex1a` 5 is ABSENT.
   */
  killParty(): Step {
    return (next) => this.node('death', { ex1: [5, 1] }, next);
  }

  /**
   * Every creature of the town's record to `attitude`, slot by slot, as
   * `bringIn` sets them. A dead or absent slot takes it and shows nothing.
   */
  everyoneAttitude(attitude: number): Step {
    return (next) => (this.src.creatures ?? []).reduceRight(
      (after, c, i) => (c.number > 0 ? this.node('set-attitude', { ex1: [i, attitude] }, after) : after), next);
  }

  /** `FUN_10b0_1606(pc, n)`: BoE 1997's `curse_pc`, the target cursed by `n`. */
  curse(n: number): Step {
    return (next) => this.node('status', { ex1: [n, 1, STATUS_CURSE] }, next);
  }

  /**
   * `switch (get_ran(1, 0, n - 1))` over `cases` (fewer than `n` leave the
   * rest doing nothing): case k with odds 1 in n − k once the ones before it
   * missed, so each is equally likely.
   */
  randomCase(n: number, cases: Step[][]): Step {
    return cases.reduceRight<Step>((otherwise, then, k) =>
      this.ifChance(Math.round(100 / (n - k)), then, [otherwise]), (next) => next);
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
   *
   * E3 clears each creature's code as it comes in, so a second call finds
   * nobody. The engine's `activate_monsters` reads the code off the town's
   * *record*, which never changes, so a second call would bring the group
   * back from the dead; the call is guarded on its first creature's live
   * code instead, which the engine does clear.
   */
  bringIn(code: number, attitude: number): Step {
    return (next) => {
      const slots = (this.src.creatures ?? []).flatMap((c, i) => (c.number > 0 && c.spec1 === code ? [i] : []));
      if (slots.length === 0) return this.node('once-town-encounter', { ex1: [code] }, next);
      const set = slots.reduceRight((after, i) => {
        const n = this.src.creatures![i]!.number;
        return this.node('set-attitude', { ex1: [i, n > 0x94 && n < 0x9b ? 3 : attitude] }, after);
      }, next);
      const bring = this.node('once-town-encounter', { ex1: [code] }, set);
      return this.node('if-creature', { ex1: [slots[0]!, bring], ex2: [2] }, next);
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
   * the party. E3's own cases for seven towns are their `<onoffend>` nodes
   * (`towns/hostile.ts`), and which monsters move and which are boosted is
   * the `hostile-movers` flag and `<guard>` (`emit.ts`).
   */
  /**
   * Every creature of the town gets `attitude` (E3's active ones: the town
   * loader's loops write `active` slots). With `mobile` given it also stops
   * or starts moving: TOWN_SET_ATTITUDE's `10 + a` and `20 + a`, an exile-js
   * extension (`src/game/specials/town.ts`). `'record'` moves as the town
   * record says, as E3 has it on a fresh load.
   */
  setAttitudes(attitude: number, mobile?: boolean | 'record'): Step {
    const slots = (this.src.creatures ?? []).flatMap((c, i) => (c.number > 0 ? [i] : []));
    return this.seq(slots.map((i) => {
      const moves = mobile === 'record' ? (this.src.creatures![i]!.mobile ?? 1) > 0 : mobile;
      const code = moves === undefined ? attitude : (moves ? 20 : 10) + attitude;
      return (next: number) => this.node('set-attitude', { ex1: [i, code] }, next);
    }));
  }

  makeTownHostile(): Step {
    return (next) => this.node('town-attitude', { ex1: [0, -1], ex2: [1] }, next);
  }

  /**
   * E3 writing a creature's `m_loc`: the creature standing at `from`, of
   * monster type `type`, moves to `to`. The engine's TOWN_RELOCATE_CREATURE
   * moves to the node's own spot and can't be pointed elsewhere, so the
   * creature is destroyed and a new one of its type placed (forced, and
   * hostile, as `place_monster` makes it).
   */
  moveCreature(from: { x: number; y: number }, to: { x: number; y: number }, type: number): Step {
    return (next) => this.node('destroy-monst', { ex1: [from.x, from.y] }, this.placeMonster(to.x, to.y, type)(next));
  }

  /**
   * `FUN_1090_3d56(type, loc)`: a new creature of monster `type` at `(x, y)`,
   * hostile and hunting, whatever already stands there. It is the engine's
   * TOWN_PLACE_MONST, forced.
   */
  placeMonster(x: number, y: number, type: number): Step {
    return (next) => this.node('place-monst', { ex1: [x, y], ex2: [type, 1] }, next);
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

  /**
   * `FUN_1018_99f2(spot, n)`: `place_spell_pattern(3×3, spot, n + 50)`. E3
   * reads the code as 1997's does (`FUN_1018_9a2b`): 50–79 is `code - 50`
   * d6 of fire, 90–119 cold and 130–159 magic.
   */
  e3Boom(n: number): Step {
    const code = n + 50;
    const [type, dice] = code < 80 ? [DamageType.FIRE, code - 50] : code < 120 ? [DamageType.COLD, code - 90]
      : [DamageType.MAGIC, code - 130];
    if (dice < 0 || code >= 160) throw new Error(`E3 boom ${n} is outside 1997's codes`);
    return this.patternBoom(PAT_SQUARE, type, dice);
  }

  /** TOWN_CREATE_WANDERING: `FUN_1090_03f3`, BoE 1997's `create_wand_monst`. */
  wanderingMonster(): Step {
    return (next) => this.node('make-wandering', {}, next);
  }

  /** E3's horse `k` becomes the party's (its `property` byte cleared). */
  giveHorse(k: number): Step {
    const n = this.src.horse?.(k) ?? k;
    if (n < 0) throw new Error(`E3 horse ${k} is not placed anywhere`);
    return (next) => this.node('change-horse', { ex1: [n], ex2: [1] }, next);
  }

  /**
   * `switch (flag) { case 0: … case n-1: }` over `cases`, for the scripts
   * that index a table by a counter (the horse dealers). Any other value
   * runs `otherwise`.
   */
  switchFlag(flag: Flag, cases: Step[][], otherwise: Step[] = []): Step {
    return cases.reduceRight<Step>((rest, then, v) => this.ifFlagEq(flag, v, then, [rest]), this.seq(otherwise));
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

  /** `if (party.alchemy[k])` (party+0x831e + k): IF_RECIPE. */
  ifAlchemy(k: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-alchemy', { ex1: [k, yes] }, no);
    };
  }

  /** The party learns alchemy recipe `k` (`party.alchemy[k] = 1`, party+0x831e). */
  learnAlchemy(k: number): Step {
    return (next) => this.node('alchemy', { ex1: [k, 0] }, next);
  }

  /**
   * `if (a living PC has trait t)`, as `FUN_10b0_a3e3` counts Woodsman (the
   * trait byte at +0x712): IF_TRAIT with a count of at least one.
   */
  ifTrait(t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-trait', { ex1: [t, yes], ex2: [1, 2] }, no);
    };
  }

  /** `if (a living PC is of race r)`, E3's word at PC+0x71c: IF_SPECIES with a count of at least one. */
  ifSpecies(r: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-species', { ex1: [r, yes], ex2: [1, 2] }, no);
    };
  }

  /** `if (party.food >= n) { food -= n; then } else { otherwise }`, silently. */
  ifTakeFood(n: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq([(after) => this.node('food', { ex1: [n, 1] }, after), ...then])(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-food', { ex1: [n, yes] }, no);
    };
  }

  /** `party.food = 0`: AFFECT_FOOD takes the most the engine keeps. */
  takeAllFood(): Step {
    return (next) => this.node('food', { ex1: [25000, 1] }, next);
  }

  /** `if (FUN_10b0_302f() >= value)`: the living PCs' levels, added up. */
  ifLevelTotal(value: number, then: Step[], otherwise: Step[] = []): Step {
    return this.ifSkillTotal(104, value, then, otherwise);
  }

  /**
   * Asks for a number from `lo` to `hi` and stores it in `flag`
   * (IF_NUM_RESPONSE). For E3's LED puzzles, whose buttons the engine's
   * dialogs cannot show five of; the prompt is the converter's own words.
   */
  askNumber(prompt: string, lo: number, hi: number, flag: Flag): Step {
    return (next) => {
      const m = this.src.scenString?.(prompt);
      if (m === undefined) throw new Error('askNumber needs ScriptSource.scenString');
      return this.node('if-num-response', { sdf: flag, msg: [m, lo, hi] }, next);
    };
  }

  /** `flag -= n`. */
  decFlag(flag: Flag, n = 1): Step {
    return (next) => this.node('inc-sdf', { sdf: flag, ex1: [n, 1] }, next);
  }

  /**
   * Every square of terrain `from` becomes `to`, as E3's loops over the
   * whole town do. The squares are found in the converted map, so this is
   * right as long as nothing else makes or removes `from` first.
   */
  replaceTerrain(from: number, to: number): Step {
    const squares: [number, number][] = [];
    (this.src.terrain ?? []).forEach((col, x) => col.forEach((t, y) => { if (t === from) squares.push([x, y]); }));
    return this.seq(squares.map(([x, y]) => this.setTer(x, y, to)));
  }

  /** `if (random(0, 1) == 0)`: IF_RANDOM passes `get_ran(1,1,100) < 51`, half the time. */
  ifCoinFlip(then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-rand', { ex1: [51, yes] }, no);
    };
  }

  /**
   * Every square of terrain `from` in the rect (inclusive) becomes `to`, as
   * found in the converted map: right while nothing else has changed them.
   */
  rectReplace(x1: number, y1: number, x2: number, y2: number, from: number, to: number): Step {
    const steps: Step[] = [];
    for (let x = x1; x <= x2; x++)
      for (let y = y1; y <= y2; y++)
        if (this.src.terrain?.[x]?.[y] === from) steps.push(this.setTer(x, y, to));
    return this.seq(steps);
  }

  /** `if (random chance of pct in 100)`: IF_RANDOM passes `get_ran(1,1,100) < ex1a`. */
  ifChance(pct: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-rand', { ex1: [pct + 1, yes] }, no);
    };
  }

  /**
   * `body(pc)` aimed at one PC picked at random, `get_ran(1, 0, 5)`: PC k
   * with odds 1 in 6 − k after the ones before it missed, so each is equally
   * likely. The party is the target again afterwards.
   */
  atRandomPc(body: Step[]): Step {
    const pick = (pc: number): Step[] => [(next) => this.node('select-pc', { ex1: [10 + pc] }, next), ...body];
    const chain = [0, 1, 2, 3, 4].reduceRight<Step[]>(
      (otherwise, pc) => [this.ifChance(Math.round(100 / (6 - pc)), pick(pc), otherwise)], pick(5));
    return this.seq([...chain, (next) => this.node('select-pc', { ex1: [2] }, next)]);
  }

  /** TOWN_NUKE_MONSTS: every creature here (0), or of one kind, is gone. */
  removeCreatures(kind = 0): Step {
    return (next) => this.node('nuke-monsts', { ex1: [kind] }, next);
  }

  /** Refuses the step onto the spot (the town handler returning 0). */
  blockMove(): Step {
    return (next) => this.node('block-move', { ex1: [1] }, next);
  }

  /**
   * `FUN_10e0_09e5`: E3's lever, dialog 0x3fc (Leave or Pull). Pulled, it
   * flips the lever's terrain, 243 and 244 (the converter makes each the
   * other's `transform`), and runs `then`. It is BoE's own TOWN_LEVER.
   */
  lever(then: Step[]): Step {
    return (next) => {
      const { pages, pic } = this.dialogPages(0x3fc);
      return this.leadPages(pages, this.node('lever', { msg: [pages[pages.length - 1]!, -1], ex1: [-1, this.seq(then)(next)], pic }, next), pic);
    };
  }

  /**
   * One of E3's LED panels (BoE 1997's `cd_set_led` dialogs): dialog `id`
   * has a heading and a button per action, more than the engine's dialogs
   * show, so the player types the number (as the Slime Pit's pedestal
   * does). E3's panel stays open until Leave, so this asks again after each
   * action, and 0 leaves. The prompt is built from the dialog's own labels
   * in the order of their control ids, or from `labels` (the converter's
   * words) where the dialog's don't name each button. `scratch` holds the
   * answer. A button in `closing` (1-based) runs its action and closes the
   * panel, as E3's do by clearing the dialog's loop flag.
   */
  ledPanel(id: number, actions: Step[][], scratch: Flag, labels?: string[], closing: number[] = []): Step {
    const d = this.src.dialogs.get(id);
    if (!d) throw new Error(`E3 dialog ${id} not found`);
    const texts = d.controls.filter((c) => c.text && !/^\d+_\d+$/.test(c.text)).sort((a, b) => a.id - b.id);
    const [heading, ...own] = texts.map((c) => c.text.replace(/^\*/, ''));
    const names = labels ?? own;
    const prompt = `${heading ?? ''} ${names.map((l, i) => `${i + 1} ${l}`).join(', ')} (0 to leave)`;
    return (next) => {
      const m = this.src.scenString?.(prompt);
      if (m === undefined) throw new Error('ledPanel needs ScriptSource.scenString');
      const ask = this.reserve();
      const again: Step = () => ask;
      const chosen = this.switchFlag(scratch, [[], ...actions.map((a, k) => (closing.includes(k + 1) ? a : [...a, again]))])(next);
      this.fill(ask, 'if-num-response', { sdf: scratch, msg: [m, 0, actions.length] }, chosen);
      return ask;
    };
  }

  /** RECT_CHANGE_TER: every square from `(x1, y1)` to `(x2, y2)` becomes `t`. */
  rectTer(x1: number, y1: number, x2: number, y2: number, t: number): Step {
    // The rect nodes run x over ex1b..ex2b and y over ex1a..ex2a
    // (boe.specials.cpp's `location l(i, j)`); sd1 is the terrain, sd2 the
    // percentage chance.
    return (next) => this.node('rect-change-ter', { sdf: [t, 100], ex1: [y1, x1], ex2: [y2, x2] }, next);
  }

  /** RECT_PLACE_FIELD on one square: `field` (the engine's `FieldType`) at `(x, y)`. */
  placeField(x: number, y: number, field: number): Step {
    return this.placeFieldRect(x, y, x, y, field);
  }

  /** RECT_PLACE_FIELD: `field` on every square from `(x1, y1)` to `(x2, y2)`, each with `pct` percent chance. */
  placeFieldRect(x1: number, y1: number, x2: number, y2: number, field: number, pct = 100): Step {
    return (next) => this.node('rect-place-field', { sdf: [pct, field], ex1: [y1, x1], ex2: [y2, x2] }, next);
  }

  /**
   * `FUN_1038_1185(x, y, type)`, BoE 1997's `make_sfx`: a decal, type 1–8
   * (small, medium and large blood, small and large slime, ash, bones,
   * rubble), the engine's `SFX_SMALL_BLOOD + type - 1`. E3 skips a square
   * whose `sight_obscurity` is above 0; the converter doesn't place any there.
   */
  decal(x: number, y: number, type: number): Step {
    return this.placeField(x, y, FieldType.SFX_SMALL_BLOOD + type - 1);
  }

  /**
   * `FUN_1038_1270(type, pct)`: decal `type` on each square of plain ground
   * (terrain under 5), each with `pct` percent chance. The squares come from
   * the converted map, a run of them in a column to a node.
   */
  scatterDecals(type: number, pct: number): Step {
    const runs: Step[] = [];
    (this.src.terrain ?? []).forEach((col, x) => {
      let from = -1;
      col.forEach((t, y) => {
        if (t < 5 && from < 0) from = y;
        if (t < 5 && y === col.length - 1) runs.push(this.placeFieldRect(x, from, x, y, FieldType.SFX_SMALL_BLOOD + type - 1, pct));
        else if (t >= 5 && from >= 0) {
          runs.push(this.placeFieldRect(x, from, x, y - 1, FieldType.SFX_SMALL_BLOOD + type - 1, pct));
          from = -1;
        }
      });
    });
    return this.seq(runs);
  }

  /**
   * Field `field` is gone from every square of the rect: RECT_PLACE_FIELD
   * with `100 + field`, an exile-js extension (`src/game/specials/rect.ts`).
   */
  removeField(x1: number, y1: number, x2: number, y2: number, field: number): Step {
    return (next) => this.node('rect-place-field', { sdf: [100, 100 + field], ex1: [y1, x1], ex2: [y2, x2] }, next);
  }

  /** The text of control `control` of E3 dialog `id`, for building a prompt from. */
  dialogText(id: number, control: number): string {
    const c = this.src.dialogs.get(id)?.controls.find((k) => k.id === control);
    if (!c) throw new Error(`E3 dialog ${id} has no control ${control}`);
    return c.text.replace(/^\*/, '');
  }

  /** The literal at `seg:off` in the EXE (what `log` shows), for building a line from. */
  exeText(seg: number, off: number): string {
    return this.src.exeString?.(seg, off) ?? '';
  }

  /** A line in the text area in the converter's own words, where E3 shows state the engine can't. */
  say(text: string): Step {
    return (next) => this.node('disp-sm-msg', { msg: [this.text(text)] }, next);
  }

  /** E3's `key_times[k] = calc_day()`: plot event `k` happened today (`e3Event`). */
  setEvent(k: number): Step {
    return (next) => this.node('set-event', { ex1: [e3Event(k)] }, next);
  }

  /** `if ((is_town() || is_combat()) && town_num == t)`. */
  ifTown(t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-town', { ex1: [t, yes] }, no);
    };
  }

  /**
   * `if (is_town() && the terrain under the party is t)`: IF_TER_TYPE at
   * (-1, -1), an exile-js extension (`src/game/specials/ifthen.ts`), which
   * never matches in combat.
   */
  ifPartyOnTer(t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-ter', { ex1: [-1, -1], ex2: [t, yes] }, no);
    };
  }

  /**
   * `if (is_combat() && pc is alive && the terrain under pc is t)`, for the
   * target `eachPc` picked: IF_TER_TYPE at (-2, -2), an exile-js extension.
   */
  ifTargetOnTer(t: number, then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-ter', { ex1: [-2, -2], ex2: [t, yes] }, no);
    };
  }

  /** `play_sound(n)`: PLAY_SOUND, without waiting for it to finish. */
  sound(n: number): Step {
    return (next) => this.node('play-sound', { ex1: [n, 0] }, next);
  }

  /** `get_ran(n, 1, sides)` damage of `type`, rolled once, to every PC. */
  damageDice(n: number, sides: number, type: number): Step {
    return (next) => this.node('damage', { ex1: [n, sides], ex2: [0, type] }, next);
  }

  /**
   * `party.food /= 2`. No node halves, so this takes the food away a power
   * of two at a time from 16384 down (the engine keeps at most 25000),
   * remembering each in `bits` (15 flags),
   * and then gives half of each back.
   *
   * Giving back uses AFFECT_FOOD's *take* arm with a negative amount, which
   * adds silently where the give arm prints a line each time. A field of -10
   * or less is a pointer (`resolvePointers`), so no node can add more than 9:
   * the larger halves go back 8 at a time, counted down in `counter`.
   */
  halveFood(bits: Flag[], counter: Flag): Step {
    const powers = [16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
    if (bits.length !== powers.length) throw new Error('halveFood needs 15 flags');
    const take = (n: number) => (next: number) => this.node('food', { ex1: [n, 1] }, next);
    const ifFood = (n: number, then: Step[]) => (next: number) =>
      this.node('if-food', { ex1: [n, this.seq(then)(next)] }, next);
    /** Adds `n` food silently: `n / 8` rounds of 8 (at most 255 a loop). */
    const addFood = (n: number): Step[] => {
      const out: Step[] = [];
      for (let left = Math.floor(n / 8); left > 0; left -= 255) {
        const rounds = Math.min(left, 255);
        out.push(this.setFlag(counter, rounds), (next) => {
          const check = this.reserve();
          const body = this.seq([take(-8), this.decFlag(counter)])(check);
          this.fill(check, 'if-sdf', { sdf: counter, ex1: [1, body] }, next);
          return body;
        });
      }
      if (n % 8 > 0) out.push(take(-(n % 8)));
      return out;
    };
    return this.seq([
      ...powers.map((p, k) => ifFood(p, [take(p), this.setFlag(bits[k]!, 1)])),
      ...powers.map((p, k) => this.ifFlagEq(bits[k]!, 1, [...addFood(Math.floor(p / 2)), this.setFlag(bits[k]!, 0)])),
    ]);
  }

  /**
   * `FUN_10e0_0806(x, y)`: one PC (the engine asks which) goes alone to
   * `(x, y)`, BoE's TOWN_SPLIT_PARTY. It refuses the step. The node's own
   * message, `msg`, shows only if someone went; a split that happened ends
   * the chain, and a cancelled one runs `cancelled`.
   */
  splitParty(x: number, y: number, cancelled: Step[] = [], msg?: [block: number, i: number]): Step {
    return this.seq([this.setFlag(SPLIT, 1), (next) => this.node('split-party', {
      ex1: [x, y], ex2: [10], ...(msg ? { msg: [this.e3(msg[0], msg[1])] as [number] } : {}),
    }, this.seq([this.setFlag(SPLIT, 0), ...cancelled])(next))]);
  }

  /** `if (party+0xc64)`: the party is split (E3's own flag, which the split steps keep). */
  ifSplit(then: Step[], otherwise: Step[] = []): Step {
    return this.ifFlagAtLeast(SPLIT, 1, then, otherwise);
  }

  /** `FUN_10e0_0907`: the party is whole again where it split (TOWN_REUNITE_PARTY). */
  reuniteParty(): Step {
    return this.seq([this.setFlag(SPLIT, 0), (next) => this.node('unite-party', { ex1: [10] }, next)]);
  }

  /** The engine's item number for E3's `item` made readable with `ability` (`notes.ts`). */
  note(item: number, ability: number): number {
    const n = this.src.noteItem?.(item, ability);
    if (n === undefined) throw new Error('note needs ScriptSource.noteItem');
    return n;
  }

  /** The engine's item number for E3's `item` with its ability byte stamped to `ability`. */
  stamped(item: number, ability: number): number {
    const n = this.src.stampedItem?.(item, ability);
    if (n === undefined) throw new Error('stamped needs ScriptSource.stampedItem');
    return n;
  }

  /** `FUN_1070_18fd`: item `item` (the engine's number) lies at `(x, y)` (TOWN_PLACE_ITEM). */
  placeItem(x: number, y: number, item: number): Step {
    return (next) => this.node('place-item', { ex1: [x, y], ex2: [item, 0] }, next);
  }

  /**
   * `FUN_1070_3301(1, …)`: a living PC chosen by the player becomes the
   * target of what follows (SELECT_TARGET, mode 1); cancelling runs
   * `cancelled` instead.
   */
  choosePc(then: Step[], cancelled: Step[] = []): Step {
    return (next) => {
      const no = this.seq(cancelled)(next);
      return this.node('select-pc', { ex1: [1, no] }, this.seq(then)(next));
    };
  }

  /** The target is poisoned by `n` (AFFECT_STATUS, with the engine's saving roll), or cured by `-n`. */
  poison(n: number): Step {
    return (next) => this.node('status', { ex1: [Math.abs(n), n > 0 ? 1 : 0, STATUS_POISON] }, next);
  }

  /** Creatures in slots `slots` are gone (E3 clears their `active`). */
  removeCreatureSlots(slots: number[]): Step {
    return this.seq(slots.map((k) => this.setCreature(k, 'remove')));
  }

  /**
   * Every PC's `cur_health` (+0x54) scaled to `pct` percent, rounded down,
   * whatever their state. The engine's `hp-percent` is an exile-js opcode
   * (`SpecType.AFFECT_HP_PERCENT`).
   */
  scaleHealth(pct: number): Step {
    return (next) => this.node('hp-percent', { ex1: [pct] }, next);
  }

  /**
   * Every magic item (+0x11) out of the living PCs' packs, and, with `floor`,
   * off the town's floor. The engine's `take-magic` is an exile-js opcode
   * (`SpecType.AFFECT_TAKE_MAGIC_ITEMS`).
   */
  takeMagicItems(floor: boolean): Step {
    return (next) => this.node('take-magic', { ex1: [floor ? 1 : 0] }, next);
  }

  /** The target loses `n` spell points (AFFECT_SP's take arm), down to 0. */
  drainSp(n: number): Step {
    return (next) => this.node('sp', { ex1: [n, 1] }, next);
  }

  /**
   * `food += n` silently, as E3 adds to the word: AFFECT_FOOD's take arm with
   * negative amounts, at most 9 a node (-10 and less are pointers).
   */
  addFood(n: number): Step {
    const steps: Step[] = [];
    for (let left = n; left > 0; left -= 8) {
      const k = Math.min(8, left);
      steps.push((next) => this.node('food', { ex1: [-k, 1] }, next));
    }
    return this.seq(steps);
  }

  /** `FUN_1070_09e1(n, 1)`: the party loses `n` food (down to 0), silently. */
  takeFood(n: number): Step {
    return (next) => this.node('food', { ex1: [n, 1] }, next);
  }

  /** Every PC's spell points go to 0 (E3 writes `cur_sp` directly). */
  drainSpAll(): Step {
    return (next) => this.node('sp', { ex1: [255, 1] }, next);
  }

  /** `if (FUN_1038_018d())`: in combat. IF_CONTEXT on COMBAT_MOVE, which lets the step through. */
  ifInCombat(then: Step[], otherwise: Step[] = []): Step {
    return (next) => {
      const yes = this.seq(then)(next);
      const no = this.seq(otherwise)(next);
      return this.node('if-context', { ex1: [2, 0, yes] }, no);
    };
  }

  /** `if (terrain under spot id == t)`, the spot's square as `FUN_10e0_07b7` finds it. */
  ifTerAtSpot(id: number, t: number, then: Step[], otherwise: Step[] = []): Step {
    const at = this.src.spotLoc?.(id);
    if (!at) throw new Error(`spot ${id} has no location`);
    return this.ifTer(at.x, at.y, t, then, otherwise);
  }

  /**
   * `FUN_1038_0282`: spot `id` is erased once `steps` have run, so it never
   * runs again. The engine keeps the spot and marks it done in its own flag.
   */
  onceSpot(id: number, steps: Step[]): Step {
    const flag = this.src.spotFlag?.(id);
    if (!flag) throw new Error('onceSpot needs ScriptSource.spotFlag');
    return this.ifFlagEq(flag, 0, [...steps, this.setFlag(flag, 1)]);
  }

  /** The terrain at `(x, y)` as converted (the map before any script changes it). */
  terrainAt(x: number, y: number): number {
    const t = this.src.terrain?.[x]?.[y];
    if (t === undefined) throw new Error(`no terrain at (${x},${y})`);
    return t;
  }

  /** Whether this place has a spot `id` at all. */
  hasSpot(id: number): boolean {
    return this.src.spotLoc?.(id) !== undefined;
  }

  /** Where spot `id` is (`FUN_10e0_07b7`). */
  spotAt(id: number): { x: number; y: number } {
    const at = this.src.spotLoc?.(id);
    if (!at) throw new Error(`spot ${id} has no location`);
    return at;
  }

  /** The terrain under spot `id` becomes `t`. */
  setTerAtSpot(id: number, t: number): Step {
    const at = this.src.spotLoc?.(id);
    if (!at) throw new Error(`spot ${id} has no location`);
    return this.setTer(at.x, at.y, t);
  }

  /**
   * E3's per-turn town countdowns (the tail of `FUN_10c0_61c4`): while the
   * party is in `town`, `flag` falls by one a turn, and `at.get(v)` runs as
   * it reaches `v`; anywhere else E3 zeroes it (or, with `zeroAway` false,
   * leaves it, and it counts on only once restarted). Here a scenario timer of one
   * tick, rearming itself while `flag` is above 0, does the counting;
   * `running` says a timer is set, so starting twice doesn't count double.
   * Returns the step that starts it at `value`, for the town's script.
   */
  townCountdown(town: number, flag: Flag, value: number, running: Flag,
    at: (s: SpecBuilder) => Map<number, Step[]>, zeroAway = true): Step {
    const chain = this.src.scenNode?.((s) => s.countdownChain(town, flag, running, at(s), zeroAway));
    if (chain === undefined) throw new Error('townCountdown needs ScriptSource.scenNode');
    return this.seq([this.setFlag(flag, value), this.ifFlagEq(running, 0, [
      this.setFlag(running, 1), (next) => this.node('start-timer-scen', { ex1: [1, chain] }, next),
    ])]);
  }

  /**
   * E3's slow countdowns (`FUN_10c0_61c4`, every turn anywhere): while
   * `flag` is above 1, it falls by one when `get_ran(1, 0, 10)` is 5, one
   * turn in eleven. A one-tick scenario timer, rearming itself while the flag
   * is above 1, rolls IF_RANDOM's `< 10` for it: nine in a hundred.
   * Returns the step that sets the flag to `value` and starts the timer; the
   * caller starts it only once the last one has stopped.
   */
  slowCountdown(flag: Flag, value: number): Step {
    const tick = this.reserve();
    const rearm = (next: number) => this.node('start-timer-scen', { ex1: [1, tick] }, next);
    const body = this.seq([this.ifChance(10, [this.decFlag(flag)]), this.ifFlagAtLeast(flag, 2, [rearm])])(-1);
    this.fill(tick, 'nop', {}, body);
    return this.seq([this.setFlag(flag, value), rearm]);
  }

  /** The scenario chain behind `townCountdown`, returning its first node. */
  countdownChain(town: number, flag: Flag, running: Flag, at: Map<number, Step[]>, zeroAway = true): number {
    const start = this.reserve();
    const stop = this.setFlag(running, 0);
    const inTown = this.compile([this.ifFlagAtLeast(flag, 1, [
      this.decFlag(flag),
      ...[...at].map(([v, steps]) => this.ifFlagEq(flag, v, steps)),
      this.ifFlagAtLeast(flag, 1, [(next) => this.node('start-timer-scen', { ex1: [1, start] }, next)], [stop]),
    ], [stop])]);
    // Some countdowns E3 zeroes away from the town; others only pause.
    const away = this.compile(zeroAway ? [this.setFlag(flag, 0), stop] : [stop]);
    this.fill(start, 'if-town', { ex1: [town, inTown] }, away);
    return start;
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
