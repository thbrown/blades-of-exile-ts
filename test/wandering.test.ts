/**
 * Wandering monsters and the outdoor arena: create_wand_monst's outdoor half,
 * place_outd_wand_monst, the groups roaming, create_out_combat_terrain and
 * start_outdoor_combat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetFeatureFlags, setFeatureFlags } from '../src/game/featureFlags';
import { GameRng } from '../src/core/rng';
import { OutWandering, emptyOutWandering } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { Town } from '../src/data/town';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { SpecCtx, SpecCtxType } from '../src/game/specials/context';
import { ARENA_DIM, createOutCombatTerrain, startOutdoorCombat } from '../src/game/outCombat';
import { GameSession } from '../src/game/session';
import {
  countWalls, createWandMonst, doOutdoorMonsters, outEncLevTot, placeOutdWandMonst,
  wanderingIsNull,
} from '../src/game/wandering';
import { PartyPreset } from '../src/universe/player';
import { MainStatus } from '../src/universe/skills';
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

/** A party standing outdoors, having walked out of the start town. */
async function outdoors(): Promise<GameSession> {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const s = new GameSession(univ);
  s.startNewGame();
  // Step onto the town's southern boundary, which walks the party out.
  const rect = s.univ.town!.record.inTownRect;
  await s.moveTo({ x: s.univ.party.townLoc.x, y: rect.bottom });
  return s;
}

function aGroup(extra: Partial<OutWandering> = {}): OutWandering {
  return { ...emptyOutWandering(), monst: [1, 0, 0, 0, 0, 0, 0], ...extra };
}


/** Take one outdoor step in whatever direction isn't blocked. */
async function stepAnywhere(s: GameSession): Promise<boolean> {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [dx, dy] of dirs) {
    const from = s.univ.party.outLoc;
    if (await s.moveTo({ x: from.x + dx!, y: from.y + dy! })) return true;
  }
  return false;
}

describe('outdoor wandering groups', () => {
  it('an empty encounter is null and a populated one is not', async () => {
    expect(wanderingIsNull(emptyOutWandering())).toBe(true);
    expect(wanderingIsNull(aGroup())).toBe(false);
  });

  it('placing a group fills the first free slot in window coordinates', async () => {
    const s = await outdoors();
    s.univ.party.iwc = { x: 1, y: 0 };
    placeOutdWandMonst(s, { x: 10, y: 12 }, aGroup());
    const slot = s.univ.party.outC[0]!;
    expect(slot.exists).toBe(true);
    // The sector-local x gains 48 because the party is in the right-hand sector.
    expect(slot.mLoc).toEqual({ x: 58, y: 12 });
    expect(slot.whichSector).toEqual({ x: 1, y: 0 });
  });

  it('a group whose end flag is already set never appears', async () => {
    const s = await outdoors();
    s.univ.party.setSdf(30, 4, 1);
    placeOutdWandMonst(s, { x: 10, y: 12 }, aGroup({ endSpec1: 30, endSpec2: 4 }));
    expect(s.univ.party.outC.every((c) => !c.exists)).toBe(true);
  });

  it('a group walks toward the party', async () => {
    const s = await outdoors();
    const party = s.univ.party.outLoc;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: party.x + 6, y: party.y };
    const startDist = Math.abs(slot.mLoc.x - party.x);
    for (let i = 0; i < 10; i++) doOutdoorMonsters(s);
    expect(Math.abs(slot.mLoc.x - party.x) + Math.abs(slot.mLoc.y - party.y))
      .toBeLessThan(startDist);
  });

  it('a group never steps onto the party itself', async () => {
    const s = await outdoors();
    const party = s.univ.party.outLoc;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: party.x + 2, y: party.y };
    for (let i = 0; i < 30; i++) doOutdoorMonsters(s);
    expect(slot.mLoc).not.toEqual({ x: party.x, y: party.y });
  });
});

describe('how dangerous a group is', () => {
  it('weights the first monster type most heavily', async () => {
    const s = await outdoors();
    const one = outEncLevTot(s.univ, aGroup({ monst: [1, 0, 0, 0, 0, 0, 0] }));
    const last = outEncLevTot(s.univ, aGroup({ monst: [0, 0, 0, 0, 0, 0, 1] }));
    expect(one).toBe(last * 22);
  });

  it('a group that cannot flee is never scared off', async () => {
    const s = await outdoors();
    expect(outEncLevTot(s.univ, aGroup({ cantFlee: true }))).toBe(10000);
  });

  it('count_walls counts the four neighbours that are wall terrain', async () => {
    const s = await outdoors();
    const { outLoc } = s.univ.party;
    s.univ.out.set(outLoc.x + 1, outLoc.y, 6);
    s.univ.out.set(outLoc.x - 1, outLoc.y, 9);
    s.univ.out.set(outLoc.x, outLoc.y + 1, 3);
    s.univ.out.set(outLoc.x, outLoc.y - 1, 4);
    expect(countWalls(s.univ, outLoc)).toBe(2);
  });
});

describe('the arena', () => {
  it('is 48x48, walled to the edge, with the floor in the middle', async () => {
    const s = await outdoors();
    const arena = new Town(ARENA_DIM);
    createOutCombatTerrain(s.univ, arena, 0, 0, false);
    expect(arena.terrain[0]![0]).not.toBe(90);
    expect(arena.terrain[4]![4]).toBe(90);
    expect(arena.terrain[47]![47]).toBe(90);
    // The interior is floor and scatter, never the border wall.
    let interiorWalls = 0;
    for (let x = 9; x < 35; x++)
      for (let y = 9; y < 35; y++) if (arena.terrain[x]![y] === 90) interiorWalls++;
    expect(interiorWalls).toBe(0);
  });

  it('starting an outdoor fight fills it with both sides', async () => {
    const s = await outdoors();
    const group = aGroup({ monst: [1, 0, 0, 0, 0, 0, 0], friendly: [2, 0, 0] });
    startOutdoorCombat(s, group, s.univ.party.outLoc, 0);

    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.whichCombatType).toBe(0);
    expect(s.arena).not.toBeNull();
    expect(s.univ.town).not.toBeNull();
    const monsters = s.univ.town!.monsters;
    // 15-30 of the first hostile type, and 7-10 of the first friendly one.
    expect(monsters.filter((m) => !m.isFriendly).length).toBeGreaterThanOrEqual(15);
    expect(monsters.filter((m) => m.isFriendly).length).toBeGreaterThanOrEqual(7);
    // Everyone stands somewhere sensible, and the party is placed too.
    expect(s.univ.party.pcs[0]!.combatPos.x).toBeGreaterThan(0);
    expect(monsters.every((m) => m.curLoc.x >= 9 && m.curLoc.x < 35)).toBe(true);
  });

  it('the fight cannot be ended while anything hostile is alive', async () => {
    const s = await outdoors();
    startOutdoorCombat(s, aGroup(), s.univ.party.outLoc, 0);
    expect(s.endCombat()).toBe(false);
    expect(s.univ.transcript.at(-1)).toBe('Enemies are still alive!');
    expect(s.mode).toBe(GameMode.COMBAT);
  });

  it('killing everything lets the party walk back out to the world map', async () => {
    const s = await outdoors();
    const where = { ...s.univ.party.outLoc };
    startOutdoorCombat(s, aGroup(), where, 0);
    for (const m of s.univ.town!.monsters) m.active = 0; // DEAD
    expect(s.endCombat()).toBe(true);
    expect(s.mode).toBe(GameMode.OUTDOORS);
    expect(s.univ.town).toBeNull();
    expect(s.arena).toBeNull();
    expect(s.univ.party.outLoc).toEqual(where);
  });

  /**
   * pc_combat_move (boe.combat.cpp:242): terrain 90 is the arena's border
   * wall, and stepping onto it in an *outdoor* fight (whichCombatType === 0)
   * is a 30% roll to flee rather than a plain "blocked". This port used to
   * have no handling for it at all, so running to the edge of an outdoor
   * combat map did nothing.
   */
  it('running to the border of an outdoor arena gives a chance to flee', async () => {
    const s = await outdoors();
    startOutdoorCombat(s, aGroup(), s.univ.party.outLoc, 0);
    const pc = s.univ.party.pcs[s.univ.curPc]!;
    pc.combatPos = { x: 9, y: 20 };
    const border = { x: 8, y: 20 };
    expect(s.univ.town!.record.terrain[border.x]![border.y]).toBe(90);

    let fled = false;
    let failed = false;
    for (let i = 0; i < 100 && !(fled && failed); i++) {
      // A spent turn queues the monsters' round, which is async now and hands
      // the turn to whoever is up next when it finishes. Let it finish and put
      // `pc` back in charge, or the AP this asserts on come off someone else —
      // the real game blocks input for exactly this window (`session.busy`).
      await s.settled();
      s.univ.curPc = s.univ.party.pcs.indexOf(pc);
      pc.mainStatus = MainStatus.ALIVE;
      pc.ap = 4;
      pc.combatPos = { x: 9, y: 20 };
      // Not `transcript.at(-1)`: handing the turn on prints "Active: <name>
      // (#n, N ap.)" after the move's own line, which a successful flee always
      // does — it leaves the PC with no moves.
      const from = s.univ.transcript.length;
      await s.combatMove(border);
      const said = s.univ.transcript.slice(from);
      const last = said.find((l) => l.startsWith('Moved:'));
      if (last === 'Moved: Fled.') {
        fled = true;
        expect(pc.mainStatus).toBe(MainStatus.FLED);
        expect(pc.ap).toBe(0);
      } else if (last === "Moved: Couldn't flee.") {
        failed = true;
        expect(pc.ap).toBeLessThan(4);
      }
    }
    expect(fled).toBe(true);
    expect(failed).toBe(true);
  });

  /**
   * `handle_party_death` (boe.actions.cpp:1431) resets every FLED PC back to
   * ALIVE before deciding whether the party is really dead — `is_alive()` is
   * `main_status === ALIVE` for both a corpse and a PC that just ran away, so
   * without that reset step a party that fled an entire fight read as a
   * party wipe. `checkPartyDeath` used to skip straight to declaring death.
   */
  it('fleeing every PC ends the fight instead of reporting a party wipe', async () => {
    const s = await outdoors();
    startOutdoorCombat(s, aGroup(), s.univ.party.outLoc, 0);
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.FLED;
    let died = 0;
    s.onPartyDeath = () => { died++; };

    s.pause();

    expect(died).toBe(0);
    expect(s.mode).toBe(GameMode.OUTDOORS);
    expect(s.univ.town).toBeNull();
    expect(s.arena).toBeNull();
    expect(s.univ.party.pcs.every((pc) => pc.mainStatus === MainStatus.ALIVE)).toBe(true);
    expect(s.univ.transcript.some((l) => l === 'End combat.')).toBe(true);
  });
});

describe('bumping into a group', () => {
  it('a group standing next to the party starts a fight', async () => {
    const s = await outdoors();
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup({ cantFlee: true });
    slot.mLoc = { x: s.univ.party.outLoc.x + 1, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(true);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(slot.exists).toBe(false);
  });

  it('an encounter far below the party runs away instead', async () => {
    const s = await outdoors();
    // A high-level party against one weak monster type.
    for (const pc of s.univ.party.pcs) pc.level = 40;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup({ monst: [0, 0, 0, 0, 0, 0, 1] });
    slot.mLoc = { x: s.univ.party.outLoc.x + 1, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(false);
    expect(s.univ.transcript.at(-1)).toBe('Combat: Monsters fled!');
    expect(s.mode).toBe(GameMode.OUTDOORS);
  });

  it('nothing happens when no group is adjacent', async () => {
    const s = await outdoors();
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: s.univ.party.outLoc.x + 5, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(false);
    expect(slot.exists).toBe(true);
  });
});

describe('the outdoor clock, which is what makes encounters happen', () => {
  it('a step outdoors is ten ticks, so every turn rolls for a group', async () => {
    const s = await outdoors();
    // increase_age (boe.actions.cpp:3362): rounded down to a multiple of 10,
    // then +10 on foot. `age % 10 == 0` gates do_monsters and the wandering
    // roll, so a clock that ticked by one starved the game of encounters.
    for (let i = 0; i < 5; i++) {
      const before = s.univ.party.age;
      if (!await stepAnywhere(s)) break;
      expect(s.univ.party.age).toBe(before + 10);
      expect(s.univ.party.age % 10).toBe(0);
    }
  });

  it('walking outdoors eventually rolls up a wandering group', async () => {
    const s = await outdoors();
    // 1 in 70 per turn, so 400 turns is a near-certainty — the point is that
    // the roll happens at all, which it didn't while the clock ticked by one.
    for (let i = 0; i < 400 && s.univ.party.outC.every((g) => !g.exists); i++) {
      if (!await stepAnywhere(s)) break;
    }
    expect(s.univ.party.outC.some((g) => g.exists)).toBe(true);
  });
});


/** The bare minimum SpecialHost these tests need. */
function attachStubHost(s: GameSession): void {
  s.attachSpecials({
    message: async () => {},
    choice: async () => 0,
    story: async () => {},
    askText: async () => '',
    selectPc: async () => 0,
    getNumOfItems: async (max: number) => max,
    startShop: () => false,
    startTalk: () => {},
    sound: () => {},
    rest: () => {},
    moveParty: () => {},
    changeLevel: () => {},
    endScenario: () => {},
  });
}

describe('the outdoor encounter specials', () => {
  it('OUT_PLACE_ENCOUNTER drops one of the sector’s special encounters on the party', async () => {
    const s = await outdoors();
    attachStubHost(s);
    const sector = s.univ.out.sector;
    // Give the sector a special encounter to place, since not every sector
    // defines one.
    sector.specialEnc[1] = aGroup({ cantFlee: true });
    const node = { ...emptySpecialNode(), type: SpecType.OUT_PLACE_ENCOUNTER, ex1a: 1, jumpto: -1 };
    s.univ.out.sector.specials = new Map([[0, node]]);
    await s.runSpecialRaw(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 0, s.univ.party.locInSec);
    const slot = s.univ.party.outC.find((g) => g.exists);
    expect(slot).toBeDefined();
    // **Next to the party, not on it.** OUT_PLACE_ENCOUNTER passes `forced`
    // (boe.specials.cpp:4583), and a forced placement shuffles the group until
    // `is_blocked` is happy — which counts the party's own square *and* the
    // slot the call has already filled in, so it always moves at least once.
    // Landing adjacent is what matters: that is what the end-of-turn encounter
    // check tests for.
    const at = slot!.mLoc;
    const party = s.univ.party.outLoc;
    expect(Math.abs(at.x - party.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.y - party.y)).toBeLessThanOrEqual(1);
    expect(at).not.toEqual(party);
  });

  it('OUT_PLACE_ENCOUNTER refuses an index outside 0-3', async () => {
    const s = await outdoors();
    attachStubHost(s);
    const node = { ...emptySpecialNode(), type: SpecType.OUT_PLACE_ENCOUNTER, ex1a: 7, jumpto: -1 };
    s.univ.out.sector.specials = new Map([[0, node]]);
    await s.runSpecialRaw(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 0, s.univ.party.locInSec);
    expect(s.univ.party.outC.some((g) => g.exists)).toBe(false);
    expect(s.univ.transcript.some((l) => l.includes('out of range'))).toBe(true);
  });

  it('OUT_MAKE_WANDER rolls a wandering group into the sector', async () => {
    const s = await outdoors();
    attachStubHost(s);
    const node = { ...emptySpecialNode(), type: SpecType.OUT_MAKE_WANDER, jumpto: -1 };
    s.univ.out.sector.specials = new Map([[0, node]]);
    // create_wand_monst can roll an empty group, so give it several goes.
    for (let i = 0; i < 20 && !s.univ.party.outC.some((g) => g.exists); i++)
      await s.runSpecialRaw(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 0, s.univ.party.locInSec);
    expect(s.univ.party.outC.some((g) => g.exists)).toBe(true);
  });
});

/**
 * The two bugs `create_wand_monst` keeps behind feature flags — the mechanism
 * by which the C++ stays reproducible for replays recorded before the fixes.
 *
 * These matter for the RNG as much as for the monsters: an extra
 * `place_monster` moves the stream, and `get_ran`'s call order is part of the
 * spec.
 */
describe('the wandering-monster bugs, and the flags that decide them', () => {
  afterEach(() => { resetFeatureFlags(); });

  /**
   * A town session whose four wandering groups are identical, so which one
   * `get_ran` picks cannot change the answer, with a spawn point well away
   * from the party (`create_wand_monst` rerolls a point the party can see).
   */
  async function townWithGroup(fourth: number): Promise<GameSession> {
    const rng = new GameRng();
    rng.seedGame(1);
    const univ = new Universe(scen, rng, PartyPreset.DEFAULT);
    const s = new GameSession(univ);
    s.startNewGame();
    const record = univ.townRecord!;
    record.wandering = [[1, 0, 0, fourth], [1, 0, 0, fourth],
      [1, 0, 0, fourth], [1, 0, 0, fourth]];
    const rect = record.inTownRect;
    const spot = {
      x: Math.max(rect.left + 2, Math.min(rect.right - 2, univ.party.townLoc.x + 12)),
      y: Math.max(rect.top + 2, Math.min(rect.bottom - 2, univ.party.townLoc.y + 12)),
    };
    record.wanderingLocs = [spot, spot, spot, spot];
    return s;
  }

  /**
   * With the bug **on** (a recording that predates the fix, or one that never
   * mentions the flag), an empty fourth slot still gets placed — spawning the
   * "nameless monsters of type 0 with default stats" the C++ comment describes.
   * With the fix on, it is skipped.
   */
  it('places a nameless type-0 monster only when the bug is on', async () => {
    const withBug = await townWithGroup(0);
    setFeatureFlags({});
    const before = withBug.univ.town!.monsters.length;
    for (let i = 0; i < 40; i++) createWandMonst(withBug);
    const bugged = withBug.univ.town!.monsters.length - before;

    const fixed = await townWithGroup(0);
    setFeatureFlags({ 'empty-wandering-monster-bug': ['fixed'] });
    const before2 = fixed.univ.town!.monsters.length;
    for (let i = 0; i < 40; i++) createWandMonst(fixed);
    const clean = fixed.univ.town!.monsters.length - before2;

    expect(bugged).toBeGreaterThan(clean);
  });

  /**
   * **A C++ typo, reproduced.** The trailing `try_place_extra_monster()` is
   * guarded by `has_feature_flag("too-many-extra-wandering-monsters", "fixed")`
   * — without the `-bug` suffix the flag is registered under — so no such flag
   * exists and it never runs. A build with the fix on therefore places the
   * extra monster *zero* times, not once.
   */
  it('never places the extra monster once the fix is on, because of the C++ typo', async () => {
    const s = await townWithGroup(2);
    setFeatureFlags({ 'too-many-extra-wandering-monsters-bug': ['fixed'] });
    const drawsBefore = s.univ.rng.gameDraws;
    const before = s.univ.town!.monsters.length;
    createWandMonst(s);
    const placedWithFix = s.univ.town!.monsters.length - before;

    const t = await townWithGroup(2);
    setFeatureFlags({});
    const before2 = t.univ.town!.monsters.length;
    createWandMonst(t);
    const placedWithBug = t.univ.town!.monsters.length - before2;

    // The bug runs `try_place_extra_monster` four times; the fix runs it none.
    expect(placedWithBug).toBeGreaterThanOrEqual(placedWithFix);
    // And it costs RNG draws either way, which is the part replays feel.
    expect(s.univ.rng.gameDraws).toBeGreaterThan(drawsBefore);
  });
});
