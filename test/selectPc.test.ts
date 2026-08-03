/**
 * `select_pc`'s eight modes, and the dialogs the give/drop actions answer with
 * them — including the ones a replay reads out of a recording.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import {
  SELECT_PC_CANCEL, SELECT_PC_NONE, SelectPcMode, runSelectPc, selectPcOptions,
} from '../src/game/selectPc';
import { GameSession } from '../src/game/session';
import { parseXmlDoc } from '../src/fileio/xml';
import { ReplaySource, parseReplay } from '../src/replay/format';
import { makeReplayHost } from '../src/replay/host';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Skill } from '../src/universe/skills';
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

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  for (const pc of univ.party.pcs) {
    pc.items = pc.items.map(() => defaultItem());
    pc.equip.fill(false);
  }
  return session;
}

/** A replay host reading from a stream written here rather than from a file. */
async function hostOver(xml: string): Promise<{
  host: ReturnType<typeof makeReplayHost>; session: GameSession; source: ReplaySource;
}> {
  const session = newSession();
  const replay = parseReplay(await parseXmlDoc(`<actions>${xml}</actions>`, 'replay.xml'));
  const source = new ReplaySource(replay.actions);
  return { host: makeReplayHost(session, source), session, source };
}

describe('select_pc', () => {
  it('never offers the PC doing the giving, and says who is too far away', () => {
    const session = newSession();
    const { univ } = session;
    univ.curPc = 0;
    const item = { ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name: 'Rope', weight: 5 };
    // In combat, only PCs standing next to the giver may take it.
    univ.party.pcs.forEach((pc, i) => { pc.combatPos = { x: 10 + i * 3, y: 10 }; });
    univ.party.pcs[1]!.combatPos = { x: 11, y: 10 };
    const rows = selectPcOptions(univ, SelectPcMode.ONLY_CAN_GIVE_FROM_ACTIVE,
      { item, inCombat: true, curPc: 0 });
    expect(rows[0]!.canPick).toBe(false);
    expect(rows[0]!.extra).toBe('');
    expect(rows[1]!.canPick).toBe(true);
    expect(rows[2]!.canPick).toBe(false);
    expect(rows[2]!.extra).toBe('too far away');
  });

  it('refuses an item nobody can carry, with the reason on the row', () => {
    const session = newSession();
    const { univ } = session;
    const anvil = { ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name: 'Anvil', weight: 900 };
    const rows = selectPcOptions(univ, SelectPcMode.ONLY_CAN_GIVE, { item: anvil });
    expect(rows.every((r) => !r.canPick)).toBe(true);
    expect(rows[1]!.extra).toBe('item too heavy');
  });

  it('returns 8 without asking when nobody can be offered', async () => {
    const session = newSession();
    let asked = 0;
    session.univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    const who = await runSelectPc(
      session.univ, SelectPcMode.ONLY_LIVING, 'Who?',
      async () => { asked++; return 0; });
    expect(who).toBe(SELECT_PC_NONE);
    expect(asked).toBe(0);
  });

  it('says why for the two modes that explain themselves', async () => {
    const session = newSession();
    session.univ.party.pcs.forEach((pc) => { pc.skillPts = 0; });
    await runSelectPc(session.univ, SelectPcMode.ONLY_CAN_TRAIN, '', async () => 0);
    expect(session.univ.transcript.at(-1)).toContain('No one has skill points');
    await runSelectPc(session.univ, SelectPcMode.ONLY_CAN_LOCKPICK, '', async () => 0);
    expect(session.univ.transcript.at(-1)).toContain('No one has lockpicks equipped');
  });

  it('ONLY_DEAD offers anyone not alive, stone and dust included', () => {
    const session = newSession();
    const { univ } = session;
    univ.party.pcs[0]!.mainStatus = MainStatus.STONE;
    univ.party.pcs[1]!.mainStatus = MainStatus.DUST;
    const rows = selectPcOptions(univ, SelectPcMode.ONLY_DEAD);
    expect(rows[0]!.canPick).toBe(true);
    expect(rows[1]!.canPick).toBe(true);
    expect(rows[2]!.canPick).toBe(false);
  });

  it('shows the highlighted skill beside every name', () => {
    const session = newSession();
    session.univ.party.pcs[0]!.skills[Skill.STRENGTH] = 7;
    const rows = selectPcOptions(session.univ, SelectPcMode.ONLY_LIVING,
      { highlight: Skill.STRENGTH });
    expect(rows[0]!.label).toContain('(7)');
  });
});

describe('the dialogs a recording answers', () => {
  it('reads select-pc.xml by the last character of the control name', async () => {
    const { host } = await hostOver('<click_control><id>pick3</id><mods>0</mods></click_control>');
    const who = await host.selectPc([], 'Give item to who?');
    expect(who).toBe(2);
  });

  it('maps cancel to 6, the way the dialog does', async () => {
    const { host } = await hostOver('<click_control><id>cancel</id><mods>0</mods></click_control>');
    expect(await host.selectPc([], '')).toBe(SELECT_PC_CANCEL);
  });

  /**
   * `record_field_input` writes one action per keystroke, so the answer has to
   * be typed into a field rather than read out of a single action.
   */
  it('types "Ask about what?" one keystroke at a time, backspace included', async () => {
    const { host } = await hostOver(`
      <field_focus>response</field_focus>
      <field_input><c>p</c><mod>0</mod><spec>false</spec></field_input>
      <field_input><c>i</c><mod>0</mod><spec>false</spec></field_input>
      <field_input><c>x</c><mod>0</mod><spec>false</spec></field_input>
      <field_input><k>8</k><mod>0</mod><spec>true</spec></field_input>
      <field_input><c>T</c><mod>0</mod><spec>false</spec></field_input>
      <click_control><id>okay</id><mods>0</mods></click_control>`);
    // Lowercased on the way out, as `get_text_response` does.
    expect(await host.askText('Ask about what?')).toBe('pit');
  });

  it('a cancelled text prompt answers with nothing at all', async () => {
    const { host } = await hostOver(`
      <field_input><c>x</c><mod>0</mod><spec>false</spec></field_input>
      <click_control><id>cancel</id><mods>0</mods></click_control>`);
    expect(await host.askText('')).toBe('');
  });

  it('clamps a typed "how many?" to the stack, and cancel gives up the action', async () => {
    const big = await hostOver(`
      <field_input><c>9</c><mod>0</mod><spec>false</spec></field_input>
      <click_control><id>okay</id><mods>0</mods></click_control>`);
    expect(await big.host.getNumOfItems(4)).toBe(4);
    const stop = await hostOver('<click_control><id>cancel</id><mods>0</mods></click_control>');
    expect(await stop.host.getNumOfItems(4)).toBe(0);
  });

  it('a dialog this port raised that the recording never saw fails by name', async () => {
    const { host } = await hostOver('<move>(3,4)</move>');
    await expect(host.selectPc([], 'Give item to who?')).rejects.toThrow(
      /select-PC dialog "Give item to who\?"/);
  });
});

describe('the drop mode', () => {
  it('is armed by the item and finished by the square', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = { ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name: 'Rock', weight: 0 };
    const { handleDropItem } = await import('../src/game/giveDrop');
    await handleDropItem(session, 0, 0, null);
    expect(session.mode).toBe(GameMode.DROP_TOWN);
    expect(session.dropSlot).toBe(0);
    // Still in the pack: arming a drop moves nothing.
    expect(pc.items[0]!.name).toBe('Rock');
    // Pressing Drop again cancels it.
    await handleDropItem(session, 0, 0, null);
    expect(session.mode).toBe(GameMode.TOWN);
    expect(session.univ.transcript.at(-1)).toContain('Cancelled');
  });
});
