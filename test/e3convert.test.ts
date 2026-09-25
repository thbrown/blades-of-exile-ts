/**
 * The Exile 3 converter end to end: convert the user's install into a scratch
 * directory and load the result with the engine's own loader. Skips without an
 * install (the files are commercial and never committed).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import type { Scenario } from '../src/data/scenario';
import { ItemType } from '../src/data/item';
import { MonstTime } from '../src/data/monster';
import { ShopItemType, ShopPrompt } from '../src/data/shop';
import { TalkNodeType } from '../src/data/talking';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { emitScenario } from '../tools/e3convert/emit';
import { findE3Dir } from '../tools/e3convert/install';

const dir = findE3Dir();

describe.skipIf(!dir)('Exile 3 converted', () => {
  const out = mkdtempSync(join(tmpdir(), 'e3convert-'));
  let scen: Scenario;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    const opcodes = buildOpcodeTable(
      readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'));
    scen = await loadScenario(new FsSource(out), opcodes);
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('starts where a new game of Exile 3 does', () => {
    expect(scen.title).toBe('Exile III: Ruined World');
    expect(scen.startTown).toBe(21);
    expect(scen.towns[21]?.name).toBe('Fort Emergence');
    // The sector-level start is the zone exit that leads to the fort.
    expect(scen.outdoorStart).toEqual({ x: 1, y: 8 });
    expect(scen.sectorStart).toEqual({ x: 20, y: 25 });
  });

  it('lays out 90 zones as a 9×10 world with their names', () => {
    expect(scen.outWidth).toBe(9);
    expect(scen.outHeight).toBe(10);
    expect(scen.outdoors[0]?.[0]?.name).toBe('Northwestern Valorim');
    expect(scen.outdoors[1]?.[0]?.cityLocs.map((c) => c.spec)).toEqual([62, 63, 63]);
  });

  it('keeps E3 terrain: its names, pictures, blockage and doors', () => {
    expect(scen.terTypes[0]?.name).toBe('Cave Floor');
    expect(scen.terTypes[5]?.picture).toBe(1005);
    expect(scen.terTypes[5]?.blockage).toBe(TerObstruct.BLOCK_MOVE_AND_SIGHT);
    // Animated: E3 picture 303 (rocks in water) is the fourth animation.
    expect(scen.terTypes[74]?.picture).toBe(2000 + 300 + 4 * 3);
    expect(scen.terTypes[74]?.boatOver).toBe(true);
    // A closed door opens into an open one; a locked one needs picking.
    expect(scen.terTypes[103]?.special).toBe(TerSpec.CHANGE_WHEN_STEP_ON);
    expect(scen.terTypes[103]?.flag1).toBe(107);
    expect(scen.terTypes[107]?.name).toBe('Open Door');
    expect(scen.terTypes[104]?.special).toBe(TerSpec.UNLOCKABLE);
  });

  it("has E3's monsters, with E3's own stats and sprites", () => {
    expect(scen.scenMonsters).toHaveLength(191);
    const guard = scen.scenMonsters[12]!;
    expect(guard.name).toBe('Guard');
    expect([guard.level, guard.health, guard.armor]).toEqual([30, 140, 30]);
    // E3's guard swings 2d10, where BoE's bladbase rebalanced it to 3d10.
    expect(guard.attacks[0]).toMatchObject({ dice: 2, sides: 10 });
    expect(guard.pictureNum).toBeGreaterThanOrEqual(1400); // a custom sheet after the terrain's
    const giant = scen.scenMonsters[54]!;
    expect(giant.name).toBe('Cave Giant');
    expect([giant.xWidth, giant.yWidth]).toEqual([1, 2]);
    expect(scen.scenMonsters[177]?.name).toBe('Rentar-Ihrno');
  });

  it("has E3's items, and the things lying about its towns", () => {
    // E3's 415, then the fifteen food records its food shops sell from.
    expect(scen.scenItems).toHaveLength(430);
    expect(scen.scenItems[415]).toMatchObject({ fullName: 'Crude Rations', variety: ItemType.FOOD, itemLevel: 10, value: 24 });
    const knife = scen.scenItems[41]!;
    expect(knife.fullName).toBe('Bronze Knife');
    expect([knife.itemLevel, knife.value, knife.weight]).toEqual([4, 16, 7]);
    expect(knife.graphicNum).toBeGreaterThanOrEqual(1000);
    const krizsan = scen.towns[0]!;
    expect(krizsan.presetItems[0]).toMatchObject({ code: 9, loc: { x: 6, y: 19 }, alwaysThere: true });
    expect(krizsan.presetFields.length).toBeGreaterThan(0);
  });

  it("has E3's conversations, keyed to its people", () => {
    // E3 personalities are 1-based; the fort's official (20) is Anaximander,
    // the engine's 19, in talk block 1.
    const official = scen.towns[21]!.creatures.find((c) => c.number === 33)!;
    expect(official.personality).toBe(19);
    const who = scen.townTalk[1]!.people[9]!;
    expect(who.title).toBe('Anaximander');
    expect(who.job).toMatch(/^"It is my job to give you instruction/);
    const nodes = scen.townTalk[1]!.talkNodes.filter((n) => n.personality === 19);
    expect(nodes.map((n) => n.link1)).toContain('surf');
  });

  it('opens shops stocked from the shopkeeper, at E3\'s prices', () => {
    // The five magic shops and the healer come first, as in any scenario.
    expect(scen.shops[5]?.prompt).toBe(ShopPrompt.HEALING);
    const shopOf = (town: number, x: number, y: number) => {
      const who = scen.towns[town]!.creatures.find((c) => c.startLoc.x === x && c.startLoc.y === y)!;
      const node = scen.townTalk[Math.floor(who.personality / 10)]!.talkNodes
        .find((n) => n.personality === who.personality && n.type === TalkNodeType.SHOP)!;
      return { node, shop: scen.shops[node.extras[1]!]! };
    };
    // Jinx in Krizsan sells entries 30–49 of E3's list, at price level 3.
    const jinx = shopOf(0, 18, 26);
    expect(jinx.shop.name).toBe("Jinx's Weaponry");
    expect(jinx.node.extras[0]).toBe(3);
    expect(jinx.shop.items.map((e) => e.item.fullName)).toContain('Bronze Knife');
    // Velnas sells E3's low-level spells, which BoE never sold, at E3's price.
    const velnas = shopOf(16, 15, 27).shop;
    expect(velnas.prompt).toBe(ShopPrompt.MAGE);
    expect(velnas.items[0]).toMatchObject({ type: ShopItemType.MAGE_SPELL, index: 6, item: { value: 1500 } });
  });

  it('gives a personality shared by villages one copy per shop', () => {
    // E3's personality 1 is a weaponsmith in six villages, each with its own stock.
    const smiths = [127, 132].map((t) => scen.towns[t]!.creatures.find((c) => c.personality >= 0 && c.startLoc.x === (t === 127 ? 39 : 15))!);
    expect(smiths[0]!.personality).toBe(0);
    expect(smiths[1]!.personality).toBeGreaterThanOrEqual(390);
  });

  it("has E3's special items", () => {
    expect(scen.specialItems).toHaveLength(50);
    expect(scen.specialItems[16]?.name).toBe('Silver Key');
  });

  it('makes people come and go, and villages fall, on E3\'s days', () => {
    // Two in the fort wait for plot event 4 (the engine's key 5).
    const waiting = scen.towns[21]!.creatures.filter((c) => c.timeFlag === MonstTime.APPEAR_WHEN_EVENT);
    expect(waiting.map((c) => c.timeCode)).toEqual([5, 5, 5]);
    // Delis falls on E3's day 60, which is the engine's 80.
    expect(scen.towns[121]!.townChopTime).toBe(80);
    expect(scen.towns[121]!.creatures.some((c) => c.timeFlag === MonstTime.APPEAR_AFTER_CHOP)).toBe(true);
  });

  it('builds the villages from their building blocks', () => {
    // Delan: grass, walls, houses and a dock, not a bare field.
    const delan = scen.towns[120]!;
    const tiles = new Set(delan.terrain.flat());
    expect(tiles.size).toBeGreaterThan(20);
    // Every village has a way in: exits past town 127 are unsigned bytes.
    const entrances = scen.outdoors.flat().flatMap((o) => o?.cityLocs.map((c) => c.spec) ?? []);
    expect(entrances.filter((t) => t >= 128).length).toBe(49);
  });

  it('has signs to read and rooms with names', () => {
    const krizsan = scen.towns[0]!;
    const sign = krizsan.signLocs[0]!;
    expect(sign.text).toBe('KRIZSAN SHIPYARD');
    expect(scen.terTypes[krizsan.terrain[sign.x]![sign.y]!]?.special).toBe(TerSpec.IS_A_SIGN);
    expect(krizsan.areaDesc.map((a) => a.descr)).toContain("Jinx's Smithy");
    const zone = scen.outdoors[0]![0]!;
    expect(zone.signLocs[0]?.text).toMatch(/^VALORIM IS DECLARED UNDER QUARANTINE/);
  });

  it('has wandering monsters, in towns and on the world', () => {
    // Around Fort Emergence: a group that stops coming once flag (307,3) is set.
    const zone = scen.outdoors[1]![8]!;
    expect(zone.wandering[0]).toMatchObject({ monst: [0, 0, 0, 0, 138, 139, 140], endSpec1: 307, endSpec2: 3, cantFlee: true });
    expect(zone.wanderingLocs[0]).toEqual({ x: 42, y: 42 });
    expect(scen.towns[11]!.wandering[0]).toEqual([149, 149, 150, 150]);
  });

  it('places the fort\'s people', () => {
    const fort = scen.towns[21]!;
    expect(fort.creatures.filter((c) => c.number > 0).length).toBeGreaterThan(40);
  });

  it('has all 200 towns, their maps sized by record number', () => {
    expect(scen.towns).toHaveLength(200);
    expect(scen.towns[0]?.maxDim).toBe(64);
    expect(scen.towns[45]?.maxDim).toBe(48);
    expect(scen.towns[80]?.maxDim).toBe(32);
    expect(scen.towns[120]?.name).toBe('Delan');
  });
});
