/**
 * The shift-M / shift-P recast shortcut — `repeat_cast_ok` (boe.party.cpp:521)
 * and the two places the last spell is remembered.
 *
 * The pair worth keeping straight: **out of combat** the game remembers one
 * spell per kind for the whole party (`store_mage`/`store_priest`, written by
 * `do_mage_spell` itself), while **in combat** each PC remembers their own
 * (`last_cast`, written by `finish_pick_spell`). Two of these tests exist to
 * pin that difference.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { resetFeatureFlags, setFeatureFlags } from '../src/game/featureFlags';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { DEFAULT_MAGE, NO_TARGET, SpellPick } from '../src/game/spellPick';
import { repeatCastOk, storedSpell } from '../src/game/spellRepeat';
import { doMageSpell } from '../src/game/spellTown';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
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

function newGame(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const s = new GameSession(univ);
  s.startTownMode(0, FORCED_ENTRY);
  // Everyone rested and able to cast.
  for (const pc of univ.party.pcs) {
    pc.curSp = pc.maxSp = 50;
    pc.skills[Skill.MAGE_SPELLS] = 7;
    pc.skills[Skill.PRIEST_SPELLS] = 7;
  }
  return s;
}

afterEach(() => { resetFeatureFlags(); });

describe('repeating the last spell', () => {
  it('refuses when nothing has been cast yet, and says which list', () => {
    const s = newGame();
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBeNull();
    expect(s.univ.transcript.at(-1)).toBe('Repeat cast: No mage spell stored.');
    expect(repeatCastOk(s, Skill.PRIEST_SPELLS)).toBeNull();
    expect(s.univ.transcript.at(-1)).toBe('Repeat cast: No priest spell stored.');
  });

  /**
   * `do_mage_spell` writes the store itself (boe.party.cpp:631), so *any* cast
   * arms the shortcut — not only one made through the picker.
   */
  it('remembers a spell cast out of combat, whoever cast it', () => {
    const s = newGame();
    s.univ.curPc = 2;
    doMageSpell(s, 2, Spell.LIGHT);
    expect(s.mageStore.spell).toBe(Spell.LIGHT);
    expect(s.mageStore.caster).toBe(2);
    expect(storedSpell(s, Skill.MAGE_SPELLS, 2)).toBe(Spell.LIGHT);
    // The priest store is untouched — they are separate.
    expect(s.priestStore.spell).toBe(Spell.NONE);
  });

  it('lets the shortcut fire once something is stored', () => {
    const s = newGame();
    doMageSpell(s, 0, Spell.LIGHT);
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBe(0);
  });

  it('refuses when the caster can no longer manage it', () => {
    const s = newGame();
    doMageSpell(s, 0, Spell.LIGHT);
    s.univ.party.pcs[0]!.curSp = 0;
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBeNull();
    expect(s.univ.transcript.at(-1)).toBe("Repeat cast: Can't cast.");
  });

  /**
   * The `store-spell-caster` flag. Without it the shortcut casts from whoever
   * the game *currently* thinks is casting, which is the behaviour every
   * recording made before the fix depends on; with it, from whoever cast it.
   */
  it('picks the caster according to the store-spell-caster flag', () => {
    const s = newGame();
    s.univ.curPc = 3;
    doMageSpell(s, 3, Spell.LIGHT);
    s.univ.curPc = 1;

    setFeatureFlags({});
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBe(1);

    setFeatureFlags({ 'store-spell-caster': ['fixed'] });
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBe(3);
  });

  /**
   * `finish_pick_spell` records `last_cast` **per PC**, which is what the
   * in-combat half of the shortcut reads. A spell needing no target records
   * target 6 rather than whatever happened to be selected.
   */
  it('records the pick on the caster, with no target for a spell that needs none', () => {
    const s = newGame();
    const pick = new SpellPick(s, Skill.MAGE_SPELLS, true);
    pick.caster = 4;
    pick.spell = Spell.LIGHT;
    pick.target = 2;
    expect(pick.finish()).not.toBeNull();

    const pc = s.univ.party.pcs[4]!;
    expect(pc.lastCast[Skill.MAGE_SPELLS]).toBe(Spell.LIGHT);
    expect(pc.lastTarget[Skill.MAGE_SPELLS]).toBe(NO_TARGET);
    // And nobody else's memory was touched.
    expect(s.univ.party.pcs[0]!.lastCast[Skill.MAGE_SPELLS]).toBeUndefined();
  });

  /**
   * `pick_spell` opens on a spell already chosen — the last one of its kind,
   * or Light/Heal Minor when there hasn't been one — so a Cast with nothing
   * clicked casts *that*. "No spell selected." is only reachable when the pick
   * has actually been cleared, which is what changing caster does.
   */
  it('opens on a default spell rather than on nothing', () => {
    const s = newGame();
    const pick = new SpellPick(s, Skill.MAGE_SPELLS, true);
    expect(pick.spell).toBe(DEFAULT_MAGE);
    expect(pick.page).toBe(0);
    expect(pick.finish()?.spell).toBe(DEFAULT_MAGE);
  });

  it('refuses to finish with no spell selected', () => {
    const s = newGame();
    const pick = new SpellPick(s, Skill.MAGE_SPELLS, true);
    pick.spell = Spell.NONE;
    expect(pick.finish()).toBeNull();
    expect(s.univ.transcript.at(-1)).toBe('Cast: No spell selected.');
  });

  it('refuses to finish a targeted spell with nobody picked', () => {
    const s = newGame();
    const pick = new SpellPick(s, Skill.MAGE_SPELLS, true);
    // Minor Haste needs a party member chosen (SELECT_ACTIVE).
    pick.spell = Spell.HASTE_MINOR;
    pick.target = NO_TARGET;
    expect(pick.finish()).toBeNull();
    expect(s.univ.transcript.at(-1)).toBe('Cast: Need to select target.');
  });

  /** Cast is not available at all when the game is mid-something. */
  it('will not fire outside prime time', () => {
    const s = newGame();
    doMageSpell(s, 0, Spell.LIGHT);
    s.startShopMode(0, 100, 'shop');
    expect(repeatCastOk(s, Skill.MAGE_SPELLS)).toBeNull();
  });
});
