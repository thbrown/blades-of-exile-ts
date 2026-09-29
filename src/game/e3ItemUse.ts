/**
 * Using an Exile III item — E3's own `use_item` (`FUN_10c0_2c92`), for any
 * item that carries an E3 ability code (`Item.e3Ability`).
 *
 * 1997's `use_item` (SPECIALS.CPP) grew out of this function and keeps its
 * shape — the use-code table, the four mode gates, "Use: %s", a switch on the
 * ability — but the switch is E3's own: one case per E3 code, each with its
 * own message and its own sums on the item's *level* (+2), where BoE reads an
 * ability strength and a help/harm use type. bladbase's namesakes are Jeff's
 * BoE retuning, so an E3 item played by BoE's rules drinks, zaps and summons
 * by the wrong numbers — and worse, the converter leaves E3's byte +8 in the
 * item's use type, which BoE reads as "harm one", so a healing potion hurt.
 *
 * Every case was read from the disassembly (`nedis.py 10c0:2c92`; the jump
 * table at `cs:3cb1` is indexed by code − 3), since the decompiler drops every
 * far call's arguments. Codes 160–183, the books and notes, are not here: the
 * converter turns those into scenario specials (`tools/e3convert/notes.ts`).
 * Nor is 135, the Skribbane Herb (`e3UsesOwnRules`).
 *
 * `project/exile3.c` addresses are Ghidra's; see `tools/e3convert/FORMATS.md`.
 */
import type { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { ItemType, canUse, type Item } from '../data/item';
import { Attitude, DamageType } from '../data/monster';
import { SpellPat } from '../data/pattern';
import { Spell } from '../data/spell';
import { removeCharge } from '../universe/inventory';
import { MainStatus, PartyStatus, Skill, Status, Trait } from '../universe/skills';
import type { Player } from '../universe/player';
import { damagePc } from './damage';
import { GameMode } from './modes';
import { summonMonster } from './monsterPlace';
import { poisonWeapon } from './poisonWeapon';
import type { GameSession } from './session';
import type { SpecialHost } from './specials/context';
import { doShockwave } from './spellCombat';
import { startSpellTargeting } from './spellCombatTarget';
import { placeSpellPattern } from './spellPatterns';
import { startTownTargeting } from './spellTarget';
import { increaseLight } from './spellTown';

/**
 * E3's use codes by ability (`1140:0000`, int16s), as 1997's `abil_chart`:
 * 0 anywhere, 1 combat only, 2 not in combat, 3 not outdoors, 4 can't be
 * used, 5 outdoors only; 10 or more is the same less 10, and a magically
 * inept PC may use it. 104–108 and 184 on are never read by an item.
 */
export const E3_USE_CODE: readonly number[] = [
  4, 4, 4, 0, 0, 1, 1, 1, 11, 4, 2, 4, 10, 4, 4, 1, 4, 4, 3, 1,
  0, 2, 1, 1, 0, 4, 1, 1, 0, 0, 1, 0, 4, 4, 4, 4, 0, 1, 1, 1,
  0, 2, 4, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1,
  0, 4, 5, 0, 0, 4, 4, 0, 4, 10, 4, 3, 3, 3, 4, 4, 3, 4, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 0, 0, 3, 1, 3, 4, 4, 4, 4, 4, 4, 4, 4,
  1, 4, 4, 4, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 3, 3, 0, 4, 4, 0,
  4, 0, 4, 1, 1, 1, 1, 4, 4, 4, 0, 4, 4, 0, 4, 10,
];

/** The first of E3's readable items, which the converter scripts instead. */
const E3_NOTE_ABILITIES = 160;
/** The Skribbane Herb: its addiction needs E3's strings (see `e3UsesOwnRules`). */
const E3_SKRIBBANE = 135;

/**
 * Whether Using this item runs E3's switch rather than BoE's. TODO(E3-3): the
 * Skribbane Herb (135, `10c0:3b74`) is E3's addiction — two dialogs (message
 * block 0x37, string 0x14, or 0x15 from the tenth herb on), each PC's health
 * up 22 − herbs eaten and spell points (if any) 15 − that, both only for the
 * first nine; then the addiction (party+0x12d) up 5, or 3 once over 20, and
 * over 10 the withdrawal clock (party+0x137) set to 150. `FUN_10c0_61c4`
 * winds that clock down one in ten, every tenth tick; at 0 it shows 0x37:0x16
 * and cuts everyone's health and spell points to 3/5, takes one off the
 * addiction and, still over 10, sets the clock to 100. The strings are E3's,
 * which the converter doesn't write out for the engine yet, so the herb keeps
 * BoE's path, where it can't be used.
 */
export function e3UsesOwnRules(e3Ability: number): boolean {
  return e3Ability >= 0 && e3Ability < E3_NOTE_ABILITIES && e3Ability !== E3_SKRIBBANE;
}

/**
 * Whether the inventory offers USE for this item: for E3's items, a use code
 * other than 4 (as 1997's `abil_chart` gates the button), else BoE's rule.
 * Without this, an E3 code with no BoE namesake (the wines, the Wand of
 * Pyhrrus, Scroll: Major Haste…) had no button at all.
 */
export function offersUse(item: Item): boolean {
  if (e3UsesOwnRules(item.e3Ability)) return (E3_USE_CODE[item.e3Ability] ?? 4) !== 4;
  return canUse(item) && (item.rechargeable ? item.charges > 0 : true);
}

/**
 * E3's `use_item` from its first gate to its tail. The caller spends the
 * action points and the turn afterwards, as for BoE's (`handle_use_item`).
 */
export async function e3UseItem(
  session: GameSession, pcNum: number, slot: number, host?: SpecialHost,
): Promise<void> {
  const univ = session.univ;
  const party = univ.party;
  const pc = party.pcs[pcNum];
  const item = pc?.items[slot];
  if (!pc || !item) return;
  const say = (line: string): void => univ.addStringToBuf(line);
  const rng = univ.rng;
  const code = item.e3Ability;
  const level = item.itemLevel;

  let useCode = E3_USE_CODE[code] ?? 4;
  let ineptOk = false;
  if (useCode >= 10) {
    useCode -= 10;
    ineptOk = true;
  }
  let userLoc: Location = { x: 0, y: 0 };
  if (session.isOutdoors) userLoc = { ...party.outLoc };
  if (session.inTown) userLoc = { ...party.townLoc };
  if (session.mode === GameMode.COMBAT) userLoc = { ...univ.currentPc.combatPos };

  let takeCharge = true;
  if (useCode === 4) {
    say("Use: Can't use this item.");
    takeCharge = false;
  }
  if (pc.traits[Trait.MAGICALLY_INEPT] && !ineptOk) {
    say("Use: Can't - magically inept.");
    takeCharge = false;
  }
  if (takeCharge) {
    const mode = session.mode;
    if (mode === GameMode.OUTDOORS && useCode > 0 && useCode !== 5) {
      say('Use: Not while outdoors.');
      takeCharge = false;
    }
    if (mode === GameMode.TOWN && useCode === 1) {
      say('Use: Not while in town.');
      takeCharge = false;
    }
    if (mode === GameMode.COMBAT && useCode === 2) {
      say('Use: Not in combat.');
      takeCharge = false;
    }
    if (mode !== GameMode.OUTDOORS && useCode === 5) {
      say('Use: Only outdoors.');
      takeCharge = false;
    }
  }
  if (!takeCharge) return;

  say(`Use: ${item.ident ? item.fullName : item.name}`);
  // E3's byte +8, which the converter leaves in the use type of anything that
  // isn't a weapon: 1 on the potions one drinks, 0 on powders and crystals.
  if (item.variety === ItemType.POTION && item.magicUseType === 1) host?.sound(56);

  // E3 writes most statuses straight into the record, with no cap.
  const addStatus = (p: Player, s: Status, n: number): void => {
    p.status[s] = (p.status[s] ?? 0) + n;
  };
  // `start_spell_targeting(1000 + n)` (`1018:c3d1`). An item's spell is cast
  // at level 6, whoever uses it (`1018:1ff2`), where a PC's own is their
  // level / 2 + 1 — the figure the port's `itemSpellLevel` stands for.
  const target = (spell: Spell): void => startSpellTargeting(session, spell, true, 6);
  const summon = (which: number, duration: number): void => {
    if (!summonMonster(session, which, userLoc, duration, Attitude.FRIENDLY, true)) say('  Summon failed.');
  };

  switch (code) {
    case 3: // Healing potions
      say('  You are healed.');
      pc.heal((rng.getRan(1, 0, 6) + 6) * (level * 2 + 2));
      break;
    case 4: // Curing potions
      say('  You are cured.');
      pc.cure(level * 2 + 3);
      break;
    case 5:
      say('  It fires a bolt of flame.');
      target(Spell.FLAME);
      break;
    case 6:
      say('  It shoots a fireball.');
      target(Spell.FIREBALL);
      break;
    case 8: // Poisons, on a weapon
      takeCharge = poisonWeapon(univ, pcNum, level, false, (s) => host?.sound(s), true);
      break;
    case 10: { // Orb of Sight. 1997 added the "It doesn't work." town flag.
      say('  You have a vision.');
      const town = univ.town;
      const size = univ.townRecord?.maxDim ?? 0;
      if (town) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) town.makeExplored(i, j);
      break;
    }
    case 12: // Candle, lamp, torches
      say('  You have light.');
      increaseLight(session, level * 50);
      break;
    case 15: // No item has it.
      say('  You feel strange.');
      addStatus(pc, Status.MAGIC_RESISTANCE, rng.getRan(1, 0, 3) + level + 6);
      break;
    case 18: // Strength potions, the Shield of Klin
      say('  You feel stronger.');
      addStatus(pc, Status.BLESS_CURSE, level * 2 + 3);
      break;
    case 19:
      say('  A green ray emerges.');
      target(Spell.POISON);
      break;
    case 20: // Energy potions, the Power Geode, the Ring of Magery
      say('  Your energy increases.');
      pc.restoreSp(level * 15 + 15);
      break;
    case 21: // Scroll: Stealth. A byte in E3 (party+0xc6e), so it can wrap.
      say('  You fade into the shadows.');
      party.partyStatus[PartyStatus.STEALTH] =
        ((party.partyStatus[PartyStatus.STEALTH] ?? 0) + rng.getRan(1, 0, 10) + 15) & 0xff;
      break;
    case 22: // Scroll: Firestorm, the Fire Orb Necklace
      say('  You fling a missile.');
      target(Spell.FIRESTORM);
      break;
    case 23:
      say('  It turns black and hums.');
      target(Spell.KILL);
      break;
    case 24: // Ambrosia, a Mist Globe, the Shield of Khar
      say('  You are healed fully.');
      pc.heal(200);
      break;
    case 26: // Speed potions, the Boots of Apollo, the Quicksilver Band
      say('  You speed up.');
      addStatus(pc, Status.HASTE_SLOW, level + 2);
      break;
    case 27: // Invulnerability potions, the Brew of Ironskin
      say('  You feel strange.');
      addStatus(pc, Status.INVULNERABLE, rng.getRan(1, 0, 1) + level + 6);
      break;
    case 28: // Poison Potion, Dust of Choking, a Mist Globe
      say('  You feel very, very ill.');
      pc.poison(level + 5, rng);
      break;
    case 29: // Potion of Doom: each of the three stats one nearer 0.
      say('  You burn in agony.');
      for (const s of [Skill.STRENGTH, Skill.DEXTERITY, Skill.INTELLIGENCE]) {
        const v = pc.skills[s] ?? 0;
        pc.skills[s] = v < 0 ? v + 1 : v > 0 ? v - 1 : v;
      }
      pc.poison(4, rng);
      break;
    case 30: // Potion of Bliss
      say('  You feel wonderful!');
      pc.heal(rng.getRan(level * 2 + 4, 1, 10));
      addStatus(pc, Status.BLESS_CURSE, level * 2 + 3);
      pc.cure(level * 2 + 3);
      break;
    case 31: // Skill potions, the Brew of Knowledge
      say('  You feel competent.');
      pc.skillPts += level * 2 + 2;
      break;
    case 36: // Scroll: Magic Res. Everyone, living or not.
      say('  You all tingle gently.');
      for (const p of party.pcs) addStatus(p, Status.MAGIC_RESISTANCE, rng.getRan(1, 0, 4) + level * 3 + 4);
      break;
    case 37:
      say('  The ground shakes!');
      await doShockwave(session, univ.currentPc.combatPos);
      break;
    case 38:
      say('  It fires a ball of ice.');
      target(Spell.ICE_BOLT);
      break;
    case 39:
      say('  It fires a purple ray.');
      target(Spell.SLOW);
      break;
    case 40: // A Mist Globe
      say('  You become stronger.');
      pc.skills[Skill.STRENGTH] = Math.min(20, (pc.skills[Skill.STRENGTH] ?? 0) + 2);
      break;
    case 41: // The Piercing Crystal: Dispel Barrier on a square in town.
      say('  You fling the gem.');
      startTownTargeting(session, Spell.DISPEL_BARRIER, univ.curPc, true, SpellPat.SINGLE, 6);
      break;
    case 43: // The Wand of Carrunos
      say('  It shoots a fiery red ray.');
      target(Spell.STRENGTHEN_TARGET);
      break;
    case 44:
      say('  It shoots a white ray.');
      target(Spell.DISPEL_UNDEAD);
      break;
    case 45:
      say('  It shoots a golden ray.');
      target(Spell.RAVAGE_SPIRIT);
      break;
    case 59: // Graymold Salve: 3 off everyone's disease.
      say('  You apply the salve.');
      say('  You feel healthier!');
      for (const p of party.pcs) p.status[Status.DISEASE] = Math.max(0, (p.status[Status.DISEASE] ?? 0) - 3);
      break;
    case 60: // The wines
      say("  That's good stuff! (Hic.)");
      addStatus(pc, Status.BLESS_CURSE, -3);
      break;
    case 63: // Brew and Powder of Lethe
      say('  You feel light headed.');
      pc.experience = Math.max(0, pc.experience - rng.getRan(10, 1, 10));
      break;
    case 71: // Serpent Rings: level + 1 serpents (asps from gold).
      for (let i = 0; i < level + 1; i++) summon(99 + Math.trunc(level / 2), rng.getRan(6, 1, 4));
      break;
    case 72: // Gold Statue
      summon(101, 50);
      break;
    case 73: // Ivory Bug
      summon(130, rng.getRan(5, 1, 4));
      break;
    case 76: // Ebony Lizard, Scale Necklace
      summon(72, rng.getRan(5, 1, 4));
      break;
    case 78: // Sapphire Necklace
      say('  It shoots a blue sphere.');
      target(Spell.WALL_ICE_BALL);
      break;
    case 79: // Potion of Clarity
      say('  Your mind clears.');
      pc.status[Status.DUMB] = 0;
      break;
    case 80:
      say('  You feel loved.');
      target(Spell.CHARM_FOE);
      break;
    case 81: // Wand of Nullity
      say('  Your hair stands on end.');
      target(Spell.ANTIMAGIC);
      break;
    case 82: // Wand of Pyhrrus: blade walls all round the user (`1018:a598`).
      say('  Boom.');
      await placeSpellPattern(session, SpellPat.RADIUS_2, userLoc, { field: FieldType.WALL_BLADES, whoHit: 6 });
      break;
    case 83: // Wand of Vorb
      say("  You don't feel very well.");
      await damagePc(univ, pc, 250, DamageType.UNBLOCKABLE);
      break;
    case 84: // Wand of Rats
      say('  The wand vibrates.');
      target(Spell.SUMMON_RAT);
      break;
    case 85: // Goo Bomb
      say('  It explodes!');
      target(Spell.GOO_BOMB);
      break;
    case 86: // Orb of Foul Vapors
      say('  It explodes!');
      target(Spell.FOUL_VAPOR);
      break;
    case 87: // Dust of Hiding. E3 loops over the party but writes the user
      // six times — plainly meant for everyone; kept.
      say('  The dust makes you hard to see.');
      for (let i = 0; i < 6; i++) pc.status[Status.INVISIBLE] = 6;
      break;
    case 88: // Cleansing Powder
      say('  You feel cleansed.');
      pc.status[Status.WEBS] = 0;
      pc.status[Status.DISEASE] = 0;
      break;
    case 89: { // Horn of Warriors: a captain, then soldiers. The count is
      // rolled afresh at each test of the loop.
      const duration = rng.getRan(6, 1, 4);
      for (let i = 0; i < rng.getRan(1, 4, 6); i++) summon(i === 0 ? 14 : 13, duration);
      break;
    }
    case 90: // Shield of Klud
      say('  Sparks fly.');
      target(Spell.SHOCKSTORM);
      break;
    case 91: // Alabaster Lizard
      summon(103, rng.getRan(6, 1, 4));
      break;
    case 100: // Martyr's Shield
      say('  You become protected.');
      pc.status[Status.MARTYRS_SHIELD] = Math.min(16, (pc.status[Status.MARTYRS_SHIELD] ?? 0) + 8);
      break;
    case 115: // Brew of Battle
      say('You are filled with battle lust!');
      pc.status[Status.BLESS_CURSE] = 8;
      pc.status[Status.HASTE_SLOW] = 8;
      break;
    case 119: // No item has it.
      say('Everyone is now awake!');
      for (const p of party.pcs) if ((p.status[Status.ASLEEP] ?? 0) > 0) p.status[Status.ASLEEP] = 0;
      break;
    case 121: // Basic Powder
      say('Your skin tingles refreshingly.');
      pc.status[Status.ACID] = 0;
      break;
    case 123: // Shield of Kron
      say('  It creates a cloud of gas.');
      target(Spell.CLOUD_SLEEP_LARGE);
      break;
    case 124:
      say('  Acid sprays from the tip!');
      target(Spell.ACID_SPRAY);
      break;
    case 125: // Wand of Paralysis
      say('  It shoots a silvery beam.');
      target(Spell.PARALYZE_BEAM);
      break;
    case 130: // Potion of Paralysis
      say('  You get very stiff.');
      pc.status[Status.PARALYZED] = 2000;
      break;
    case 133: // Scroll: Major Haste
      say('Your party is hasted!');
      for (const p of party.pcs) if (p.mainStatus === MainStatus.ALIVE) addStatus(p, Status.HASTE_SLOW, 4);
      break;
    // 62 (flying: boat, already aloft, registration), 114 (the Fire Egg) and
    // 126 (a charm of every hostile within 8) have cases, but no item of E3's
    // carries them and no script stamps them on. Every other code has none:
    // the charge goes and nothing happens.
    default:
      break;
  }

  if (takeCharge && item.charges > 0) removeCharge(pc, slot);
}
