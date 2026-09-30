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
import type { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { GameMode } from '../src/game/modes';
import { Skill, Status } from '../src/universe/skills';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir } from '../tools/e3convert/install';
import { partySpecItem } from '../tools/e3convert/script';
import { SLIME_POOLS } from '../tools/e3convert/towns/slimePit';
import { QuestRunner, loadExile3 } from './support/e3Quest';

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
});
