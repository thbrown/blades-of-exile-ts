/**
 * A party that outlives its scenario: made with no scenario at all, saved as
 * the party in memory, carried out of one scenario and into another —
 * `put_party_in_scen` and `enter_scenario`, which the startup screen uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemAbil, ItemPreset, ItemType, presetItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { applyPartySave, openSave, readSavePreview, saveGame } from '../src/fileio/saveIo';
import { noScenario } from '../src/fileio/scenarioXml';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession, carriedOutOfScenario } from '../src/game/session';
import { EncNoteType, TOWN_NUM_OUTDOORS } from '../src/universe/party';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Race, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);
const load = (id: string): Promise<Scenario> => loadScenario(
  new FsSource(fileURLToPath(new URL(`../public/scenarios/${id}`, import.meta.url))), opcodes);

let valleydy: Scenario;
let stealth: Scenario;
beforeAll(async () => {
  [valleydy, stealth] = await Promise.all([load('valleydy'), load('stealth')]);
});

const noQuestions = { removedSpecialItems: async () => {}, keepStoredItems: async () => false };

/** The party from `saved`, walked into `scen`. */
async function enter(
  scen: Scenario, saved: Uint8Array, ask = noQuestions,
): Promise<GameSession> {
  const univ = new Universe(scen, new GameRng());
  applyPartySave(saved, univ);
  const session = new GameSession(univ);
  await session.enterWithParty(ask, true);
  return session;
}

describe('a party with no scenario', () => {
  it('is made in a Universe with no scenario and saved alone', () => {
    const univ = new Universe(noScenario(), new GameRng(), PartyPreset.DEFAULT);
    for (const pc of univ.party.pcs) if (pc.mainStatus === MainStatus.ALIVE) pc.finishCreate();
    const saved = saveGame(univ, true);
    expect(readSavePreview(saved).scenarioId).toBe('');
    expect(openSave(saved).text('save/scenario.txt')).toBeUndefined();
    expect(readSavePreview(saved).pcs.map((p) => p.name)).toEqual(univ.party.pcs.map((pc) => pc.name));
  });

  it('can walk into a scenario', async () => {
    const univ = new Universe(noScenario(), new GameRng(), PartyPreset.DEFAULT);
    for (const pc of univ.party.pcs) if (pc.mainStatus === MainStatus.ALIVE) pc.finishCreate();
    const knives = univ.party.pcs.map((pc) => pc.items.filter((it) => it.variety !== ItemType.NO_ITEM).length);
    const session = await enter(valleydy, saveGame(univ, true));
    expect(session.univ.party.townNum).toBe(valleydy.startTown);
    // finish_create ran once, at making; entering doesn't hand out a second kit.
    expect(session.univ.party.pcs.map((pc) => pc.items.filter((it) => it.variety !== ItemType.NO_ITEM).length))
      .toEqual(knives);
  });
});

describe('leaving one scenario for another', () => {
  async function veteran(): Promise<{ saved: Uint8Array; level: number; xp: number }> {
    const session = new GameSession(new Universe(valleydy, new GameRng(), PartyPreset.DEFAULT));
    session.startNewGame(true);
    const { party } = session.univ;
    const pc = party.pcs[0]!;
    pc.level = 7;
    pc.experience = 1234;
    pc.status[Status.POISON] = 3;
    pc.curHealth = 1;
    party.gold = 4321;
    party.age = 50000;
    party.setSdf(10, 2, 5);
    party.specialNotes.push({ type: EncNoteType.SCEN, theStr: 'a note', where: 'x', inScen: '' } as never);
    party.imprisonedMonst[0] = 12;
    party.mSeen.add(3);
    const custom = presetItem(ItemPreset.KNIFE);
    custom.graphicNum = 1002;
    const caller = presetItem(ItemPreset.POTION);
    caller.ability = ItemAbil.CALL_SPECIAL;
    pc.items = [presetItem(ItemPreset.KNIFE), custom, caller, ...pc.items.slice(3)];
    party.storedItems.set(3, [presetItem(ItemPreset.HELM)]);
    return { saved: saveGame(session.univ, true), level: 7, xp: 1234 };
  }

  it('keeps what the party earned', async () => {
    const { saved, level, xp } = await veteran();
    const { party } = (await enter(stealth, saved)).univ;
    expect(party.gold).toBe(4321);
    expect(party.pcs[0]!.level).toBe(level);
    expect(party.pcs[0]!.experience).toBe(xp);
    expect(party.pcs[0]!.items[0]!.variety).toBe(ItemType.ONE_HANDED);
  });

  it("forgets what belonged to the last scenario (the original's list)", async () => {
    const { party } = (await enter(stealth, (await veteran()).saved)).univ;
    expect(party.age).toBe(0);
    expect(party.getSdf(10, 2)).toBe(0);
    expect(party.specialNotes).toEqual([]);
    expect(party.imprisonedMonst).toEqual([0, 0, 0, 0]);
    expect(party.mSeen.size).toBe(0);
    expect(party.storedItems.size).toBe(0);
    expect(party.pcs[0]!.status[Status.POISON]).toBe(0);
    expect(party.pcs[0]!.curHealth).toBe(party.pcs[0]!.maxHealth);
    expect(party.townNum).toBe(stealth.startTown);
    expect(party.townNum).not.toBe(TOWN_NUM_OUTDOORS);
  });

  it('takes away special items, saying so', async () => {
    let told = 0;
    const { party } = (await enter(stealth, (await veteran()).saved, {
      ...noQuestions, removedSpecialItems: async () => { told++; },
    })).univ;
    expect(told).toBe(1);
    const kept = party.pcs[0]!.items.filter((it) => it.variety !== ItemType.NO_ITEM);
    expect(kept.some((it) => it.graphicNum >= 1000)).toBe(false);
    expect(kept.some((it) => it.ability === ItemAbil.CALL_SPECIAL)).toBe(false);
  });

  it('hands over the stored items on yes', async () => {
    const saved = (await veteran()).saved;
    const helms = (s: GameSession): number => s.univ.party.pcs
      .flatMap((pc) => pc.items).filter((it) => it.variety === ItemType.HELM).length;
    const before = helms(await enter(stealth, saved));
    const after = helms(await enter(stealth, saved, { ...noQuestions, keepStoredItems: async () => true }));
    expect(after).toBe(before + 1);
  });
});

describe('carriedOutOfScenario', () => {
  it('keeps slayers of ordinary races but not of IMPORTANT ones', () => {
    const slayer = presetItem(ItemPreset.KNIFE);
    slayer.ability = ItemAbil.SLAYER_WEAPON;
    slayer.abilData = Race.UNDEAD;
    expect(carriedOutOfScenario(slayer)).toBe(true);
    slayer.abilData = Race.IMPORTANT;
    expect(carriedOutOfScenario(slayer)).toBe(false);
  });
});
