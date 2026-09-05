import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { SpellPat } from '../src/data/pattern';
import { FieldType } from '../src/data/fields';
import { GameMode } from '../src/game/modes';
import { cancelTownTargeting, castTownSpell } from '../src/game/spellTarget';
import { cancelSpellTargeting, doCombatCast } from '../src/game/spellCombatTarget';
import { SpecType, SpecialNode, emptySpecialNode } from '../src/data/special';
import { TerSpec } from '../src/data/terrain';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { ChoiceButton, SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { ONCE_DONE } from '../src/game/specials/oneshot';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Status } from '../src/universe/skills';
import { killMonst } from '../src/game/damage';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

/** Records everything the VM asked the host to do. */
class TestHost implements SpecialHost {
  messages: { str1: string; str2: string; title: string }[] = [];
  choices: { strs: string[]; buttons: ChoiceButton[] }[] = [];
  sounds: number[] = [];
  moves: { x: number; y: number }[] = [];
  levels: { town: number; where: { x: number; y: number } }[] = [];
  shops: number[] = [];
  ended = false;
  /** What choice() should return, in order; defaults to the last button. */
  answers: number[] = [];
  textAnswers: string[] = [];
  pcAnswer = 0;

  async message(str1: string, str2: string, title: string): Promise<void> {
    this.messages.push({ str1, str2, title });
  }

  async choice(strs: string[], buttons: ChoiceButton[]): Promise<number> {
    this.choices.push({ strs, buttons });
    return this.answers.shift() ?? buttons.length - 1;
  }

  stories: { title: string; first: number; last: number }[] = [];
  async story(title: string, first: number, last: number): Promise<void> {
    this.stories.push({ title, first, last });
  }
  async askText(): Promise<string> {
    return this.textAnswers.shift() ?? '';
  }

  async selectPc(): Promise<number> {
    return this.pcAnswer;
  }

  async getNumOfItems(max: number): Promise<number> {
    return max;
  }

  startShop(which: number): boolean {
    this.shops.push(which);
    return true;
  }

  startTalk(): void {}

  sound(which: number): void {
    this.sounds.push(which);
  }

  rest(): void {}

  moveParty(where: { x: number; y: number }): void {
    this.moves.push({ ...where });
  }

  changeLevel(town: number, where: { x: number; y: number }): void {
    this.levels.push({ town, where: { ...where } });
  }

  forceTown(town: number, _entryDir: number, where: { x: number; y: number }): void {
    this.levels.push({ town, where: { ...where } });
  }

  endScenario(): void {
    this.ended = true;
  }
}

/** A session in the start town with a set of synthetic nodes installed. */
function withNodes(nodes: Record<number, Partial<SpecialNode>>) {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  const host = new TestHost();
  session.attachSpecials(host);
  session.startTownMode(0, FORCED_ENTRY);
  // Replace the town's node list so the tests are self-contained.
  const map = new Map<number, SpecialNode>();
  for (const [num, node] of Object.entries(nodes))
    map.set(Number(num), { ...emptySpecialNode(), ...node });
  univ.town!.record.specials = map;
  univ.town!.record.specStrs = ['first string', 'second string', 'third string'];
  const run = (node = 0, mode = SpecCtx.TOWN_MOVE, where = { x: 5, y: 5 }) =>
    session.runSpecialRaw(mode, SpecCtxType.TOWN, node, where);
  return { univ, session, host, run };
}

describe('the VM core', () => {
  /**
   * The one-chain-at-a-time lock has to come back down even when a handler
   * blows up. Callers launch chains fire-and-forget, so a stuck lock used to
   * queue every later special forever — one bad node killed all scripting for
   * the rest of the session.
   */
  it('keeps running specials after one chain throws', async () => {
    const { univ, session, host, run } = withNodes({
      0: { type: SpecType.DISPLAY_MSG, m1: 0 },
      1: { type: SpecType.SET_SDF, sd1: 3, sd2: 3, ex1a: 42 },
    });
    const boom = new Error('handler exploded');
    host.message = () => Promise.reject(boom);
    await run(0);
    expect(univ.transcript.at(-1)).toBe('SPECIAL ENCOUNTER FAILED.');
    // The lock is down again, so the next chain runs normally.
    expect(session.specials!.busy).toBe(false);
    await run(1);
    expect(univ.party.getSdf(3, 3)).toBe(42);
  });

  it('follows jumpto from node to node until it runs out', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.SET_SDF, sd1: 1, sd2: 1, ex1a: 7, jumpto: 3 },
      3: { type: SpecType.SET_SDF, sd1: 1, sd2: 2, ex1a: 8, jumpto: 4 },
      4: { type: SpecType.SET_SDF, sd1: 1, sd2: 3, ex1a: 9 },
    });
    await run();
    expect(univ.party.getSdf(1, 1)).toBe(7);
    expect(univ.party.getSdf(1, 2)).toBe(8);
    expect(univ.party.getSdf(1, 3)).toBe(9);
  });

  it('sets the reserved pointers to the trigger location and its terrain', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.NONE } });
    await run();
    expect(univ.party.getPtr(10)).toBe(5);
    expect(univ.party.getPtr(11)).toBe(5);
    expect(univ.party.getPtr(12)).toBe(univ.town!.record.terrain[5]![5]);
  });

  it('reads a field <= -10 as a pointer rather than a value', async () => {
    const { univ, run } = withNodes({
      // ex1a = -10 means "pointer 10", which holds the trigger's x.
      0: { type: SpecType.SET_SDF, sd1: 2, sd2: 0, ex1a: -10 },
    });
    await run();
    expect(univ.party.getSdf(2, 0)).toBe(5);
  });

  it('resolves a named pointer through the SDF it aliases', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.SET_POINTER, ex1a: 100, sd1: 4, sd2: 4, jumpto: 1 },
      1: { type: SpecType.SET_SDF, sd1: 5, sd2: 0, ex1a: -100 },
    });
    univ.party.setSdf(4, 4, 42);
    await run();
    expect(univ.party.getSdf(5, 0)).toBe(42);
  });

  it('stops on a node number that does not exist', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.SET_SDF, sd1: 1, sd2: 1, ex1a: 3, jumpto: 900 } });
    await run();
    expect(univ.party.getSdf(1, 1)).toBe(3);
    expect(univ.transcript.at(-1)).toContain('out of range');
  });

  it('cuts off a chain that never ends', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.NONE, jumpto: 0 } });
    await run();
    expect(univ.transcript.at(-1)).toContain('INTERRUPTED');
  });
});

describe('general nodes', () => {
  it('does SDF arithmetic, taking either literals or other flags', async () => {
    const { univ, run } = withNodes({
      // 6 + 7, both literal (ex?b === -1 means "take ex?a as a number").
      0: { type: SpecType.SDF_ADD, sd1: 1, sd2: 0, ex1a: 6, ex1b: -1, ex2a: 7, ex2b: -1, jumpto: 1 },
      // (1,0) * 2
      1: { type: SpecType.SDF_TIMES, sd1: 1, sd2: 1, ex1a: 1, ex1b: 0, ex2a: 2, ex2b: -1, jumpto: 2 },
      // 17 / 5, remainder into (1,3)
      2: {
        type: SpecType.SDF_DIVIDE, sd1: 1, sd2: 2, ex1a: 17, ex1b: -1, ex2a: 5, ex2b: -1,
        ex1c: 1, ex2c: 3,
      },
    });
    await run();
    expect(univ.party.getSdf(1, 0)).toBe(13);
    expect(univ.party.getSdf(1, 1)).toBe(26);
    expect(univ.party.getSdf(1, 2)).toBe(3);
    expect(univ.party.getSdf(1, 3)).toBe(2);
  });

  it('STORY_DIALOG passes a title and a *range*, not two paragraphs', async () => {
    // m1 is the title; m2..m3 is the run of strings the dialog pages through
    // (boe.specials.cpp:2458). The port used to send m1 and m2 to the plain
    // message box as if they were one message in two parts.
    const { host, run } = withNodes({
      0: { type: SpecType.STORY_DIALOG, m1: 0, m2: 1, m3: 2, pic: 3, pictype: 4 },
    });
    await run();
    expect(host.stories).toEqual([{ title: 'first string', first: 1, last: 2 }]);
    // And nothing went to the plain message box.
    expect(host.messages).toHaveLength(0);
  });

  it('flips and increments flags', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.FLIP_SDF, sd1: 3, sd2: 0, jumpto: 1 },
      1: { type: SpecType.INC_SDF, sd1: 3, sd2: 1, ex1a: 5, ex1b: 0, jumpto: 2 },
      2: { type: SpecType.INC_SDF, sd1: 3, sd2: 1, ex1a: 2, ex1b: 1 },
    });
    await run();
    expect(univ.party.getSdf(3, 0)).toBe(1);
    expect(univ.party.getSdf(3, 1)).toBe(3);
  });

  it('shows a message and reads its text from the right string list', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.DISPLAY_MSG, m1: 0, m2: 1 },
    });
    await run();
    expect(host.messages).toEqual([{ str1: 'first string', str2: 'second string', title: '' }]);
  });

  it('hands the strings back instead of showing them, in a conversation', async () => {
    const { run } = withNodes({ 0: { type: SpecType.DISPLAY_MSG, m1: 2, m2: 1 } });
    const result = await run(0, SpecCtx.TALK);
    expect(result).toEqual({ a: 2, b: 1 });
  });

  it('builds a line in the string buffer', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.CLEAR_BUF, jumpto: 1 },
      // pic 0 means "no leading space"; the field's default of -1 is truthy.
      1: { type: SpecType.APPEND_STRING, ex1a: 0, pic: 0, jumpto: 2 },
      2: { type: SpecType.APPEND_NUM, ex1a: 42, pic: 1, jumpto: 3 },
      // BUFFER_STR is -8; note handle_message's guard means a node whose
      // *only* string is the buffer prints nothing, exactly as the C++ does.
      3: { type: SpecType.DISPLAY_MSG, m1: -8, m2: 0 },
    });
    await run();
    expect(univ.strBuf).toBe('first string 42');
    expect(host.messages[0]!.str1).toBe('first string 42');
  });

  it('blocks the step for a CANT_ENTER node', async () => {
    const { run } = withNodes({ 0: { type: SpecType.CANT_ENTER, ex1a: 1 } });
    expect((await run()).a).toBe(1);
  });

  it('changes terrain and plays sounds', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.CHANGE_TER, ex1a: 4, ex1b: 4, ex2a: 2, jumpto: 1 },
      1: { type: SpecType.PLAY_SOUND, ex1a: 25, ex1b: 0 },
    });
    await run();
    expect(univ.town!.record.terrain[4]![4]).toBe(2);
    // A negative number means "play asynchronously".
    expect(host.sounds).toEqual([-25]);
  });

  it('ends the scenario', async () => {
    const { host, run } = withNodes({ 0: { type: SpecType.END_SCENARIO } });
    await run();
    expect(host.ended).toBe(true);
  });
});

describe('if-then nodes', () => {
  it('branches on a flag being at or above a value', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_SDF, sd1: 8, sd2: 0, ex1a: 5, ex1b: 10, jumpto: 20 },
      10: { type: SpecType.SET_SDF, sd1: 9, sd2: 0, ex1a: 1 },
      20: { type: SpecType.SET_SDF, sd1: 9, sd2: 0, ex1a: 2 },
    });
    univ.party.setSdf(8, 0, 4);
    await run();
    expect(univ.party.getSdf(9, 0)).toBe(2); // fell through to jumpto

    univ.party.setSdf(8, 0, 6);
    await run();
    expect(univ.party.getSdf(9, 0)).toBe(1); // took the branch
  });

  it('charges gold when the test says to take it', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_HAS_GOLD, ex1a: 50, ex1b: 10, ex2a: 1, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 11, sd2: 0, ex1a: 1 },
    });
    univ.party.gold = 100;
    await run();
    expect(univ.party.gold).toBe(50);
    expect(univ.party.getSdf(11, 0)).toBe(1);

    // Too poor: no branch, no charge.
    univ.party.gold = 10;
    univ.party.setSdf(11, 0, 0);
    await run();
    expect(univ.party.gold).toBe(10);
    expect(univ.party.getSdf(11, 0)).toBe(0);
  });

  it('branches on a special item the party holds', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_HAVE_SPECIAL_ITEM, ex1a: 3, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 12, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(univ.party.getSdf(12, 0)).toBe(0);
    univ.party.specItems.add(3);
    await run();
    expect(univ.party.getSdf(12, 0)).toBe(1);
  });

  it('branches on the answer to a typed question', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.IF_TEXT_RESPONSE, m1: 0, pic: 5, ex1a: 1, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 13, sd2: 0, ex1a: 1 },
    });
    // The scenario-level list is what IF_TEXT_RESPONSE reads.
    scen.specStrs[0] = 'What is the password?';
    scen.specStrs[1] = 'second string';
    host.textAnswers = ['SECOND'];
    await run();
    expect(univ.party.getSdf(13, 0)).toBe(1);
  });

  it('compares a party statistic', async () => {
    const { univ, run } = withNodes({
      // Strength, cumulative across the party, at least 20.
      0: { type: SpecType.IF_STATISTIC, ex1a: 20, ex1b: 10, ex2a: 0, ex2b: 0, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 14, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(univ.party.getSdf(14, 0)).toBe(1);
  });
});

describe('one-shot nodes', () => {
  it('fires once, then refuses to run again', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_DISPLAY_MSG, sd1: 20, sd2: 0, m1: 0, jumpto: 1 },
      1: { type: SpecType.SET_SDF, sd1: 21, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(host.messages.length).toBe(1);
    expect(univ.party.getSdf(20, 0)).toBe(ONCE_DONE);
    expect(univ.party.getSdf(21, 0)).toBe(1);

    // Second time: nothing happens, and the chain stops dead.
    univ.party.setSdf(21, 0, 0);
    await run();
    expect(host.messages.length).toBe(1);
    expect(univ.party.getSdf(21, 0)).toBe(0);
  });

  it('gives an item and marks itself done', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.ONCE_GIVE_ITEM, sd1: 22, sd2: 0, ex1a: 3, ex1b: 100, ex2a: 50 },
    });
    const goldBefore = univ.party.gold;
    const foodBefore = univ.party.food;
    await run();
    expect(univ.party.gold).toBe(goldBefore + 100);
    // The item itself may be food, which lands on top of the node's 50.
    expect(univ.party.food).toBeGreaterThanOrEqual(foodBefore + 50);
    expect(univ.party.getSdf(22, 0)).toBe(ONCE_DONE);
  });

  it('leaves the flag unset when the player walks away from a gift', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_GIVE_ITEM_DIALOG, sd1: 23, sd2: 0, m1: 0, ex1a: 3 },
    });
    host.answers = [0]; // Leave
    await run();
    expect(univ.party.getSdf(23, 0)).toBe(0);
    // The names are what a recording clicks; the labels are what it says.
    expect(host.choices[0]!.buttons).toEqual([
      { name: 'btn1', label: 'Leave', key: undefined },
      { name: 'btn2', label: 'Take', key: undefined },
    ]);
  });

  it('offers a dialog and branches on which button was pressed', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_DIALOG, sd1: 24, sd2: 0, m1: 0, m3: 1, ex1a: 2, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 25, sd2: 0, ex1a: 1 },
    });
    host.answers = [1]; // the second button, which is ex1a's "Yes"
    await run();
    expect(host.choices[0]!.buttons).toEqual([
      { name: 'btn1', label: 'Leave', key: undefined },
      { name: 'btn2', label: 'Yes', key: 'y' },
    ]);
    expect(univ.party.getSdf(25, 0)).toBe(1);
  });
});

describe('town and rect nodes', () => {
  it('moves the party', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.TOWN_MOVE_PARTY, ex1a: 12, ex1b: 13 },
    });
    await run();
    expect(host.moves).toEqual([{ x: 12, y: 13 }]);
  });

  it('kills every hostile creature in town', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.TOWN_NUKE_MONSTS, ex1a: -2 } });
    const town = univ.town!;
    const hostiles = town.monsters.filter((m) => m.isAlive && !m.isFriendly).length;
    const friendlies = town.monsters.filter((m) => m.isAlive && m.isFriendly).length;
    if (hostiles === 0) return;
    await run();
    expect(town.monsters.filter((m) => m.isAlive && !m.isFriendly).length).toBe(0);
    expect(town.monsters.filter((m) => m.isAlive && m.isFriendly).length).toBe(friendlies);
  });

  it('paints terrain over a rectangle', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.RECT_CHANGE_TER, ex1a: 10, ex1b: 10, ex2a: 12, ex2b: 12, sd1: 2, sd2: 100 },
    });
    await run();
    for (let x = 10; x <= 12; x++)
      for (let y = 10; y <= 12; y++)
        expect(univ.town!.record.terrain[x]![y]).toBe(2);
  });

  it('paints only the border when pic is set', async () => {
    const { univ, run } = withNodes({
      0: {
        type: SpecType.RECT_CHANGE_TER, ex1a: 20, ex1b: 20, ex2a: 24, ex2b: 24,
        sd1: 2, sd2: 100, pic: 1,
      },
    });
    const middle = univ.town!.record.terrain[22]![22];
    await run();
    expect(univ.town!.record.terrain[20]![20]).toBe(2);
    expect(univ.town!.record.terrain[22]![20]).toBe(2);
    // The interior is untouched.
    expect(univ.town!.record.terrain[22]![22]).toBe(middle);
  });

  it('takes a staircase to another town', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.TOWN_GENERIC_STAIR, ex2a: 3, ex1a: 7, ex1b: 8, ex2b: 1 },
    });
    await run();
    expect(host.levels).toEqual([{ town: 3, where: { x: 7, y: 8 } }]);
  });
});

describe('affect nodes', () => {
  it('gives and takes gold and food', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_GOLD, ex1a: 500, ex1b: 0, jumpto: 1 },
      1: { type: SpecType.AFFECT_FOOD, ex1a: 30, ex1b: 1 },
    });
    univ.party.gold = 100;
    univ.party.food = 100;
    await run();
    expect(univ.party.gold).toBe(600);
    expect(univ.party.food).toBe(70);
  });

  it('heals the party', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.AFFECT_HP, ex1a: 10, ex1b: 0 } });
    univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
    await run();
    for (const pc of univ.party.pcs) expect(pc.curHealth).toBeGreaterThan(1);
  });

  it('teaches a spell to one chosen character', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.SELECT_TARGET, ex1a: 1, ex2a: 0, jumpto: 1 },
      1: { type: SpecType.AFFECT_MAGE_SPELL, ex1a: 30, ex1b: 0 },
    });
    host.pcAnswer = 2;
    await run();
    expect(univ.party.pcs[2]!.mageSpells[30]).toBe(true);
    expect(univ.party.pcs[0]!.mageSpells[30]).toBe(false);
  });

  it('raises a skill, capped at its maximum', async () => {
    const { univ, run } = withNodes({
      // pic is a percentage chance; 101 always lands.
      0: { type: SpecType.AFFECT_STAT, ex2a: 15, ex1a: 3, ex1b: 0, pic: 101 },
    });
    const before = univ.party.pcs[0]!.skills[15]!;
    await run();
    expect(univ.party.pcs[0]!.skills[15]).toBe(before + 3);
  });

  /**
   * A generic add-and-clamp on `status[]` used to land the number with no
   * visible effect: the message ("X diseased.") and the sound both come from
   * `cPlayer::disease`, not from the special node, so a scenario's "you feel
   * ill" node looked like a no-op even though the status array changed.
   *
   * The status type lives in **ex1c**, not ex2a — the first pass at this fix
   * read the wrong field, so a real node (ex2a always -1, unused) still hit
   * the range guard and bailed before doing anything. This scenario node
   * (valleydy out2~0.spec node 2, the "drink the tainted water" event) is
   * what caught it: `ex1a=5, ex1b=1, ex1c=7` (DISEASE).
   */
  it('AFFECT_STATUS routes disease through cPlayer::disease, with its message', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_STATUS, ex1a: 5, ex1b: 1, ex1c: Status.DISEASE },
    });
    const pc = univ.party.pcs[0]!;
    pc.status[Status.DISEASE] = 0;
    await run();
    expect(pc.status[Status.DISEASE]).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('diseased'))).toBe(true);
  });

  it('AFFECT_STATUS poisons with the saving-throw method, not a raw set', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_STATUS, ex1a: 4, ex1b: 1, ex1c: Status.POISON },
    });
    const pc = univ.party.pcs[0]!;
    pc.status[Status.POISON] = 0;
    await run();
    expect(pc.status[Status.POISON]).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('poisoned'))).toBe(true);
  });

  /**
   * The exact real node this was found from: valleydy's out2~0.spec node 2,
   * reached from node 1's "Do you drink some?" dialog (ONCE_DIALOG, ex1a=28
   * "Drink" jumping to node 2). Pinned directly against the scenario's own
   * data rather than a synthetic node, so a future field-numbering slip in
   * either direction shows up here too.
   */
  it('the scenario\'s own "drink the tainted water" node diseases the party', async () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.attachSpecials(new TestHost());
    session.startNewGame();
    univ.party.outdoorCorner = { x: 2, y: 0 };
    univ.party.iwc = { x: 0, y: 0 };
    const node = univ.out.sector.specials.get(2)!;
    expect(node.type).toBe(SpecType.AFFECT_STATUS);
    expect(node.ex1c).toBe(Status.DISEASE);

    for (const pc of univ.party.pcs) pc.status[Status.DISEASE] = 0;
    await session.runSpecialRaw(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 2, { x: 0, y: 0 });
    expect(univ.party.pcs.every((pc) => (pc.status[Status.DISEASE] ?? 0) > 0)).toBe(true);
    expect(univ.transcript.some((l) => l.includes('diseased'))).toBe(true);
  });
});

describe("a node's default target", () => {
  // `current_pc_picked_in_spec_enc` (boe.specials.cpp:4749) and `get_target_i`
  // (universe.cpp:1122). The default is not "the whole party": seven trigger
  // modes take the creature on the trigger square instead, numbered
  // `100 + slot`, and nine of the AFFECT opcodes then do **nothing at all**
  // rather than falling back to the party.
  it('is the creature on the square for a KILL_MONST chain', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: 20, ex1b: 0 },
    });
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    const before = univ.party.pcs.map((pc) => pc.experience);
    await run(0, SpecCtx.KILL_MONST, monst.curLoc);
    expect(univ.party.pcs.map((pc) => pc.experience)).toEqual(before);
  });

  it('is the whole party when the trigger square is empty', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: 20, ex1b: 0 },
    });
    // Somewhere with nothing standing on it.
    const before = univ.party.pcs.map((pc) => pc.experience);
    await run(0, SpecCtx.KILL_MONST, { x: 1, y: 1 });
    expect(univ.party.pcs.map((pc) => pc.experience)).not.toEqual(before);
  });

  it('takes only a monster for a TARGET chain, never a PC', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: 20, ex1b: 0 },
    });
    const before = univ.party.pcs.map((pc) => pc.experience);
    // The party's own square: `target_there(where, TARG_MONST)` finds nothing
    // there, so the default is the party and the node fires.
    await run(0, SpecCtx.TARGET, univ.party.townLoc);
    expect(univ.party.pcs.map((pc) => pc.experience)).not.toEqual(before);
  });
});

describe('AFFECT_XP', () => {
  // boe.specials.cpp:2936 — three arms, and the middle one is `award_xp` with
  // `force`, not a bare addition to `experience`.
  it('goes through award_xp, which scales by the level bracket', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: 100, ex1b: 0 },
    });
    const pc = univ.party.pcs[0]!;
    pc.level = 1;
    pc.expAdj = 100;
    pc.experience = 0;
    await run(0, SpecCtx.TOWN_MOVE, { x: 1, y: 1 });
    // xp_percent[0] is 150, so 100 points become 150 — not 100.
    expect(pc.experience).toBe(150);
  });

  it('drains rather than awards when ex1b is set', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: 40, ex1b: 1 },
    });
    for (const pc of univ.party.pcs) pc.experience = 100;
    await run(0, SpecCtx.TOWN_MOVE, { x: 1, y: 1 });
    expect(univ.party.pcs[0]!.experience).toBe(60);
  });

  it('sets the level threshold when ex1a is negative', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_XP, ex1a: -1, ex1b: 0 },
    });
    const pc = univ.party.pcs[0]!;
    pc.experience = 0;
    await run(0, SpecCtx.TOWN_MOVE, { x: 1, y: 1 });
    expect(pc.experience).toBe(pc.level * pc.getTnl());
  });
});

describe('a monster\'s dying special', () => {
  // `kill_monst` runs its `KILL_MONST` chain at boe.specials.cpp:1623 and only
  // writes `which_m.active = DEAD` at :1677, so the chain's default target is
  // **the creature that just died**. This port queues its chains, so by the
  // time one runs the creature is dead and `target_there` would find nothing —
  // `runSpecial`'s `seedTarget` pins what the C++ resolves lazily.
  // Skill points rather than experience: killing something awards experience
  // by itself, which would drown out what the node did.
  const skillNode = { 0: { type: SpecType.AFFECT_SKILL_PTS, ex1a: 5, ex1b: 0 } };

  it('does nothing, because a monster target is not "everyone"', async () => {
    const { univ, session } = withNodes(skillNode);
    const monst = univ.town!.monsters.find((m) => m.isAlive)!;
    monst.specialOnKill = 0;
    const before = univ.party.pcs.map((pc) => pc.skillPts);
    killMonst(univ, monst, 6, MainStatus.DEAD, session);
    await session.settled();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(univ.party.pcs.map((pc) => pc.skillPts)).toEqual(before);
  });

  it('and the same node from a plain move does hit everyone', async () => {
    // The control: without a creature on the trigger square the default target
    // is the party, so the node lands. If this fails the test above proves
    // nothing.
    const { univ, run } = withNodes(skillNode);
    const before = univ.party.pcs[0]!.skillPts;
    await run(0, SpecCtx.TOWN_MOVE, { x: 1, y: 1 });
    expect(univ.party.pcs[0]!.skillPts).toBe(before + 5);
  });
});

describe('every .spec node in the bundled scenario', () => {
  it('runs without throwing', async () => {
    // Not a fidelity check — a crash check. Every node in the start town gets
    // executed with a recording host, which exercises the dispatch table and
    // every handler's argument handling against real scenario data.
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.attachSpecials(new TestHost());
    session.startTownMode(0, FORCED_ENTRY);
    const nodes = [...(univ.town!.record.specials.keys())];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      await session.runSpecialRaw(
        SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, node, { x: 5, y: 5 });
    }
  });
});

describe('a scripted square that is also a door', () => {
  /**
   * Both halves of the ordering `check_special_terrain` imposes: the node runs
   * *before* the terrain switch, so one step both fires the chain and opens the
   * door; and a node that blocks stops the door opening at all.
   *
   * This port used to run the node from `town_move_party`, after
   * `check_special_terrain` had already returned — which meant a closed door
   * swallowed the step and the chain only fired on the *second* bump. The
   * corpus caught it as a message box appearing one action late.
   */
  function doorWithNode(node: Partial<SpecialNode>) {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    const host = new TestHost();
    session.attachSpecials(host);
    session.startTownMode(0, FORCED_ENTRY);
    const town = univ.town!.record;

    // Find a closed door, and hang a node on it.
    let where: { x: number; y: number } | null = null;
    for (let x = 1; x < town.maxDim - 1 && !where; x++)
      for (let y = 1; y < town.maxDim - 1 && !where; y++)
        if (univ.terrainType(town.terrain[x]![y]!).special === TerSpec.CHANGE_WHEN_STEP_ON)
          where = { x, y };
    if (!where) throw new Error('no step-on door in the start town');

    town.specialLocs = [{ ...where, spec: 0 }];
    town.specials = new Map([[0, { ...emptySpecialNode(), ...node }]]);
    town.specStrs = ['the door speaks'];
    univ.party.townLoc = { x: where.x, y: where.y + 1 };
    session.center = { ...univ.party.townLoc };
    return { univ, session, host, where, town };
  }

  it('fires the chain on the same step that opens the door', async () => {
    const { session, host, where, town, univ } = doorWithNode(
      { type: SpecType.DISPLAY_MSG, m1: 0 });
    const opened = univ.terrainType(town.terrain[where.x]![where.y]!).flag1;

    // The door blocked the way, so the step itself is refused — but the
    // message has already been shown and the door is open.
    expect(await session.move(Direction.N)).toBe(false);
    expect(host.messages).toHaveLength(1);
    expect(town.terrain[where.x]![where.y]).toBe(opened);
  });

  it('a node that blocks the step stops the door opening', async () => {
    const { session, host, where, town } = doorWithNode({ type: SpecType.CANT_ENTER, ex2a: 1 });
    const before = town.terrain[where.x]![where.y]!;

    expect(await session.move(Direction.N)).toBe(false);
    expect(town.terrain[where.x]![where.y]).toBe(before);
    expect(host.messages).toHaveLength(0);
  });
});

describe('TOWN_LIFT_FOG', () => {
  /**
   * `fog_lifted = spec.ex1a` (boe.specials.cpp:4292) is a **one-action flag**,
   * cleared at the tail of `advance_time`, that short-circuits `party_can_see`
   * to "is it on screen" (boe.locutils.cpp:525). It is not the same as marking
   * the town explored, which is permanent and saved with the game — that is
   * what this port used to do, with the polarity reversed as well.
   */
  it('raises a one-action flag rather than exploring the town', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_LIFT_FOG, ex1a: 1 },
    });
    const town = univ.town!;
    // Somewhere on screen the party has never been.
    const far = { x: univ.party.townLoc.x, y: univ.party.townLoc.y + 3 };
    town.explored[far.x]![far.y] = 0;
    expect(town.isExplored(far.x, far.y)).toBe(false);

    await run(0);
    expect(session.fogLifted).toBe(true);
    expect(session.partyCanSee(far)).toBe(1);
    // **Not** explored: the flag is the whole mechanism.
    expect(town.isExplored(far.x, far.y)).toBe(false);

    // A turn puts it back down.
    await session.afterPartyTurn();
    expect(session.fogLifted).toBe(false);
  });

  /** `fog_lifted = spec.ex1a` — an int into a bool, so zero is the one that clears. */
  it('takes ex1a as the flag, so zero puts the fog back', async () => {
    const { session, run } = withNodes({
      0: { type: SpecType.TOWN_LIFT_FOG, ex1a: 1 },
      1: { type: SpecType.TOWN_LIFT_FOG, ex1a: 0 },
    });
    await run(0);
    expect(session.fogLifted).toBe(true);
    await run(1);
    expect(session.fogLifted).toBe(false);
  });
});

/**
 * `TOWN_START_TARGETING` (boe.specials.cpp:4295) — the node that hands the
 * targeting cursor to the *player*, with `eSpell::NONE` in the air and its own
 * `jumpto` standing in for the caster.
 */
describe('a node asking the player to pick a square', () => {
  it('arms town targeting, with jumpto where the caster would be', async () => {
    const { session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, jumpto: 3, ex1a: SpellPat.RADIUS_2, ex2a: 4 },
    });
    await run(0);
    expect(session.mode).toBe(GameMode.TOWN_TARGET);
    expect(session.townTarget?.spell).toBe(Spell.NONE);
    expect(session.townTarget?.whoCast).toBe(3);
    expect(session.townTarget?.pattern).toBe(SpellPat.RADIUS_2);
    expect(session.townTarget?.freebie).toBe(true);
    expect(session.spellCaster).toBe(3);
    expect(session.specTargetType).toBe(SpecCtxType.TOWN);
    expect(session.specTargetFail).toBe(4);
  });

  /**
   * `if(num == eSpell::NONE);` is an empty statement, so the second line a
   * real spell prints — which key cancels it — is missing here.
   */
  it('says "Target spell." and nothing about a cancel key', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3 },
    });
    await run(0);
    expect(univ.transcript.at(-1)).toBe('  Target spell.');
  });

  it('refuses a pattern outside 0 - 7 and stays in town', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, jumpto: 3, ex1a: 8 },
    });
    await run(0);
    expect(univ.transcript.at(-1)).toBe('  Error: Invalid spell pattern (0 - 7).');
    expect(session.mode).toBe(GameMode.TOWN);
  });

  it('refuses a multi-square targeting out of combat', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex1c: 4 },
    });
    await run(0);
    expect(univ.transcript.at(-1)).toBe('  Target: Only in combat');
    expect(session.mode).toBe(GameMode.TOWN);
  });

  /**
   * `spec_target_options`: units from ex2b, tens from ex2c — and the tens are
   * `if(>0) += 20; else if(==0) += 10;`, so a negative ex2c adds neither.
   */
  it.each([
    [0, 0, 10],
    [1, 0, 11],
    [0, 1, 20],
    [1, 5, 21],
    [1, -1, 1],
    [0, -1, 0],
  ])('ex2b=%i ex2c=%i gives options %i', async (ex2b, ex2c, want) => {
    const { session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex2b, ex2c },
    });
    await run(0);
    expect(session.specTargetOptions).toBe(want);
  });

  it('runs jumpto when the square is picked, not a spell', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex2a: 4 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    await run(0);
    // A square the party can see: right next to it.
    const at = { ...univ.party.townLoc, x: univ.party.townLoc.x + 1 };
    await castTownSpell(session, at);
    expect(univ.party.getSdf(2, 2)).toBe(77);
    // It did not fail, so the failure node never ran.
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(0);
    expect(session.mode).toBe(GameMode.TOWN);
  });

  /**
   * `bool failed = town_spell == eSpell::NONE && adjust > 4;` — in town the
   * *only* way a node's targeting fails is a square the party cannot see. The
   * node's own answer is read and thrown away.
   */
  it('queues the failure node for a square it cannot see', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex2a: 4 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    await run(0);
    // Far enough off that can_see_light gives up.
    await castTownSpell(session, { x: univ.party.townLoc.x + 20, y: univ.party.townLoc.y });
    expect(univ.transcript.at(-1)).toBe("  Can't see target.");
    expect(univ.party.getSdf(2, 2)).toBe(0);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });

  /**
   * In combat it is the *spell* targeting that gets armed, taking its range
   * from `ex1b` and its shape from `ex1a` — the two things a real spell would
   * have read out of the spell table.
   */
  it('in combat, arms spell targeting and runs jumpto on the square', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, ex1b: 6,
        jumpto: 3, ex2a: 4 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 20;
    await run(0);
    expect(session.mode).toBe(GameMode.SPELL_TARGET);
    expect(session.spellTargeting?.spell).toBe(Spell.NONE);
    expect(session.spellTargeting?.range).toBe(6);
    expect(session.spellTargeting?.fancy).toBeFalsy();

    const at = { ...univ.currentPc.combatPos, x: univ.currentPc.combatPos.x + 1 };
    await doCombatCast(session, at);
    expect(univ.party.getSdf(2, 2)).toBe(77);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(0);
  });

  /** `ex1c > 1` in combat is the fancy path, and it is that many squares. */
  it('takes ex1c squares when it is more than one', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, ex1b: 6,
        ex1c: 3, jumpto: 3 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
    });
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    await run(0);
    expect(session.mode).toBe(GameMode.FANCY_TARGET);
    expect(session.spellTargeting?.targetsLeft).toBe(3);
  });

  /**
   * `failed` starts true for a node's targeting and every refusal leaves it
   * that way — the C++ chains them with `else if` and falls through to the
   * `if(failed)` at the tail of the loop. A target out of range is one.
   */
  it('a refused combat target still queues the failure node', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, ex1b: 1,
        jumpto: 3, ex2a: 4 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 20;
    await run(0);
    const from = univ.currentPc.combatPos;
    await doCombatCast(session, { ...from, x: from.x + 4 });
    expect(univ.transcript.at(-1)).toBe('  Target out of range.');
    expect(univ.party.getSdf(2, 2)).toBe(0);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });

  /** `failed = r1` — the node's own answer is the last word in combat. */
  it('a node that answers positive counts as a failure', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, ex1b: 6,
        jumpto: 3, ex2a: 4 },
      3: { type: SpecType.CANT_ENTER, ex1a: 1 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 20;
    await run(0);
    const from = univ.currentPc.combatPos;
    await doCombatCast(session, { ...from, x: from.x + 1 });
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });

  /**
   * `if(town_spell == eSpell::NONE) queue_special(…, spec_target_fail, …)` in
   * *both* cancel arms of `handle_spellcast` (boe.actions.cpp:420, :439) —
   * walking away from a node's targeting is a failure it gets told about, and
   * a real spell's cancel queues nothing.
   */
  it('backing out of the targeting queues the failure node', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex2a: 4 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    await run(0);
    cancelTownTargeting(session);
    expect(session.mode).toBe(GameMode.TOWN);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });

  it('…and in combat too', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, ex1b: 6,
        jumpto: 3, ex2a: 4 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    session.startCombat(univ.party.direction);
    univ.curPc = 0;
    await run(0);
    cancelSpellTargeting(session);
    expect(session.mode).toBe(GameMode.COMBAT);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });

  /**
   * The tens digit at 1 — an `ex2c` of exactly 0 — refuses an antimagic
   * square, which is the one refusal a real town spell can never hit, since
   * nothing else ever writes `spec_target_options`.
   */
  it('refuses an antimagic square when ex2c is zero', async () => {
    const { univ, session, run } = withNodes({
      0: { type: SpecType.TOWN_START_TARGETING, ex1a: SpellPat.SINGLE, jumpto: 3, ex2a: 4, ex2c: 0 },
      3: { type: SpecType.SET_SDF, sd1: 2, sd2: 2, ex1a: 77 },
      4: { type: SpecType.SET_SDF, sd1: 2, sd2: 3, ex1a: 99 },
    });
    await run(0);
    const at = { ...univ.party.townLoc, x: univ.party.townLoc.x + 1 };
    univ.town!.setField(at.x, at.y, FieldType.FIELD_ANTIMAGIC, true);
    await castTownSpell(session, at);
    expect(univ.transcript.at(-1)).toBe('  Target in antimagic field.');
    expect(univ.party.getSdf(2, 2)).toBe(0);
    await session.specials!.drainQueue();
    expect(univ.party.getSdf(2, 3)).toBe(99);
  });
});

/**
 * `cast_spell_on_space` (boe.party.cpp:1473) — the square's own `IF_CONTEXT`
 * node gets to cancel a spell aimed at it. The node-type test is the C++'s,
 * and it is what keeps every other kind of square special from firing at a
 * spell.
 */
describe('a square intercepting a spell cast on it', () => {
  function squareWithNode(node: Partial<SpecialNode>) {
    const { univ, session } = withNodes({ 0: node });
    const where = { x: 5, y: 5 };
    univ.town!.record.specialLocs = [{ ...where, spec: 0 }];
    return { univ, session, where };
  }

  /**
   * **`IF_CONTEXT` does not do the cancelling itself.** Outside the three
   * movement contexts it only jumps (boe.specials.cpp's `if(ctx.which_mode <=
   * eSpecCtx::COMBAT_MOVE)` guards the `*a` it sets), so a square that means to
   * stop a spell branches to a `CANT_ENTER` and lets *that* answer.
   */
  it('an IF_CONTEXT that branches to a blocking node cancels the spell', async () => {
    const { univ, session } = withNodes({
      0: { type: SpecType.IF_CONTEXT, ex1a: SpecCtx.TARGET, ex1c: 1 },
      1: { type: SpecType.CANT_ENTER, ex1a: 1 },
    });
    const where = { x: 5, y: 5 };
    univ.town!.record.specialLocs = [{ ...where, spec: 0 }];
    expect(await session.castSpellOnSpace(where, Spell.LIGHT)).toBe(false);
  });

  it('…and one whose context does not match lets it through', async () => {
    const { univ, session } = withNodes({
      0: { type: SpecType.IF_CONTEXT, ex1a: SpecCtx.TOWN_MOVE, ex1c: 1 },
      1: { type: SpecType.CANT_ENTER, ex1a: 1 },
    });
    const where = { x: 5, y: 5 };
    univ.town!.record.specialLocs = [{ ...where, spec: 0 }];
    expect(await session.castSpellOnSpace(where, Spell.LIGHT)).toBe(true);
  });

  it('a node of any other type never fires at all', async () => {
    const { session, where } = squareWithNode({ type: SpecType.DISPLAY_MSG, m1: 0 });
    expect(await session.castSpellOnSpace(where, Spell.LIGHT)).toBe(true);
  });

  it('an empty square lets it through, and Sanctify says so', async () => {
    const { univ, session } = squareWithNode({ type: SpecType.NONE });
    univ.town!.record.specialLocs = [];
    expect(await session.castSpellOnSpace({ x: 9, y: 9 }, Spell.LIGHT)).toBe(true);
    expect(univ.transcript.at(-1)).not.toBe('  Nothing happens.');
    expect(await session.castSpellOnSpace({ x: 9, y: 9 }, Spell.RITUAL_SANCTIFY)).toBe(true);
    expect(univ.transcript.at(-1)).toBe('  Nothing happens.');
  });
});
