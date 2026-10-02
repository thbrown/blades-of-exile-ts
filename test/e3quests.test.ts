/**
 * Exile 3's main quests, played through their logic with the quest runner
 * (`support/e3Quest.ts`), one chain per `describe`, following the two
 * walkthroughs (Paul "headbanger"'s and Tuxedo Jack's, on GameFAQs). Travel
 * is a teleport and fights are `killMonst`: these prove every step of a
 * chain can be done and leads to the next, not that a party can win it.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldType } from '../src/data/fields';
import type { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { GameMode } from '../src/game/modes';
import { Skill, Status } from '../src/universe/skills';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir } from '../tools/e3convert/install';
import { partySpecItem } from '../tools/e3convert/script';
import { e3Event } from '../tools/e3convert/flags';
import { SLIME_POOLS } from '../tools/e3convert/towns/slimePit';
import { QuestRunner, loadExile3 } from './support/e3Quest';
import { WallSearch, type WallState } from './support/e3Walls';
import { searchBelts, walkBelts, type BeltGoal, type BeltMove } from './support/e3Belts';
import { WALL_FLOOR, WALL_NORTH, WALL_SOUTH, moveE3Walls } from '../src/game/e3MovingWalls';
import { E3Abil, e3DamageResist, e3SpecDam } from '../src/game/e3Items';
import { DamageType } from '../src/data/monster';
import { ELECTRUM_KEY } from '../tools/e3convert/towns/gale';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import { PIC_CUSTOM_FULL, SpecType } from '../src/data/special';
import { specItemUseable } from '../src/data/quest';
import { Direction, type Location } from '../src/core/location';
import { MainStatus, PartyStatus, Trait } from '../src/universe/skills';
import { GENERATORS } from '../tools/e3convert/towns/shiftingFloors';
import { PANEL_DOORS } from '../tools/e3convert/towns/tinraya';
import { PANTS_CLASS } from '../tools/e3convert/towns/rentarKeep';
import { useItem } from '../src/game/itemUse';
import { killMonst } from '../src/game/damage';
import { Alchemy, alchemyName } from '../src/data/alchemy';
import { alchemyChoices, makePotion } from '../src/game/alchemy';
import { giveItem } from '../src/universe/inventory';

const dir = findE3Dir();

describe.skipIf(!dir)('Exile 3 main quests', () => {
  const out = mkdtempSync(join(tmpdir(), 'e3quests-'));
  let scen: Scenario;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    scen = await loadExile3(out);
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  /** Where E3's spot `id` of `town` is, from the converter's `debug.json`. */
  const spot = (town: number, id: number): [number, number] => {
    const spots = JSON.parse(readFileSync(join(out, 'debug.json'), 'utf8')) as { towns: Record<string, { id: number; x: number; y: number }[]> };
    const s = spots.towns[town]!.find((l) => l.id === id)!;
    return [s.x, s.y];
  };

  /** The terrain of square (x, y) of the whole outdoor map. */
  const terAt = (x: number, y: number): number => scen.outdoors[Math.floor(x / 48)]![Math.floor(y / 48)]!.terrain[x % 48]![y % 48]!;
  /**
   * Steps from `from` to `to` over the whole outdoor map, on squares whose
   * terrain `ok` allows and E3's ways through (spot 50: fords and passes),
   * avoiding `avoid`; or -1.
   */
  const outdoorPath = (from: [number, number], to: [number, number], ok: (t: number) => boolean, avoid = new Set<string>()): number => {
    const ways = new Set<string>();
    scen.outdoors.forEach((col, sx) => col.forEach((o, sy) => o.specialLocs.forEach((l) => {
      const n = o.specials.get(l.spec);
      if (n?.type === SpecType.CANT_ENTER && n.ex1a === 0 && n.ex2a === 1) ways.add(`${sx * 48 + l.x},${sy * 48 + l.y}`);
    })));
    const seen = new Map([[from.join(), 0]]);
    const queue = [from];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      const d = seen.get(`${x},${y}`)!;
      if (x === to[0] && y === to[1]) return d;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const n: [number, number] = [x + dx, y + dy];
        if (n[0] < 0 || n[1] < 0 || n[0] >= 432 || n[1] >= 480 || seen.has(n.join()) || avoid.has(n.join())) continue;
        if ((n[0] !== to[0] || n[1] !== to[1]) && !ways.has(n.join()) && !ok(terAt(...n))) continue;
        seen.set(n.join(), d + 1);
        queue.push(n);
      }
    }
    return -1;
  };

  describe('the slimes', () => {
    it('Agate Tower: Jordan\'s notes find the Slime Pit, and a fireball ends his slime maker', async () => {
      const q = new QuestRunner(scen);
      await q.enter(46, { x: 16, y: 30 });
      expect(q.creatures(/Jordan/).length).toBe(1);
      await q.kill(/Jordan/);
      expect(scen.towns[22]!.canFind).toBe(false);
      // Any bookshelf of the three, searched from beside it.
      await q.look(12, 42);
      expect(scen.towns[22]!.canFind, q.log.join('\n') + q.univ.transcript.slice(-8).join('\n')).toBe(true);
      // The slime maker, under its sleep clouds.
      await q.castAt(24, 41);
      expect(q.flag(0x259), q.tail()).toBe(1);
      expect(q.town.monsters.some((m) => m.isAlive && [138, 139, 140, 141].includes(m.number))).toBe(false);
    });

    it("Colchis: Move Mountains breaks into the shade's room, and its word opens the pillar and the anvil", async () => {
      const q = new QuestRunner(scen);
      await q.enter(125);
      await q.clearHostiles();
      const ghost = q.creatures(/Ghost/)[0]!;
      expect(ghost, 'the shade').toBeDefined();
      // Tuxedo Jack's way in: Move Mountains on the Moldy Wall at (36,40),
      // one of the nine terrains E3's crumble_wall breaks (DS:30b0).
      expect(q.town.record.terrain[36]![40]).toBe(112);
      q.place({ x: 38, y: 40 });
      await q.spell(Spell.MOVE_MOUNTAINS, 36, 40);
      expect(q.univ.transcript, q.univ.transcript.join(' / ')).toContain('  Barrier crumbles.');
      // Surface rubble: the view holds grass.
      expect(q.town.record.terrain[36]![40]).toBe(0x61);
      expect(q.canReach({ x: 38, y: 40 }, ghost.curLoc)).toBe(true);
      // A wall off E3's list stays up: the secret door beside it (101).
      const said = q.univ.transcript.length;
      await q.spell(Spell.MOVE_MOUNTAINS, 36, 39);
      expect(q.univ.transcript.slice(said)).toEqual(['  Target spell.', '  You blast the area.']);
      expect(q.town.record.terrain[36]![39]).toBe(101);
      // Walked into, it opens under its message (spot 113), as E3's move
      // code opens a secret door after the square's spot (`10c0:14df`).
      await q.step(36, 39);
      expect(q.town.record.terrain[36]![39], q.tail()).toBe(102);
      expect(q.log.at(-1), 'its message').toMatch(/^\[msg/);

      // Before the shade speaks, the pillar and the anvil hold nothing.
      const [px, py] = spot(125, 1), [ax, ay] = spot(125, 2);
      await q.look(px, py);
      await q.look(ax, ay);
      expect(q.hasItem(/Necklace/) || q.hasItem(/Alertness/), q.tail()).toBe(false);

      const [gift] = await q.talk(/Ghost/, 'gift');
      expect(gift).toMatch(/pillar.*anvil/);
      expect(q.flag(0x56e)).toBe(1);
      await q.look(px, py);
      await q.look(ax, ay);
      expect(q.hasItem(/Basic Necklace/), q.tail()).toBe(true);
      expect(q.hasItem(/Helm of Alertness/), q.tail()).toBe(true);

      // What they're for: the helm wards off sleep, the necklace acid.
      const holder = (re: RegExp) => q.party.pcs.find((pc) => pc.items.some((it) => re.test(it.fullName)))!;
      for (const re of [/Helm of Alertness/, /Basic Necklace/]) {
        const pc = holder(re);
        q.session.toggleEquip(q.party.pcs.indexOf(pc), pc.items.findIndex((it) => re.test(it.fullName)));
      }
      const helmed = holder(/Helm of Alertness/), necked = holder(/Basic Necklace/);
      expect(helmed.equip[helmed.items.findIndex((it) => /Alertness/.test(it.fullName))], 'helm worn').toBe(true);
      for (let i = 0; i < 20; i++) helmed.sleep(Status.ASLEEP, 10, 0, q.univ.rng);
      expect(helmed.status[Status.ASLEEP] ?? 0).toBeLessThanOrEqual(0);
      necked.acid(10);
      expect(necked.status[Status.ACID] ?? 0).toBe(0);
    });

    it('Slime Pit: each pedestal button opens one way down, and each way reaches the pools', async () => {
      // Where the stairs from level 1 (its spots 21–26) land on level 2; the
      // button that opens the way from each, and whether the way needs the
      // boat that waits on level 2 at (12,62).
      const ways = [
        { button: 1, from: { x: 2, y: 0x3e } },
        { button: 2, from: { x: 9, y: 0x3a }, boat: true },
        { button: 3, from: { x: 0x21, y: 0x2d } },
        { button: 4, from: { x: 0x2d, y: 0x1c } },
        { button: 5, from: { x: 0x3a, y: 1 } },
      ];
      const pools = SLIME_POOLS.map(([x, y]) => ({ x, y }));
      for (const way of ways) {
        const q = new QuestRunner(scen);
        await q.enter(22, { x: 33, y: 31 });
        q.number(way.button);
        await q.step(32, 30);
        expect(q.flag(0x169), q.tail()).toBe(way.button - 1);
        await q.enter(23, way.from);
        for (const other of ways) {
          const open = pools.some((p) => q.canReach(other.from, p, { boat: true }));
          expect(open, `button ${way.button}, way ${other.button}`).toBe(other === way);
        }
        for (const p of pools) {
          expect(q.canReach(way.from, p, { boat: way.boat }), `button ${way.button}, pool ${p.x},${p.y}`).toBe(true);
        }
        if (way.boat) {
          expect(pools.some((p) => q.canReach(way.from, p)), 'on foot').toBe(false);
          expect(q.canReach(way.from, { x: 12, y: 62 }), 'the boat').toBe(true);
          expect(scen.boats.some((b) => b.exists && b.whichTown === 23 && b.loc.x === 12 && b.loc.y === 62)).toBe(true);
        }
      }
    });

    it('Slime Pit: five pools burned, the Alien Slime killed, the rune taken, the mission reported and rewarded', async () => {
      const q = new QuestRunner(scen);
      // Krizsan's mayor asks for help first (0xc84, the mission).
      await q.enter(0);
      const [asked] = await q.talk(/Arbuckle/, 'miss');
      expect(q.flag(0xc84), asked).toBe(1);

      await q.enter(23, { x: 30, y: 10 });
      // Spot 3, on the way to the Alien Slime, refuses the step until the pools are gone.
      await q.step(28, 19);
      expect(q.at, q.tail()).not.toEqual({ x: 28, y: 19 });
      expect(q.log.at(-1)).toMatch(/^\[msg/);
      SLIME_POOLS.forEach(([x, y]) => expect(q.town.record.terrain[x]![y]).toBe(255));
      for (const [x, y] of SLIME_POOLS) await q.castAt(x, y, Spell.FIREBALL);
      for (let i = 0; i < 5; i++) expect(q.flag(0x14c + i), q.tail()).toBe(1);
      // The last pool opens spot 3's wall.
      expect(q.flag(0x16d)).toBe(20);
      const shown = q.log.length;
      await q.step(28, 19);
      expect(q.at, q.tail()).toEqual({ x: 28, y: 19 });
      expect(q.log.length).toBe(shown);

      // The Alien Slime (spec1 0xc9), behind spot 8's prompt.
      const before = q.creatures(/Alien Slime/).length;
      if (before === 0) await q.step(39, 44);
      expect(q.creatures(/Alien Slime/).length, q.tail()).toBeGreaterThan(0);
      await q.kill(/Alien Slime/);
      expect(q.flag(0xc85), q.tail()).toBe(1);

      // The secret passage's special: the rune the party draws.
      await q.step(30, 2);
      expect(q.hasSpecItem(partySpecItem(0x40)), q.tail()).toBe(true);

      // The mayor pays 1500 for it, once.
      await q.enter(0);
      const gold = q.party.gold;
      await q.talk(/Arbuckle/, 'miss');
      expect(q.party.gold - gold, q.tail()).toBe(1500);
      await q.talk(/Arbuckle/, 'miss');
      expect(q.party.gold - gold).toBe(1500);

      // Back at the fort: Anaximander hears both reports, Berra takes the
      // rune as evidence, Levy hands over a Strong Skill Potion.
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.flag(0xc84), q.tail()).toBe(2);
      expect(q.flag(0xc85), q.tail()).toBe(2);
      await q.talk(/Berra/, 'evid');
      expect(q.hasSpecItem(partySpecItem(0x40)), q.tail()).toBe(false);
      expect(q.flag(0xc96)).toBe(1);
      expect(q.hasItem(/Strong Skill/)).toBe(false);
      const replies = await q.talk(/Levy/, 'rewa');
      expect(q.flag(0xc85), `${replies.join(' / ')}\n${q.tail()}`).toBe(3);
      expect(q.hasItem(/Strong Skill/), q.tail()).toBe(true);
      // Solberg, in the Tower of Magi, teaches two spells for it.
      await q.enter(24, { x: 10, y: 10 });
      await q.talk(/Solberg/, 'rewa');
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x1f]), q.tail()).toBe(true);
    });
  });
  describe('the roaches', () => {
    it("Shayder's mission, the spiders' fight, and the roaches' map to the Filth Factory", async () => {
      const q = new QuestRunner(scen);
      // Mayor Bernathy asks for help (0xca), with its journal entry.
      await q.enter(4);
      const [mission] = await q.talk(/Bernathy/, 'miss');
      expect(q.flag(0xca), mission).toBe(1);

      // The Friendly, Happy Spiders: the guard lets the party by ("spider"),
      // and the chief asks for help against the roaches ("friendly").
      await q.enter(48, { x: 22, y: 43 });
      await q.talk(177, 'spid');
      const [before] = await q.talk(175, 'frie');
      expect(q.flag(0xa83), before).toBe(1);
      expect(scen.towns[92]!.canFind).toBe(false);

      // Northwest of the caves, zone 55's spot 1 (9,9): Help, and the fight.
      const [sx, sy] = [1, 6];
      await q.outdoors(sx, sy, 10, 10);
      q.answer('Attack');
      await q.step(9, 9);
      expect(await q.fightOutdoors(), q.tail() + q.univ.transcript.slice(-6).join(' / ')).toBe(true);
      expect(q.flag(0xa83), q.tail()).toBe(2);
      // Once only.
      await q.step(9, 10);
      await q.step(9, 9);
      expect(q.session.mode, q.tail()).toBe(GameMode.OUTDOORS);
      expect(q.party.outC.some((g) => g.exists)).toBe(false);

      // The chief says where the roaches live, and the lair goes on the map.
      await q.enter(48, { x: 22, y: 43 });
      const [after] = await q.talk(175, 'frie');
      expect(after).not.toBe(before);
      expect(scen.towns[92]!.canFind, after).toBe(true);

      // The Happy, Friendly Roaches: their map (spot 11 at (7,5)) puts the
      // Filth Factory on the world map, and the Filth Spreader says where.
      expect(scen.towns[26]!.canFind).toBe(false);
      await q.enter(92, { x: 12, y: 1 });
      await q.step(7, 5);
      expect(scen.towns[26]!.canFind, q.tail()).toBe(true);
      // Asked first, the Filth Spreader does the same (a BUY_TOWN_LOC node).
      const r = new QuestRunner(scen);
      await r.enter(92, { x: 12, y: 1 });
      expect(scen.towns[26]!.canFind).toBe(false);
      const [located] = await r.talk(/Filth Spreader/, 'loca');
      expect(located, r.tail()).toMatch(/north of the biggest human town/);
      expect(scen.towns[26]!.canFind, r.tail()).toBe(true);
    });
    it("Kuper's skiff to Kneece, and Purgatos's Phoenix Egg once the factory is found", async () => {
      const q = new QuestRunner(scen);
      await q.enter(131, { x: 24, y: 40 });
      // The middle dock (spot 2) is refused until Olga sells a ticket (0x5aa).
      await q.step(24, 43);
      expect(q.townNum, q.tail()).toBe(131);
      await q.talk(/Olga/, 'purc');
      expect(q.flag(0x5aa), q.tail()).toBeGreaterThan(0);
      await q.step(24, 43);
      expect(q.townNum, q.tail()).toBe(135);
      expect(q.flag(0x5aa)).toBe(0);
      const landing = { ...q.at };

      // Purgatos's house, past the barrier at (29,22) (spot 7).
      const purgatos = q.creatures(/Purgatos/)[0]!;
      expect(q.canReach(landing, { x: 29, y: 22 }), 'to the barrier').toBe(true);
      await q.step(29, 22);
      expect(q.at, q.tail()).toEqual({ x: 29, y: 22 });
      expect(q.canReach({ x: 29, y: 22 }, purgatos.curLoc), 'to Purgatos').toBe(true);

      // Before the Filth Factory is on the map, he has nothing to give.
      const [early] = await q.talk(/Purgatos/, 'devi');
      expect(q.hasSpecItem(38), early).toBe(false);
      scen.towns[26]!.canFind = true;
      const [egg] = await q.talk(/Purgatos/, 'devi');
      expect(q.hasSpecItem(38), egg).toBe(true);
      expect(egg).not.toBe(early);
      // Once.
      q.party.specItems.delete(38);
      await q.talk(/Purgatos/, 'devi');
      expect(q.hasSpecItem(38)).toBe(false);

      // And home for nothing, from the dock at (25,4).
      await q.step(25, 4);
      expect(q.townNum, q.tail()).toBe(131);
    });
    it('The Anama: three priests hear a yes, Ahonar takes the party in, and the ring opens their doors', async () => {
      const q = new QuestRunner(scen);
      const YES = 0x57f, NO = 0x580, ANAMA = 0xac, RINGS = partySpecItem(0x5a);
      await q.enter(4);
      const [tooSoon] = await q.talk(/Ahonar/, 'join');
      expect(q.flag(ANAMA), tooSoon).toBe(0);
      // Members only: the temple's inner doors (Shayder's spot 9) refuse the party.
      const [dx, dy] = spot(4, 9);
      await q.step(dx, dy);
      expect(q.at, q.tail()).not.toEqual({ x: dx, y: dy });

      // Around the island, each priest asks once whether the party believes.
      const priests: [number, RegExp, string][] = [
        [127, /Father Rice/, 'beli'], [129, /Mother Loomis/, 'shar'], [131, /Mother Melamed/, 'phil'],
      ];
      for (const [t, who, word] of priests) {
        await q.enter(t);
        q.answer('Yes');
        await q.talk(who, word);
      }
      expect(q.flag(YES), q.tail()).toBe(3);
      // Asked again, a priest doesn't count twice.
      await q.talk(/Mother Melamed/, 'phil');
      expect(q.flag(YES)).toBe(3);
      expect(q.flag(NO)).toBe(0);

      // Joining: mage skill turns to priest skill, the mage spells from 30 on
      // are forgotten, and every PC wears the ring.
      await q.enter(4);
      const before = q.party.pcs.map((pc): [number, number] => [pc.skills[Skill.MAGE_SPELLS]!, pc.skills[Skill.PRIEST_SPELLS]!]);
      for (const pc of q.party.pcs) pc.mageSpells[31] = true;
      const [joined] = await q.talk(/Ahonar/, 'join');
      expect(q.flag(ANAMA), `${joined}\n${q.tail()}`).toBe(3);
      expect(q.hasSpecItem(RINGS)).toBe(true);
      q.party.pcs.forEach((pc, i) => {
        const [mage, priest] = before[i]!;
        expect(pc.skills[Skill.MAGE_SPELLS], pc.name).toBe(0);
        expect(pc.skills[Skill.PRIEST_SPELLS], pc.name).toBe(Math.min(7, priest + Math.max(2, mage)));
        expect(pc.mageSpells[31], pc.name).toBe(false);
      });
      await q.step(dx, dy);
      expect(q.at, q.tail()).toEqual({ x: dx, y: dy });
      // The altar heals members.
      q.party.pcs[0]!.curHealth = 1;
      const [ax, ay] = spot(4, 21);
      await q.step(ax, ay);
      expect(q.party.pcs[0]!.curHealth, q.tail()).toBeGreaterThan(1);

      // The upper temple's prayer books teach members priest spells.
      await q.enter(91, { x: 10, y: 10 });
      const [bx, by] = spot(91, 14);
      await q.step(bx, by);
      expect(q.party.pcs.some((pc) => pc.priestSpells[30]), q.tail()).toBe(true);
      // Its treasure's barrier makes enemies of the Anama, and Shayder turns on the party.
      const [tx, ty] = spot(91, 2);
      await q.step(tx, ty);
      expect(q.flag(ANAMA), q.tail()).toBe(2);
      await q.enter(4);
      expect(q.creatures(/Ahonar/)[0]!.isFriendly, q.tail()).toBe(false);
    });

    it('The Anama: three noes, and Ahonar never asks', async () => {
      const q = new QuestRunner(scen);
      const priests: [number, RegExp, string][] = [
        [127, /Father Rice/, 'beli'], [129, /Mother Loomis/, 'shar'], [132, /Gavlax/, 'fait'],
        [4, /Lockhart/, 'beli'], [131, /Mother Melamed/, 'phil'],
      ];
      for (const [t, who, word] of priests.slice(0, 3)) {
        await q.enter(t);
        q.answer('Leave|No');
        await q.talk(who, word);
      }
      expect(q.flag(0x580), q.tail()).toBe(3);
      for (const [t, who, word] of priests.slice(3)) {
        await q.enter(t);
        q.answer('Yes');
        await q.talk(who, word);
      }
      expect(q.flag(0x57f), q.tail()).toBe(2);
      await q.enter(4);
      const [refused] = await q.talk(/Ahonar/, 'join');
      expect(q.flag(0xac), refused).toBe(0);
      expect(q.log.at(-2) ?? '', 'no question asked').not.toMatch(/^\[choice/);
    });
    it("The Anama: a ring bought in Lorelei opens their doors, until Ahonar takes it back", async () => {
      const q = new QuestRunner(scen);
      const RINGS = partySpecItem(0x5a);
      await q.enter(12);
      q.party.gold = 3000;
      const [sold] = await q.talk(/Geoffrey/, 'ring');
      expect(q.hasSpecItem(RINGS), sold).toBe(true);
      expect(q.party.gold).toBe(500);
      await q.enter(4);
      const [dx, dy] = spot(4, 9);
      await q.step(dx, dy);
      expect(q.at, q.tail()).toEqual({ x: dx, y: dy });
      await q.talk(/Ahonar/, 'join');
      expect(q.hasSpecItem(RINGS), q.tail()).toBe(false);
      expect(q.flag(0x580)).toBe(5);
    });
    it('Filth Factory 1: one PC into the control room, the slime flow halted, and the dry trench to the stairs', async () => {
      const q = new QuestRunner(scen);
      await q.enter(26, { x: 4, y: 32 });
      const entry = { x: 4, y: 32 };
      const [cx, cy] = spot(26, 17), [px, py] = spot(26, 14), [ux, uy] = spot(26, 18), [sx, sy] = spot(26, 21);
      expect(q.canReach(entry, { x: cx, y: cy }), 'to the control room door').toBe(true);
      // The stairs down are past the slime river while it flows.
      expect(q.canReach(entry, { x: sx, y: sy }), 'stairs, flowing').toBe(false);

      // The control room lets one in (spot 17): the rest wait outside.
      q.pick = 0;
      await q.step(cx, cy);
      expect(q.party.isSplit(), q.tail()).toBe(true);
      const solo = { ...q.at };
      expect(q.canReach(solo, { x: px, y: py }), 'to the panel').toBe(true);
      await q.clearHostiles();

      // The panel: 2 halts the flow (0 walks away).
      q.number(2, 0);
      await q.step(px, py);
      expect(q.flag(0x191), q.tail()).toBeGreaterThanOrEqual(119);
      expect(q.town.record.terrain[47]![33]).toBe(141);
      expect(q.town.record.terrain[50]![34]).toBe(210);

      // Back out (spot 18) and together again, then down the dry trench.
      const toExit = q.pathLength({ x: px, y: py }, { x: ux, y: uy });
      expect(toExit, 'panel to the way out').toBeGreaterThan(0);
      await q.step(ux, uy);
      expect(q.party.isSplit(), q.tail()).toBe(false);
      const toStairs = q.pathLength(q.at, { x: sx, y: sy });
      expect(toStairs, 'to the stairs, dry').toBeGreaterThan(0);
      // The walkthroughs say run: the flow restarts 120 turns on.
      expect(toExit + toStairs, 'turns to spare').toBeLessThan(120);

      // Left too long, the flow comes back and the way shuts.
      await q.pause(130);
      expect(q.flag(0x191), q.tail()).toBe(0);
      expect(q.town.record.terrain[50]![34], q.tail()).toBe(71);
      expect(q.canReach(q.at, { x: sx, y: sy }), 'stairs, flowing again').toBe(false);
    });
    it('Filth Factory 2: the capped pipes burst, the portals run to the heart, the scales, and the Phoenix Egg', async () => {
      const q = new QuestRunner(scen);
      await q.enter(27, { x: 0x37, y: 0xd });
      const arrival = { ...q.at };
      const at = (id: number) => { const [x, y] = spot(27, id); return { x, y }; };
      const caps = at(22), machinery = at(24), portal = at(16);
      expect(q.canReach(arrival, caps), 'to the caps').toBe(true);
      expect(q.canReach(arrival, machinery), 'to the machinery').toBe(true);
      // The portal is walled off behind the sampling room's pipes.
      expect(q.canReach(arrival, portal), 'portal, walled').toBe(false);

      // Cap the pipes, start the machinery, and wait: they burst the wall.
      await q.step(caps.x, caps.y);
      expect(q.flag(0x199), q.tail()).toBe(1);
      await q.step(machinery.x, machinery.y);
      expect(q.flag(0x19a), q.tail()).toBeGreaterThan(0);
      await q.pause(12);
      expect(q.town.record.terrain[52]![34], q.tail()).toBe(0);
      expect(q.canReach(q.at, portal), 'portal, open').toBe(true);

      // Through the portals, four times, to the northwest corner.
      await q.step(portal.x, portal.y);
      for (const id of [15, 18, 17]) {
        const p = at(id);
        expect(q.canReach(q.at, p), `to portal ${id} from ${JSON.stringify(q.at)}`).toBe(true);
        await q.step(p.x, p.y);
      }
      expect(q.at, q.tail()).toEqual({ x: 3, y: 3 });

      // Round the filth to the scales (spot 5), then the heart (spot 2).
      const scales = at(5), heart = at(2);
      expect(q.canReach(q.at, scales), 'to the scales').toBe(true);
      await q.step(scales.x, scales.y);
      expect(q.hasSpecItem(partySpecItem(0x42)), q.tail()).toBe(true);
      expect(q.canReach(q.at, heart), 'to the heart').toBe(true);
      // Without the egg there's nothing to do there.
      await q.step(heart.x, heart.y);
      expect(q.flag(0xc87), q.tail()).toBe(0);
      q.party.specItems.add(38);
      await q.step(heart.x, heart.y);
      expect(q.flag(0xc87), q.tail()).toBe(1);
      expect(q.hasSpecItem(38)).toBe(false);
      expect(scen.towns[26]!.canFind).toBe(false);
      expect(q.town.monsters.some((m) => m.isAlive && !m.isFriendly), 'the roaches').toBe(false);

      // And out: the stairs up (spot 19), then west off the map's edge.
      const up = at(19);
      expect(q.canReach(q.at, up), 'to the stairs up').toBe(true);
      await q.step(up.x, up.y);
      expect(q.townNum, q.tail()).toBe(26);
      expect(q.canReach(q.at, { x: 0, y: 36 }), `out west from ${JSON.stringify(q.at)}`).toBe(true);
    });
    it('The roaches reported and rewarded: Bernathy, Anaximander, Berra, Levy and Solberg; the roaches gone', async () => {
      const q = new QuestRunner(scen);
      const ROACH_KINDS = [143, 144, 145, 146, 147];
      await q.enter(26, { x: 4, y: 32 });
      expect(q.town.monsters.some((m) => m.isAlive && ROACH_KINDS.includes(m.number)), 'roaches before').toBe(true);

      // The mission, then the factory burned (the heart's own flags, as Filth Factory 2 sets them).
      await q.enter(4);
      await q.talk(/Bernathy/, 'miss');
      q.setFlag(0xc87, 1);
      q.party.specItems.add(partySpecItem(0x42));
      await q.enter(26, { x: 4, y: 32 });
      expect(q.town.monsters.some((m) => m.isAlive && ROACH_KINDS.includes(m.number)), 'roaches after').toBe(false);

      // Bernathy's reward, once.
      await q.enter(4);
      const [thanks] = await q.talk(/Bernathy/, 'miss');
      expect(q.flag(0xca), thanks).toBe(2);
      expect(q.hasItem(/Gold Skill Ring/), thanks).toBe(true);
      const [again] = await q.talk(/Bernathy/, 'miss');
      expect(again).not.toBe(thanks);

      // Anaximander hears the report and hands over the Amulet of Rapid Returning.
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.flag(0xc87), q.tail()).toBe(2);
      expect(q.hasSpecItem(partySpecItem(0x1a)), q.tail()).toBe(true);
      // Berra takes the scales as evidence.
      await q.talk(/Berra/, 'evid');
      expect(q.hasSpecItem(partySpecItem(0x42)), q.tail()).toBe(false);
      expect(q.flag(0xc97)).toBe(1);
      // Levy's reward, and Solberg's two spells.
      const [ring] = await q.talk(/Levy/, 'rewa');
      expect(q.flag(0xc87), ring).toBe(3);
      expect(q.hasItem(/Ring of Free Action/), ring).toBe(true);
      await q.enter(24, { x: 10, y: 10 });
      await q.talk(/Solberg/, 'rewa');
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x28] && pc.mageSpells[0x2b]), q.tail()).toBe(true);
    });
  });
  describe('the giants and troglodytes', () => {
    /** An open square beside (x, y), to cast at it from. */
    const beside = (q: QuestRunner, x: number, y: number): { x: number; y: number } => {
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const p = { x: x + dx, y: y + dy };
        if (q.town.isOnMap(p.x, p.y) && !q.session.townIsBlocked(p)) return p;
      }
      throw new Error(`nowhere beside (${x},${y})`);
    };
    /** The Ritual of Sanctification, cast on (x, y) from beside it. */
    const sanctify = async (q: QuestRunner, x: number, y: number): Promise<string[]> => {
      q.place(beside(q, x, y));
      const before = q.univ.transcript.length;
      await q.spell(Spell.RITUAL_SANCTIFY, x, y);
      return q.univ.transcript.slice(before);
    };
    /** The moving walls of the town the runner is in, as `WallSearch` lists them. */
    const wallsOf = (q: QuestRunner): number[] => {
      const out: number[] = [];
      for (let x = 0; x < 48; x++) {
        for (let y = 0; y < 48; y++) {
          const t = q.town.record.terrain[x]![y]!;
          if (t === WALL_NORTH) out.push(WallSearch.cellOf(x, y) * 4 + 1);
          if (t === WALL_SOUTH) out.push(WallSearch.cellOf(x, y) * 4 + 2);
        }
      }
      return out;
    };
    const KNIGHT = 0xe8, LEVIN = 0xf1, CORIE = 0xf2, TROGLO_STAGE = 0x1a4;
    const PASS = partySpecItem(0x5e), SCROLL = partySpecItem(0x62);

    it("Sharimik's triad: Knight's mission, Levin's price, the hermit's Ritual, and the Troglo Temple's altars", async () => {
      // (A second runner resets the shared scenario's towns, so side checks come first.)
      // Kneeling at the dark altar (spot 5) kills the party, until it is sanctified.
      {
        const r = new QuestRunner(scen);
        await r.enter(101, { x: 20, y: 20 });
        await r.step(...spot(101, 5));
        expect(r.party.pcs.some((pc) => pc.isAlive), r.tail()).toBe(false);
      }
      const q = new QuestRunner(scen);
      q.party.gold = 5000;
      await q.enter(8);
      await q.talk(/Mayor Knight/, 'miss');
      expect(q.flag(KNIGHT), q.tail()).toBe(1);
      // Levin names his price, then takes it.
      await q.talk(/Levin/, 'miss', 'miss');
      expect(q.flag(LEVIN), q.tail()).toBe(1);
      expect(q.party.gold).toBe(4000);
      // Corie wants the troglodytes' altar sanctified first.
      await q.talk(/Commander Corie/, 'miss');
      expect(q.flag(CORIE), q.tail()).toBe(0);
      await q.talk(/Mayor Knight/, 'miss');
      expect(q.hasSpecItem(PASS), q.tail()).toBe(false);

      // The hermit in the hills teaches the Ritual (priest spell 8).
      await q.enter(100);
      await q.talk(/Hermit/, 'trog');
      expect(q.party.pcs.some((pc) => pc.priestSpells[8]), q.tail()).toBe(true);

      // The Troglo Temple (town 53): the stairs to the altars (spot 11).
      await q.enter(53);
      await q.step(...spot(53, 11));
      expect(q.townNum, q.tail()).toBe(101);
      await q.clearHostiles();
      // Anywhere else, the Ritual does nothing.
      expect(await sanctify(q, 20, 20)).toContain('  Nothing happens.');
      // The dark altar: the hordlings come, and its deadly spot dies.
      const said = await sanctify(q, 25, 13);
      expect(said, q.tail()).not.toContain('  Nothing happens.');
      expect(q.flag(0x47f), q.tail()).toBe(1);
      expect(q.flag(0x47b)).toBe(20);
      expect(q.creatures(/Hordling/).some((m) => !m.isFriendly), q.tail()).toBe(true);
      // Only once.
      expect(await sanctify(q, 25, 13)).toContain('  Nothing happens.');
      await q.clearHostiles();
      // The altar beside it no longer asks, or kills.
      const asked = q.log.length;
      await q.step(...spot(101, 5));
      expect(q.log.slice(asked).some((l) => /kneel/.test(l)), q.tail()).toBe(false);
      expect(q.party.pcs.every((pc) => pc.isAlive), q.tail()).toBe(true);
      // The inner altar: a haakai.
      await sanctify(q, 28, 25);
      expect(q.flag(0x47e), q.tail()).toBe(1);
      expect(q.flag(0x47c)).toBe(20);
      expect(q.creatures(/Haakai/).length, q.tail()).toBeGreaterThan(0);

      // Corie agrees, and the mayor hands over the papers for Castle Troglo.
      await q.enter(8);
      await q.talk(/Commander Corie/, 'miss');
      expect(q.flag(CORIE), q.tail()).toBe(1);
      await q.talk(/Mayor Knight/, 'miss');
      expect(q.flag(KNIGHT), q.tail()).toBe(2);
      expect(q.hasSpecItem(PASS), q.tail()).toBe(true);
    });

    it('The Ritual elsewhere, as the original answered (check-in #3): the spiders, Shayder, the Great Circle', async () => {
      // The spiders' altar: the message every time (E3-SUSPECTED-BUGS.md
      // #18), the demon only the first, as `FUN_1090_4053` finds nobody left
      // to bring in.
      {
        const q = new QuestRunner(scen);
        await q.enter(48);
        const first = await sanctify(q, 11, 15);
        expect(first, q.tail()).not.toContain('  Nothing happens.');
        expect(q.creatures(/Demon/).length, q.tail()).toBe(1);
        const xp = q.party.pcs[0]!.experience;
        const second = await sanctify(q, 11, 15);
        expect(second, q.tail()).not.toContain('  Nothing happens.');
        expect(q.log.filter((l) => /easily disrupt the altar's dark energy/.test(l)).length, q.tail()).toBe(2);
        expect(q.party.pcs[0]!.experience, q.tail()).toBeGreaterThan(xp);
        expect(q.creatures(/Demon/).length, q.tail()).toBe(1);
        await q.kill(/Demon/);
        await sanctify(q, 11, 15);
        expect(q.creatures(/Demon/).length, q.tail()).toBe(0);
      }
      // Shayder's Anama altar: "This was a horrible, horrible mistake", and
      // the game is over.
      {
        const q = new QuestRunner(scen);
        await q.enter(4);
        await sanctify(q, 20, 14);
        expect(q.log.some((l) => /horrible, horrible mistake/.test(l)), q.tail()).toBe(true);
        expect(q.party.pcs.some((pc) => pc.isAlive), q.tail()).toBe(false);
      }
      // The Great Circle's altar: once. (Taking the haakai's bargain; refused,
      // "Nothing happens." follows the fight, as in E3.)
      {
        const q = new QuestRunner(scen);
        await q.enter(62);
        q.answer(/^(OK|Yes)$/, /^(OK|Yes)$/, /^(OK|Yes)$/);
        const first = await sanctify(q, 23, 24);
        expect(first, q.tail()).not.toContain('  Nothing happens.');
        expect(q.log.some((l) => /Dazed, you raise your blade/.test(l)), q.tail()).toBe(true);
        expect(await sanctify(q, 23, 24), q.tail()).toContain('  Nothing happens.');
      }
    });

    it("Castle Troglo: the pass through the hills, the cell, Vothkaro's question, and Elhioc behind the dials", async () => {
      // Asked whether the party read his scroll, Leave, and Vothkaro won't talk.
      {
        const r = new QuestRunner(scen);
        r.setFlag(TROGLO_STAGE, 3);
        await r.enter(28);
        r.answer('Leave');
        await expect(r.talk(/Vothkaro/, 'here')).rejects.toThrow(/won't talk/);
        expect(r.flag(TROGLO_STAGE)).toBe(3);
      }
      const q = new QuestRunner(scen);
      q.party.specItems.add(PASS);
      q.setFlag(KNIGHT, 2);
      // Zone 58's checkpoint (spot 2): the pass lets the party by without a fight.
      await q.outdoors(4, 6, 37, 10);
      await q.step(37, 9);
      expect(q.session.mode, q.tail()).toBe(GameMode.OUTDOORS);
      expect(q.party.outC.some((g) => g.exists), q.tail()).toBe(false);

      // The gates (spot 2): blindfolded, to the cell, its door locked.
      const CELL = { x: 0x36, y: 0x30 }, DOOR = { x: 0x38, y: 0x30 };
      const door = () => q.town.record.terrain[DOOR.x]![DOOR.y];
      await q.enter(28);
      await q.step(...spot(28, 2));
      expect(q.flag(TROGLO_STAGE), q.tail()).toBe(1);
      expect(q.at).toEqual(CELL);
      expect(door()).toBe(0x6a);
      // 25 turns later the door opens.
      await q.pause(25);
      expect(door(), q.tail()).toBe(0x67);
      expect(q.flag(TROGLO_STAGE)).toBe(2);
      // Wandering off: marched back with a note, and locked in again.
      const [px, py] = spot(28, 5);
      expect(q.canReach(CELL, { x: px, y: py })).toBe(true);
      await q.step(px, py);
      expect(q.at, q.tail()).toEqual(CELL);
      expect(door()).toBe(0x6a);
      expect(q.hasItem(/paper/i), q.tail()).toBe(true);
      await q.pause(25);
      expect(door(), q.tail()).toBe(0x67);
      expect(q.flag(TROGLO_STAGE)).toBe(3);

      // Vothkaro asks whether the party read the scroll (checked above);
      // yes, and he asks the party to deal with Elhioc.
      await q.talk(/Vothkaro/, 'here');
      expect(q.flag(TROGLO_STAGE), q.tail()).toBe(5);

      // Back at the cell: his letter on the table, and the secret door down.
      const [sx, sy] = spot(28, 12);
      expect(q.canReach(CELL, { x: sx, y: sy }), 'stairs before').toBe(false);
      await q.step(px, py);
      expect(q.town.record.terrain[0x34]![0x33], q.tail()).toBe(0x65);
      expect(q.canReach(CELL, { x: sx, y: sy }), 'stairs after').toBe(true);
      await q.step(sx, sy);
      expect(q.townNum, q.tail()).toBe(29);

      // The combination gate (spot 14): dials 5, 4, 3, 2, 0, 2 open the way to Elhioc.
      const elhioc = q.creatures(/Elhioc/)[0]!;
      const [gx, gy] = spot(29, 14);
      expect(q.canReach({ x: gx, y: gy }, elhioc.curLoc), 'shut').toBe(false);
      q.number(...[1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 6, 6, 0]);
      await q.step(gx, gy);
      expect(q.canReach({ x: gx, y: gy }, elhioc.curLoc), `open\n${q.tail()}`).toBe(true);
      await q.kill(/Elhioc/);
      expect(q.flag(TROGLO_STAGE), q.tail()).toBe(6);
      // His spellbook (spot 11): Wall of Blades and Major Cleansing, for a
      // party with enough Mage Lore between them.
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 5;
      // Through the false wall at (6,7).
      q.place({ x: 6, y: 8 });
      await q.walk(6, 7);
      await q.step(...spot(29, 11));
      expect(q.party.pcs.some((pc) => pc.priestSpells[0x9f - 100] && pc.priestSpells[0xa1 - 100]), q.tail()).toBe(true);

      // Up the stairs (spot 18): Vothkaro's scroll for the mayor.
      await q.step(...spot(29, 18));
      expect(q.townNum, q.tail()).toBe(28);
      expect(q.flag(TROGLO_STAGE)).toBe(7);
      expect(q.hasSpecItem(SCROLL)).toBe(true);
      expect(q.hasSpecItem(PASS)).toBe(false);

      // Knight takes it, and his library's rune door lets the party at the tome.
      await q.enter(8);
      const [lx, ly] = spot(8, 16);
      await q.step(lx, ly);
      expect(q.at, 'the door refuses').not.toEqual({ x: lx, y: ly });
      await q.talk(/Mayor Knight/, 'miss');
      expect(q.flag(KNIGHT), q.tail()).toBe(3);
      expect(q.hasSpecItem(SCROLL)).toBe(false);
      await q.step(lx, ly);
      expect(q.town.record.terrain[0x34]![0x33], q.tail()).toBe(0x67);
      await q.walk(0x34, 0x33);
      expect(q.at, q.tail()).toEqual({ x: 0x34, y: 0x33 });
      await q.walk(...spot(8, 17));
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x29]), q.tail()).toBe(true);
    });

    it("Lorelei's commander, the giants' gap, the caves' prisoners and trophies, and the lower caves' runes", async () => {
      const q = new QuestRunner(scen);
      const MISSIONS = [0xc3b, 0xc2f, 0xc30, 0xc31];
      // Commander Bruskrud asks for help against the giants (0x122).
      await q.enter(12);
      await q.talk(/Bruskrud/, 'miss');
      expect(q.flag(0x122), q.tail()).toBe(1);

      // Zone 49's gap (spot 3): the giants block the road.
      await q.outdoors(4, 5, 38, 29);
      q.answer('Attack');
      await q.step(37, 29);
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      expect(q.session.mode).toBe(GameMode.OUTDOORS);

      // The upper caves (town 30): a dead soldier's four boxes, the trophies.
      await q.enter(30);
      await q.clearHostiles();
      const trophies = [45, 46, 47, 48];
      // A box is searched by looking at it from beside it.
      for (const id of [23, 24, 25, 26]) await q.look(...spot(30, id));
      expect(trophies.every((k) => q.hasSpecItem(k)), q.tail()).toBe(true);
      // The prisoners won't go until the party has found the way out (spot 21).
      const [before] = await q.talk(/Prisoner/, 'esca');
      expect(MISSIONS.every((m) => q.flag(m) === 0), before).toBe(true);
      await q.step(...spot(30, 21));
      expect(q.flag(0x1b0), q.tail()).toBe(1);
      // All four, both kinds (a node of the male prisoner's answers for the female one too).
      expect(new Set(q.creatures(/Prisoner/).map((m) => m.personality)).size).toBe(2);
      for (let i = 0; i < 4; i++) {
        const [freed] = await q.talk(/Prisoner/, 'esca');
        expect(q.flag(MISSIONS[i]!), `prisoner ${i}: ${freed}`).toBe(1);
      }
      expect(q.creatures(/Prisoner/).length).toBe(0);

      // Bruskrud pays 300 a trophy and 500 a rescue, one of each each time.
      await q.enter(12);
      const gold = q.party.gold;
      for (let i = 0; i < 4; i++) await q.talk(/Bruskrud/, 'miss');
      expect(q.party.gold - gold, q.tail()).toBe(4 * 800);
      expect(trophies.some((k) => q.hasSpecItem(k))).toBe(false);
      expect(MISSIONS.every((m) => q.flag(m) === 2)).toBe(true);

      // Down to the lower caves (spot 14 of the upper).
      await q.enter(30);
      await q.step(...spot(30, 14));
      expect(q.townNum, q.tail()).toBe(31);
      // The padlocked door (spot 22) wants the giant's key, from the box at spot 1.
      const [dx, dy] = spot(31, 22);
      await q.step(dx, dy);
      expect(q.town.record.terrain[0x2f]![0x17], q.tail()).toBe(0x8a);
      await q.look(4, 34);
      expect(q.hasSpecItem(partySpecItem(0x2e)), q.tail()).toBe(true);
      await q.step(dx, dy);
      expect(q.town.record.terrain[0x2f]![0x17], q.tail()).toBe(0x87);
      // The runes (spot 23): walkthrough A's two bottom-left buttons and then
      // the two on the right light all seven; the door at (54,23) opens, and
      // the Concealed Tunnel (town 54) goes on the map.
      expect(scen.towns[54]!.canFind).toBe(false);
      q.number(1, 2, 5, 6, 0);
      await q.step(...spot(31, 23));
      expect(q.town.record.terrain[0x36]![0x17], q.tail()).toBe(0x8d);
      expect(scen.towns[54]!.canFind, q.tail()).toBe(true);
    });

    it('The Concealed Tunnel: five barrels gone lift the barrier at its door', async () => {
      const q = new QuestRunner(scen);
      await q.enter(54);
      const entry = { ...q.at };
      const barrels = () => {
        const out: [number, number][] = [];
        for (let x = 0; x < 48; x++) for (let y = 0; y < 48; y++) if (q.town.hasField(x, y, FieldType.OBJECT_BARREL)) out.push([x, y]);
        return out;
      };
      expect(barrels().length).toBe(5);
      // The invisible barrier (spot 2) before the door at (24,42).
      const [bx, by] = spot(54, 2);
      expect(q.canReach(entry, { x: bx, y: by })).toBe(true);
      await q.step(bx, by);
      expect(q.at, q.tail()).not.toEqual({ x: bx, y: by });

      // One barrel, pushed for real: walled in at (26,39), it trades places
      // with the party (the 1997 `push_loc` gives back the pusher's square),
      // then goes south into the pit at (27,43).
      q.place({ x: 27, y: 39 });
      for (const [x, y] of [[26, 39], [27, 40], [27, 39], [27, 40], [27, 41], [27, 42]] as const) await q.walk(x, y);
      expect(q.town.hasField(26, 39, FieldType.OBJECT_BARREL) || q.town.hasField(27, 42, FieldType.OBJECT_BARREL), q.tail()).toBe(false);
      expect(barrels().length, JSON.stringify(barrels())).toBe(4);
      // The rest, as if pushed the same way: with any one left, the barrier holds.
      for (const [x, y] of barrels().slice(1)) q.town.setField(x, y, FieldType.OBJECT_BARREL, false);
      await q.step(bx, by);
      expect(q.at, q.tail()).not.toEqual({ x: bx, y: by });
      for (const [x, y] of barrels()) q.town.setField(x, y, FieldType.OBJECT_BARREL, false);
      await q.step(bx, by);
      expect(q.at, q.tail()).toEqual({ x: bx, y: by });
      await q.walk(24, 42);
      expect(q.at, q.tail()).toEqual({ x: 24, y: 42 });
    });

    it('The Concealed Tunnel: its walls move, carry and crush, and the party can time its way to both levers and the stairs', async () => {
      // The walls: a north wall with two squares of open floor ahead carries
      // a party standing just in front of it one square on; with a wall
      // two ahead instead, the same wall crushes it.
      for (const blocked of [false, true]) {
        const r = new QuestRunner(scen);
        await r.enter(54, { x: 24, y: 42 });
        await r.clearHostiles();
        // Spirits rising where a wall stands hold it for a turn (E3 asks for a
        // creature on the wall's own square), so none rise here.
        r.setFlag(0x2a1, 20);
        const ter = (x: number, y: number) => r.town.record.terrain[x]?.[y];
        const open = (x: number, y: number) => ter(x, y) === WALL_FLOOR && r.town.fields[x]![y]!.size === 0;
        let front: { x: number; y: number } | undefined;
        for (let x = 1; x < 48 && !front; x++) {
          for (let y = 3; y < 48 && !front; y++) if (ter(x, y) === WALL_NORTH && open(x, y - 1) && open(x, y - 2)) front = { x, y: y - 1 };
        }
        expect(front).toBeDefined();
        const { x, y } = front!;
        if (blocked) r.town.record.terrain[x]![y - 1] = 100;
        r.place(front!);
        await r.pause(1);
        if (blocked) {
          expect(r.party.pcs.some((pc) => pc.isAlive), r.univ.transcript.slice(-3).join(' / ')).toBe(false);
          expect(r.log.some((l) => /raspberry jam/.test(l)), r.tail()).toBe(true);
        } else {
          expect(r.at, r.univ.transcript.slice(-3).join(' / ')).toEqual({ x, y: y - 1 });
          expect(r.party.pcs.every((pc) => pc.isAlive)).toBe(true);
          expect(r.univ.transcript).toContain('You get pushed.');
        }
      }
      // The search's model of the walls against the engine's: 60 turns, nobody pushing.
      {
        const r = new QuestRunner(scen);
        await r.enter(54, { x: 24, y: 42 });
        const model = new WallSearch(r);
        let walls = model.start.walls;
        for (let t = 0; t < 60; t++) {
          walls = model.stepWalls(walls, new Set(model.start.crates));
          moveE3Walls(r.session);
          expect(wallsOf(r).join(), `turn ${t}`).toBe(walls.join());
        }
      }
      // A search over the party's steps, waits and crate pushes, with the
      // walls as E3 moves them (its model checked against the engine below),
      // from the door (24,42): the red portal (spot 11) to the north caverns,
      // lever 18 at (11,27) for the portcullises at x = 10, the room with
      // the crates (pushing only the four in its northeast corner), lever 19
      // at (21,4) for those at x = 7, and the stairs down (spot 15).
      const q = new QuestRunner(scen);
      await q.enter(54, { x: 24, y: 42 });
      await q.clearHostiles();
      // The model leaves out creatures, so the spirits (spot 1) stay away,
      // and doors and false walls start open (each costs a real party a turn).
      q.setFlag(0x2a1, 20);
      for (let x = 0; x < 48; x++) {
        for (let y = 0; y < 48; y++) {
          const info = q.univ.terrainType(q.town.record.terrain[x]![y]!);
          if (info.special === TerSpec.CHANGE_WHEN_STEP_ON && info.flag1 >= 0) q.town.record.terrain[x]![y] = info.flag1;
        }
      }
      const c = WallSearch.cellOf;
      const levers = [
        { at: spot(54, 18), opens: [[10, 18], [10, 19]] as [number, number][] },
        { at: spot(54, 19), opens: [[7, 18], [7, 19]] as [number, number][] },
      ];
      const ws = new WallSearch(q, levers, new Map([[c(...spot(54, 11)), c(40, 6)], [c(...spot(54, 12)), c(5, 43)]]));
      const inRoom = (st: WallState) => { const p = WallSearch.at(st); return p.x >= 11 && p.x <= 18 && p.y >= 8 && p.y <= 9; };
      const [sx, sy] = spot(54, 15);
      ws.pushable = () => false;
      const legs = [
        ws.search(ws.start, (st) => st.party === c(40, 6), 200),
      ];
      legs.push(ws.search(legs[0]!.state, (st) => (st.levers & 1) === 1, 200));
      legs.push(ws.search(legs[1]!.state, inRoom, 200));
      ws.pushable = (x, y) => x >= 17 && x <= 18 && y >= 4 && y <= 9;
      legs.push(ws.search(legs[2]!.state, (st) => (st.levers & 3) === 3, 200, 1_000_000));
      ws.pushable = () => false;
      legs.push(ws.search(legs[3]!.state, (st) => st.party === c(sx, sy), 200, 1_000_000));
      expect(legs.every(Boolean), `legs ${legs.map((l) => l?.moves.length).join(', ')}`).toBe(true);

      // The same moves through the engine: the party where the model says,
      // and the walls too, every turn, until the stairs take it down.
      // (Only the lever room's crates were ever pushed.)
      ws.pushable = (x, y) => x >= 17 && x <= 18 && y >= 4 && y <= 9;
      let st = ws.start;
      const moves = legs.flatMap((l) => l!.moves);
      for (const [i, [dx, dy]] of moves.entries()) {
        st = ws.after(st, dx, dy)!;
        const from = { ...q.at };
        if (dx === 0 && dy === 0) await q.pause(1); else await q.walk(from.x + dx, from.y + dy);
        if (q.townNum !== 54) { expect(i, 'left early').toBe(moves.length - 1); break; }
        expect(q.at, `move ${i} (${dx},${dy}) from ${JSON.stringify(from)}\n${q.tail(3)}`).toEqual(WallSearch.at(st));
        expect(wallsOf(q).join(), `walls after move ${i}`).toBe(st.walls.join());
      }
      expect(q.townNum, q.tail()).toBe(103);
    });

    it("The Barrier Cavern: the crystal smashed, the war begun again, the shards, and the ways out", async () => {
      const q = new QuestRunner(scen);
      await q.enter(103, { x: 26, y: 17 });
      await q.clearHostiles();
      const has255 = () => q.town.record.terrain.some((col) => col.some((t) => t === 255 || t === 256));
      expect(has255(), 'the barriers').toBe(true);
      const [cx, cy] = spot(103, 1);
      // The crystal's pages: what it is, then whether to smash it.
      q.answer('OK', /Smash|Yes|Break|Destroy/);
      await q.step(cx, cy);
      expect(q.flag(0xc8a), q.tail()).toBe(1);
      expect(has255(), 'the barriers down').toBe(false);
      expect(q.party.keyTimes.has(e3Event(2)), 'event 2').toBe(true);
      // Five spots in the two peoples' towns are spent.
      for (const f of [0x1bd, 0x1a1, 0x19f, 0x19e, 0x1ab]) expect(q.flag(f), f.toString(16)).toBe(20);
      // Both sides come for the party.
      expect(q.town.monsters.some((m) => m.isAlive && !m.isFriendly), q.tail()).toBe(true);
      await q.clearHostiles();
      // Afterwards, a few shards of the crystal for the fort, once.
      const SHARDS = partySpecItem(0x44);
      await q.step(cx, cy + 2);
      await q.step(cx, cy);
      expect(q.hasSpecItem(SHARDS), q.tail()).toBe(true);
      q.party.specItems.delete(SHARDS);
      await q.step(cx, cy + 2);
      await q.step(cx, cy);
      expect(q.hasSpecItem(SHARDS)).toBe(false);

      // The barriers are gone from the troglodytes' caves and the giants' too.
      for (const t of [29, 31]) {
        await q.enter(t);
        expect(has255(), `town ${t}`).toBe(false);
      }
      // Three ways out: to the giants' lower caves, the troglodytes' caves,
      // and back up the Concealed Tunnel, whose far end clears its barrels
      // and opens its portcullises for the way home.
      for (const [id, town] of [[11, 31], [12, 29], [14, 54]] as const) {
        await q.enter(103, { x: 26, y: 17 });
        await q.step(...spot(103, id));
        expect(q.townNum, `spot ${id}\n${q.tail()}`).toBe(town);
      }
      await q.step(...spot(54, 14));
      expect(q.town.record.terrain[7]![18]).toBe(0x6d);
      expect(q.town.record.terrain[10]![19]).toBe(0x6d);
      expect(q.town.fields.some((col) => col.some((f) => f.has(FieldType.OBJECT_BARREL)))).toBe(false);
    });

    it('The giants and troglodytes reported and rewarded: Knight, Anaximander, Berra, Levy and X', async () => {
      const q = new QuestRunner(scen);
      q.setFlag(0xc8a, 1);
      q.party.specItems.add(partySpecItem(0x44));
      // Mayor Knight, whose papers went unused: the war settles his mission too.
      q.setFlag(KNIGHT, 2);
      q.party.specItems.add(PASS);
      await q.enter(8);
      await q.talk(/Mayor Knight/, 'miss');
      expect(q.flag(KNIGHT), q.tail()).toBe(3);
      expect(q.hasSpecItem(PASS)).toBe(false);
      // Anaximander hears it (0xc8a to 2).
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.flag(0xc8a), q.tail()).toBe(2);
      // Berra takes the shards as evidence.
      await q.talk(/Berra/, 'evid');
      expect(q.hasSpecItem(partySpecItem(0x44)), q.tail()).toBe(false);
      expect(q.flag(0xc9e)).toBe(1);
      // Levy's reward, once.
      const items = () => q.party.pcs.reduce((n, pc) => n + pc.items.filter((it) => it.variety !== 0).length, 0);
      const before = items();
      const [reward] = await q.talk(/Levy/, 'rewa');
      expect(q.flag(0xc8a), reward).toBe(3);
      expect(items(), reward).toBe(before + 1);
      // 'X', in the Tower of Magi, teaches two mage spells for it.
      await q.enter(24, { x: 10, y: 10 });
      await q.talk(31, 'earn');
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x32] && pc.mageSpells[0x34]), q.tail()).toBe(true);
    });

    it("The Giant's Forge: the passage from the lower caves, Smite on its pedestal, and what it does to giants", async () => {
      const q = new QuestRunner(scen);
      // The long passage from the lower caves (spot 11) comes out at (42,44).
      await q.enter(31);
      await q.step(...spot(31, 11));
      expect(q.townNum, q.tail()).toBe(55);
      const entry = { ...q.at };
      // The hammer lies at (23,43), across the lava (the walkthroughs cast
      // Firewalk), past the message by its alcove (spot 2).
      const smite = q.town.items.find((it) => it.variety !== 0 && it.fullName === 'Smite')!;
      expect(smite.itemLoc).toEqual({ x: 23, y: 43 });
      expect(q.canReach(entry, smite.itemLoc), 'from the passage').toBe(true);
      expect(q.canReach({ x: 37, y: 5 }, smite.itemLoc), 'from the main gate').toBe(true);
      // Its guardians, and two of the Forge's others for later.
      expect(q.creatures(/Black Shade/).length).toBeGreaterThan(0);
      const giant = q.creatures(/Hill Giant Chief/)[0]!;
      const ogre = q.creatures(/^Ogre$/)[0]!;
      await q.clearHostiles();
      q.place({ x: 22, y: 43 });
      const onFloor = q.session.reachableItems(q.at).items;
      expect(onFloor, 'within reach').toContain(smite);
      q.session.takeItem(smite, 0);
      expect(q.hasItem(/^Smite$|Hammer/), q.tail()).toBe(true);
      const hammer = q.party.pcs[0]!.items.find((it) => it.fullName === 'Smite')!;
      expect(hammer.e3Ability).toBe(E3Abil.GIANT_BANE);
      // Against giants it adds 20–31 a blow (`calc_spec_dam`), and nothing against anything else.
      for (let i = 0; i < 20; i++) {
        const extra = e3SpecDam(q.univ, hammer.e3Ability, giant);
        expect(extra).toBeGreaterThanOrEqual(20);
        expect(extra).toBeLessThanOrEqual(31);
      }
      expect(e3SpecDam(q.univ, hammer.e3Ability, ogre)).toBe(0);
      // And back to the caves the way the party came (spot 15).
      await q.step(...spot(55, 15));
      expect(q.townNum, q.tail()).toBe(31);
    });
  });

  describe('the golems', () => {
    /** The special items the chain turns on. */
    const ORB = 6, AMULET = 7, WAND = 8;
    const LATE_WAR = 0xc92;
    /** Look at a blocked square, step on an open one: how a spot is set off. */
    const touch = async (q: QuestRunner, x: number, y: number): Promise<void> => {
      if (q.session.townIsBlocked({ x, y })) await q.look(x, y);
      else await q.step(x, y);
    };
    const said = (q: QuestRunner, from: number): string[] => q.univ.transcript.slice(from);
    /** An open square beside (x, y), to cast at it from. */
    const beside = (q: QuestRunner, x: number, y: number): { x: number; y: number } => {
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const p = { x: x + dx, y: y + dy };
        if (q.town.isOnMap(p.x, p.y) && !q.session.townIsBlocked(p)) return p;
      }
      throw new Error(`nowhere beside (${x},${y})`);
    };

    it("The Orb of Thralni: stolen, the portal to deep Exile, the Cult's key, clean hands, the vault, and the way home", async () => {
      const q = new QuestRunner(scen);
      // The plot clock sets 0xc92 (past day 109, or at war with the
      // troglodytes); Anaximander then tells of the theft.
      q.setFlag(LATE_WAR, 1);
      await q.enter(21);
      await q.step(...spot(21, 1));
      expect(q.flag(LATE_WAR), q.tail()).toBe(2);

      // The Portal Fortress's portal (spot 2) goes somewhere else without the orb.
      await q.enter(40);
      await q.step(...spot(40, 2));
      expect(q.townNum, q.tail()).toBe(134);

      // The Cult of the Sacred Item (town 49).
      await q.enter(49);
      await q.clearHostiles();
      const MARBLE_KEY = 12;
      // The padlocked doors refuse without the marble key.
      const [lx, ly] = spot(49, 20);
      await q.step(lx, ly);
      expect(q.town.record.terrain[lx + 1]![ly], q.tail()).toBe(106);
      // The key, in the chest at (34,39) (spot 9).
      await touch(q, 34, 39);
      expect(q.hasSpecItem(MARBLE_KEY), q.tail()).toBe(true);
      await q.step(lx, ly);
      expect(q.town.record.terrain[lx + 1]![ly], q.tail()).toBe(0x67);

      // The Purification Walk: an unwashed party is burned at each ward;
      // touching the fountain before it lets the party by.
      const hurt = (): number => q.party.pcs.reduce((n, pc) => n + pc.curHealth, 0);
      const [wx, wy] = spot(49, 14);
      let before = hurt();
      await q.step(wx, wy);
      expect(hurt(), q.tail()).toBeLessThan(before);
      for (const [fountain, ward] of [[1, 14], [2, 15], [3, 16]] as const) {
        q.answer(/Touch/);
        await touch(q, ...spot(49, fountain));
        expect(q.flag(0x26d + fountain), q.tail()).toBe(1);
        before = hurt();
        await q.step(...spot(49, ward));
        expect(hurt(), q.tail()).toBe(before);
      }

      // The vault: the Orb (spot 5), the Wand of Unusual Results (7), and a uranium bar (6).
      for (const id of [5, 6, 7]) await touch(q, ...spot(49, id));
      expect(q.hasSpecItem(ORB), q.tail()).toBe(true);
      expect(q.hasSpecItem(WAND), q.tail()).toBe(true);
      // Only once.
      q.party.specItems.delete(ORB);
      await touch(q, ...spot(49, 5));
      expect(q.hasSpecItem(ORB), q.tail()).toBe(false);
      q.party.specItems.add(ORB);

      // The cultists' portal (spot 12) is dead; the device (22) re-energises it.
      await q.clearHostiles();
      await q.step(...spot(49, 12));
      expect(q.townNum).toBe(49);
      await q.clearHostiles();
      await q.step(...spot(49, 22));
      await q.step(...spot(49, 12));
      expect(q.flag(LATE_WAR), q.tail()).toBe(3);
      expect(q.townNum, q.tail()).not.toBe(49);

      // Anaximander is glad, once.
      await q.enter(21);
      await q.step(...spot(21, 1));
      expect(q.flag(LATE_WAR), q.tail()).toBe(4);
    });

    it('The Orb flies: over the mountains to the Remote Aerie, down to land, and not over the high peaks', async () => {
      const q = new QuestRunner(scen);
      q.party.specItems.add(ORB);
      // Only outdoors.
      await q.enter(16);
      let from = q.univ.transcript.length;
      await q.useSpecItem(ORB);
      expect(said(q, from)).toEqual(['Use orb: Only when outdoors.']);

      // Walkthrough B's square below the aerie's peaks, (315,106): east is mountain.
      await q.outdoorsAt(315, 106);
      expect(await q.go(Direction.E)).toEqual([false]);
      from = q.univ.transcript.length;
      await q.useSpecItem(ORB);
      expect(said(q, from)).toEqual(['Use: You rub the orb and start flying!']);
      expect(q.party.partyStatus[PartyStatus.FLIGHT]).toBe(6);
      from = q.univ.transcript.length;
      await q.useSpecItem(ORB);
      expect(said(q, from)).toEqual(['Use: Not while already flying.']);
      // Over two peaks to the hidden clearing at (318,106).
      expect(await q.go(Direction.E, Direction.E, Direction.E)).toEqual([true, true, true]);
      expect(q.global).toEqual({ x: 318, y: 106 });
      // The aerie (318,107) waits for the party to land.
      from = q.univ.transcript.length;
      expect(await q.go(Direction.S)).toEqual([false]);
      expect(said(q, from)).toContain('Moved: You have to land first.');
      // Six turns aloft: three spent flying, three more to come down.
      await q.pause(3);
      expect(q.party.partyStatus[PartyStatus.FLIGHT], q.univ.transcript.slice(-4).join(' / ')).toBe(0);
      expect(q.univ.transcript).toContain('  You land safely.');
      expect(q.party.pcs.every((pc) => pc.isAlive)).toBe(true);
      await q.go(Direction.S);
      expect(q.townNum, q.tail()).toBe(106);

      // The high peaks (terrain 0x17) stop a flight: the drake's, walkthrough A's T2's.
      await q.outdoorsAt(268, 139);
      q.party.partyStatus[PartyStatus.FLIGHT] = 6;
      expect(await q.go(Direction.W, Direction.S, Direction.SW)).toEqual([false, true, true]);
      expect(q.global).toEqual({ x: 267, y: 141 });
    });

    it("The Orb's landings and refusals: mountains, water and lava, the ocean's edge, the caves' ceilings", async () => {
      const q = new QuestRunner(scen);
      /** Come down on (gx, gy): two turns left in the air, and wait them out. */
      const land = async (gx: number, gy: number): Promise<string[]> => {
        for (const pc of q.party.pcs) { pc.mainStatus = MainStatus.ALIVE; pc.curHealth = pc.maxHealth; }
        await q.outdoorsAt(gx, gy);
        q.party.partyStatus[PartyStatus.FLIGHT] = 2;
        const from = q.univ.transcript.length;
        await q.pause(2);
        return said(q, from).filter((l) => l.startsWith('  '));
      };
      /** A square of the whole map whose terrain passes `test`, searching the given box. */
      const find = (test: (t: number) => boolean, x0: number, x1: number, y0: number, y1: number): [number, number] => {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const t = scen.outdoors[Math.floor(x / 48)]![Math.floor(y / 48)]!.terrain[x % 48]![y % 48]!;
            if (test(t)) return [x, y];
          }
        }
        throw new Error('none');
      };
      expect(await land(317, 106)).toEqual(['  You plummet to your deaths.']);
      expect(q.party.pcs.some((pc) => pc.isAlive)).toBe(false);
      expect(await land(324, 101)).toEqual(['  You fall into the water and', '  rapidly drown.']);
      expect(q.party.pcs.some((pc) => pc.isAlive)).toBe(false);
      const lava = find((t) => t === 0x4b, 0, 335, 0, 479);
      const hp = () => q.party.pcs.reduce((n, pc) => n + pc.curHealth, 0);
      expect(await land(...lava)).toContain('  You land in lava!');
      expect(hp()).toBeLessThan(q.party.pcs.reduce((n, pc) => n + pc.maxHealth, 0));
      expect(await land(315, 106)).toEqual(['  You land safely.']);

      // The ocean past the surface's east edge (east of x 324).
      for (const pc of q.party.pcs) { pc.mainStatus = MainStatus.ALIVE; pc.curHealth = pc.maxHealth; }
      const terAt = (x: number, y: number): number => scen.outdoors[Math.floor(x / 48)]![Math.floor(y / 48)]!.terrain[x % 48]![y % 48]!;
      const flyable = (x: number, y: number): boolean => scen.terTypes[terAt(x, y)]!.flyOver || scen.terTypes[terAt(x, y)]!.blockage === 0;
      const water = (x: number, y: number): boolean => terAt(x, y) >= 0x32 && terAt(x, y) <= 0x40;
      const oy = [...Array(470).keys()].find((y) => y > 10 && water(323, y) && water(324, y) && water(325, y))!;
      await q.outdoorsAt(323, oy);
      q.party.partyStatus[PartyStatus.FLIGHT] = 6;
      expect(await q.go(Direction.E)).toEqual([true]);
      let from = q.univ.transcript.length;
      expect(await q.go(Direction.E)).toEqual([false]);
      expect(said(q, from)).toEqual(['Fly: Not over the ocean!']);
      // The caves' west edge (x under 341), and fine a step inside it.
      const cy = [...Array(480).keys()].find((y) => [340, 341, 342].every((x) => flyable(x, y)))!;
      await q.outdoorsAt(342, cy);
      q.party.partyStatus[PartyStatus.FLIGHT] = 6;
      expect(await q.go(Direction.W)).toEqual([true]);
      from = q.univ.transcript.length;
      expect(await q.go(Direction.W)).toEqual([false]);
      expect(said(q, from)).toEqual(['Fly: Ceiling too low.']);

      // The orb fails in the far north, zone columns 1 and 2 of the top row.
      q.party.specItems.add(ORB);
      q.party.partyStatus[PartyStatus.FLIGHT] = 0;
      await q.outdoorsAt(70, 20);
      from = q.univ.transcript.length;
      await q.useSpecItem(ORB);
      expect(said(q, from)).toEqual(['Use orb: For some reason, it fails.']);
    });

    it('The Amulet of Rapid Returning: to Fort Emergence from the surface, and where it will not work', async () => {
      const q = new QuestRunner(scen);
      q.party.specItems.add(AMULET);
      const FORT_SIDE: [number, number] = [291, 33];
      q.party.setSdf(...FORT_SIDE, 1);
      const use = async (): Promise<string[]> => {
        const from = q.univ.transcript.length;
        await q.useSpecItem(AMULET);
        return said(q, from);
      };
      // In the far north, too far; in the caves, not on the surface; in town, no.
      await q.outdoorsAt(200, 60);
      expect(await use()).toEqual(["Amulet doesn't work.", "  You're too far from Fort Emergence."]);
      await q.outdoorsAt(342, 400);
      expect(await use()).toEqual(["Amulet doesn't work.", '  You need to be on the surface.']);
      await q.outdoorsAt(310, 156);
      await q.enter(16);
      expect(await use()).toEqual(['  Can only cast outdoors.']);
      // Outside Gale: to the fort, by its caves-side door.
      await q.outdoorsAt(310, 156);
      expect(await use()).toContain('  You are moved...');
      expect(q.townNum, q.tail()).toBe(21);
      expect(q.global).toEqual({ x: 420, y: 468 });
      expect(q.party.getSdf(...FORT_SIDE)).toBe(0);
    });

    it('The Wand of Unusual Results: something odd, 120 times, and then nothing', async () => {
      const q = new QuestRunner(scen);
      q.party.specItems.add(WAND);
      await q.outdoorsAt(310, 156);
      const odd = /rash|swell|dumber|energetic|fish|hungry|lilacs|romantic|fingernails|Grass|iron|cash/;
      let from = q.univ.transcript.length;
      await q.useSpecItem(WAND);
      expect(said(q, from)[0]).toBe('You wave the wand.');
      expect(said(q, from).some((l) => odd.test(l)), said(q, from).join(' / ')).toBe(true);
      expect(q.flag(0x457)).toBe(1);
      q.setFlag(0x457, 121);
      from = q.univ.transcript.length;
      await q.useSpecItem(WAND);
      expect(said(q, from)).toEqual(['You wave the wand.', 'Nothing happens.']);
    });

    it("Zalifar and the drake: surrender the food and swear, or fight; then the spire's place", async () => {
      // Zalifar names the spire's place to anyone who asks (a question for the original, E3-CHECK-IN-ORIGINAL.md #12).
      {
        const r = new QuestRunner(scen);
        await r.enter(106);
        const [spire] = await r.talk(/Zalifar/, 'spire');
        expect(spire).toMatch(/northwest of Tevrono/);
        expect(scen.towns[32]!.canFind).toBe(true);
      }
      // Dalakros fought and killed.
      {
        const r = new QuestRunner(scen);
        await r.enter(107);
        r.answer(/No|Leave|Refuse/);
        await r.step(...spot(107, 3));
        expect(r.creatures(/Dalakros|Drake/).some((m) => !m.isFriendly), r.tail()).toBe(true);
        await r.kill(/Dalakros|Drake/);
        await r.enter(106);
        const [assist] = await r.talk(/Zalifar/, 'assistance');
        expect(assist, r.tail()).toMatch(/encounter with Dalakros/);
      }
      const q = new QuestRunner(scen);
      await q.enter(106);
      const [drake, recently] = await q.talk(/Zalifar/, 'drake', 'recently');
      expect(drake).toMatch(/southwest of Greendale/);
      expect(recently).toMatch(/ensure it will never attack/);
      // Not yet.
      const [before] = await q.talk(/Zalifar/, 'assistance');
      expect(before).toMatch(/assist me in dealing with a drake/);

      // The Drake Aerie: all the food, and Dalakros talks.
      q.party.food = 200;
      await q.enter(107);
      await q.step(...spot(107, 3));
      expect(q.party.food, q.tail()).toBe(0);
      expect(q.creatures(/Dalakros|Drake/).every((m) => m.isFriendly)).toBe(true);
      const [agree] = await q.talk(/Dalakros/, 'agree');
      expect(agree, q.tail()).toMatch(/I will not attack humans/);

      // Zalifar tells of the spire, and puts the Tower of Shifting Floors on the map.
      await q.enter(106);
      expect(scen.towns[32]!.canFind).toBe(false);
      const [assist, spire, circles] = await q.talk(/Zalifar/, 'assistance', 'spire', 'circles');
      expect(assist, q.tail()).toMatch(/encounter with Dalakros/);
      expect(spire, q.tail()).toMatch(/northwest of Tevrono/);
      expect(circles).toMatch(/four stone circles/);
      expect(scen.towns[32]!.canFind, q.tail()).toBe(true);
    });

    it("The road north: the bridge's soldiers, the golems' posts, a way round to Tevrono, and the woods before the tower", async () => {
      const q = new QuestRunner(scen);
      // The bridge north of Gale (zone 24's spot 4): help the soldiers, once.
      await q.outdoorsAt(305, 130);
      q.answer('Attack');
      await q.go(Direction.N);
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      let asked = q.log.length;
      await q.outdoorsAt(305, 130);
      await q.go(Direction.N);
      expect(q.log.slice(asked).some((l) => l.startsWith('[choice]')), q.tail()).toBe(false);
      expect(q.global).toEqual({ x: 305, y: 129 });
      // Turning away there is for good, and the bridge is open all the same.
      {
        const r = new QuestRunner(scen);
        await r.outdoorsAt(305, 130);
        r.answer('Leave');
        await r.go(Direction.N);
        asked = r.log.length;
        await r.outdoorsAt(305, 130);
        await r.go(Direction.N);
        expect(r.log.slice(asked).some((l) => l.startsWith('[choice]'))).toBe(false);
        expect(r.global).toEqual({ x: 305, y: 129 });
      }
      // The golems' three posts on the road (zone 24's spots 1–3) hold the
      // party off (`10a0:19ca`) until they are fought, which spends the spot;
      // the road's own square at (299,101) is one. Turned down, the road
      // stays shut, but there is a way round, from the bridge to Tevrono's gate.
      const posts = new Set(['292,100', '299,101', '306,102']);
      const terAt = (x: number, y: number): number => scen.outdoors[Math.floor(x / 48)]![Math.floor(y / 48)]!.terrain[x % 48]![y % 48]!;
      const walkable = (x: number, y: number): boolean => !posts.has(`${x},${y}`) && scen.terTypes[terAt(x, y)]!.blockage === 0;
      const outdoorPath = (from: [number, number], to: [number, number]): number => {
        const seen = new Map([[from.join(), 0]]);
        const queue = [from];
        while (queue.length) {
          const [x, y] = queue.shift()!;
          const d = seen.get(`${x},${y}`)!;
          if (x === to[0] && y === to[1]) return d;
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const n: [number, number] = [x + dx, y + dy];
            if (seen.has(n.join()) || (n[0] !== to[0] || n[1] !== to[1]) && !walkable(...n)) continue;
            seen.set(n.join(), d + 1);
            queue.push(n);
          }
        }
        return -1;
      };
      expect(outdoorPath([305, 128], [300, 88]), 'to Tevrono').toBeGreaterThan(0);
      await q.outdoorsAt(299, 102);
      q.answer('Leave');
      await q.go(Direction.N);
      expect(q.global, q.tail()).toEqual({ x: 299, y: 102 });
      q.answer('Attack');
      await q.go(Direction.N);
      expect(q.global, q.tail()).toEqual({ x: 299, y: 102 });
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      await q.outdoorsAt(299, 102);
      await q.go(Direction.N);
      expect(q.global).toEqual({ x: 299, y: 101 });

      // The woods east of the tower (zone 14's spots 3 and 2): a Woodsman
      // sneaks by, and nobody else does without a fight.
      {
        const r = new QuestRunner(scen);
        for (const pc of r.party.pcs) pc.traits.fill(false);
        await r.outdoorsAt(286, 58);
        r.answer(/Sneak|Yes/);
        await r.go(Direction.W);
        expect(r.session.mode === GameMode.COMBAT || r.party.outC.some((g) => g.exists), r.tail()).toBe(true);
      }
      q.party.pcs[0]!.traits[Trait.WOODSMAN] = true;
      await q.outdoorsAt(286, 58);
      q.answer(/Sneak|Yes/);
      await q.go(Direction.W);
      expect(q.party.outC.some((g) => g.exists), q.tail()).toBe(false);
    });

    it('The four spires: each a ring of force barriers, a Power Crystal inside, and its flag for the tower', async () => {
      const q = new QuestRunner(scen);
      q.party.pcs[0]!.level = 30;
      for (const [k, town] of [167, 168, 169, 170].entries()) {
        await q.enter(town);
        const crystal = q.creatures(/Crystal/)[0]!;
        expect(crystal, `the crystal in ${town}`).toBeDefined();
        const ring = (): number => {
          let n = 0;
          for (let x = 0; x < 48; x++) for (let y = 0; y < 48; y++) if (q.town.fields[x]![y]!.has(FieldType.BARRIER_FORCE)) n++;
          return n;
        };
        // E3's town record has room for 50 preset fields, and each spire's
        // ring would take 56: one diagonal of it is missing (47, E3-SUSPECTED-BUGS.md #20).
        expect(ring(), `${town}`).toBe(47);
        expect(q.canReach(q.party.townLoc, crystal.curLoc), `${town} open on one side`).toBe(true);
        // Dispel Barrier takes one down, as the walkthroughs do.
        const [bx, by] = [23, town === 167 ? 9 : 10];
        const barrier = [[bx, by], [bx, 37], [bx, 36]].find(([x, y]) => q.town.fields[x!]![y!]!.has(FieldType.BARRIER_FORCE))!;
        q.place({ x: barrier[0]!, y: barrier[1]! - 1 });
        for (let i = 0; i < 20 && q.town.fields[barrier[0]!]![barrier[1]!]!.has(FieldType.BARRIER_FORCE); i++) {
          await q.spell(Spell.DISPEL_BARRIER, barrier[0]!, barrier[1]!);
        }
        expect(ring(), q.univ.transcript.slice(-3).join(' / ')).toBe(46);
        // The crystal's death: its word, and the flag level 3's gate reads.
        const before = q.log.length;
        await q.kill(/Crystal/);
        expect(q.flag(0x713 + 10 * k), `${town}`).toBe(1);
        expect(q.log.slice(before).some((l) => /crystal/i.test(l)), q.tail()).toBe(true);
      }
    });

    it("The Tower of Shifting Floors, level 1: the stairs, and Dispel Barrier on its golem generators", async () => {
      const q = new QuestRunner(scen);
      await q.enter(32);
      const clangs = (): number => q.univ.transcript.filter((l) => /distant clang/.test(l)).length;
      // The generators at work: a golem every eighth turn or so.
      await q.clearHostiles();
      await q.pause(40);
      expect(clangs(), q.univ.transcript.slice(-5).join(' / ')).toBeGreaterThan(0);
      // Each one dispelled: its dialog, 6 experience each, its flag, and floor.
      // (The golems killed above levelled the party; 6 is felt at level 1.)
      for (const pc of q.party.pcs) { pc.level = 1; pc.experience = 0; pc.mainStatus = MainStatus.ALIVE; pc.curHealth = pc.maxHealth; }
      const xp = q.party.pcs[0]!.experience;
      for (const { x, y } of GENERATORS) {
        q.place(beside(q, x, y));
        await q.spell(Spell.DISPEL_BARRIER, x, y);
        expect(q.town.record.terrain[x]![y], `${x},${y}\n${q.tail(3)}`).toBe(0);
      }
      expect(q.party.pcs[0]!.experience).toBeGreaterThan(xp);
      expect(q.log.filter((l) => /ceases operation/.test(l)).length).toBe(GENERATORS.length);
      for (const g of GENERATORS) expect(q.party.getSdf(...g.flag)).toBe(1);
      // And no more golems.
      await q.clearHostiles();
      const heard = clangs();
      await q.pause(80);
      expect(clangs()).toBe(heard);
      // Dispel Barrier anywhere else in the tower: nothing to dispel.
      q.place({ x: 20, y: 20 });
      await q.spell(Spell.DISPEL_BARRIER, 21, 20);
      expect(q.log.filter((l) => /ceases operation/.test(l)).length).toBe(GENERATORS.length);
      // Coming back, they stay broken (the entry case).
      await q.enter(32);
      for (const { x, y } of GENERATORS) expect(q.town.record.terrain[x]![y]).toBe(0);

      // The stairs: up at (2,2) to level 2's (5,5), down at (23,61) to the basement's (24,29).
      await q.step(...spot(32, 11));
      expect([q.townNum, q.at], q.tail()).toEqual([33, { x: 5, y: 5 }]);
      await q.enter(32);
      await q.step(...spot(32, 12));
      expect([q.townNum, q.at], q.tail()).toEqual([108, { x: 24, y: 29 }]);
    });

    it('The basement: with Belt Beta set, straight north along the middle belt and out beside the last spire', async () => {
      /** Walk north from just below the belts, up to 12 times; the row reached. */
      const north = async (beta: number): Promise<number> => {
        const r = new QuestRunner(scen);
        r.setFlag(0x4c4, beta);
        await r.enter(108, { x: 12, y: 13 });
        for (let i = 0; i < 12 && r.session.inTown && r.at.y > 6; i++) await r.go(Direction.N);
        return r.session.inTown ? r.at.y : -1;
      };
      expect(await north(0), 'Beta as it starts').toBeGreaterThan(6);
      expect(await north(1), 'Beta set').toBeLessThanOrEqual(6);
      // The belt's far end is the door out: zone 14's (34,4), beside the
      // Northern Spire, as the stairs down from the tower set it.
      const q = new QuestRunner(scen);
      q.setFlag(0x4c4, 1);
      await q.enter(32);
      await q.step(...spot(32, 12));
      expect(q.townNum).toBe(108);
      q.place({ x: 12, y: 13 });
      for (let i = 0; i < 20 && q.session.inTown; i++) await q.go(Direction.N);
      expect(q.session.inTown, q.tail()).toBe(false);
      expect(q.global).toEqual({ x: 274, y: 51 });
      await q.go(Direction.N, Direction.N);
      expect(q.townNum, q.tail()).toBe(167);
    });

    it("The tower's level 2: the control panel's belts, the library, the lever, and the Star belt to the stairs up", async () => {
      const q = new QuestRunner(scen);
      await q.enter(33);
      const ALPHA = 0x4c3, BETA = 0x4c4, STAR = 0x4c5;
      // The panel (spot 21): Belt Alpha and Belt Beta pressed, Star left alone.
      await q.clearHostiles();
      q.number(5, 7, 0);
      await q.step(...spot(33, 21));
      expect([q.flag(ALPHA), q.flag(BETA), q.flag(STAR)], q.tail()).toEqual([1, 1, 0]);
      expect([q.town.record.terrain[5]![51], q.town.record.terrain[6]![51]]).toEqual([249, 249]);

      // Belt Alpha south lets the party down to the library (spots 23 and 24).
      const toLibrary = async (alpha: number): Promise<boolean> => {
        const r = new QuestRunner(scen);
        r.setFlag(ALPHA, alpha);
        await r.enter(33, { x: 6, y: 50 });
        await r.clearHostiles();
        await r.go(Direction.S, Direction.S, Direction.S);
        return r.at.y >= 53;
      };
      expect(await toLibrary(0)).toBe(false);
      expect(await toLibrary(1)).toBe(true);
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 5;
      await touch(q, ...spot(33, 23));
      await touch(q, ...spot(33, 24));
      expect(q.party.pcs.some((pc) => pc.priestSpells[Spell.DIVINE_THUD - 100]), q.tail()).toBe(true);
      expect(q.party.pcs.some((pc) => pc.mageSpells[Spell.MINDDUEL]), q.tail()).toBe(true);

      // The lever behind the secret door (spot 22) turns the belt at (59,48).
      const belt = q.town.record.terrain[59]![48];
      await q.step(...spot(33, 22));
      expect(q.town.record.terrain[59]![48], q.tail()).toBe(belt === 247 ? 249 : 247);

      // The Star belt, (32,10)–(32,11): as it starts it carries the party up
      // from the east-running belt to the stairs (spot 17); set, it won't.
      const toStairs = async (star: number): Promise<number> => {
        const r = new QuestRunner(scen);
        r.setFlag(STAR, star);
        await r.enter(33, { x: 32, y: 12 });
        await r.clearHostiles();
        for (let i = 0; i < 10 && r.townNum === 33; i++) await r.go(Direction.N);
        return r.townNum;
      };
      expect(await toStairs(1)).toBe(33);
      expect(await toStairs(0)).toBe(60);
    });

    it("The tower's level 3: the gate waits on the four spires, and the Mind Crystal ends the golem plague", async () => {
      const q = new QuestRunner(scen);
      await q.enter(60);
      const crystal = q.creatures(/Crystal/)[0]!;
      expect(crystal, q.town.monsters.filter((m) => m.isAlive).map((m) => m.getName()).join()).toBeDefined();
      await q.kill(/Golem/);
      const [gx, gy] = spot(60, 2);
      // With a spire standing, the gate refuses.
      q.setFlag(0x713, 1); q.setFlag(0x71d, 1); q.setFlag(0x727, 1);
      await q.step(gx, gy);
      expect(q.at, q.tail()).not.toEqual({ x: gx, y: gy });
      q.setFlag(0x731, 1);
      await q.step(gx, gy);
      expect(q.at, q.tail()).toEqual({ x: gx, y: gy });
      // The crystal, past the belt maze.
      expect(q.canReach(q.at, crystal.curLoc), 'reachable').toBe(true);
      await q.kill(/Crystal/);
      expect(q.flag(0xc8c), q.tail()).toBe(1);
      expect(q.hasSpecItem(partySpecItem(0x46)), q.tail()).toBe(true);
      expect(q.town.monsters.some((m) => m.isAlive), 'every golem gone').toBe(false);
      // The golems are gone from the tower on return, too.
      await q.enter(32);
      expect(q.town.monsters.some((m) => m.isAlive && [159, 160, 161, 162, 163].includes(m.number))).toBe(false);
      // And the stairs back down (spot 11).
      await q.enter(60);
      await q.step(...spot(60, 11));
      expect(q.townNum, q.tail()).toBe(33);
    });

    it('The golems reported and rewarded: Anaximander, Berra, Levy and X; Pasi and Vladimir', async () => {
      const q = new QuestRunner(scen);
      q.setFlag(0xc8c, 1);
      const HOT_SHARDS = partySpecItem(0x46);
      q.party.specItems.add(HOT_SHARDS);
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.flag(0xc8c), q.tail()).toBe(2);
      // Berra takes the hot shards, and the evidence starts on its way (0xc93).
      await q.talk(/Berra/, 'evid');
      expect(q.hasSpecItem(HOT_SHARDS), q.tail()).toBe(false);
      expect(q.flag(0xc93)).toBe(1);
      const items = () => q.party.pcs.reduce((n, pc) => n + pc.items.filter((it) => it.variety !== 0).length, 0);
      const before = items();
      const [reward] = await q.talk(/Levy/, 'rewa');
      expect(q.flag(0xc8c), reward).toBe(3);
      expect(items(), reward).toBe(before + 1);
      await q.enter(24, { x: 10, y: 10 });
      await q.talk(31, 'earn');
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x36] && pc.mageSpells[0x39]), q.tail()).toBe(true);
    });

    /**
     * The tower's belt mazes, walked. Each route is a list of moves (0–7 the
     * eight directions from north clockwise, 8 standing still) that
     * `searchBelts` (`support/e3Belts.ts`) found with the engine as its model,
     * leg by leg from where the last one ended; here a fresh party walks them.
     * `E3_BELT_SEARCH=1` searches them again (a few minutes).
     */
    const ROUTES = {
      L1: [5,5,5,5,7,7,6,5,7,6,6,5,7,6,7,7,7,0,0,0,0,0,0,7,7,7,0,0,0,0,0,0,0,0,0,0,0,1,7,0,0,0,7,7,6,6,6,6,6,6,6,5,5,5,5,6,7,7,6,7,0,0,7,7,6,6,6,7,6,5,4,5,7,0],
      lever: [2,3,4,5,5,5,4,4,4,4,4,4,4,4,4,4,2,2,2,2,2,3,3,4,4,4,4,4,4,4,4,4,4,4,2,3,2,2,1,0,0,0,0,1,1,1,3,3,3,2,2,2,2,2,2,2,2,2,2,2,2,1,7,6,7,0,0,0,0,0,1,0],
      circle: [4,4,4,5,3,4,5,3,2,1,0,0,0,0,7,6,6,7,7,7,0,6,6,6,0,7,6,6,6,6,6,6,6,7,0,0,0,0,0,2,2,2,3,4,3,3,3,5,5,5],
      panel: [4,4,6,6,6,6,6,6,4,5,6,6,0,0,0,0,0,0,0,2,2,1,0,0,0,0,6,6,6,5,4,4,4,6,6,6,5,4,4,4,4,4,4,4,4,4,2,2,2,2,2,3,3,4,4,4,4,4,4,4,4,4,4,4,2,3,2,2,1,0,0,0,0,1,1,1,3,3,3,2,2,2,2,2,2,2,2,2,2,2,2,3,4,4,4,6,7,7,7],
      library: [3,3,5,5,5,6,6,0,0,0,0,0,2,2,1,0,0,0,0,0,0,0,6,7,7,0,6,6,6,0,7,6,6,6,6,8,6,6,6,6,6,6,4,5,6,6,0,0,0,0,0,0,0,2,2,1,0,0,0,0,6,6,6,5,4,4,4,6,6,6,5,4,4,4,4,4,4,4,4,4,3,3,5,4,4,4,5,4,4,4,4,3,3],
      stairs: [3,2,1,3,1,0,2,2,2,2,2,2,2,1,0,0,0,0,1,1,1,3,3,3,2,2,2,2,2,2,2,2,2,2,0,0,0,0,0,0,0,0,6,7,7,0,6,6,6,0,7,6,6,6,6,8,6,6,6,0,0,0,0,0,0,2,2,2,1,0,0,0,0,0,0],
      L3: [5,5,5,6,6,6,5,4,4,4,5,5,5,5,5,5,4,4,4,4,4,4,4,4,4,4,4,4,4,3,2,2,2,2,2,1,0,6,6,7,0,1,1,1,1,1,1,1,2,1,1],
    } as Record<string, BeltMove[]>;
    const near = (x: number, y: number) => (l: { x: number; y: number }) => Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= 1;
    /** Level 1 as the route expects it: the generators broken and the golems gone. */
    const level1 = async (q: QuestRunner): Promise<void> => {
      for (const g of GENERATORS) q.party.setSdf(...g.flag, 1);
      await q.enter(32, { x: 59, y: 31 });
      await q.clearHostiles();
    };
    /** Level 3 with the four spires down, its golems dead, and a party hardy enough for the lava. */
    const level3 = async (q: QuestRunner): Promise<void> => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
      for (const o of [0x713, 0x71d, 0x727, 0x731]) q.setFlag(o, 1);
      await q.enter(60, { x: 24, y: 5 });
      await q.kill(/Golem/);
    };
    /** Level 2's legs, each with what the party does at its end. */
    const level2Legs = (q: QuestRunner): [string, BeltGoal, () => Promise<void>][] => [
      ['lever', { at: near(57, 35) }, async () => { const s = { ...q.at }; await q.step(57, 35); q.place(s); }],
      ['circle', { at: (l) => l.x === 32 && l.y === 21 }, async () => {}],
      ['panel', { at: near(52, 50) }, async () => { const s = { ...q.at }; q.number(5, 7, 0); await q.step(52, 50); q.place(s); }],
      ['library', { at: near(6, 54) }, async () => { await touch(q, ...spot(33, 23)); await touch(q, ...spot(33, 24)); }],
      ['stairs', { town: 60 }, async () => {}],
    ];

    it("The tower's belt mazes, walked: level 1 to the stairs, level 2's lever, control room, library and stairs, and level 3 to the Mind Crystal", async () => {
      // Level 1: from the east door, through the belts to the stairs at (2,2).
      const one = new QuestRunner(scen);
      await level1(one);
      await walkBelts(one, ROUTES['L1']!);
      expect(one.townNum, one.tail()).toBe(33);

      // Level 2, from where those stairs arrive.
      const q = new QuestRunner(scen);
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 5;
      await q.enter(33, { x: 5, y: 5 });
      await q.clearHostiles();
      const belt = q.town.record.terrain[59]![48];
      for (const [name, , after] of level2Legs(q)) {
        await walkBelts(q, ROUTES[name]!);
        if (name !== 'stairs') await after();
        if (name === 'lever') expect(q.town.record.terrain[59]![48], 'the lever').not.toBe(belt);
        if (name === 'panel') expect([q.flag(0x4c3), q.flag(0x4c4)], 'Alpha and Beta').toEqual([1, 1]);
        if (name === 'library') expect(q.party.pcs.some((pc) => pc.priestSpells[Spell.DIVINE_THUD - 100]), q.tail()).toBe(true);
      }
      expect(q.townNum, q.tail()).toBe(60);

      // Level 3: the gate, the belts and the lava, to beside the crystal.
      const three = new QuestRunner(scen);
      await level3(three);
      const crystal = three.creatures(/Crystal/)[0]!;
      await walkBelts(three, ROUTES['L3']!);
      expect(crystal.isAlive).toBe(true);
      expect(near(crystal.curLoc.x, crystal.curLoc.y)(three.at), JSON.stringify(three.at)).toBe(true);
    });

    it.runIf(process.env['E3_BELT_SEARCH'])('The belt mazes searched again (E3_BELT_SEARCH=1)', async () => {
      const found: Record<string, BeltMove[] | null> = {};
      const one = new QuestRunner(scen);
      await level1(one);
      found['L1'] = await searchBelts(one, one.at, { town: 33 });
      const q = new QuestRunner(scen);
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 5;
      await q.enter(33, { x: 5, y: 5 });
      await q.clearHostiles();
      for (const [name, goal, after] of level2Legs(q)) {
        const start = { ...q.at };
        const route = await searchBelts(q, start, goal);
        found[name] = route;
        if (!route) break;
        q.place(start);
        await walkBelts(q, route);
        await after();
      }
      const three = new QuestRunner(scen);
      await level3(three);
      const crystal = three.creatures(/Crystal/)[0]!;
      found['L3'] = await searchBelts(three, three.at, { at: near(crystal.curLoc.x, crystal.curLoc.y) });
      console.log(JSON.stringify(found));
      for (const [name, route] of Object.entries(found)) expect(route, name).not.toBeNull();
    }, 1800000);
  });

  describe("Pachtar's Plate", () => {
    /**
     * Gale's library tells where Pachtar died, and the Lair of Drakos (towns
     * 74 and 75), on the island east of Kneece, holds his body. Walkthrough
     * A's "Pachtar's Plate" and B's "Pachtar's Plate Armoire".
     */
    it("Gale: Pasi's way in, the herb seller's electrum key, the library door, and its four books", async () => {
      const q = new QuestRunner(scen);
      // In from the road to the north: outside the walls, the gates shut.
      await q.outdoorsAt(311, 153);
      await q.go(Direction.S);
      expect(q.townNum).toBe(16);
      const herb = q.creatures(/Herb Seller/)[0]!.curLoc;
      expect(q.canReach(q.at, herb), 'the walls').toBe(false);
      expect(q.canReach(q.at, q.creatures(/Pasi/)[0]!.curLoc)).toBe(true);

      // Pasi lets nobody in who hasn't done something for the fort.
      const [no] = await q.talk(/Pasi/, 'assi');
      expect(q.flag(0x136), no).toBe(0);
      await q.step(55, 8);
      expect(q.at, q.tail()).not.toEqual({ x: 52, y: 14 });
      // The slimes beaten (0xc85), he points to the trees, and his tunnel
      // at (55,8) comes up inside the walls.
      q.setFlag(0xc85, 1);
      const [yes] = await q.talk(/Pasi/, 'assi');
      expect(q.flag(0x136), yes).toBe(1);
      await q.step(55, 8);
      expect(q.at, q.tail()).toEqual({ x: 52, y: 14 });
      expect(q.canReach(q.at, herb)).toBe(true);

      // The herb seller's "ownership": the librarian's key, for 1000 gold.
      q.party.gold = 500;
      await q.talk(/Herb Seller/, 'libr', 'owne');
      expect(q.hasSpecItem(ELECTRUM_KEY), q.tail()).toBe(false);
      q.party.gold = 1500;
      await q.talk(/Herb Seller/, 'owne');
      expect(q.hasSpecItem(ELECTRUM_KEY), q.tail()).toBe(true);
      expect(q.party.gold).toBe(500);

      // The library: through the false wall at (28,54) from the ramparts,
      // and its door at (27,51), which only the key opens (spot 11, beside it).
      const inside = { x: 52, y: 14 };
      expect(q.canReach(inside, { x: 28, y: 55 }), 'the ramparts').toBe(true);
      expect(q.town.record.terrain[28]![54]).toBe(101);
      expect(q.canReach({ x: 28, y: 55 }, { x: 28, y: 52 })).toBe(true);
      expect(q.town.record.terrain[27]![51]).toBe(0x6a);
      const key = q.party.specItems;
      key.delete(ELECTRUM_KEY);
      await q.step(28, 52);
      expect(q.town.record.terrain[27]![51], 'no key').toBe(0x6a);
      key.add(ELECTRUM_KEY);
      await q.step(28, 52);
      expect(q.town.record.terrain[27]![51], q.tail()).toBe(0x67);

      // Its four books want a party of some learning: 17 Mage Lore between
      // them for Pachtar's (spot 23), which puts the Lair of Drakos on the map.
      const [bx, by] = spot(16, 23);
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 2;
      await q.look(bx, by);
      expect(scen.towns[74]!.canFind, 'twelve Mage Lore').toBe(false);
      for (const pc of q.party.pcs) pc.skills[Skill.MAGE_LORE] = 3;
      await q.look(bx, by);
      expect(scen.towns[74]!.canFind, q.tail()).toBe(true);
      // The others: Killer Poison (spot 20), Antimagic Cloud (21) and Mass Paralysis (22).
      for (const id of [20, 21, 22]) await q.look(...spot(16, id));
      expect(q.party.alchemy[13], q.tail()).toBe(true);
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x33]), 'Antimagic Cloud').toBe(true);
      expect(q.party.pcs.some((pc) => pc.mageSpells[0x38]), 'Mass Paralysis').toBe(true);
    });

    /** Walkthrough A's moves on the shifting floor, from (21,30). */
    const A_PILLARS: BeltMove[] = [Direction.NW, Direction.W, Direction.E, Direction.W,
      Direction.E, Direction.E, Direction.E, Direction.E, Direction.W, Direction.E];
    /**
     * Moves from (21,30) that open the floor, as E3's code turns it (spot 14
     * row 28 left, 15 row 27 right, 16 row 26 left: `1088:3651` on); then
     * north through the gaps to (23,25), by the false wall walkthrough B
     * names at (22,25).
     */
    const PILLARS: BeltMove[] = [Direction.NW, Direction.E, Direction.E, Direction.E, Direction.W,
      Direction.E, Direction.W, Direction.E, Direction.E, Direction.W];
    const THROUGH: BeltMove[] = [Direction.N, Direction.NW, Direction.NE, Direction.N];
    /** The rows of the shifting floor, y 26–28, x 19–25: '.' open, '#' a pillar. */
    const floor = (q: QuestRunner): string[] => [26, 27, 28].map((y) =>
      Array.from({ length: 7 }, (_, i) => (q.town.record.terrain[19 + i]![y] === 0x96 ? '.' : '#')).join(''));
    /** A late-game party (the walkthroughs' advice), outside the Lair's west side, the lair on the map. */
    const lair = async (q: QuestRunner): Promise<void> => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
      scen.towns[74]!.canFind = true;
      await q.outdoorsAt(122, 312);
    };
    const at = (x: number, y: number) => (l: { x: number; y: number }) => l.x === x && l.y === y;
    const near = (x: number, y: number) => (l: { x: number; y: number }) =>
      Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= 1 && !(l.x === x && l.y === y);
    /** Fights off nothing: the drake lords are the test's. */
    const NOBODY = /(?!)/;
    /**
     * The Lair's legs, each found by `searchBelts` with the engine as its
     * model (`E3_BELT_SEARCH=1` searches again): level 1 from the west
     * door through the false wall at (10,42) to the lever at (37,29), and
     * from it to the shifting floor's (21,30); from the secret door at
     * (22,24) to the stairs; level 2 from the stairs to Drakos's ambush
     * (spot 1), from the lava there to Pachtar's body at (7,1), and back to
     * the stairs; and level 1 from them out.
     */
    const LAIR_LEGS: [string, BeltGoal][] = [
      ['lever', { at: at(37, 29) }], ['pillars', { at: at(21, 30) }], ['stairs', { town: 75 }],
      ['ambush', { at: at(14, 11) }], ['body', { at: near(7, 1) }], ['up', { town: 74 }], ['out', { town: -1 }],
    ];
    const LAIR_ROUTES = {
      lever: [4,3,5,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,3,2,2,2,2,1,0,0,1,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1,1,1,1,1,2,2,2,2,3,3,3,3,3,3,2,3,4,4,3,4,5,5,3,3,5,5,3,2,2,1,0],
      pillars: [4,5,5,5,5,5,7,7,5,5,6,6,7,7,7,7,7],
      stairs: [1,2,2,2,1,3,3,4,4,5,7,0],
      ambush: [4,4,3,3,5,5,4,4,3,5,3,4,4,5,4,3,4,4,3,4,5,4,3,3,4,4,4,4,5,5,5,5,5,5,5,5,7,5,4,5,5,5,6,5,7,6,7,5,5,5,6,6,6,6,6,5,5,6,6,6,6,7,6,6,7,6,6,6,7,7,7,0,0,0,0,7,1,1,1,1,3,2,2,2,3,2,1,1,0,0,0,0,0,0,0,0,0],
      body: [5,5,7,7,7,6,7,6,7,7,0,0,0,1,1],
      up: [4,5,5,4,4,3,2,3,3,4,3,3,3,3,3,3,3,3,3,5,5,4,3,3,5,4,4,5,4,4,5,5,5,5,7,6,5,5,6,6,7,6,5,3,3,4,5,4,3,2,2,2,2,3,3,3,2,1,1,1,2,2,1,3,3,2,2,2,1,1,1,3,3,2,2,2,2,1,1,1,0,1,1,1,3,1,0,1,7,0,0,0,0,1,0,1,1,0,0,0,0,0,0,7,0,0,0,0,0,1,7,0,0,0,0,1,7,0,0,0],
      out: [3,1,0,0,0,0,0,7,0],
    } as Record<string, BeltMove[]>;

    it('The Lair of Drakos, hidden until Pachtar\'s book is read, and walkthrough A\'s floor moves', async () => {
      const q = new QuestRunner(scen);
      await q.outdoorsAt(122, 312);
      expect(scen.towns[74]!.canFind).toBe(false);
      await q.go(Direction.E);
      expect(q.session.isOutdoors, 'not on the map').toBe(true);
      await lair(q);
      await q.go(Direction.E);
      expect([q.townNum, q.at]).toEqual([74, { x: 4, y: 24 }]);

      // Walkthrough A's floor moves leave the gaps at x 22, 20 and 22, and
      // north is shut (E3-CHECK-IN-ORIGINAL.md asks whether they work there).
      await q.enter(74, { x: 21, y: 30 });
      await q.clearHostiles();
      expect(floor(q)).toEqual(['.######', '######.', '.######']);
      await walkBelts(q, A_PILLARS, NOBODY);
      expect(floor(q)).toEqual(['###.###', '#.#####', '###.###']);
      expect(await q.go(Direction.N)).toEqual([false]);
      // Stepping off onto (23,30) puts the floor back (spot 17).
      await q.go(Direction.S);
      expect(floor(q)).toEqual(['.######', '######.', '.######']);
    });

    it("The Lair of Drakos, walked: the lever, the shifting floor, Drakos's ambush, Pachtar's body and the plate, and out", async () => {
      const q = new QuestRunner(scen);
      await lair(q);
      await q.go(Direction.E);
      const walk = async (name: string, foes = /./): Promise<string[]> => {
        const trail: string[] = [];
        for (const m of LAIR_ROUTES[name]!) { await walkBelts(q, [m], foes); trail.push(`${q.at.x},${q.at.y}`); }
        return trail;
      };

      // Level 1. The false wall at (10,42) is on the way to the lever.
      expect(await walk('lever'), 'the false wall').toContain('10,42');
      // The lever opens the pillars at (30,31) and (30,33), west of it.
      expect([q.town.record.terrain[30]![31], q.town.record.terrain[30]![33]], q.tail()).toEqual([0x96, 0x96]);
      await walk('pillars');
      expect(q.at).toEqual({ x: 21, y: 30 });
      await walkBelts(q, PILLARS);
      expect(floor(q)).toEqual(['####.##', '###.###', '####.##']);
      await walkBelts(q, THROUGH);
      expect(q.at).toEqual({ x: 23, y: 25 });
      // The secret door at (22,24) has a message spot on it: the message,
      // and the door opens (102) with the party through it, on one step.
      expect(q.town.record.terrain[22]![24]).toBe(101);
      const said = q.log.length;
      await q.go(Direction.NW);
      expect(q.at).toEqual({ x: 22, y: 24 });
      expect(q.town.record.terrain[22]![24]).toBe(102);
      expect(q.log.slice(said).join('\n')).toMatch(/narrow ledge/);
      expect(q.at).toEqual({ x: 22, y: 24 });
      await walk('stairs');
      expect([q.townNum, q.at], q.tail()).toEqual([75, { x: 42, y: 2 }]);

      // Level 2: the cavern of the fumarole, and "your location has
      // suddenly changed": the lava at (14,11), between the two drake lords.
      const ambush = LAIR_ROUTES['ambush']!;
      await walkBelts(q, ambush.slice(0, -1));
      await walkBelts(q, ambush.slice(-1), NOBODY);
      expect(q.at, q.tail()).toEqual({ x: 14, y: 11 });
      expect(q.log.at(-1)).toMatch(/Drakos, queen of drakes/);
      const lords = q.creatures(/Drake Lord/);
      expect(lords.length).toBe(2);
      expect(lords.some((m) => m.curLoc.x > 14 && m.curLoc.y < 11), 'northeast').toBe(true);
      expect(lords.some((m) => m.curLoc.x < 14 && m.curLoc.y > 11), 'southwest').toBe(true);
      await q.kill(/Drake Lord/);

      // West, and north over the lava at (4,6) and (4,7) (the walkthroughs cast Firewalk).
      const trail = await walk('body');
      expect(trail.filter((p) => ['3,6', '4,6', '3,7', '4,7'].includes(p)).length, trail.join(' ')).toBeGreaterThan(0);
      // The body is searched: "Nice Plate" until it's identified.
      const found = await q.session.adjTownLook({ x: 7, y: 1 });
      const plate = found?.find((it) => it.fullName === "Pachtar's Plate");
      expect(plate, q.tail()).toBeDefined();
      expect([plate!.name, plate!.ident]).toEqual(['Nice Plate', false]);
      expect(found!.map((it) => it.name)).toEqual(expect.arrayContaining(['Broadsword', 'Gauntlets', 'Shield']));
      q.session.takeItem(plate!, 0);
      const pc = q.party.pcs[0]!;
      const k = pc.items.findIndex((it) => it.fullName === "Pachtar's Plate");
      expect(k).toBeGreaterThanOrEqual(0);
      q.session.toggleEquip(0, k);
      expect(pc.equip[k]).toBe(true);
      // E3's Resistance (127): fire, poison, magic and cold halved.
      expect(pc.items[k]!.e3Ability).toBe(E3Abil.RESISTANCE);
      expect(e3DamageResist(pc, DamageType.FIRE, 30)).toBe(15);
      expect(e3DamageResist(pc, DamageType.WEAPON, 30)).toBe(30);

      // Back up the stairs, and out of the lair by the portal at (28,20)
      // (spot 9), which comes out by the north door at (43,4).
      await walk('up');
      expect(q.townNum, q.tail()).toBe(74);
      expect(await walk('out'), q.tail()).toContain('43,4');
      expect(q.session.isOutdoors, q.tail()).toBe(true);
    });

    it.runIf(process.env['E3_BELT_SEARCH'])("The Lair of Drakos searched again (E3_BELT_SEARCH=1)", async () => {
      const q = new QuestRunner(scen);
      await lair(q);
      await q.go(Direction.E);
      const found: Record<string, BeltMove[] | null> = {};
      for (const [name, goal] of LAIR_LEGS) {
        const start = { ...q.at };
        const route = await searchBelts(q, start, goal, 6000, /./);
        found[name] = route;
        console.log(name, JSON.stringify(route));
        if (!route) break;
        q.place(start);
        await walkBelts(q, route);
        if (name === 'pillars') {
          await walkBelts(q, [...PILLARS, ...THROUGH]);
          await q.go(Direction.NW);
          await q.go(Direction.NW);
        }
        if (name === 'ambush') await q.kill(/Drake Lord/);
      }
      console.log(JSON.stringify(found));
      for (const [name, route] of Object.entries(found)) expect(route, name).not.toBeNull();
    }, 1800000);
  });

  describe('the Fury Crossbow', () => {
    /**
     * Judith (Shayder, Bavner and Hectar) sells the Pit of the Wyrm's
     * location, and the crossbow lies on a bier past the floor puzzle on its
     * second level. Walkthrough A's "Fury Crossbow" and B's "The Fury
     * Crossbow".
     */
    const PIT = 76, PIT2 = 77;
    /** A late-game party (the walkthroughs fight thirty mutant giants and the Dark Wyrms), the Pit on the map. */
    const veterans = (q: QuestRunner): void => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
      scen.towns[PIT]!.canFind = true;
    };
    const P = (q: QuestRunner, x: number, y: number): number => q.town.record.terrain[x]![y]!;
    /**
     * Takes every item on (x, y) whose name matches, from beside it: what a
     * search turns up inside (a chest, `adj_town_look`) and what lies on it in
     * reach of Get (a table); returns their full names.
     */
    const loot = async (q: QuestRunner, x: number, y: number, re: RegExp): Promise<string[]> => {
      const beside = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
        .map(([dx, dy]) => ({ x: x + dx!, y: y + dy! }))
        .find((p) => !q.session.townIsBlocked(p) && q.canReach(q.at, p));
      if (!beside) throw new Error(`nowhere beside (${x},${y})`);
      q.place(beside);
      const found = new Set([...(await q.session.adjTownLook({ x, y })) ?? [],
        ...q.session.reachableItems(beside).items.filter((it) => it.itemLoc.x === x && it.itemLoc.y === y)]);
      const taken = [...found].filter((it) => re.test(it.fullName));
      for (const it of taken) q.session.takeItem(it, 0);
      return taken.map((it) => it.fullName);
    };

    /** Unlock cast at (x, y) until it works ("Didn't work." is a roll), as a player would. */
    const unlock = async (q: QuestRunner, x: number, y: number): Promise<void> => {
      const shut = P(q, x, y);
      for (let k = 0; k < 20 && P(q, x, y) === shut; k++) await q.spell(Spell.UNLOCK, x, y);
      expect(P(q, x, y), q.univ.transcript.slice(-3).join(' / ')).not.toBe(shut);
    };

    it("Judith: the Pit of the Wyrm on the map for 1000 gold; east of Bremerton, over the rivers", async () => {
      const q = new QuestRunner(scen);
      // She's in Shayder (and Bavner and Hectar, walkthrough A's "alternates").
      for (const t of [129, 130]) expect(scen.towns[t]!.creatures.some((m) => m?.personality === 163), `town ${t}`).toBe(true);
      // In Shayder on days that leave 2 over a multiple of three (her
      // time flag, 5), Hectar's on the next (3), and nowhere on the third.
      await q.enter(4);
      expect(q.creatures(/Judith/).length, 'day 1').toBe(0);
      q.party.age = 3700;
      await q.enter(4);
      expect(q.creatures(/Judith/).length, 'day 2').toBe(1);
      const [rumour] = await q.talk(/Judith/, 'arti');
      expect(rumour).toMatch(/Fury Crossbow.*thousand gold/);
      q.party.gold = 999;
      const [no] = await q.talk(/Judith/, 'loca');
      expect(no).toMatch(/thousand gold.*No less/);
      expect(scen.towns[PIT]!.canFind).toBe(false);
      expect(q.party.gold).toBe(999);
      q.party.gold = 1500;
      const [yes] = await q.talk(/Judith/, 'loca');
      expect(yes).toMatch(/Pit of the Wyrm.*due east of a city called Bremerton/);
      expect(scen.towns[PIT]!.canFind).toBe(true);
      expect(q.party.gold).toBe(500);
      // Once.
      const [again] = await q.talk(/Judith/, 'loca');
      expect(again).toMatch(/already learned/);
      expect(q.party.gold).toBe(500);

      // East of Bremerton (234,131), over the rivers (walkthrough A "fly
      // across the river", B twice, at (246,129) and (254,120)); or on foot,
      // north round the lake and through two of E3's mountain passes (spot
      // 50) at (272,129)–(273,129) and (260,127)–(261,127).
      const dry = (t: number) => scen.terTypes[t]!.blockage <= TerObstruct.BLOCK_SIGHT;
      const flying = (t: number) => dry(t) || scen.terTypes[t]!.flyOver;
      const passes = new Set(['272,129', '273,129', '260,127', '261,127']);
      expect(outdoorPath([234, 131], [260, 130], dry, passes), 'on foot, no passes').toBe(-1);
      expect(outdoorPath([234, 131], [260, 130], dry), 'through the passes').toBeGreaterThan(0);
      expect(outdoorPath([234, 131], [260, 130], flying, passes), 'flying').toBeGreaterThan(0);

      // The entrance at (261,130) lets the party in only now, at (4,24).
      const r = new QuestRunner(scen);
      await r.outdoorsAt(260, 130);
      await r.go(Direction.E);
      expect(r.party.townNum === PIT, 'not on the map').toBe(false);
      scen.towns[PIT]!.canFind = true;
      await r.outdoorsAt(260, 130);
      await r.go(Direction.E);
      expect([r.townNum, r.at]).toEqual([PIT, { x: 4, y: 24 }]);
    });

    it("The Pit, level 1: the watchers' ruin and its chest, the giants' dig, and the stairs down", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.outdoorsAt(260, 130);
      await q.go(Direction.E);
      await q.clearHostiles();
      const start = { ...q.at };
      // Walkthrough A's "being watched", where the path turns east.
      await q.step(11, 17);
      expect(q.tail(1)).toMatch(/You feel as if you're being watched/);
      // B's ruin (A passes it by): its door at (6,6) is locked past picking
      // (137), but E3's Unlock opens it, to the closed door (135); the chest
      // at (4,5) holds two scrolls and gold.
      expect(q.canReach(start, { x: 6, y: 7 })).toBe(true);
      expect(scen.terTypes[P(q, 6, 6)]!.special).toBe(TerSpec.UNLOCKABLE);
      q.place({ x: 6, y: 7 });
      await unlock(q, 6, 6);
      expect(P(q, 6, 6)).toBe(135);
      await q.walk(6, 6);
      expect(P(q, 6, 6)).toBe(139);
      expect(await loot(q, 4, 5, /Scroll/)).toEqual(expect.arrayContaining(['Scroll: Flame', 'Scroll: Major Haste']));
      // The giants' dig (spot 3), and the stairs at (18,43): "A slimy
      // passage slopes down into utter darkness."
      await q.step(17, 29);
      expect(q.tail(1)).toMatch(/continuing the dig/);
      expect(q.canReach(start, { x: 18, y: 43 })).toBe(true);
      await q.step(18, 43);
      expect([q.townNum, q.at], q.tail()).toEqual([PIT2, { x: 5, y: 45 }]);
    });

    it('The Pit, level 1: the ruined garrison behind moldy walls (walkthrough B), its slimes, and the Wand of Nullity', async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(PIT, { x: 4, y: 24 });
      await q.clearHostiles();
      const start = { ...q.at };
      // The secret passage south of (21,41), to the odd wall (spot 4).
      expect(q.canReach(start, { x: 32, y: 43 })).toBe(true);
      await q.step(31, 43);
      expect(q.tail(1)).toMatch(/This wall is clearly very odd/);
      // Its moldy adobe at (33,43) walls the garrison in; Move Mountains breaks it.
      expect(P(q, 33, 43)).toBe(144);
      expect(q.canReach(start, { x: 35, y: 43 })).toBe(false);
      q.place({ x: 32, y: 43 });
      await q.spell(Spell.MOVE_MOUNTAINS, 33, 43);
      expect(q.univ.transcript, q.tail()).toContain('  Barrier crumbles.');
      expect(q.canReach(start, { x: 35, y: 43 })).toBe(true);
      // The sacrificial pit's room (spot 5): slimes ooze out.
      const slimes = q.creatures(/Mung Slime/).length;
      await q.step(40, 43);
      expect(q.log.slice(-2).join('\n')).toMatch(/sacrificial pit, several creatures ooze out/);
      expect(q.creatures(/Mung Slime/).length).toBeGreaterThan(slimes);
      await q.kill(/Mung Slime/);
      // The box at (46,36) is behind the wall north of (46,38): Move Mountains again.
      expect(q.canReach(start, { x: 46, y: 38 })).toBe(true);
      expect(q.canReach(start, { x: 46, y: 36 })).toBe(false);
      q.place({ x: 46, y: 38 });
      await q.spell(Spell.MOVE_MOUNTAINS, 46, 37);
      expect(q.canReach(start, { x: 46, y: 36 }), q.tail()).toBe(true);
      expect(await loot(q, 46, 36, /./)).toEqual(expect.arrayContaining(['Wand of Nullity', 'Bronze Serpent Ring']));
    });

    /** Floor squares of the puzzle (x 16–21, y 40–42), '.' safe (186), '#' charged (193). */
    const grid = (q: QuestRunner): string[] => [40, 41, 42].map((y) =>
      [16, 17, 18, 19, 20, 21].map((x) => (P(q, x, y) === 0xba ? '.' : '#')).join(''));
    const { N, NE, E, S, W, SW } = Direction;
    /** Walkthrough A's way across, from the door at (15,42) (B's "right, up, up, …" is the same). */
    const ACROSS = [E, N, N, E, S, E, S, E, E, N, N, E];
    /** Level 2, the Dark Wyrms dead and the lever pulled, at the floor room's door. */
    const atTheFloor = async (q: QuestRunner): Promise<void> => {
      veterans(q);
      await q.enter(PIT2, { x: 5, y: 45 });
      await q.clearHostiles();
      await q.step(16, 26);
      q.place({ x: 14, y: 42 });
      await q.go(E, E);
    };

    it("The Pit, level 2: the mausoleum past the false wall, the rune, its three crypts, and the lever", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(PIT2, { x: 5, y: 45 });
      await q.clearHostiles();
      const start = { ...q.at };
      // B's false wall south of (30,21) is the only way to the mausoleum's door.
      expect(q.canReach(start, { x: 14, y: 14 })).toBe(true);
      const wall = P(q, 30, 22);
      q.town.record.terrain[30]![22] = P(q, 31, 22);
      expect(q.canReach(start, { x: 14, y: 14 }), 'without it').toBe(false);
      q.town.record.terrain[30]![22] = wall;
      // Its door (14,15) is locked: Unlock, and in.
      expect(scen.terTypes[P(q, 14, 15)]!.special).toBe(TerSpec.UNLOCKABLE);
      q.place({ x: 14, y: 14 });
      await unlock(q, 14, 15);
      await q.walk(14, 15);
      expect(q.log.slice(-2).join('\n'), q.tail()).toMatch(/You break into a mausoleum/);
      // The crypts' doors are sealed until the rune at the hall's end, (14,26):
      // past magic (138), so Unlock never works.
      const doors = [17, 19, 23, 25].map((y) => ({ x: 15, y }));
      expect(doors.map((d) => P(q, d.x, d.y))).toEqual([138, 138, 138, 138]);
      q.place({ x: 14, y: 17 });
      for (let k = 0; k < 10; k++) await q.spell(Spell.UNLOCK, 15, 17);
      expect(P(q, 15, 17)).toBe(138);
      expect(q.univ.transcript.at(-1)).toBe("  Didn't work.");
      await q.step(14, 26);
      expect(q.tail(1)).toMatch(/the doors to the north glow slightly/);
      expect(doors.map((d) => P(q, d.x, d.y))).toEqual([135, 135, 135, 135]);
      await q.kill(/Spectre/);
      // B's three crypts: a Dart of Returning, a Potion of Bliss, Ambrosia.
      expect(await loot(q, 16, 16, /Dart/)).toEqual(['Dart of Returning']);
      expect(await loot(q, 16, 20, /Bliss/)).toEqual(['Potion of Bliss']);
      expect(await loot(q, 16, 22, /Ambrosia/)).toEqual(['Ambrosia']);

      // The floor room has no way in until the southernmost crypt's lever
      // (16,26) puts a door at (15,42): "Nothing happens, as far as you can tell."
      const bier = { x: 20, y: 37 };
      expect(P(q, 15, 42)).toBe(132);
      expect(q.canReach(start, bier)).toBe(false);
      await q.step(16, 26);
      expect(q.tail(1)).toMatch(/You pull the lever. Nothing happens/);
      expect(P(q, 15, 42)).toBe(135);
      expect(q.canReach(start, bier)).toBe(true);
    });

    it("The Pit, level 2: walkthrough A's way across the charged floor, the bier, and the Fury Crossbow", async () => {
      const q = new QuestRunner(scen);
      await atTheFloor(q);
      expect(q.at).toEqual({ x: 15, y: 42 });
      // Only the square by the door is safe to start.
      expect(grid(q)).toEqual(['######', '######', '.#####']);
      const moved = await q.go(...ACROSS);
      expect(moved, q.tail()).toEqual(ACROSS.map(() => true));
      expect(q.at).toEqual({ x: 21, y: 40 });
      // North: the crypt's door at (21,39) opens on the bier's sight, and a second step goes in.
      expect(await q.go(N)).toEqual([false]);
      expect(q.tail(1)).toMatch(/A skeleton lies on a massive marble bier/);
      expect(await q.go(N)).toEqual([true]);
      // The crossbow lies on the bier, unidentified.
      const found = (await loot(q, 19, 36, /Crossbow/));
      expect(found).toEqual(['Fury Crossbow']);
      const pc = q.party.pcs[0]!;
      const bow = pc.items.find((it) => it.fullName === 'Fury Crossbow')!;
      expect([bow.name, bow.ident, bow.bonus]).toEqual(['Crossbow', false, 7]);
      await loot(q, 18, 36, /Bolts/);
      expect(q.hasItem(/Magic Bolts/)).toBe(true);
    });

    it("The Pit, level 2: the floor's zaps and its throw back, and the way back out (check-in #21)", async () => {
      const q = new QuestRunner(scen);
      await atTheFloor(q);
      const hp = () => q.party.pcs[0]!.curHealth;
      // A charged square zaps and refuses the step.
      let before = hp();
      expect(await q.go(E, NE)).toEqual([true, false]);
      expect(q.tail(1)).toMatch(/bolts of lightning arc out towards you/);
      expect(hp()).toBeLessThan(before);
      expect(q.at).toEqual({ x: 16, y: 42 });
      // A safe square with no safe squares of its own, (17,42), throws the
      // party back to the door, drained to half health.
      before = hp();
      expect(await q.go(E)).toEqual([false]);
      expect(q.tail(1)).toMatch(/You suddenly find yourself somewhere else/);
      expect(q.at).toEqual({ x: 15, y: 42 });
      expect(hp()).toBe(Math.floor(before / 2));
      // The throw makes both ends safe: (16,42) by the door, (21,40) by the bier.
      expect(grid(q)).toEqual(['#####.', '######', '.#####']);

      // Across to the bier.
      await q.go(...ACROSS, N, N);
      expect(q.at).toEqual({ x: 21, y: 39 });
      // Walkthrough A's way back starts south, onto (21,40), which went
      // charged when the party stood on it: it zaps, and A's next step, west,
      // is a wall. Southwest is safe, and A's moves after its first two take
      // the party back to the door.
      expect(grid(q)).toEqual(['####.#', '######', '######']);
      expect(await q.go(S), q.tail()).toEqual([false]);
      expect(q.tail(1)).toMatch(/bolts of lightning/);
      expect(await q.go(W)).toEqual([false]);
      const BACK = [SW, S, W, W, N, W, S, W, S, W];
      expect(await q.go(...BACK), q.tail()).toEqual(BACK.map(() => true));
      expect(q.at).toEqual({ x: 15, y: 42 });

      // Once the bier is seen, a throw lands the party at its door instead.
      // (16,42) went charged on the way out; round by (16,41) to (17,42).
      expect(await q.go(NE, S, E)).toEqual([true, true, false]);
      expect(q.tail(1)).toMatch(/You suddenly find yourself somewhere else/);
      expect(q.at, q.tail()).toEqual({ x: 21, y: 39 });
      // And out: the stairs at (5,46), up to level 1's (18,44) side.
      q.place({ x: 14, y: 42 });
      expect(q.canReach(q.at, { x: 5, y: 46 })).toBe(true);
      await q.step(5, 46);
      expect([q.townNum, q.at], q.tail()).toEqual([PIT, { x: 18, y: 44 }]);
      expect(q.canReach(q.at, { x: 4, y: 24 })).toBe(true);
    });
  });

  it('the province maps: special items 0–5 and 9 show BIGMAPS.BMP', async () => {
    // FUN_10c0_1f96's jump table: each opens its dialog, whose picture is
    // `5_3600 + k`, a 240×240 map of its own.
    const maps: [number, RegExp][] = [
      [0, /Krizsan/], [1, /Upper Exile/], [2, /Bigail/], [3, /Karnold/], [4, /Midori/], [5, /Monoroe/], [9, /Footracer/],
    ];
    for (const [k, title] of maps) {
      const spec = scen.specialItems[k]!;
      expect(specItemUseable(spec), `item ${k}`).toBe(true);
      const node = scen.scenSpecials.get(spec.special)!;
      expect(node.pictype, `item ${k}`).toBe(PIC_CUSTOM_FULL);
      const png = readFileSync(join(out, `graphics/sheet${node.pic}.png`));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `item ${k}`).toEqual([240, 240]);
      const q = new QuestRunner(scen);
      q.party.specItems.add(k);
      const said = q.log.length;
      await q.useSpecItem(k);
      expect(q.log.slice(said).join('\n'), `item ${k}`).toMatch(title);
    }
  });

  describe('the Black Halberd', () => {
    /**
     * Sharimik's bartender sends the party to Masok (Angel's Rest, or
     * Softport), whose scroll is a map to the Remote Cave; past its puzzles,
     * the Rakshasa Lair below keeps the halberd in a chest. Walkthrough A's
     * "The Black Halberd" and B's "The Black Halberd Kenichi".
     */
    const CAVE = 72, LAIR = 73;
    const veterans = (q: QuestRunner): void => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
    };
    const P = (q: QuestRunner, x: number, y: number): number => q.town.record.terrain[x]![y]!;
    const crates = (q: QuestRunner): string[] => {
      const at: string[] = [];
      for (let x = 0; x < 48; x++) for (let y = 0; y < 48; y++) if (q.town.hasField(x, y, FieldType.OBJECT_CRATE)) at.push(`${x},${y}`);
      return at;
    };
    const { N, NE, E, SE, S, SW, W, NW } = Direction;
    const times = (d: Direction, n: number): Direction[] => Array<Direction>(n).fill(d);

    it("Sharimik's bartender, Masok's scroll for 2000 gold, and the Remote Cave west of (57,68)", async () => {
      const q = new QuestRunner(scen);
      q.party.gold = 5000;
      await q.enter(8);
      const [shots] = await q.talk(243, 'bour');
      expect(shots).toMatch(/My knowledge will only cost 100 gold/);
      const [rumour] = await q.talk(243, 'know');
      expect(rumour).toMatch(/trooper named Masok, out of Angel's Rest/);
      expect(q.party.gold).toBe(5000 - 12 - 100);

      // Masok drinks in Angel's Rest's inn (and Softport's) one day in three.
      for (const t of [147, 133]) expect(scen.towns[t]!.creatures.some((m) => m?.personality === 260), `town ${t}`).toBe(true);
      q.party.age = 7400;
      await q.enter(147);
      expect(q.creatures(260).length, 'day 3').toBe(1);
      const [halb, scro] = await q.talk(260, 'halb', 'scro');
      expect(halb).toMatch(/Black Halberd/);
      expect(scro).toMatch(/Only 2000 gold/);
      q.party.gold = 1999;
      const [no] = await q.talk(260, 'purc');
      expect(q.party.gold, no).toBe(1999);
      expect(q.hasItem(/Map|Paper|Scroll/)).toBe(false);
      q.party.gold = 2500;
      const [yes] = await q.talk(260, 'purc');
      expect(q.party.gold, yes).toBe(500);
      const pc = q.party.pcs.find((p) => p.items.some((it) => it.variety !== 0 && it.e3Ability === 0xb3))!;
      expect(pc, q.tail()).toBeDefined();
      // Once.
      const [again] = await q.talk(260, 'purc');
      expect(q.party.gold, again).toBe(500);
      // The scroll is a map.
      const said = q.log.length;
      await useItem(q.session, q.party.pcs.indexOf(pc), pc.items.findIndex((it) => it.e3Ability === 0xb3), q.session.host ?? undefined);
      await q.settle();
      expect(q.log.slice(said).join('\n')).toMatch(/Map to Black Halberd/);

      // The cave is on the map from the start (E3 hides 70, 71 and 74–79,
      // not 72 or 73): its entrance at (56,68), walkthrough B's "57,68, the
      // cave to the west", lets the party in at (43,5).
      expect(scen.towns[CAVE]!.canFind).toBe(true);
      const r = new QuestRunner(scen);
      await r.outdoorsAt(57, 68);
      await r.go(W);
      expect([r.townNum, r.at], r.tail()).toEqual([CAVE, { x: 43, y: 5 }]);
    });

    it('The Remote Cave: due south from the white mushrooms, or the way shuts', async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.outdoorsAt(57, 68);
      await q.go(W);
      await q.clearHostiles();
      // (32,13) is stalagmites until the mushrooms at (32,1) clear it.
      expect(P(q, 32, 13)).toBe(95);
      expect(q.canReach(q.at, { x: 32, y: 1 })).toBe(true);
      await q.step(32, 1);
      expect(P(q, 32, 13)).toBe(0);
      expect(await q.go(...times(S, 13)), q.tail()).toEqual(times(S, 13).map(() => true));
      expect(q.at).toEqual({ x: 32, y: 14 });
      // A step off the line, onto (31,9), (33,9), (31,11) or (33,11), shuts it again.
      q.place({ x: 32, y: 8 });
      expect(await q.go(SW)).toEqual([true]);
      expect(P(q, 32, 13)).toBe(95);
      expect(await q.go(SE, S, S, S)).toEqual([true, true, true, false]);
      expect(q.at).toEqual({ x: 32, y: 12 });
      // Back to the mushrooms, and down again; on to the door at (15,1).
      q.place({ x: 32, y: 2 });
      await q.go(N);
      await q.go(...times(S, 13));
      expect(q.at).toEqual({ x: 32, y: 14 });
      expect(q.canReach(q.at, { x: 15, y: 1 })).toBe(true);
    });

    /**
     * Walkthrough A's crate moves from (3,17), with one more south at its
     * step 7 ("south two" leaves the crate a square short of B's start, "at
     * 10,3 with a crate one square south"); from there A's and B's are the
     * same moves. A crate that can't go on swaps squares with the party (as
     * the Concealed Tunnel's barrels do), which is how the first south and
     * the last north work.
     */
    const CRATE_MOVES = [S, ...times(N, 15), NW, ...times(E, 7), NE, ...times(S, 3), SW, E, ...times(W, 4), S, NW, SE, S,
      ...times(E, 3), S, NE, ...times(SW, 3), S, W, W, ...times(E, 4), S, NE, SW, S, ...times(W, 3), S, NW, SE, SE, S,
      ...times(E, 5), SE, ...times(N, 16)];

    it("The Remote Cave: the crate pushed round the chasms onto the rune, the paper in it, and the door it opens", async () => {
      // (A second runner resets the shared scenario's towns, so side checks come first.)
      // Walkthrough A's own count leaves the crate stuck by the second chasm.
      {
        const r = new QuestRunner(scen);
        await r.enter(CAVE, { x: 43, y: 5 });
        r.place({ x: 3, y: 17 });
        const a = [...CRATE_MOVES];
        a.splice(1 + 15 + 1 + 7 + 1, 1);
        await r.go(...a);
        expect(crates(r)).not.toContain('13,2');
      }
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(CAVE, { x: 43, y: 5 });
      await q.clearHostiles();
      // Three crates by the far wall; the paper lies "in" the rune's square at
      // (13,2), and with no crate there a search finds nothing.
      expect(crates(q)).toEqual(['1,18', '2,18', '3,18']);
      expect(P(q, 13, 2)).toBe(153);
      q.place({ x: 13, y: 3 });
      expect((await q.session.adjTownLook({ x: 13, y: 2 })) ?? []).toEqual([]);
      // The door at (8,19) is barred until the paper is read.
      q.place({ x: 8, y: 17 });
      expect(await q.go(S)).toEqual([false]);
      const barred = q.tail(1);
      expect(q.at).toEqual({ x: 8, y: 17 });

      q.place({ x: 3, y: 17 });
      const moved = await q.go(...CRATE_MOVES);
      expect(moved.every(Boolean), q.tail()).toBe(true);
      expect(crates(q)).toEqual(['1,18', '2,18', '13,2']);
      expect(q.at).toEqual({ x: 13, y: 1 });

      // Searched, the crate holds the paper: "You may proceed."
      const found = (await q.session.adjTownLook({ x: 13, y: 2 })) ?? [];
      expect(found.map((it) => it.fullName)).toEqual(['Piece of Paper']);
      q.session.takeItem(found[0]!, 0);
      const pc = q.party.pcs[0]!;
      const said = q.log.length;
      await useItem(q.session, 0, pc.items.findIndex((it) => it.fullName === 'Piece of Paper'), q.session.host ?? undefined);
      await q.settle();
      expect(q.log.slice(said).join('\n')).toMatch(/You may proceed/);
      expect(q.flag(0x35d)).toBe(1);
      q.place({ x: 8, y: 17 });
      expect(await q.go(S), barred).toEqual([true]);
      await q.walk(8, 19);
      expect(q.at).toEqual({ x: 8, y: 19 });
    });

    it('The Remote Cave: the triangular tiles, the braziers, the stalagmite, the stairs down, and the way back', async () => {
      // (A second runner resets the shared scenario's towns, so side checks come first.)
      // Out of order, the tiles' last does nothing.
      {
        const r = new QuestRunner(scen);
        veterans(r);
        await r.enter(CAVE, { x: 43, y: 5 });
        await r.clearHostiles();
        r.place({ x: 7, y: 31 });
        await r.go(N, N);
        expect(r.at).toEqual({ x: 7, y: 29 });
      }
      const q = new QuestRunner(scen);
      veterans(q);
      await q.outdoorsAt(57, 68);
      await q.go(W);
      await q.clearHostiles();
      await q.step(32, 1);
      q.setFlag(0x35d, 1);
      q.place({ x: 8, y: 24 });
      // The tiles: walkthrough A's (and B's) moves from the message at (8,25),
      // stepping on spots 17, 16 and 15 in that order, and the last throws the
      // party to the far side at (18,39).
      await q.go(S);
      expect(q.tail(1)).toMatch(/set in a triangle pattern/);
      const TILES = [S, S, E, E, S, S, E, S, S, W, W, W, W, N, N];
      const moved = await q.go(...TILES);
      expect(q.at, q.tail()).toEqual({ x: 18, y: 39 });
      expect(moved.slice(0, -1).every(Boolean)).toBe(true);

      // The braziers: seven over the runes on row 40; exactly one left as
      // floor opens (38,44). A's "only the rune second to the east", (32,40).
      expect([27, 28, 29, 30, 31, 32, 33].map((x) => P(q, x, 38))).toEqual(Array(7).fill(165));
      expect(P(q, 38, 44)).toBe(95);
      q.place({ x: 32, y: 39 });
      await q.go(S);
      expect([27, 28, 29, 30, 31, 32, 33].filter((x) => P(q, x, 38) === 150)).toEqual([30]);
      expect(P(q, 38, 44)).toBe(0);
      expect(q.canReach(q.at, { x: 42, y: 44 })).toBe(true);

      // North up the long passage: past (42,33) the floor at (42,20) pushes
      // the party back, until the lone stalagmite at (43,27) is searched.
      q.place({ x: 42, y: 36 });
      await q.go(...times(N, 15));
      expect(q.at, q.tail()).toEqual({ x: 42, y: 21 });
      await q.look(43, 27);
      q.place({ x: 42, y: 21 });
      expect(await q.go(N, N)).toEqual([true, true]);
      expect(q.at).toEqual({ x: 42, y: 19 });
      // The stairs: B's centre one at (23,23) to the lair's (18,36), where both
      // walkthroughs start; the others to (23,6), by the drakes' lava.
      for (const [x, y] of [[23, 23], [20, 18], [25, 28]] as const) expect(q.canReach(q.at, { x, y }), `${x},${y}`).toBe(true);

      // The way back (walkthrough A: "the same way that you came in"): south
      // down the passage, free now, and the floor at (18,38) by the tiles'
      // far side throws the party back to (8,24); then out by the door it came in.
      expect(await q.go(...times(S, 16))).toEqual(times(S, 16).map(() => true));
      expect(q.at).toEqual({ x: 42, y: 35 });
      expect(q.canReach(q.at, { x: 19, y: 38 })).toBe(true);
      q.place({ x: 19, y: 38 });
      await q.go(W);
      expect(q.at, q.tail()).toEqual({ x: 8, y: 24 });
      expect(q.canReach(q.at, { x: 43, y: 5 })).toBe(true);

      await q.step(23, 23);
      expect([q.townNum, q.at], q.tail()).toEqual([LAIR, { x: 18, y: 36 }]);
      // The other two stairs land at (23,6), by the drakes' lava, cut off from
      // the halberd but a short way out: the lair's east edge leaves by the
      // cave's own entrance.
      await q.step(19, 37);
      expect([q.townNum, q.at], q.tail()).toEqual([CAVE, { x: 24, y: 23 }]);
      await q.step(20, 18);
      expect([q.townNum, q.at], q.tail()).toEqual([LAIR, { x: 23, y: 6 }]);
      expect(q.canReach(q.at, { x: 13, y: 7 })).toBe(false);
      await q.clearHostiles();
      q.place({ x: 45, y: 4 });
      await q.go(E, E);
      expect([q.session.isOutdoors, q.global], q.tail()).toEqual([true, { x: 58, y: 68 }]);
    });

    /** Unlock cast at (x, y) until it works ("Didn't work." is a roll), as a player would. */
    const unlock = async (q: QuestRunner, x: number, y: number): Promise<void> => {
      const shut = P(q, x, y);
      for (let k = 0; k < 20 && P(q, x, y) === shut; k++) await q.spell(Spell.UNLOCK, x, y);
      expect(P(q, x, y), q.univ.transcript.slice(-3).join(' / ')).not.toBe(shut);
    };
    /** From beside (x, y), a locked door: Unlock, and through it. */
    const through = async (q: QuestRunner, from: Location, x: number, y: number): Promise<void> => {
      q.place(from);
      if (scen.terTypes[P(q, x, y)]!.special === TerSpec.UNLOCKABLE) await unlock(q, x, y);
      await q.walk(x, y);
      expect(q.at, `${x},${y}\n${q.tail()}`).toEqual({ x, y });
    };

    it("The Rakshasa Lair: east, north and east to the library, the false wall at (20,15), the ambush, and the Black Halberd", async () => {
      // Out of the first room by any other door, and its east door becomes wall.
      {
        const r = new QuestRunner(scen);
        await r.enter(LAIR, { x: 18, y: 36 });
        r.place({ x: 16, y: 37 });
        await r.walk(15, 37);
        await r.go(W);
        expect(r.at).toEqual({ x: 14, y: 37 });
        expect(P(r, 22, 36)).toBe(117);
      }
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(LAIR, { x: 18, y: 36 });
      // Walkthrough A: the open door east (22,36); the next room's north door
      // (26,33) and that room's east door (29,29), both locked; the hallway's
      // door (34,29) into the library, and the rakshasas.
      await through(q, { x: 21, y: 36 }, 22, 36);
      expect(P(q, 22, 36)).not.toBe(117);
      await through(q, { x: 26, y: 34 }, 26, 33);
      await through(q, { x: 28, y: 29 }, 29, 29);
      await through(q, { x: 33, y: 29 }, 34, 29);
      expect(q.creatures(/Rakshasa/).length).toBe(10);
      await q.kill(/Rakshasa/);
      // B's way: the room south of the first, its gazers, and the east door
      // (29,43) into the hookah room (spot 5), the same library.
      expect(q.canReach({ x: 18, y: 36 }, { x: 34, y: 43 })).toBe(true);
      // Its two bookshelves: Word of Recall for 13 Mage Lore between the
      // party, Death Arrows for 17 (walkthrough B recalls home from here).
      q.party.pcs.forEach((pc) => { pc.skills[Skill.MAGE_LORE] = 2; pc.priestSpells[Spell.WORD_RECALL - 100] = false; pc.mageSpells[Spell.ARROWS_DEATH] = false; });
      await q.look(36, 35);
      expect(q.tail(1)).toMatch(/insufficient/);
      q.party.pcs[0]!.skills[Skill.MAGE_LORE] = 3;
      await q.look(36, 35);
      expect(q.tail(1)).toMatch(/You now know the spell Word of Recall/);
      expect(q.party.pcs.every((pc) => pc.priestSpells[Spell.WORD_RECALL - 100])).toBe(true);
      await q.look(42, 33);
      expect(q.tail(1)).toMatch(/insufficient/);
      q.party.pcs.forEach((pc) => { pc.skills[Skill.MAGE_LORE] = 3; });
      await q.look(42, 33);
      expect(q.tail(1)).toMatch(/You now know how to cast Death Arrows/);
      expect(q.party.pcs.every((pc) => pc.mageSpells[Spell.ARROWS_DEATH])).toBe(true);

      // North and west: the library's north-east door (42,28), its hall, the
      // hall's westmost north door (23,18), and the false wall at (20,15)
      // west of the bed (A's "secret passage", B's "21,15").
      await through(q, { x: 42, y: 29 }, 42, 28);
      expect(q.canReach(q.at, { x: 23, y: 19 })).toBe(true);
      await through(q, { x: 23, y: 19 }, 23, 18);
      expect(q.canReach(q.at, { x: 21, y: 15 })).toBe(true);
      const wall = P(q, 20, 15);
      q.town.record.terrain[20]![15] = 117;
      expect(q.canReach(q.at, { x: 13, y: 7 }), 'without it').toBe(false);
      q.town.record.terrain[20]![15] = wall;
      await through(q, { x: 21, y: 15 }, 20, 15);
      // The pillared room: at the door (13,6) its side walls sink, and the
      // gazer, the ur-basilisk and the undead come out.
      expect(q.canReach(q.at, { x: 13, y: 7 })).toBe(true);
      // (Behind the walls at x 9 and 17: the gazer, the ur-basilisk and six more.)
      const ambush = () => q.town.monsters.filter((m) => m.isAlive && [9, 17].includes(m.curLoc.x) && m.curLoc.y >= 7 && m.curLoc.y <= 10);
      expect(ambush().length).toBe(8);
      expect(ambush().some((m) => q.canReach(m.curLoc, { x: 13, y: 7 }))).toBe(false);
      q.place({ x: 13, y: 7 });
      await q.go(N);
      expect(q.log.slice(-2).join('\n'), q.tail()).toMatch(/walls of the room receding into the floor/);
      expect(ambush().every((m) => q.canReach(m.curLoc, { x: 13, y: 7 }))).toBe(true);
      expect(ambush().map((m) => m.getName())).toEqual(expect.arrayContaining(['Ur-Basilisk', 'Eyebeast']));
      for (const m of ambush()) killMonst(q.univ, m, 0, undefined, q.session);
      await q.settle();
      // The door north, locked; the three chests, each trapped.
      await through(q, { x: 13, y: 6 }, 13, 5);
      const taken: string[] = [];
      for (const x of [12, 13, 14]) {
        q.place({ x, y: 2 });
        const found = (await q.session.adjTownLook({ x, y: 1 })) ?? [];
        for (const it of found) q.session.takeItem(it, 0);
        taken.push(...found.map((it) => it.fullName));
      }
      expect(q.log.filter((l) => /likely to have a trap of some sort/.test(l)).length, q.tail()).toBe(3);
      expect(taken, q.tail()).toEqual(['Black Halberd', 'Wand of Rats', 'Wand of Vorb', 'Mandrake Root', 'Scale Necklace', 'Firestone']);
      const halberd = q.party.pcs[0]!.items.find((it) => it.fullName === 'Black Halberd')!;
      expect([halberd.name, halberd.ident, halberd.bonus, halberd.itemLevel]).toEqual(['Halberd', false, 5, 20]);
      // And back the way the party came, to the stairs up at (19,37).
      expect(q.canReach(q.at, { x: 19, y: 37 })).toBe(true);
      await q.step(19, 37);
      expect([q.townNum, q.at], q.tail()).toEqual([CAVE, { x: 24, y: 23 }]);
    });
  });

  describe('the Knowledge Brew', () => {
    /**
     * Foxfire, the bard who wanders Malloc, Bengaro and Poulsbo, sells a
     * silver key to a cult on the southernmost Remote Isle; from Storm Port
     * by ferry to Gebra, and over the isles to the Monastery of Madness,
     * whose library holds the recipe. Walkthrough A's "The Recipe for
     * Knowledge Brew" and B's "Knowledge Brew Sakai".
     */
    const MONASTERY = 78, MONASTERY2 = 79, STORM_PORT = 143, GEBRA = 145;
    /** Special item 16, the silver key (party+0x2c). */
    const SILVER_KEY = 16;
    const veterans = (q: QuestRunner): void => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
    };
    const P = (q: QuestRunner, x: number, y: number): number => q.town.record.terrain[x]![y]!;
    const { N, NE, E, SE, S, SW, W, NW } = Direction;

    it("Lorelei's rumours lead to Foxfire, whose silver key for 500 gold puts the Monastery of Madness on the map", async () => {
      // (A second runner resets the shared scenario's towns, so side checks come first.)
      // Foxfire never comes to Dorngas if the Barrier Cavern fell before day 200.
      {
        const r = new QuestRunner(scen);
        r.party.keyTimes.set(e3Event(2), 150);
        r.party.age = 200 * 3700;
        await r.enter(156);
        expect(r.creatures(291).length, 'the war ended on day 150').toBe(0);
      }
      const q = new QuestRunner(scen);
      q.party.gold = 2000;
      // Walkthrough B: the innkeeper's rumour (50 gold), the junk dealer, and
      // Internal Affairs, each naming the next.
      await q.enter(12);
      const [rumo, inn] = await q.talk(287, 'rumo', 'reci');
      expect(rumo).toMatch(/slipped my mind/);
      expect(inn).toMatch(/Randall, the item salesman/);
      expect(q.party.gold).toBe(1950);
      const [junk] = await q.talk(283, 'reci');
      expect(junk).toMatch(/Lyle, at Internal Affairs/);
      const [lyle] = await q.talk(279, 'reci');
      expect(lyle).toMatch(/Foxfire mentioned it.*bard/);

      // Foxfire is in Bengaro on days that leave 1 over a multiple of three
      // (time flag 4), Poulsbo on the next (5), Malloc on the third (3).
      const where: [number, number][] = [[150, 0], [152, 3700], [154, 7400]];
      for (const [t, age] of where) {
        q.party.age = age;
        for (const [u] of where) {
          await q.enter(u);
          expect(q.creatures(291).length, `town ${u}, age ${age}`).toBe(u === t ? 1 : 0);
        }
      }
      // From day 200 she is in Dorngas (156) as well, every day (walkthrough
      // A: "when those towns are destroyed, I believe that she moves to
      // Dorngas"), unless the Barrier Cavern's crystal (E3's event 2) was
      // smashed first (checked first, on a runner of its own).
      for (const day of [200, 201, 220]) {
        q.party.age = (day - 1) * 3700;
        await q.enter(156);
        expect(q.creatures(291).length, `day ${day}`).toBe(1);
      }
      q.party.age = 7400;
      await q.enter(154);
      // B's order: "coin" (a gold each), "recipe", "gift", "payment".
      const before = q.party.gold;
      const [coin, reci, gift] = await q.talk(291, 'coin', 'reci', 'gift');
      expect(coin).toMatch(/utters a prayer/);
      expect(q.party.gold).toBe(before - 1);
      expect(reci).toMatch(/Someone gave me a gift/);
      expect(gift).toMatch(/key to a cult.*For 500 gold/);
      expect(scen.towns[MONASTERY]!.canFind).toBe(false);
      q.party.gold = 499;
      const [no] = await q.talk(291, 'paym');
      expect(no).toMatch(/don't have the 500 gold/);
      expect(q.party.specItems.has(SILVER_KEY)).toBe(false);
      q.party.gold = 600;
      const [yes] = await q.talk(291, 'paym');
      expect(yes).toMatch(/small silver key.*southernmost of the Remote Isles/);
      expect(q.party.gold).toBe(100);
      expect(q.party.specItems.has(SILVER_KEY)).toBe(true);
      // Once.
      q.party.gold = 600;
      const [again] = await q.talk(291, 'paym');
      expect(again).toMatch(/already have it/);
      expect(q.party.gold).toBe(600);
      // E3's turn code shows the monastery while the key is held
      // (`10c0:69ff`); a turn later it's on the map.
      await q.pause();
      expect(scen.towns[MONASTERY]!.canFind).toBe(true);
      expect(scen.towns[MONASTERY2]!.canFind).toBe(false);
    });

    it("Storm Port: Laika's tickets, the ferry to Gebra and back, and over the isles to the Monastery", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      q.party.gold = 1000;
      await q.enter(STORM_PORT);
      // The south dock's end (spot 4) wants a ticket, from Laika (12 gold).
      q.place({ x: 24, y: 42 });
      expect(await q.go(S)).toEqual([false]);
      expect(q.tail(1)).toMatch(/speak to Laika/);
      expect([q.townNum, q.at]).toEqual([STORM_PORT, { x: 24, y: 42 }]);
      const [tick] = await q.talk(225, 'tick');
      expect(tick).toMatch(/hands you your tickets/);
      expect(q.party.gold).toBe(988);
      const age = q.party.age;
      q.place({ x: 24, y: 42 });
      await q.go(S);
      expect(q.tail(1)).toMatch(/sail around Gorst Island/);
      expect([q.townNum, q.at]).toEqual([GEBRA, { x: 24, y: 8 }]);
      expect(q.party.age - age).toBeGreaterThanOrEqual(400);
      // The ticket is spent; the way back (spot 5) is free.
      expect(q.flag(0x623)).toBe(0);
      q.place({ x: 24, y: 7 });
      await q.go(N);
      expect([q.townNum, q.at], q.tail()).toEqual([STORM_PORT, { x: 24, y: 40 }]);
      q.place({ x: 24, y: 42 });
      await q.go(S);
      expect([q.townNum, q.at], 'no ticket').toEqual([STORM_PORT, { x: 24, y: 42 }]);
      await q.talk(225, 'tick');
      q.place({ x: 24, y: 42 });
      await q.go(S);
      expect(q.townNum).toBe(GEBRA);

      // B's side trip: south through the false hedge at (34,35) (spot 50),
      // the monks' door at (38,42), six Mad Monks, and their chest's ravings.
      q.place({ x: 34, y: 34 });
      expect(await q.go(S, S)).toEqual([true, true]);
      expect(q.at).toEqual({ x: 34, y: 36 });
      const monks = () => q.creatures(/Mad Monk/).filter((m) => m.isAlive);
      expect(monks().length).toBe(0);
      q.place({ x: 38, y: 43 });
      await q.go(N);
      expect(q.tail(1)).toMatch(/they emit high shrieks and charge/);
      expect(monks().length).toBe(6);
      await q.kill(/Mad Monk/);
      q.place({ x: 37, y: 41 });
      await q.look(36, 41);
      expect(q.tail(1)).toMatch(/Feisty Slap of Pain/);

      // Out of Gebra's south side, beside its entrance at (303,436).
      q.place({ x: 24, y: 46 });
      await q.go(S, S);
      expect([q.session.isOutdoors, q.global]).toEqual([true, { x: 303, y: 438 }]);
      // The isles are apart: Gebra's isle, the next, the third, and the
      // monastery's (B's "306,440", "312,451", "308,464 … east across the
      // stones", "331,464"). Each crossing is the boat people's, or the stones.
      const dry = (t: number) => scen.terTypes[t]!.blockage <= TerObstruct.BLOCK_SIGHT;
      const stones = new Set(['309,464', '311,463', '313,465', '315,463', '317,464']);
      expect(outdoorPath([303, 438], [312, 451], dry), 'Gebra to the second ferry').toBe(-1);
      expect(outdoorPath([311, 443], [301, 453], dry), 'past the second ferry').toBe(-1);
      expect(outdoorPath([301, 453], [331, 464], dry, stones), 'without the stones').toBe(-1);
      expect(outdoorPath([303, 438], [306, 439], dry)).toBeGreaterThan(0);
      q.party.gold = 15;
      await q.outdoorsAt(306, 439);
      await q.go(S);
      expect(q.global, q.tail()).toEqual({ x: 311, y: 443 });
      expect(q.party.gold).toBe(5);
      // Back the same way (spot 15) and over again; then the next isle's boat.
      await q.outdoorsAt(310, 442);
      await q.go(S);
      expect(q.global, q.tail()).toEqual({ x: 305, y: 440 });
      q.party.gold = 100;
      await q.outdoorsAt(306, 439);
      await q.go(S);
      expect(outdoorPath([311, 443], [312, 450], dry)).toBeGreaterThan(0);
      await q.outdoorsAt(312, 450);
      await q.go(S);
      expect(q.global, q.tail()).toEqual({ x: 301, y: 453 });
      await q.outdoorsAt(301, 451);
      await q.go(S);
      expect(q.global, 'and back').toEqual({ x: 313, y: 451 });
      await q.outdoorsAt(312, 450);
      await q.go(S);
      // The monks on the third isle (B's "304,458").
      expect(outdoorPath([301, 453], [301, 461], dry)).toBeGreaterThan(0);
      await q.outdoorsAt(301, 461);
      await q.go(S);
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      expect(q.session.isOutdoors).toBe(true);
      // The stones, walked.
      expect(outdoorPath([301, 453], [308, 464], dry)).toBeGreaterThan(0);
      await q.outdoorsAt(308, 464);
      expect(await q.go(E, E, NE, SE, SE, NE, NE, SE, E, E), q.tail()).toEqual(Array(10).fill(true));
      expect(q.global).toEqual({ x: 318, y: 464 });
      expect(outdoorPath([318, 464], [331, 464], dry)).toBeGreaterThan(0);

      // The monastery (331,463): hidden, and shut, without the key.
      expect(scen.towns[MONASTERY]!.canFind).toBe(false);
      await q.outdoorsAt(331, 464);
      await q.go(N);
      expect(q.session.isOutdoors, q.tail()).toBe(true);
      q.party.specItems.add(SILVER_KEY);
      await q.outdoorsAt(331, 464);
      // A turn passes (and wanderers may find the party: fight them off).
      await q.pause();
      if (q.session.mode === GameMode.COMBAT) expect(await q.fightOutdoors()).toBe(true);
      expect(scen.towns[MONASTERY]!.canFind).toBe(true);
      await q.outdoorsAt(331, 464);
      await q.go(N);
      expect([q.townNum, q.at], q.tail()).toEqual([MONASTERY, { x: 24, y: 43 }]);
    });
    it('The Monastery, level 1: the alarm, the stairs in the north-east corner, and its side rooms', async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(MONASTERY, { x: 24, y: 43 });
      // North into the cross-corridor: the alarm (spot 2), and every monk comes.
      q.place({ x: 24, y: 36 });
      await q.go(N);
      expect(q.tail(1)).toMatch(/Someone shouts an alarm/);
      expect(q.town.monsters.filter((m) => m.isAlive && !m.isFriendly).length).toBeGreaterThan(20);
      await q.clearHostiles();
      // Walkthrough A: north, east, and the little door in the north-east
      // corner to the stairs (spot 15) up to level 2, at (29,5).
      expect(q.canReach({ x: 24, y: 43 }, { x: 37, y: 6 })).toBe(true);
      await q.step(37, 5);
      expect([q.townNum, q.at], q.tail()).toEqual([MONASTERY2, { x: 29, y: 5 }]);
      // And back (level 2's spot 15), beside them; the west stairs (spot 14)
      // go up to the Hall of Duels' side.
      await q.step(29, 4);
      expect([q.townNum, q.at], q.tail()).toEqual([MONASTERY, { x: 37, y: 6 }]);
      expect(q.canReach(q.at, { x: 12, y: 6 })).toBe(true);
      await q.step(12, 5);
      expect([q.townNum, q.at], q.tail()).toEqual([MONASTERY2, { x: 18, y: 5 }]);
    });

    it("The Monastery, level 1: B's rooms (the books, the dark altar) and the hidden switches to the breastplate", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(MONASTERY, { x: 24, y: 43 });
      await q.clearHostiles();
      // The Room of Learning from Books on Pedestals: six books, three titles
      // twice over, and only words (B's "read books 1, 5 and 6" do nothing more).
      const titles: string[] = [];
      for (let x = 16; x <= 21; x++) {
        q.place({ x, y: 37 });
        await q.go(S);
        titles.push(q.tail(1).match(/titled "([^"]+)"/)?.[1] ?? '?');
      }
      const three = ['Being Master of the Kung-Fu of Holding of Breath.', 'Mighty Screw Kung Fu.',
        "When the Strings Can't Show - A Flying Tutorial, by Leslie Cheung."];
      expect(titles, q.tail(8)).toEqual([...three, ...three]);
      // The dark altar (spot 16): each prayer costs 20 experience.
      q.party.pcs.forEach((pc) => { pc.experience = 1000; });
      q.place({ x: 24, y: 7 });
      await q.go(N);
      expect(q.party.pcs.map((pc) => pc.experience), q.tail()).toEqual(Array(6).fill(980));
      q.answer(/Leave/);
      q.place({ x: 24, y: 7 });
      await q.go(N);
      expect(q.party.pcs[0]!.experience).toBe(980);

      // The martial arts books (spot 1, a bookshelf at (21,27)): untranslatable
      // under 15 Mage Lore between the party; then a point of dexterity each
      // (none past 19), once.
      q.party.pcs.forEach((pc) => { pc.skills[Skill.MAGE_LORE] = 2; });
      q.party.pcs[1]!.skills[Skill.DEXTERITY] = 19;
      const dex = () => q.party.pcs.map((pc) => pc.skills[Skill.DEXTERITY]);
      const before = dex();
      await q.look(21, 27);
      expect(q.tail(1)).toMatch(/unable to translate/);
      expect(dex()).toEqual(before);
      q.party.pcs[0]!.skills[Skill.MAGE_LORE] = 5;
      await q.look(21, 27);
      expect(dex(), q.tail(2)).toEqual(before.map((d) => Math.min(19, d! + 1)));
      await q.look(21, 27);
      expect(dex()).toEqual(before.map((d) => Math.min(19, d! + 1)));
      // B's Room of Intriguing Surprises: each of the three chests at
      // (38,36)–(38,38) springs a monster, once.
      for (const y of [36, 37, 38]) {
        q.place({ x: 37, y });
        await q.look(38, y);
        expect(q.tail(1), `chest ${y}`).toMatch(/.+/);
        const sprung = q.town.monsters.filter((m) => m.isAlive && !m.isFriendly);
        expect(sprung.length, `chest ${y}: ${q.tail(2)}`).toBeGreaterThan(0);
        await q.clearHostiles();
        await q.look(38, y);
        expect(q.town.monsters.filter((m) => m.isAlive && !m.isFriendly).length, `chest ${y} again`).toBe(0);
      }

      // The pool at (24,21), ringed by statues, until three hidden switches
      // click in turn: (7,42) opens (29,5), whose (29,4) opens (7,5), whose
      // (6,5) opens (24,20).
      expect(P(q, 24, 20)).not.toBe(2);
      expect(q.canReach(q.at, { x: 24, y: 21 })).toBe(false);
      expect(q.canReach(q.at, { x: 29, y: 4 })).toBe(false);
      await q.step(7, 42);
      expect(q.univ.transcript).toContain('Click.');
      expect(q.canReach(q.at, { x: 29, y: 4 })).toBe(true);
      expect(q.canReach(q.at, { x: 6, y: 5 })).toBe(false);
      await q.step(29, 4);
      expect(q.canReach(q.at, { x: 6, y: 5 })).toBe(true);
      await q.step(6, 5);
      expect(P(q, 24, 20)).toBe(2);
      expect(q.canReach(q.at, { x: 24, y: 21 })).toBe(true);
      q.place({ x: 24, y: 20 });
      await q.look(24, 21);
      expect(q.hasItem(/Magic Breastplate/), q.tail()).toBe(true);
    });
    it("The Monastery, level 2: east-wall corridors to the library, and the recipe in its south-east bookcase", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(MONASTERY2, { x: 29, y: 5 });
      await q.clearHostiles();
      // B: "follow the path along the east wall" to the library (5,15), its
      // door on the north side, by the Hall of Duels.
      expect(q.canReach(q.at, { x: 5, y: 14 })).toBe(true);
      q.place({ x: 5, y: 14 });
      await q.walk(5, 15);
      expect(q.at, q.tail()).toEqual({ x: 5, y: 15 });
      // Every bookshelf searched; only the south-east one, at (10,20), has it.
      expect(q.party.alchemy[16]).toBe(false);
      const shelves: [number, number][] = [];
      for (let x = 4; x <= 10; x++) for (const y of [16, 20]) if (P(q, x, y) === 164) shelves.push([x, y]);
      expect(shelves.length).toBeGreaterThan(8);
      for (const [x, y] of shelves.filter(([x, y]) => x !== 10 || y !== 20)) {
        q.place({ x, y: y === 16 ? 17 : 19 });
        await q.look(x, y);
      }
      expect(q.party.alchemy[16]).toBe(false);
      q.place({ x: 10, y: 19 });
      const said = q.log.length;
      await q.look(10, 20);
      expect(q.log.slice(said).join('\n')).toMatch(/.+/);
      expect(q.party.alchemy[16], q.tail()).toBe(true);
      expect(alchemyName(Alchemy.KNOWLEDGE)).toMatch(/Knowledge Brew/);
    });
    it("The Monastery, level 2: B's Sacred Hall of Duels, one champion, the mat, the chests, and the Quicksilver Band", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(MONASTERY2, { x: 29, y: 5 });
      await q.clearHostiles();
      expect(q.canReach(q.at, { x: 5, y: 10 })).toBe(true);
      // The way back out (spot 2) is shut until the duel is won.
      q.place({ x: 5, y: 10 });
      await q.go(E);
      expect(q.tail(2)).toMatch(/Only one champion may enter/);
      expect(q.at).toEqual({ x: 10, y: 10 });
      expect(q.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE).length).toBe(1);
      q.place({ x: 8, y: 10 });
      await q.go(W);
      expect(q.tail(1)).toMatch(/You may not leave until you prove your martial art/);
      expect(q.at).toEqual({ x: 8, y: 10 });
      // The mat on the left (spot 3): three monks appear over the other pads,
      // and the wall at (17,10) becomes a door.
      const foes = () => q.town.monsters.filter((m) => m.isAlive && !m.isFriendly);
      expect(P(q, 17, 10)).toBe(106);
      q.place({ x: 11, y: 9 });
      await q.go(N);
      expect(q.tail(1)).toMatch(/three warriors, ready to battle you/);
      expect(foes().map((m) => m.getName())).toEqual(['Mad Monk', 'Mad Monk', 'Mad Monk']);
      expect(P(q, 17, 10)).toBe(103);
      await q.kill(/Mad Monk/);
      // Behind it, the chests (B's 2500 gold, Steel Greathelm, Magic Hammer
      // and Weak Invulnerability Potion); the second chest opened springs a
      // surprise (spot 4's flag is the three chests'), B's Ur-Basilisk.
      expect(q.canReach(q.at, { x: 18, y: 9 })).toBe(true);
      const gold = q.party.gold;
      const taken: string[] = [];
      let sprung = 0;
      for (const x of [18, 19, 20]) {
        q.place({ x, y: 9 });
        const found = (await q.session.adjTownLook({ x, y: 8 })) ?? [];
        for (const it of found) q.session.takeItem(it, 0);
        taken.push(...found.map((it) => it.fullName));
        sprung += foes().length;
        await q.clearHostiles();
      }
      expect(taken).toEqual(['Gold', 'Magic Hammer', 'Steel Greathelm', 'Weak Invuln. P.']);
      expect(q.party.gold - gold).toBe(2500);
      expect(sprung).toBe(1);
      expect(q.log.filter((l) => /in addition to treasure, a surprise/.test(l)).length).toBe(1);
      // B's Quicksilver Band, where the monks stood, at (10,5).
      expect(q.canReach(q.at, { x: 10, y: 6 })).toBe(true);
      q.place({ x: 10, y: 6 });
      const band = q.session.reachableItems({ x: 10, y: 6 }).items.filter((it) => it.itemLoc.x === 10 && it.itemLoc.y === 5);
      expect(band.map((it) => it.fullName)).toEqual(['Quicksilver Band']);
      // Won: the way out reunites the party where it split.
      q.place({ x: 8, y: 10 });
      await q.go(W);
      expect(q.party.pcs.every((pc) => pc.mainStatus === MainStatus.ALIVE), q.tail()).toBe(true);
      expect(q.at, q.tail()).toEqual({ x: 5, y: 10 });
    });
    it("The way home: the monastery's survivors wait for a party with the recipe; then the brew, and Silverlocke's", async () => {
      // Without the recipe, the square by the shore (zone 87's spot 3) is quiet.
      {
        const r = new QuestRunner(scen);
        await r.outdoorsAt(324, 464);
        await r.go(S);
        expect(r.session.mode, r.tail()).not.toBe(GameMode.COMBAT);
        expect(r.global).toEqual({ x: 324, y: 465 });
      }
      const q = new QuestRunner(scen);
      veterans(q);
      q.party.alchemy[Alchemy.KNOWLEDGE] = true;
      // B: "on your way back, … about thirty Mad Monks". Once.
      await q.outdoorsAt(324, 464);
      await q.go(S);
      expect(q.tail(1)).toMatch(/monks that survived your assault on their monastery/);
      // The group is set down a step or two off, and comes on.
      for (let k = 0; k < 20 && q.session.mode !== GameMode.COMBAT; k++) await q.pause();
      expect(q.session.mode, q.tail()).toBe(GameMode.COMBAT);
      expect(q.town.monsters.filter((m) => m.isAlive && !m.isFriendly).every((m) => m.getName() === 'Mad Monk')).toBe(true);
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      await q.outdoorsAt(324, 464);
      await q.go(S);
      expect(q.session.mode).not.toBe(GameMode.COMBAT);
      expect(await q.fightOutdoors()).toBe(false);
      // The stones, west, back to the third isle.
      await q.outdoorsAt(318, 464);
      expect(await q.go(W, W, NW, SW, SW, NW, NW, SW, W, W)).toEqual(Array(10).fill(true));
      expect(q.global).toEqual({ x: 308, y: 464 });

      // Brewing: Mandrake Root and Ember Flowers, at Alchemy 19 (E3's
      // difficulty for it, `DS:3148`'s 217, the Brew of Knowledge).
      // (A spellcaster: the fighters are too magically inept to drink it.)
      const who = q.party.pcs.findIndex((p) => p.skills[Skill.MAGE_SPELLS]! > 0);
      const pc = q.party.pcs[who]!;
      for (const it of pc.items) it.variety = 0;
      const root = scen.scenItems.findIndex((it) => it.fullName === 'Mandrake Root');
      const ember = scen.scenItems.findIndex((it) => it.fullName === 'Ember Flowers');
      giveItem(pc, q.party, { ...scen.scenItems[root]!, ident: true });
      giveItem(pc, q.party, { ...scen.scenItems[ember]!, ident: true });
      pc.skills[Skill.ALCHEMY] = 18;
      expect(alchemyChoices(q.univ, who).find((c) => c.which === Alchemy.KNOWLEDGE)?.canMake).toBe(false);
      pc.skills[Skill.ALCHEMY] = 28;
      expect(alchemyChoices(q.univ, who).find((c) => c.which === Alchemy.KNOWLEDGE)?.canMake).toBe(true);
      makePotion(q.session, who, Alchemy.KNOWLEDGE);
      expect(q.univ.transcript.at(-1)).toBe('Alchemy: Successful.');
      const slot = pc.items.findIndex((it) => it.variety !== 0 && it.fullName === 'Brew of Knowledge');
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(pc.items[slot]!.charges, 'nine over: one more dose').toBe(2);
      // Drunk: two skill points.
      const pts = pc.skillPts;
      await useItem(q.session, who, slot, q.session.host ?? undefined);
      await q.settle();
      expect(pc.skillPts - pts, q.univ.transcript.slice(-2).join(' / ')).toBe(2);

      // Silverlocke's Potions (zone 80's spot 11, walkthrough B) sells it ready made.
      await q.outdoorsAt(388, 407);
      await q.go(S);
      const shop = q.session.shop;
      expect(shop?.name, q.tail()).toBe("Silverlocke's Potions");
      const brew = shop!.visible.map((i) => shop!.shop.getItem(i)).find((e) => e.item?.fullName === 'Brew of Knowledge');
      expect(brew, 'on sale').toBeDefined();
      expect(shop!.cost(brew!), "B's 2600 gold").toBe(2600);
      q.session.endShopMode();
    });
  });

  describe('the Ring of Endless Magery', () => {
    /**
     * A wizard with no name, in Krizsan or Delan, sells the ring's place:
     * the Tower of Zkal, at the south end of the undead island below Gale,
     * reached in the Nephil sailor's skiff. Walkthrough A's "The Ring of
     * Endless Magery" and B's "Ring of Endless Magery Ishinabe".
     */
    const ZKAL = 70, ZKAL2 = 71, GALE = 16, EXECA = 164, DELAN = 120;
    /** The Strange Wizard (personality 90), and Mrrurr the Nephil sailor (338). */
    const WIZARD = 90, MRRURR = 338;
    const P = (q: QuestRunner, x: number, y: number): number => q.town.record.terrain[x]![y]!;
    const veterans = (q: QuestRunner): void => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
    };
    const { N, S, SW, W, NW } = Direction;

    it('The wizard with no name: Krizsan or Delan on alternate days, and 2500 gold for the Tower of Zkal', async () => {
      // (A second runner resets the shared scenario's towns, so side checks come first.)
      // In Delan, walkthrough A's other place for him, the same sale.
      {
        const r = new QuestRunner(scen);
        r.party.age = 3700;
        r.party.gold = 2500;
        await r.enter(DELAN);
        expect(r.creatures(WIZARD).map((m) => m.curLoc)).toEqual([{ x: 9, y: 30 }]);
        const [yes] = await r.talk(WIZARD, 'loca');
        expect(yes).toMatch(/Tower of Zkal/);
        expect([r.party.gold, scen.towns[ZKAL]!.canFind]).toEqual([0, true]);
      }
      const q = new QuestRunner(scen);
      veterans(q);
      expect(scen.towns[ZKAL]!.canFind).toBe(false);
      // He sits in Krizsan's north-east corner (56,15) on days that leave 1
      // over a multiple of three (time flag 4), in Delan (9,30) on the next
      // (5), and nowhere on the third.
      for (const [age, krizsan, delan] of [[0, 1, 0], [3700, 0, 1], [7400, 0, 0]] as const) {
        q.party.age = age;
        await q.enter(DELAN);
        expect(q.creatures(WIZARD).length, `Delan, age ${age}`).toBe(delan);
        await q.enter(0);
        expect(q.creatures(WIZARD).length, `Krizsan, age ${age}`).toBe(krizsan);
      }
      q.party.age = 0;
      await q.enter(0);
      expect(q.creatures(WIZARD)[0]!.curLoc).toEqual({ x: 56, y: 15 });
      // Walkthrough B: "unlock the door at 54,18" (Unlock, until it works).
      expect(scen.terTypes[P(q, 54, 18)]!.special).toBe(TerSpec.UNLOCKABLE);
      q.place({ x: 53, y: 18 });
      for (let k = 0; k < 20 && scen.terTypes[P(q, 54, 18)]!.special === TerSpec.UNLOCKABLE; k++) await q.spell(Spell.UNLOCK, 54, 18);
      expect(scen.terTypes[P(q, 54, 18)]!.special, q.univ.transcript.slice(-3).join(' / ')).not.toBe(TerSpec.UNLOCKABLE);
      expect(q.canReach({ x: 53, y: 18 }, { x: 56, y: 16 })).toBe(true);

      // Before he's paid, the tower is hidden, and the party walks over it.
      await q.outdoorsAt(296, 271);
      await q.go(W);
      expect([q.session.isOutdoors, q.global]).toEqual([true, { x: 295, y: 271 }]);

      await q.enter(0);
      const [magi, dedi] = await q.talk(WIZARD, 'magi', 'dedi');
      expect(magi).toMatch(/location of the long lost Ring of Endless Magery/);
      expect(dedi).toMatch(/2500 gold is the going rate/);
      q.party.gold = 2499;
      const [no] = await q.talk(WIZARD, 'loca');
      expect(no).toMatch(/insufficient dedication/);
      expect([q.party.gold, scen.towns[ZKAL]!.canFind]).toEqual([2499, false]);
      q.party.gold = 3000;
      const [yes, where] = await q.talk(WIZARD, 'ring', 'zkal');
      expect(yes).toMatch(/Tower of Zkal.*southern end of the island south of the city of Gale/);
      expect(where).toMatch(/Gale is at the northeast end of Valorim/);
      expect([q.party.gold, scen.towns[ZKAL]!.canFind, scen.towns[ZKAL2]!.canFind]).toEqual([500, true, false]);
      // Now the tower can be entered, from the east (43,24).
      await q.outdoorsAt(296, 271);
      await q.go(W);
      expect([q.townNum, q.at], q.tail()).toEqual([ZKAL, { x: 43, y: 24 }]);
    });

    it("Gale: Ernest's portal to the gates, Mrrurr's skiff for 100 gold, to the undead island and back", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      // Walkthrough B's shortcut: Ernest's portal to Gale (250 gold, spot
      // 18) comes out at (32,4), north of the shut gates, not inside.
      q.party.gold = 1000;
      await q.enter(85);
      const [paid] = await q.talk(74, 'purc');
      expect(paid).toMatch(/portals are around here somewhere/);
      const [px, py] = spot(85, 18);
      q.place({ x: px, y: py + 1 });
      await q.go(N);
      expect([q.townNum, q.at], q.tail()).toEqual([GALE, { x: 32, y: 4 }]);
      const sailor = q.creatures(MRRURR)[0]!.curLoc;
      expect(sailor).toEqual({ x: 45, y: 47 });
      expect(q.canReach(q.at, sailor), 'the walls').toBe(false);
      // In by Pasi's tunnel, once the slimes are beaten (as for Pachtar's Plate).
      q.setFlag(0xc85, 1);
      await q.talk(/Pasi/, 'assi');
      await q.step(55, 8);
      expect(q.at, q.tail()).toEqual({ x: 52, y: 14 });
      expect(q.canReach(q.at, sailor)).toBe(true);

      // The skiff at the central dock's end (spot 24) is his, and the sailors watch.
      const dock = { x: 36, y: 55 };
      expect(q.canReach(sailor, dock)).toBe(true);
      q.place(dock);
      await q.go(S);
      expect(q.tail(1)).toMatch(/you'll have to find its owner/);
      expect([q.townNum, q.at], 'onto the end, and no further').toEqual([GALE, { x: 36, y: 56 }]);
      // Mrrurr's "skiff", "worthless", then "purchase": 100 gold.
      q.party.gold = 99;
      const [skif, wort, poor] = await q.talk(MRRURR, 'skif', 'wort', 'purc');
      expect(skif).toMatch(/could only get to the island to the south/);
      expect(wort).toMatch(/purchase the skiff for only 100 gold/);
      expect(poor).toMatch(/haven't the gold/);
      expect([q.party.gold, q.flag(0x12c)]).toEqual([99, 0]);
      q.party.gold = 150;
      const [sold] = await q.talk(MRRURR, 'purc');
      expect(sold).toMatch(/end of the central dock/);
      expect([q.party.gold, q.flag(0x12c)]).toEqual([50, 1]);
      // Row across: Execa's crumbling dock, on the island.
      q.place(dock);
      await q.go(S);
      expect(q.tail(1)).toMatch(/crumbling dock in a small, ruined town/);
      expect([q.townNum, q.at]).toEqual([EXECA, { x: 24, y: 6 }]);
      // And back from the dock's end (spot 11), half a day's rowing.
      const age = q.party.age;
      q.place({ x: 24, y: 6 });
      await q.go(N);
      expect(q.tail(1)).toMatch(/row away from the destroyed island/);
      expect([q.townNum, q.at]).toEqual([GALE, dock]);
      expect(q.party.age - age).toBe(500);
      // Over again, and out of Execa's south side onto the island at (314,162).
      q.place(dock);
      await q.go(S);
      for (let k = 0; k < 40 && !q.session.isOutdoors; k++) await q.go(S);
      expect(q.global, q.tail()).toEqual({ x: 314, y: 162 });
      expect(q.tail(1)).toMatch(/If you ever want to return to the mainland, go to the end of this dock/);
      // The island's only way off is the skiff: no dry way from Gale's road,
      // and a dry way south to the tower (295,271) at its far end.
      const dry = (t: number) => scen.terTypes[t]!.blockage <= TerObstruct.BLOCK_SIGHT;
      expect(outdoorPath([311, 152], [314, 163], dry), 'from the mainland').toBe(-1);
      expect(outdoorPath([314, 162], [295, 271], dry)).toBeGreaterThan(100);
    });

    it("The undead island: the cairns' Force Barrier and Firestorm, the spire's skeletons, Vila's herbs, and the vampires at the tower", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      const foes = () => q.town.monsters.filter((m) => m.isAlive && !m.isFriendly).map((m) => m.getName());
      const fight = async (): Promise<void> => {
        for (let k = 0; k < 20 && q.session.mode !== GameMode.COMBAT; k++) await q.pause();
        expect(q.session.mode, q.log.slice(-3).map((l) => l.slice(-60)).join("\n") + q.univ.transcript.slice(-8).join(" / ")).toBe(GameMode.COMBAT);
      };
      // Zone 42's cairns (B's "309,225"), in a pocket of the woods entered
      // from the north-east: the undead wait to be attacked; leave them and
      // nothing happens.
      await q.outdoorsAt(310, 224);
      q.answer('Leave');
      await q.go(SW);
      expect(q.tail(1)).toMatch(/watch you cunningly, waiting for you to make the first move/);
      expect(q.session.mode).toBe(GameMode.OUTDOORS);
      await q.outdoorsAt(310, 224);
      q.answer('Attack');
      await q.go(SW);
      await fight();
      expect(foes()).toEqual(expect.arrayContaining(['Wight', 'Spirit', 'Spectre', 'Vampire']));
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
      // Laid to rest, the cairns' loot (750 gold and a Scroll: Firestorm) and
      // the inscription: Force Barrier, for every mage.
      const gold = q.party.gold;
      await q.outdoorsAt(310, 224);
      await q.go(SW);
      expect(q.log.slice(-2).join('\n'), q.tail()).toMatch(/scroll tube inside[\s\S]*You now know the spell Force Barrier/);
      expect(q.party.gold - gold).toBe(750);
      expect(q.hasItem('Scroll: Firestorm')).toBe(true);
      expect(q.party.pcs.every((pc) => pc.mageSpells[Spell.BARRIER_FORCE])).toBe(true);
      // The loot once; the inscription every visit.
      await q.outdoorsAt(310, 224);
      await q.go(SW);
      expect(q.tail(1)).toMatch(/You now know the spell Force Barrier/);
      expect(q.party.gold - gold).toBe(750);
      expect(q.party.pcs.flatMap((pc) => pc.items).filter((it) => it.variety !== 0 && it.fullName === 'Scroll: Firestorm').length).toBe(1);

      // The spire (spot 2, B's "316,201": bring Resurrection): a crowd of
      // Ruby Skeletons (how many is rolled), at once, and once.
      await q.outdoorsAt(315, 201);
      await q.go(S);
      expect(q.tail(1)).toMatch(/stone spire.*Their eye stones glow fiercely/);
      await fight();
      expect(foes().length).toBeGreaterThanOrEqual(10);
      expect(new Set(foes())).toEqual(new Set(['Ruby Skeleton']));
      expect(await q.fightOutdoors()).toBe(true);
      await q.outdoorsAt(315, 201);
      await q.go(S);
      expect(q.session.mode).toBe(GameMode.OUTDOORS);

      // Vila (165, B's "323,187"): shamblers and two basilisks, and Ember
      // Flowers among its herbs.
      await q.outdoorsAt(323, 186);
      await q.go(S);
      expect(q.townNum, q.tail()).toBe(165);
      const herbs = q.town.items.filter((it) => /Ember Flowers|Mandrake Root|Comfrey Root|Skribbane/.test(it.fullName));
      expect(herbs.map((it) => it.fullName).sort()).toEqual(['Comfrey Root', 'Ember Flowers', 'Mandrake Root', 'Skribbane Herb']);
      expect(herbs.every((it) => q.canReach(q.at, it.itemLoc))).toBe(true);
      expect(new Set(q.creatures(/./).map((m) => m.getName()))).toEqual(new Set(['Shambler', 'Basilisk']));

      // The vampires before the tower's door (zone 51's spot 1, B's
      // "296,271"): "the center of the evil affliction".
      await q.outdoorsAt(300, 271);
      await q.go(SW);
      expect(q.tail(1)).toMatch(/center of the evil affliction/);
      await fight();
      expect(foes()).toEqual(expect.arrayContaining(['Quickghast', 'Wight', 'Spirit', 'Vampire']));
      expect(await q.fightOutdoors()).toBe(true);
      await q.outdoorsAt(300, 271);
      await q.go(SW);
      for (let k = 0; k < 5; k++) await q.pause();
      expect(q.session.mode, 'once').toBe(GameMode.OUTDOORS);
    });

    it("Tower of Zkal 1: the drain on spell points, the lever, B's way through the false walls and teleporters, and the stairs down", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      scen.towns[ZKAL]!.canFind = true;
      await q.outdoorsAt(296, 271);
      await q.go(W);
      expect([q.townNum, q.at]).toEqual([ZKAL, { x: 43, y: 24 }]);
      // Through a door (spot 1, either side of the sign): the mausoleum,
      // and its warning.
      expect(await q.go(W, W, W, NW, NW, W)).toEqual([true, true, true, false, true, true]);
      expect(q.at).toEqual({ x: 38, y: 23 });
      expect(q.log.slice(-1)[0], q.tail()).toMatch(/dank, shadowy mausoleum.*magical energy slowly leaking out of your minds/);
      await q.clearHostiles();

      // The drain (E3's per-turn code, `e3SpDrain.ts`): on every fifth turn
      // each PC loses 5 spell points, or what's left of fewer.
      for (const pc of q.party.pcs) { pc.maxSp = 100; pc.curSp = 50; }
      q.party.pcs[1]!.curSp = 5;
      while (q.party.age % 5 !== 0) q.party.age++;
      await q.pause(4);
      expect(q.party.pcs.map((pc) => pc.curSp), 'four turns').toEqual([50, 5, 50, 50, 50, 50]);
      await q.pause(1);
      expect(q.party.pcs.map((pc) => pc.curSp), 'the fifth').toEqual([45, 0, 45, 45, 45, 45]);
      await q.pause(5);
      expect(q.party.pcs.map((pc) => pc.curSp)).toEqual([40, 0, 40, 40, 40, 40]);
      // Not outside, where they come back as usual.
      await q.outdoorsAt(296, 271);
      await q.pause(10);
      expect(q.party.pcs[0]!.curSp).toBeGreaterThanOrEqual(40);
      await q.go(W);
      await q.go(W, W, W, NW, W);
      expect(q.at).toEqual({ x: 38, y: 23 });

      // The way runs north up the east wall to the false wall at (41,1) and
      // the lever (spot 24), which opens the portcullis at (35,1).
      // (Paths keep off the teleporters: `avoidSpots`.)
      const way = (from: [number, number], to: [number, number]): number =>
        q.pathLength({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, { avoidSpots: true });
      expect(way([38, 23], [42, 1])).toBeGreaterThan(0);
      q.place({ x: 42, y: 1 });
      await q.walk(41, 1);
      expect(q.at).toEqual({ x: 41, y: 1 });
      expect(P(q, 35, 1)).toBe(108);
      await q.walk(40, 1);
      expect(q.tail(1)).toMatch(/portcullis opening/);
      expect(P(q, 35, 1)).toBe(109);
      expect(way([36, 1], [32, 1])).toBe(4);

      // B: "go to 36,3 and west through the fake wall. Go to 25,7 and north
      // through the fake wall. Go to 3,1 and south through the next fake
      // wall. After that, take the portal" (spot 19 at (9,10), to (1,45)).
      const legs: [number, number][] = [[42, 1], [36, 3], [34, 3], [25, 7], [25, 5], [3, 1], [3, 3], [9, 10]];
      for (let k = 1; k < legs.length; k++) expect(way(legs[k - 1]!, legs[k]!), `${legs[k - 1]} to ${legs[k]}`).toBeGreaterThan(0);
      for (const [x, y] of [[35, 3], [25, 6], [3, 2]] as const) {
        expect(scen.terTypes[P(q, x, y)]!.special, `(${x},${y}) a false wall`).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
      }
      // There's no way on without it: the stairs (spot 11 at (1,15)) are walled off.
      expect(way([3, 1], [1, 15])).toBe(-1);
      q.place({ x: 9, y: 9 });
      await q.go(S);
      expect(q.tail(1)).toMatch(/fiery red teleporter/);
      expect(q.at).toEqual({ x: 1, y: 45 });
      // B: "kill the enemies there, and dispel the barrier at 9,45."
      // (From (9,44), where it can be seen.)
      expect(q.town.hasField(9, 45, FieldType.BARRIER_FIRE)).toBe(true);
      expect(way([1, 45], [9, 44])).toBeGreaterThan(0);
      q.place({ x: 9, y: 44 });
      for (let k = 0; k < 20 && q.town.hasField(9, 45, FieldType.BARRIER_FIRE); k++) await q.spell(Spell.DISPEL_BARRIER, 9, 45);
      expect(q.town.hasField(9, 45, FieldType.BARRIER_FIRE), q.univ.transcript.slice(-3).join(' / ')).toBe(false);
      // "Go south, then east through the fake wall, kill more monsters, and
      // go north through the fake wall at 14,39. Take the portal there"
      // (spot 22 at (11,38), to (5,22)).
      const legs2: [number, number][] = [[1, 45], [9, 46], [11, 46], [14, 40], [14, 38], [11, 38]];
      for (let k = 1; k < legs2.length; k++) expect(way(legs2[k - 1]!, legs2[k]!), `${legs2[k - 1]} to ${legs2[k]}`).toBeGreaterThan(0);
      for (const [x, y] of [[10, 46], [14, 39]] as const) {
        expect(scen.terTypes[P(q, x, y)]!.special, `(${x},${y}) a false wall`).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
      }
      expect(way([1, 45], [1, 15])).toBe(-1);
      q.place({ x: 12, y: 38 });
      await q.go(W);
      expect(q.at, q.tail()).toEqual({ x: 5, y: 22 });
      // "Go northwest to 3,17 and north through the fake wall. After that,
      // follow the path and take the stairs down": level 2, at (13,2).
      expect(way([5, 22], [3, 17])).toBeGreaterThan(0);
      expect(scen.terTypes[P(q, 3, 16)]!.special).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
      expect(way([3, 15], [1, 14])).toBeGreaterThan(0);
      q.place({ x: 1, y: 14 });
      await q.go(S);
      expect(q.log.at(-1)).toMatch(/stairway down/);
      expect([q.townNum, q.at], q.tail()).toEqual([ZKAL2, { x: 13, y: 2 }]);
      // And the stairs back up (spot 14, (13,1)) to (1,14).
      q.place({ x: 13, y: 2 });
      await q.go(N);
      expect([q.townNum, q.at], q.tail()).toEqual([ZKAL, { x: 1, y: 14 }]);
    });

    it('Tower of Zkal 2: the portal, the four teleporters (east, east, south, east), and the closing walls held off with fire barriers', async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      await q.enter(ZKAL2, { x: 13, y: 2 });
      await q.clearHostiles();
      const way = (from: [number, number], to: [number, number]): number =>
        q.pathLength({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, { avoidSpots: true });
      // B: "Go southeast to 16,32 and north through the fake cave wall. Take
      // the portal there" (spot 11 at (12,31)), to the room of four.
      expect(way([13, 2], [12, 31])).toBeGreaterThan(0);
      q.place({ x: 12, y: 30 });
      await q.go(S);
      expect(q.tail(1)).toMatch(/fiery red teleporter/);
      expect(q.at).toEqual({ x: 42, y: 43 });
      // Four teleporters, north (40,38), east (46,40), south (44,46) and west
      // (38,44), and no way out on foot; a portal back (spot 12, (42,42)).
      const room: [number, number] = [42, 43];
      for (const to of [[34, 45], [32, 42], [13, 2]] as [number, number][]) expect(way(room, to), `${to}`).toBe(-1);
      const pad = { N: [40, 38], E: [46, 40], S: [44, 46], W: [38, 44] } as const;
      for (const p of Object.values(pad)) expect(way(room, p as unknown as [number, number])).toBeGreaterThan(0);
      /** Which of the four markers (40,40), (40,44), (44,40), (44,44) is lit. */
      const lit = () => [[40, 40], [40, 44], [44, 40], [44, 44]].findIndex(([x, y]) => P(q, x!, y!) === 1);
      const take = async (p: keyof typeof pad): Promise<void> => {
        const [x, y] = pad[p];
        q.place({ x: x === 46 ? 45 : x === 38 ? 39 : x, y: y === 38 ? 39 : y === 46 ? 45 : y });
        await q.step(x, y);
      };
      expect(lit()).toBe(0);
      // A wrong turn first: north from the start goes nowhere new.
      await take('N');
      expect(q.tail(1)).toMatch(/in the same place/);
      expect(lit()).toBe(1);
      // Re-entering the level puts the maze back (E3's loader, `zkal2Entry`).
      await q.enter(ZKAL2, { x: 42, y: 43 });
      expect(lit()).toBe(0);
      // Walkthrough A: "the eastern one … the eastern one again … the portal
      // at the south end … back through the portal at the east end. You are
      // out of the room!" (B: northeast, northeast, southeast, northeast.)
      await take('E');
      expect(lit()).toBe(1);
      await take('E');
      expect(lit()).toBe(2);
      await take('S');
      expect(lit()).toBe(3);
      await take('E');
      expect(q.at, q.tail()).toEqual({ x: 34, y: 45 });

      // B: "go northwest to 32,41 (fake wall) and run fast past the
      // descending walls. Run through the Fire Barriers to 31,36 (fake wall)
      // and run through to the west." Behind (32,41) is A's "big room",
      // x 32-37 by y 34-40, whose walls never stop: a row of basalt and a
      // row of adobe, either side of fire barriers along y 37.
      expect(way([34, 45], [32, 42])).toBeGreaterThan(0);
      for (const [x, y] of [[32, 41], [31, 36], [31, 28]] as const) {
        expect(scen.terTypes[P(q, x, y)]!.special, `(${x},${y})`).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
      }
      expect([32, 33, 34, 35, 36, 37].map((x) => [P(q, x, 36), P(q, x, 38)])).toEqual(Array(6).fill([WALL_SOUTH, WALL_NORTH]));
      expect([32, 33, 34, 35, 36, 37].map((x) => q.town.hasField(x, 37, FieldType.BARRIER_FIRE))).toEqual([true, true, true, true, true, false]);
      q.place({ x: 32, y: 42 });
      await q.walk(32, 41);
      expect(q.at).toEqual({ x: 32, y: 41 });
      // The lower walls sweep the room's whole width, y 38 to 40, and a search
      // of the party's moves (`e3Walls.ts`, walking through fire as both
      // walkthroughs do) finds no way past them.
      const c = WallSearch.cellOf;
      const pastWalls = (st: WallState) => st.party === c(31, 36);
      expect(new WallSearch(q, [], new Map(), { throughFire: true }).search(
        new WallSearch(q, [], new Map(), { throughFire: true }).start, pastWalls, 60)).toBeNull();
      // Walkthrough A: "You must use the spell Fire Barrier to cast barriers
      // to block off the moving walls." One from the doorway, at (32,40)
      // as soon as it's clear (the cast takes its turn), holds the walls
      // there off it, and then there is a way.
      while (P(q, 32, 40) !== WALL_FLOOR) await q.pause();
      await q.spell(Spell.BARRIER_FIRE, 32, 40);
      expect(q.town.hasField(32, 40, FieldType.BARRIER_FIRE)).toBe(true);
      await q.pause();
      const ws = new WallSearch(q, [], new Map(), { throughFire: true });
      const run = ws.search(ws.start, pastWalls, 60);
      expect(run, 'a way past the walls').not.toBeNull();
      // The same moves through the engine, the walls checked every turn;
      // the last one walks into the false wall, which opens, and then steps.
      const wallsOf = (): number[] => {
        const out: number[] = [];
        for (let x = 0; x < 48; x++) {
          for (let y = 0; y < 48; y++) {
            const t = P(q, x, y);
            if (t === WALL_NORTH) out.push(c(x, y) * 4 + 1);
            if (t === WALL_SOUTH) out.push(c(x, y) * 4 + 2);
          }
        }
        return out;
      };
      let st = ws.start;
      for (const [i, [dx, dy]] of run!.moves.entries()) {
        const from = { ...q.at };
        if (i === run!.moves.length - 1) { await q.walk(from.x + dx, from.y + dy); break; }
        st = ws.after(st, dx, dy)!;
        if (dx === 0 && dy === 0) await q.pause(); else await q.walk(from.x + dx, from.y + dy);
        expect(q.at, `move ${i} (${dx},${dy}) from ${JSON.stringify(from)}`).toEqual(WallSearch.at(st));
        expect(wallsOf().join(), `walls after move ${i}`).toBe(st.walls.join());
      }
      expect(q.at).toEqual({ x: 31, y: 36 });
      expect(q.party.pcs.every((pc) => pc.isAlive)).toBe(true);

      /** The passage from (30,27) to (30,46): v and ^ the walls, f a fire barrier, @ the party. */
      const passage = (): string => Array.from({ length: 20 }, (_, k) => {
        const y = 27 + k, t = P(q, 30, y);
        if (q.at.x === 30 && q.at.y === y) return '@';
        return t === WALL_SOUTH ? 'v' : t === WALL_NORTH ? '^' : q.town.hasField(30, y, FieldType.BARRIER_FIRE) ? 'f' : t === WALL_FLOOR ? '.' : '#';
      }).join('');
      // West into the long passage at x 30 (spot 5): the trap A calls
      // "extremely evil and hard".
      await q.walk(30, 36);
      expect(q.log.at(-1)).toMatch(/walls are closing in on you/);
      expect(q.at).toEqual({ x: 30, y: 36 });
      expect(P(q, 31, 36), 'the door behind is gone').toBe(100);
      // Walkthrough A: "Cast a Fire Barrier north of you and step on it.
      // When the northern wall collides with the barrier and bounces north,
      // then you should start heading north." (Each cast takes its turn.)
      const cast = async (x: number, y: number): Promise<void> => {
        await q.spell(Spell.BARRIER_FIRE, x, y);
        expect(q.town.hasField(x, y, FieldType.BARRIER_FIRE), q.univ.transcript.slice(-3).join(' / ')).toBe(true);
        await q.pause();
      };
      const turns: string[] = [passage()];
      await cast(30, 35);
      turns.push(passage());
      await q.go(N);
      turns.push(passage());
      const alive = () => q.party.pcs.every((pc) => pc.isAlive);
      // Follow the north wall as it backs off, a square behind it, until it
      // reaches the passage's end at (30,27).
      for (let k = 0; k < 40 && P(q, 30, 27) !== WALL_NORTH; k++) {
        const ahead = P(q, 30, q.at.y - 1);
        if (q.at.y > 29 && ahead === WALL_FLOOR && P(q, 30, q.at.y - 2) !== WALL_SOUTH) await q.go(N); else await q.pause();
        turns.push(passage());
        expect(alive(), turns.join('\n')).toBe(true);
      }
      // "When the moving wall reaches the north end of the hallway, place a
      // fire barrier right next to the door, blocking it from going any
      // further. Then walk through the door."
      expect(q.at, turns.join('\n')).toEqual({ x: 30, y: 29 });
      await cast(30, 28);
      turns.push(passage());
      await q.walk(31, 28);
      expect(q.at, turns.join('\n')).toEqual({ x: 31, y: 28 });
      expect(alive()).toBe(true);
      // The walls go on, held at either end.
      for (let k = 0; k < 10; k++) { await q.pause(); turns.push(passage()); }
      expect(turns.at(-1)!.slice(0, 2), turns.join('\n')).toMatch(/^[v^]f/);
    });

    it("Tower of Zkal 2: the lever room's walls, Zkal, his lever, the Ring of Endless Magery in the trapped chests, and the way home", async () => {
      const q = new QuestRunner(scen);
      veterans(q);
      // From the far side of the closing walls' door (31,28).
      await q.enter(ZKAL2, { x: 32, y: 28 });
      const zkalsRoom = (m: { curLoc: Location }) => m.curLoc.x >= 30 && m.curLoc.x <= 38 && m.curLoc.y >= 1 && m.curLoc.y <= 9;
      expect(q.creatures(/Lich/).map((m) => m.curLoc)).toEqual([{ x: 32, y: 3 }]);
      for (const m of q.town.monsters) if (m.isAlive && !m.isFriendly && !zkalsRoom(m)) killMonst(q.univ, m, 0, undefined, q.session);
      await q.settle();
      const way = (from: [number, number], to: [number, number]): number =>
        q.pathLength({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, { avoidSpots: true });
      // A: "take the eastern fork and go through the open portcullis. In this
      // room with four paths out of it, take the eastern one. Kill the
      // Hraithes and go north through the door": (37,26), (39,23), and the
      // doors at (42,11) and (44,11) into the lever room.
      expect(way([32, 28], [38, 23])).toBeGreaterThan(0);
      expect(way([38, 23], [42, 12])).toBeGreaterThan(0);
      for (const x of [42, 44]) expect(scen.terTypes[P(q, x, 11)]!.special).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
      // Zkal's room is shut: the portcullises at (39,9) and (38,10).
      expect([P(q, 39, 9), P(q, 38, 10)]).toEqual([108, 108]);
      expect(way([42, 12], [33, 4])).toBe(-1);
      q.place({ x: 42, y: 12 });
      await q.walk(42, 11);
      await q.walk(42, 10);
      expect(q.at).toEqual({ x: 42, y: 10 });
      // Halfway up (spot 6, y 6), walls drop in at both ends.
      await q.go(N, N, N);
      await q.go(N);
      expect(q.log.at(-1)).toMatch(/walls appear to the north and south of you/);
      expect(q.at).toEqual({ x: 42, y: 6 });
      // "Start by creating two Fire Barriers--one north of you, one south of
      // you, to give you some space to work." (Each takes its turn.)
      for (const y of [5, 7]) {
        await q.spell(Spell.BARRIER_FIRE, 42, y);
        expect(q.town.hasField(42, y, FieldType.BARRIER_FIRE), q.univ.transcript.slice(-3).join(' / ')).toBe(true);
        await q.pause();
      }
      expect(q.party.pcs.every((pc) => pc.isAlive)).toBe(true);
      // "Now, create barriers that will allow you to access, reach, and
      // return from the lever in the northeast corner. Pull that lever and go
      // through the newly-opened portcullis in the southwest corner": a
      // search of the party's moves (`e3Walls.ts`) finds the way to the lever
      // (spot 17, (46,1)), which opens both portcullises.
      const c = WallSearch.cellOf;
      const wallsOf = (): number[] => {
        const out: number[] = [];
        for (let x = 0; x < 48; x++) {
          for (let y = 0; y < 48; y++) {
            if (P(q, x, y) === WALL_NORTH) out.push(c(x, y) * 4 + 1);
            if (P(q, x, y) === WALL_SOUTH) out.push(c(x, y) * 4 + 2);
          }
        }
        return out;
      };
      const replay = async (ws: WallSearch, moves: [number, number][]): Promise<void> => {
        let st = ws.start;
        for (const [i, [dx, dy]] of moves.entries()) {
          const from = { ...q.at };
          st = ws.after(st, dx, dy)!;
          if (dx === 0 && dy === 0) await q.pause(); else await q.walk(from.x + dx, from.y + dy);
          expect(q.at, `move ${i} (${dx},${dy}) from ${JSON.stringify(from)}\n${q.tail(2)}`).toEqual(WallSearch.at(st));
          expect(wallsOf().join(), `walls after move ${i}`).toBe(st.walls.join());
          expect(q.party.pcs.every((pc) => pc.isAlive)).toBe(true);
        }
      };
      const lever = { at: [46, 1] as [number, number], opens: [[39, 9], [38, 10]] as [number, number][] };
      const ws = new WallSearch(q, [lever], new Map(), { throughFire: true });
      const toLever = ws.search(ws.start, (st) => (st.levers & 1) === 1, 100);
      expect(toLever, 'a way to the lever').not.toBeNull();
      await replay(ws, toLever!.moves);
      expect(q.log.slice(-2).join('\n'), q.tail()).toMatch(/portcullis opening/);
      expect([P(q, 39, 9), P(q, 38, 10)]).toEqual([109, 109]);

      // Zkal, "archmage, lich, and lord of the undead", and his two demons.
      // (The runner's fights are killMonst; his room is cleared here, so its
      // creatures stay out of the walls' search, which leaves them out.)
      expect(q.creatures(/./).filter(zkalsRoom).map((m) => m.getName()).sort())
        .toEqual(['Demon', 'Demon', 'Lich', 'Shambler', 'Shambler', 'Shambler', 'Shambler']);
      const xp = q.party.pcs.map((pc) => pc.experience);
      await q.kill(/Lich/);
      expect(q.tail(1)).toMatch(/deal the death blow to Zkal.*At least you can get Zkal's treasure now/);
      expect(q.party.pcs.every((pc, i) => pc.experience > xp[i]!)).toBe(true);
      expect(q.flag(0x353)).toBe(1);
      await q.clearHostiles();
      // Out of the lever room by the portcullis at (39,9), the walls still going.
      const ws2 = new WallSearch(q, [], new Map(), { throughFire: true });
      const out = ws2.search(ws2.start, (st) => WallSearch.at(st).x <= 38 && WallSearch.at(st).y <= 9, 100);
      expect(out, 'a way into his room').not.toBeNull();
      await replay(ws2, out!.moves);

      // "Walk around the chasm to where Zkal's throne was. Pull the lever you
      // see" (spot 15, (30,1)): the chamber's portcullis at (35,23).
      expect(way([q.at.x, q.at.y], [31, 1])).toBeGreaterThan(0);
      expect(P(q, 35, 23)).toBe(108);
      q.place({ x: 31, y: 1 });
      await q.walk(30, 1);
      expect(q.tail(1)).toMatch(/portcullis opening/);
      expect(P(q, 35, 23)).toBe(109);
      // "Go through the southern portcullis and walk south through the
      // laboratory. In the four portcullis room, go through the newly-opened
      // western portcullis": (38,10), the laboratory, its doorway at (37,20)
      // (a room description), and (35,23).
      expect(way([30, 2], [38, 11])).toBeGreaterThan(0);
      expect(way([38, 11], [37, 19])).toBeGreaterThan(0);
      q.place({ x: 37, y: 19 });
      await q.go(S);
      expect(q.tail(1)).toMatch(/Zkal's laboratory/);
      expect(way([37, 20], [33, 23])).toBeGreaterThan(0);
      // "Search all of the treasure chests": four, each trapped. (The loot
      // to a mage: E3's fighters are too magically inept to use the ring.)
      const who = q.party.pcs.findIndex((p) => p.skills[Skill.MAGE_SPELLS]! > 0);
      const taken: string[] = [];
      for (const [x, y] of [[30, 21], [34, 21], [30, 25], [34, 25]] as const) {
        q.place({ x: x === 30 ? 31 : 33, y: y === 21 ? 22 : 24 });
        const found = (await q.session.adjTownLook({ x, y })) ?? [];
        await q.settle();
        for (const it of found) q.session.takeItem(it, who);
        taken.push(...found.map((it) => it.fullName));
      }
      expect(q.log.filter((l) => /likely to have a trap of some sort/.test(l)).length, q.tail()).toBe(4);
      // B's list: "Bronze Ring, Bronze Serpent Ring (3), Ring of Weight, Ring
      // of Endless Magery (40)". E3 names it the Ring of Magery.
      expect(taken.sort()).toEqual(['Bronze Ring', 'Bronze Serpent Ring', 'Gold Weight Ring', 'Ring of Magery']);
      const pc = q.party.pcs[who]!;
      const slot = pc.items.findIndex((it) => it.variety !== 0 && it.fullName === 'Ring of Magery');
      const ring = pc.items[slot]!;
      expect([ring.name, ring.ident, ring.charges, ring.itemLevel]).toEqual(['Ring', false, 40, 2]);
      // "restores 45 MP each time", 40 times: E3's use code 20, 15 a level
      // and 15 (on a turn the tower doesn't take 5 of them back).
      pc.maxSp = 100;
      pc.curSp = 0;
      while ((q.party.age + 1) % 5 === 0) q.party.age++;
      await useItem(q.session, who, slot, q.session.host ?? undefined);
      await q.settle();
      expect(pc.curSp, q.univ.transcript.slice(-2).join(' / ')).toBe(45);
      expect(ring.charges).toBe(39);

      // The way home (both walkthroughs reach for the editor): back past
      // the laboratory to the room east of the closing walls, and the
      // portal at (32,32) (spot 16) to (12,30), by the stairs' side.
      expect(way([33, 23], [32, 31])).toBeGreaterThan(0);
      q.place({ x: 32, y: 31 });
      await q.go(S);
      expect(q.at, q.tail()).toEqual({ x: 12, y: 30 });
      expect(way([12, 30], [13, 2])).toBeGreaterThan(0);
    });
  });

  describe('the endgame', () => {
    const said = (q: QuestRunner, from: number): string[] => q.univ.transcript.slice(from);
    /** Look at a blocked square, step on an open one: how a spot is set off. */
    const touch = async (q: QuestRunner, x: number, y: number): Promise<void> => {
      if (q.session.townIsBlocked({ x, y })) await q.look(x, y);
      else await q.step(x, y);
    };

    /** Into day `day`: the clock set just short of its dawn, and one turn waited. */
    const dawn = async (q: QuestRunner, day: number): Promise<void> => {
      // The scenario timer starts the day's chain the first time; after that
      // the chain re-arms itself as a party timer, which counts turns.
      const daily = scen.scenarioTimers.find((t) => t.node >= 0)!.node;
      q.party.age = (day - 1) * 3700 - 1;
      for (const t of q.party.partyEventTimers) if (t.node === daily) t.time = 1;
      await q.pause();
    };

    /** Whether the party could walk from `from` to some open square beside (x, y). */
    const reachesBeside = (q: QuestRunner, from: { x: number; y: number }, x: number, y: number): boolean =>
      [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => {
        const p = { x: x + dx!, y: y + dy! };
        return q.town.isOnMap(p.x, p.y) && !q.session.townIsBlocked(p) && q.canReach(from, p);
      });

    it("Grah-Hoth: the demon plot on day 160, the overrun Tower, the Blessed Athame, and Linda's gate cut", async () => {
      const DEMON_PLOT = 0xc91, ATHAME = 35;
      const q = new QuestRunner(scen);
      await q.enter(21, { x: 10, y: 10 });
      await dawn(q, 159);
      expect(q.flag(DEMON_PLOT)).toBe(0);
      await dawn(q, 160);
      expect(q.flag(DEMON_PLOT), q.tail()).toBe(1);
      // Anaximander's news.
      let from = q.log.length;
      await q.step(...spot(21, 1));
      expect(q.flag(DEMON_PLOT), q.tail()).toBe(2);
      expect(q.log.slice(from).some((l) => /Demons have taken the Tower of Magi/.test(l)), q.tail()).toBe(true);

      // The Portal Fortress's portal goes to the overrun Tower now.
      await q.enter(40);
      await q.step(...spot(40, 2));
      expect([q.townNum, q.at], q.tail()).toEqual([25, { x: 1, y: 62 }]);
      const [gate] = await q.talk(/Solberg/, 'gate');
      expect(gate).toMatch(/Linda might know/);
      const [athame, temple] = await q.talk(/Linda/, 'bles', 'temp');
      expect(athame).toMatch(/put it in the temple/);
      expect(temple).toMatch(/north/);
      // The ghost by the garden teaches Move Mountains.
      await q.talk(132, 'teac');
      expect(q.party.pcs.some((pc) => pc.priestSpells[Spell.MOVE_MOUNTAINS - 100]), q.tail()).toBe(true);

      // The gate, with nothing to cut it: steel passes through, and stepping in is death.
      expect(spot(25, 2)).toEqual([12, 11]);
      const gateAt = { x: 12, y: 11 };
      q.place({ x: 12, y: 12 });
      q.answer('Attack');
      await q.walk(12, 11);
      expect(q.tail(1)).toMatch(/passes through it without effect/);
      {
        const r = new QuestRunner(scen);
        r.setFlag(DEMON_PLOT, 2);
        await r.enter(25, { x: 12, y: 12 });
        r.answer('Step In');
        await r.walk(12, 11);
        expect(r.party.pcs.some((pc) => pc.isAlive), r.tail()).toBe(false);
      }

      // The temple's altar, up the east side: the athame, and the demons it calls.
      expect(q.canReach({ x: 1, y: 62 }, { x: 55, y: 25 }), 'to the altar').toBe(true);
      const demons = q.creatures(/Demon|Haakai|Imp|Hordling/).length;
      await q.step(...spot(25, 3));
      expect(q.hasSpecItem(ATHAME), q.tail()).toBe(true);
      expect(q.creatures(/Demon|Haakai|Imp|Hordling/).length, q.tail()).toBeGreaterThan(demons);
      // Kneeling there afterwards heals, once.
      await q.clearHostiles();
      for (const pc of q.party.pcs) pc.curHealth = 1;
      await q.step(...spot(25, 3));
      expect(q.party.pcs[0]!.curHealth, q.tail()).toBeGreaterThan(1);
      for (const pc of q.party.pcs) pc.curHealth = 1;
      await q.step(...spot(25, 3));
      expect(q.party.pcs[0]!.curHealth, q.tail()).toBe(1);
      for (const pc of q.party.pcs) pc.curHealth = pc.maxHealth;

      // The back way: the secret door at (4,10), Move Mountains on the
      // storeroom's moldy south wall, and across the lava to the gate.
      q.place({ x: 5, y: 12 });
      expect(q.pathLength({ x: 5, y: 12 }, gateAt)).toBeGreaterThan(40);
      await q.spell(Spell.MOVE_MOUNTAINS, 5, 13);
      expect(q.town.record.terrain[5]![13]).not.toBe(129);
      expect(q.pathLength({ x: 5, y: 12 }, gateAt), 'through the crumbled wall').toBeLessThan(15);
      // The guardians come as the party nears the gate.
      const before = q.creatures(/Haakai|Mung/).length;
      await q.step(...spot(25, 1));
      expect(q.creatures(/Haakai|Mung/).length, q.tail()).toBeGreaterThan(before);
      // The athame cuts it: the plot is over, and the party is sent home.
      q.place({ x: 12, y: 12 });
      q.answer('Attack');
      await q.walk(12, 11);
      expect(q.flag(DEMON_PLOT), q.tail()).toBe(3);
      expect(q.townNum, q.tail()).toBe(40);

      // Reported: Anaximander's thanks, and Levy's reward.
      await q.enter(21, { x: 10, y: 10 });
      from = q.log.length;
      await q.step(...spot(21, 1));
      expect(q.flag(DEMON_PLOT), q.tail()).toBe(4);
      const items = () => q.party.pcs.reduce((n, pc) => n + pc.items.filter((it) => it.variety !== 0).length, 0);
      const held = items();
      await q.talk(/Levy/, 'rewa');
      expect(q.flag(DEMON_PLOT), q.tail()).toBe(5);
      expect(items()).toBe(held + 1);
    });

    it('Grah-Hoth: two thousand turns after the plot starts, away from the Tower, Exile is lost', async () => {
      const q = new QuestRunner(scen);
      await q.enter(21, { x: 10, y: 10 });
      await dawn(q, 160);
      expect(q.flag(0xc91)).toBe(1);
      // The countdown's units and hundreds (`towns/towerOfMagi.ts`), near its end.
      q.party.setSdf(292, 10, 0);
      q.party.setSdf(292, 11, 3);
      await q.pause(3);
      expect(q.party.pcs.some((pc) => pc.isAlive), q.tail()).toBe(false);
    });

    /** E3's spot `id` of outdoor zone `z`, as `[sx, sy, x, y]` for `outdoors`. */
    const zoneSpot = (z: number, id: number): [number, number, number, number] => {
      const spots = JSON.parse(readFileSync(join(out, 'debug.json'), 'utf8')) as { zones: Record<string, { id: number; x: number; y: number }[]> };
      const s = spots.zones[z]!.find((l) => l.id === id)!;
      return [z % 9, Math.floor(z / 9), s.x, s.y];
    };

    it("The evidence: Berra takes the four plagues' proofs, the last names the Vahnatai, and Anaximander hears it", async () => {
      const q = new QuestRunner(scen);
      const [RUNE, SCALES, SHARDS, HOT_SHARDS] = [0x40, 0x42, 0x44, 0x46].map(partySpecItem);
      for (const k of [RUNE!, SCALES!, SHARDS!, HOT_SHARDS!]) q.party.specItems.add(k);
      await q.enter(21, { x: 10, y: 10 });
      const [rune, scales, shards, hot, none] = await q.talk(/Berra/, 'evid', 'evid', 'evid', 'evid', 'evid');
      expect(rune).toMatch(/rune of Erika/);
      expect(scales).toMatch(/dragon scales/);
      expect(shards).toMatch(/Vahnatai are the true masters/);
      expect(q.log.some((l) => /monsters on the surface are being created by Vahnatai/.test(l)), q.tail()).toBe(true);
      expect(hot).toMatch(/Go see Anaximander/);
      expect(none).toMatch(/What evidence do you have/);
      for (const k of [RUNE!, SCALES!, SHARDS!, HOT_SHARDS!]) expect(q.hasSpecItem(k)).toBe(false);
      expect([0xc96, 0xc97, 0xc9e, 0xc93].map((o) => q.flag(o))).toEqual([1, 1, 1, 1]);
      // Rentar-Ihrno's ruined keep, the Vahnatai's (town 87), is on the map.
      expect(scen.towns[87]!.canFind).toBe(true);
      // Anaximander hears each piece.
      const from = q.log.length;
      await q.step(...spot(21, 1));
      const heard = q.log.slice(from).join('\n');
      expect(heard, q.tail()).toMatch(/Erika/);
      expect(heard, q.tail()).toMatch(/dragon/i);
      expect(heard, q.tail()).toMatch(/Vahnatai/);
      expect([0xc96, 0xc97, 0xc9e, 0xc93].map((o) => q.flag(o)), q.tail()).toEqual([2, 2, 2, 2]);
    });

    it("Erika: the bridge opens on the evidence, her amulets fetched from behind the locked door, and activated", async () => {
      const AMULETS = partySpecItem(0x54);
      const q = new QuestRunner(scen);
      // The bridge to her tower (zone 71's spot 6) is shut until there is evidence.
      const [sx, sy, bx, by] = zoneSpot(71, 6);
      await q.outdoors(sx, sy, bx - 1, by);
      await q.go(Direction.E);
      expect(q.at, q.tail()).toEqual({ x: bx - 1, y: by });
      q.setFlag(0xc96, 1);
      await q.go(Direction.E);
      expect(q.at, q.tail()).toEqual({ x: bx, y: by });

      await q.enter(47);
      const erika = q.creatures(/Erika/)[0]!.curLoc;
      // Before she asks, the pedestal's amulet stays put.
      q.place(erika);
      await q.step(...spot(47, 2));
      expect(q.hasSpecItem(AMULETS), q.tail()).toBe(false);
      const [amulet] = await q.talk(/Erika/, 'amul');
      expect(amulet).toMatch(/fourth room on the left/);
      // The fourth room: through the locked door at (8,26).
      expect(scen.terTypes[q.town.record.terrain[8]![26]!]!.special).toBe(TerSpec.UNLOCKABLE);
      expect(q.canReach(erika, { x: 4, y: 28 })).toBe(true);
      await q.step(...spot(47, 2));
      expect(q.hasSpecItem(AMULETS), q.tail()).toBe(true);
      expect(q.flag(0x262)).toBe(2);
      // Refused, her boon is gone for good.
      {
        const r = new QuestRunner(scen);
        r.setFlag(0x262, 2);
        r.party.specItems.add(AMULETS);
        await r.enter(47);
        r.answer('Leave');
        await r.talk(/Erika/, 'acti');
        expect(r.hasSpecItem(AMULETS), r.tail()).toBe(false);
        expect(r.flag(0x262)).toBe(3);
      }
      q.answer('Yes');
      const [acti, again] = await q.talk(/Erika/, 'acti', 'acti');
      expect(acti).toMatch(/I can now chart your progress/);
      expect(again).not.toMatch(/chart your progress/);
      expect(q.hasSpecItem(AMULETS)).toBe(true);
      expect(q.flag(0x262)).toBe(3);
      expect(q.flag(0x263)).toBe(0);
    });

    it("The dragons: Sulfras's pests, Athron's metal, Khoth's tome, and the Beastslayer Blade", async () => {
      const METAL = 37;
      // Athron's barrier lets nobody in until Sulfras has spoken of the sword.
      {
        const r = new QuestRunner(scen);
        await r.enter(104);
        await r.step(...spot(104, 2));
        expect(r.town.record.terrain[10]![24], r.tail()).not.toBe(0);
        await r.enter(105);
        const door = r.town.record.terrain[0x15]![0x16];
        await r.step(...spot(105, 2));
        expect(r.town.record.terrain[0x15]![0x16], r.tail()).toBe(door);
      }
      const q = new QuestRunner(scen);
      await q.enter(57);
      const start = { ...q.at };
      // No audience before a plague has been ended; then the portcullises open.
      await q.step(...spot(57, 2));
      expect(q.tail(1)).toMatch(/I have no reason to see you/);
      const sulfras = q.creatures(/Sulfras/)[0]!.curLoc;
      // Her two rows of portcullises, either side of the lava (125 shut, 126 open).
      const gates = [6, 10].flatMap((y) => [0x15, 0x16, 0x17].map((x) => q.town.record.terrain[x]![y]));
      expect(gates.every((t) => t === 125)).toBe(true);
      q.setFlag(0xc85, 3);
      await q.step(...spot(57, 2));
      expect(q.tail(1)).toMatch(/I grant you an audience/);
      expect([6, 10].flatMap((y) => [0x15, 0x16, 0x17].map((x) => q.town.record.terrain[x]![y])).every((t) => t === 126)).toBe(true);
      expect(q.canReach(start, sulfras), 'to Sulfras').toBe(true);
      const [pests, sword] = await q.talk(/Sulfras/, 'irks', 'swor');
      expect(pests).toMatch(/northeast cave/);
      expect(sword).toMatch(/Khoth and Athron/);
      expect(q.flag(0x2c5)).toBe(1);
      // Her northeast cave's two Alien Beasts.
      const beasts = q.creatures(/Alien Beast/);
      expect(beasts.length).toBe(2);
      expect(q.canReach(start, beasts[0]!.curLoc), 'to the cave').toBe(true);
      await q.kill(/Alien Beast/);
      const [slain] = await q.talk(/Sulfras/, 'irks');
      expect(slain).toMatch(/mildly annoying/);

      // Athron's lair, by the western passage: the gap in the barrier, and the middle chest's metal.
      await q.step(...spot(57, 11));
      expect([q.townNum, q.at]).toEqual([104, { x: 3, y: 8 }]);
      const chest = spot(104, 3);
      expect(reachesBeside(q, { x: 3, y: 8 }, ...chest), 'barrier up').toBe(false);
      await q.step(...spot(104, 2));
      expect(q.tail(1)).toMatch(/a small gap appears/);
      expect(reachesBeside(q, { x: 3, y: 8 }, ...chest), 'through the gap').toBe(true);
      await q.look(...chest);
      expect(q.hasSpecItem(METAL), q.tail()).toBe(true);
      const [assist] = await q.talk(/Athron/, 'assi');
      expect(assist).toMatch(/You took the metal/);

      // Khoth's lair, by the eastern passage: the portcullis, his word, and the bookshelf at (22,11).
      await q.enter(57);
      await q.step(...spot(57, 12));
      expect([q.townNum, q.at]).toEqual([105, { x: 26, y: 5 }]);
      await q.step(...spot(105, 2));
      expect(q.tail(1)).toMatch(/bars slowly rise/);
      expect(q.canReach(q.at, q.creatures(/Khoth/)[0]!.curLoc), 'to Khoth').toBe(true);
      const [teach] = await q.talk(/Khoth/, 'ritu');
      expect(teach).toMatch(/Search my bookshelves/);
      // Without the tome, Sulfras still waits.
      await q.enter(57);
      const [waiting] = await q.talk(/Sulfras/, 'swor');
      expect(waiting).toMatch(/I also need the spell/);
      await q.enter(105);
      expect(spot(105, 27)).toEqual([22, 11]);
      await q.look(22, 11);
      expect(q.flag(0x4a4), q.tail()).toBe(1);

      // Sulfras forges the Beastslayer Blade, once.
      await q.enter(57);
      const [forged, again] = await q.talk(/Sulfras/, 'swor', 'swor');
      expect(forged).toMatch(/hands the blade to you/);
      expect(again).not.toMatch(/hands the blade/);
      expect(q.hasSpecItem(METAL)).toBe(false);
      const blades = q.party.pcs.flatMap((pc) => pc.items.filter((it) => it.fullName === 'Beastslayer Blade'));
      expect(blades.length).toBe(1);
      // It bites Alien Beasts and Pack Leaders, 30 a blow, and nothing else.
      await q.enter(35);
      const blade = blades[0]!;
      expect(blade.e3Ability).toBe(E3Abil.BEAST_BANE);
      expect(e3SpecDam(q.univ, blade.e3Ability, q.creatures(/Alien Beast/)[0]!)).toBe(30);
      expect(e3SpecDam(q.univ, blade.e3Ability, q.creatures(/Pack Leader/)[0]!)).toBe(30);
      await q.enter(57);
      expect(e3SpecDam(q.univ, blade.e3Ability, q.creatures(/Drake/)[0]!)).toBe(0);
    });

    it("The Bunker: Commander Johnson's password, Ostoth told it's the Vahnatai, and four days later the Thought Crystal", async () => {
      const CRYSTAL = partySpecItem(0x4e);
      const q = new QuestRunner(scen);
      await q.enter(21, { x: 10, y: 10 });
      const [sandra] = await q.talk(/Johnson/, 'sand');
      expect(sandra).toMatch(/New Cotra/);
      // The bunker's door on the east side, (13,10), opens on the word.
      await q.enter(42);
      const door = q.town.record.terrain[13]![10];
      {
        const r = new QuestRunner(scen);
        await r.enter(42);
        await r.step(...spot(42, 5));
        expect(r.town.record.terrain[13]![10]).toBe(door);
      }
      await q.step(...spot(42, 5));
      expect(q.town.record.terrain[13]![10], q.tail()).toBe(0);
      const ostoth = q.creatures(/Ostoth/)[0]!.curLoc;
      expect(q.canReach(q.at, ostoth), 'into the bunker').toBe(true);
      const [weapon, vahnatai, again] = await q.talk(/Ostoth/, 'weap', 'vahn', 'erik');
      expect(weapon).toMatch(/come back and tell me their name/);
      expect(vahnatai).toMatch(/disrupt the crystals/);
      // One guess only: a second name gets "be patient".
      expect(again).toMatch(/Be patient/);
      expect(q.flag(0x22b)).toBe(2);
      // The chest by his room stays empty until four days have passed.
      const chest = spot(42, 4);
      for (let d = 2; d <= 4; d++) {
        await dawn(q, d);
        await q.enter(42);
        await touch(q, ...chest);
        expect(q.tail(1), `day ${d}`).toMatch(/The chest is empty/);
      }
      await dawn(q, 5);
      await q.enter(42);
      await touch(q, ...chest);
      expect(q.hasSpecItem(CRYSTAL), q.tail()).toBe(true);
      // Its makers are spent.
      const [done] = await q.talk(/Ostoth/, 'weap');
      expect(done).toMatch(/Pathass is dead/);
      expect(q.creatures(/Slith Chief|^Mage$/).length).toBe(0);
    });

    it("Blackcrag: the Thieves' Guild's tunnel permission, the Guarded Tunnel's bridge and doomguard, and the stairs up", async () => {
      const PERMISSION = 0x107;
      const q = new QuestRunner(scen);
      // Lorelei: Kendra opens the way to the Guild, and Geoffrey sells permission.
      await q.enter(12);
      const [guild] = await q.talk(/Kendra/, 'guil');
      expect(guild).toMatch(/Through there/);
      q.party.gold = 2999;
      const [poor] = await q.talk(/Geoffrey/, 'perm');
      expect(poor).toMatch(/You don't have the money/);
      expect(q.flag(PERMISSION)).toBe(0);
      q.party.gold = 5000;
      const [perm] = await q.talk(/Geoffrey/, 'perm');
      expect(perm).toMatch(/sixty miles east of Blackcrag/);
      expect([q.flag(PERMISSION), q.party.gold]).toEqual([1, 2000]);

      // Without it, the Guarded Tunnel's alarm turns the thieves on the party.
      {
        const r = new QuestRunner(scen);
        await r.enter(61);
        await r.trigger(...spot(61, 2));
        expect(r.log.at(-1), r.tail()).toMatch(/alarm/i);
        expect(r.town.monsters.some((m) => m.isAlive && !m.isFriendly && m.personality === 360), r.tail()).toBe(true);
      }
      await q.enter(61);
      const entry = { ...q.at };
      await q.trigger(...spot(61, 2));
      expect(q.tail(1)).toMatch(/We expected you/);
      expect(q.town.monsters.some((m) => m.isAlive && !m.isFriendly && m.personality === 360)).toBe(false);
      const [blackcrag] = await q.talk(/Velasquez/, 'blac');
      expect(blackcrag).toMatch(/Press it once/);

      // The button behind the office's false wall, pressed once, makes the bridge solid.
      q.place({ x: 26, y: 28 });
      await q.walk(25, 28);
      await q.walk(24, 28);
      expect(q.party.getSdf(61, 1), q.tail()).toBe(1);
      // An even number of presses, and whoever crosses falls.
      {
        const r = new QuestRunner(scen);
        await r.enter(61);
        r.place({ x: 26, y: 28 });
        await r.walk(25, 28);
        await r.walk(24, 28);
        r.place({ x: 26, y: 28 });
        await r.walk(25, 28);
        await r.walk(24, 28);
        expect(r.party.getSdf(61, 1), r.tail()).toBe(0);
        await r.step(...spot(61, 1));
        expect(r.party.pcs.some((pc) => pc.isAlive), r.tail()).toBe(false);
      }
      // Up the tunnel to the bridge, across, and on to the doomguard's cavern.
      const bridge = spot(61, 15);
      expect(q.canReach(entry, { x: bridge[0], y: bridge[1] }), 'to the bridge').toBe(true);
      await q.step(...bridge);
      await q.step(...spot(61, 1));
      expect(q.party.pcs.every((pc) => pc.isAlive), q.tail()).toBe(true);
      const cavern = spot(61, 9);
      expect(q.canReach(q.at, { x: cavern[0], y: cavern[1] }), 'over the bridge to the cavern').toBe(true);
      // The armour wakes; one of it slain lifts the portcullis at (9,3).
      await q.step(...cavern);
      expect(q.creatures(/Doomguard/).length, q.tail()).toBeGreaterThan(0);
      const stairs = spot(61, 11);
      expect(q.canReach(q.at, { x: stairs[0], y: stairs[1] }), 'portcullis down').toBe(false);
      await q.kill(/Doomguard/);
      expect(q.tail(1)).toMatch(/portcullis/);
      expect(q.canReach(q.at, { x: stairs[0], y: stairs[1] }), 'portcullis up').toBe(true);
      // The stairs up into Blackcrag Fortress.
      await q.step(...stairs);
      expect([q.townNum, q.at], q.tail()).toEqual([34, { x: 58, y: 10 }]);
    });

    it("Blackcrag Fortress: the ambush, Vladimir's door, Prazac's missive and Anaximander's answer, and Footracer's gates open", async () => {
      const [PRAZAC_SCROLL, ANAX_SCROLL] = [partySpecItem(0x3a), partySpecItem(0x3b + 1)];
      const q = new QuestRunner(scen);
      await q.enter(34, { x: 58, y: 10 });
      const stairs = { ...q.at };
      // The soldiers past the secret passage in the great hall's corner.
      const hostiles = (): number => q.town.monsters.filter((m) => m.isAlive && !m.isFriendly).length;
      expect(hostiles()).toBe(0);
      await q.step(...spot(34, 3));
      expect(q.tail(1)).toMatch(/Empire guards appear all around you/);
      expect(hostiles()).toBeGreaterThan(0);
      await q.clearHostiles();
      // Vladimir unlocks the throne room (123 to 124 at (51,40)) once the
      // golems or the giants are dealt with.
      expect(q.canReach(stairs, q.creatures(/Vladimir/)[0]!.curLoc), 'to Vladimir').toBe(true);
      const [notYet] = await q.talk(/Vladimir/, 'requ');
      expect(notYet).toMatch(/you must prove your skill/);
      expect(q.town.record.terrain[51]![40]).toBe(123);
      q.setFlag(0xc8c, 3);
      const [granted] = await q.talk(/Vladimir/, 'requ');
      expect(granted).toMatch(/You may enter/);
      expect(q.town.record.terrain[51]![40]).toBe(124);
      const prazac = q.creatures(/Prazac/)[0]!.curLoc;
      expect(reachesBeside(q, stairs, prazac.x, prazac.y), 'to the throne').toBe(true);
      // Her missive for Anaximander.
      const [missive, again] = await q.talk(/Prazac/, 'dipl', 'dipl');
      expect(missive).toMatch(/Take it to him with all haste/);
      expect(again).toMatch(/You have not yet delivered my vital missive/);
      expect([q.hasSpecItem(PRAZAC_SCROLL), q.flag(0xc94)]).toEqual([true, 1]);
      // Anaximander's answer, two days later.
      await q.enter(21, { x: 10, y: 10 });
      const age = q.party.age;
      await q.step(...spot(21, 1));
      expect(q.log.some((l) => /Take this to Empress Prazac/.test(l)), q.tail()).toBe(true);
      expect([q.hasSpecItem(PRAZAC_SCROLL), q.hasSpecItem(ANAX_SCROLL), q.flag(0xc94)]).toEqual([false, true, 2]);
      expect(q.party.age).toBeGreaterThanOrEqual(age + 2500);
      // The Empress's answer: Footracer Province is open.
      await q.enter(34, { x: 58, y: 10 });
      const [mission] = await q.talk(/Prazac/, 'dipl');
      expect(mission).toMatch(/I grant permission to enter/);
      expect([q.flag(0x925), q.flag(0xc8f), q.hasSpecItem(ANAX_SCROLL)]).toEqual([1, 1, false]);
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.flag(0xc8f), q.tail()).toBe(2);

      // Footracer's gates (zone 12's spot 2), shut to anyone without her word.
      const gate = zoneSpot(12, 2);
      {
        const r = new QuestRunner(scen);
        await r.outdoors(gate[0], gate[1], gate[2], gate[3] + 1);
        await r.go(Direction.N);
        expect(r.at, r.tail()).toEqual({ x: gate[2], y: gate[3] + 1 });
      }
      await q.outdoors(gate[0], gate[1], gate[2], gate[3] + 1);
      await q.go(Direction.N);
      expect(q.log.some((l) => /the gates swing open silently/.test(l)), q.tail()).toBe(true);
      // And the beasts that wait on the other side.
      expect(q.tail(2)).toMatch(/six legs/);
      // The group is dropped at a random square near the party, and the
      // fight starts when it reaches them: a turn or two, by the dice.
      for (let turn = 0; turn < 6 && q.session.mode !== GameMode.COMBAT; turn++) await q.pause();
      expect(q.session.mode, q.tail()).toBe(GameMode.COMBAT);
      expect(await q.fightOutdoors(), q.tail()).toBe(true);
    });

    it("The New Formello murders: Anaximander's word, Flanagan's case, the Murder Cave, and its key", async () => {
      const MURDER_KEY = partySpecItem(0x20);
      const q = new QuestRunner(scen);
      // The roaches' plague over (or day 74), Anaximander has news of murders.
      q.setFlag(0xc90, 1);
      await q.enter(21, { x: 10, y: 10 });
      await q.step(...spot(21, 1));
      expect(q.log.some((l) => /strange murders up by New Formello/.test(l)), q.tail()).toBe(true);
      expect(scen.towns[86]!.canFind).toBe(false);
      // Flanagan, at New Formello's inn, puts the cave on the map.
      await q.enter(43);
      const [find] = await q.talk(/Flanagan/, 'find');
      expect(find).toMatch(/Go up and investigate/);
      expect(q.flag(0xc90)).toBe(2);
      expect(scen.towns[86]!.canFind).toBe(true);
      // The cave, in from the south: past the bodies, the secret passage, the
      // stalagmites' ways through and the bridge, to the north cavern.
      await q.enter(86, { x: 3, y: 27 });
      const keySpot = spot(86, 7);
      expect(q.canReach({ x: 3, y: 27 }, { x: keySpot[0], y: keySpot[1] }), 'to the key').toBe(true);
      await q.step(...spot(86, 11));
      expect(q.log.at(-1)).toMatch(/^\[choice\]/);
      // The nest's ambush, and the key.
      await q.step(...spot(86, 6));
      expect(q.creatures(/Chitrach|Null Bug/).length, q.tail()).toBeGreaterThan(0);
      await q.clearHostiles();
      await q.step(...keySpot);
      expect(q.hasSpecItem(MURDER_KEY), q.tail()).toBe(true);
      expect(q.flag(0xc90)).toBe(4);
      await q.step(...keySpot);
      expect(q.party.specItems.has(MURDER_KEY)).toBe(true);
      // Flanagan hears of it.
      await q.enter(43);
      const [done] = await q.talk(/Flanagan/, 'find');
      expect(done).toMatch(/the key you found/);
      expect(q.flag(0xc90)).toBe(5);
    });

    it("The Keep of Tinraya: in by the east door, the beasts' vats, the rune's blast, and the stairs down", async () => {
      const q = new QuestRunner(scen);
      await q.outdoorsAt(79, 63);
      await q.go(Direction.W);
      expect([q.townNum, q.at], q.tail()).toEqual([35, { x: 59, y: 32 }]);
      await q.clearHostiles();
      // The vats where the alien beasts are bred (spots 4–7): burned, once each.
      for (const id of [4, 5, 6, 7]) {
        const xp = q.party.pcs[0]!.experience;
        await touch(q, ...spot(35, id));
        expect(q.party.pcs[0]!.experience, `vat ${id}\n${q.tail(2)}`).toBeGreaterThan(xp);
        await touch(q, ...spot(35, id));
        expect(q.log.at(-1), `vat ${id} again`).not.toMatch(/^\[choice\]/);
      }
      // The locked door at (49,46), the barrier, and the rune before the stairs.
      expect(scen.terTypes[q.town.record.terrain[49]![46]!]!.special).toBe(TerSpec.UNLOCKABLE);
      const rune = spot(35, 16), stairs = spot(35, 14);
      expect(q.canReach({ x: 59, y: 32 }, { x: rune[0], y: rune[1] }), 'to the rune').toBe(true);
      // The barrier at (46,50), dispelled as the walkthroughs do.
      expect(q.town.fields[46]![50]!.has(FieldType.BARRIER_FORCE)).toBe(true);
      q.party.pcs[0]!.level = 30;
      q.place({ x: 46, y: 49 });
      for (let i = 0; i < 20 && q.town.fields[46]![50]!.has(FieldType.BARRIER_FORCE); i++) await q.spell(Spell.DISPEL_BARRIER, 46, 50);
      expect(q.town.fields[46]![50]!.has(FieldType.BARRIER_FORCE)).toBe(false);
      // The rune: searing flames, around 80 to everyone.
      for (const pc of q.party.pcs) { pc.maxHealth = 200; pc.curHealth = 200; }
      await q.step(...rune);
      expect(q.tail(1)).toMatch(/searing flames/);
      for (const pc of q.party.pcs) expect(200 - pc.curHealth).toBeGreaterThan(50);
      await q.step(...stairs);
      expect([q.townNum, q.at], q.tail()).toEqual([36, { x: 61, y: 61 }]);
    });

    it("Under Tinraya: the Murder Cave's key, captured by Rentar-Ihrno, one PC through the teleporter, the panel, the Crystal Souls, and out the west side", async () => {
      const MURDER_KEY = partySpecItem(0x20), VAHNATAI_KEY = partySpecItem(0x34), CRYSTAL = partySpecItem(0x4e);
      const q = new QuestRunner(scen);
      q.party.specItems.add(CRYSTAL);
      // Down from the keep, as the walkthroughs come, so the way out is the keep's.
      await q.outdoorsAt(79, 63);
      await q.go(Direction.W);
      await q.step(...spot(35, 14));
      expect([q.townNum, q.at]).toEqual([36, { x: 61, y: 61 }]);
      await q.clearHostiles();
      const P = (x: number, y: number) => q.town.record.terrain[x]![y];
      // By boat to the rune-covered door at (28,7), which only the Murder Cave's key opens.
      const runeSpot = spot(36, 17);
      expect(q.canReach(q.at, { x: runeSpot[0], y: runeSpot[1] }), 'on foot').toBe(false);
      expect(q.canReach(q.at, { x: runeSpot[0], y: runeSpot[1] }, { boat: true }), 'by boat').toBe(true);
      await q.step(...runeSpot);
      expect(q.tail(1)).toMatch(/none of your keys fit/);
      // (A locked door, 138, to the engine; the key makes it an ordinary one, 135.)
      expect(P(28, 7)).toBe(138);
      q.party.specItems.add(MURDER_KEY);
      await q.step(...runeSpot);
      expect(P(28, 7), q.tail()).toBe(135);
      // On to the hall, where Rentar-Ihrno's projection has the party seized.
      const hall = spot(36, 7);
      expect(q.canReach({ x: 27, y: 7 }, { x: hall[0], y: hall[1] }), 'to the hall').toBe(true);
      await q.step(...hall);
      expect(q.log.some((l) => /we seek our rightful reveng/i.test(l)), q.tail()).toBe(true);
      expect(q.at).toEqual({ x: 40, y: 61 });
      // Rentar-Ihrno's ruined keep goes on the map, as Berra's last proof would have put it.
      expect([q.flag(0xc93), q.flag(0x225), scen.towns[87]!.canFind]).toEqual([1, 1, true]);
      // Days in the cell, the food going, then the voice, and the teleporter's wall opens.
      const food = q.party.food;
      for (let i = 0; i < 50 && P(42, 62) === 132; i++) await q.pause();
      expect(q.tail(1)).toMatch(/One can leave now/);
      expect(P(42, 62)).toBe(133);
      expect(q.party.food).toBe(food - 30);
      // One goes; the panel's room is open to them, the cell's crystals not.
      await q.step(...spot(36, 3));
      expect(q.party.isSplit(), q.tail()).toBe(true);
      expect(q.at).toEqual({ x: 27, y: 42 });
      expect(reachesBeside(q, q.at, 37, 61), 'the cell crystals, before').toBe(false);
      expect(reachesBeside(q, q.at, 37, 47), 'the panel').toBe(true);
      // Walkthrough A's quiet way: G, K and I, and no alarm.
      const guards = (): number => q.town.monsters.filter((m) => m.isAlive && !m.isFriendly && m.active > 0).length;
      const awake = guards();
      q.number(7, 11, 9, 0);
      await q.look(...spot(36, 18));
      expect(reachesBeside(q, q.at, 37, 61), 'the cell crystals, after').toBe(true);
      expect(guards()).toBe(awake);
      // The crystal marked 2 frees the party.
      q.answer(/^2$/);
      await q.look(...spot(36, 19));
      expect(q.party.isSplit(), q.tail()).toBe(false);
      expect(q.tail(1)).toMatch(/You have freed your group/);
      // Back to the hall: the Bunker's crystal puts the Crystal Souls to sleep.
      await q.step(...spot(36, 8));
      expect(q.log.some((l) => /As the Crystal Souls begin to glow/.test(l)), q.tail()).toBe(true);
      expect(q.creatures(/Crystal Soul/).length).toBe(0);
      expect(q.flag(0x1f3)).toBe(1);
      // The case with the Vahnatai key.
      await q.look(...spot(36, 2));
      expect(q.hasSpecItem(VAHNATAI_KEY), q.tail()).toBe(true);

      // Up the stairs north of the hall, round the keep's west side, and down again.
      const up = spot(36, 15);
      expect(q.canReach({ x: 15, y: 55 }, { x: up[0], y: up[1] }), 'to the stairs up').toBe(true);
      await q.step(...up);
      expect([q.townNum, q.at], q.tail()).toEqual([35, { x: 16, y: 26 }]);
      await q.clearHostiles();
      const down = spot(35, 11);
      expect(q.canReach(q.at, { x: down[0], y: down[1] }), 'to the stairs down').toBe(true);
      await q.step(...down);
      expect([q.townNum, q.at], q.tail()).toEqual([36, { x: 15, y: 29 }]);
      // The second rune door opened when the party came back (the Souls are dealt with).
      expect(P(12, 32)).toBe(135);
      expect(q.canReach(q.at, { x: 0, y: 32 }), 'to the west edge').toBe(true);
      // Out by the west edge: beside Under Tinraya's own entrance (E3's exit), not the keep's.
      q.place({ x: 1, y: 32 });
      await q.go(Direction.W);
      expect(q.session.isOutdoors, q.tail()).toBe(true);
      expect(q.global).toEqual({ x: 72, y: 63 });
      await q.go(Direction.W);
      expect(q.global).toEqual({ x: 71, y: 63 });
    });

    it("Under Tinraya, the other ways: the panel's alarm opens everything and wakes the guards; without the Bunker's crystal, the Souls fight", async () => {
      const q = new QuestRunner(scen);
      await q.enter(36, { x: 40, y: 61 });
      q.setFlag(0xc93, 1);
      // Straight to the teleporter, as if the days had passed.
      q.town.record.terrain[42]![62] = 133;
      await q.step(...spot(36, 3));
      expect(q.party.isSplit()).toBe(true);
      const guards = (): number => q.town.monsters.filter((m) => m.isAlive && !m.isFriendly && m.active > 0).length;
      const awake = guards();
      q.number(14);
      await q.look(...spot(36, 18));
      expect(q.tail(1)).toMatch(/shrill, warbling wail/);
      expect(guards()).toBeGreaterThan(awake);
      expect(PANEL_DOORS.slice(1).every(([x, y]) => q.town.record.terrain[x]![y] === 141)).toBe(true);
      // The panel is dead after.
      await q.look(...spot(36, 18));
      expect(q.tail(1)).toMatch(/the control panel is inactive/);
      q.answer(/^2$/);
      await q.look(...spot(36, 19));
      expect(q.party.isSplit(), q.tail()).toBe(false);
      await q.step(...spot(36, 8));
      expect(q.creatures(/Crystal Soul/).length, q.tail()).toBe(4);
      expect(q.creatures(/Crystal Soul/).some((m) => !m.isFriendly)).toBe(true);
    });

    /**
     * The New Factory (town 63), west door to east, leg by leg: walkthrough
     * B's buttons (14 turns the long belt along y 44 east, 15 back west, 17
     * lifts the portcullis at (36,28), 16 turns the belt at x 36 north), Move
     * Mountains on the cracked wall at (24,9), and Dispel Barrier on the three
     * barriers. Each leg's moves were found by `searchBelts` with the engine
     * as its model (`E3_BELT_SEARCH=1` searches again).
     */
    const factoryLegs = (q: QuestRunner): [string, BeltGoal, () => Promise<void>][] => {
      const at = (x: number, y: number) => (l: { x: number; y: number }) => l.x === x && l.y === y;
      const near = (x: number, y: number) => (l: { x: number; y: number }) => Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= 1 && !(l.x === x && l.y === y);
      const dispel = async (x: number, y: number) => {
        for (let i = 0; i < 20 && q.town.fields[x]![y]!.has(FieldType.BARRIER_FORCE); i++) await q.spell(Spell.DISPEL_BARRIER, x, y);
      };
      return [
        ['b14', { at: at(21, 39) }, async () => {}],
        ['b15', { at: at(36, 41) }, async () => {}],
        ['b17', { at: at(38, 46) }, async () => {}],
        ['crack', { at: near(24, 9) }, async () => { await q.spell(Spell.MOVE_MOUNTAINS, 24, 9); }],
        ['barrier', { at: near(23, 20) }, async () => { await dispel(23, 20); await dispel(23, 21); }],
        ['barrier2', { at: near(40, 25) }, async () => { await dispel(40, 25); }],
        ['b16', { at: at(37, 22) }, async () => {}],
        ['out', { town: -1 }, async () => {}],
      ];
    };
    /** A fresh party at the New Factory's west door, from the outdoors. */
    const factory = async (q: QuestRunner): Promise<void> => {
      for (const pc of q.party.pcs) { pc.level = 30; pc.maxHealth = 600; pc.curHealth = 600; }
      await q.outdoorsAt(79, 31);
      await q.go(Direction.E);
    };

    const FACTORY_ROUTES = {
      b14: [1,3,2,1,2,3,3,4,4,5,5,6,6,7,6,5,4,4,3,2,3,3,3,3,2,3,4,6,6,7,6,5,4,4,4,4,3,3,4,4,3,5,4,3,3,4,3,5,4,5,4,3,2,2,3,2,2,1,1,1,2,3,2,1,0],
      b15: [4,4,4,4,3,2,2,2,2,2,2,1,0,0],
      b17: [4,3,2,2,4,3,5],
      crack: [1,7,6,6,6,6,7,0,0,6,0,0,0,6,7,6,7,7,0,0,0,0,0,0,0,0,0,0,0,7,0,0,2,1,2,2,2,2,1,1,1,0,1],
      barrier: [4,3,2,2,2,3,3,3,3,5,5,6,6],
      barrier2: [6,6,5,4,4,3,2,2,3,3,1,3,3,3,3,2,2,1,2,3,4,4,3,4,3,2,2,2,1,0,0,0,0,0,0,0,0,0,7,6,7],
      b16: [0,0,0,0,0,7,6,6,6,5,5,4,2,0,1],
      out: [7,0,0,2,0,2,2,2,2,0,0,0,1,1,0,0,0,0,1,1,1],
    } as Record<string, BeltMove[]>;

    it("The New Factory, walked: in by the west door, its buttons, the cracked wall and the barriers, and out to the east", async () => {
      const q = new QuestRunner(scen);
      await factory(q);
      expect([q.townNum, q.at]).toEqual([63, { x: 4, y: 5 }]);
      // Without the buttons, the far side can't be reached.
      expect(await searchBelts(q, q.at, { at: (l) => l.x >= 33 && l.y <= 5 })).toBeNull();
      q.place({ x: 4, y: 5 });
      const pressed = (): number => q.log.filter((l) => /large red button/.test(l)).length;
      for (const [name, , after] of factoryLegs(q)) {
        const before = pressed();
        await walkBelts(q, FACTORY_ROUTES[name]!);
        if (/^b\d/.test(name)) expect(pressed(), name).toBe(before + 1);
        await after();
        if (name === 'b14') expect(q.town.record.terrain[30]![44], name).toBe(248);
        if (name === 'b15') expect(q.town.record.terrain[30]![44], name).toBe(250);
        if (name === 'b17') expect(q.town.record.terrain[36]![28], name).toBe(141);
        if (name === 'crack') expect(q.town.record.terrain[24]![9], name).not.toBe(143);
        if (name === 'barrier') expect(q.town.fields[23]![20]!.has(FieldType.BARRIER_FORCE), name).toBe(false);
        if (name === 'b16') expect(q.town.record.terrain[36]![18], name).toBe(247);
      }
      // Off the east edge: out beside the factory's east door (its exit, (37,29) of zone (1,0)).
      expect(q.session.isOutdoors, q.tail()).toBe(true);
      expect(q.global).toEqual({ x: 85, y: 29 });
    });

    it.runIf(process.env['E3_BELT_SEARCH'])('The New Factory searched again (E3_BELT_SEARCH=1)', async () => {
      const q = new QuestRunner(scen);
      await factory(q);
      const found: Record<string, BeltMove[] | null> = {};
      for (const [name, goal, after] of factoryLegs(q)) {
        const start = { ...q.at };
        const route = await searchBelts(q, start, goal);
        found[name] = route;
        console.log(name, JSON.stringify(route));
        if (!route) break;
        q.place(start);
        await walkBelts(q, route);
        await after();
      }
      console.log(JSON.stringify(found));
      for (const [name, route] of Object.entries(found)) expect(route, name).not.toBeNull();
    }, 1800000);

    it("The ways between: through Footracer's gate to Tinraya, over lava to the New Factory, and on to the Great Walls and the keep", async () => {
      const path = outdoorPath;
      const LAVA = 0x4b;
      // Open ground (town entrances and the like keep monsters off, and are left out).
      const dry = (t: number) => scen.terTypes[t]!.blockage <= TerObstruct.BLOCK_SIGHT;
      const firewalk = (t: number) => dry(t) || t === LAVA;
      // Blackcrag's door to Tinraya's: only through Footracer's gate (zone 12's spot 2, (151,52)).
      const gate = zoneSpot(12, 2);
      const gateAt: [number, number] = [gate[0] * 48 + gate[2], gate[1] * 48 + gate[3]];
      expect(path([175, 10], [79, 63], dry, new Set([gateAt.join()])), 'round the gate').toBe(-1);
      expect(path([175, 10], gateAt, dry), 'to the gate').toBeGreaterThan(0);
      expect(path(gateAt, [79, 63], dry), 'from the gate to the keep').toBeGreaterThan(0);
      // Out of Under Tinraya's west side, the New Factory is over lava
      // (walkthrough A's Firewalk, B's flight), and the last stone circle with it.
      expect(path([72, 63], [79, 31], dry), 'dry-shod').toBe(-1);
      expect(path([72, 63], [79, 31], firewalk), 'across the lava').toBeGreaterThan(0);
      expect(path([72, 63], [57, 13], firewalk), 'to the stone circle').toBeGreaterThan(0);
      // Out of the factory's east side, walking to the Great Walls (town 37's west end, (152,9)).
      expect(path([85, 29], [152, 9], dry), 'to the Great Walls').toBeGreaterThan(0);
      // And from their east end, (349,3), to the Keep of Rentar-Ihrno (426,85).
      expect(path([349, 3], [426, 85], dry), 'to the keep').toBeGreaterThan(0);
    });

    it("The Great Walls: Erika's amulets blast the first wall open, the runes lift the far portcullises, and out the east end", async () => {
      const AMULETS = partySpecItem(0x54);
      // Without her amulets (or not activated), the walls stay whole.
      {
        const r = new QuestRunner(scen);
        await r.outdoorsAt(151, 9);
        await r.go(Direction.E);
        await r.step(...spot(37, 1));
        await r.step(...spot(37, 2));
        expect(r.town.record.terrain[0x17]![0x20]).toBe(132);
      }
      const q = new QuestRunner(scen);
      q.party.specItems.add(AMULETS);
      q.setFlag(0x262, 3);
      await q.outdoorsAt(151, 9);
      await q.go(Direction.E);
      expect([q.townNum, q.at]).toEqual([37, { x: 4, y: 32 }]);
      await q.clearHostiles();
      const P = (x: number, y: number) => q.town.record.terrain[x]![y];
      const start = { ...q.at };
      const end = spot(37, 12);
      expect(q.canReach(start, { x: end[0], y: end[1] }), 'shut').toBe(false);
      await q.step(...spot(37, 11));
      expect(q.tail(1)).toMatch(/Three walls have been built/);
      await q.step(...spot(37, 1));
      expect(q.tail(1)).toMatch(/amulets Erika gave you are starting to grow very warm/);
      await q.step(...spot(37, 2));
      expect(q.tail(1)).toMatch(/blasting a hole through it/);
      expect(P(0x17, 0x20)).toBe(0);
      // Once only.
      const blasts = (): number => q.log.filter((l) => /blasting a hole/.test(l)).length;
      await q.step(...spot(37, 2));
      expect(blasts()).toBe(1);
      // The runes past the false wall at (50,9) open the portcullises (55,31)–(55,33) and (55,13).
      const rune = spot(37, 16);
      expect(q.canReach(start, { x: rune[0], y: rune[1] }), 'to the runes').toBe(true);
      expect([P(0x37, 0x1f), P(0x37, 0x20), P(0x37, 0x21), P(0x37, 0xd)]).toEqual([140, 140, 140, 140]);
      await q.step(...rune);
      expect(q.tail(1)).toMatch(/massive portcullises opening/);
      expect([P(0x37, 0x1f), P(0x37, 0x20), P(0x37, 0x21), P(0x37, 0xd)]).toEqual([141, 141, 141, 141]);
      expect(q.canReach(start, { x: end[0], y: end[1] }), 'open').toBe(true);
      // The east end leads out into the Vahnatai's caves, at (349,3), for a party that came in at the west.
      await q.step(...end);
      for (let i = 0; i < 10 && q.session.inTown; i++) await q.go(Direction.E);
      expect(q.session.isOutdoors, q.tail()).toBe(true);
      expect(Math.abs(q.global.x - 349) + Math.abs(q.global.y - 3), JSON.stringify(q.global)).toBeLessThanOrEqual(2);
    });

    /**
     * Set off the spot at (x, y): as `touch`, or, when every way to it is
     * through a false wall or secret door, through that first.
     */
    const reach = async (q: QuestRunner, x: number, y: number): Promise<void> => {
      try { await touch(q, x, y); return; } catch { /* walled in */ }
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
        const door = { x: x + dx, y: y + dy };
        const beyond = { x: x + 2 * dx, y: y + 2 * dy };
        if (!q.town.isOnMap(beyond.x, beyond.y) || q.session.townIsBlocked(beyond)) continue;
        if (scen.terTypes[q.town.record.terrain[door.x]![door.y]!]!.special !== TerSpec.CHANGE_WHEN_STEP_ON) continue;
        q.place(beyond);
        await q.walk(door.x, door.y);
        if (q.session.townIsBlocked({ x, y })) await q.session.adjTownLook({ x, y }).then(() => q.settle());
        else await q.walk(x, y);
        return;
      }
      throw new Error(`no way to (${x},${y})`);
    };

    /** The keep's ten channels, flags 0x304–0x30d, one per lever on level 2 (spots 20–29). */
    const CHANNELS = [...Array(10).keys()].map((k) => 0x304 + k);

    it("The Keep of Rentar-Ihrno, level 1: in by the west gate, the false barriers, the reading crystals, and the way to all four stairs", async () => {
      const q = new QuestRunner(scen);
      await q.outdoorsAt(425, 85);
      await q.go(Direction.E);
      expect([q.townNum, q.at]).toEqual([38, { x: 4, y: 32 }]);
      await q.clearHostiles();
      const start = { ...q.at };
      // Six barriers across the hall: the fire ones (13) are false, walkthrough B's
      // "Fake Real / Real Fake / Real Real".
      expect([[12, 31], [13, 31], [12, 32], [13, 32], [12, 33], [13, 33]].map(([x, y]) => [...q.town.fields[x!]![y!]!])).toEqual([[13], [14], [14], [13], [14], [14]]);
      q.place({ x: 11, y: 33 });
      expect(await q.go(Direction.E)).toEqual([false]);
      q.place({ x: 11, y: 31 });
      expect(await q.go(Direction.E, Direction.SE, Direction.E)).toEqual([true, true, true]);
      expect(q.at).toEqual({ x: 14, y: 32 });
      expect(q.log.some((l) => /central hall of the fortress/.test(l)), q.tail()).toBe(true);
      // The reading crystals explain the pedestal, in turn, and go dark.
      for (const pc of q.party.pcs) { pc.curSp = 50; pc.maxSp = 50; }
      for (const id of [20, 21, 22, 23, 24, 25]) await q.step(...spot(38, id));
      expect(q.flag(0x207)).toBe(6);
      expect(q.log.some((l) => /Release Slime Compounds|Begin Process|Power/i.test(l)), q.tail(8)).toBe(true);
      // Three stairs down are open; the fourth, behind the portcullis at (41,1),
      // opens on the button at (34,24) (or coming up stair 14 below).
      for (const id of [14, 16, 17]) {
        const [x, y] = spot(38, id);
        expect(q.canReach(start, { x, y }), `stair ${id}`).toBe(true);
      }
      const [fx, fy] = spot(38, 15);
      expect(q.canReach(start, { x: fx, y: fy }), 'stair 15, shut').toBe(false);
      await touch(q, ...spot(38, 12));
      expect(q.town.record.terrain[41]![1]).toBe(141);
      expect(q.canReach(start, { x: fx, y: fy }), 'stair 15, open').toBe(true);
    });

    it("The Keep of Rentar-Ihrno, level 2: each stair's levers, pulled in order, fill the four vats", async () => {
      const q = new QuestRunner(scen);
      await q.enter(38, { x: 14, y: 32 });
      // Each stair down, where it lands, and its chain of levers (each needs the one before).
      const stairs: [number, number[]][] = [[14, [22, 23]], [17, [27, 28, 29]], [16, [24, 25, 26]], [15, [20, 21]]];
      for (const [stair, levers] of stairs) {
        if (stair === 15) await touch(q, ...spot(38, 12));
        await q.enter(38, { x: 14, y: 32 });
        const [sx, sy] = spot(38, stair);
        await q.step(sx, sy);
        expect(q.townNum, `stair ${stair}\n${q.tail()}`).toBe(64);
        await q.clearHostiles();
        const landing = { ...q.at };
        // Out of order, a lever refuses.
        if (levers.length > 1) {
          await reach(q, ...spot(64, levers[1]!));
          expect(q.flag(CHANNELS[levers[1]! - 20]!), `lever ${levers[1]} early`).toBe(0);
        }
        for (const id of levers) {
          const [x, y] = spot(64, id);
          expect(q.canReach(landing, { x, y }), `lever ${id}`).toBe(true);
          await reach(q, x, y);
          expect(q.flag(CHANNELS[id - 20]!), `lever ${id}\n${q.tail(2)}`).toBe(1);
        }
        // Back up the stair the party came down by.
        q.place(landing);
        const up = q.town.record.specialLocs.find((l) => Math.max(Math.abs(l.x - landing.x), Math.abs(l.y - landing.y)) <= 2
          && [14, 15, 16, 17].some((k) => { const [ux, uy] = spot(64, k); return ux === l.x && uy === l.y; }))!;
        await q.step(up.x, up.y);
        expect(q.townNum, `up from ${stair}\n${q.tail()}`).toBe(38);
      }
      expect(CHANNELS.map((c) => q.flag(c))).toEqual(Array(10).fill(1));
      // The goo runs in every channel when the level is entered again.
      await q.enter(64);
      expect(q.town.record.terrain[11]![15]).toBe(75);
    });

    it("Rentar-Ihrno: Erika's amulets bring Erika to duel her, and at the pedestal Release, Power Up and Begin end the game", async () => {
      const AMULETS = partySpecItem(0x54);
      const ready = (r: QuestRunner) => { for (const c of CHANNELS) r.setFlag(c, 1); };
      // Without every channel open, she waits; without Erika, she throws the
      // party back five times before it may touch her panel.
      {
        const r = new QuestRunner(scen);
        await r.enter(38, { x: 14, y: 32 });
        // (Her guards dealt with: one standing on the pedestal's square would be fought, not stepped past.)
        await r.clearHostiles();
        await r.step(...spot(38, 4));
        expect(r.log.filter((l) => /Rentar/.test(l)).length).toBe(0);
        ready(r);
        await r.step(...spot(38, 4));
        expect(r.creatures(/^Erika$/).length).toBe(0);
        // Each throw calls up four wandering monsters, fought off here.
        for (let i = 0; i < 5; i++) {
          await r.clearHostiles();
          await r.step(...spot(38, 26));
          expect(r.at, `${i}`).toEqual({ x: 14, y: 32 });
        }
        // Her panel: 1 Emergency Drain Away, 2 Release Slime Compounds,
        // 3 Power Up Chargers, 4 Begin Process. Out of order, it beeps (and
        // Begin closes the panel, beep or not; E3 keeps it open).
        r.number(3, 0);
        await r.clearHostiles();
        await r.step(...spot(38, 26));
        expect(r.flag(0x208)).toBe(0);
        expect(r.log.some((l) => /\[end\]/.test(l))).toBe(false);
        r.number(2, 3, 4);
        await r.clearHostiles();
        await r.step(...spot(38, 26));
        expect(r.log.some((l) => /\[end\]/.test(l)), r.tail()).toBe(true);
      }
      const q = new QuestRunner(scen);
      q.party.specItems.add(AMULETS);
      q.setFlag(0x262, 3);
      ready(q);
      await q.enter(38, { x: 14, y: 32 });
      await q.clearHostiles();
      await q.step(...spot(38, 4));
      expect(q.creatures(/^Erika$/).length, q.tail()).toBe(1);
      // At the pedestal: Erika falls, and the panel is the party's at once.
      const from = q.log.length;
      q.number(2, 3, 4);
      await q.step(...spot(38, 26));
      expect(q.creatures(/^Erika$/).length).toBe(0);
      expect(q.log.slice(from).some((l) => /Erika/.test(l)), q.tail()).toBe(true);
      expect(q.flag(0x208)).toBe(3);
      expect(q.log.at(-1), q.tail()).toBe('[end]');
    });

    it("Ghikra: Rentar-Ihrno's leave past the barriers, one PC through the glowing door, the Vahnatai's council of plagues, and the shade's warning", async () => {
      const q = new QuestRunner(scen);
      q.party.pcs[0]!.level = 30;
      await q.enter(41);
      // Until Rentar-Ihrno has shown herself, the barriers hold.
      const barrier = spot(41, 3);
      await q.step(...barrier);
      expect(q.tail(1)).toMatch(/blocked by a wall of energy/);
      expect(q.at).not.toEqual({ x: barrier[0], y: barrier[1] });
      q.setFlag(0x225, 1);
      await q.step(...barrier);
      expect(q.at).toEqual({ x: barrier[0], y: barrier[1] });
      // The Crystal Souls' corridor, until she lets the party by.
      const souls = spot(41, 9);
      await q.step(...souls);
      expect(q.tail(1)).toMatch(/Your muscles simply refuse/);
      const [allow] = await q.talk(/Rentar/, 'allo');
      expect(allow).toMatch(/You may now pass/);
      await q.step(...souls);
      expect(q.at).toEqual({ x: souls[0], y: souls[1] });
      // The glowing door takes one; the rune circle shows the plagues, and calls guards.
      await q.step(...spot(41, 14));
      expect(q.party.isSplit(), q.tail()).toBe(true);
      expect(q.at).toEqual({ x: 40, y: 37 });
      await q.step(...spot(41, 2));
      expect(q.log.some((l) => /some sort of meeting room/.test(l)), q.tail()).toBe(true);
      expect(q.creatures(/Hraithe|Vahnavoi/).length).toBe(2);
      await q.clearHostiles();
      // The shade (walkthrough B: don't kill it) warns the party off, and fades.
      const [warning] = await q.talk(/Shade/, 'veng');
      expect(warning).toMatch(/Do not oppose us further/);
      expect(q.creatures(/Shade/).length).toBe(0);
      await q.step(...spot(41, 16));
      expect(q.party.isSplit(), q.tail()).toBe(false);
    });

    it("Ghikra's crystal teaches Major Blessing to a party with 15 Mage Lore between its living members", async () => {
      // `1088:06ea`: FUN_10b0_302f adds up the living PCs' skill 11, and over 14 learns mage spell 55.
      const q = new QuestRunner(scen);
      await q.enter(41);
      const lore = [3, 3, 3, 3, 2, 0];
      q.party.pcs.forEach((pc, i) => { pc.skills[Skill.MAGE_LORE] = lore[i]!; pc.mageSpells[Spell.BLESS_MAJOR] = false; });
      await touch(q, ...spot(41, 11));
      expect(q.party.pcs.some((pc) => pc.mageSpells[Spell.BLESS_MAJOR]), `14\n${q.tail()}`).toBe(false);
      q.party.pcs[5]!.skills[Skill.MAGE_LORE] = 1;
      await touch(q, ...spot(41, 11));
      expect(q.party.pcs.every((pc) => pc.mageSpells[Spell.BLESS_MAJOR]), `15\n${q.tail()}`).toBe(true);
    });

    it("The Great Circle: the black altar smashed, and the haakai's bargain taken or refused", async () => {
      // Refused: they fight.
      {
        const r = new QuestRunner(scen);
        await r.enter(62);
        r.party.gold = 500;
        const before = r.town.monsters.filter((m) => m.isAlive && !m.isFriendly).length;
        // (The smashing takes a page or two of OK first.)
        r.answer('Yes', /^(OK|Leave)$/, /^(OK|Leave)$/, /^(OK|Leave)$/);
        await r.step(...spot(62, 1));
        expect(r.party.gold, r.tail()).toBe(500);
        expect(r.town.monsters.filter((m) => m.isAlive && !m.isFriendly).length, r.tail()).toBeGreaterThan(before);
        expect(r.flag(0x867)).toBe(1);
      }
      // Taken: every coin and magic item goes.
      const q = new QuestRunner(scen);
      await q.enter(62);
      q.party.gold = 500;
      q.answer('Yes', /^(OK|Yes)$/, /^(OK|Yes)$/, /^(OK|Yes)$/);
      await q.step(...spot(62, 1));
      expect(q.party.gold, q.tail()).toBe(0);
      expect(q.flag(0x867)).toBe(1);
      // Turned away, it asks again; after three stone circles it can't be refused.
      const r = new QuestRunner(scen);
      await r.enter(62);
      r.setFlag(0xb41, 3);
      r.answer('Leave', /^(OK|Leave)$/, /^(OK|Leave)$/, /^(OK|Leave)$/);
      await r.step(...spot(62, 1));
      expect(r.flag(0x867), r.tail()).toBe(1);
    });

    it("The Pantless Dungeon: a pair of pants on the keep's pedestal, the way to the Generic Dungeon, and back", async () => {
      const q = new QuestRunner(scen);
      await q.enter(38, { x: 14, y: 32 });
      await q.clearHostiles();
      const rune = spot(38, 11);
      await q.step(...rune);
      expect(q.townNum, 'no pants').toBe(38);
      // Pants (E3's item variety 22) dropped on the pedestal at (17,58).
      const pants = scen.scenItems.findIndex((it) => it.specialClass === PANTS_CLASS);
      expect(pants).toBeGreaterThanOrEqual(0);
      q.town.items.push({ ...scen.scenItems[pants]!, itemLoc: { x: 17, y: 58 } } as never);
      await q.step(...rune);
      expect([q.townNum, q.at], q.tail()).toEqual([65, { x: 4, y: 43 }]);
      // The Generic Dungeon's innkeeper, its maker in person.
      expect(q.creatures(372).length).toBe(1);
      await q.step(...spot(65, 6));
      expect([q.townNum, q.at], q.tail()).toEqual([38, { x: 20, y: 58 }]);
    });
  });

  describe('secret doors', () => {
    it('opens a secret door as the party walks into it, and lets it through on that step', async () => {
      // Fort Emergence's basalt one at (26,6): 118, "Basalt Wall", becomes
      // 119, the wall with its door showing, under the party (`10c0:14df`).
      const q = new QuestRunner(scen);
      expect(q.town.record.terrain[26]![6]).toBe(118);
      await q.step(26, 6);
      expect(q.town.record.terrain[26]![6]).toBe(119);
      expect(q.at).toEqual({ x: 26, y: 6 });
    });

    it("walks through Colchis's into the shade's room on the first try, message and all", async () => {
      // Its message spot sits on the door (E3-CHECK-IN-ORIGINAL.md #1): the
      // spot says yes, and the door opens under the party.
      const q = new QuestRunner(scen);
      await q.enter(125, { x: 37, y: 39 });
      await q.clearHostiles();
      expect(q.town.record.terrain[36]![39]).toBe(101);
      await q.session.moveTo({ x: 36, y: 39 });
      await q.settle();
      expect(q.town.record.terrain[36]![39]).toBe(102);
      expect(q.at).toEqual({ x: 36, y: 39 });
      expect(q.log.some((l) => /just plain odd/.test(l)), q.tail()).toBe(true);
    });

    it('finds a secret door by searching it (`10c0:43d4`)', async () => {
      const q = new QuestRunner(scen);
      await q.look(26, 6);
      expect(q.town.record.terrain[26]![6]).toBe(119);
      expect(q.univ.transcript).toContain('  You find a secret door!');
    });
  });

  describe('the villages', () => {
    it('maps the ruins Colchis is entered among, so no creature stands on black', async () => {
      // From the north gate, a Mauve Slime is in sight through rubble the
      // entry node lays (DIVERGENCES.md #24); E3's map has the rubble before
      // the party arrives, so it is mapped on arrival.
      const q = new QuestRunner(scen);
      await q.enter(125, undefined, 0);
      const seen = q.town.monsters.filter((m) => m.isAlive && q.session.partyCanSeeMonst(m));
      expect(seen.length).toBeGreaterThan(0);
      for (const m of seen) expect(q.town.isExplored(m.curLoc.x, m.curLoc.y), m.mon.name).toBe(true);
    });

    it("never says \"You find something!\" on searching Colchis's anvil and pillar", async () => {
      // E3's search (`10c0:425c`) has 1997's announcement compiled out.
      const q = new QuestRunner(scen);
      await q.enter(125, { x: 37, y: 39 });
      await q.clearHostiles();
      await q.look(20, 20);
      await q.look(39, 27);
      expect(q.univ.transcript.join('\n')).not.toMatch(/You find something/);
    });
  });
});
