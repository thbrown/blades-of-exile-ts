/**
 * `create_pc` (boe.party.cpp:249) — the four dialogs behind the Create PC
 * button, and the rules under them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  PcGraphicPick, RaceAbilPick, SpendXp, XpMode, newPc, pcNameOk, xpSkillMax,
} from '../src/game/createPc';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Race, Skill, Trait } from '../src/universe/skills';
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

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

describe('new_pc', () => {
  it('starts the three stats at one, not zero', () => {
    const s = inTown();
    const pc = newPc(s.univ, 5);
    expect(pc.skills[Skill.STRENGTH]).toBe(1);
    expect(pc.skills[Skill.DEXTERITY]).toBe(1);
    expect(pc.skills[Skill.INTELLIGENCE]).toBe(1);
    expect(pc.skills[Skill.EDGED_WEAPONS]).toBe(0);
    expect(pc.maxHealth).toBe(6);
    expect(pc.skillPts).toBe(65);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
  });

  /**
   * The six preset PCs claim 1000-1005 and push the counter past them
   * (pc.cpp:1037), so a new character is 1006 without the test arranging it.
   * This used to set `nextPcId` by hand, which hid a real bug: the port never
   * advanced the counter, so the first `newPc` handed out 1000 again and
   * collided with slot 0 — invisible until `STORE_PC` keyed a map by it.
   */
  it('takes the next id and moves the party on', () => {
    const s = inTown();
    expect(s.univ.party.nextPcId).toBe(1006);
    expect(newPc(s.univ, 5).uniqueId).toBe(1006);
    expect(s.univ.party.nextPcId).toBe(1007);
  });
});

describe('pick_race_abil', () => {
  it('toggles a disadvantage on and off again', () => {
    const s = inTown();
    const pc = newPc(s.univ, 5);
    const pick = new RaceAbilPick(pc);
    // bad1 is eTrait 10, SLUGGISH.
    expect(pick.click('bad1')).toBe('stay');
    expect(pick.traits[Trait.SLUGGISH]).toBe(true);
    pick.click('bad1');
    expect(pick.traits[Trait.SLUGGISH]).toBe(false);
  });

  it('numbers the advantages from zero and the disadvantages from ten', () => {
    const s = inTown();
    const pick = new RaceAbilPick(newPc(s.univ, 5));
    pick.click('good1');
    pick.click('bad7');
    expect(pick.traits[Trait.TOUGHNESS]).toBe(true);
    expect(pick.traits[Trait.ANAMA]).toBe(true);
  });

  it('keeps nothing until done', () => {
    const s = inTown();
    const pc = newPc(s.univ, 5);
    const pick = new RaceAbilPick(pc);
    pick.click('race3');
    pick.click('good2');
    expect(pc.race).toBe(Race.HUMAN);
    expect(pc.traits[Trait.MAGICALLY_APT]).toBe(false);
    pick.keep();
    expect(pc.race).toBe(Race.SLITH);
    expect(pc.traits[Trait.MAGICALLY_APT]).toBe(true);
  });
});

describe('spend_xp, mode 0', () => {
  it('spends health two at a time for one skill point', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    expect(xp.hp).toBe(6);
    expect(xp.skp).toBe(65);
    xp.click('hp-p');
    expect(xp.hp).toBe(8);
    expect(xp.skp).toBe(64);
    xp.click('hp-m');
    expect(xp.hp).toBe(6);
    expect(xp.skp).toBe(65);
  });

  it('will not push health below six', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.click('hp-m');
    expect(xp.hp).toBe(6);
    expect(xp.skp).toBe(65);
  });

  it('will not push a stat below one, or another skill below zero', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.click('str-m');
    expect(xp.skills[Skill.STRENGTH]).toBe(1);
    xp.click('edged-m');
    expect(xp.skills[Skill.EDGED_WEAPONS]).toBe(0);
  });

  it('charges each skill its own point cost', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.click('str-p'); // 3 points
    expect(xp.skp).toBe(62);
    xp.click('lockpick-p'); // 1 point
    expect(xp.skp).toBe(61);
    xp.click('mage-p'); // 6 points
    expect(xp.skp).toBe(55);
  });

  it('spends no gold, and refuses a step it cannot pay for', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const goldBefore = s.univ.party.gold;
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.skp = 2;
    expect(xp.click('mage-p')).toBe('stay'); // costs 6
    expect(xp.skills[Skill.MAGE_SPELLS]).toBe(0);
    expect(xp.skp).toBe(2);
    xp.click('keep');
    xp.keep();
    expect(s.univ.party.gold).toBe(goldBefore);
  });

  it('stops at the skill cap', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.skp = 999;
    for (let i = 0; i < 40; i++) xp.click('mage-p');
    expect(xp.skills[Skill.MAGE_SPELLS]).toBe(xpSkillMax(Skill.MAGE_SPELLS));
  });

  it('reports an alt-click rather than changing anything', () => {
    const s = inTown();
    newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    expect(xp.click('edged-p', true)).toBe('info');
    expect(xp.skills[Skill.EDGED_WEAPONS]).toBe(0);
    expect(xp.skp).toBe(65);
  });

  it('commits only on keep, and carries current health with maximum', () => {
    const s = inTown();
    const pc = newPc(s.univ, 5);
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.click('hp-p');
    xp.click('edged-p');
    expect(pc.maxHealth).toBe(6);
    xp.keep();
    expect(pc.maxHealth).toBe(8);
    expect(pc.curHealth).toBe(8);
    expect(pc.skills[Skill.EDGED_WEAPONS]).toBe(1);
    expect(pc.skillPts).toBe(65 - 1 - 2);
  });

  it('does not curse an Anama who takes mage spells at creation', () => {
    const s = inTown();
    const pc = newPc(s.univ, 5);
    pc.traits[Trait.ANAMA] = true;
    const xp = new SpendXp(s.univ, 5, XpMode.CREATE);
    xp.click('mage-p');
    xp.keep();
    expect(pc.traits[Trait.ANAMA]).toBe(true);
    expect(pc.skills[Skill.STRENGTH]).toBe(1);
  });
});

describe('pick_pc_graphic', () => {
  it('reads the LED number as an index into the page', () => {
    const pick = new PcGraphicPick(0);
    pick.click('group');
    pick.click('led25');
    expect(pick.cur).toBe(24);
  });

  it('opens on the page holding the current graphic', () => {
    // Thirty-six to a page, so 36 is the only picture on page 1.
    expect(new PcGraphicPick(36).page).toBe(1);
    expect(new PcGraphicPick(35).page).toBe(0);
  });

  it('wraps both ways through its two pages', () => {
    const pick = new PcGraphicPick(0);
    pick.click('left');
    expect(pick.page).toBe(1);
    pick.click('right');
    expect(pick.page).toBe(0);
  });
});

describe('pick_pc_name', () => {
  it('refuses an empty name and one that does not start with a letter', () => {
    expect(pcNameOk('')).toBe(false);
    expect(pcNameOk('3rd')).toBe(false);
    expect(pcNameOk(' Kent')).toBe(false);
    expect(pcNameOk('Kent')).toBe(true);
  });
});
