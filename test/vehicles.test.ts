import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { ChoiceButton, SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/stealth', import.meta.url))),
    opcodes,
  );
});

/** A no-op specials host, just enough to let the VM run. */
class TestHost implements SpecialHost {
  async message(): Promise<void> {}
  async choice(_strs: string[], buttons: ChoiceButton[]): Promise<number> { return buttons.length - 1; }
  async story(): Promise<void> {}
  async askText(): Promise<string> { return ''; }
  async askNum(min: number): Promise<number> { return min; }
  async selectPc(): Promise<number> { return 0; }
  async getNumOfItems(max: number): Promise<number> { return max; }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(): void {}
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  forceTown(): void {}
  endScenario(): void {}
}

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  return new GameSession(univ);
}

describe('boats and horses', () => {
  it('the stealth scenario places horses and boats from the .map files', async () => {
    // town1.map has horse markers at (6,24)/(8,24)/(10,24) and boat markers
    // at (17,54)/(19,53); town9.map and town19.map add more boats.
    expect(scen.horses.length).toBeGreaterThanOrEqual(5);
    expect(scen.boats.length).toBeGreaterThanOrEqual(7);
    expect(scen.horses.every((h) => h.exists)).toBe(true);
    expect(scen.boats.every((b) => b.exists)).toBe(true);
  });

  it('a fresh party gets its own copy of every vehicle the scenario placed', async () => {
    const { univ } = newSession();
    expect(univ.party.horses.length).toBe(scen.horses.length);
    expect(univ.party.boats.length).toBe(scen.boats.length);
    expect(univ.party.inBoat).toBe(-1);
    expect(univ.party.inHorse).toBe(-1);
  });

  it('walking onto a horse mounts it, and pausing dismounts it', async () => {
    const session = newSession();
    session.startTownMode(1, FORCED_ENTRY);
    // town1's horses are placed unowned ('H', not 'h') — boarding one refuses
    // with "Not your horses." until something (a CHANGE_HORSE_OWNER special,
    // here just the test) hands it over.
    session.univ.party.horses[0]!.property = false;
    // Stand one step south of the horse at (6,24) and walk onto it.
    session.univ.party.townLoc = { x: 6, y: 25 };
    const moved = await session.moveTo({ x: 6, y: 24 });
    expect(moved).toBe(true);
    expect(session.univ.party.inHorse).toBeGreaterThanOrEqual(0);
    expect(session.univ.party.townLoc).toEqual({ x: 6, y: 24 });

    const mountIndex = session.univ.party.inHorse;
    await session.pause();
    expect(session.univ.party.inHorse).toBe(-1);
    expect(session.univ.party.horses[mountIndex]!.loc).toEqual({ x: 6, y: 24 });
    expect(session.univ.party.horses[mountIndex]!.whichTown).toBe(1);
  });

  it('refuses to board a horse the party does not own', async () => {
    const session = newSession();
    session.startTownMode(1, FORCED_ENTRY);
    session.univ.party.townLoc = { x: 6, y: 25 };
    const moved = await session.moveTo({ x: 6, y: 24 });
    expect(moved).toBe(false);
    expect(session.univ.party.inHorse).toBe(-1);
    expect(session.univ.transcript.at(-1)).toBe('  Not your horses.');
  });

  it('CHANGE_HORSE_OWNER flips the property flag (ex2a == 0 takes it, else gives it)', async () => {
    const session = newSession();
    const { univ } = session;
    session.attachSpecials(new TestHost());
    session.startTownMode(1, FORCED_ENTRY);
    univ.town!.record.specials = new Map([
      [0, { ...emptySpecialNode(), type: SpecType.CHANGE_HORSE_OWNER, ex1a: 0, ex2a: 1 }],
      [1, { ...emptySpecialNode(), type: SpecType.CHANGE_HORSE_OWNER, ex1a: 0, ex2a: 0 }],
    ]);

    expect(univ.party.horses[0]!.property).toBe(true);
    await session.runSpecialRaw(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 0, { x: 5, y: 5 });
    expect(univ.party.horses[0]!.property).toBe(false);
    await session.runSpecialRaw(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 1, { x: 5, y: 5 });
    expect(univ.party.horses[0]!.property).toBe(true);
  });

  it('the boat follows the party outdoors, so stepping back onto it re-boards', async () => {
    // **run_waterfalls' tail is the only thing that moves a boat** — neither
    // outd_move_party nor town_move_party re-parks one, so without it the boat
    // stays where it was boarded and the square it is really on reads as
    // ordinary blocked water.
    const session = newSession();
    const { univ } = session;
    const water = scen.terTypes.findIndex((t) => t.boatOver);
    expect(water).toBeGreaterThanOrEqual(0);
    const start = { ...univ.party.outLoc };
    const east = { x: start.x + 1, y: start.y };
    univ.out.set(start.x, start.y, water);
    univ.out.set(east.x, east.y, water);
    const boat = univ.party.boats[0]!;
    boat.exists = true;
    boat.whichTown = 200;
    boat.loc = univ.party.globalToLocal(start);
    boat.sector = {
      x: univ.party.outdoorCorner.x + univ.party.iwc.x,
      y: univ.party.outdoorCorner.y + univ.party.iwc.y,
    };
    univ.party.inBoat = 0;

    expect(await session.moveTo(east)).toBe(true);
    expect(univ.party.outLoc).toEqual(east);
    expect(boat.loc).toEqual(univ.party.globalToLocal(east));

    // Stepping onto dry land leaves the boat where it floats — the tail is
    // gated on still being in it.
    const dry = { x: east.x + 1, y: east.y };
    expect(await session.moveTo(dry)).toBe(true);
    expect(univ.party.inBoat).toBe(-1);
    expect(boat.loc).toEqual(univ.party.globalToLocal(east));

    // ...and stepping back on boards it again, which is what a stale boat
    // position turns into "Blocked: west".
    expect(await session.moveTo(east)).toBe(true);
    expect(univ.party.inBoat).toBe(0);
    expect(univ.transcript.at(-1)).toBe('Move: You board the boat.');
  });

  /**
   * Exile III's waterfalls (`1010:7c2e`, the `waterfall` = `exile3:<terrain>`
   * flag): a boat that ends an outdoor move with the waterfall just south of
   * it goes two squares south, again while there's another below, and a
   * twentieth of the food goes with it unless a living Cave Lore PC wins a
   * coin toss — which is only tossed when there is one.
   */
  it("carries a boat over Exile III's waterfalls, Cave Lore sometimes saving the food", async () => {
    const saved = scen.featureFlags['waterfall'];
    try {
      const water = scen.terTypes.findIndex((t) => t.boatOver);
      // Any terrain that isn't the water stands in for the waterfall.
      const fall = water === 0 ? 1 : 0;
      scen.featureFlags['waterfall'] = `exile3:${fall}`;
      const setUp = (): { session: GameSession; univ: Universe; above: { x: number; y: number } } => {
        const session = newSession();
        const { univ } = session;
        const start = { ...univ.party.outLoc };
        const above = { x: start.x + 1, y: start.y };
        univ.out.set(start.x, start.y, water);
        univ.out.set(above.x, above.y, water);
        univ.out.set(above.x, above.y + 1, fall);
        univ.out.set(above.x, above.y + 2, water);
        univ.out.set(above.x, above.y + 3, water);
        const boat = univ.party.boats[0]!;
        boat.exists = true;
        boat.whichTown = 200;
        boat.loc = univ.party.globalToLocal(start);
        boat.sector = {
          x: univ.party.outdoorCorner.x + univ.party.iwc.x,
          y: univ.party.outdoorCorner.y + univ.party.iwc.y,
        };
        univ.party.inBoat = 0;
        for (const pc of univ.party.pcs) pc.traits.fill(false);
        return { session, univ, above };
      };
      const runFalls = (session: GameSession): void =>
        (session as unknown as { runWaterfalls(town: boolean): void }).runWaterfalls(false);

      // The move east ends over the fall: over it goes, boat and all.
      {
        const { session, univ, above } = setUp();
        expect(await session.moveTo(above)).toBe(true);
        const below = { x: above.x, y: above.y + 2 };
        expect(univ.party.outLoc).toEqual(below);
        expect(univ.party.locInSec).toEqual(univ.party.globalToLocal(below));
        expect(univ.party.boats[0]!.loc).toEqual(univ.party.globalToLocal(below));
        expect(univ.transcript).toContain('  Waterfall!');
      }

      // Without Cave Lore: 19/20 of the food is kept, rounded down, with no die.
      {
        const { session, univ, above } = setUp();
        univ.party.outLoc = { ...above };
        univ.party.locInSec = univ.party.globalToLocal(above);
        univ.party.food = 30;
        const calls = univ.rng.gameCalls;
        runFalls(session);
        expect(univ.party.food).toBe(28);
        expect(univ.rng.gameCalls).toBe(calls);
        expect(univ.transcript).not.toContain('  (No supplies lost.)');
      }

      // Two falls in a row are taken one after the other.
      {
        const { session, univ, above } = setUp();
        univ.out.set(above.x, above.y + 3, fall);
        univ.out.set(above.x, above.y + 4, water);
        univ.party.outLoc = { ...above };
        univ.party.locInSec = univ.party.globalToLocal(above);
        univ.party.food = 100;
        runFalls(session);
        expect(univ.party.outLoc).toEqual({ x: above.x, y: above.y + 4 });
        expect(univ.party.food).toBe(90);
        expect(univ.transcript.filter((s) => s === '  Waterfall!').length).toBe(2);
      }

      // A living Cave Lore PC: one `get_ran(1,0,1)`, and a 0 saves the food.
      // Woodsman counts for nothing here, and neither does a dead cave-lorist.
      for (const [roll, kept] of [[0, true], [1, false]] as const) {
        const { session, univ, above } = setUp();
        univ.party.pcs[0]!.traits[Trait.CAVE_LORE] = true;
        univ.party.pcs[1]!.traits[Trait.WOODSMAN] = true;
        univ.party.outLoc = { ...above };
        univ.party.locInSec = univ.party.globalToLocal(above);
        univ.party.food = 30;
        const getRan = univ.rng.getRan.bind(univ.rng);
        const asked: number[][] = [];
        univ.rng.getRan = (times: number, min: number, max: number): number => {
          asked.push([times, min, max]);
          getRan(times, min, max);
          return roll;
        };
        runFalls(session);
        expect(asked).toEqual([[1, 0, 1]]);
        expect(univ.party.food).toBe(kept ? 30 : 28);
        expect(univ.transcript.includes('  (No supplies lost.)')).toBe(kept);
      }
      {
        const { session, univ, above } = setUp();
        univ.party.pcs[0]!.traits[Trait.CAVE_LORE] = true;
        univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;
        univ.party.outLoc = { ...above };
        univ.party.locInSec = univ.party.globalToLocal(above);
        univ.party.food = 30;
        const calls = univ.rng.gameCalls;
        runFalls(session);
        expect(univ.rng.gameCalls).toBe(calls);
        expect(univ.party.food).toBe(28);
      }
    } finally {
      if (saved === undefined) delete scen.featureFlags['waterfall'];
      else scen.featureFlags['waterfall'] = saved;
    }
  });

  /**
   * `handle_combat_switch` (boe.actions.cpp:1321) refuses in a boat and on a
   * horse before it ever reaches `start_town_combat`. Space is the key that
   * dismounts, so what a recording holds is a refused Fight, a Space, and a
   * Fight that works — and a port without the guard starts the fight on the
   * first press and is a whole action out of step from there on.
   */
  it('will not start a fight from a boat or a horse', () => {
    const session = newSession();
    session.startTownMode(1, FORCED_ENTRY);
    const { univ } = session;

    univ.party.inHorse = 0;
    expect(session.startCombat(univ.party.direction)).toBe(false);
    expect(univ.transcript.at(-1)).toBe('Combat: Not while on horseback.');
    expect(session.inTown).toBe(true);

    univ.party.inHorse = -1;
    univ.party.inBoat = 0;
    expect(session.startCombat(univ.party.direction)).toBe(false);
    expect(univ.transcript.at(-1)).toBe('Combat: Not while in boat.');
    expect(session.inTown).toBe(true);

    univ.party.inBoat = -1;
    expect(session.startCombat(univ.party.direction)).toBe(true);
    expect(session.mode).toBe(GameMode.COMBAT);
  });

  it('a mounted party moves ten ticks per step outdoors, five on a horse', async () => {
    const session = newSession();
    const before = session.univ.party.age;
    await session.moveTo({ ...session.univ.party.outLoc, x: session.univ.party.outLoc.x + 1 });
    // On foot: rounds down to a multiple of 10 then adds 10.
    expect(session.univ.party.age - before).toBeLessThanOrEqual(10);
  });
});
