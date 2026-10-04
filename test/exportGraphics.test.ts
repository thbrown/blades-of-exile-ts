/**
 * `exportGraphics` — the party's picture sheet, built when a scenario is won —
 * and its trip through the save as `save/export.png`.
 */

import { describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemPreset, presetItem } from '../src/data/item';
import type { Rgba } from '../src/fileio/legacy/bmp';
import { decodePng, encodePng } from '../src/fileio/png';
import { applyPartySave, saveGame } from '../src/fileio/saveIo';
import { noScenario } from '../src/fileio/scenarioXml';
import { carriedOutOfScenario } from '../src/game/session';
import { exportGraphics, partySheetCells } from '../src/universe/exportGraphics';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';
import { zlibSync } from 'fflate';

/** A 280×360 sheet whose cell `c` is filled with the colour (c, sheet, 7, 255). */
function sheet(n: number): Rgba {
  const width = 280, height = 360;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = Math.floor(y / 36) * 10 + Math.floor(x / 28);
      data.set([c, n, 7, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** The colour at the top-left of party cell `n`. */
function cellColour(s: Rgba, n: number): number[] {
  const at = ((36 * Math.floor(n / 10)) * s.width + 28 * (n % 10)) * 4;
  return [...s.data.subarray(at, at + 4)];
}

function party(): Universe {
  return new Universe(noScenario(), new GameRng(), PartyPreset.DEFAULT);
}

function give(univ: Universe, pc: number, pics: number[]): void {
  const p = univ.party.pcs[pc]!;
  pics.forEach((pic, i) => {
    const it = presetItem(ItemPreset.KNIFE);
    it.graphicNum = pic;
    p.items[i] = it;
  });
}

describe('exportGraphics', () => {
  it('gives each different picture its own cell, and copies its pixels', () => {
    const univ = party();
    give(univ, 0, [1105, 2142, 1105, 1003]);
    exportGraphics(univ, sheet);
    const pics = univ.party.pcs[0]!.items.slice(0, 4).map((it) => it.graphicNum);
    // OBoE would put all three on cell 0 (DIVERGENCES.md #48).
    expect(pics).toEqual([10000, 10001, 10000, 10002]);
    const s = univ.party.exportSheet!;
    expect(cellColour(s, 0)).toEqual([5, 1, 7, 255]); // 1105: sheet 1, cell 5
    expect(cellColour(s, 1)).toEqual([42, 11, 7, 255]); // 2142: sheet 11, cell 42
    expect(cellColour(s, 2)).toEqual([3, 0, 7, 255]);
    expect(cellColour(s, 3)).toEqual([0, 0, 0, 0]); // untouched: transparent
  });

  it('keeps cells already exported, and fills around them', () => {
    const univ = party();
    give(univ, 0, [10000, 1009]);
    exportGraphics(univ, sheet);
    expect(univ.party.pcs[0]!.items[1]!.graphicNum).toBe(10001);
  });

  it('looks in stored items too', () => {
    const univ = party();
    const it = presetItem(ItemPreset.HELM);
    it.graphicNum = 1011;
    univ.party.storedItems.set(0, [it]);
    exportGraphics(univ, sheet);
    expect(it.graphicNum).toBe(10000);
  });

  it('starts at 50 cells and grows by rows', () => {
    const univ = party();
    give(univ, 0, Array.from({ length: 24 }, (_, i) => 1000 + i));
    give(univ, 1, Array.from({ length: 24 }, (_, i) => 1024 + i));
    give(univ, 2, Array.from({ length: 4 }, (_, i) => 1048 + i));
    exportGraphics(univ, sheet);
    const s = univ.party.exportSheet!;
    expect(s.width).toBe(280);
    expect(partySheetCells(s)).toBe(60);
    expect(cellColour(s, 51)).toEqual([51, 0, 7, 255]);
  });

  it('copies a cell its sheet does not reach as blank', () => {
    const univ = party();
    give(univ, 0, [1500]);
    exportGraphics(univ, () => null);
    expect(univ.party.pcs[0]!.items[0]!.graphicNum).toBe(10000);
    expect(cellColour(univ.party.exportSheet!, 0)).toEqual([0, 0, 0, 0]);
  });

  it('leaves a party with no custom pictures without a sheet', () => {
    const univ = party();
    exportGraphics(univ, sheet);
    expect(univ.party.exportSheet).toBeNull();
  });
});

describe('the party sheet in a save', () => {
  it('travels as save/export.png and comes back pixel for pixel', () => {
    const univ = party();
    give(univ, 0, [1105, 2142]);
    exportGraphics(univ, sheet);
    const saved = saveGame(univ, true);
    const back = new Universe(noScenario(), new GameRng());
    applyPartySave(saved, back);
    expect(back.party.exportSheet).not.toBeNull();
    expect(back.party.exportSheet!.width).toBe(univ.party.exportSheet!.width);
    expect([...back.party.exportSheet!.data]).toEqual([...univ.party.exportSheet!.data]);
    expect(back.party.pcs[0]!.items[1]!.graphicNum).toBe(10001);
  });

  it('a party with no sheet loads without one, over one that had', () => {
    const univ = party();
    give(univ, 0, [1105]);
    exportGraphics(univ, sheet);
    applyPartySave(saveGame(party(), true), univ);
    expect(univ.party.exportSheet).toBeNull();
  });
});

describe('carriedOutOfScenario and the party sheet', () => {
  it('keeps a picture that is the party\'s own, and strips one never exported', () => {
    const own = presetItem(ItemPreset.KNIFE);
    own.graphicNum = 10003;
    const stale = presetItem(ItemPreset.KNIFE);
    stale.graphicNum = 2142;
    expect(carriedOutOfScenario(own)).toBe(true);
    expect(carriedOutOfScenario(stale)).toBe(false);
  });
});

describe('decodePng', () => {
  it('reads back what encodePng wrote', () => {
    const s = sheet(3);
    expect([...decodePng(encodePng(s)).data]).toEqual([...s.data]);
  });

  it('undoes every filter, and reads RGB', () => {
    // A 3×2 RGB image, row 0 with Sub, row 1 with Paeth — what stb writes.
    const px = [[10, 20, 30], [40, 50, 60], [70, 80, 90], [15, 25, 35], [45, 55, 65], [75, 85, 95]];
    const paeth = (a: number, b: number, c: number): number => {
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const raw: number[] = [1];
    for (let x = 0; x < 3; x++) for (let k = 0; k < 3; k++) raw.push((px[x]![k]! - (x > 0 ? px[x - 1]![k]! : 0)) & 0xff);
    raw.push(4);
    for (let x = 0; x < 3; x++) {
      for (let k = 0; k < 3; k++) {
        const a = x > 0 ? px[3 + x - 1]![k]! : 0, b = px[x]![k]!, c = x > 0 ? px[x - 1]![k]! : 0;
        raw.push((px[3 + x]![k]! - paeth(a, b, c)) & 0xff);
      }
    }
    const rgba = encodePng({ width: 3, height: 2, data: new Uint8ClampedArray(24) });
    // Swap in an RGB header and the hand-filtered data.
    const png = rebuild(rgba, 3, 2, 2, zlibSync(new Uint8Array(raw)));
    const out = decodePng(png);
    expect([...out.data]).toEqual(px.flatMap((p) => [...p, 255]));
  });
});

/** `encodePng`'s output with a new IHDR colour type and IDAT. */
function rebuild(_like: Uint8Array, w: number, h: number, colour: number, idat: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // the decoder doesn't check CRCs
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, colour, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
