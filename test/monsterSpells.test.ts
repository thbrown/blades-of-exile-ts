/**
 * Monsters casting — the level tables, the emergency picks, and the helpers
 * that choose where an area spell lands.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { Spell } from '../src/data/spell';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { Missile, setMissileSink } from '../src/game/missileAnim';
import {
  countLevels, findFireballLoc, monstCastMage, monstCastPriest, monstNear, pcNear,
} from '../src/game/monsterSpells';
import { Creature } from '../src/universe/creature';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Status } from '../src/universe/skills';
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

/** A fight, with the first live monster turned into a caster. */
function withCaster(mu = 3, cl = 0): { s: GameSession; m: Creature } {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  s.startCombat(s.univ.party.direction);
  const m = s.univ.town!.monsters.find((c) => c.isAlive)!;
  m.mon.mu = mu;
  m.mon.cl = cl;
  m.mp = 500;
  m.attitude = 1; // hostile
  return { s, m };
}

describe('the targeting helpers', () => {
  it('monst_near measures from the monster, and can demand it be alerted', async () => {
    const { s, m } = withCaster();
    expect(monstNear(m, m.curLoc, 0)).toBe(true);
    expect(monstNear(m, { x: m.curLoc.x + 9, y: m.curLoc.y }, 3)).toBe(false);
  });

  it('pc_near uses combat positions in a fight', async () => {
    const { s } = withCaster();
    const pc = s.univ.party.pcs[0]!;
    expect(pcNear(s, pc, pc.combatPos, 0)).toBe(true);
    expect(pcNear(s, pc, { x: pc.combatPos.x + 9, y: pc.combatPos.y }, 2)).toBe(false);
  });

  it('a dead PC is never near anything', async () => {
    const { s } = withCaster();
    const pc = s.univ.party.pcs[0]!;
    pc.mainStatus = MainStatus.DEAD;
    expect(pcNear(s, pc, pc.combatPos, 5)).toBe(false);
  });

  it('count_levels scores PCs up and hostile monsters down', async () => {
    const { s } = withCaster();
    const pc = s.univ.party.pcs[0]!;
    // A PC in combat is worth a flat 10 wherever they stand.
    const here = countLevels(s, pc.combatPos, 0);
    expect(here).toBeGreaterThanOrEqual(10);
  });

  it('find_fireball_loc gives up when nothing is worth hitting', async () => {
    const { s, m } = withCaster();
    // Everyone has to be out of the way, not just the party: `count_levels`
    // scores party-friendly *monsters* too, and the start town is full of
    // guards and townspeople.
    for (const pc of s.univ.party.pcs) pc.combatPos = { x: 40, y: 40 };
    for (const other of s.univ.town!.monsters) {
      if (other !== m) other.curLoc = { x: 44, y: 44 };
    }
    const { at } = findFireballLoc(s, m.curLoc, 1, false);
    expect(at.x).toBe(-1);
  });

  it('find_fireball_loc finds the party when they are bunched up', async () => {
    const { s, m } = withCaster();
    const spot = { x: m.curLoc.x + 4, y: m.curLoc.y };
    for (const pc of s.univ.party.pcs) pc.combatPos = { ...spot };
    const { at, levels } = findFireballLoc(s, m.curLoc, 1, false);
    expect(levels).toBeGreaterThan(10);
    expect(at.x).toBeGreaterThanOrEqual(0);
  });
});

describe('monst_cast_mage', () => {
  it('a caster in an antimagic field can do nothing', async () => {
    const { s, m } = withCaster();
    s.univ.town!.setField(m.curLoc.x, m.curLoc.y, FieldType.FIELD_ANTIMAGIC, true);
    expect(await monstCastMage(s, m, 0)).toBe(false);
  });

  it('refuses a dead target', async () => {
    const { s, m } = withCaster();
    s.univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;
    expect(await monstCastMage(s, m, 0)).toBe(false);
  });

  it('casts, announces it, and pays for it', async () => {
    const { s, m } = withCaster(3);
    const before = m.mp;
    expect(await monstCastMage(s, m, 0)).toBe(true);
    expect(m.mp).toBeLessThan(before);
    expect(s.univ.transcript.some((l) => l.endsWith('casts:'))).toBe(true);
  });

  it('a caster with no points gains one instead of casting', async () => {
    const { s, m } = withCaster(7);
    m.mp = 0;
    expect(await monstCastMage(s, m, 0)).toBe(false);
    expect(m.mp).toBe(1);
  });

  it('every level of the table produces a spell it can actually cast', async () => {
    for (let level = 1; level <= 7; level++) {
      const { s, m } = withCaster(level);
      for (let i = 0; i < 20; i++) {
        m.mp = 500;
        m.health = m.maxHealth;
        const before = s.univ.transcript.length;
        await monstCastMage(s, m, 0);
        const said = s.univ.transcript.slice(before).join(' | ');
        expect(said, `mage level ${level}`).not.toContain('not implemented');
      }
    }
  });
});

describe('monst_cast_priest', () => {
  it('casts and pays for it', async () => {
    const { s, m } = withCaster(0, 3);
    const before = m.mp;
    expect(await monstCastPriest(s, m, 0)).toBe(true);
    expect(m.mp).toBeLessThan(before);
  });

  it('every level of the table produces a spell it can actually cast', async () => {
    for (let level = 1; level <= 7; level++) {
      const { s, m } = withCaster(0, level);
      for (let i = 0; i < 20; i++) {
        m.mp = 500;
        m.health = m.maxHealth;
        const before = s.univ.transcript.length;
        await monstCastPriest(s, m, 0);
        const said = s.univ.transcript.slice(before).join(' | ');
        expect(said, `priest level ${level}`).not.toContain('not implemented');
      }
    }
  });

  it('a badly hurt caster reaches for the panic column', async () => {
    // Level 1 priest, below a quarter health: emergency[0][3] is Minor Heal,
    // and the roll takes it nine times in ten.
    const { s, m } = withCaster(0, 1);
    m.maxHealth = 100;
    m.health = 10;
    let healed = false;
    for (let i = 0; i < 25 && !healed; i++) {
      m.health = 10;
      m.mp = 500;
      const before = s.univ.transcript.length;
      await monstCastPriest(s, m, 0);
      if (s.univ.transcript.slice(before).some((l) => l.includes('Minor Heal'))) healed = true;
    }
    expect(healed).toBe(true);
  });

  it('a caster at full health swaps its big heals for something useful', async () => {
    // HEAL_ALL becomes Summon Host when there is nothing to heal.
    const { s, m } = withCaster(0, 6);
    m.health = m.maxHealth;
    let sawHealAll = false;
    for (let i = 0; i < 40; i++) {
      m.mp = 500;
      const before = s.univ.transcript.length;
      await monstCastPriest(s, m, 0);
      if (s.univ.transcript.slice(before).some((l) => l.includes('Heal All'))) sawHealAll = true;
    }
    expect(sawHealAll).toBe(false);
  });
});

describe('SUMMON_HOST', () => {
  // boe.combat.cpp:3777. `x = get_ran(3,1,4) + 1` sits **above** the summons,
  // so the leader (126) and up to four of 125 all share one duration. Rolling
  // per creature is five draws where the C++ makes one, and every draw after
  // it lands somewhere else.
  it('rolls the duration once for the whole host', async () => {
    const { s, m } = withCaster(0, 6);
    // Give the caster room, so the summons actually land.
    const rng = s.univ.rng;
    const drawn: string[] = [];
    const real = rng.getRan.bind(rng);
    rng.getRan = (times: number, lo: number, hi: number): number => {
      drawn.push(`${times},${lo},${hi}`);
      return real(times, lo, hi);
    };
    await monstCastPriest(s, m, Spell.SUMMON_HOST);
    rng.getRan = real;
    expect(drawn.filter((d) => d === '3,1,4')).toHaveLength(1);
  });

  it('gives every summoned creature the same duration', async () => {
    const { s, m } = withCaster(0, 6);
    const town = s.univ.town!;
    const before = town.monsters.filter((c) => c.isAlive).length;
    await monstCastPriest(s, m, Spell.SUMMON_HOST);
    const summoned = town.monsters.filter((c) => c.isAlive && c.summonTime > 0);
    // Nothing to assert if the square was too crowded for any of them to land.
    if (town.monsters.filter((c) => c.isAlive).length === before) return;
    expect(summoned.length).toBeGreaterThan(0);
    expect(new Set(summoned.map((c) => c.summonTime)).size).toBe(1);
  });
});

describe("a monster's spell flies", () => {
  // `monst_cast_mage`/`monst_cast_priest` open every aimed arm with
  // `run_a_missile(l, ...)` — the 1997 COMBAT.CPP's as well as OBoE's — and this
  // port had left every one of them out, so a slime's Spark simply landed.
  // Level-1 mages roll Spark, Minor Haste, Strength and Flame Cloud: two of
  // those fly and two don't, which is the whole check.
  // Flame is the haste's stand-in for an already-hasted caster.
  const FLYING = ['  Spark', '  Flame Cloud', '  Flame'];
  it('a Spark or a Flame Cloud crosses to the target; a haste does not', async () => {
    const { s, m } = withCaster(1);
    const pc = s.univ.party.pcs[0]!;
    const missiles: Missile[] = [];
    setMissileSink((x) => missiles.push(x));
    try {
      let flying = 0;
      for (let i = 0; i < 30; i++) {
        m.mp = 500;
        m.health = m.maxHealth;
        m.status[Status.HASTE_SLOW] = 0;
        const before = s.univ.transcript.length;
        await monstCastMage(s, m, 0);
        const said = s.univ.transcript.slice(before);
        if (said.some((l) => FLYING.includes(l))) flying++;
      }
      expect(flying).toBeGreaterThan(0);
      expect(missiles).toHaveLength(flying);
      for (const x of missiles) {
        expect(x.from).toEqual(m.curLoc);
        expect(x.dest).toEqual(pc.combatPos);
        expect([6, 2]).toContain(x.type);
      }
    } finally {
      setMissileSink(null);
    }
  });

  it("a priest's Wrack flies too", async () => {
    const { s, m } = withCaster(0, 1);
    const missiles: Missile[] = [];
    setMissileSink((x) => missiles.push(x));
    try {
      let wracks = 0;
      for (let i = 0; i < 30; i++) {
        m.mp = 500;
        m.health = m.maxHealth;
        const before = s.univ.transcript.length;
        await monstCastPriest(s, m, 0);
        if (s.univ.transcript.slice(before).includes('  Wrack')) wracks++;
      }
      expect(wracks).toBeGreaterThan(0);
      expect(missiles.filter((x) => x.type === 8).length).toBeGreaterThanOrEqual(wracks);
    } finally {
      setMissileSink(null);
    }
  });
});
