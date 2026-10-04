/**
 * Exile III's movies (`game/e3Movie.ts`), played headless on the
 * converted scenario: the drawing is stubbed, and the waits return at once on
 * a pretend clock.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import {
  E3Movie, MOVIE0_SPOTS, MOVIE1_END_FRAME, MOVIE1_FIRST_FRAME, MOVIE1_LOCS, MOVIE2_LOCS, MOVIES, MovieSkipped,
  type MovieGfx, type MovieParty, type MovieStage,
} from '../src/game/e3Movie';
import { readE3Town } from '../tools/e3convert/town';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir } from '../tools/e3convert/install';
import { loadExile3 } from './support/e3Quest';

const dir = findE3Dir();

/** A `MovieGfx` that draws nothing and keeps a log of what it would have. */
class StubGfx implements MovieGfx {
  clock = 0;
  captions: { frame: number; text: string }[] = [];
  sounds: number[] = [];
  waited = 0;
  skipAfter = Infinity;
  paintTerrain(stage: MovieStage): void {
    if (stage.caption) this.captions.push({ frame: stage.frame, text: stage.caption.text });
    stage.caption = null;
  }
  showTerrain(): void {}
  showSprites(): void {}
  sound(n: number): void { this.sounds.push(n); }
  wait(ms: number): Promise<void> {
    this.clock += ms;
    if (++this.waited > this.skipAfter) return Promise.reject(new MovieSkipped());
    return Promise.resolve();
  }
  now(): number { return this.clock; }
}

/** The dice: a fixed walk through 0..max, so a run is the same every time. */
function dice(): (min: number, max: number) => number {
  let n = 0;
  return (min, max) => min + (n++ % (max - min + 1));
}

describe.skipIf(!dir)("Exile III's intro movie", () => {
  const out = mkdtempSync(join(tmpdir(), 'e3movie-'));
  let scen: Scenario;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    scen = await loadExile3(out);
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('is set on town 84, Anim Data, with its creatures where TOWN.DAT puts them', () => {
    const movie = new E3Movie(scen, new StubGfx(), dice());
    const s = movie.stage;
    // Creature 28 is the first prisoner teleported in; 29 is an empty slot.
    expect(s.creatures[28]).toMatchObject({ active: true, number: 2, loc: { x: 30, y: 1 } });
    expect(s.creatures[29]!.active).toBe(false);
    expect(s.creatures).toHaveLength(60);
    // The PCs start off the map, with E3's four pictures.
    expect(s.pcs.map((p) => [p.loc.x, p.graphic])).toEqual([[50, 0], [50, 10], [50, 20], [50, 30]]);
    expect(s.frame).toBe(MOVIE1_FIRST_FRAME - 1);
  });

  it('plays through every frame and every line, in order', async () => {
    const gfx = new StubGfx();
    const movie = new E3Movie(scen, gfx, dice());
    await movie.play();
    expect(movie.stage.frame).toBe(MOVIE1_END_FRAME - 1);
    const lines = gfx.captions.map((c) => c.text);
    // Each line is posted on two or three frames running and drawn once per post.
    const distinct = lines.filter((t, i) => t !== lines[i - 1]);
    expect(distinct.slice(0, 3)).toEqual(['Exile (verb) -', 'To banish or expel ...', "from one's native land."]);
    expect(distinct).toContain('Emperor Hawthorne ruled the Empire. ');
    expect(distinct).toContain('Yes, Garzahd.');
    expect(distinct).toContain('... is a TREE!');
    expect(distinct.at(-1)).toBe('Good luck.');
    // The teleporter's hum, a magic flash's sound, and the doors' creak.
    expect(gfx.sounds).toContain(51);
    expect(gfx.sounds).toContain(10);
  });

  it('moves its players as the script says', async () => {
    const movie = new E3Movie(scen, new StubGfx(), dice());
    const s = movie.stage;
    const L = MOVIE1_LOCS;
    const to = async (frame: number): Promise<void> => {
      while (s.frame < frame) await movie.frame();
    };
    await to(300);
    expect(s.center).toEqual(L[0]);
    expect(s.terrain[0]![0]).toBe(0x56);
    await to(322);
    // The first prisoner arrives on the pad and is sent south, a step a frame.
    expect(s.terrain[5]![15]).toBe(0x4e);
    expect(s.creatures[28]!.loc).toEqual(L[0]);
    await to(326);
    const walked = s.creatures[28]!.loc;
    expect(walked.y).toBeGreaterThan(L[0]!.y);
    await to(334);
    expect([19, 11, 28, 12].map((i) => s.creatures[i]!.loc.x)).toEqual([50, 50, 50, 50]);
    await to(392);
    expect([20, 21, 22, 23].map((i) => s.creatures[i]!.loc)).toEqual([L[3], L[4], L[5], L[6]]);
    await to(407);
    // Three dead by now, each leaving blood behind.
    expect([11, 18, 12].map((i) => s.creatures[i]!.loc.x)).toEqual([50, 50, 50]);
    expect(s.sfx.flat().some((b) => b !== 0)).toBe(true);
    await to(430);
    expect(s.center).toEqual({ x: 4, y: 4 });
    expect(s.creatures.every((c) => c.loc.x === 50)).toBe(true);
    await to(473);
    expect(s.pcs.slice(0, 3).map((p) => p.loc)).toEqual([L[27], L[26], L[28]]);
  });

  it('stops where it is when skipped', async () => {
    const gfx = new StubGfx();
    gfx.skipAfter = 200;
    const movie = new E3Movie(scen, gfx, dice());
    await expect(movie.play()).rejects.toBeInstanceOf(MovieSkipped);
    expect(movie.stage.frame).toBeLessThan(MOVIE1_END_FRAME - 1);
  });
});

describe.skipIf(!dir)("Exile III's title movie and ending", () => {
  const out = mkdtempSync(join(tmpdir(), 'e3movie-'));
  let scen: Scenario;

  beforeAll(async () => {
    emitScenario(dir as string, out);
    scen = await loadExile3(out);
  }, 120000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("looks movie 0's squares up in TOWN.DAT's town 84, as `6b63` does", () => {
    const name = readdirSync(dir as string).find((n) => n.toUpperCase() === 'TOWN.DAT')!;
    const t = readE3Town(new Uint8Array(readFileSync(join(dir as string, name))), 84);
    for (const [id, at] of Object.entries(MOVIE0_SPOTS)) {
      const k = t.specId.findIndex((s) => s === Number(id));
      expect(t.specialLocs[k], `spot ${id}`).toEqual(at);
    }
  });

  it('plays movie 0, the raid on the temple, through every line', async () => {
    const gfx = new StubGfx();
    const movie = new E3Movie(scen, gfx, dice(), 0);
    const s = movie.stage;
    expect(s.frame).toBe(-1);
    // The temple's chest holds what movie 0 takes out of it.
    const chest = MOVIE0_SPOTS[8]!;
    const inChest = s.items.filter((i) => i.loc.x === chest.x && i.loc.y === chest.y);
    expect(inChest.length).toBeGreaterThan(0);
    await movie.play();
    expect(s.frame).toBe(MOVIES[0].end - 1);
    const lines = gfx.captions.map((c) => c.text).filter((t, i, a) => t !== a[i - 1]);
    expect(lines.slice(0, 3)).toEqual(["'Let's go!'", "'Varik's temple.'", "'Humans!'"]);
    expect(lines).toContain('(Click)');
    expect(lines).toContain("Throg's dead.");
    expect(lines.at(-1)).toBe('Oh, shut up.');
    // The secret door, opened.
    expect(s.terrain[19]![2]).toBe(0x77);
    // What was in the chest was revealed, then taken.
    expect(inChest.every((i) => !i.contained)).toBe(true);
    expect(inChest.filter((i) => i.present).length).toBe(Math.max(0, inChest.length - 4));
    // All four leave at the end.
    expect(s.pcs.every((p) => p.loc.x === 50)).toBe(true);
  });

  const party = (n: number, anama = false): MovieParty => ({
    pcs: Array.from({ length: n }, (_, i) => ({ graphic: i * 3, name: `Hero ${i}` })),
    anama,
  });

  it('plays movie 2, the ending, on town 66 with the party that won', async () => {
    const gfx = new StubGfx();
    const movie = new E3Movie(scen, gfx, dice(), 2, party(4));
    const s = movie.stage;
    expect(s.pcs.map((p) => p.graphic)).toEqual([0, 3, 6, 9]);
    const to = async (frame: number): Promise<void> => {
      while (s.frame < frame) await movie.frame();
    };
    await to(600);
    expect(s.center).toEqual(MOVIE2_LOCS[0]);
    expect(s.pcs.map((p) => p.loc)).toEqual(MOVIE2_LOCS.slice(1, 5));
    await to(628);
    expect(s.creatures[0]!.loc.x).toBe(40);
    // Four PCs come through to Blackcrag; the two empty slots are skipped.
    await to(668);
    expect(s.pcs.map((p) => p.loc)).toEqual(MOVIE2_LOCS.slice(7, 11));
    await movie.play();
    expect(s.frame).toBe(MOVIES[2].end - 1);
    const lines = gfx.captions.map((c) => c.text).filter((t, i, a) => t !== a[i - 1]);
    expect(lines[0]).toBe('The reaction is set into motion ...');
    expect(lines).toContain('Welcome, Hero 0              ');
    expect(lines).toContain('Welcome, Hero 3              ');
    expect(lines).toContain('So we have come full circle.           ');
    expect(lines).toContain('to be Dervishes of the Empire.    ');
    expect(lines).toContain('THE END');
    expect(lines).toContain('Jeff Vogel');
    expect(lines.at(-1)).toBe('Farewell, and goodnight.');
  });

  it("gives the Anama the Empress's other speech, and truncates a long name", async () => {
    const gfx = new StubGfx();
    const p = party(1, true);
    p.pcs[0]!.name = 'Bartholomew the Bold';
    await new E3Movie(scen, gfx, dice(), 2, p).play();
    const lines = gfx.captions.map((c) => c.text);
    expect(lines).toContain('I have found out you are Anama.           ');
    expect(lines).not.toContain('So we have come full circle.           ');
    expect(lines).toContain(`Welcome, ${'Bartholomew '}${' '.repeat(8)}`);
  });
});
