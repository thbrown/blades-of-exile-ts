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
import { Status } from '../src/universe/skills';
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
});
