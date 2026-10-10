/**
 * The ninth round of play-test notes (2026-10-06; PROGRESS.md, "Play-test
 * notes, ninth round"): one test per finding that a rule, not a picture,
 * can pin. The screen-only ones — the item scrollbar during a shop's
 * service, the active PC on top of a shared square, the road on the map —
 * are checked by eye and by `verify-screen`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { TerSpec } from '../src/data/terrain';
import { animClear } from '../src/game/anim';
import { boomMs, boomSpace, setBoomSink, type Boom } from '../src/game/booms';
import { GameSession } from '../src/game/session';
import { autoKeys } from '../src/dialogs/autoKeys';
import { loadScenario } from '../src/fileio/loadScenario';
import { loadSave, saveGame } from '../src/fileio/saveIo';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { setLivingSound } from '../src/universe/living';
import { PartyPreset } from '../src/universe/player';
import { Skill } from '../src/universe/skills';
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
  const session = new GameSession(univ);
  session.startNewGame();
  return session;
}

/** E3's monsters as converted, by name. */
function e3Monster(name: string): Record<string, string> {
  const xml = readFileSync(new URL('../public/scenarios/exile3/monsters.xml', import.meta.url), 'utf8');
  for (const [, body] of xml.matchAll(/<monster id="\d+">([\s\S]*?)<\/monster>/g)) {
    if (!body!.includes(`<name>${name}</name>`)) continue;
    const out: Record<string, string> = {};
    for (const tag of ['level', 'armor', 'skill', 'hp', 'speed']) {
      out[tag] = new RegExp(`<${tag}>(.*?)</${tag}>`).exec(body!)?.[1] ?? '';
    }
    out['attack'] = /<attack type="[a-z]+">(.*?)<\/attack>/.exec(body!)?.[1] ?? '';
    return out;
  }
  throw new Error(`no ${name}`);
}

describe('the fight', () => {
  /**
   * 1997's `play_sound` blocks on any sound not in `always_asynch`, and OBoE's
   * busy-waits on it; only OBoE's WASM build skipped that. So a dual-wielder's
   * two blows, or a fireball's death cries, are heard one after another. Here
   * a blocking sound books its length on the animation timeline, and a hit's
   * sprite stays up for its sound and then its own pause.
   */
  it("gives each hit a slot of its own, the second blow after the first", () => {
    const booms: Boom[] = [];
    setBoomSink((b) => { booms.push(b); });
    setLivingSound(() => 300);
    try {
      boomSpace({ x: 1, y: 1 }, 0, 5, 0);
      boomSpace({ x: 2, y: 2 }, 0, 6, 0);
    } finally {
      setBoomSink(null);
      setLivingSound(null);
      animClear();
    }
    expect(booms.length).toBe(2);
    // The second blow starts once the first's slot is over. The slot is
    // BOOM_MS (paced), not the sound's length: the sound plays on under the
    // next blow (DIVERGENCES §63, 2026-10-09).
    expect(booms[1]!.starts).toBeGreaterThanOrEqual(booms[0]!.expires);
    expect(booms[0]!.expires - booms[0]!.starts).toBeCloseTo(boomMs());
  });

  /**
   * "Wargs are really hard to kill" and "bandit soldiers are gods of
   * dodging": both are as Exile III has them. The stats are E3's own
   * segment-39 arrays, and its `place_monster` (`1090:3d56`) copies the HP
   * as is, halved only on easy. A PC's to-hit (`1018:0edd`) is 1997's term
   * for term — the defender enters only through bless and curse; its armour
   * and level never do — and so is this port's (`pcAttack`).
   */
  it("reads E3's Worg and Soldier as the EXE has them", () => {
    expect(e3Monster('Worg')).toMatchObject({ level: '7', armor: '1', skill: '9', hp: '35', attack: '3d6' });
    expect(e3Monster('Soldier')).toMatchObject({ level: '4', armor: '8', skill: '8', hp: '20', attack: '2d7' });
  });
});

describe('doors', () => {
  /**
   * The room behind a door that gave way stayed black until the party moved,
   * while the monsters in it showed at once. Neither original updates the
   * explored map there; this port runs 1997's monster-door step
   * (MONSTER.C:1137) for the party too.
   */
  it('looks through a door the moment its lock gives way', async () => {
    let opened = false;
    for (let attempt = 0; attempt < 40 && !opened; attempt++) {
      const session = newSession();
      const town = session.univ.town!.record;
      let where: { x: number; y: number } | null = null;
      for (let x = 1; x < town.maxDim - 1 && !where; x++)
        for (let y = 1; y < town.maxDim - 1 && !where; y++)
          if (session.univ.terrainType(town.terrain[x]![y]!).special === TerSpec.UNLOCKABLE) where = { x, y };
      expect(where).not.toBeNull();
      // Bashable, and as easy as a lock gets.
      const spec = session.univ.terrainType(town.terrain[where!.x]![where!.y]!);
      const saved = [spec.flag2, spec.flag3] as const;
      spec.flag2 = 0;
      spec.flag3 = 1;
      session.univ.party.pcs[0]!.skills[Skill.STRENGTH] = 20;
      const looked: unknown[] = [];
      const update = session.updateExplored.bind(session);
      session.updateExplored = (at) => { looked.push(at); update(at); };
      const before = town.terrain[where!.x]![where!.y];
      try {
        await session.bashDoor(where!, 0);
      } finally {
        [spec.flag2, spec.flag3] = saved;
      }
      if (town.terrain[where!.x]![where!.y] === before) continue;
      opened = true;
      expect(looked).toContainEqual(session.univ.party.townLoc);
    }
    expect(opened).toBe(true);
  });

  /**
   * In Exile III only the party opens a secret door: the one creature door
   * code by terrain id (`1098:69f8`) is 103/120/108, never 101/118/133.
   */
  it("keeps a monster out of a secret door the party hasn't found", () => {
    const session = newSession();
    const town = session.univ.town!.record;
    let where: { x: number; y: number } | null = null;
    for (let x = 1; x < town.maxDim - 1 && !where; x++)
      for (let y = 1; y < town.maxDim - 1 && !where; y++)
        if (session.univ.terrainType(town.terrain[x]![y]!).special === TerSpec.CHANGE_WHEN_STEP_ON) where = { x, y };
    expect(where).not.toBeNull();
    const monst = session.univ.town!.monsters.find((m) => m.isAlive);
    expect(monst).toBeDefined();
    const ter = town.terrain[where!.x]![where!.y]!;
    const saved = scen.featureFlags['secret-doors'];
    scen.featureFlags['secret-doors'] = String(ter);
    try {
      expect(session.monstCheckSpecialTerrain(monst!, where!, 1)).toBe(false);
      expect(town.terrain[where!.x]![where!.y]).toBe(ter);
    } finally {
      if (saved === undefined) delete scen.featureFlags['secret-doors'];
      else scen.featureFlags['secret-doors'] = saved;
    }
  });
});

describe('M and P after a load', () => {
  /**
   * The spell M and P recast out of combat (`store_mage`, `store_priest`) and
   * each PC's in combat (`last_cast`) are memory only in both originals; a
   * load that reloads the page lost them. They are saved now.
   */
  it('come back with the save', () => {
    const session = newSession();
    session.mageStore = { spell: Spell.LIGHT, caster: 2, target: 6 };
    session.priestStore = { spell: Spell.HEAL_MINOR, caster: 1, target: 3 };
    const pc = session.univ.party.pcs[4]!;
    pc.lastCast[Skill.MAGE_SPELLS] = Spell.FLAME;
    pc.lastTarget[Skill.MAGE_SPELLS] = 6;

    const back = loadSave(saveGame(session.univ), scen, new GameRng());
    expect(back.party.mageStore).toEqual({ spell: Spell.LIGHT, caster: 2, target: 6 });
    expect(back.party.priestStore).toEqual({ spell: Spell.HEAL_MINOR, caster: 1, target: 3 });
    expect(back.party.pcs[4]!.lastCast[Skill.MAGE_SPELLS]).toBe(Spell.FLAME);
    expect(back.party.pcs[4]!.lastCast[Skill.PRIEST_SPELLS]).toBeUndefined();
  });
});

describe("a prompt's free keys", () => {
  const button = (name: string, label: string, left: number, key: string | null = null) =>
    ({ name, label, key, top: 100, left });

  it('numbers the choices and gives each its unclaimed first letter', () => {
    const keys = autoKeys([button('yes', 'Yes', 10), button('no', 'No', 80)], new Set());
    expect(keys.digits).toEqual(new Map([['1', 'yes'], ['2', 'no']]));
    expect(keys.letters.get('yes')).toEqual({ key: 'y', index: 0 });
    expect(keys.letters.get('no')).toEqual({ key: 'n', index: 0 });
  });

  it('leaves a letter two buttons share, and one already taken', () => {
    const keys = autoKeys([
      button('leave', 'Leave', 10), button('ladder', 'Ladder', 80), button('climb', 'Climb', 150),
    ], new Set(['c']));
    expect(keys.letters.has('leave')).toBe(false);
    expect(keys.letters.has('ladder')).toBe(false);
    expect(keys.letters.has('climb')).toBe(false);
  });

  it('gives no numbers where a digit already means something', () => {
    const keys = autoKeys([button('a', 'Alpha', 10), button('b', 'Beta', 80)], new Set(['1']));
    expect(keys.digits.size).toBe(0);
  });

  it("leaves a button's own key alone", () => {
    const keys = autoKeys([button('ok', 'OK', 10, 'k'), button('cancel', 'Cancel', 80)], new Set(['k']));
    // It is underlined, not reassigned.
    expect(keys.letters.get('ok')).toEqual({ key: 'k', index: 1 });
    expect(keys.letters.get('cancel')?.key).toBe('c');
  });
});
