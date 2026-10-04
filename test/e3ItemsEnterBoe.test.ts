/**
 * Exile III's items, carried out of Exile III and into a BoE scenario. Every
 * one of E3's 475 items has a custom picture (sheet 11, 2100–2199), which
 * `enterWithParty` takes away unless `exportGraphics` has made it the party's
 * own on the way out — so this is the whole of E3's gear riding on the export.
 *
 * Needs the converted Exile III scenario, which is generated locally and never
 * committed (`public/scenarios/exile3/`), so it skips without it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemType } from '../src/data/item';
import type { Item } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import type { Rgba } from '../src/fileio/legacy/bmp';
import { loadScenario } from '../src/fileio/loadScenario';
import { decodePng } from '../src/fileio/png';
import { applyPartySave, saveGame } from '../src/fileio/saveIo';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession, carriedOutOfScenario } from '../src/game/session';
import { exportGraphics } from '../src/universe/exportGraphics';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const scenarioDir = (id: string) => fileURLToPath(new URL(`../public/scenarios/${id}`, import.meta.url));
const haveE3 = existsSync(scenarioDir('exile3'));

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);
const load = (id: string): Promise<Scenario> => loadScenario(new FsSource(scenarioDir(id)), opcodes);

/** Exile III's own sheets, as the page would hand them to `exportGraphics`. */
function e3Sheet(n: number): Rgba | null {
  const file = `${scenarioDir('exile3')}/graphics/sheet${n}.png`;
  return existsSync(file) ? decodePng(readFileSync(file)) : null;
}

/** The 28×36 cell `cell` of `sheet`, as bytes. */
function cell(sheet: Rgba, n: number): number[] {
  const out: number[] = [];
  const x0 = 28 * (n % 10), y0 = 36 * Math.floor(n / 10);
  for (let y = 0; y < 36; y++) {
    const at = ((y0 + y) * sheet.width + x0) * 4;
    out.push(...sheet.data.subarray(at, at + 28 * 4));
  }
  return out;
}

const real = (it: Item) => it.variety !== ItemType.NO_ITEM;

describe.skipIf(!haveE3)('Exile III items entering a BoE scenario', () => {
  let e3: Scenario;
  let stealth: Scenario;
  beforeAll(async () => {
    [e3, stealth] = await Promise.all([load('exile3'), load('stealth')]);
  });

  it('are all custom pictures, so none would survive without the export', () => {
    const items = e3.scenItems.filter(real);
    expect(items.length).toBe(475);
    expect(items.filter(carriedOutOfScenario)).toEqual([]);
  });

  it('a party that wins Exile III keeps its E3 gear, codes and pictures in the next scenario', async () => {
    // Twenty items with E3 rules, no summoning (those still go: TODO(campaign)).
    const sample = e3.scenItems.filter((it) => real(it) && it.e3Ability > 0).slice(0, 20);
    expect(sample.length).toBe(20);

    const from = new Universe(e3, new GameRng(), PartyPreset.DEFAULT);
    const pc = from.party.pcs[0]!;
    pc.items = [...sample.map((it) => ({ ...it })), ...pc.items.slice(sample.length)].slice(0, pc.items.length);
    // `handle_victory`: the export, then the party alone, as the party in memory.
    exportGraphics(from, e3Sheet);
    const saved = saveGame(from, true);

    const univ = new Universe(stealth, new GameRng());
    applyPartySave(saved, univ);
    let told = 0;
    await new GameSession(univ).enterWithParty({
      removedSpecialItems: async () => { told++; },
      keepStoredItems: async () => false,
    }, true);

    const after = univ.party.pcs[0]!.items.filter(real);
    expect(told).toBe(0);
    expect(after.map((it) => [it.fullName, it.e3Ability])).toEqual(sample.map((it) => [it.fullName, it.e3Ability]));

    // Each picture is a party cell holding exactly E3's pixels, one cell per
    // distinct picture.
    const party = univ.party.exportSheet!;
    expect(party).not.toBeNull();
    const cells = new Map<number, number>();
    after.forEach((it, i) => {
      expect(it.graphicNum).toBeGreaterThanOrEqual(10000);
      const was = sample[i]!.graphicNum - 1000;
      cells.set(was, it.graphicNum - 10000);
      expect(cell(party, it.graphicNum - 10000)).toEqual(cell(e3Sheet(Math.floor(was / 100))!, was % 100));
    });
    expect(new Set(cells.values()).size).toBe(cells.size);
  });
});
