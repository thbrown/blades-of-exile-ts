/**
 * What an Exile III item really does, read from the rules this port runs for
 * it — not from the item sheet, which names the *BoE* ability the converter
 * gave the item (by its bladbase namesake) and so can say something else
 * entirely.
 *
 * Each E3 ability code has one entry here, written from the code that acts on
 * it: `game/e3ItemUse.ts` (E3's `use_item`, `10c0:2c92`), `game/e3Items.ts`
 * (its attack, damage and once-a-round rules), and the wards in
 * `universe/player.ts`, `universe/inventory.ts`, `game/doors.ts` and
 * `game/increaseAge.ts`. Where no E3 rule has been ported, the engine still
 * applies BoE's rule for the BoE ability, and the entry says so ("unread"):
 * those are the places E3's own code hasn't been checked.
 *
 * **Keep these in step with the rules.** `test/e3ItemRules.test.ts` fails
 * when an E3 item has a code with no entry, or a Use case has no entry.
 */

import { Item, ItemType } from '../../data/item';
import { Scenario } from '../../data/scenario';
import { Spell, spellName } from '../../data/spell';
import { weaponSkillName } from '../../data/itemAbilName';
import { E3_USE_CODE } from '../../game/e3ItemUse';

/**
 * - `agrees`: the item sheet's words fit what the code does.
 * - `partly`: they name the right idea but miss or misstate part of it.
 * - `differs`: they say something the code doesn't do.
 * - `unread`: the engine runs BoE's rule for it; E3's own is not yet read.
 * - `none`: nothing to compare (no ability either way).
 */
export type Verdict = 'agrees' | 'partly' | 'differs' | 'unread' | 'none';

export interface ItemReading {
  /** What the code does, with this item's numbers. */
  effect: string;
  /** Where the rule lives: the port's file and E3's address. */
  where: string;
  verdict: Verdict;
  /** Why, when the verdict isn't a plain agreement. */
  note: string;
}

interface Rule {
  effect: (it: Item, scen: Scenario) => string;
  where: string;
  /**
   * Item-sheet wording that describes this fairly. None: no wording can. A
   * function when it needs the string tables, which load after this module.
   */
  agrees?: RegExp | (() => RegExp);
  /** A verdict no wording decides: `partly` or `unread` when the words fit. */
  verdict?: 'partly' | 'unread';
  note?: string;
}

const USE = 'e3ItemUse.ts · use_item 10c0:2c92';
const ATTACK = 'e3Items.ts · calc_spec_dam 1018:1915';
const ROUND = 'e3Items.ts · combat round 1018:43f2';
const DAMAGE = 'e3Items.ts · damage_pc 10b0:9676';
const BOE = 'BoE rule (no E3 rule ported)';

const mon = (scen: Scenario, n: number): string => scen.scenMonsters[n]?.name || `monster ${n}`;
const re = (s: string): RegExp => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** A Use case that casts `spell` at E3's flat item-spell level, 6. */
function cast(spell: Spell, says: string): Rule {
  return {
    effect: () => `“${says}” Casts ${spellName(spell)} at level 6, whoever uses it.`,
    where: USE,
    agrees: () => re(spellName(spell)),
  };
}

function summon(what: (it: Item, scen: Scenario) => string, says = ''): Rule {
  return {
    effect: (it, scen) => `${says}Summons ${what(it, scen)} as friends.`,
    where: USE,
    agrees: /summon/i,
  };
}

function worn(effect: string, where: string, agrees?: RegExp, note?: string, verdict?: 'partly'): Rule {
  return { effect: () => effect, where, agrees, note, verdict };
}

/** BoE's rule for the BoE ability, which the engine still applies. */
function boe(effect: string, agrees: RegExp, where: string): Rule {
  return {
    effect: () => effect,
    where: `${BOE} · ${where}`,
    agrees,
    verdict: 'unread',
    note: 'The engine applies BoE’s rule for this ability; Exile III’s own code for it hasn’t been read yet.',
  };
}

const ALCHEMY = (it: Item): string =>
  `An alchemy ingredient. BoE’s recipes look for it by its BoE ability (${it.fullName}).`;

const RULES: Record<number, Rule> = {
  0: { effect: () => 'No ability.', where: '—' },
  2: worn('Halves magic damage taken while worn.', DAMAGE, /magic protection/i),
  3: {
    effect: (it) => `“You are healed.” Heals (6–12) × ${it.itemLevel * 2 + 2} ` +
      `= ${6 * (it.itemLevel * 2 + 2)}–${12 * (it.itemLevel * 2 + 2)} health.`,
    where: USE, agrees: /^heal/i,
  },
  4: { effect: (it) => `“You are cured.” Cures ${it.itemLevel * 2 + 3} poison.`, where: USE, agrees: /cure poison/i },
  5: cast(Spell.FLAME, 'It fires a bolt of flame.'),
  6: cast(Spell.FIREBALL, 'It shoots a fireball.'),
  8: {
    effect: (it) => `Poisons the wielded weapon at level ${it.itemLevel}, by E3’s poison_weapon ` +
      '(its Nimble Fingers test is inverted — E3-SUSPECTED-BUGS #12).',
    where: `${USE} · poisonWeapon.ts`, agrees: /poison weapon/i,
  },
  9: boe('Saves the wearer from death once, then is used up (BoE’s Life Saving).', /life saving/i, 'damage.ts'),
  10: {
    effect: () => '“You have a vision.” Reveals the whole town map. (1997 added a town flag that blocks it; E3 has none.)',
    where: USE, agrees: /magic map/i,
  },
  11: {
    effect: (it) => `Lockpicks by E3’s rule: the roll is ${it.itemLevel * 15} easier, and they break when ` +
      `1–100 + ${it.itemLevel * 15} comes under 55 on a failure.`,
    where: 'doors.ts · pick-lock = exile3 (10d8:3f67)', agrees: /lockpick/i,
  },
  12: { effect: (it) => `“You have light.” Adds ${it.itemLevel * 50} to the party’s light.`, where: USE, agrees: /light/i },
  13: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /resurrection balm/i, verdict: 'unread',
    note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  14: {
    effect: () => 'Cursed: once equipped it can’t be taken off (E3 1070:1320). No ability beyond its ordinary numbers.',
    where: 'inventory.ts · E3 code 14',
  },
  15: { effect: (it) => `“You feel strange.” Magic resistance +${it.itemLevel + 6}–${it.itemLevel + 9}.`, where: USE },
  16: worn('Halves FIRE damage taken while worn.', DAMAGE, /fire protection/i),
  17: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /sapphire/i, verdict: 'unread',
    note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  18: { effect: (it) => `“You feel stronger.” Blessed by ${it.itemLevel * 2 + 3}.`, where: USE, agrees: /^bless/i },
  19: cast(Spell.POISON, 'A green ray emerges.'),
  20: { effect: (it) => `“Your energy increases.” Restores ${it.itemLevel * 15 + 15} spell points.`, where: USE, agrees: /restore spell/i },
  21: {
    effect: () => '“You fade into the shadows.” Party stealth +15–25. E3 keeps it in a byte, so it wraps past 255.',
    where: USE, agrees: /stealth/i,
  },
  22: cast(Spell.FIRESTORM, 'You fling a missile.'),
  23: cast(Spell.KILL, 'It turns black and hums.'),
  24: { effect: () => '“You are healed fully.” Heals 200 health.', where: USE, agrees: /^heal/i },
  25: boe('Protects the wearer from being turned to stone (BoE’s rule).', /petrify/i, 'damage.ts'),
  26: { effect: (it) => `“You speed up.” Hasted by ${it.itemLevel + 2}.`, where: USE, agrees: /haste/i },
  27: {
    effect: (it) => `“You feel strange.” Invulnerable for ${it.itemLevel + 6}–${it.itemLevel + 7} rounds.`,
    where: USE, agrees: /add invulnerability/i,
  },
  28: { effect: (it) => `“You feel very, very ill.” Poisons the user by ${it.itemLevel + 5}.`, where: USE, agrees: /cause poison/i },
  29: {
    effect: () => '“You burn in agony.” Strength, dexterity and intelligence each move one toward 0, then poison 4.',
    where: USE, agrees: /doom/i,
  },
  30: {
    effect: (it) => `“You feel wonderful!” Heals ${it.itemLevel * 2 + 4}–${(it.itemLevel * 2 + 4) * 10}, ` +
      `blesses by ${it.itemLevel * 2 + 3} and cures ${it.itemLevel * 2 + 3} poison.`,
    where: USE, agrees: /bliss/i,
  },
  31: { effect: (it) => `“You feel competent.” Gives ${it.itemLevel * 2 + 2} skill points.`, where: USE, agrees: /gain skill/i },
  32: {
    effect: (it) => it.variety === ItemType.ONE_HANDED || it.variety === ItemType.TWO_HANDED
      ? '“Blade drips venom.” Half the time a landed blow poisons the target by 2.'
      : 'Nothing: E3’s venom works on melee blows only, and its missiles have no on-hit step (1018:38ba).',
    where: 'e3Items.ts · e3OnMeleeHit 1018:0edd',
    agrees: /poison/i,
  },
  33: worn('Adds 8–13 damage to a hit — except against demons.', ATTACK, /flaming/i),
  34: worn('Adds 25–35 damage against demons.', ATTACK, /demon/i),
  35: worn('Adds 5–15 damage against undead.', ATTACK, /undead/i),
  36: {
    effect: (it) => `“You all tingle gently.” Every PC, living or not, gets magic resistance ` +
      `+${it.itemLevel * 3 + 4}–${it.itemLevel * 3 + 8}.`,
    where: USE, agrees: /magic resistance/i,
  },
  37: { effect: () => '“The ground shakes!” A shockwave around the user.', where: USE, agrees: /shockwave/i },
  38: cast(Spell.ICE_BOLT, 'It fires a ball of ice.'),
  39: cast(Spell.SLOW, 'It fires a purple ray.'),
  40: { effect: () => '“You become stronger.” Strength +2, up to 20.', where: USE, agrees: /strength/i },
  41: {
    effect: () => '“You fling the gem.” Dispel Barrier on one square, in town, at level 6.',
    where: USE, agrees: /dispel barrier/i,
  },
  42: worn('Now and then in combat (1 in 11 a round) hastes the wearer by 1. No extra action points.',
    ROUND, /haste/i, 'The sheet says Speed, which in BoE adds action points; E3’s helm never does.'),
  43: cast(Spell.STRENGTHEN_TARGET, 'It shoots a fiery red ray.'),
  44: cast(Spell.DISPEL_UNDEAD, 'It shoots a white ray.'),
  45: cast(Spell.RAVAGE_SPIRIT, 'It shoots a golden ray.'),
  46: boe('Regenerates health over time by BoE’s rule, at the bladbase strength.', /regenerate/i, 'increaseAge.ts, rest.ts'),
  47: worn('Now and then in combat (1 in 11 a round) blesses the wearer by 1.', ROUND, /bless/i),
  48: worn('Halves undead damage, and wards off an undead touch’s drain, stun and icy chill.',
    `${DAMAGE} · monsterAbilities.ts`, /undead/i),
  49: boe('Adds to weapon poison applied (BoE’s Poison Augment: +2 melee, +1 missiles).', /poison augment/i, 'combat.ts, missiles.ts'),
  50: worn('Adds 25–35 damage against demons, and halves demon damage taken while wielded.', `${ATTACK} · ${DAMAGE}`,
    /demon/i, 'The sheet names only the slaying half; the ward against demons is not mentioned.', 'partly'),
  51: worn('Adds 20–31 damage against giants.', ATTACK, /giant/i),
  52: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /holly/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  53: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /comfrey/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  54: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /nettle/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  55: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /wormgrass|asptongue/i, verdict: 'unread', note: 'Two E3 items share this code but carry different BoE ingredients (Wormgrass, Asptongue). Used by BoE’s recipes; E3’s own alchemy hasn’t been compared.' },
  56: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /mandrake/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  57: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /ember/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  58: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /graymold/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  59: { effect: () => '“You apply the salve.” Takes 3 off every PC’s disease.', where: USE, agrees: /cure disease/i },
  60: { effect: () => '“That’s good stuff! (Hic.)” Curses the drinker by 3.', where: USE },
  61: worn('Picking a lock is 12 easier — but only in the first sixteen pack slots.', 'doors.ts · 10d8:3f67', /thiev/i),
  63: { effect: () => '“You feel light headed.” Loses 10–100 experience.', where: USE, agrees: /drain experience/i },
  65: boe('A missile that comes back: throwing or firing it spends no charge (BoE’s rule).', /returning/i, 'missiles.ts'),
  66: worn('Halves COLD damage taken while worn.', DAMAGE, /cold protection/i),
  67: worn('Cures disease: while worn, disease runs straight to 0, and none is caught.',
    'increaseAge.ts · E3 code 67', /disease/i),
  68: { effect: ALCHEMY, where: `${BOE} · alchemy.ts`, agrees: /smoky/i, verdict: 'unread', note: 'Used by BoE’s alchemy recipes; E3’s own alchemy hasn’t been compared.' },
  70: worn('Missiles only: the first one worn adds its level + 1 to the hit bonus (5% each), and nothing to damage.',
    'e3Items.ts · e3MissileHitBonus 1018:38ba', /accuracy/i),
  71: summon((it, scen) => `${it.itemLevel + 1} × ${mon(scen, 99 + Math.trunc(it.itemLevel / 2))} for 6–24 rounds`),
  72: summon((_, scen) => `${mon(scen, 101)} for 50 rounds`),
  73: summon((_, scen) => `${mon(scen, 130)} for 5–20 rounds`),
  74: worn('+1 action point in combat.', 'e3Items.ts · e3ActionPoints 10b0:a0ce', /speed/i),
  75: worn('“Ring of Will glows.” A better roll against being dumbfounded.', 'player.ts · dumbfound', /will/i),
  76: summon((_, scen) => `${mon(scen, 72)} for 5–20 rounds`),
  77: worn('Takes 1 off each dose of poison AND of disease.', 'player.ts · poison_pc 10b0:933f', /poison/i,
    'The sheet mentions poison only; it wards disease too.', 'partly'),
  78: cast(Spell.WALL_ICE_BALL, 'It shoots a blue sphere.'),
  79: { effect: () => '“Your mind clears.” Ends dumbfounding.', where: USE, agrees: /cure dumbfound/i },
  80: cast(Spell.CHARM_FOE, 'You feel loved.'),
  81: cast(Spell.ANTIMAGIC, 'Your hair stands on end.'),
  82: { effect: () => '“Boom.” Blade walls in a radius-2 circle around the USER.', where: `${USE} · 1018:a598` },
  83: { effect: () => '“You don’t feel very well.” Deals 250 unblockable damage to the USER.', where: USE, agrees: /harm|damage/i },
  84: { ...cast(Spell.SUMMON_RAT, 'The wand vibrates.'), agrees: /rat/i },
  85: cast(Spell.GOO_BOMB, 'It explodes!'),
  86: cast(Spell.FOUL_VAPOR, 'It explodes!'),
  87: {
    effect: () => '“The dust makes you hard to see.” The USER is invisible for 6. ' +
      '(E3 loops over the party but writes the user six times.)',
    where: USE, agrees: /sanctuary|invisib/i, verdict: 'partly',
    note: 'Only the user is hidden, although the dust is plainly meant for the party.',
  },
  88: { effect: () => '“You feel cleansed.” Ends the user’s webs and disease.', where: USE, agrees: /disease|web/i, verdict: 'partly',
    note: 'Also clears webs, which the sheet doesn’t say.' },
  89: summon((_, scen) => `a ${mon(scen, 14)}, then ${mon(scen, 13)}s, for 6–24 rounds; the loop tests i against a fresh 4–6 roll each time round, so usually 2–5 in all`),
  90: cast(Spell.SHOCKSTORM, 'Sparks fly.'),
  91: summon((_, scen) => `${mon(scen, 103)} for 6–24 rounds`),
  92: boe('Explodes on hitting (BoE’s Exploding Weapon, at the bladbase strength).', /explodes/i, 'combat.ts, missiles.ts'),
  93: boe('Missiles fired with it spend a charge twice (BoE’s Drain Missiles).', /drain missiles/i, 'missiles.ts'),
  94: worn('+1 action point in combat.', 'e3Items.ts · e3ActionPoints 10b0:a0ce', /speed/i),
  95: worn('Cursed. Now and then in combat (1 in 11 a round) “starts dancing!”: curse 2. No action points lost.',
    ROUND, /dancing|curse/i, 'The sheet says Slow Wearer, which in BoE costs action points; E3’s boots never do.'),
  96: worn('+2 melee damage; the hit roll goes up 1 (1% more misses).', 'e3Items.ts · e3AttackAdj 1018:0edd',
    /strength/i, 'Much weaker than BoE’s Giant Strength at bladbase strength.', 'partly'),
  97: worn('+3 melee damage; the hit roll goes up 5 (5% more misses).', 'e3Items.ts · e3AttackAdj 1018:0edd',
    /strength/i, 'Makes blows land LESS often; the sheet can’t say so.', 'partly'),
  98: worn('Now and then in combat (1 in 13 a round) “feels ill”: the wearer is poisoned by 2.', ROUND),
  99: worn('+1 to the DEXTERITY adjustment (to hit and to dodge), worn in the first sixteen slots.',
    'player.ts · stat_adj 10b0:87af', /dexterity/i),
  100: { effect: () => '“You become protected.” Martyr’s shield +8, up to 16.', where: USE, agrees: /martyr/i },
  101: worn('', 'e3Items.ts · e3AttackAdj 1018:0edd', undefined),
  102: { effect: () => 'No ability: a quest object.', where: '—' },
  103: { effect: () => 'No ability: a quest object.', where: '—' },
  110: boe('Every 500 turns, 1 in 6: the whole party catches disease (BoE’s Occasional Status, bladbase strength).',
    /disease/i, 'increaseAge.ts'),
  111: { effect: () => 'No ability: a quest object.', where: '—' },
  115: { effect: () => '“You are filled with battle lust!” Bless and haste set to 8 (not added).', where: USE, agrees: /bless|haste|battle/i },
  117: {
    effect: () => 'In the pack: −30 weight. Once taken, E3 clears its code and sets its weight to −20, which it ' +
      'reads unsigned: the stone then weighs 236 (E3-SUSPECTED-BUGS #11).',
    where: 'inventory.ts · give_to_pc 1070:01d1', agrees: /lighter/i, verdict: 'partly',
    note: 'The lightening never applies once the stone is taken, and it becomes very heavy.',
  },
  118: worn('Immune to sleep.', 'player.ts · sleep_pc 10b0:19dd', /sleep|alert/i,
    'The sheet says Free Action, which in BoE is mainly against paralysis; E3’s helm wards sleep only.'),
  119: { effect: () => '“Everyone is now awake!” Wakes the whole party.', where: USE },
  120: worn('Immune to paralysis, and 2 off a sleep.', 'player.ts · sleep_pc 10b0:19dd', /free action/i),
  121: { effect: () => '“Your skin tingles refreshingly.” Ends acid.', where: USE, agrees: /acid/i },
  122: boe('Protects from acid (BoE’s Status Protection, bladbase strength).', /acid/i, 'player.ts'),
  123: cast(Spell.CLOUD_SLEEP_LARGE, 'It creates a cloud of gas.'),
  124: cast(Spell.ACID_SPRAY, 'Acid sprays from the tip!'),
  125: cast(Spell.PARALYZE_BEAM, 'It shoots a silvery beam.'),
  127: worn('Halves fire, poison, magic and cold damage; 1 off each dose of poison; 2 off a sleep.',
    `${DAMAGE} · player.ts`, /protection|resist/i,
    'BoE’s Full Protection is a different rule (it thins every kind of harm); E3’s is these four resistances.', 'partly'),
  129: {
    effect: () => 'When taken it becomes cursed, weighs 20 and is equipped at once, so it can’t be dropped.',
    where: 'inventory.ts · give_to_pc 1070:01d1', agrees: /heav/i, verdict: 'partly',
    note: 'Its weight comes from its own weight byte; nothing adds BoE’s +30.',
  },
  130: { effect: () => '“You get very stiff.” Paralyses the drinker for 2000 turns.', where: USE, agrees: /cause paralysis|paralyz/i },
  131: worn('Adds 50 damage against reptiles.', ATTACK, /lizard|reptile/i),
  132: { effect: () => 'No ability: a quest object.', where: '—' },
  133: { effect: () => '“Your party is hasted!” Every living PC hasted by 4.', where: USE },
  134: worn('Adds 30 damage against the Alien Beast and its Pack Leader only (by monster, not by type).', ATTACK),
  135: {
    effect: () => 'Skribbane: the first ten pick everyone up (by less each time); after that only the craving. ' +
      'Feeds an addiction with a withdrawal that cuts health and spell points to 3/5.',
    where: 'e3ItemUse.ts · 10c0:3b74, 10c0:6ebe',
  },
};

/** Readables (160–183): the converter makes them scenario specials. */
const READABLE: Rule = {
  effect: () => 'Reading it shows its text (a scenario special the converter wrote from E3’s strings).',
  where: 'tools/e3convert/notes.ts',
  agrees: /unusual ability|readable/i,
};

/** The Skill Rings: E3's to-hit slip deserves its own words. */
function skillRing(it: Item): string {
  const l = it.itemLevel;
  return `+${l} melee damage — and the hit roll goes UP ${(l + 1) * 5}, so blows land ${(l + 1) * 5}% ` +
    'LESS often. E3’s own slip, which 1997’s pc_attack kept; the character sheet counts it as a bonus.';
}

/** Where E3's use codes let an item be used (`E3_USE_CODE`, 1140:0000). */
export function useWhere(code: number): string | null {
  let u = E3_USE_CODE[code];
  if (u === undefined || code >= 160) return null;
  const inept = u >= 10;
  if (inept) u -= 10;
  const where = ['anywhere', 'in combat only', 'not in combat', 'in town or combat', null, 'outdoors only'][u];
  if (!where) return null;
  return inept ? `${where}; even the magically inept` : where;
}

export function hasRule(code: number): boolean {
  return code < 0 || code >= 160 || RULES[code] !== undefined;
}

/** The codes with an entry, for the test. */
export const RULE_CODES = Object.keys(RULES).map(Number);

export function readE3Item(it: Item, inGameAbil: string, scen: Scenario): ItemReading {
  const code = it.e3Ability;
  if (code < 0) {
    return { effect: 'Not an Exile III item.', where: '—', verdict: 'none', note: '' };
  }
  const rule = code >= 160 ? READABLE : RULES[code];
  if (!rule) {
    return {
      effect: `E3 ability code ${code}: nothing in the port reads it.`, where: '—', verdict: 'unread',
      note: 'An E3 ability code with no rule in the port at all.',
    };
  }
  const effect = code === 101 ? skillRing(it) : rule.effect(it, scen);
  const said = inGameAbil.startsWith('Key skill:') ? '' : inGameAbil;
  if (code === 0 || (code >= 102 && !rule.agrees && !said && rule.where === '—')) {
    return { effect, where: rule.where, verdict: said ? 'differs' : 'none',
      note: said ? `The sheet says “${said}”, but E3 gives it no ability.` : '' };
  }
  const agrees = typeof rule.agrees === 'function' ? rule.agrees() : rule.agrees;
  const fits = agrees !== undefined && agrees.test(said);
  let verdict: Verdict;
  let note = rule.note ?? '';
  if (!fits) {
    verdict = 'differs';
    note = said
      ? `The sheet says “${said}”. ${rule.note ?? ''}`.trim()
      : `The sheet shows no ability. ${rule.note ?? ''}`.trim();
  } else {
    verdict = rule.verdict ?? (rule.note ? 'partly' : 'agrees');
  }
  if (code === 101) {
    verdict = 'differs';
    note = 'The sheet says Skill, a bonus; E3’s code makes hitting harder.';
  }
  if (code === 14) {
    // BoE's sheet never shows a curse; only the name can give it away.
    const named = /curse/i.test(it.fullName);
    verdict = named ? 'agrees' : 'differs';
    note = named ? 'Only the name says so: the sheet shows no curse.'
      : 'A hidden curse: neither the name nor the sheet says so, and it can’t be taken off once worn.';
  }
  if (code === 32 && fits && it.variety !== ItemType.ONE_HANDED && it.variety !== ItemType.TWO_HANDED) {
    verdict = 'differs';
    note = `The sheet says “${said}”, but on a missile E3’s venom does nothing.`;
  }
  return { effect, where: rule.where, verdict, note };
}

/**
 * The item's numbers as the combat code uses them — what the sheet's
 * "Damage", "Bonus", "Defend" and "Encumbrance" boxes stand for.
 *
 * "To hit +N" is against the same item with no bonus: a blow rolls 1–100
 * plus its adjustments and lands at or under the hit chance for the skill
 * (`pcAttackWeapon`, missiles.ts), and each bonus point takes 5 off the roll,
 * so N more in a hundred blows land, until they all do.
 */
export function combatLine(it: Item): string {
  const L = it.itemLevel;
  const b = it.bonus;
  switch (it.variety) {
    case ItemType.ONE_HANDED:
    case ItemType.TWO_HANDED: {
      const skill = it.weapType >= 0 ? `; rolls on ${weaponSkillName(it.weapType)}` : '';
      // A two-handed weapon is always the only one, so always "primary".
      const hands = it.variety === ItemType.TWO_HANDED
        ? `Hits for 1–${L}${b ? ` + ${b}` : ''} + 2 (two-handed, so always the main weapon)`
        : `Hits for 1–${L}${b ? ` + ${b}` : ''} (+2 as the only or main weapon, −1 in the off hand)`;
      return `${hands}${b ? `; to hit +${b * 5}` : ''}${skill}.`;
    }
    case ItemType.BOW:
    case ItemType.CROSSBOW:
      return `Launcher: ${b ? `to hit +${b * 5}` : 'no to-hit bonus'}; damage is the ammunition’s.`;
    case ItemType.ARROW:
    case ItemType.BOLTS:
    case ItemType.THROWN_MISSILE:
    case ItemType.MISSILE_NO_AMMO:
      return `Each hit 1–${L}${b ? ` + ${b}` : ''}` +
        `${it.variety === ItemType.THROWN_MISSILE ? '; the bonus adds damage only (no launcher)' : ''}.`;
    case ItemType.SHIELD:
    case ItemType.SHIELD_2:
    case ItemType.ARMOR:
    case ItemType.HELM:
    case ItemType.GLOVES:
    case ItemType.BOOTS: {
      const parts = [L > 0 ? `blocks 1–${L} of each blow` : 'blocks nothing by its level'];
      if (b > 0) parts.push(`+1–${b} + ${Math.trunc(b / 2)} for its enchantment`);
      else if (b < 0) parts.push(`${-b} MORE damage through (cursed bonus)`);
      if (it.protection > 0) parts.push(`+1–${it.protection} protection`);
      else if (it.protection < 0) parts.push(`1–${-it.protection} more damage through`);
      if (it.awkward > 0) {
        parts.push(`encumbrance ${it.awkward}: your own blows to hit −${it.awkward * 5}, ` +
          'and every 3 costs an action point (Defense skill may shrug one off)');
      }
      return `${parts.join('; ')}.`;
    }
    default:
      return '';
  }
}
