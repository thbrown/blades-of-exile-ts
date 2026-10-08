/**
 * What each of Exile III's spells does, and how that grows with the caster:
 * the numbers in the port's casting code (`game/spellCombatTarget.ts`,
 * `spellCombat.ts`, `spellTown.ts`, `spellTarget.ts`), which follow BoE's,
 * with Exile III's own rules where it has them (Unlock, the balm, the
 * summoning lists). Each entry says where in that code its numbers are.
 *
 * Three figures carry the growth, and the page lets the reader set two:
 *
 * - **L**, the caster's level.
 * - **P**, the *power* of an aimed combat spell: 1 + ⌊L/2⌋, one more with
 *   an item of Magery at least the spell's level, one more for an Anama
 *   priest (`do_combat_cast`). Most damage spells read P, not L.
 * - **B**, the Intelligence bonus (`stat_adj`): −3 to +5 by Intelligence,
 *   one more for Magically Apt, and one for an item that boosts it.
 *
 * A spell cast out of combat, or one with no square to aim at, reads L
 * itself (`do_mage_spell`, `combat_immed_mage_cast` and their priest twins).
 */

import { HIT_CHANCE } from '../../game/damage';
import { COMBAT_PERCENT } from '../../game/spellTarget';
import { Spell } from '../../data/spell';

export interface Caster {
  /** L. */
  level: number;
  /** B. */
  bonus: number;
}

export interface SpellRule {
  /** What it does, in a sentence or two, with the formula in L, P and B. */
  effect: string;
  /** The numbers for one caster; absent when nothing depends on the caster. */
  at?: (c: Caster) => string;
  /** What the growth reads: the caster's level, Intelligence, or both. */
  grows?: 'level' | 'int' | 'both';
  /** Anything a player would want to know besides. */
  note?: string;
}

/** `skill_bonus` (shop.cpp:43; `Player.statAdj`), by Intelligence 0–20. */
export const SKILL_BONUS = [-3, -3, -2, -1, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5];

const t = Math.trunc;
/** P: an aimed combat spell's power (`do_combat_cast`). */
const power = (c: Caster): number => 1 + t(c.level / 2);
const avg = (n: number, sides: number, lo = 1): number => (n * (lo + sides)) / 2;
/** `get_ran(n, lo, sides)` as dice, with its range and average. */
function dice(n: number, sides: number, plus = 0, lo = 1): string {
  if (n <= 0) return plus > 0 ? String(plus) : '0';
  const d = lo === 1 ? `${n}d${sides}` : `${n}×(${lo}–${sides})`;
  const p = plus > 0 ? ` + ${plus}` : plus < 0 ? ` − ${-plus}` : '';
  const a = avg(n, sides, lo) + plus;
  return `${d}${p} (${n * lo + plus}–${n * sides + plus}, avg ${Math.round(a * 10) / 10})`;
}
const rounds = (n: number): string => `${n} round${n === 1 ? '' : 's'}`;
const turns = (n: number): string => `${n} turn${n === 1 ? '' : 's'}`;
const pct = (n: number): string => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
/** How many squares a multi-target spell picks (`start_fancy_spell_targeting`): 1–8. */
const targets = (n: number): number => Math.max(1, Math.min(8, n));
const hit = (level: number): number => HIT_CHANCE[Math.max(0, Math.min(19, level))] ?? 99;
const combatPercent = (level: number): number => COMBAT_PERCENT[Math.max(0, Math.min(19, level))] ?? 40;

/** Fireball's and Flamestrike's dice (`do_combat_cast`). */
function fireballDice(c: Caster, strike: boolean): number {
  let d = Math.min(9, 1 + t((power(c) * 2) / 3) + c.bonus) + 1;
  if (strike) d = t((d * 14) / 10);
  else if (d > 10) d = t((d * 8) / 10);
  return Math.max(1, d);
}
function stormDice(c: Caster): number {
  let d = Math.min(12, 1 + t((power(c) * 2) / 3) + c.bonus) + 2;
  if (d > 20) d = t((d * 8) / 10);
  return d;
}

/** The ten squares of a blast around the target, and the like, as the targeting draws them. */
const SHAPE = {
  square: 'a 3×3 square',
  small: 'a small square',
  radius2: 'a circle of radius 2',
  radius3: 'a circle of radius 3',
  wall: 'a wall five squares long, turned as you aim',
  single: 'one square',
};

/** What a field does to a monster the moment it lands (`placeSpellPattern`). */
const FIELD_HIT = {
  fire: 'Monsters caught take 2d6 fire as it lands, and burn while they stay',
  force: 'Monsters caught take 3d6 magic as it lands, and more while they stay',
  ice: 'Monsters caught take 3d6 cold as it lands, and more while they stay',
  blades: 'Monsters caught take 6d8 as it lands, and more while they stay',
  web: 'Monsters caught are webbed for 3',
};

const summonNote = 'How long a summoned creature stays is the roll, in turns. '
  + 'Exile III picks the creature from its own list for the spell.';

export const SPELL_RULES: Partial<Record<Spell, SpellRule>> = {
  // --- mage, level 1 -------------------------------------------------------
  [Spell.LIGHT]: { effect: 'Adds 50 to the party’s light, which burns down as it walks.' },
  [Spell.SPARK]: { effect: 'A bolt at one target: 2d4 magic damage, whoever casts it.', at: () => dice(2, 4) },
  [Spell.HASTE_MINOR]: { effect: 'The chosen PC is hasted for 2 rounds.' },
  [Spell.STRENGTH]: { effect: 'The chosen PC is blessed by 3.' },
  [Spell.SCARE]: {
    effect: 'One monster loses (2 + B)d6 morale; a frightened monster flees.',
    at: (c) => `${dice(2 + c.bonus, 6)} morale`, grows: 'int',
  },
  [Spell.CLOUD_FLAME]: { effect: `A wall of fire on ${SHAPE.single}. ${FIELD_HIT.fire}.` },
  [Spell.IDENTIFY]: { effect: 'Identifies items: in town you pick them, one by one, until you press Space. Costs nothing if everything is already known.' },
  [Spell.SCRY_MONSTER]: { effect: 'Shows one monster’s statistics, and notes it in the party’s records.' },
  [Spell.GOO]: { effect: `Webs ${SHAPE.single}. ${FIELD_HIT.web}.` },
  [Spell.TRUE_SIGHT]: { effect: 'In town, maps every square within two of the party.' },

  // --- mage, level 2 -------------------------------------------------------
  [Spell.POISON_MINOR]: {
    effect: 'Poisons one target by 2 + ⌊B/2⌋.', at: (c) => `poison ${2 + t(c.bonus / 2)}`, grows: 'int',
  },
  [Spell.FLAME]: {
    effect: 'A bolt of fire at one target: (1 + ⌊P/3⌋ + B)d6 fire, at most 10d6.',
    at: (c) => dice(Math.min(10, 1 + t(power(c) / 3) + c.bonus), 6), grows: 'both',
  },
  [Spell.SLOW]: {
    effect: 'Slows one target by 2 + B, plus one half the time.',
    at: (c) => `slowed ${2 + c.bonus}–${3 + c.bonus}`, grows: 'int',
  },
  [Spell.DUMBFOUND]: {
    effect: 'Dumbfounds one target by 1 + ⌊B/3⌋, cutting its spellcasting.',
    at: (c) => `dumbfounded ${1 + t(c.bonus / 3)}`, grows: 'int',
  },
  [Spell.ENVENOM]: {
    effect: 'Poisons the chosen PC’s weapon with 3 + B doses.', at: (c) => `${3 + c.bonus} doses`, grows: 'int',
  },
  [Spell.CLOUD_STINK]: { effect: `A cloud of stinking gas over ${SHAPE.square}: those in it are slowed and sickened.` },
  [Spell.SUMMON_BEAST]: {
    effect: 'Summons a beast to fight beside the party for 3d4 + B turns.',
    at: (c) => `${dice(3, 4, c.bonus)} turns`, grows: 'int', note: summonNote,
  },
  [Spell.CONFLAGRATION]: { effect: `Walls of fire over ${SHAPE.radius2}. ${FIELD_HIT.fire}.` },
  [Spell.DISPEL_SQUARE]: { effect: `Clears magical fields from ${SHAPE.square}.` },
  [Spell.CLOUD_SLEEP]: { effect: `A sleeping cloud over ${SHAPE.small}: those in it fall asleep unless they resist.` },

  // --- mage, level 3 -------------------------------------------------------
  [Spell.UNLOCK]: {
    effect: 'Unlocks a door, if a roll of 0–100 − 5B + 5 × ⌊town difficulty/10⌋ comes in under 135 − C(L), '
      + 'C being 1997’s combat-percent table (150 at level 0 falling to 40 by level 18). '
      + 'Some of Exile III’s doors never yield, and it never works on a portcullis.',
    at: (c) => `${pct((135 - combatPercent(c.level) + 5 * c.bonus) / 101 * 100)} on an easy town’s door`,
    grows: 'both', note: 'Exile III’s own rule (`e3UnlockSpell`): its own table of which doors it opens.',
  },
  [Spell.HASTE]: {
    effect: 'The chosen PC is hasted for ⌊L/2⌋ + B rounds, at least 2.',
    at: (c) => rounds(Math.max(2, t(c.level / 2) + c.bonus)), grows: 'both',
  },
  [Spell.FIREBALL]: {
    effect: `A ball of fire over ${SHAPE.square}: each one in it takes (min(9, 1 + ⌊2P/3⌋ + B) + 1)d6 fire.`,
    at: (c) => `${dice(fireballDice(c, false), 6)} each`, grows: 'both',
  },
  [Spell.LIGHT_LONG]: { effect: 'Adds 200 to the party’s light.' },
  [Spell.FEAR]: {
    effect: 'One monster loses (⌊L/2⌋ + B)d8 morale, at most 20d8.',
    at: (c) => `${dice(Math.min(20, t(c.level / 2) + c.bonus), 8)} morale`, grows: 'both',
  },
  [Spell.WALL_FORCE]: { effect: `A force wall: ${SHAPE.wall}. ${FIELD_HIT.force}.` },
  [Spell.SUMMON_WEAK]: {
    effect: 'Summons ⌊L/4⌋ + ⌊B/2⌋ creatures (1 to 7), each for 4d4 + B turns. In combat you pick where each appears.',
    at: (c) => `${Math.min(7, targets(t(c.level / 4) + t(c.bonus / 2)))} × ${dice(4, 4, c.bonus)} turns`,
    grows: 'both', note: summonNote,
  },
  [Spell.ARROWS_FLAME]: {
    effect: 'Fiery arrows at ⌊L/4⌋ + ⌊B/2⌋ targets you pick (1 to 8): 2d4 fire each.',
    at: (c) => `${targets(t(c.level / 4) + t(c.bonus / 2))} × ${dice(2, 4)}`, grows: 'both',
  },
  [Spell.WEB]: { effect: `Webs ${SHAPE.radius2}. ${FIELD_HIT.web}.` },
  [Spell.RESIST_MAGIC]: {
    effect: 'The chosen PC resists magic: in combat by 5 + B; out of it by 2 + B + 2d2.',
    at: (c) => `${5 + c.bonus} in combat, ${4 + c.bonus}–${6 + c.bonus} outside`, grows: 'int',
  },

  // --- mage, level 4 -------------------------------------------------------
  [Spell.POISON]: { effect: 'Poisons one target by 4 + ⌊B/2⌋.', at: (c) => `poison ${4 + t(c.bonus / 2)}`, grows: 'int' },
  [Spell.ICE_BOLT]: {
    effect: 'A bolt of ice at one target: (P + B)d4 cold, at most 20d4.',
    at: (c) => dice(Math.min(20, power(c) + c.bonus), 4), grows: 'both',
  },
  [Spell.SLOW_GROUP]: {
    effect: 'Every hostile monster within 12 is slowed by 5 + B.', at: (c) => `slowed ${5 + c.bonus}`, grows: 'int',
  },
  [Spell.MAGIC_MAP]: {
    effect: 'Maps the whole town. Uses up a sapphire (carried, not worn). Some towns defy it.',
  },
  [Spell.CAPTURE_SOUL]: { effect: 'Captures a monster’s soul in a soul crystal, for Simulacrum to call up later.' },
  [Spell.SIMULACRUM]: {
    effect: 'Calls up a creature whose soul was captured, for 3d4 + B turns. Costs as many spell points as the creature’s level.',
    at: (c) => `${dice(3, 4, c.bonus)} turns`, grows: 'int',
  },
  [Spell.ARROWS_VENOM]: {
    effect: 'Venomous arrows at ⌊L/5⌋ + ⌊B/2⌋ targets you pick (1 to 8): each poisoned by 2 + ⌊B/2⌋.',
    at: (c) => `${targets(t(c.level / 5) + t(c.bonus / 2))} × poison ${2 + t(c.bonus / 2)}`, grows: 'both',
  },
  [Spell.WALL_ICE]: { effect: `An ice wall: ${SHAPE.wall}. ${FIELD_HIT.ice}.` },

  // --- mage, level 5 -------------------------------------------------------
  [Spell.STEALTH]: {
    effect: 'The party moves stealthily for 2L turns, at least 6.', at: (c) => turns(Math.max(6, 2 * c.level)), grows: 'level',
  },
  [Spell.HASTE_MAJOR]: {
    effect: 'The whole party is hasted for 1 + ⌊L/8⌋ + B rounds.', at: (c) => rounds(1 + t(c.level / 8) + c.bonus), grows: 'both',
  },
  [Spell.FIRESTORM]: {
    effect: `A storm of fire over ${SHAPE.radius2}: each one in it takes (min(12, 1 + ⌊2P/3⌋ + B) + 2)d6 fire.`,
    at: (c) => `${dice(stormDice(c), 6)} each`, grows: 'both',
  },
  [Spell.DISPEL_BARRIER]: {
    effect: 'Breaks a magic barrier (or a force cage) if 1d100 − 5B + 5 × ⌊difficulty/10⌋ (+25 in a town of strong barriers, −8 for a fire barrier) comes in under 120 − C(L).',
    at: (c) => `${pct(120 - combatPercent(c.level) + 5 * c.bonus - 1)} on an easy town’s force barrier`, grows: 'both',
  },
  [Spell.BARRIER_FIRE]: {
    effect: 'A fire barrier on a square beside you; anyone on it takes 3 × (2–7) fire.', at: () => dice(3, 7, 0, 2),
  },
  [Spell.SUMMON]: {
    effect: 'Summons ⌊L/6⌋ + ⌊B/2⌋ creatures (1 to 6), each for 5d4 + B turns.',
    at: (c) => `${Math.min(6, targets(t(c.level / 6) + t(c.bonus / 2)))} × ${dice(5, 4, c.bonus)} turns`,
    grows: 'both', note: summonNote,
  },
  [Spell.SHOCKSTORM]: { effect: `Force walls over ${SHAPE.radius2}. ${FIELD_HIT.force}.` },
  [Spell.SPRAY_FIELDS]: {
    effect: 'A random field — web, fire, antimagic, stink, ice or blades — on each of ⌊L/5⌋ + ⌊B/2⌋ squares you pick (1 to 8).',
    at: (c) => `${targets(t(c.level / 5) + t(c.bonus / 2))} squares`, grows: 'both',
  },

  // --- mage, level 6 -------------------------------------------------------
  [Spell.POISON_MAJOR]: { effect: 'Poisons one target by 8 + ⌊B/2⌋.', at: (c) => `poison ${8 + t(c.bonus / 2)}`, grows: 'int' },
  [Spell.FEAR_GROUP]: {
    effect: 'Every hostile monster within 12 loses (⌊L/3⌋)d8 morale.', at: (c) => `${dice(t(c.level / 3), 8)} morale`, grows: 'level',
  },
  [Spell.KILL]: {
    effect: 'A killing bolt at one target: 40 + 2L + three rolls of 0–10, in magic damage.',
    at: (c) => `${40 + 2 * c.level}–${70 + 2 * c.level} (avg ${55 + 2 * c.level})`, grows: 'level',
  },
  [Spell.PARALYZE]: {
    effect: 'Tries to paralyze ⌊L/8⌋ + ⌊B/3⌋ targets you pick (1 to 8). A monster resists by its level and magic resistance.',
    at: (c) => `${targets(t(c.level / 8) + t(c.bonus / 3))} target(s)`, grows: 'both',
  },
  [Spell.DEMON]: {
    effect: 'Summons a demon for 5d4 + B turns (5d4 + 2B out of combat).',
    at: (c) => `${dice(5, 4, c.bonus)} turns`, grows: 'int',
  },
  [Spell.ANTIMAGIC]: { effect: `An antimagic field over ${SHAPE.radius2}: no spell can be cast in it.` },
  [Spell.MINDDUEL]: { effect: 'A duel of minds with a spellcasting monster. Uses up a charge of a smoky crystal.' },
  [Spell.FLIGHT]: { effect: 'Outdoors, the party flies for a short while, over anything.' },

  // --- mage, level 7 -------------------------------------------------------
  [Spell.SHOCKWAVE]: {
    effect: 'The ground shakes: everyone within 10 squares of the caster but the caster — the party too — takes (2 + ⌊d/2⌋)d6 unblockable damage, d being their distance. Further away is harder.',
    at: () => `${dice(2, 6)} beside you, ${dice(7, 6)} at 10`,
  },
  [Spell.BLESS_MAJOR]: {
    effect: 'The whole party is hasted for 3 + B rounds, blessed by 4, and their weapons poisoned by 2.',
    at: (c) => `hasted ${rounds(3 + c.bonus)}`, grows: 'int',
  },
  [Spell.PARALYSIS_MASS]: {
    effect: 'Tries to paralyze every hostile monster within 8; each resists by its level and magic resistance (and finds it a little easier to than Paralyze).',
  },
  [Spell.PROTECTION]: {
    effect: 'The chosen PC is invulnerable for 2 + B + 2d2; everyone else resists magic by 4 + ⌊L/3⌋ + B.',
    at: (c) => `invulnerable ${4 + c.bonus}–${6 + c.bonus}, others resist ${4 + t(c.level / 3) + c.bonus}`, grows: 'both',
  },
  [Spell.SUMMON_MAJOR]: {
    effect: 'Summons ⌊L/8⌋ + ⌊B/2⌋ creatures (1 to 5), each for 7d4 + B turns.',
    at: (c) => `${Math.min(5, targets(t(c.level / 8) + t(c.bonus / 2)))} × ${dice(7, 4, c.bonus)} turns`,
    grows: 'both', note: summonNote,
  },
  [Spell.BARRIER_FORCE]: {
    effect: 'A force barrier on a square beside you; anyone on it takes 7 × (2–7).', at: () => dice(7, 7, 0, 2),
  },
  [Spell.QUICKFIRE]: { effect: 'Starts quickfire, which spreads and burns everything it reaches.' },
  [Spell.ARROWS_DEATH]: {
    effect: 'Deadly arrows at ⌊L/8⌋ + ⌊B/3⌋ targets you pick (1 to 8): each takes three rolls of 0–10, + L + 3B, in magic damage.',
    at: (c) => `${targets(t(c.level / 8) + t(c.bonus / 3))} × ${c.level + 3 * c.bonus}–${30 + c.level + 3 * c.bonus}`,
    grows: 'both',
  },

  // --- priest, level 1 -----------------------------------------------------
  [Spell.BLESS_MINOR]: { effect: 'The chosen PC is blessed by 2.' },
  [Spell.HEAL_MINOR]: { effect: 'Heals the chosen PC 2d4.', at: () => dice(2, 4) },
  [Spell.POISON_WEAKEN]: {
    effect: 'Takes 1 + (0–2) + ⌊B/2⌋ poison off the chosen PC.', at: (c) => `${1 + t(c.bonus / 2)}–${3 + t(c.bonus / 2)}`, grows: 'int',
  },
  [Spell.TURN_UNDEAD]: {
    effect: 'Undead only. Lands if a roll of 0–90 is at most H(2B + 4P − ⌊its level/2⌋ + 3), H being the hit-chance table (20% to 99%); then 2d14 unblockable damage, 15 more for an Anama.',
    at: (c) => `vs a level-10 undead: ${pct((hit(2 * c.bonus + 4 * power(c) - 5 + 3) + 1) / 91 * 100)}, ${dice(2, 14)}`,
    grows: 'both',
  },
  [Spell.LOCATION]: { effect: 'Says where the party is.' },
  [Spell.SANCTUARY]: {
    effect: 'The chosen PC is hidden (monsters can’t target them) for ⌊L/4⌋ + B rounds.',
    at: (c) => rounds(Math.max(0, t(c.level / 4) + c.bonus)), grows: 'both',
  },
  [Spell.SYMBIOSIS]: {
    effect: 'Moves another PC’s wounds onto the caster, a point at a time until they are whole: each point costs the caster one unless 1d100 + ⌊L/2⌋ + 3B reaches 100, and a second if it falls under 50.',
    at: (c) => {
      const r = (x: number): number => Math.max(0, Math.min(100, x));
      const s = t(c.level / 2) + 3 * c.bonus;
      const free = r(100 - (99 - s)) / 100;
      const two = r(49 - s) / 100;
      return `about ${Math.round((1 - free + two) * 100) / 100} HP per point healed`;
    },
    grows: 'both',
  },
  [Spell.MANNA_MINOR]: {
    effect: 'Food: a third of ⌊L/3⌋ + 2B + 2d4.',
    at: (c) => { const lo = Math.max(0, t(c.level / 3) + 2 * c.bonus + 2); return `${t(lo / 3)}–${t((lo + 6) / 3)} food`; }, grows: 'both',
  },
  [Spell.RITUAL_SANCTIFY]: { effect: 'Sanctifies a square. Nothing happens unless the scenario has something there to sanctify.' },
  [Spell.STUMBLE]: { effect: 'Curses one target by 4 + B.', at: (c) => `cursed ${4 + c.bonus}`, grows: 'int' },

  // --- priest, level 2 -----------------------------------------------------
  [Spell.BLESS]: {
    effect: 'The chosen PC is blessed by ⌊3L/4⌋ + 1 + B, at least 2.',
    at: (c) => `blessed ${Math.max(2, t((c.level * 3) / 4) + 1 + c.bonus)}`, grows: 'both',
  },
  [Spell.POISON_CURE]: {
    effect: 'Takes 3 + (0–2) + ⌊B/2⌋ poison off the chosen PC.', at: (c) => `${3 + t(c.bonus / 2)}–${5 + t(c.bonus / 2)}`, grows: 'int',
  },
  [Spell.CURSE]: { effect: 'Curses one target by 2 + B.', at: (c) => `cursed ${2 + c.bonus}`, grows: 'int' },
  [Spell.LIGHT_DIVINE]: { effect: 'Adds 210 to the party’s light.' },
  [Spell.WOUND]: {
    effect: 'Unblockable damage to one target: (2 + B + ⌊P/2⌋)d4, at most 7d4.',
    at: (c) => dice(Math.min(7, 2 + c.bonus + t(power(c) / 2)), 4), grows: 'both',
  },
  [Spell.SUMMON_SPIRIT]: {
    effect: 'Summons a spirit for 2d5 + B turns in combat, 2d4 + B outside it.',
    at: (c) => `${dice(2, 5, c.bonus)} turns`, grows: 'int',
  },
  [Spell.MOVE_MOUNTAINS]: { effect: 'Smashes one square of wall or rock.' },
  [Spell.CHARM_FOE]: {
    effect: 'Tries to make one monster a friend. It resists by its level and magic resistance, made harder by B + ⌊L/8⌋.',
    at: (c) => `${c.bonus + t(c.level / 8)} off its roll`, grows: 'both',
  },
  [Spell.DISEASE]: {
    effect: 'Diseases one target by 2 + B, plus one half the time.', at: (c) => `diseased ${2 + c.bonus}–${3 + c.bonus}`, grows: 'int',
  },

  // --- priest, level 3 -----------------------------------------------------
  [Spell.AWAKEN]: { effect: 'Wakes the chosen PC.' },
  [Spell.HEAL]: { effect: 'Heals the chosen PC 8d4.', at: () => dice(8, 4) },
  [Spell.HEAL_ALL_LIGHT]: {
    effect: 'Heals the whole party (3 + B)d4, the same roll for everyone.', at: (c) => dice(3 + c.bonus, 4), grows: 'int',
  },
  [Spell.HOLY_SCOURGE]: {
    effect: 'Curses one target by 2 + ⌊L/2⌋.', at: (c) => `cursed ${2 + t(c.level / 2)}`, grows: 'level',
  },
  [Spell.DETECT_LIFE]: { effect: 'Shows the monsters on the map for 6–12 turns.' },
  [Spell.PARALYSIS_CURE]: { effect: 'Frees the chosen PC from paralysis.' },
  [Spell.MANNA]: {
    effect: 'Food: ⌊L/3⌋ + 2B + 2d4.',
    at: (c) => `${Math.max(0, t(c.level / 3) + 2 * c.bonus + 2)}–${Math.max(0, t(c.level / 3) + 2 * c.bonus + 8)} food`, grows: 'both',
  },
  [Spell.FORCEFIELD]: { effect: `Force walls over ${SHAPE.square}. ${FIELD_HIT.force}.` },
  [Spell.DISEASE_CURE]: {
    effect: 'Takes 2 + (0–2) + ⌊B/2⌋ disease off the chosen PC.', at: (c) => `${2 + t(c.bonus / 2)}–${4 + t(c.bonus / 2)}`, grows: 'int',
  },

  // --- priest, level 4 -----------------------------------------------------
  [Spell.RESTORE_MIND]: {
    effect: 'Takes 1 + (0–2) + ⌊B/2⌋ dumbfounding off the chosen PC.', at: (c) => `${1 + t(c.bonus / 2)}–${3 + t(c.bonus / 2)}`, grows: 'int',
  },
  [Spell.SMITE]: {
    effect: 'Bolts of cold at ⌊L/4⌋ + ⌊B/2⌋ targets you pick (1 to 8): 2d5 cold each.',
    at: (c) => `${targets(t(c.level / 4) + t(c.bonus / 2))} × ${dice(2, 5)}`, grows: 'both',
  },
  [Spell.POISON_CURE_ALL]: {
    effect: 'Takes 3 + B poison off everyone in the party.', at: (c) => `${3 + c.bonus} poison`, grows: 'int',
  },
  [Spell.CURSE_ALL]: {
    effect: 'Curses every hostile monster in range by 3 + B.', at: (c) => `cursed ${3 + c.bonus}`, grows: 'int',
  },
  [Spell.DISPEL_UNDEAD]: {
    effect: 'As Turn Undead, but 6d14 unblockable damage.',
    at: (c) => `vs a level-10 undead: ${pct((hit(2 * c.bonus + 4 * power(c) - 5 + 3) + 1) / 91 * 100)}, ${dice(6, 14)}`,
    grows: 'both',
  },
  [Spell.CURSE_REMOVE]: {
    effect: 'Each cursed item the chosen PC carries is uncursed if 0–200 − 10B comes in under 60.',
    at: (c) => `${pct((60 + 10 * c.bonus) / 201 * 100)} an item`, grows: 'int',
  },
  [Spell.STICKS_TO_SNAKES]: {
    effect: 'Turns sticks into snakes: in combat ⌊L/5⌋ + ⌊B/2⌋ of them where you pick (1 to 8), outside it ⌊L/6⌋ + ⌊B/3⌋ + (0–1); each stays 2d5 + B turns.',
    at: (c) => `${targets(t(c.level / 5) + t(c.bonus / 2))} in combat, ${dice(2, 5, c.bonus)} turns`, grows: 'both',
  },
  [Spell.MARTYRS_SHIELD]: {
    effect: 'The chosen PC returns harm to whoever strikes them for (⌊(L + 5)/5⌋)d3 + B rounds, at least 1.',
    at: (c) => `${dice(t((c.level + 5) / 5), 3, c.bonus)} rounds`, grows: 'both',
  },
  [Spell.CLEANSE]: { effect: 'Cures the chosen PC of disease and webs.' },

  // --- priest, level 5 -----------------------------------------------------
  [Spell.FIREWALK]: {
    effect: 'The party walks through fire unhurt for ⌊L/12⌋ + 2 turns.', at: (c) => turns(t(c.level / 12) + 2), grows: 'level',
  },
  [Spell.BLESS_PARTY]: {
    effect: 'The whole party is blessed by ⌊L/3⌋.', at: (c) => `blessed ${t(c.level / 3)}`, grows: 'level',
  },
  [Spell.HEAL_MAJOR]: { effect: 'Heals the chosen PC 14d4.', at: () => dice(14, 4) },
  [Spell.RAISE_DEAD]: {
    effect: 'Brings a dead PC back with 1 health, at the cost of a point of Strength, Dexterity and Intelligence two times in three each — or, one time in ⌊L/2⌋, turns them to dust. In Exile III it uses up a resurrection balm.',
    at: (c) => `${pct(100 / Math.max(1, t(c.level / 2)))} dust`, grows: 'level',
  },
  [Spell.FLAMESTRIKE]: {
    effect: `Fire over ${SHAPE.square}: Fireball’s dice, times 1.4.`,
    at: (c) => `${dice(fireballDice(c, true), 6)} each`, grows: 'both',
  },
  [Spell.SANCTUARY_MASS]: {
    effect: 'The whole party is hidden for ⌊L/6⌋ + B rounds.', at: (c) => rounds(Math.max(0, t(c.level / 6) + c.bonus)), grows: 'both',
  },
  [Spell.SUMMON_HOST]: {
    effect: 'Summons a host: a great spirit and four lesser ones, each for 2d4 + B turns.',
    at: (c) => `${dice(2, 4, c.bonus)} turns`, grows: 'int',
  },
  [Spell.SHATTER]: { effect: 'Crumbles the walls in the 3×3 around the party (those that can crumble).' },

  // --- priest, level 6 -----------------------------------------------------
  [Spell.DISPEL_SPHERE]: { effect: `Clears magical fields from ${SHAPE.radius2}.` },
  [Spell.HEAL_ALL]: {
    effect: 'Heals the whole party (6 + B)d4, the same roll for everyone.', at: (c) => dice(6 + c.bonus, 4), grows: 'int',
  },
  [Spell.REVIVE]: { effect: 'Heals the chosen PC 250 and cures their poison.' },
  [Spell.HYPERACTIVITY]: {
    effect: 'Wakes the whole party (6 + 2B off their sleep) and ends any slowing.', at: (c) => `${6 + 2 * c.bonus} off sleep`, grows: 'int',
  },
  [Spell.DESTONE]: { effect: 'Turns a PC turned to stone back to flesh.' },
  [Spell.SUMMON_GUARDIAN]: {
    effect: 'Summons a guardian for 6d4 + B turns.', at: (c) => `${dice(6, 4, c.bonus)} turns`, grows: 'int',
  },
  [Spell.CHARM_MASS]: {
    effect: 'Tries to charm every hostile monster in range; each resists by its level and magic resistance, and more easily than against Charm Foe (28 − B on its roll).',
    at: (c) => `${28 - c.bonus} on their rolls`, grows: 'int',
  },
  [Spell.PROTECTIVE_CIRCLE]: { effect: 'Raises rings of walls — force, fire, ice and blades — around the caster.' },

  // --- priest, level 7 -----------------------------------------------------
  [Spell.PESTILENCE]: {
    effect: 'Diseases every hostile monster in range by 3 + B.', at: (c) => `diseased ${3 + c.bonus}`, grows: 'int',
  },
  [Spell.REVIVE_ALL]: {
    effect: 'Heals the whole party twice (7 + B)d4 and takes 3 + B poison off each.',
    at: (c) => `${2 * (7 + c.bonus)}–${8 * (7 + c.bonus)} (avg ${5 * (7 + c.bonus)}), poison −${3 + c.bonus}`, grows: 'int',
  },
  [Spell.RAVAGE_SPIRIT]: {
    effect: 'Demons only. Lands if 1d100 is at most H(4P − its level + 10); then (8 + 2B)d11 unblockable, 25 more for an Anama.',
    at: (c) => `vs a level-20 demon: ${pct(hit(4 * power(c) - 20 + 10))}, ${dice(8 + 2 * c.bonus, 11)}`, grows: 'both',
  },
  [Spell.RESURRECT]: {
    effect: 'Brings back a PC who is dead, dust or stone with 1 health, at the cost of a point of Strength, Dexterity and Intelligence one time in three each. In Exile III it uses up a resurrection balm.',
  },
  [Spell.DIVINE_THUD]: {
    effect: `A thunderbolt over ${SHAPE.radius2}: each one in it takes (⌊7P/10⌋ + 2B)d6 magic, at most 18d6.`,
    at: (c) => `${dice(Math.max(1, Math.min(18, t((power(c) * 7) / 10) + 2 * c.bonus)), 6)} each`, grows: 'both',
  },
  [Spell.AVATAR]: {
    effect: 'The caster becomes an avatar: healed 300, cured, blessed, hasted and martyr-shielded 8, invulnerable 3, resisting magic 8, and freed of webs, disease and dumbfounding.',
  },
  [Spell.WALL_BLADES]: { effect: `A wall of blades: ${SHAPE.wall}. ${FIELD_HIT.blades}.` },
  [Spell.WORD_RECALL]: { effect: 'Outdoors, and not in a boat or on horseback: carries the party back to the town the game starts in (Fort Emergence, in Exile III).' },
  [Spell.CLEANSE_MAJOR]: { effect: 'Cures the whole party of disease and webs.' },
};
