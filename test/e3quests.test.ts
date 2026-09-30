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
import { WALL_FLOOR, WALL_NORTH, WALL_SOUTH, moveE3Walls } from '../src/game/e3MovingWalls';
import { E3Abil, e3SpecDam } from '../src/game/e3Items';
import { TerSpec } from '../src/data/terrain';

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
      // His spellbook (spot 11): Wall of Blades and Major Cleansing, for a seasoned party.
      for (const pc of q.party.pcs) pc.level = 5;
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
});
