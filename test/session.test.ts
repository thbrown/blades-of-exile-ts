import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction, shiftLoc } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemType } from '../src/data/item';
import { Attitude, MonstTime } from '../src/data/monster';
import { SECTOR_SIZE } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import { resetFeatureFlags, setFeatureFlags } from '../src/game/featureFlags';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { OUT_HALF_DIM } from '../src/universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../src/universe/party';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../src/universe/skills';
import { CreatureStatus } from '../src/universe/creature';
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
  return new GameSession(univ);
}

/**
 * Put the party one square inside a *passable* boundary square and hand back
 * the square that walks it out.
 *
 * `handle_move` fires the exit on the square the party actually reached, not
 * on the one it aimed at, so a boundary square with a wall in it now refuses
 * the step like any other — which is the whole point of the rule. These tests
 * used to jump straight at `rect.bottom` from wherever the party started and
 * relied on the exit happening before the blockage test.
 */
function edgeStep(session: GameSession): { x: number; y: number } {
  const town = session.univ.town!;
  const rect = town.record.inTownRect;
  const clear = (x: number, y: number): boolean =>
    session.univ.terrainType(town.record.terrain[x]![y]!).blockage === TerObstruct.CLEAR;
  for (let x = rect.left + 1; x < rect.right; x++)
    if (clear(x, rect.bottom) && clear(x, rect.bottom - 1)) {
      session.univ.party.townLoc = { x, y: rect.bottom - 1 };
      return { x, y: rect.bottom };
    }
  throw new Error('this town has no passable square on its southern boundary');
}

describe('party setup', () => {
  it('starts with the six pregen adventurers', async () => {
    const { univ } = newSession();
    expect(univ.party.pcs.map((p) => p.name)).toEqual([
      'Jenneke',
      'Thissa',
      'Frrrrrr',
      'Adrianna',
      'Feodoric',
      'Michael',
    ]);
    expect(univ.party.pcs.every((p) => p.isAlive)).toBe(true);
    expect(univ.party.pcs[0]!.maxHealth).toBe(22);
    expect(univ.party.pcs[3]!.maxSp).toBe(20);
    expect(univ.party.gold).toBe(200);
    expect(univ.party.food).toBe(100);
    expect(univ.party.calcDay()).toBe(1);
  });

  it('arms the party in finish_create, which the preset ctor leaves undone', async () => {
    // `cPlayer(PARTY_DEFAULT, slot)` explicitly empties the pack; the gear
    // comes from `finish_create`, which start_new_game runs over the whole
    // party (boe.actions.cpp:3789). So the constructor alone leaves them bare.
    const bare = newSession();
    expect(bare.univ.party.pcs[0]!.items[0]!.variety).toBe(ItemType.NO_ITEM);

    const s = newSession();
    s.startNewGame();
    const [jenneke, thissa, frrrrrr, adrianna] = s.univ.party.pcs;
    // Human: knife and buckler, both equipped.
    expect(jenneke!.race).toBe(Race.HUMAN);
    expect(jenneke!.items[0]!.name).toBe('Knife');
    expect(jenneke!.items[1]!.name).toBe('Buckler');
    expect(jenneke!.equip[0]).toBe(true);
    expect(jenneke!.equip[1]).toBe(true);
    // Slith: spear and helm, +2 strength and +1 intelligence.
    expect(thissa!.race).toBe(Race.SLITH);
    expect(thissa!.items[0]!.name).toBe('Spear');
    expect(thissa!.items[1]!.name).toBe('Helm');
    expect(thissa!.skills[Skill.STRENGTH]).toBe(10);
    expect(thissa!.skills[Skill.INTELLIGENCE]).toBe(3);
    // Nephil: bow and arrows, +2 dexterity.
    expect(frrrrrr!.race).toBe(Race.NEPHIL);
    expect(frrrrrr!.items[0]!.name).toBe('Bow');
    expect(frrrrrr!.items[1]!.name).toBe('Arrows');
    expect(frrrrrr!.items[1]!.charges).toBe(12);
    expect(frrrrrr!.skills[Skill.DEXTERITY]).toBe(8);
    // Three spell points per level of either casting skill, on top of the
    // preset's own pool — Adrianna's 20 plus three mage levels.
    expect(adrianna!.skills[Skill.MAGE_SPELLS]).toBe(3);
    expect(adrianna!.maxSp).toBe(29);
    expect(adrianna!.curSp).toBe(29);
    // Nobody in the pregen party is Anama, so nothing is refunded.
    expect(s.univ.party.pcs.some((pc) => pc.traits[Trait.ANAMA])).toBe(false);
  });

  it('places the outdoor window on the scenario start sector', async () => {
    const { univ } = newSession();
    expect(univ.party.outdoorCorner).toEqual(scen.outdoorStart);
    expect(univ.party.locInSec).toEqual(scen.sectorStart);
    // The window is stitched from the 2x2 block starting at the corner.
    const base = scen.outdoors[scen.outdoorStart.x]![scen.outdoorStart.y]!;
    expect(univ.out.at(0, 0)).toBe(base.terrain[0]![0]!);
    expect(univ.out.at(SECTOR_SIZE - 1, SECTOR_SIZE - 1)).toBe(
      base.terrain[SECTOR_SIZE - 1]![SECTOR_SIZE - 1]!,
    );
  });
});

describe('start and end town mode', () => {
  it('starts a new game inside the scenario start town', async () => {
    const session = newSession();
    session.startNewGame();
    expect(session.mode).toBe(GameMode.TOWN);
    expect(session.inTown).toBe(true);
    expect(session.univ.party.townNum).toBe(scen.startTown);
    expect(session.univ.town!.record.name).toBe('Fort Talrus');
    // The party lands on a usable start location inside the town bounds.
    const rect = session.univ.town!.record.inTownRect;
    const p = session.univ.party.townLoc;
    expect(p.x).toBeGreaterThan(rect.left);
    expect(p.x).toBeLessThan(rect.right);
    expect(p.y).toBeGreaterThan(rect.top);
    expect(p.y).toBeLessThan(rect.bottom);
    expect(session.locationName().length).toBeGreaterThan(0);
  });

  it('populates the town with its always-present creatures', async () => {
    const session = newSession();
    session.startNewGame();
    const alive = session.univ.town!.monsters.filter((m) => m.isAlive);
    expect(alive.length).toBeGreaterThan(0);
    // Every live creature refers to a real monster template and fits the map.
    for (const m of alive) {
      expect(scen.scenMonsters[m.number]).toBeDefined();
      expect(session.univ.town!.isOnMap(m.curLoc.x, m.curLoc.y)).toBe(true);
    }
  });

  it('leaves town when the party steps past the in-town boundary', async () => {
    const session = newSession();
    session.startNewGame();
    // Step onto the southern boundary, which walks the party out.
    await session.moveTo(edgeStep(session));
    expect(session.mode).toBe(GameMode.OUTDOORS);
    expect(session.univ.party.townNum).toBe(TOWN_NUM_OUTDOORS);
    expect(session.univ.town).toBeNull();
    expect(session.univ.out.isOnMap(session.univ.party.outLoc.x, session.univ.party.outLoc.y)).toBe(
      true,
    );
  });

  it('remembers the town map between visits', async () => {
    const session = newSession();
    session.startNewGame();
    const record = session.univ.town!.record;
    const seen = session.univ.party.townLoc;
    await session.moveTo(edgeStep(session));
    expect(record.maps[seen.x]![seen.y]).toBe(1);

    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(session.univ.town!.isExplored(seen.x, seen.y)).toBe(true);
  });

  it('picks the entrance opposite the direction of travel', async () => {
    // find_direction_from: heading north arrives at start_locs[2], south at [0].
    const session = newSession();
    const town = scen.towns.find((t) => t.startLocs.every((l) => l.x >= 0));
    if (!town) return; // no town in this scenario defines all four entrances
    const num = scen.towns.indexOf(town);
    session.univ.party.direction = Direction.N;
    session.startTownMode(num, 2);
    expect(session.univ.party.townLoc).toEqual(town.startLocs[2]);
    session.startTownMode(num, 0);
    expect(session.univ.party.townLoc).toEqual(town.startLocs[0]);
  });

  it('redirects the town number through town_mods', () => {
    // `<town-flag town="N" add-x="X" add-y="Y">`: entering town N with that
    // Stuff Done Flag set enters `N + PSD[X][Y]` instead (boe.town.cpp:99).
    // It is how a scenario shows the same place changed, and it is silent —
    // nothing in the transcript says which of the two you walked into.
    const session = newSession();
    const from = 0;
    const to = 1;
    if (scen.towns.length < 2) return;
    scen.townMods.push({ spec: from, x: 3, y: 4 });
    try {
      session.univ.party.setSdf(3, 4, to - from);
      session.startTownMode(from, FORCED_ENTRY);
      expect(session.univ.party.townNum).toBe(to);

      // A flag of zero is still a match and still adds nothing.
      session.univ.party.setSdf(3, 4, 0);
      session.startTownMode(from, FORCED_ENTRY);
      expect(session.univ.party.townNum).toBe(from);
    } finally {
      scen.townMods.pop();
      session.univ.party.setSdf(3, 4, 0);
    }
  });
});

describe('town items', () => {
  it('places the town preset items on the floor', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    const presets = town.record.presetItems.filter((p) => p.code >= 0);
    expect(presets.length).toBeGreaterThan(0);
    expect(town.items.length).toBe(presets.length);
    for (const item of town.items) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(town.isOnMap(item.itemLoc.x, item.itemLoc.y)).toBe(true);
      // is_special is the 1-based preset index, used to mark items as taken.
      expect(item.isSpecial).toBeGreaterThan(0);
    }
  });

  it('leaves out items the party already took, unless always there', async () => {
    const session = newSession();
    session.startNewGame();
    const record = session.univ.town!.record;
    const before = session.univ.town!.items.length;
    const takenIdx = record.presetItems.findIndex((p) => p.code >= 0 && !p.alwaysThere);
    if (takenIdx < 0) return;
    record.itemTaken[takenIdx] = true;
    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(session.univ.town!.items.length).toBe(before - 1);
  });
});

describe('visibility', () => {
  it('reveals the 9x9 block around the party but not through walls', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    const p = session.univ.party.townLoc;
    // `record.maps` is the scenario's own map-memory array and the scenario is
    // loaded once for the whole file, so an earlier test that walked the party
    // somewhere leaves its reveals here. Put the fog back before measuring.
    for (let x = 0; x < town.record.maxDim; x++)
      for (let y = 0; y < town.record.maxDim; y++) {
        town.record.maps[x]![y] = 0;
        town.takeExplored(x, y);
      }
    session.updateExplored(p);
    expect(town.isExplored(p.x, p.y)).toBe(true);
    // Something within the 9x9 block is revealed…
    let revealed = 0;
    for (let x = p.x - 4; x <= p.x + 4; x++)
      for (let y = p.y - 4; y <= p.y + 4; y++)
        if (town.isOnMap(x, y) && town.isExplored(x, y)) revealed++;
    expect(revealed).toBeGreaterThan(1);
    // …and nothing outside it is.
    for (let x = 0; x < town.record.maxDim; x++)
      for (let y = 0; y < town.record.maxDim; y++)
        if (Math.abs(x - p.x) > 4 || Math.abs(y - p.y) > 4)
          expect(town.isExplored(x, y)).toBe(false);
  });

  it('treats normally lit towns as fully lit and dark ones by radius', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    if (town.record.lightingType === 0) {
      expect(session.lightRadius()).toBe(200);
      expect(session.ptInLight({ x: 0, y: 0 }, { x: 20, y: 20 })).toBe(true);
    }
    // With no light sources carried, a dark town lights only the adjacent ring.
    const dark = scen.towns.findIndex((t) => t.lightingType !== 0);
    if (dark < 0) return;
    session.startTownMode(dark, FORCED_ENTRY);
    expect(session.lightRadius()).toBe(1);
    const p = session.univ.party.townLoc;
    expect(session.ptInLight(p, { x: p.x + 1, y: p.y })).toBe(true);
    const far = { x: p.x + 8, y: p.y };
    if (session.univ.town!.isOnMap(far.x, far.y) && !session.univ.town!.isLit(far.x, far.y))
      expect(session.ptInLight(p, far)).toBe(false);
  });
});

describe('outdoor movement', () => {
  it('records movement in the transcript and advances the clock', async () => {
    const session = newSession();
    const { univ } = session;
    // Find an unblocked neighbour of the start position and step onto it.
    const from = univ.party.outLoc;
    const dirs = [Direction.N, Direction.E, Direction.S, Direction.W];
    const before = univ.party.age;
    let moved = false;
    for (const d of dirs) {
      if (await session.move(d)) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
    // increase_age's outdoor clock: rounded down to a multiple of 10, then
    // +10 on foot. Not +1 — `age % 10 == 0` gates the wandering monsters.
    expect(univ.party.age).toBe(before - (before % 10) + 10);
    expect(univ.party.outLoc).not.toEqual(from);
    expect(univ.transcript.at(-1)).toMatch(/^Moved: /);
  });

  it('slides the 96x96 window when the party nears its edge', async () => {
    const session = newSession();
    const { univ, } = session;
    // Put the window somewhere with a sector to the east, then walk off it.
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 1, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 91, y: 20 };
    const cornerBefore = { ...univ.party.outdoorCorner };

    // moveTo does the shift regardless of whether the destination is walkable.
    await session.moveTo({ x: 92, y: 20 });
    expect(univ.party.outdoorCorner.x).toBe(cornerBefore.x + 1);
    // Shifting keeps the party on the same world tile: it moves back half a
    // window in local coordinates as the corner advances one sector.
    expect(univ.party.outLoc.x).toBeLessThanOrEqual(92 - OUT_HALF_DIM + 1);
    expect(univ.party.iwc.x).toBe(0);
  });

  it('stops the party at the world edge', async () => {
    const session = newSession();
    const { univ } = session;
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 0, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 0, y: 10 };
    expect(await session.moveTo({ x: -1, y: 10 })).toBe(false);
    expect(univ.party.outLoc).toEqual({ x: 0, y: 10 });
  });

  it('enters a town by stepping onto a town-entrance tile', async () => {
    const session = newSession();
    const { univ } = session;
    // Find a city loc whose terrain really is a town entrance.
    let found: { sx: number; sy: number; x: number; y: number; town: number } | null = null;
    for (let sx = 0; sx < scen.outWidth && !found; sx++)
      for (let sy = 0; sy < scen.outHeight && !found; sy++)
        for (const city of scen.outdoors[sx]![sy]!.cityLocs) {
          const ter = scen.outdoors[sx]![sy]!.terrain[city.x]![city.y]!;
          if (scen.terTypes[ter]!.special !== TerSpec.TOWN_ENTRANCE) continue;
          if (city.spec < 0 || city.y + 1 >= SECTOR_SIZE) continue;
          found = { sx, sy, x: city.x, y: city.y, town: city.spec };
          break;
        }
    expect(found).not.toBeNull();
    const at = found!;

    univ.party.outdoorCorner = { x: at.sx, y: at.sy };
    univ.party.iwc = { x: 0, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: at.x, y: at.y + 1 };
    univ.party.locInSec = { x: at.x, y: at.y + 1 };

    await session.moveTo({ x: at.x, y: at.y });
    expect(session.inTown).toBe(true);
    expect(univ.party.townNum).toBe(at.town);
  });
});

/**
 * check_special_terrain runs on outdoor moves too (boe.actions.cpp:3950), which
 * is what makes a swamp poison the party on the world map. It used to bail out
 * whenever there was no town, so nothing outdoors ever hurt anyone.
 */
describe('outdoor terrain specials', () => {
  function outdoors(): GameSession {
    const s = newSession();
    s.startNewGame();
    // Walk straight out of the start town, dismissing nothing: endTownMode
    // returns the outdoor square, and the mode flips with it.
    s.endTownMode(s.univ.party.townLoc);
    return s;
  }

  it('poisons the party in a swamp', async () => {
    const s = outdoors();
    expect(s.inTown).toBe(false);
    // Find (or borrow) a DANGEROUS terrain that inflicts poison at 100%.
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.DANGEROUS);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ter = { ...scen.terTypes[idx]! };
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = {
      ...ter, flag1: 4, flag2: 100, flag3: Status.POISON, blockage: 0,
    };
    try {
      const from = s.univ.party.outLoc;
      const to = { x: from.x + 1, y: from.y };
      s.univ.out.set(to.x, to.y, idx);
      const before = s.univ.party.pcs[0]!.status[Status.POISON] ?? 0;
      await s.moveTo(to);
      expect(s.univ.party.pcs[0]!.status[Status.POISON] ?? 0).toBeGreaterThan(before);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });

  /**
   * "only damage once in combat!" (boe.specials.cpp:456). The loop starts at
   * the moving PC and breaks the moment the terrain catches one, so a step
   * into a swamp during a fight is one roll, not six — which is up to five
   * `get_ran(1,1,100)` of draw stream either way.
   */
  it('a swamp in combat catches the moving PC and stops', async () => {
    const s = newSession();
    s.startNewGame();
    s.startCombat(s.univ.party.direction);
    expect(s.mode).toBe(GameMode.COMBAT);
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.DANGEROUS);
    expect(idx).toBeGreaterThanOrEqual(0);
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = {
      ...saved, flag1: 4, flag2: 100, flag3: Status.POISON, blockage: 0,
    };
    try {
      const who = s.univ.curPc;
      const from = s.univ.party.pcs[who]!.combatPos;
      const to = { x: from.x, y: from.y + 1 };
      s.univ.town!.record.terrain[to.x]![to.y] = idx;
      const poisoned = (): number[] =>
        s.univ.party.pcs.map((pc) => pc.status[Status.POISON] ?? 0);
      expect(poisoned().every((n) => n === 0)).toBe(true);

      await s.combatMove(to);

      const after = poisoned();
      expect(after[who]).toBeGreaterThan(0);
      // Everyone after them in the party is untouched.
      for (let i = who + 1; i < 6; i++) expect(after[i]).toBe(0);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });

  it('loading a game rebuilds the outdoor window from the scenario', async () => {
    // save/out.txt holds a snapshot of the 96x96 window, and finish_load_party
    // (boe.fileio.cpp:96) throws it away and re-stitches the four sectors. A
    // save whose snapshot had drifted otherwise keeps the wrong terrain — and
    // the party never notices, because only the monsters walk on most of it.
    const s = outdoors();
    const at = { x: s.univ.party.outLoc.x + 2, y: s.univ.party.outLoc.y };
    const real = s.univ.out.at(at.x, at.y);
    s.univ.out.set(at.x, at.y, real === 0 ? 1 : 0);
    expect(s.univ.out.at(at.x, at.y)).not.toBe(real);
    s.resumeLoadedGame();
    expect(s.univ.out.at(at.x, at.y)).toBe(real);
  });

  it('a woodsman hunts on the square the party is leaving, not the one it enters', async () => {
    // handle_hunting reads `out_loc`, and check_special_terrain runs *before*
    // the move — so the wilderness square that fires it is not the square the
    // food comes from. Faithful to boe.actions.cpp:3593.
    const s = outdoors();
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.WILDERNESS_SURFACE);
    expect(idx).toBeGreaterThanOrEqual(0);
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = { ...saved, flag1: 5, blockage: 0 };
    try {
      const from = s.univ.party.outLoc;
      const to = { x: from.x + 1, y: from.y };
      s.univ.out.set(from.x, from.y, idx);
      s.univ.out.set(to.x, to.y, idx);
      s.univ.party.pcs[0]!.traits[Trait.WOODSMAN] = true;
      s.univ.party.food = 100;
      // get_ran(1,0,12) has to come up 5, so drive it until it does.
      let hunted = false;
      for (let i = 0; i < 200 && !hunted; i++) {
        s.univ.party.outLoc = { ...from };
        // eslint-disable-next-line no-await-in-loop
        await s.moveTo(to);
        hunted = s.univ.transcript.some((line) => line.endsWith('hunts.'));
      }
      expect(hunted).toBe(true);
      expect(s.univ.party.food).toBeGreaterThan(100);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });

  /**
   * A river ford: the special node on the far bank of a blocking (deep
   * water) square returns `b` (forced) to walk the party through anyway —
   * the same CANT_ENTER trick a walk-through-a-wall node uses in town.
   * `outdMoveParty` used to read only the node's `blocked` return and drop
   * `forced` on the floor, so the ford's special could run and print its
   * message but the water still refused the step right after.
   */
  it('a forced CANT_ENTER node lets the party cross otherwise-blocked terrain', async () => {
    const s = outdoors();
    const host: SpecialHost = {
      async message() {},
      async choice(_strs, buttons) { return buttons.length - 1; },
      async story() {},
      async askText() { return ''; },
      async askNum(min: number) { return min; },
      async selectPc() { return 0; },
      async getNumOfItems(max: number) { return max; },
      startShop() { return true; },
      startTalk() {},
      sound() {},
      rest() {},
      moveParty() {},
      changeLevel() {},
      forceTown() {},
      endScenario() {},
    };
    s.attachSpecials(host);

    const idx = scen.terTypes.findIndex((t) => t.blockage === TerObstruct.BLOCK_MOVE);
    expect(idx).toBeGreaterThanOrEqual(0);
    const from = s.univ.party.outLoc;
    const to = { x: from.x + 1, y: from.y };
    s.univ.out.set(to.x, to.y, idx);

    const local = s.univ.party.globalToLocal(to);
    s.univ.out.sector.specialLocs.push({ x: local.x, y: local.y, spec: 0 });
    s.univ.out.sector.specials.set(0, {
      ...emptySpecialNode(), type: SpecType.CANT_ENTER, ex1a: 0, ex2a: 1,
    });

    const moved = await s.moveTo(to);
    expect(moved).toBe(true);
    expect(s.univ.party.outLoc).toEqual(to);
  });

  it('hurts the party on damaging terrain', async () => {
    const s = outdoors();
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.DAMAGING);
    if (idx < 0) return; // no such terrain in this scenario
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = { ...saved, flag1: 6, flag2: 2, flag3: 0, blockage: 0 };
    try {
      const from = s.univ.party.outLoc;
      const to = { x: from.x, y: from.y + 1 };
      s.univ.out.set(to.x, to.y, idx);
      const before = s.univ.party.pcs[0]!.curHealth;
      await s.moveTo(to);
      expect(s.univ.party.pcs[0]!.curHealth).toBeLessThan(before);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });
});

describe('walking into things: webs, crates and conveyors', () => {
  /** A town session with a clear square next to the party, or null. */
  function townWithClearNeighbour(): { s: GameSession; to: { x: number; y: number } } | null {
    const s = newSession();
    s.startNewGame();
    const from = s.univ.party.townLoc;
    const candidates = [
      { x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y },
      { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 },
    ];
    const to = candidates.find((c) =>
      !s.townIsBlocked(c) && !s.univ.town!.monsterAt(c) && s.specialAt(c) < 0);
    return to ? { s, to } : null;
  }

  it('walking into a web catches the whole party and uses the web up', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    s.univ.town!.setField(to.x, to.y, FieldType.FIELD_WEB);
    await s.moveTo(to);
    expect(s.univ.transcript.some((l) => l.includes('Webs!'))).toBe(true);
    // Out of combat every PC is webbed, and the web is spent.
    for (const pc of s.univ.party.pcs)
      if (pc.isAlive) expect(pc.status[Status.WEBS] ?? 0).toBeGreaterThan(0);
    expect(s.univ.town!.hasField(to.x, to.y, FieldType.FIELD_WEB)).toBe(false);
  });

  it('walking into a barrel pushes it one square further along', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    const from = { ...s.univ.party.townLoc };
    const beyond = { x: to.x + (to.x - from.x), y: to.y + (to.y - from.y) };
    // Only meaningful when the square past it is clear; otherwise push_loc
    // swaps the barrel onto the pusher's square instead.
    if (s.townIsBlocked(beyond) || s.sightObscurity(beyond.x, beyond.y) > 0) return;
    s.univ.town!.setField(to.x, to.y, FieldType.OBJECT_BARREL);
    await s.moveTo(to);
    expect(s.univ.transcript.some((l) => l.includes('push the barrel'))).toBe(true);
    expect(s.univ.town!.hasField(to.x, to.y, FieldType.OBJECT_BARREL)).toBe(false);
    expect(s.univ.town!.hasField(beyond.x, beyond.y, FieldType.OBJECT_BARREL)).toBe(true);
  });

  it('a conveyor refuses to be walked against', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    const from = { ...s.univ.party.townLoc };
    // valleydy has no conveyor of its own, so borrow the terrain the party is
    // about to step onto and make it one.
    const idx = s.univ.town!.record.terrain[to.x]![to.y]!;
    const saved = scen.terTypes[idx]!;
    // Point the belt back the way the party is coming from.
    const dir = to.y < from.y ? Direction.S : to.y > from.y ? Direction.N
      : to.x > from.x ? Direction.W : Direction.E;
    scen.terTypes[idx] = { ...saved, special: TerSpec.CONVEYOR, flag1: dir, blockage: 0 };
    try {
      await s.moveTo(to);
      expect(s.univ.transcript.some((l) => l.includes('moving floor'))).toBe(true);
      expect(s.univ.party.townLoc).toEqual(from);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });
});

describe('party death', () => {
  /**
   * `handle_party_death` (boe.actions.cpp:1431), called from the tail of
   * `advance_time` whenever `!univ.party.is_alive()`. This port had nothing
   * hooked up at all, so a party that died just kept sitting there with the
   * game still accepting input.
   */
  /**
   * The announcement waits for the animation queue, so that the blast that
   * killed the party is over before the player is told about it. With no
   * animation waiter installed that wait is a microtask, not real time.
   */
  const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

  it('fires onPartyDeath exactly once when the last PC dies', async () => {
    const s = newSession();
    s.startNewGame();
    let fired = 0;
    s.onPartyDeath = () => { fired++; };
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    await s.pause();
    await flush();
    expect(fired).toBe(1);
    // Upkeep keeps running on a dead party (nothing un-registers it), but the
    // hook must not fire again.
    await s.pause();
    await flush();
    expect(fired).toBe(1);
  });

  it('waits for the blast that killed you before saying so', async () => {
    const s = newSession();
    s.startNewGame();
    let fired = 0;
    s.onPartyDeath = () => { fired++; };
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    // **Deliberately not awaited** — this test is about *when* the hook fires,
    // so it has to look before `pause` has run to completion.
    void s.pause();
    // Not on the same tick the damage resolved: `handle_party_death` is
    // reached from the C++'s main loop, after the blocking blast has played.
    expect(fired).toBe(0);
    await flush();
    expect(fired).toBe(1);
  });

  it('does not fire while anyone is still alive', async () => {
    const s = newSession();
    s.startNewGame();
    let fired = 0;
    s.onPartyDeath = () => { fired++; };
    for (const pc of s.univ.party.pcs.slice(1)) pc.mainStatus = MainStatus.DEAD;
    await s.pause();
    await flush();
    expect(fired).toBe(0);
  });
});

describe('the end of the scenario', () => {
  const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

  const silentHost: SpecialHost = {
    async message() {},
    async choice(_strs, buttons) { return buttons.length - 1; },
    async story() {},
    async askText() { return ''; },
    async askNum(min: number) { return min; },
    async selectPc() { return 0; },
    async getNumOfItems(max: number) { return max; },
    startShop() { return true; },
    startTalk() {},
    sound() {},
    rest() {},
    moveParty() {},
    changeLevel() {},
    forceTown() {},
    endScenario() {},
  };

  /** A session whose scenario special 0 is END_SCENARIO, ready to be run. */
  function wonSession(): GameSession {
    const s = newSession();
    s.startNewGame();
    s.attachSpecials(silentHost);
    s.univ.scenario.scenSpecials.set(0, { ...emptySpecialNode(), type: SpecType.END_SCENARIO });
    return s;
  }

  it('handle_victory fires once the chain that ended the scenario is done', async () => {
    const s = wonSession();
    let won = 0;
    s.onVictory = () => { won++; };
    expect(s.won).toBe(false);
    await s.runSpecial(SpecCtx.STARTUP, SpecCtxType.SCEN, 0, { x: 0, y: 0 });
    await flush();
    expect(won).toBe(1);
    expect(s.won).toBe(true);
  });

  it('clears end_scenario, so the flag does not deaden every later chain', async () => {
    const s = wonSession();
    await s.runSpecial(SpecCtx.STARTUP, SpecCtxType.SCEN, 0, { x: 0, y: 0 });
    await flush();
    // `handle_victory`'s first line is `end_scenario = false`. Left set, the
    // VM's own guard answers every subsequent chain with "nothing happened".
    expect(s.specials!.endScenario).toBe(false);
  });

  it('announces the win only once, however many turns follow', async () => {
    const s = wonSession();
    let won = 0;
    s.onVictory = () => { won++; };
    await s.runSpecial(SpecCtx.STARTUP, SpecCtxType.SCEN, 0, { x: 0, y: 0 });
    await flush();
    await s.pause();
    await flush();
    expect(won).toBe(1);
  });

  /**
   * `advance_time`'s tail is `if(!is_alive()) ... else if(end_scenario) ...`,
   * so a chain that ends the scenario with the same blow that wipes the party
   * is a death, not a win.
   */
  it('death wins the tie against victory', async () => {
    const s = wonSession();
    let won = 0;
    let died = 0;
    s.onVictory = () => { won++; };
    s.onPartyDeath = () => { died++; };
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    await s.runSpecial(SpecCtx.STARTUP, SpecCtxType.SCEN, 0, { x: 0, y: 0 });
    await flush();
    expect(died).toBe(1);
    expect(won).toBe(0);
  });

  /**
   * Restoring from the death dialog puts a live party back; without clearing
   * the latch a second wipe would never announce itself.
   */
  it('loading a game clears both game-over latches', async () => {
    const s = wonSession();
    let died = 0;
    s.onPartyDeath = () => { died++; };
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    await s.pause();
    await flush();
    expect(died).toBe(1);

    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.ALIVE;
    s.resumeLoadedGame();
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    await s.pause();
    await flush();
    expect(died).toBe(2);
  });
});

/**
 * handle_wait (boe.actions.cpp:1296) — the **w** key. Not `handle_pause`,
 * which is Space; this is the long wait, and its dispatcher has an arm the
 * C++ can never reach.
 */
describe('the long wait', () => {
  it('refuses outdoors, where the C++ has nowhere to wait', async () => {
    const s = newSession();
    s.startNewGame();
    await s.moveTo(edgeStep(s));
    expect(s.mode).toBe(GameMode.OUTDOORS);
    await s.wait();
    expect(s.univ.transcript.at(-1)).toBe('Wait: In town only.');
  });

  /**
   * The dead arm. `handle_wait`'s third branch is `overall_mode == MODE_COMBAT`,
   * but the second is `!is_town()` — and `is_town()` is `mode > OUTDOORS &&
   * mode < COMBAT`, so combat never gets past it. Waiting in a fight says "In
   * town only.", which reads like a bug and is what the original does.
   */
  it('says "In town only." in combat, because that arm is unreachable', async () => {
    const s = newSession();
    s.startNewGame();
    s.startCombat(s.univ.party.direction);
    expect(s.mode).toBe(GameMode.COMBAT);
    await s.wait();
    expect(s.univ.transcript.at(-1)).toBe('Wait: In town only.');
  });

  /**
   * The opening test is also the loop's guard, so a hostile monster already in
   * sight means the whole thing is one line and **no time passes at all**.
   */
  it('will not start with a hostile monster in sight, and costs nothing', async () => {
    const s = newSession();
    s.startNewGame();
    // Fort Talrus's own rats are elsewhere in the fort at the start; put one
    // where the party can actually see it.
    const rat = s.univ.town!.monsters.find((m) => m.isAlive)!;
    rat.attitude = Attitude.HOSTILE_A;
    rat.curLoc = { x: s.univ.party.townLoc.x + 1, y: s.univ.party.townLoc.y };
    expect(s.partySeesAMonst()).toBe(true);

    const before = s.univ.party.age;
    await s.wait();
    expect(s.univ.transcript.at(-1)).toBe('Long wait: Monster in sight.');
    expect(s.univ.party.age).toBe(before);
  });

  it('runs its eighty turns when nothing is in sight', async () => {
    const s = newSession();
    s.startNewGame();
    // Clear the town so the loop has nothing to interrupt it.
    for (const m of s.univ.town!.monsters) m.active = 0;
    expect(s.partySeesAMonst()).toBe(false);
    const before = s.univ.party.age;
    await s.wait();
    expect(s.univ.transcript.some((l) => l === 'Long wait...')).toBe(true);
    expect(s.univ.party.age).toBe(before + 80);
  });

  /** Webs are torn free as the party settles in, before the baseline is taken. */
  it('clears webs on the way in', async () => {
    const s = newSession();
    s.startNewGame();
    for (const m of s.univ.town!.monsters) m.active = 0;
    s.univ.party.pcs[0]!.status[Status.WEBS] = 5;
    await s.wait();
    expect(s.univ.party.pcs[0]!.status[Status.WEBS]).toBe(0);
  });
});

/**
 * The party's four-town memory (`cParty::creature_save`, boe.town.cpp:160/551).
 * Walking back into a town it has been in lately restores what it left rather
 * than rebuilding the town from presets — which is what stops the dead getting
 * back up.
 */
describe('town memory', () => {
  function leave(s: GameSession): void {
    s.endTownMode(s.univ.party.townLoc);
  }

  it('keeps the dead dead when the party comes back', async () => {
    const s = newSession();
    s.startNewGame();
    const town = s.univ.town!;
    const victim = town.monsters.findIndex((m) => m.isAlive);
    expect(victim).toBeGreaterThanOrEqual(0);
    const aliveBefore = town.monsters.filter((m) => m.isAlive).length;
    town.monsters[victim]!.active = CreatureStatus.DEAD;

    leave(s);
    s.startTownMode(scen.startTown, FORCED_ENTRY);
    const after = s.univ.town!;
    expect(after.monsters[victim]!.isAlive).toBe(false);
    expect(after.monsters.filter((m) => m.isAlive).length).toBe(aliveBefore - 1);
  });

  it('puts the survivors back on their start squares, idle and whole', async () => {
    const s = newSession();
    s.startNewGame();
    const town = s.univ.town!;
    const i = town.monsters.findIndex((m) => m.isAlive);
    const walker = town.monsters[i]!;
    const home = { ...walker.startLoc };
    walker.curLoc = { x: home.x + 1, y: home.y };
    walker.active = CreatureStatus.ALERTED;
    walker.health = 1;
    walker.target = 2;

    leave(s);
    s.startTownMode(scen.startTown, FORCED_ENTRY);
    const back = s.univ.town!.monsters[i]!;
    expect(back.curLoc).toEqual(home);
    expect(back.active).toBe(CreatureStatus.IDLE);
    expect(back.health).toBe(back.maxHealth);
    expect(back.target).toBe(6);
  });

  it('remembers a web but puts a shoved barrel back', async () => {
    const s = newSession();
    s.startNewGame();
    const town = s.univ.town!;
    const { x, y } = s.univ.party.townLoc;
    town.setField(x, y, FieldType.FIELD_WEB, true);
    town.setField(x, y, FieldType.OBJECT_BARREL, true);

    leave(s);
    s.startTownMode(scen.startTown, FORCED_ENTRY);
    const back = s.univ.town!;
    expect(back.hasField(x, y, FieldType.FIELD_WEB)).toBe(true);
    // update_fields masks the pushables out: they go back to their presets.
    expect(back.hasField(x, y, FieldType.OBJECT_BARREL)).toBe(false);
  });

  it('remembers only four towns, oldest evicted first', async () => {
    const s = newSession();
    s.startNewGame();
    const { party } = s.univ;
    // Five towns, each entered and left in turn. Entering counts for nothing;
    // it is `end_town_mode` that writes a slot.
    const towns = scen.towns.map((_, i) => i).slice(0, 5);
    expect(towns.length).toBe(5);
    for (const t of towns) {
      s.startTownMode(t, FORCED_ENTRY);
      leave(s);
    }
    // `end_town_mode` also stores each town's map onto the shared scenario
    // record; put those back so the next test doesn't start in a lit town.
    for (const t of towns) for (const row of scen.towns[t]!.maps) row.fill(0);
    expect(party.creatureSave.map((p) => p.whichTown).sort((a, b) => a - b))
      .toEqual(towns.slice(1).sort((a, b) => a - b));
    expect(party.atWhichSaveSlot).toBe(1);
  });

  it('thrashes a town the party has cleaned out, and says so', async () => {
    const s = newSession();
    s.startNewGame();
    const record = s.univ.town!.record;
    const before = { max: record.maxNumMonst, killed: record.monstersKilled };
    try {
      // is_cleaned_out: killed > max_num_monst, as in 1997 and Exile III
      // (DIVERGENCES.md §14). Both live on the record, so they survive
      // leaving and coming back — that is the whole point.
      record.maxNumMonst = 5;
      record.monstersKilled = 5;
      s.startTownMode(scen.startTown, FORCED_ENTRY);
      expect(s.univ.town!.monsters.some((m) => m.isAlive)).toBe(true);
      expect(s.univ.transcript.join(' ')).not.toContain('Area has been cleaned out.');
      record.monstersKilled = 6;
      s.startTownMode(scen.startTown, FORCED_ENTRY);
      expect(s.univ.town!.monsters.some((m) => m.isAlive)).toBe(false);
      expect(s.univ.transcript.join(' ')).toContain('Area has been cleaned out.');
      // A replay's flag set has no `town-thrash`, so it keeps OBoE's `>=`.
      setFeatureFlags({});
      record.monstersKilled = 5;
      const replay = newSession();
      replay.startNewGame();
      expect(replay.univ.town!.monsters.some((m) => m.isAlive)).toBe(false);
    } finally {
      resetFeatureFlags();
      record.maxNumMonst = before.max;
      record.monstersKilled = before.killed;
    }
  });

  it('an abandoned town loses its residents and keeps its monsters', async () => {
    const s = newSession();
    s.startNewGame();
    const record = s.univ.town!.record;
    const before = { time: record.townChopTime, key: record.townChopKey };
    // Give the town some hostiles to keep, so the asymmetry is visible.
    try {
      record.townChopTime = 1;
      record.townChopKey = 0;
      s.startTownMode(scen.startTown, FORCED_ENTRY);
      const town = s.univ.town!;
      // OBoE's "Area has been abandoned." is commented out in 1997 (§14).
      expect(s.univ.transcript.join(' ')).not.toContain('abandoned');
      // Every survivor is hostile; nothing friendly is left standing.
      expect(town.monsters.filter((m) => m.isAlive).every((m) => !m.isFriendly)).toBe(true);
    } finally {
      record.townChopTime = before.time;
      record.townChopKey = before.key;
    }
  });

  it('brings in after-death creatures on the chop, not for a cleaned-out town', async () => {
    // Case 9 of 1997's start_town_mode (TOWN.CPP:348) tests the chop alone;
    // OBoE also counts a cleaned-out town (DIVERGENCES.md §14).
    const record = scen.towns[scen.startTown]!;
    const slot = record.creatures.findIndex((c) => c.number > 0);
    const preset = record.creatures[slot]!;
    const before = {
      flag: preset.timeFlag, max: record.maxNumMonst, killed: record.monstersKilled,
      time: record.townChopTime, key: record.townChopKey,
    };
    const present = () => {
      const s = newSession();
      s.startNewGame();
      return s.univ.town!.monsters.some((m) => m.slot === slot && m.isAlive);
    };
    try {
      preset.timeFlag = MonstTime.APPEAR_AFTER_CHOP;
      expect(present()).toBe(false);
      record.maxNumMonst = 1;
      record.monstersKilled = 5;
      expect(present()).toBe(false);
      record.maxNumMonst = before.max;
      record.monstersKilled = before.killed;
      record.townChopTime = 1;
      record.townChopKey = 0;
      expect(present()).toBe(true);
    } finally {
      preset.timeFlag = before.flag;
      record.maxNumMonst = before.max;
      record.monstersKilled = before.killed;
      record.townChopTime = before.time;
      record.townChopKey = before.key;
    }
  });

  it('files the town under the population\'s name, not the party\'s', async () => {
    // cCurTown::readFrom doesn't restore `which_town`, so a town resumed from
    // a save is filed under 200 and rebuilt from presets next time.
    const s = newSession();
    s.startNewGame();
    s.univ.town!.monstWhichTown = 200;
    s.univ.town!.monsters[0]!.active = CreatureStatus.DEAD;
    leave(s);
    expect(s.univ.party.creatureSave.map((p) => p.whichTown)).toContain(200);
    s.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(s.univ.town!.monsters[0]!.isAlive).toBe(true);
  });
});

describe('a move onto the square the party is already on', () => {
  /**
   * `is_blocked` counts the party's own square in town (`if(is_town() &&
   * to_check == univ.party.town_loc) return true`, boe.locutils.cpp:294), so
   * `town_move_party` refuses a `move` to where the party already stands and
   * **charges no turn**. Recordings contain those moves — the original's own
   * `set_direction` has a fall-through for exactly this case.
   *
   * This port assembled `is_blocked`'s list by hand in `town_move_party` and
   * left that clause out, so the step went through, the clock ticked, and every
   * creature in the town was one move ahead of the C++'s from then on —
   * spending **no draws at all** to say so. `ASR_10-05-2025_17-55-45` parted
   * from the oracle 270 draws later, in a creature's terrain roll.
   */
  it('is refused, and costs no turn', async () => {
    const s = newSession();
    s.startNewGame();
    const here = { ...s.univ.party.townLoc };
    const age = s.univ.party.age;

    expect(await s.moveTo(here)).toBe(false);

    expect(s.univ.party.townLoc).toEqual(here);
    expect(s.univ.party.age).toBe(age);
    expect(s.univ.transcript.some((l) => l.startsWith('Blocked:'))).toBe(true);
  });
});

describe('a party with nobody awake', () => {
  /**
   * `someone_awake()` (boe.actions.cpp:2000) is the guard `handle_move`'s
   * MODE_TOWN arm opens with: if every living PC is asleep or paralysed the
   * move is refused **above** `town_move_party`, so it sets no
   * `did_something` and no turn passes either.
   *
   * The clock standing still is the load-bearing half. Nothing wears the sleep
   * off while the party is stuck, so a recording shows a run of clicks that do
   * nothing at all — `ZKR_15-05-2025_16-09-51` has seven of them and then a
   * Combat switch, which is the way out. This port walked all seven and took
   * seven turns doing it.
   */
  it('cannot move, and does not spend the turn trying', async () => {
    const session = newSession();
    await session.startNewGame();
    await session.settled();
    const univ = session.univ;

    const from = { ...univ.party.townLoc };
    const age = univ.party.age;
    // A direction that is walkable while awake, so the refusal below is the
    // sleep and not the scenery.
    const dir = [Direction.N, Direction.S, Direction.E, Direction.W]
      .find((d) => !session.townIsBlocked(shiftLoc(from, d)))!;
    expect(dir).toBeDefined();

    for (const pc of univ.party.pcs) pc.status[Status.ASLEEP] = 5;

    expect(await session.move(dir)).toBe(false);
    expect(univ.party.townLoc).toEqual(from);
    // No turn: the sleep still has all five of its ticks left.
    expect(univ.party.age).toBe(age);
    expect(univ.party.pcs[0]!.status[Status.ASLEEP]).toBe(5);

    // One PC awake is enough, which is the control the refusal above needs —
    // without it the test would pass against a port that had simply lost the
    // step for some other reason.
    univ.party.pcs[2]!.status[Status.ASLEEP] = 0;
    expect(await session.move(dir)).toBe(true);
  });
});

/**
 * The town-entry sound: 95 in the dark, 16 in the light (1997's
 * start_town_mode), and 95 for any town on the scenario's `dungeon-sound`
 * list, as Exile III's `start_town_mode` (`10d8:0526`) has it.
 */
describe('the town-entry sound', () => {
  it("plays the dungeon's for a lit town on the dungeon-sound list", () => {
    const heard = (list: string | undefined): number[] => {
      const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
      const session = new GameSession(univ);
      const played: number[] = [];
      session.sound = { play: (n: number) => { played.push(n); } } as unknown as GameSession['sound'];
      const saved = scen.featureFlags['dungeon-sound'];
      if (list === undefined) delete scen.featureFlags['dungeon-sound'];
      else scen.featureFlags['dungeon-sound'] = list;
      try {
        session.startTownMode(scen.startTown, FORCED_ENTRY, true);
      } finally {
        if (saved === undefined) delete scen.featureFlags['dungeon-sound'];
        else scen.featureFlags['dungeon-sound'] = saved;
      }
      return played;
    };
    expect(scen.towns[scen.startTown]!.lightingType).toBe(0);
    expect(heard(undefined)).toContain(16);
    expect(heard(`${scen.startTown}`)).toContain(95);
    expect(heard(`0-${scen.startTown + 1}`)).toContain(95);
    expect(heard(`${scen.startTown + 1}-99`)).toContain(16);
  });
});

/**
 * `get_blockage`'s pit kludge (boe.locutils.cpp:444): the outdoor arena's
 * border is opaque in an outdoor fight. It is 90, or Exile III's 86 under
 * `outdoor-arena` = `exile3`.
 */
describe("the arena border's opacity", () => {
  it('blocks sight in an outdoor fight only, on the scenario’s own border', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startNewGame();
    const ter = univ.town!.record.terrain;
    const saved = [ter[1]![1]!, scen.featureFlags['outdoor-arena']];
    try {
      ter[1]![1] = 90;
      expect(session.sightObscurity(1, 1)).toBe(0);
      session.mode = GameMode.COMBAT;
      session.whichCombatType = 0;
      expect(session.sightObscurity(1, 1)).toBe(5);
      scen.featureFlags['outdoor-arena'] = 'exile3';
      expect(session.arenaBorder()).toBe(86);
      expect(session.sightObscurity(1, 1)).toBe(0);
    } finally {
      ter[1]![1] = saved[0] as number;
      if (saved[1] === undefined) delete scen.featureFlags['outdoor-arena'];
      else scen.featureFlags['outdoor-arena'] = saved[1] as string;
    }
  });
});
