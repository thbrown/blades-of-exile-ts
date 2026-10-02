/**
 * Saved games for the original Exile III, one for each question in
 * `E3-CHECK-IN-ORIGINAL.md`: a strong party, the story flags and items the
 * question needs, and the party standing outdoors beside the place to go,
 * written as `exile3.sav` files (`src/fileio/e3SaveExport.ts`).
 *
 *     E3_CHECK_SAVES=<dir> npx vitest run test/e3checkSaves.test.ts
 *
 * writes `<dir>/Q01.SAV`… and `<dir>/README.TXT` saying what each is. The
 * names are 8.3, since the original is a Windows 3.1 program. Without the
 * variable this only checks that every recipe still runs.
 *
 * Each recipe uses the quest runner the quest tests use, so a flag is set
 * the way play here sets it, and the port's state is what gets written. A
 * recipe with an `inside` stands the party in the town, by the place to
 * look (the exporter writes the town whole, `e3SaveTown.ts`); its outdoor
 * square is still the one beside the way in, where E3 puts it on leaving.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { TerObstruct } from '../src/data/terrain';
import { isE3Save, readE3Save } from '../src/fileio/e3save';
import { e3SaveDefaultsFromJson, type E3SaveDefaults } from '../src/fileio/e3SaveDefaults';
import { exportE3Save } from '../src/fileio/e3SaveExport';
import { applyE3Save } from '../src/fileio/e3SaveImport';
import { MainStatus, Skill } from '../src/universe/skills';
import { emitScenario } from '../tools/e3convert/emitNode';
import { findE3Dir, readE3Files } from '../tools/e3convert/install';
import { partySpecItem } from '../tools/e3convert/script';
import { readE3ShopTables } from '../tools/e3convert/shops';
import { QuestRunner, loadExile3 } from './support/e3Quest';

const dir = findE3Dir();
const outDir = process.env['E3_CHECK_SAVES'];

/** One save: its file name, the question it's for, and how to make it. */
interface Recipe {
  file: string;
  question: string;
  /** What to do once loaded, for the README. */
  todo: string;
  make: (q: QuestRunner) => Promise<void>;
  /** Where in town to stand once `make` is done: by a square, a spot, or someone. */
  inside?: Inside;
}

interface Inside {
  town: number;
  at?: [number, number];
  /** A spot, by its E3 number (`debug.json`). */
  spot?: number;
  near?: RegExp;
}

describe.skipIf(!dir)('saves for E3-CHECK-IN-ORIGINAL.md', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'e3check-'));
  let scen: Scenario;
  let defaults: E3SaveDefaults;
  /** Every spell E3 teaches somewhere, by school: its shops' lists and a new PC's. */
  let e3Spells: { mage: Set<number>; priest: Set<number> };

  beforeAll(async () => {
    emitScenario(dir as string, tmp);
    scen = await loadExile3(tmp);
    defaults = e3SaveDefaultsFromJson(readFileSync(join(tmp, 'e3save.json'), 'utf8'));
    const shops = readE3ShopTables(readE3Files(dir as string).exe);
    const start = (b: Uint8Array) => [...b.keys()].filter((i) => b[i] !== 0);
    e3Spells = {
      mage: new Set([...shops.mage.map((e) => e.spell), ...start(defaults.mageSpells)]),
      priest: new Set([...shops.priest.map((e) => e.spell), ...start(defaults.priestSpells)]),
    };
  }, 120000);
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /**
   * A party that can survive getting there: level 25, 200 health, every
   * spell E3 sells, its skills near E3's caps, 5,000 gold and 500 food.
   */
  const veteran = (q: QuestRunner): void => {
    const skills: [Skill, number][] = [
      [Skill.STRENGTH, 12], [Skill.DEXTERITY, 12], [Skill.INTELLIGENCE, 12], [Skill.EDGED_WEAPONS, 12],
      [Skill.BASHING_WEAPONS, 12], [Skill.POLE_WEAPONS, 12], [Skill.THROWN_MISSILES, 8], [Skill.ARCHERY, 8],
      [Skill.DEFENSE, 10], [Skill.MAGE_SPELLS, 7], [Skill.PRIEST_SPELLS, 7], [Skill.MAGE_LORE, 6],
      [Skill.ALCHEMY, 4], [Skill.ITEM_LORE, 4], [Skill.DISARM_TRAPS, 8], [Skill.LOCKPICKING, 10],
      [Skill.ASSASSINATION, 4], [Skill.POISON, 4], [Skill.LUCK, 6],
    ];
    for (const pc of q.party.pcs) {
      pc.mainStatus = MainStatus.ALIVE;
      pc.level = 25;
      pc.experience = 0;
      pc.maxHealth = pc.curHealth = 200;
      pc.maxSp = pc.curSp = 100;
      for (const [s, v] of skills) pc.skills[s] = v;
      for (const k of e3Spells.mage) pc.mageSpells[k] = true;
      for (const k of e3Spells.priest) pc.priestSpells[k] = true;
      // Ghikra's crystal teaches it (spot 11), and no shop sells it.
      pc.mageSpells[Spell.BLESS_MAJOR] = true;
      pc.status.fill(0);
    }
    q.party.gold = 5000;
    q.party.food = 500;
  };

  /** Outdoors on the clear square nearest `town`'s entrance (its first, if several). */
  const besideTown = async (q: QuestRunner, town: number): Promise<void> => {
    for (let sx = 0; sx < scen.outWidth; sx++) {
      for (let sy = 0; sy < scen.outHeight; sy++) {
        const sector = scen.outdoors[sx]![sy]!;
        const city = sector.cityLocs.find((c) => c.spec === town);
        if (!city) continue;
        // The nearest clear square, ring by ring: some doors (the Slime
        // Pit's) have only rock and water right beside them.
        const near: [number, number][] = [];
        for (let r = 1; r <= 3; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) near.push([dx, dy]);
        }
        for (const [dx, dy] of near) {
          const x = city.x + dx, y = city.y + dy;
          if (x < 0 || y < 0 || x > 47 || y > 47) continue;
          const ter = scen.terTypes[sector.terrain[x]![y]!]!;
          if (ter.blockage >= TerObstruct.BLOCK_MOVE || ter.boatOver) continue;
          if (sector.cityLocs.some((c) => c.x === x && c.y === y) || sector.specialLocs.some((s) => s.x === x && s.y === y)) continue;
          await q.outdoors(sx, sy, x, y);
          return;
        }
      }
    }
    throw new Error(`town ${town} has no entrance outdoors`);
  };

  /** Into `w.town`, on the open square nearest the place named. */
  const goInside = async (q: QuestRunner, w: Inside): Promise<void> => {
    await q.enter(w.town);
    let target = w.at ? { x: w.at[0], y: w.at[1] } : undefined;
    if (w.spot !== undefined) {
      const spots = JSON.parse(readFileSync(join(tmp, 'debug.json'), 'utf8')) as { towns: Record<string, { id: number; x: number; y: number }[]> };
      const s = spots.towns[w.town]?.find((l) => l.id === w.spot);
      if (!s) throw new Error(`town ${w.town} has no spot ${w.spot}`);
      target = { x: s.x, y: s.y };
    }
    if (w.near) {
      const who = q.creatures(w.near)[0];
      if (!who) throw new Error(`nobody called ${w.near} in town ${w.town}`);
      target = who.curLoc;
    }
    if (!target) return;
    // The square itself if the party can stand there (even on a spot: being
    // put there runs nothing), but never on the person, nor on a spot named
    // as the place to step onto; then ring by ring,
    // off the spots.
    for (let r = w.near || w.spot !== undefined ? 1 : 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { x: target.x + dx, y: target.y + dy };
          if (!q.town.isOnMap(p.x, p.y) || q.session.townIsBlocked(p)) continue;
          if (r > 0 && q.town.record.specialLocs.some((l) => l.x === p.x && l.y === p.y)) continue;
          q.place(p);
          return;
        }
      }
    }
    throw new Error(`nowhere to stand near (${target.x},${target.y}) in town ${w.town}`);
  };

  /** Outdoors at (gx, gy) of the whole map. */
  const at = (q: QuestRunner, gx: number, gy: number): Promise<void> => q.outdoorsAt(gx, gy);

  const ORB = 6;
  /** `town`'s square, reached through `entrance` (the level with a door outdoors). */
  const sanctify = (file: string, town: number, square: string, at: [number, number], note = '', entrance = town): Recipe => ({
    file, inside: { town, at },
    question: `#3, the Ritual of Sanctification in ${square}`,
    todo: `Walk in, go to ${square}, and cast the Ritual of Sanctification on it (every PC knows it).${note}`,
    make: async (q) => {
      scen.towns[town]!.canFind = true;
      scen.towns[entrance]!.canFind = true;
      await besideTown(q, entrance);
    },
  });

  const recipes: Recipe[] = [
    {
      file: 'Q01.SAV', inside: { town: 125, at: [37, 39] },  question: "#1 and #2, Colchis's secret door and Move Mountains' rubble",
      todo: 'Walk into Colchis. Walk into (36,39) from (37,39) a few times. Then cast Move Mountains on the moldy wall at (36,40). '
        + 'For #2 underground, take the party into any cave and cast it on a stone wall there.',
      make: async (q) => { await besideTown(q, 125); },
    },
    sanctify('Q03A.SAV', 44, 'the Goblin Lair at (44,2)', [44, 2]),
    sanctify('Q03B.SAV', 45, 'the Bandit Hideout at (22,2)', [22, 2]),
    sanctify('Q03C.SAV', 46, 'the Agate Tower at (12,19)', [12, 19], ' It is the level with Jordan in it: the door outside is another of the tower\'s levels (town 90).', 90),
    sanctify('Q03D.SAV', 4, 'Shayder at (20,14)', [20, 14]),
    sanctify('Q03E.SAV', 48, 'the Friendly, Happy Spiders at (11,15)', [11, 15], ' Cast it twice: does it repeat?'),
    sanctify('Q03F.SAV', 51, 'the Lair of the Ursagi at (43,3) and (43,4)', [43, 3]),
    sanctify('Q03G.SAV', 101, 'the Troglo Temple, level 2, at (25,13) and (28,25)', [25, 13], ' Level 2 is down the stairs from level 1.', 53),
    sanctify('Q03H.SAV', 28, 'Castle Troglo at (14,38)', [14, 38], ' Under Castle Troglo, (7,56), needs Q07.SAV\'s state and the walk through the cell.'),
    sanctify('Q03I.SAV', 78, 'the Monastery of Madness at (24,5)', [24, 5]),
    sanctify('Q03J.SAV', 62, 'the Great Circle at (23,24)', [23, 24]),
    {
      file: 'Q04.SAV', inside: { town: 22, at: [3, 60] },  question: "#4, the Slime Pit's pedestal before any button is pressed",
      todo: "Walk into the Slime Pit. Don't touch the pedestal at (32,30). Take the far west stairs at (2,60) down, and see whether the portcullis just past them is open.",
      make: async (q) => { scen.towns[22]!.canFind = true; await besideTown(q, 22); },
    },
    {
      file: 'Q05.SAV', inside: { town: 4, near: /Bernathy/ },  question: '#5, Mayor Bernathy\'s reward for the Filth Factory',
      todo: 'Walk into Shayder, go to City Hall (Bernathy is at about (51,37)), ask her about "mission", and note the gold before and after.',
      make: async (q) => {
        await q.enter(4);
        await q.talk(/Bernathy/, 'miss');
        // The factory burned: the flags Filth Factory 2's heart sets.
        q.setFlag(0xc87, 1);
        q.party.specItems.add(partySpecItem(0x42));
        await besideTown(q, 4);
      },
    },
    {
      file: 'Q06.SAV', inside: { town: 4, near: /Ahonar/ },  question: '#6, an Anama member training Mage Spells',
      todo: "The party has joined the Anama (everyone's Mage Spells is 0). Find a trainer, raise a PC's Mage Spells, then go back to Shayder's temple: try the members-only doors and the altar, and talk to Ahonar.",
      make: async (q) => {
        for (const [t, who, word] of [[127, /Father Rice/, 'beli'], [129, /Mother Loomis/, 'shar'], [131, /Mother Melamed/, 'phil']] as const) {
          await q.enter(t);
          q.answer('Yes');
          await q.talk(who, word);
        }
        await q.enter(4);
        await q.talk(/Ahonar/, 'join');
        expect(q.flag(0xac), q.tail()).toBe(3);
        await besideTown(q, 4);
      },
    },
    {
      file: 'Q07.SAV', inside: { town: 28, near: /Vothkaro/ },  question: "#7, King Vothkaro's question",
      todo: "The party carries the troglodytes' pass, and Castle Troglo's stage is 3 (the cell door has opened twice). Walk into Castle Troglo, find Vothkaro in the throne room and talk to him; when he asks about the scroll, answer the button that isn't Yes. Then ask again.",
      make: async (q) => {
        q.party.specItems.add(partySpecItem(0x5e));
        q.setFlag(0xe8, 2);
        q.setFlag(0x1a4, 3);
        await besideTown(q, 28);
      },
    },
    {
      file: 'Q08.SAV', inside: { town: 31, at: [50, 23] },  question: "#8, the giants' rune panel",
      todo: 'The party has the giant\'s key. Walk into the Caves of the Giants, down to the lower caves (the upper caves\' stairs), through the padlocked door to the rune at about (50,23). Press the two bottom-left buttons, then the two on the right; note the runes and the door. Then try 7, 5, 6, 2, 4, 6.',
      make: async (q) => {
        q.party.specItems.add(partySpecItem(0x2e));
        q.setFlag(0x122, 1);
        await besideTown(q, 30);
      },
    },
    {
      file: 'Q09.SAV', inside: { town: 54 },  question: "#9, the Concealed Tunnel's moving walls",
      todo: "Walk into the Concealed Tunnel. Push its five barrels into the pits to lift the barrier at the door (24,42); past it, stand in a moving wall's path with room behind you, then with a wall behind you, and summon a creature into a wall's path.",
      make: async (q) => { scen.towns[54]!.canFind = true; await besideTown(q, 54); },
    },
    {
      file: 'Q10.SAV', inside: { town: 103 },  question: "#10, the Barrier Cavern's crystal",
      todo: 'Through the Concealed Tunnel (as Q09) to the Barrier Cavern. Smash the crystal on its pedestal, and look at the two great barriers before leaving.',
      make: async (q) => { scen.towns[54]!.canFind = true; await besideTown(q, 54); },
    },
    {
      file: 'Q11.SAV', inside: { town: 30 },  question: "#11, the giants' four prisoners",
      todo: 'Commander Bruskrud has asked for help, and the concealed way out of the upper caves is found. Walk into the Caves of the Giants (upper) and ask each of the four prisoners, two men and two women, about "escape".',
      make: async (q) => {
        q.setFlag(0x122, 1);
        q.setFlag(0x1b0, 1);
        await besideTown(q, 30);
      },
    },
    {
      file: 'Q12.SAV', question: '#12, Zalifar and the spire, before the drake',
      todo: 'The party has the Orb of Thralni. Use it and fly east over the peaks to (318,106), land, go south into the Remote Aerie, and ask Zalifar about "spire" before anything else.',
      make: async (q) => { q.party.specItems.add(ORB); await at(q, 315, 106); },
    },
    {
      file: 'Q13.SAV', inside: { town: 167 },  question: "#13, the spires' barrier rings",
      todo: 'Walk into the golem spire, and walk round its ring of force barriers before dispelling anything: is a diagonal side missing?',
      make: async (q) => { scen.towns[167]!.canFind = true; await besideTown(q, 167); },
    },
    {
      file: 'Q14.SAV', inside: { town: 107, near: /Dalakros/ },  question: '#14, killing Dalakros',
      todo: 'Walk into the Drake Aerie, refuse Dalakros the food, kill him, then fly (the Orb) to the Remote Aerie as in Q12 and ask Zalifar about "assistance". Does he help at once?',
      make: async (q) => { q.party.specItems.add(ORB); scen.towns[107]!.canFind = true; await besideTown(q, 107); },
    },
    {
      file: 'Q15.SAV', question: '#15, flying',
      todo: 'The party has the Orb of Thralni. Fly and count the moves aloft; come down on lava; take it to the far north (zone columns 1-2 of the top row) and use it; use it while in a boat.',
      make: async (q) => { q.party.specItems.add(ORB); await at(q, 315, 106); },
    },
    {
      file: 'Q16.SAV', question: '#16, leaving the fortress under Tinraya',
      todo: "The party has the Murder Cave's key and the Bunker's Thought Crystal. Go west into the Keep of Tinraya, down its stairs, through the cell and the Crystal Souls (as the walkthroughs do), and out by the west side of the level below. Where do you come out?",
      make: async (q) => {
        q.party.specItems.add(partySpecItem(0x20));
        q.party.specItems.add(partySpecItem(0x4e));
        await at(q, 79, 63);
      },
    },
    {
      file: 'Q17.SAV', inside: { town: 36, at: [28, 7] },  question: '#17, the rune doors under Tinraya, without the key',
      todo: 'No keys. Go west into the Keep of Tinraya and down its stairs; try to pick, bash or Unlock the rune-covered doors at (28,7) and (12,32).',
      make: async (q) => { await at(q, 79, 63); },
    },
    {
      file: 'Q18.SAV', inside: { town: 21, at: [3, 58] },  question: "#18, Fort Emergence's little cell",
      todo: 'Walk into Fort Emergence, go to its far southwest corner, open the secret door at (2,58) and walk into (1,59) and (2,59). (A new game starts in the fort, too.)',
      make: async (q) => { await besideTown(q, 21); },
    },
    {
      file: 'Q19.SAV', inside: { town: 38, spot: 4 },  question: "#19, Rentar-Ihrno's panel",
      todo: "Every lever below is pulled (the ten channel flags). Go east into the Keep of Rentar-Ihrno, fight to her pedestal, and on the panel press Begin Process first. Does the panel stay up?",
      make: async (q) => {
        for (let k = 0; k < 10; k++) q.setFlag(0x304 + k, 1);
        scen.towns[38]!.canFind = true;
        await at(q, 425, 85);
      },
    },
    {
      file: 'Q20.SAV', inside: { town: 74, at: [21, 30] },  question: "#20, the Lair of Drakos's shifting floor",
      todo: "The Lair of Drakos is on the map. Go east into it, to the floor of pillars (x 19-25, y 26-28). From (21,30) make walkthrough A's moves: NW, W, E, W, E, E, E, E, W, E, then N. Does north open?",
      make: async (q) => { scen.towns[74]!.canFind = true; await at(q, 122, 312); },
    },
    {
      file: 'Q21.SAV', inside: { town: 77, at: [15, 42] },  question: "#21, the way back across the Pit of the Wyrm's charged floor",
      todo: 'The Pit of the Wyrm is on the map, just east. Go down to level 2, pull the lever behind the southernmost crypt door '
        + '(the rune at the end of the mausoleum hall unseals them), and cross the floor room from its door at (15,42): '
        + 'E, N, N, E, S, E, S, E, E, N, N, E, then N twice to the bier. Then make walkthrough A\'s way back from (21,39): S first. '
        + 'Does it zap?',
      make: async (q) => { scen.towns[76]!.canFind = true; await at(q, 260, 130); },
    },
    {
      file: 'Q22.SAV', question: '#22, walking to the Pit of the Wyrm through the mountain passes',
      todo: 'The Pit of the Wyrm is on the map. From here, east of Bremerton, walk (no flying) north round the lake by the bridge at '
        + '(227,129), east through the hills, and try the mountains at (273,129) and (272,129) heading west, then (261,127) and '
        + '(260,127). Do they let you through?',
      make: async (q) => { scen.towns[76]!.canFind = true; await at(q, 235, 131); },
    },
    {
      file: 'Q23.SAV', inside: { town: 72, at: [3, 17] },  question: "#23, the Remote Cave's crate",
      todo: 'The Remote Cave is just west. Go in, west to the white mushrooms at (32,1), due south to (32,14), and on west to the '
        + "door at (15,1). Stand at (3,17), north of the three crates, and make walkthrough A's moves: S, N x15, NW, E x7, NE, "
        + 'then S twice. Is the crate now one square south of the party, at (10,4)? (The port needs a third S for that.)',
      make: async (q) => { await at(q, 57, 68); },
    },
    {
      file: 'Q24.SAV', question: "#24, Foxfire's key and the Monastery of Madness",
      todo: "No key, and the monastery isn't on the map. Walk north into its square at (331,463): does anything happen? Then go "
        + 'back (the stones west of here, the boat people, Storm Port\'s ferry), find Foxfire in Bengaro, Poulsbo or Malloc, buy her '
        + 'key ("payment", 500 gold), and come back. Is the monastery on the map now, and does it let you in?',
      make: async (q) => { await at(q, 331, 464); },
    },
    {
      file: 'Q25.SAV', inside: { town: 70 },  question: "#25, the Tower of Zkal's drain on spell points, and Zkal's death",
      todo: 'The Tower of Zkal is on the map, a step south-west. Walk in, note a PC\'s spell points, wait (Space) ten turns and look '
        + 'again; then start a fight and watch them over ten rounds. Do they drop by 5 every fifth turn? Later, on level 2, '
        + 'kill Zkal (the Lich) and walk back through the tunnels: do new undead appear?',
      make: async (q) => { scen.towns[70]!.canFind = true; await besideTown(q, 70); },
    },
    {
      file: 'Q27.SAV', question: '#27, when Colchis\'s slimes first notice you',
      todo: 'The party has never seen a slime. Step south into Colchis by its north gate, read "This is very odd...", then take one step. Does "Monster saw you!" come before the step or after? Reload and try again a few times.',
      make: async (q) => { await q.outdoors(3, 9, 10, 29); },
    },
  ];

  it('makes every save, and each loads back here to the same place', async () => {
    const readme: string[] = [
      'Saved games for E3-CHECK-IN-ORIGINAL.md, made by blades-of-exile-ts (test/e3checkSaves.test.ts).',
      'Load each in Exile III with File > Open. Every party is level 25 with 200 health, knows every',
      "spell Exile III sells (and Major Blessing), and has 5,000 gold. A save that says \"in\" a town",
      'starts there, by the place to look (skip the walk in); the rest are outdoors. What to do is under each name.',
      '',
    ];
    if (outDir) mkdirSync(outDir, { recursive: true });
    for (const r of recipes) {
      const q = new QuestRunner(scen);
      veteran(q);
      await r.make(q);
      expect(q.session.isOutdoors, r.file).toBe(true);
      const outLoc = { ...q.party.outLoc };
      if (r.inside) await goInside(q, r.inside);
      const { bytes, warnings } = exportE3Save(q.univ, defaults);
      expect(warnings, r.file).toEqual([]);
      expect(isE3Save(bytes)).toBe(true);
      // It reads back here to the same square and the same flags (rows 300 on
      // carry what `init_party` sets, `newE3PartyRecord`).
      const back = new QuestRunner(scen);
      const res = applyE3Save(bytes, back.univ, defaults);
      expect(back.party.outLoc, r.file).toEqual(outLoc);
      expect(readE3Save(bytes).inTown, r.file).toBe(r.inside !== undefined);
      if (r.inside) expect(res.town?.loc, r.file).toEqual(q.party.townLoc);
      expect(back.party.stuffDone.slice(0, 300).map((row) => [...row.slice(0, 10)]), r.file)
        .toEqual(q.party.stuffDone.slice(0, 300).map((row) => [...row.slice(0, 10)]));
      const inTown = r.inside ? `in ${scen.towns[q.townNum]!.name} at (${q.party.townLoc.x}, ${q.party.townLoc.y}); outside, ` : '';
      const where = `${inTown}square (${q.global.x}, ${q.global.y}) of the world map: zone (${q.party.outdoorCorner.x + q.party.iwc.x}, ${q.party.outdoorCorner.y + q.party.iwc.y}), (${q.party.locInSec.x}, ${q.party.locInSec.y}) in it`;
      readme.push(`${r.file}  ${r.question}`, `  The party: ${where}.`, `  ${r.todo}`, '');
      if (outDir) writeFileSync(join(outDir, r.file), bytes);
    }
    if (outDir) writeFileSync(join(outDir, 'README.TXT'), readme.join('\r\n'));
  }, 120000);
});
