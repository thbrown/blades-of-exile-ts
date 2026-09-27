import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { TalkNodeType, emptyTalkNode } from '../src/data/talking';
import { Vehicle } from '../src/data/vehicle';
import { GameMode } from '../src/game/modes';
import { EncounterNotesPager, EventJournalPager, TalkNotesPager, notesRefusal } from '../src/game/notes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { TalkAction } from '../src/game/talk';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { setGiveHelp } from '../src/universe/living';
import { EncNoteType, TalkNote } from '../src/universe/party';
import { PartyPreset } from '../src/universe/player';
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

afterEach(() => setGiveHelp(null));

/** A session standing next to the first talkable NPC in the start town. */
async function talkingSession(): Promise<GameSession> {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  const who = univ.town!.monsters.find((m) => m.isAlive && m.personality >= 0 && m.isFriendly);
  if (!who) throw new Error('no talkable NPC in the start town');
  univ.party.townLoc = { x: who.curLoc.x, y: who.curLoc.y + 1 };
  session.center = { ...univ.party.townLoc };
  expect(await session.talkTo(who.curLoc)).toBe(true);
  return session;
}

describe('Record in a conversation', () => {
  it('notes the reply on screen, with the speaker and the town, once', async () => {
    const helps: number[] = [];
    setGiveHelp((h) => helps.push(h));
    const session = await talkingSession();
    const { univ } = session;
    const talk = session.talk!;
    await session.chooseTalkNode(TalkAction.JOB);
    const [str1, str2] = [talk.str1, talk.str2];

    await session.chooseTalkNode(TalkAction.RECORD);
    expect(univ.party.talkSave).toEqual([{
      whoSaid: talk.person!.title,
      inTown: univ.town!.record.name,
      str1,
      str2,
      inScen: scen.id,
    }]);
    // `give_help(57,0)` — which in a replay eats the next click.
    expect(helps).toEqual([57]);

    await session.chooseTalkNode(TalkAction.RECORD);
    expect(univ.party.talkSave).toHaveLength(1);
    // The refusal comes before the help box, so it shows only once.
    expect(helps).toEqual([57]);
    expect(univ.transcript.join('\n')).toContain('This is already saved.');
  });
});

describe('BUY_SHIP and BUY_HORSE', () => {
  function boat(property: boolean): Vehicle {
    return {
      loc: { x: 0, y: 0 }, sector: { x: 0, y: 0 }, whichTown: 0,
      exists: true, property, pic: 0, name: 'Boat',
    };
  }

  /** A town with one synthetic node, run once with `gold` in the purse. */
  function buy(type: TalkNodeType, fleet: boolean[], a: number, b: number, c: number, gold: number) {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(0, FORCED_ENTRY);
    const speech = scen.townTalk[0]!;
    const personality = speech.people.findIndex((p) => p.title !== '');
    const node = {
      ...emptyTalkNode(), type, personality, extras: [a, b, c, 0],
      str1: 'Sold!', str2: 'Come back with money.',
    };
    speech.talkNodes.push(node);
    try {
      const vehicles = fleet.map(boat);
      if (type === TalkNodeType.BUY_SHIP) univ.party.boats = vehicles;
      else univ.party.horses = vehicles;
      univ.party.gold = gold;
      session.startTalkMode(-1, personality, 0, -1);
      void session.chooseTalkNode(speech.talkNodes.length - 1);
      return { vehicles, gold: univ.party.gold, reply: session.talk!.str1, talk: session.talk! };
    } finally {
      speech.talkNodes.pop();
    }
  }

  it('sells the first vehicle still for sale and charges for it', () => {
    const r = buy(TalkNodeType.BUY_SHIP, [false, false, true, true], 50, 1, 2, 80);
    expect(r.vehicles.map((v) => v.property)).toEqual([false, false, false, true]);
    expect(r.gold).toBe(30);
    expect(r.reply).toBe('Sold!');
  });

  it('shows the second string when the party is short, and sells nothing', () => {
    const r = buy(TalkNodeType.BUY_HORSE, [true], 50, 0, 0, 49);
    expect(r.vehicles[0]!.property).toBe(true);
    expect(r.gold).toBe(49);
    expect(r.reply).toBe('Come back with money.');
  });

  it('walks b..b+c inclusive, as the 1997 original does', () => {
    // One past "Total number of boats sold". OBoE stops at b+c-1.
    const r = buy(TalkNodeType.BUY_SHIP, [false, false, true], 10, 0, 2, 10);
    expect(r.vehicles[2]!.property).toBe(false);
    expect(r.gold).toBe(0);
  });

  it('says so, and keeps the gold, once the range is sold out', () => {
    // OBoE would charge here and "sell" boats[b+c]: DIVERGENCES.md #5.
    const r = buy(TalkNodeType.BUY_SHIP, [false, false, true, true], 10, 0, 1, 100);
    expect(r.gold).toBe(100);
    expect(r.vehicles.map((v) => v.property)).toEqual([false, false, true, true]);
    expect(r.reply).toBe('There are no boats left.');
    expect(r.talk.canRecord).toBe(false);
    expect(buy(TalkNodeType.BUY_HORSE, [], 10, 0, 3, 100).reply)
      .toBe('There are no horses left.');
  });
});

describe('the journals', () => {
  const note = (s: string): TalkNote =>
    ({ whoSaid: 'X', inTown: 'Y', str1: s, str2: '', inScen: 'z' });

  it('refuse to open empty, and talk notes refuse mid-conversation', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    expect(notesRefusal(univ, GameMode.TOWN, 'talk')).toBe('Nothing in your talk journal.');
    expect(notesRefusal(univ, GameMode.TOWN, 'encounter')).toBe('Nothing in your journal.');
    univ.party.talkSave.push(note('a'));
    univ.party.record(EncNoteType.TOWN, 'n', 'w');
    expect(notesRefusal(univ, GameMode.TOWN, 'talk')).toBeNull();
    expect(notesRefusal(univ, GameMode.TALKING, 'talk')).toBe("Talking notes: Can't read while talking.");
    expect(notesRefusal(univ, GameMode.TALKING, 'encounter')).toBeNull();
  });

  it('talk notes page with wrap-around and close when the last is deleted', () => {
    const notes = [note('a'), note('b'), note('c')];
    const pager = new TalkNotesPager(notes);
    expect(pager.arrows).toBe(true);
    pager.click('left');
    expect(pager.shown?.str1).toBe('c');
    // Deleting the last page wraps to the first.
    expect(pager.click('del')).toBe(false);
    expect(pager.shown?.str1).toBe('a');
    expect(pager.click('del')).toBe(false);
    expect(pager.shown?.str1).toBe('b');
    expect(pager.click('del')).toBe(true);
    expect(notes).toEqual([]);
    expect(new TalkNotesPager([note('a')]).arrows).toBe(false);
  });

  it('encounter notes keep the page count they opened with', () => {
    const notes = ['1', '2', '3', '4'].map((s) => ({ type: EncNoteType.TOWN, theStr: s, where: '' }));
    const pager = new EncounterNotesPager(notes);
    expect(pager.arrows).toBe(true);
    pager.click('right');
    expect(pager.rows.map((n) => n?.theStr)).toEqual(['4', undefined, undefined]);
    pager.click('del1');
    // Page two is empty now, and the arrows still reach it.
    expect(pager.rows).toEqual([undefined, undefined, undefined]);
    pager.click('right');
    expect(pager.rows.map((n) => n?.theStr)).toEqual(['1', '2', '3']);
    pager.click('left');
    expect(pager.rows).toEqual([undefined, undefined, undefined]);
    expect(pager.click('done')).toBe(true);
  });
});

describe('the events journal', () => {
  it('refuses when empty, and pages three at a time where OBoE shows page one', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    expect(notesRefusal(univ, GameMode.TOWN, 'events')).toBe('Nothing in your events journal.');
    for (let i = 1; i <= 4; i++) univ.party.addToJournal(`entry ${i}`, i, 'valleydy');
    expect(notesRefusal(univ, GameMode.TALKING, 'events')).toBeNull();
    const pager = new EventJournalPager(univ.party.journal);
    expect(pager.arrows).toBe(true);
    expect(pager.rows.map((e) => e?.theStr)).toEqual(['entry 1', 'entry 2', 'entry 3']);
    pager.click('right');
    expect(pager.rows.map((e) => e?.theStr)).toEqual(['entry 4', undefined, undefined]);
    pager.click('right');
    expect(pager.page).toBe(0);
    pager.click('left');
    expect(pager.page).toBe(1);
    expect(pager.click('done')).toBe(true);
  });
});
