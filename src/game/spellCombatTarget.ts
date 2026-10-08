/**
 * Targeted spells in combat — `start_spell_targeting` (boe.combat.cpp:4910)
 * and `do_combat_cast` (:839).
 *
 * `combat_cast_*_spell` hands off to here for anything with `REFER_TARGET`:
 * the game drops into `MODE_SPELL_TARGET`, remembers the spell, and the next
 * click on the terrain is where it lands.
 *
 * `do_combat_cast` is one long switch, and its shape is worth knowing:
 *
 * - the *cost* is taken once, on the first target that resolves, not up front;
 * - the *action points* likewise, and only 5 of them, not the 6 a REFER_YES or
 *   REFER_IMMED spell pays through `combat_cast_*_spell`;
 * - the arms fall into three groups — fields laid with `place_spell_pattern`,
 *   spells that fly at a square, and spells that need somebody standing there.
 */

import { Location, dist, loc, locsEqual } from '../core/location';
import { FieldType } from '../data/fields';
import { DamageType } from '../data/monster';
import { SpellPat, WALL_ROTATIONS, getBuiltinPattern } from '../data/pattern';
import { Spell, SPELLS, isMage, isPriestSide, spellName } from '../data/spell';
import { ItemAbil } from '../data/item';
import { SIGHT_BLOCKED } from '../core/sight';
import { Creature } from '../universe/creature';
import { getProtLevel, removeCharge } from '../universe/inventory';
import { livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { Race, Skill, Status, Trait } from '../universe/skills';
import { takeAp } from './combat';
import { boomType, damageMonst, damagePc, handleMarkedDamage, hitChance } from './damage';
import { targetThere } from './missiles';
import { GameMode } from './modes';
import { SpecCtx } from './specials/context';
import { handleTargetMode } from './targetMode';
import { drawTerrain, missileAnimFrames } from './textBar';
import { getSummonMonster, summonMonster } from './monsterPlace';
import { Attitude } from '../data/monster';
import { animAt, animSettle } from './anim';
import { holdForSound, runAMissile } from './missileAnim';
import { boomAnimActive, boomSpace, runBoomAnim, startBoomAnim } from './booms';
import { hitSpace } from './processFields';
import { placeSpellPattern } from './spellPatterns';
import { recordMonst } from './soulCrystal';
import { doMindduel } from './mindduel';
import { hasAbil } from './alchemy';
import { makeTownHostile } from './townAttitude';
import type { GameSession } from './session';

/** What `start_spell_targeting` parks while it waits for a square. */
export interface SpellTarget {
  spell: Spell;
  freebie: boolean;
  pattern: SpellPat;
  range: number;
  itemSpellLevel: number;
  /** Squares collected in FANCY_TARGET mode; empty for a single-target spell. */
  targets: Location[];
  /** How many more squares a fancy spell still wants (`num_targets_left`). */
  targetsLeft: number;
  /**
   * Whether this is `start_fancy_spell_targeting`'s mode rather than
   * `start_spell_targeting`'s. The two feed `do_combat_cast` differently: the
   * single-target arm writes `spell_targets[0] = target` and leaves
   * `num_targets` at 1, while the fancy arm sets `num_targets = 8` and walks
   * the eight collected slots — so a fancy cast with **nothing** collected
   * casts at nothing, where a single-target one always has its square. That
   * distinction cannot be recovered from `targets.length`, which is 0 in both
   * cases at the moment it is asked.
   */
  fancy: boolean;
}

/**
 * `spray_type_array` — Spray Fields rolls one of fifteen slots, so the odds are
 * weighted: webs three ways, fire three, force/antimagic/stink/ice two each,
 * and blades only one.
 */
const SPRAY_FIELDS: FieldType[] = [
  FieldType.FIELD_WEB, FieldType.FIELD_WEB, FieldType.FIELD_WEB,
  FieldType.WALL_FORCE, FieldType.WALL_FORCE,
  FieldType.WALL_FIRE, FieldType.WALL_FIRE, FieldType.WALL_FIRE,
  FieldType.FIELD_ANTIMAGIC, FieldType.FIELD_ANTIMAGIC,
  FieldType.CLOUD_STINK, FieldType.CLOUD_STINK,
  FieldType.WALL_ICE, FieldType.WALL_ICE, FieldType.WALL_BLADES,
];

/** The target shape each spell uses (`start_spell_targeting`'s own switch). */
function patternFor(spell: Spell): SpellPat {
  switch (spell) {
    case Spell.CLOUD_SLEEP:
      return SpellPat.SMALL_SQUARE;
    case Spell.DISPEL_SQUARE: case Spell.FIREBALL: case Spell.CLOUD_STINK:
    case Spell.FLAMESTRIKE: case Spell.FORCEFIELD:
      return SpellPat.SQUARE;
    case Spell.CONFLAGRATION: case Spell.FIRESTORM: case Spell.SHOCKSTORM:
    case Spell.WEB: case Spell.ANTIMAGIC: case Spell.WALL_ICE_BALL:
    case Spell.CLOUD_SLEEP_LARGE: case Spell.DIVINE_THUD: case Spell.DISPEL_SPHERE:
      return SpellPat.RADIUS_2;
    case Spell.PESTILENCE: case Spell.GOO_BOMB: case Spell.FOUL_VAPOR:
      return SpellPat.RADIUS_3;
    case Spell.WALL_FORCE: case Spell.WALL_ICE: case Spell.WALL_BLADES:
      return SpellPat.WALL;
    default:
      return SpellPat.SINGLE;
  }
}

/**
 * The arms of `do_combat_cast`'s switch that come **before** its `default:`
 * (boe.combat.cpp:952-1010), which is where `start_missile_anim()` is called.
 * These lay a field, a barrier or a special down and animate nothing, so no
 * volley is opened for them and the explosions they would have queued are
 * dropped — rolls and all.
 */
const NO_VOLLEY = new Set<Spell>([
  Spell.NONE,
  Spell.GOO, Spell.WEB, Spell.GOO_BOMB,
  Spell.CLOUD_FLAME, Spell.CONFLAGRATION,
  Spell.CLOUD_STINK, Spell.FOUL_VAPOR,
  Spell.WALL_FORCE, Spell.SHOCKSTORM, Spell.FORCEFIELD,
  Spell.WALL_ICE, Spell.WALL_ICE_BALL,
  Spell.ANTIMAGIC,
  Spell.CLOUD_SLEEP, Spell.CLOUD_SLEEP_LARGE,
  Spell.QUICKFIRE,
  Spell.SPRAY_FIELDS,
  Spell.WALL_BLADES,
  Spell.DISPEL_FIELD, Spell.DISPEL_SPHERE, Spell.DISPEL_SQUARE,
  Spell.BARRIER_FIRE, Spell.BARRIER_FORCE,
]);

/** `start_spell_targeting` — go into targeting with `spell` in the air. */
export function startSpellTargeting(
  session: GameSession, spell: Spell, freebie = false, itemSpellLevel = 1,
  /**
   * `spell_range` and `pat`, which are **only read for `eSpell::NONE`** — a
   * special node's own targeting, where there is no spell to take a range or a
   * shape from (boe.combat.cpp:4960 and its `case eSpell::NONE: // Do nothing
   * - use the pat passed in`).
   */
  spellRange = 0, pat: SpellPat = SpellPat.SINGLE,
): void {
  const { univ } = session;
  const none = spell === Spell.NONE;
  univ.addStringToBuf('  Target spell.');
  // `if(num == eSpell::NONE);` — an empty statement, so a node's targeting
  // says which key cancels it and nothing else does.
  if (!none) {
    univ.addStringToBuf(isMage(spell) ? "  (Hit 'm' to cancel.)" : "  (Hit 'p' to cancel.)");
  }
  session.mode = GameMode.SPELL_TARGET;
  // `handle_target_mode(MODE_SPELL_TARGET, current_spell_range, num)`
  // (boe.combat.cpp:4961) — between the prompt and the pattern switch. The
  // range it locks on is the spell's own.
  const range = none ? spellRange : (SPELLS[spell]?.range ?? 0);
  handleTargetMode(session, range, spell);
  const pattern = none ? pat : patternFor(spell);
  // The tail of `start_spell_targeting` (boe.combat.cpp:4958): a rotatable
  // pattern — PAT_WALL is the only one — says so and starts at rotation 0.
  if (pattern === SpellPat.WALL) {
    univ.addStringToBuf('  (Hit space to rotate.)');
    session.forceWallPosition = 0;
    // `current_pat = pattern.patterns[0]` (boe.combat.cpp:4996).
    session.currentPat = getBuiltinPattern(SpellPat.WALL, 0);
  } else session.currentPat = getBuiltinPattern(pattern);
  session.spellTargeting = {
    spell,
    freebie,
    pattern,
    range,
    itemSpellLevel,
    targets: [],
    targetsLeft: 0,
    fancy: false,
  };
}

/**
 * `spell_cast_hit_return` (boe.combat.cpp:5038) — **Space while a wall spell is
 * aimed turns the wall**, stepping through PAT_WALL's eight rotations. It is
 * the only thing Space does in SPELL_TARGET mode: it does not pause the turn
 * and it does not cast.
 *
 * The recordings call it `spell_cast_hit_return`, which is how the replay
 * driver reaches it.
 */
export function spellCastHitReturn(session: GameSession): void {
  if (session.forceWallPosition >= 10) return;
  session.forceWallPosition = (session.forceWallPosition + 1) % WALL_ROTATIONS;
  // `current_pat = pat.patterns[force_wall_position]` (boe.combat.cpp:5082).
  session.currentPat = getBuiltinPattern(SpellPat.WALL, session.forceWallPosition);
}

/** Back out of targeting; nothing has been spent. */
export function cancelSpellTargeting(session: GameSession): void {
  if (session.spellTargeting === null) return;
  const spell = session.spellTargeting.spell;
  session.spellTargeting = null;
  session.mode = GameMode.COMBAT;
  // **The view snaps back to the caster** — `center =
  // univ.current_pc().combat_pos` (boe.actions.cpp:436). It matters beyond the
  // picture: `handle_terrain_screen_actions` reads the next move off `center`,
  // not off the acting PC, so a spell aimed after scrolling the view and then
  // cancelled leaves the arrow keys pointing at the scrolled square unless
  // this runs. Note the MODE_TOWN_TARGET arm just above it does **not**
  // recentre — that asymmetry is the C++'s, not a slip here.
  session.center = { ...session.univ.currentPc.combatPos };
  // `if(spell_being_cast == eSpell::NONE) queue_special(TARGET, …,
  // spec_target_fail, …)` (boe.actions.cpp:439) — **backing out of a node's
  // targeting is a failure**, and the scenario is told so. The square handed
  // over is the caster's, not one the player picked.
  if (spell === Spell.NONE) {
    session.specials?.queueSpecial(SpecCtx.TARGET, session.specTargetType,
      session.specTargetFail, session.univ.currentPc.combatPos);
  }
}
/**
 * How many squares each `REFER_FANCY` spell collects
 * (`start_fancy_spell_targeting`'s own switch). Everything is clamped to 1..8
 * at the end, so a weak caster still gets one.
 */
function fancyTargetCount(spell: Spell, level: number, bonus: number): number {
  const t = Math.trunc;
  let n: number;
  switch (spell) {
    case Spell.SMITE: n = t(level / 4) + t(bonus / 2); break;
    case Spell.STICKS_TO_SNAKES: n = t(level / 5) + t(bonus / 2); break;
    case Spell.SUMMON_HOST: n = 5; break;
    case Spell.ARROWS_FLAME: n = t(level / 4) + t(bonus / 2); break;
    case Spell.ARROWS_VENOM: n = t(level / 5) + t(bonus / 2); break;
    case Spell.ARROWS_DEATH: case Spell.PARALYZE: n = t(level / 8) + t(bonus / 3); break;
    case Spell.SPRAY_FIELDS: n = t(level / 5) + t(bonus / 2); break;
    case Spell.SUMMON_WEAK: n = Math.min(7, t(level / 4) + t(bonus / 2)); break;
    case Spell.SUMMON: n = Math.min(6, t(level / 6) + t(bonus / 2)); break;
    case Spell.SUMMON_MAJOR: n = Math.min(5, t(level / 8) + t(bonus / 2)); break;
    default: n = 1; break;
  }
  return Math.max(1, Math.min(8, n));
}

/**
 * `start_fancy_spell_targeting` (boe.combat.cpp:4961) — the multi-target
 * spells. The player picks up to `targetsLeft` squares; clicking one already
 * chosen takes it back off the list, and the spell fires by itself once the
 * last slot is filled (or on space, early).
 */
export function startFancySpellTargeting(
  session: GameSession, spell: Spell, freebie = false, itemSpellLevel = 1,
  /** As above, all three read only for `eSpell::NONE`. */
  spellRange = 0, pat: SpellPat = SpellPat.SINGLE, targets = 1,
): void {
  const { univ } = session;
  const caster = univ.currentPc;
  const none = spell === Spell.NONE;
  univ.addStringToBuf('  Target spell.');
  if (!none) {
    univ.addStringToBuf(isMage(spell) ? "  (Hit 'm' to cancel.)" : "  (Hit 'p' to cancel.)");
  }
  univ.addStringToBuf('  (Hit space to cast.)');
  const bonus = caster.statAdj(Skill.INTELLIGENCE);
  const level = freebie ? itemSpellLevel : caster.level;
  session.mode = GameMode.FANCY_TARGET;
  // `handle_target_mode(MODE_FANCY_TARGET, …)` (boe.combat.cpp:5016). The C++
  // calls it before it works out the bonus and level below, but neither of
  // those draws, so only the mode being FANCY by now matters — and it is,
  // because `handle_target_mode` is what sets it there.
  const range = none ? spellRange : (SPELLS[spell]?.range ?? 0);
  handleTargetMode(session, range, spell);
  session.spellTargeting = {
    spell,
    freebie,
    // Fancy targeting can't rotate a wall, so Spray Fields gets a plus and
    // everything else a single square — except a node's own targeting, which
    // keeps the shape it was given.
    pattern: none ? pat : (spell === Spell.SPRAY_FIELDS ? SpellPat.PLUS : SpellPat.SINGLE),
    range,
    itemSpellLevel,
    targets: [],
    targetsLeft: none
      ? Math.max(1, Math.min(8, targets))
      : fancyTargetCount(spell, level, bonus),
    fancy: true,
  };
  // `current_pat` (boe.combat.cpp:5062) — and **fancy targeting cannot rotate
  // a wall**, so PAT_WALL is silently swapped for a single square, with the
  // C++'s own "TODO: Some sort of error message" beside it.
  const shape = session.spellTargeting.pattern;
  session.currentPat = getBuiltinPattern(
    shape === SpellPat.WALL ? SpellPat.SINGLE : shape);
}

/**
 * `place_target` (:784) — a click while collecting. Clicking a square already
 * on the list takes it off again; filling the last slot casts at once.
 */
export async function placeTarget(session: GameSession, target: Location): Promise<void> {
  const armed = session.spellTargeting;
  if (!armed) return;
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const caster = univ.currentPc;

  if (armed.targetsLeft > 0) {
    const rect = town.record.inTownRect;
    if (target.x < rect.left || target.x > rect.right
      || target.y < rect.top || target.y > rect.bottom) {
      univ.addStringToBuf('  Space not in town.');
      return;
    }
    if (session.canSeeLight(caster.combatPos, target) > 4) {
      univ.addStringToBuf("  Can't see target.");
      return;
    }
    if (dist(caster.combatPos, target) > armed.range) {
      univ.addStringToBuf('  Target out of range.');
      return;
    }
    const allowObstructed = armed.spell === Spell.DISPEL_BARRIER;
    if (!allowObstructed && session.sightObscurity(target.x, target.y) === 5) {
      univ.addStringToBuf('  Target space obstructed.');
      return;
    }
    if (town.hasField(target.x, target.y, FieldType.FIELD_ANTIMAGIC)) {
      univ.addStringToBuf('  Target in antimagic field.');
      return;
    }
    const already = armed.targets.findIndex(
      (t) => t.x === target.x && t.y === target.y);
    if (already >= 0) {
      univ.addStringToBuf('  Target removed.');
      armed.targets.splice(already, 1);
      armed.targetsLeft++;
      return;
    }
    univ.addStringToBuf('  Target added.');
    armed.targets.push({ ...target });
    armed.targetsLeft--;
  }

  if (armed.targetsLeft === 0) await castCollected(session);
}

/**
 * Space — fire with however many squares have been picked so far, **including
 * none**.
 *
 * `place_target`'s tail is a bare `if(num_targets_left == 0) {
 * do_combat_cast(spell_targets[0]); }` (boe.combat.cpp:831) with no test for
 * whether anything was ever collected, and Space in FANCY mode reaches it by
 * setting the count to 0 itself (boe.actions.cpp:3011). So a fancy spell fired
 * with an empty list runs `do_combat_cast` on `spell_targets[0]`, which
 * `start_fancy_spell_targeting` has set to (-1,0): the per-target loop finds
 * nothing and resolves nothing, no points and no spell points are spent — and
 * the **preamble still runs**. It drops the caster's Sanctuary, resets the
 * force-wall rotation, rolls a summon's species if the spell summons, and sets
 * `spell_caster`, which is what makes every hostile creature in the fight
 * prefer that PC for the rest of it.
 *
 * This port used to cancel instead, on the reasonable reading that a cast with
 * no target is not a cast. It costs a file: `ASR_20-05-2025_07-20-41` recasts a
 * priest spell whose `num_targets_left` the recording gives as **0**, so the
 * empty branch is the only one taken, and `spell_caster` stayed on the PC who
 * had cast before. Six draws later — three PCs' worth of `total_encumbrance` in
 * `switch_target_to_adjacent`, which this port never reached because its
 * creature had picked an adjacent target already — the streams part.
 */
export async function castCollected(session: GameSession): Promise<void> {
  const armed = session.spellTargeting;
  if (!armed) return;
  // The square is ignored on the fancy path; `doCombatCast` reads the list.
  await doCombatCast(session, armed.targets[0] ?? loc(-1, 0));
}

/**
 * `do_combat_cast` — resolve the spell in the air.
 *
 * In `SPELL_TARGET` mode that is the one square clicked; in `FANCY_TARGET` it
 * is every square collected, and the C++ walks all eight slots. The cost and
 * the action points are each taken **once**, on the first target that gets as
 * far as resolving.
 */
/**
 * `CAST=1` — one line per target `do_combat_cast` weighs, the pair to the
 * harness's `BOE_TRACE_CAST=1` (`[cast] spell= from= to= adjust= range= dist=
 * obsc=`). Reach for it when two runs disagree about *which* spell landed
 * where, which the draw stream cannot say on its own.
 *
 * **The oracle's half of this instrument moves its own draw stream.** The
 * C++'s `[cast] mage` line prints `total_encumbrance(hit_chance)`, which
 * *rolls* — so a `BOE_TRACE_CAST=1` trace is a hundred draws out of step with
 * the cached one and cannot be compared against a JS run. Use it for the
 * `[cast] spell=` lines and their ordering, never for draw indices.
 */
const TRACE_CAST = typeof process !== 'undefined' && Boolean(process.env?.CAST);

/** One entry of `store_missiles` — what `add_missile` queues up. */
export interface QueuedMissile {
  dest: Location;
  type: number;
  pathType: number;
  xAdj: number;
  yAdj: number;
}

/**
 * `add_missile` (boe.newgraph.cpp:278) — queue a projectile for the volley that
 * `do_missile_anim` will fly. Two rules worth keeping: a second missile aimed
 * at a square that already has one is **dropped** (so a spell that hits the
 * same square twice only draws one), and the queue holds thirty.
 */
export function addMissile(
  queue: QueuedMissile[], dest: Location, type: number, pathType = 1, xAdj = 0, yAdj = 0,
): void {
  if (queue.some((m) => m.dest.x === dest.x && m.dest.y === dest.y)) return;
  if (queue.length >= 30) return;
  queue.push({ dest: { ...dest }, type, pathType, xAdj, yAdj });
}

/**
 * `do_missile_anim` (boe.newgraph.cpp:347) — fly everything queued, all from
 * the same origin. `numSteps` is both the frame count and the arc divisor; the
 * C++ passes 35 for a volley and 60 for a single shot.
 */
export async function flyMissiles(
  session: GameSession,
  queue: QueuedMissile[], from: Location, sound: number, numSteps: number,
): Promise<void> {
  // `do_missile_anim`'s two early-outs, both before the first `draw_terrain`
  // and so both *free* (boe.newgraph.cpp:358 and :379): nothing was queued at
  // all, or everything queued was aimed at the square it was fired from —
  // "eliminate missiles traveling 0 distance" — which leaves the target list
  // empty. A volley that never flies pays no frames.
  const flying = boomAnimActive()
    ? queue.filter((m) => !locsEqual(m.dest, from)) : [];
  const flew = flying.length > 0;
  const t0 = animAt();
  // **One sound for the volley**, not one a missile: `do_missile_anim` plays
  // `sound_num` once, after the early-outs (boe.newgraph.cpp:429). Passing it
  // to every `runAMissile` made Major Blessing ring out once for each PC.
  if (flew && sound > 0) livingSound(-sound);
  for (const m of flying) {
    runAMissile(from, m.dest, m.type, m.pathType, 0, m.xAdj, m.yAdj, numSteps, false);
  }
  if (flew) holdForSound(sound, t0);
  queue.length = 0;
  // **The whole volley flies on one `do_missile_anim`** (boe.combat.cpp:1419),
  // which is why the frames are counted here and not inside `runAMissile`:
  // paying them per projectile would multiply the count by the size of the
  // volley. `have_missile` is `flew` — an empty queue returns before the loop
  // there, and must cost nothing here.
  if (flew) missileAnimFrames(session, numSteps);
  // `do_missile_anim` blocks for the flight, which is what puts the hits that
  // follow it — the deferred `hitSpace` calls, the explosions — after the
  // projectiles have arrived rather than over the top of them.
  await animSettle();
}

export async function doCombatCast(session: GameSession, target: Location): Promise<void> {
  const armed = session.spellTargeting;
  if (!armed) return;
  // `num_targets = 8` and a walk of `spell_targets` on the fancy path
  // (boe.combat.cpp:888), `spell_targets[0] = target` and one target on the
  // other. An empty list on the fancy path is a real state — see
  // `castCollected` — and must not fall back to the square that was clicked.
  const targets = armed.fancy ? [...armed.targets] : [target];
  session.spellTargeting = null;
  session.mode = GameMode.COMBAT;

  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const caster = univ.currentPc;
  const spell = armed.spell;
  // **Not `if (!info) return;`.** A special node's targeting casts
  // `eSpell::NONE`, which has no table row at all, and the C++ only ever
  // dereferences the row under `!freebie` — which a node's targeting never is.
  const info = SPELLS[spell];
  if (!info && spell !== Spell.NONE) return;
  const freebie = armed.freebie;

  // Note `level` here is *not* the caster's level: it is a spell-power figure
  // that starts at half of it. Every damage roll below leans on this.
  let level: number;
  let bonus = 1;
  if (freebie) {
    level = Math.max(2, Math.min(20, armed.itemSpellLevel));
  } else {
    level = 1 + Math.trunc(caster.level / 2);
    bonus = caster.statAdj(Skill.INTELLIGENCE);
    if ((info?.level ?? 0) <= getProtLevel(caster, ItemAbil.MAGERY)) level++;
    if (caster.traits[Trait.ANAMA] && isPriestSide(spell)) level++;
  }

  // `force_wall_position = 10` (boe.combat.cpp:882) — no wall is being aimed
  // any more. The C++ can reset it here and still place a rotated wall further
  // down, because the *grid* it chose is sitting in `current_pat`; this port
  // has no such global, so the rotation is read out first and handed to
  // `resolveOne`.
  const rot = session.forceWallPosition < WALL_ROTATIONS ? session.forceWallPosition : 0;
  session.forceWallPosition = 10;

  // Casting drops Sanctuary, whatever the spell.
  caster.status[Status.INVISIBLE] = 0;

  // boe.combat.cpp:893, in this position: monsters prefer the last PC to cast,
  // so this is what makes casting draw fire. A special's own targeting arrives
  // here with no spell and doesn't count.
  if (spell !== Spell.NONE) session.spellCaster = univ.curPc;

  // "assign monster summoned, if summoning" (boe.combat.cpp:895) — **once for
  // the whole cast, before the target loop**, so a five-square Summon Aid
  // brings five of the *same* creature. This port called `get_summon_monster`
  // inside the per-target arm, which re-rolled the species for every square
  // and, because that function is a 200-try search, spent a fresh run of
  // `get_ran(1,0,195)` draws doing it.
  let summon = 0;
  if (spell === Spell.SUMMON_BEAST) {
    summon = getSummonMonster(session, 1, { beast: true });
  } else if (spell === Spell.SUMMON_WEAK) {
    summon = getSummonMonster(session, 1);
  } else if (spell === Spell.SUMMON || spell === Spell.SUMMON_AID) {
    summon = getSummonMonster(session, 2);
  } else if (spell === Spell.SUMMON_MAJOR || spell === Spell.SUMMON_AID_MAJOR) {
    summon = getSummonMonster(session, 3);
  }

  const rng = univ.rng;
  const min = Math.min;
  const who = univ.curPc;
  let costTaken = false;
  let apTaken = false;
  /**
   * The arms that hold their damage back to the end (`boom_dam` in the C++), so
   * a volley of arrows lands together rather than one at a time.
   */
  const deferred: { at: Location; type: DamageType; dam: number }[] = [];
  // `ashes_loc` — the fire spells mark the middle of the burn, so that the
  // scorch they leave has a blast over it even when nothing there was hurt.
  const ashes: { at: Location | null } = { at: null };
  /**
   * `store_missiles` and `store_sound`. Most arms only queue their projectile
   * and let the shared `do_missile_anim` at the end of `do_combat_cast` fly it;
   * a handful (Flame, Spark, Wound, Kill, Flash Step) fire theirs on the spot,
   * which is why the flight happens before their damage does.
   */
  const missiles: QueuedMissile[] = [];
  const shared = { sound: 0 };
  // Open the volley: from here until `runBoomAnim` the hit sprites are
  // collected rather than shown, so they can't beat the projectile onto the
  // screen.
  //
  // **Only for the spells the C++ opens it for.** `start_missile_anim()` sits
  // in the `default:` arm of `do_combat_cast`'s switch — "spells which involve
  // animations" (boe.combat.cpp:1011) — and every arm *above* it, the ones
  // that only lay a field down, never calls it. With `boom_anim_active` false,
  // `add_explosion` returns at its second line and **makes no roll**, so
  // opening the volley for a Wall of Ice cost one `get_ran(1,0,2)` per square
  // the wall damaged. Note the list is of arms, not of a property: Quickfire
  // and the barriers are in it too.
  const animated = !NO_VOLLEY.has(spell);
  if (animated) startBoomAnim();
  session.blastIntercepted = false;

  try {
  for (let i = 0; i < targets.length; i++) {
    const at = targets[i]!;
    if (!costTaken && !freebie) {
      // Two spells don't pay the table's price: Mindduel is free (it charges a
      // smoky crystal instead) and Simulacrum pays the summoned monster's
      // level, worked out when the slot was picked.
      if (spell === Spell.SIMULACRUM) {
        caster.curSp -= session.sumMonstCost;
        costTaken = true;
      } else if (spell !== Spell.MINDDUEL) {
        caster.curSp -= info?.cost ?? 0;
        costTaken = true;
      }
    }

    // --- the refusals, in the C++'s order ----------------------------------
    const adjust = session.canSeeLight(caster.combatPos, at);
    if (TRACE_CAST) {
      console.log(`      [cast] spell=${spell} from=(${caster.combatPos.x},${caster.combatPos.y})`
        + ` to=(${at.x},${at.y}) adjust=${adjust} range=${armed.range}`
        + ` dist=${dist(caster.combatPos, at)} obsc=${session.sightObscurity(at.x, at.y)}`);
    }
    // `if(spell_being_cast == DISPEL_BARRIER || (spell_being_cast == NONE &&
    // spec_target_options % 10 == 1)) allow_obstructed = true;`
    // (boe.combat.cpp:857). The C++ hoists both out of the loop; only the value
    // matters. Its `allow_antimagic` twin below it reads
    // `spec_target_options / 10 == 2` and assigns **false**, which is what the
    // variable already held — so a node can never let a cast through an
    // antimagic field in combat, however it sets its options.
    const allowObstructed = spell === Spell.DISPEL_BARRIER
      || (spell === Spell.NONE && session.specTargetOptions % 10 === 1);
    // `if(adjust <= 4 && !cast_spell_on_space(target, spell_being_cast))`
    // (boe.combat.cpp:930) — the square's own `IF_CONTEXT` node cancels this
    // target and the loop moves to the next one, after queueing the
    // targeting's failure node. Above the sight test, because a square you
    // cannot see cannot intercept.
    if (adjust <= 4 && !(await session.castSpellOnSpace(at, spell))) {
      session.specials?.queueSpecial(
        SpecCtx.TARGET, session.specTargetType, session.specTargetFail, at);
      continue;
    }
    // `bool failed = spell_being_cast == eSpell::NONE;` (boe.combat.cpp:934) —
    // a node's targeting starts *failed*, and every one of the refusals below
    // leaves it that way, because the C++ chains them with `else if` and falls
    // through to `if(failed) queue_special(…, spec_target_fail)` at the tail
    // of the loop (:1415). A real spell starts succeeded and never queues.
    let failed = spell === Spell.NONE;
    const rect = town.record.inTownRect;
    if (adjust > 4) {
      univ.addStringToBuf("  Can't see target.");
    } else if (at.x < rect.left || at.x > rect.right
      || at.y < rect.top || at.y > rect.bottom) {
      univ.addStringToBuf('  Space not in town.');
    } else if (dist(caster.combatPos, at) > armed.range) {
      univ.addStringToBuf('  Target out of range.');
    } else if (session.sightObscurity(at.x, at.y) === 5 && !allowObstructed) {
      univ.addStringToBuf('  Target space obstructed.');
    } else if (town.hasField(at.x, at.y, FieldType.FIELD_ANTIMAGIC)) {
      univ.addStringToBuf('  Target in antimagic field.');
    } else {
      failed = false;
      // A targeted spell costs 5 AP, not the 6 an untargeted one pays.
      if (!apTaken) {
        if (!freebie) takeAp(univ, 5);
        apTaken = true;
        // `draw_terrain(2)` (boe.combat.cpp:955), and **mode 2 is not free**:
        // it suppresses the working creature's own square and then falls through
        // by setting `mode = 0` (boe.graphics.cpp:859), so it reaches
        // `draw_text_bar` like any other full redraw. The early-out above it —
        // `if(current_working_monster < 0) return;` — is what makes some mode-2
        // redraws free, and here the caster is `univ.cur_pc` (:903), so this one
        // is not.
        drawTerrain(session);
      }

      const one = { pattern: armed.pattern, rot, level, bonus, who, rng, min,
        deferred, missiles, shared, ashes, summon, failed };
      await resolveOne(session, spell, at, i, one);
      // Only the `eSpell::NONE` arm writes it back: `failed = r1`, the answer
      // its node gave.
      failed = one.failed;
    }
    if (failed) {
      session.specials?.queueSpecial(
        SpecCtx.TARGET, session.specTargetType, session.specTargetFail, at);
    }
  }

  // The trailing do_missile_anim (boe.combat.cpp:1412): whatever is still
  // queued flies now, faster when there's a volley of them than for one shot.
  // `do_missile_anim((num_targets > 1) ? 35 : 60, …)` (boe.combat.cpp:1419) —
  // and **`num_targets` is 1 or 8, never the number of squares collected**: the
  // targeted path sets `spell_targets[0]` and leaves it at 1, the fancy path
  // sets it to 8 up front (:888) and walks the array. So a fancy cast flies at
  // 35 steps however few squares it ended up with. This port read
  // `targets.length` and gave a one-square Venom Arrows sixty-one frames
  // instead of thirty-six — twenty-five encumbrance rolls too many.
  const numTargets = armed.fancy ? 8 : 1;
  await flyMissiles(session, missiles, caster.combatPos, shared.sound,
    numTargets > 1 ? 35 : 60);

  // The held-back damage lands now, all of it at once. Still inside the volley,
  // so its explosions join the rest — as in the C++, where these `hit_space`
  // calls sit between do_missile_anim and do_explosion_anim (:1412 and :1435).
  for (const d of deferred) {
    await hitSpace(session, d.at, d.dam, d.type, 1, 0, who);
  }

  // "If ashes are going to appear, there'd better be a visible blast on the
  // spot" (boe.combat.cpp:1425). Only when none of the mass damage above
  // already lit that square. The roll it would make comes off the *unique*
  // stream, which the C++ does deliberately so the extra explosion can't
  // shift an older replay's dice.
  if (ashes.at !== null) {
    const alreadyLit = deferred.some((d) => d.dam > 0 && locsEqual(d.at, ashes.at!));
    // OBoE's own blast, which 1997 doesn't have: not over a square that took
    // the blast itself (`blastIntercepted`) and played its own.
    if (!alreadyLit && !session.blastIntercepted) {
      boomSpace(ashes.at, boomType(DamageType.FIRE), 0, 0, univ.rng,
        { xAdj: 1, uniqueRan: true });
    }
    // `univ.town.set_ash(ashes_loc.x, ashes_loc.y, true)` (boe.combat.cpp:1439)
    // — and it is **outside** the `if(!hit_ashes_loc)` above, so the burn is
    // marked whether or not the extra explosion was needed.
    town.setField(ashes.at.x, ashes.at.y, FieldType.SFX_ASH, true);
  }
  } finally {
    // do_explosion_anim, then handle_marked_damage (boe.combat.cpp:1435/1439):
    // play the collected hits, then apply the damage they stood for. In a
    // `finally` because a handler that throws must not leave the volley open —
    // every later boom in the session would be swallowed, and the damage with
    // it.
    // `do_explosion_anim`'s eleven frames are eleven `draw_terrain(0)`s, and
    // in combat each one spends the status bar's encumbrance roll —
    // `onFrame` is how `runBoomAnim` hands them back. See `textBar.ts`.
    if (animated) runBoomAnim(univ.rng, () => drawTerrain(session));
    // `do_explosion_anim` blocks for the whole explosion before
    // `handle_marked_damage` runs (boe.combat.cpp:1435/1439). Without this
    // wait the cast returned while its blast was still on screen: the damage
    // it stood for landed early, and — the visible half — the camera, which
    // the missile had swung onto the target, was yanked back to the caster
    // over the top of the explosion.
    await animSettle();
    await handleMarkedDamage(univ, session);
  }

  // Only advance the turn if the cast actually took AP — every target
  // refused (out of range, obstructed, ...) spends nothing and leaves the
  // caster free to try again, matching `apTaken`'s guard above. Without this
  // a targeted combat spell could be cast over and over with the caster
  // never running out of AP, since `doCombatCast` is a free function and
  // can't trigger GameSession's own turn-advance on its own.
  // `handle_monster_actions`' combat arm, not the bare step: `do_combat_cast`
  // returns into `handle_target_space` and then into `advance_time`, which is
  // where the C++ pays the redraw that precedes the round.
  if (apTaken) session.monsterActionsCombat();
}

/** Everything `do_combat_cast` does to one square. */
async function resolveOne(
  session: GameSession,
  spell: Spell,
  target: Location,
  index: number,
  ctx: {
    pattern: SpellPat; rot: number; level: number; bonus: number; who: number; summon: number;
    rng: GameSession['univ']['rng']; min: typeof Math.min;
    deferred: { at: Location; type: DamageType; dam: number }[];
    ashes: { at: Location | null };
    missiles: QueuedMissile[];
    shared: { sound: number };
    /** `failed`, which only the NONE arm sets, from its node's answer. */
    failed: boolean;
  },
): Promise<void> {
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const caster = univ.currentPc;
  const {
    pattern: pat, rot, level, bonus, who, rng, min, deferred, missiles, shared, ashes, summon,
  } = ctx;

  /** add_missile aimed at this square. */
  const missile = (type: number, xAdj = 0, yAdj = 0): void => {
    addMissile(missiles, target, type, 1, xAdj, yAdj);
  };
  /** The arms that don't wait for the shared volley: fly what's queued now. */
  const flyNow = async (sound: number): Promise<void> => {
    await flyMissiles(session, missiles, caster.combatPos, sound, 100);
  };

  const field = async (which: FieldType): Promise<void> => {
    await placeSpellPattern(session, pat, target, { field: which, whoHit: who, rot });
  };
  const blast = async (type: DamageType, dice: number, shape = pat): Promise<void> => {
    await placeSpellPattern(session, shape, target, { damage: { type, dice }, whoHit: who, rot });
  };

  switch (spell) {
    // **Not a spell but a special node targeting** (boe.combat.cpp:1015). The
    // node to run is in `spell_caster` — which `TOWN_START_TARGETING` set to
    // its `jumpto`, not to a PC — and its answer becomes the cast's `failed`,
    // which is what queues the targeting's failure node afterwards.
    case Spell.NONE: {
      // `failed = r1`, an assignment: the node's answer is the last word on
      // whether the targeting failed. `r1` is zeroed before the call in the
      // C++, where this port's `a` comes back -1 when a node never set it —
      // so "positive" is the test, not "non-zero".
      const r = await session.runSpecialRaw(
        SpecCtx.TARGET, session.specTargetType, session.spellCaster, target);
      ctx.failed = r.a > 0;
      return;
    }

    // --- fields ------------------------------------------------------------
    case Spell.GOO: case Spell.WEB: case Spell.GOO_BOMB:
      await field(FieldType.FIELD_WEB);
      return;
    case Spell.CLOUD_FLAME: case Spell.CONFLAGRATION:
      await field(FieldType.WALL_FIRE);
      return;
    case Spell.CLOUD_STINK: case Spell.FOUL_VAPOR:
      await field(FieldType.CLOUD_STINK);
      return;
    case Spell.WALL_FORCE: case Spell.SHOCKSTORM: case Spell.FORCEFIELD:
      await field(FieldType.WALL_FORCE);
      return;
    case Spell.WALL_ICE: case Spell.WALL_ICE_BALL:
      await field(FieldType.WALL_ICE);
      return;
    case Spell.ANTIMAGIC:
      await field(FieldType.FIELD_ANTIMAGIC);
      return;
    case Spell.CLOUD_SLEEP: case Spell.CLOUD_SLEEP_LARGE:
      await field(FieldType.CLOUD_SLEEP);
      return;
    case Spell.WALL_BLADES:
      await field(FieldType.WALL_BLADES);
      return;
    case Spell.DISPEL_FIELD: case Spell.DISPEL_SPHERE: case Spell.DISPEL_SQUARE:
      await field(FieldType.FIELD_DISPEL);
      return;
    case Spell.QUICKFIRE:
      town.setField(target.x, target.y, FieldType.FIELD_QUICKFIRE, true);
      return;
    case Spell.SPRAY_FIELDS:
      await field(SPRAY_FIELDS[rng.getRan(1, 0, 14)] ?? FieldType.FIELD_WEB);
      return;

    case Spell.BARRIER_FIRE:
    case Spell.BARRIER_FORCE: {
      livingSound(68);
      // Both barriers scorch the square as they go up, and both do it with
      // *fire* damage — the force one included, which reads like a slip but is
      // what the C++ does.
      const dice = spell === Spell.BARRIER_FIRE ? 3 : 7;
      await hitSpace(session, target, rng.getRan(dice, 2, 7), DamageType.FIRE, 1, 1, who);
      const which = spell === Spell.BARRIER_FIRE
        ? FieldType.BARRIER_FIRE : FieldType.BARRIER_FORCE;
      town.setField(target.x, target.y, which, true);
      univ.addStringToBuf(town.hasField(target.x, target.y, which)
        ? '  You create the barrier.' : '  Failed.');
      return;
    }

    // --- things that fly at a square ---------------------------------------
    case Spell.DIVINE_THUD:
      missile(9);
      shared.sound = 11;
      await blast(DamageType.MAGIC, min(18, Math.trunc((level * 7) / 10) + 2 * bonus),
        SpellPat.RADIUS_2);
      ashes.at = { ...target };
      return;
    case Spell.SPARK:
    case Spell.ICE_BOLT: {
      const dam = spell === Spell.SPARK
        ? rng.getRan(2, 1, 4) : rng.getRan(min(20, level + bonus), 1, 4);
      missile(6);
      await flyNow(11);
      await hitSpace(session, target, dam,
        spell === Spell.SPARK ? DamageType.MAGIC : DamageType.COLD, 1, 0, who);
      return;
    }
    // These three hold their damage back so a whole volley lands together —
    // `boom_dam` in the C++, applied after the target loop.
    case Spell.ARROWS_FLAME:
      missile(4);
      deferred.push({ at: target, type: DamageType.FIRE, dam: rng.getRan(2, 1, 4) });
      return;
    case Spell.SMITE:
      missile(6);
      deferred.push({ at: target, type: DamageType.COLD, dam: rng.getRan(2, 1, 5) });
      return;
    case Spell.WOUND:
    case Spell.WRACK: {
      const dam = spell === Spell.WRACK
        ? rng.getRan(2 + Math.trunc(bonus / 2), 1, 4)
        : rng.getRan(min(7, 2 + bonus + Math.trunc(level / 2)), 1, 4);
      missile(14);
      await flyNow(24);
      await hitSpace(session, target, dam, DamageType.UNBLOCKABLE, 1, 0, who);
      return;
    }
    case Spell.FLAME: {
      const dam = rng.getRan(min(10, 1 + Math.trunc(level / 3) + bonus), 1, 6);
      missile(2);
      await flyNow(11);
      await hitSpace(session, target, dam, DamageType.FIRE, 1, 0, who);
      return;
    }
    case Spell.FIREBALL:
    case Spell.FLAMESTRIKE: {
      // Queued, not flown: the C++ comments its do_missile_anim out here and
      // lets the shared volley at the end carry it.
      missile(2);
      shared.sound = 11;
      let dam = min(9, 1 + Math.trunc((level * 2) / 3) + bonus) + 1;
      if (spell === Spell.FLAMESTRIKE) dam = Math.trunc((dam * 14) / 10);
      else if (dam > 10) dam = Math.trunc((dam * 8) / 10);
      if (dam <= 0) dam = 1;
      await blast(DamageType.FIRE, dam, SpellPat.SQUARE);
      ashes.at = { ...target };
      return;
    }
    case Spell.FIRESTORM:
    case Spell.ICY_RAIN: {
      // Fire throws a flame, ice a frost bolt; both ride the shared volley.
      missile(spell === Spell.FIRESTORM ? 2 : 6);
      shared.sound = 11;
      let dam = min(12, 1 + Math.trunc((level * 2) / 3) + bonus) + 2;
      if (dam > 20) dam = Math.trunc((dam * 8) / 10);
      await blast(spell === Spell.FIRESTORM ? DamageType.FIRE : DamageType.COLD,
        dam, SpellPat.RADIUS_2);
      // Only the fire half scorches the ground.
      if (spell === Spell.FIRESTORM) ashes.at = { ...target };
      return;
    }
    case Spell.KILL:
      missile(9);
      await flyNow(11);
      await hitSpace(session, target, 40 + rng.getRan(3, 0, 10) + caster.level * 2,
        DamageType.MAGIC, 1, 0, who);
      return;
    case Spell.ARROWS_DEATH:
      missile(9);
      shared.sound = 11;
      deferred.push({
        at: target, type: DamageType.MAGIC,
        dam: rng.getRan(3, 0, 10) + caster.level + 3 * bonus,
      });
      return;

    // --- summoning ---------------------------------------------------------
    case Spell.SIMULACRUM:
    case Spell.SUMMON_BEAST: case Spell.SUMMON_WEAK:
    case Spell.SUMMON: case Spell.SUMMON_AID:
    case Spell.SUMMON_MAJOR: case Spell.SUMMON_AID_MAJOR:
    case Spell.DEMON: case Spell.SUMMON_RAT: case Spell.SUMMON_SPIRIT:
    case Spell.STICKS_TO_SNAKES: case Spell.SUMMON_HOST:
    case Spell.SUMMON_GUARDIAN: {
      // Every summon (and Flash Step) throws the same sparkle first, at half
      // the usual length and with its own sound.
      missile(8);
      await flyMissiles(session, missiles, caster.combatPos, 61, 50);
      const adj = caster.statAdj(Skill.INTELLIGENCE);
      let which = 0;
      let dice = 3;
      switch (spell) {
        // Simulacrum's monster was chosen from the soul crystal before the
        // spell was even aimed.
        case Spell.SIMULACRUM: which = session.sumMonst; dice = 3; break;
        // The species was chosen once, before the target loop; see `summon`
        // in `doCombatCast`. Only the duration is rolled per square.
        case Spell.SUMMON_BEAST: which = summon; dice = 3; break;
        case Spell.SUMMON_WEAK: which = summon; dice = 4; break;
        case Spell.SUMMON: case Spell.SUMMON_AID:
          which = summon; dice = 5; break;
        case Spell.SUMMON_MAJOR: case Spell.SUMMON_AID_MAJOR:
          which = summon; dice = 7; break;
        case Spell.DEMON: which = 85; dice = 5; break;
        case Spell.SUMMON_RAT: which = 80; dice = 3; break;
        case Spell.SUMMON_SPIRIT: which = 125; dice = 2; break;
        // Only the first square gets the host itself; the rest are spirits.
        case Spell.SUMMON_HOST: which = index === 0 ? 126 : 125; dice = 2; break;
        case Spell.SUMMON_GUARDIAN: which = 122; dice = 6; break;
        default: {
          // Sticks to Snakes rolls which of the two snakes it gets.
          const r1 = rng.getRan(1, 0, 7);
          which = r1 === 1 ? 100 : 99;
          dice = 2;
          break;
        }
      }
      const sides = spell === Spell.SUMMON_SPIRIT || spell === Spell.STICKS_TO_SNAKES ? 5 : 4;
      const strength = rng.getRan(dice, 1, sides) + adj;
      if (which === 0
        || !summonMonster(session, which, target, strength, Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      }
      return;
    }

    case Spell.FLASH_STEP:
      missile(8);
      await flyMissiles(session, missiles, caster.combatPos, 61, 50);
      if (session.isBlocked(target)) univ.addStringToBuf('  Teleport failed.');
      else {
        univ.addStringToBuf('  Flash step!');
        caster.combatPos = { ...target };
        // This can carry you *out* of a force cage without breaking it. Walking
        // into one is caught later by sync_force_cages.
        caster.status[Status.FORCECAGE] = 0;
      }
      return;

    default:
      break;
  }

  // --- everything left needs somebody standing there ------------------------
  const victim = targetThere(univ, target);
  if (!victim) {
    univ.addStringToBuf('  Nobody there.');
    return;
  }
  const monst = victim instanceof Creature ? victim : null;
  // Aiming at a friendly is an act of war, unless you were only looking.
  if (monst?.isFriendly && spell !== Spell.SCRY_MONSTER && spell !== Spell.CAPTURE_SOUL) {
    makeTownHostile(session);
  }

  /**
   * `store_m_type` — the missile each single-target spell throws. It defaults
   * to **2** (the flame bolt) at the top of `do_combat_cast`, so a spell whose
   * arm never sets it still draws one; the arms that set -1 draw nothing.
   * `store_sound` goes with it, and both are used by the one `add_missile`
   * after the switch (boe.combat.cpp:1394).
   */
  let storeMType = SINGLE_TARGET_MISSILE[spell] ?? 2;
  shared.sound = SINGLE_TARGET_SOUND[spell] ?? shared.sound;

  switch (spell) {
    case Spell.ACID_SPRAY: victim.acid(level); livingSound(24); break;
    case Spell.PARALYZE_BEAM: victim.sleep(Status.PARALYZED, 500, 0, rng); break;
    case Spell.UNHOLY_RAVAGING: {
      const r2 = rng.getRan(1, 0, 2);
      if (monst) await damageMonst(univ, monst, 7, rng.getRan(4, 1, 8), DamageType.MAGIC, { session });
      victim.slow(4 + r2);
      victim.poison(5 + r2, rng);
      break;
    }
    case Spell.SCRY_MONSTER:
      if (!monst) { univ.addStringToBuf('  Nobody there.'); break; }
      storeMType = -1;
      livingSound(52);
      univ.party.mNoted.add(monst.number);
      univ.addStringToBuf(`  ${monst.mon.name} noted.`);
      session.onShowMonster?.(monst);
      break;
    case Spell.CAPTURE_SOUL:
      if (!monst) { univ.addStringToBuf('  Nobody there.'); break; }
      recordMonst(univ, monst);
      break;
    case Spell.MINDDUEL: {
      // No PC-on-PC duels: the C++ bails with its own TODO wondering whether
      // there would be a point.
      if (!monst) { univ.addStringToBuf('  Nobody there.'); break; }
      storeMType = -1;
      if (monst.mon.mu === 0 && monst.mon.cl === 0) {
        univ.addStringToBuf("  Can't duel: no magic.");
      } else {
        // The smoky crystal is the price of admission, and a charge of it is
        // spent whether the duel goes well or badly.
        const crystal = hasAbil(caster, ItemAbil.SMOKY_CRYSTAL);
        if (!crystal) univ.addStringToBuf(`  ${caster.name} needs a smoky crystal.`);
        else {
          removeCharge(caster, crystal.slot);
          doMindduel(session, univ.curPc, monst);
        }
      }
      shared.sound = 24;
      break;
    }
    case Spell.CHARM_FOE:
      victim.sleep(Status.CHARM, 0, -1 * (bonus + Math.trunc(caster.level / 8)), rng);
      break;
    case Spell.DISEASE:
      victim.disease(2 + rng.getRan(1, 0, 1) + bonus, rng);
      break;
    case Spell.STRENGTHEN_TARGET:
      victim.heal(20);
      break;
    case Spell.DUMBFOUND:
      victim.dumbfound(1 + Math.trunc(bonus / 3), rng);
      break;
    case Spell.SCARE:
      victim.scare(rng.getRan(2 + bonus, 1, 6));
      break;
    case Spell.FEAR:
      victim.scare(rng.getRan(min(20, Math.trunc(caster.level / 2) + bonus), 1, 8));
      break;
    case Spell.SLOW:
      victim.slow(2 + rng.getRan(1, 0, 1) + bonus);
      break;
    case Spell.POISON_MINOR: case Spell.ARROWS_VENOM:
      victim.poison(2 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.PARALYZE:
      victim.sleep(Status.PARALYZED, 1000, -10, rng);
      break;
    case Spell.POISON:
      victim.poison(4 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.POISON_MAJOR:
      victim.poison(8 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.STUMBLE:
      victim.curse(4 + bonus);
      break;
    case Spell.CURSE:
      victim.curse(2 + bonus);
      break;
    case Spell.HOLY_SCOURGE:
      victim.curse(2 + Math.trunc(caster.level / 2));
      break;

    case Spell.TURN_UNDEAD:
    case Spell.DISPEL_UNDEAD: {
      const race = monst ? monst.mon.race : (victim as Player).race;
      if (race !== Race.UNDEAD && race !== Race.SKELETAL) {
        univ.addStringToBuf('  Not undead.');
        storeMType = -1;
        break;
      }
      const roll = rng.getRan(1, 0, 90);
      const odds = hitChance(Math.max(0, Math.min(19,
        bonus * 2 + level * 4 - Math.trunc(victim.getLevel() / 2) + 3)));
      if (roll > odds) {
        univ.addStringToBuf('  Monster resisted.');
        break;
      }
      let dam = rng.getRan(spell === Spell.TURN_UNDEAD ? 2 : 6, 1, 14);
      if (caster.traits[Trait.ANAMA]) dam += 15;
      if (monst) await damageMonst(univ, monst, who, dam, DamageType.UNBLOCKABLE, { session });
      else await damagePc(univ, victim as Player, dam, DamageType.UNBLOCKABLE);
      break;
    }

    case Spell.RAVAGE_SPIRIT: {
      const race = monst ? monst.mon.race : (victim as Player).race;
      if (race !== Race.DEMON) {
        univ.addStringToBuf('  Not a demon.');
        storeMType = -1;
        break;
      }
      const roll = rng.getRan(1, 1, 100);
      const odds = hitChance(Math.max(0, Math.min(19,
        level * 4 - victim.getLevel() + 10)));
      if (roll > odds) {
        univ.addStringToBuf('  Demon resisted.');
        break;
      }
      let dam = rng.getRan(8 + bonus * 2, 1, 11);
      const dumb = caster.status[Status.DUMB] ?? 0;
      // Enlightenment (a negative DUMB) makes this hit far harder; the Anama
      // bonus is an either/or with it, not a stack.
      if (dumb < 0) dam += Math.trunc((-25 * dumb) / 3);
      else if (caster.traits[Trait.ANAMA]) dam += 25;
      if (monst) await damageMonst(univ, monst, who, dam, DamageType.UNBLOCKABLE, { session });
      else await damagePc(univ, victim as Player, dam, DamageType.UNBLOCKABLE);
      break;
    }

    default:
      univ.addStringToBuf(
        `  Error: Spell not implemented for combat mode. ${spellName(spell)}`);
      break;
  }

  // The one add_missile for this whole family (boe.combat.cpp:1394). The x/y
  // adjustment centres the sprite on a big creature rather than on its
  // top-left square.
  if (storeMType >= 0) {
    const w = monst ? monst.xWidth : 1;
    const h = monst ? monst.yWidth : 1;
    addMissile(missiles, target, storeMType, 1, 14 * (w - 1), 18 * (h - 1));
  }
}

/**
 * `store_m_type` per spell, for the single-target family (boe.combat.cpp:1191
 * onwards). Anything not listed keeps the default of 2, the flame bolt.
 */
const SINGLE_TARGET_MISSILE: Partial<Record<Spell, number>> = {
  [Spell.ACID_SPRAY]: 0,
  [Spell.PARALYZE_BEAM]: 9,
  [Spell.UNHOLY_RAVAGING]: 14,
  [Spell.CAPTURE_SOUL]: 15,
  [Spell.CHARM_FOE]: 14,
  [Spell.DISEASE]: 0,
  [Spell.STRENGTHEN_TARGET]: 14,
  [Spell.DUMBFOUND]: 14,
  [Spell.SCARE]: 11,
  [Spell.FEAR]: 11,
  [Spell.SLOW]: 11,
  [Spell.POISON_MINOR]: 11,
  [Spell.ARROWS_VENOM]: 4,
  [Spell.PARALYZE]: 9,
  [Spell.POISON]: 11,
  [Spell.POISON_MAJOR]: 11,
  [Spell.STUMBLE]: 8,
  [Spell.CURSE]: 8,
  [Spell.HOLY_SCOURGE]: 8,
  [Spell.TURN_UNDEAD]: 8,
  [Spell.DISPEL_UNDEAD]: 8,
  [Spell.RAVAGE_SPIRIT]: 8,
};

/** `store_sound` for the same family. */
const SINGLE_TARGET_SOUND: Partial<Record<Spell, number>> = {
  [Spell.ACID_SPRAY]: 24,
  [Spell.PARALYZE_BEAM]: 24,
  [Spell.UNHOLY_RAVAGING]: 53,
  [Spell.SCRY_MONSTER]: 25,
  [Spell.CAPTURE_SOUL]: 25,
  [Spell.MINDDUEL]: 24,
  [Spell.CHARM_FOE]: 24,
  [Spell.DISEASE]: 24,
  [Spell.STRENGTHEN_TARGET]: 55,
  [Spell.DUMBFOUND]: 53,
  [Spell.SCARE]: 54,
  [Spell.FEAR]: 54,
  [Spell.SLOW]: 25,
  [Spell.POISON_MINOR]: 55,
  [Spell.ARROWS_VENOM]: 55,
  [Spell.PARALYZE]: 25,
  [Spell.POISON]: 55,
  [Spell.POISON_MAJOR]: 55,
  [Spell.STUMBLE]: 24,
  [Spell.CURSE]: 24,
  [Spell.HOLY_SCOURGE]: 24,
  [Spell.TURN_UNDEAD]: 24,
  [Spell.DISPEL_UNDEAD]: 24,
  [Spell.RAVAGE_SPIRIT]: 24,
};
