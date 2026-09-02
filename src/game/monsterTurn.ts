/**
 * The monsters' half of a combat round — `do_monster_turn` (boe.combat.cpp:2056),
 * `monster_attack` (:2629), and the movement helpers from boe.monster.cpp
 * (`monst_pick_target`, `seek_party`, `try_move`, `combat_move_monster`).
 *
 * This is the M5b slice that makes a fight a fight: monsters notice the party,
 * get action points, pick a target, close on it and hit it. What it does *not*
 * do yet is monster spellcasting; missiles, breath, summoning and the touch
 * effects are all here, and the remaining gaps are marked where they belong.
 */

import { Location, dist, loc, locsEqual, vdist } from '../core/location';
import { Attack, Attitude, DamageType } from '../data/monster';
import { Creature, CreatureStatus } from '../universe/creature';
import { Living, SpellNote, livingSound } from '../universe/living';
import { MonstMelee } from '../data/monster';
import { Player } from '../universe/player';
import { MainStatus, PartyStatus, Race, Skill, Status, Trait, isHumanoid } from '../universe/skills';
import { Universe } from '../universe/universe';
import { SpecCtx, SpecCtxType } from './specials/context';
import {
  MonstAbil, MonstAbilCat, MonstGen, abilityCategory,
} from '../data/monsterAbility';
import { NO_ONE, pcAttack, totalEncumbrance } from './combat';
import { monstHateSpot } from './monsterPlace';
import {
  abilityCost, monstBreathe, monstFireMissile, monsterBasicAbil, monsterSummon,
  pickMonsterAbility,
} from './monsterAbilities';
import { GameMode, isCombat, isTown } from './modes';
import { damageMonst, damagePc, hitChance } from './damage';
import { onHitTargetSpecial } from './weaponAbilities';
import { ItemAbil } from '../data/item';
import { FieldType } from '../data/fields';
import { hasAbilEquip } from '../universe/inventory';
import { animSettle, bookActionPause, focusOn } from './anim';
import { doPoison, handleAcid, handleDisease } from './increaseAge';
import { monstInflictFields, processFields } from './processFields';
import { specialIncreaseAge } from './specialIncreaseAge';
import { pushThings } from './pushThings';
import { monstCastMage, monstCastPriest } from './monsterSpells';
import { placeSpellPattern } from './spellPatterns';
import { pointOnScreen } from './session';
import type { GameSession } from './session';

/**
 * `MMOVE=1` — every step a creature *tries* and whether it took it, the pair to
 * the harness's `BOE_TRACE_MMOVE=1`. Read once at module load, and guarded on
 * `process` existing at all: this file runs in the browser too, where there is
 * no `process` and the check would throw on the first monster that moved.
 */
export const TRACE_MMOVE = Boolean(
  typeof process !== 'undefined' ? process.env?.MMOVE : undefined);

/**
 * `TOUCH=1` and `TACTIC=1`, the pairs to `BOE_TRACE_TOUCH` and
 * `BOE_TRACE_TACTIC`. Same `typeof process` guard as `TRACE_MMOVE` and for the
 * same reason — `process.env.TOUCH` written bare threw `ReferenceError` in the
 * browser the moment a creature took a swing, which `verify-screen` caught.
 */
export const TRACE_TOUCH = Boolean(
  typeof process !== 'undefined' ? process.env?.TOUCH : undefined);
export const TRACE_TACTIC = Boolean(
  typeof process !== 'undefined' ? process.env?.TACTIC : undefined);

/**
 * `PICKT=1`, the pair to `BOE_TRACE_PICKT`: what `monstPickTarget` saw before
 * it chose. The two "who annoyed me last" priorities are the interesting part —
 * a creature that switches onto the wrong PC spends the same draws in a
 * different order for the rest of the fight.
 */
export const TRACE_PICKT = Boolean(
  typeof process !== 'undefined' ? process.env?.PICKT : undefined);

/**
 * `futzing` (boe.combat.cpp:60) — how many action points a creature has spent
 * achieving nothing. A global in the C++, reset at the top of *each monster's*
 * turn in `do_monster_turn` and read at the bottom of each action point: two
 * wasted points and the rest are thrown away. Without it a boxed-in creature
 * spends its whole allowance shoving itself against the same wall, which is
 * both slower and a different game.
 *
 * Module-level here for the same reason it is global there: `seek_party`
 * increments it from two call chains away. `do_monsters` runs before
 * `do_monster_turn` and its increments are wiped by that reset, exactly as in
 * the C++.
 */
let futzing = 0;

/** move_to_zero — one step toward zero from either side. */
function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}

/** adjacent (boe.locutils.cpp) — within one square, diagonals included. */
function adjacent(a: Location, b: Location): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/**
 * monst_adjacent (boe.locutils.cpp:340) — a big creature counts from any of
 * the squares it covers.
 */
export function monstAdjacent(monst: Creature, where: Location): boolean {
  for (let i = 0; i < monst.xWidth; i++)
    for (let j = 0; j < monst.yWidth; j++)
      if (adjacent(loc(monst.curLoc.x + i, monst.curLoc.y + j), where)) return true;
  return false;
}

/** monst_can_see (boe.locutils.cpp:353) — line of sight from any of its squares. */
export function monstCanSee(session: GameSession, monst: Creature, where: Location): boolean {
  for (let i = 0; i < monst.xWidth; i++)
    for (let j = 0; j < monst.yWidth; j++) {
      const from = loc(monst.curLoc.x + i, monst.curLoc.y + j);
      if (session.canSeeLight(from, where) < 5) return true;
    }
  return false;
}

/**
 * can_see_monst (boe.locutils.cpp:379) — the mirror of `monstCanSee`: line of
 * sight *from* a square *to* any of the creature's squares. Kept separate
 * rather than folded into one helper because `can_see_light` is not
 * symmetric — it walks the line from its first argument, and a monster that
 * can see a square is not guaranteed to be visible from it.
 */
export function canSeeMonst(session: GameSession, from: Location, monst: Creature): boolean {
  for (let i = 0; i < monst.xWidth; i++)
    for (let j = 0; j < monst.yWidth; j++) {
      const to = loc(monst.curLoc.x + i, monst.curLoc.y + j);
      if (session.canSeeLight(from, to) < 5) return true;
    }
  return false;
}

/**
 * `switch_target_to_adjacent` (boe.monster.cpp:513) — something already in
 * reach beats something further off, whatever the picker chose.
 *
 * **It draws**, which the note that used to sit here got wrong: the combat
 * tail computes `total_encumbrance` for every adjacent PC looking for an
 * unarmoured one, and that rolls once per equipped item. Then a roll per
 * adjacent friendly creature, then one to choose between adjacent PCs. Only
 * the friendly and town branches above are draw-free.
 */
function switchTargetToAdjacent(
  session: GameSession, monst: Creature, origTarget: number,
): number {
  const town = session.univ.town;
  if (!town) return origTarget;
  if (monst.isFriendly) {
    if (origTarget >= 100) {
      const cur = town.monsters[origTarget - 100];
      if (cur && cur.isAlive && monstAdjacent(monst, cur.curLoc)) return origTarget;
    }
    for (let i = 0; i < town.monsters.length; i++) {
      const other = town.monsters[i]!;
      if (other.isAlive && !other.isFriendly && monstAdjacent(monst, other.curLoc)) return 100 + i;
    }
    return origTarget;
  }
  // A hostile one in town only ever switches onto the party itself.
  if (session.inTown) {
    return monstAdjacent(monst, session.univ.party.townLoc) ? 0 : origTarget;
  }

  const univ = session.univ;
  const pcs = univ.party.pcs;
  // Already in reach? Then nothing to switch.
  if (isCombat(session.mode) && origTarget < NO_ONE) {
    const pc = pcs[origTarget];
    if (pc?.isAlive && monstAdjacent(monst, pc.combatPos)) return origTarget;
  }
  if (origTarget >= 100) {
    const other = town.monsters[origTarget - 100];
    if (other?.isAlive && monstAdjacent(monst, other.curLoc)) return origTarget;
  }

  // "Anyone unarmored? Heh heh heh..." — and this is where the draws are.
  // `total_encumbrance` rolls once per equipped item, so an adjacent PC in
  // heavy armour costs a handful of numbers to reject.
  if (isCombat(session.mode)) {
    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i]!;
      if (pc.isAlive && monstAdjacent(monst, pc.combatPos)
        && totalEncumbrance(univ, pc) < 2) return i;
    }
  }

  // An adjacent charmed creature is a tempting target, on a coin flip each.
  for (let i = 0; i < town.monsters.length; i++) {
    const other = town.monsters[i]!;
    if (other.isAlive && other.isFriendly && monstAdjacent(monst, other.curLoc)
      && univ.rng.getRan(1, 0, 2) < 2) return i + 100;
  }

  // Otherwise pick at random between whoever is in reach. The C++ counts them,
  // rolls 1..count, then walks the party decrementing on each adjacent PC —
  // ported as the same walk rather than an index into a filtered list, because
  // its loop has no bound and stepping off the end is observable if the count
  // and the walk ever disagree.
  let numAdj = 0;
  for (const pc of pcs) if (pc.isAlive && monstAdjacent(monst, pc.combatPos)) numAdj++;
  if (numAdj === 0) return origTarget;
  numAdj = univ.rng.getRan(1, 1, numAdj);
  let i = 0;
  while (i < pcs.length) {
    const pc = pcs[i]!;
    const here = pc.isAlive && monstAdjacent(monst, pc.combatPos);
    if (numAdj <= 1 && here) break;
    if (here) numAdj--;
    i++;
  }
  return i;
}

/** closest_pc — the index of the nearest living PC, or 6 for none. */
export function closestPc(univ: Universe, where: Location): number {
  let best = NO_ONE;
  let howClose = 200;
  for (let i = 0; i < univ.party.pcs.length; i++) {
    const pc = univ.party.pcs[i]!;
    if (!pc.isAlive) continue;
    const d = dist(where, pc.combatPos);
    if (d < howClose) {
      best = i;
      howClose = d;
    }
  }
  return best;
}

/** closest_pc_loc — where that PC is standing. */
function closestPcLoc(univ: Universe, where: Location): Location {
  const who = closestPc(univ, where);
  return who === NO_ONE ? where : univ.party.pcs[who]!.combatPos;
}

/**
 * `univ.get_target` — a target index names either a PC (0-5) or, from 100 up,
 * a monster (`100 + town.monsters` index), the same encoding `monst_pick_target`
 * uses. Resolves to the `Living` it names, or null for NO_ONE / a stale index.
 */
function resolveTarget(session: GameSession, target: number): Living | null {
  if (target < NO_ONE) return session.univ.party.pcs[target] ?? null;
  if (target >= 100) return session.univ.town?.monsters[target - 100] ?? null;
  return null;
}

/**
 * `monst_pick_target_monst` — the other half of target selection: a friendly
 * (charmed) creature fights hostiles instead of the party, and a hostile one
 * that can't reach any PC will go after a friendly creature instead (this is
 * what the "PC-friendly monsters" wake-up check in `giveMonstersMoves` is
 * for). Picks the nearest visible creature on the opposing side.
 */
function pickTargetMonst(session: GameSession, monst: Creature): number {
  const town = session.univ.town;
  if (!town) return NO_ONE;
  let best = NO_ONE;
  // `min_dist` starts at 1000, not infinity, and that is load-bearing: a
  // creature further off than 1000 would tie rather than lose.
  let bestDist = 1000;
  for (let i = 0; i < town.monsters.length; i++) {
    const other = town.monsters[i]!;
    if (other === monst || !other.isAlive || monst.isFriendlyTo(other)) continue;
    const d = dist(monst.curLoc, other.curLoc);
    // The tie-break roll, and it must stay inside the `&&` chain: the C++ only
    // reaches `get_ran(1,0,7)` when the distance *equals* the best so far, so
    // hoisting it would spend a draw on every candidate.
    if (!(d < bestDist || (d === bestDist && session.univ.rng.getRan(1, 0, 7) < 4))) continue;
    // **`monst_can_see(i, univ.town.monst[i].cur_loc)` — creature *i* asking
    // whether it can see its own square — is not the no-op it looks like.**
    // It reads as a slip for "can `monst` see it", and this port left it out
    // on the grounds that a square is always visible from itself. It isn't:
    // `can_see_light` fails a square that is **unlit** before it ever walks
    // the line (boe.locutils.cpp, and `canSeeLight` here), so what this
    // actually asks is *"is this creature standing in the light?"* — a
    // creature in the dark is not a target, wherever the looker is.
    //
    // Leaving it out let every hostile in the town be a candidate, which is
    // wrong twice over: the choice, and the **draw count**, since the
    // tie-break above only fires when a candidate ties the running best and
    // rejected candidates never lower it. One recording made six `get_ran(1,0,7)`
    // draws here where the C++ made none.
    if (!monstCanSee(session, other, other.curLoc)) continue;
    best = 100 + i;
    bestDist = d;
  }
  return best;
}

/**
 * monst_pick_target_pc (boe.monster.cpp) — a visible PC at random, then a
 * second pass preferring one within four squares. The rolls are kept because
 * the number of them is part of the RNG sequence.
 */
function pickTargetPc(session: GameSession, monst: Creature): number {
  const univ = session.univ;
  if (monst.isFriendly) return NO_ONE;
  // `if(is_town()) return 0;` (boe.monster.cpp:451) — **before either roll**.
  // Outside combat the party has no combat positions to pick between, so the
  // C++ hands back PC 0 and draws nothing. Missing it cost two `get_ran(1,0,5)`
  // draws on every town monster's turn: not a wrong target, since the loops
  // below almost always fall through to the same answer, but two numbers taken
  // out of a stream whose *call order* is the spec.
  if (session.inTown) return 0;
  let tries = 0;
  let r1 = univ.rng.getRan(1, 0, 5);
  const unusable = (i: number): boolean => {
    const pc = univ.party.pcs[i];
    return !pc || !pc.isAlive || !monstCanSee(session, monst, pc.combatPos);
  };
  while (tries < 6 && unusable(r1)) {
    r1 = univ.rng.getRan(1, 0, 5);
    tries++;
  }
  const stored = tries < 6 ? r1 : NO_ONE;

  r1 = univ.rng.getRan(1, 0, 5);
  const tooFar = (i: number): boolean => {
    const pc = univ.party.pcs[i];
    return !pc || !pc.isAlive || dist(monst.curLoc, pc.combatPos) > 4
      || !monstCanSee(session, monst, pc.combatPos);
  };
  while (tries < 6 && tooFar(r1)) {
    r1 = univ.rng.getRan(1, 0, 5);
    tries++;
  }
  return tries < 6 ? r1 : stored;
}

/**
 * monst_pick_target (boe.monster.cpp) — a monster drops a dead target,
 * sometimes drops a live one just to shift attention, and otherwise keeps
 * whoever it was already after.
 *
 * A friendly (charmed) creature never targets a PC — `pickTargetPc` refuses
 * outright — so it goes straight to `pickTargetMonst`. A hostile one prefers
 * a PC as always, but falls back to a nearby friendly creature (a charmed
 * ally, a summoned guardian) when no PC is reachable, which is
 * `monst_pick_target_monst`'s other half.
 *
 * In combat a hostile creature checks three things first, in order: the last
 * PC to cast, the last to shoot, then whoever it was already after. Otherwise
 * it picks a PC *and* a creature and takes whichever is closer, with a roll to
 * break a tie.
 *
 * Ranged abilities still only ever fire at a PC target (see the
 * `target < NO_ONE` guards in `doMonsterTurn`); only melee and movement reach
 * a monster target so far.
 */
export function monstPickTarget(session: GameSession, monst: Creature): number {
  const univ = session.univ;
  if (monst.target < NO_ONE) {
    const pc = univ.party.pcs[monst.target];
    if (!pc || !pc.isAlive || univ.rng.getRan(1, 0, 3) === 1) monst.target = NO_ONE;
  } else if (monst.target >= 100) {
    const other = univ.town?.monsters[monst.target - 100];
    if (!other || !other.isAlive || monst.isFriendlyTo(other)) monst.target = NO_ONE;
  }
  // boe.monster.cpp:373 — in combat a hostile creature has two priorities
  // before it goes looking: whoever cast last, then whoever shot last.
  //
  // **The roll happens whether or not the PC can be seen.** The C++ writes
  // `(get_ran(1,1,5) < 5) && monst_can_see(…) && alive`, and `&&` evaluates
  // left to right, so the draw is spent up front and only then thrown away.
  // Ordering the checks the tidy way round would take a number out of the
  // stream at a different moment, which is a divergence like any other.
  if (TRACE_PICKT) {
    const caster = univ.party.pcs[session.spellCaster];
    console.log(`      [pickt] ${univ.town?.monsters.indexOf(monst)}`
      + ` combat=${isCombat(session.mode) ? 1 : 0} frnd=${monst.isFriendly ? 1 : 0}`
      + ` caster=${session.spellCaster} firer=${session.missileFirer}`
      + ` target=${monst.target} at=(${monst.curLoc.x},${monst.curLoc.y})`
      + (caster && session.spellCaster < NO_ONE
        ? ` casterAt=(${caster.combatPos.x},${caster.combatPos.y})`
          + ` casterSee=${monstCanSee(session, monst, caster.combatPos) ? 1 : 0}`
          + ` casterAlive=${caster.isAlive ? 1 : 0}`
        : ''));
  }

  if (isCombat(session.mode) && !monst.isFriendly) {
    if (session.spellCaster < NO_ONE) {
      const pc = univ.party.pcs[session.spellCaster];
      if (univ.rng.getRan(1, 1, 5) < 5 && pc && pc.isAlive
        && monstCanSee(session, monst, pc.combatPos)) return session.spellCaster;
    }
    if (session.missileFirer < NO_ONE) {
      const pc = univ.party.pcs[session.missileFirer];
      if (univ.rng.getRan(1, 1, 5) < 3 && pc && pc.isAlive
        && monstCanSee(session, monst, pc.combatPos)) return session.missileFirer;
    }
    // Third: keep whoever it was already after. Note this sits **inside** the
    // combat block in the C++ (boe.monster.cpp:385) and only covers a PC
    // target — the matching "keep a stored *monster* target" branch is
    // commented out there (boe.monster.cpp:391-395), so a monster target is
    // re-picked from scratch every turn.
    if (monst.target < NO_ONE) {
      const pc = univ.party.pcs[monst.target];
      if (pc && pc.isAlive && monstCanSee(session, monst, pc.combatPos)) return monst.target;
    }
  }

  // **Both pickers always run**, and both can draw — `pickTargetMonst`'s
  // tie-break especially. Returning early on a PC target, as this used to, ate
  // those draws.
  const targPc = pickTargetPc(session, monst);
  const targM = pickTargetMonst(session, monst);

  if (targPc !== NO_ONE && targM === NO_ONE) return targPc;
  if (targPc === NO_ONE && targM !== NO_ONE) return targM;
  if (targPc === NO_ONE && targM === NO_ONE) return NO_ONE;

  // Both are live options, so compare them. (The C++'s `targ_m == 6` test here
  // is dead code — the three lines above have already returned for it.)
  const other = univ.town?.monsters[targM - 100];
  if (!other) return targPc;
  if (session.inTown) {
    if (monst.isFriendly) return targM;
    // In town the party is one square, not six, so the creature weighs the
    // other monster against the party's own position — and prefers **PC 0**,
    // not `targPc`, which is what `monst_pick_target_pc` handed back anyway.
    return dist(monst.curLoc, other.curLoc) < dist(monst.curLoc, univ.party.townLoc)
      ? targM : 0;
  }
  const pc = univ.party.pcs[targPc];
  if (!pc) return targM;
  const dm = dist(monst.curLoc, other.curLoc);
  const dp = dist(monst.curLoc, pc.combatPos);
  // A tie is broken by a roll, and only a tie — the draw is inside the `&&`.
  if (dm === dp && univ.rng.getRan(1, 0, 6) < 3) return targM;
  return dm < dp ? targM : targPc;
}

/**
 * The move itself, once a square has been agreed on. Shared by the two callers
 * below, which differ only in **what order they ask the two questions in** —
 * and in the footstep, which is `combat_move_monster`'s alone.
 *
 * **`monst_inflict_fields` is the reason this chain is async.** A creature that
 * steps into a wall of fire is burned by it there and then (boe.monster.cpp:748
 * and :821), and the damage rolls its dice before it checks whether the
 * creature is immune — so leaving it out, as the `TODO(M5b)` here used to, took
 * a `get_ran` out of the stream on every step into a field. Damage can kill,
 * killing can fire a script, and a script can raise a dialog, so the whole
 * movement chain from `doMonsters` down had to become async to await it. Every
 * call site is awaited in place, which is what keeps the draw order the C++'s.
 */
async function stepMonsterTo(
  session: GameSession, monst: Creature, dest: Location, sound: boolean,
): Promise<boolean> {
  monst.direction = dirToward(monst.curLoc, dest);
  monst.curLoc = { ...dest };
  await monstInflictFields(session, monst);
  // A footstep, same as the party's own — only when the step lands on screen.
  // Note `town_move_monster` (:814) does **not** make one; only the combat half
  // does, which is why this is a parameter rather than something read here.
  if (sound && pointOnScreen(session.center, dest)) {
    session.moveSound(session.univ.town?.record.terrain[dest.x]?.[dest.y] ?? 0, monst.ap);
  }
  return true;
}

/**
 * combat_move_monster (boe.monster.cpp:710) — **can it stand there** first,
 * then what the terrain thinks.
 */
async function combatMoveMonster(
  session: GameSession, monst: Creature, dest: Location,
): Promise<boolean> {
  if (!session.monstCanBeAt(monst, dest)) return false;
  if (!session.monstCheckSpecialTerrain(monst, dest, 2)) return false;
  return await stepMonsterTo(session, monst, dest, true);
}

/**
 * town_move_monster (boe.monster.cpp:778) — **the other way round**: the
 * terrain gets asked first, and only then whether anything is standing there.
 *
 * The order is not cosmetic. `monst_check_special_terrain` rolls the creature's
 * `guts`, so in town that draw happens even for a step into a wall, and in
 * combat it does not. Collapsing the two into one function put the town's
 * `get_ran` stream out of step with the C++'s on every blocked step a
 * townsperson tried.
 */
async function townMoveMonster(
  session: GameSession, monst: Creature, dest: Location,
): Promise<boolean> {
  if (!session.monstCheckSpecialTerrain(monst, dest, 1)) return false;
  if (!session.monstCanBeAt(monst, dest)) return false;
  return await stepMonsterTo(session, monst, dest, false);
}

/**
 * try_move (boe.monster.cpp:691) — one step in a direction, dispatched by mode.
 * A creature in a force cage cannot move at all, whatever it is standing next
 * to.
 */
async function tryMove(
  session: GameSession, monst: Creature, from: Location, dx: number, dy: number,
): Promise<boolean> {
  const dest = loc(from.x + dx, from.y + dy);
  const town = session.univ.town;
  const inTownOrFight = session.mode === GameMode.TOWN || isCombat(session.mode);
  if (inTownOrFight && town?.hasField(from.x, from.y, FieldType.BARRIER_CAGE)) return false;
  let ok = false;
  if (session.mode === GameMode.TOWN) ok = await townMoveMonster(session, monst, dest);
  else if (isCombat(session.mode)) ok = await combatMoveMonster(session, monst, dest);
  // The pair to `BOE_TRACE_MMOVE=1` on the harness. Movement makes no draws,
  // so two runs can drift a creature square by square with their `[ran]`
  // streams still matching exactly, and the draw that finally disagrees is
  // hundreds of moves downstream of the rule that caused it.
  if (TRACE_MMOVE) {
    console.log(`      [mmove] ${monst.slot} (${from.x},${from.y}) -> (${dest.x},${dest.y}) `
      + `${ok ? 'ok' : 'no'} ap=${monst.ap}`);
  }
  return ok;
}

function dirToward(from: Location, to: Location): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 1 && dy === 1) return 3;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 1) return 5;
  if (dx === -1 && dy === 0) return 6;
  if (dx === -1 && dy === -1) return 7;
  return 8;
}

/**
 * The attack-of-opportunity check `do_monster_turn` runs right after a
 * monster closes on its target (boe.combat.cpp:2445/2456): any PC standing
 * ready (`parry > 99`) who now finds the monster adjacent spends that
 * stand-ready to swing at it for free — the payoff for choosing to defend
 * instead of act. Kept out of `char_parry`/`handle_pause` themselves because
 * it's the monster's *movement*, not the PC's own turn, that triggers it.
 */
export async function checkParryOpportunity(session: GameSession, monst: Creature): Promise<void> {
  for (const pc of session.univ.party.pcs) {
    // **`cur_monst->is_alive()` is inside the loop, and that is the whole
    // rule**: the C++'s four conditions are one `&&` chain re-evaluated per PC
    // (boe.combat.cpp:2471), so the first stand-ready PC to *kill* the creature
    // ends the volley — the rest keep their parry and their swing. This port
    // tested it once before the loop, so a second and third PC swung at a
    // corpse, each one spending `pc_attack`'s four `get_ran(1,1,100)`s on
    // nothing.
    if (pc.parry <= 99) continue;
    if (!monstAdjacent(monst, pc.combatPos)) continue;
    if (!monst.isAlive) continue;
    if (pc.traits[Trait.PACIFIST]) continue;
    pc.parry = 0;
    await pcAttack(session.univ, session.univ.party.pcs.indexOf(pc), monst, session);
  }
}

/**
 * seek_party (boe.monster.cpp) — greedy movement toward a square: the diagonal
 * first, then each axis, then a random step if everything is blocked. It's
 * deliberately not pathfinding, which is why monsters get stuck on corners in
 * the original too.
 */
async function seekParty(
  session: GameSession, monst: Creature, target: Location,
): Promise<boolean> {
  const from = monst.curLoc;
  const tries: [number, number][] = [];
  if (from.x > target.x && from.y > target.y) tries.push([-1, -1]);
  if (from.x < target.x && from.y < target.y) tries.push([1, 1]);
  if (from.x > target.x && from.y < target.y) tries.push([-1, 1]);
  if (from.x < target.x && from.y > target.y) tries.push([1, -1]);
  if (from.x > target.x) tries.push([-1, 0]);
  if (from.x < target.x) tries.push([1, 0]);
  if (from.y < target.y) tries.push([0, 1]);
  if (from.y > target.y) tries.push([0, -1]);

  for (const [dx, dy] of tries) {
    if (await tryMove(session, monst, from, dx, dy)) return true;
  }
  // Boxed in: flail in a random direction — and that counts as futzing
  // (boe.monster.cpp:657), which is what eventually ends the creature's turn.
  futzing++;
  const m = session.univ.rng.getRan(1, 0, 2) - 1;
  const n = session.univ.rng.getRan(1, 0, 2) - 1;
  return await tryMove(session, monst, from, m, n);
}

/**
 * rand_move (boe.monster.cpp) — idle wandering. A monster keeps a `targLoc` it
 * is drifting toward and picks a new one when it arrives or gets stuck; the
 * town's own wandering_locs are among the candidates.
 */
async function randMove(session: GameSession, monst: Creature): Promise<boolean> {
  const univ = session.univ;
  if (locsEqual(monst.targLoc, monst.curLoc)) monst.targLoc = loc(0, monst.targLoc.y);

  let actedYet = false;
  if (monst.targLoc.x > 0) actedYet = await seekParty(session, monst, monst.targLoc);
  if (actedYet) return true;

  monst.targLoc = loc(0, monst.targLoc.y);
  for (let j = 0; j < 3; j++) {
    const spot = loc(
      monst.curLoc.x + univ.rng.getRan(1, 0, 24) - 12,
      monst.curLoc.y + univ.rng.getRan(1, 0, 24) - 12);
    if (!session.locOffActiveArea(spot) && session.canSeeLight(monst.curLoc, spot) < 5) {
      monst.targLoc = spot;
      break;
    }
  }

  if (monst.targLoc.x === 0) {
    const wandering = univ.townRecord?.wanderingLocs ?? [];
    if (wandering.length > 0) {
      const spot = wandering[univ.rng.getRan(1, 0, wandering.length - 1)]!;
      if (!session.locOffActiveArea(spot) && univ.rng.getRan(1, 0, 1) === 1) {
        monst.targLoc = { ...spot };
      }
    }
    if (monst.targLoc.x === 0) {
      const spot = loc(
        monst.curLoc.x + univ.rng.getRan(1, 0, 20) - 10,
        monst.curLoc.y + univ.rng.getRan(1, 0, 20) - 10);
      if (!session.locOffActiveArea(spot)) monst.targLoc = spot;
    }
  }
  if (monst.targLoc.x > 0) actedYet = await seekParty(session, monst, monst.targLoc);
  return actedYet;
}

/** select_active_pc — a living PC at random, for a town-mode attack. */
function selectActivePc(univ: Universe): number {
  let r1 = univ.rng.getRan(1, 0, 5);
  let tries = 0;
  while (!univ.party.pcs[r1]?.isAlive && tries++ < 50) r1 = univ.rng.getRan(1, 0, 5);
  return r1;
}

/**
 * do_monsters (boe.monster.cpp:193), the town-mode half — this is what makes an
 * encounter happen at all: hostile monsters notice the party from up to eight
 * squares away, say so, and walk over. It runs after **every** party action,
 * not only in combat.
 */
export async function doMonsters(session: GameSession): Promise<void> {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  const partyLoc = univ.party.townLoc;
  // `hostile` is here because it is the one term in the drift test that no
  // other instrument can see: a hostile town turns `do_monsters`' first block
  // off entirely, so two runs can agree on every creature and every square and
  // spend a different number of draws on them.
  if (TRACE_MMOVE) console.log(`      [domonst] mode=${session.mode} party=(${partyLoc.x},${partyLoc.y}) age=${univ.party.age} hostile=${town.monstHostile ? 1 : 0}`);

  for (const monst of town.monsters) {
    if (!monst.isAlive) continue;
    if ((monst.status[Status.ASLEEP] ?? 0) > 0 || (monst.status[Status.PARALYZED] ?? 0) > 0) {
      continue;
    }

    // boe.monster.cpp:203. This used to be shortened to "the party, if it's
    // within eight", which reached the same answer and skipped both of the
    // draws on the way there — `monst_pick_target`'s and `select_active_pc`'s.
    let target: number;
    if (monst.active === CreatureStatus.IDLE) target = NO_ONE;
    else {
      target = monstPickTarget(session, monst);
      target = switchTargetToAdjacent(session, monst, target);
      if (target === 0) {
        // Target 0 means "the party". Out of range it gives up; in range it
        // picks *which* PC, and that reroll until it finds a living one is the
        // run of `get_ran(1,0,5)` draws that named this bucket.
        target = dist(monst.curLoc, partyLoc) > 8 ? NO_ONE : selectActivePc(univ);
      }
      if (monst.isFriendly && target < NO_ONE) target = NO_ONE;
    }
    monst.target = target;

    if (monst.active === CreatureStatus.ALERTED || monst.isFriendly) {
      // Nothing to chase: drift, or drift *toward* the party if it's nasty.
      // Once the town has turned hostile nobody drifts idly any more.
      if ((monst.attitude === Attitude.DOCILE || target === NO_ONE) && !town.monstHostile
        && monst.mobile) {
        if (monst.isFriendly || univ.rng.getRan(1, 0, 1) === 0) await randMove(session, monst);
        else await seekParty(session, monst, partyLoc);
      }
      // The C++ doesn't gate this second block on the first having done
      // nothing, and the only way to reach it having already drifted is a
      // docile creature in a hostile town — which then really does get both.
      if ((monst.attitude !== Attitude.DOCILE || town.monstHostile)
        && monst.mobile && target !== NO_ONE) {
        const canFlee = !monst.mon.mindless && monst.mon.race !== Race.UNDEAD
          && monst.mon.race !== Race.SKELETAL;
        // Where it is heading: the party, or the creature it is after
        // (boe.monster.cpp:236). This port used to walk to the party either
        // way, so a charmed creature chasing a rat set off across the town.
        const l2 = monst.target <= NO_ONE
          ? partyLoc
          : (univ.town?.monsters[monst.target - 100]?.getLoc() ?? partyLoc);
        if (monst.morale < 0 && canFlee) {
          await fleeParty(session, monst, l2);
          if (univ.rng.getRan(1, 0, 10) < 6) monst.morale++;
        } else {
          // "Maybe move out of dangerous space" here too (:244) — and this one
          // draws, which is what makes it visible in the stream.
          const hated = monstHateSpot(session, monst);
          if (hated) await seekParty(session, monst, hated);
          else if (monst.mon.mu === 0 || session.canSeeLight(monst.curLoc, l2) > 3) {
            // A spellcaster keeps its distance unless it can't see you anyway.
            // (The C++'s condition is `mu == 0 && mu == 0` — a typo for `cl`,
            // presumably, and kept as it ships.)
            await seekParty(session, monst, l2);
          }
        }
      }
    }

    // Notice the party — and tell the player, which is the cue to fight or run.
    if (monst.active === CreatureStatus.IDLE && !monst.isFriendly
      && dist(monst.curLoc, partyLoc) <= 8) {
      // Stealth is **46** here and 45 in the combat copy of this roll
      // (boe.combat.cpp:2079). The two were written separately and drifted by
      // one; both are kept as they are.
      if (TRACE_MMOVE) console.log(`      [notice] ${monst.slot} at (${monst.curLoc.x},${monst.curLoc.y}) party=(${partyLoc.x},${partyLoc.y}) d=${dist(monst.curLoc, partyLoc)} att=${monst.attitude} see=${session.canSeeLight(monst.curLoc, partyLoc)} stealth=${(univ.party.partyStatus[PartyStatus.STEALTH] ?? 0) > 0 ? 1 : 0}`);
      const r1 = univ.rng.getRan(1, 1, 100)
        + ((univ.party.partyStatus[PartyStatus.STEALTH] ?? 0) > 0 ? 46 : 0)
        + session.canSeeLight(monst.curLoc, partyLoc) * 10;
      if (r1 < 50) {
        monst.active = CreatureStatus.ALERTED;
        univ.addStringToBuf('Monster saw you!');
        livingSound(isHumanoid(monst.mon.race) || monst.mon.race === Race.GIANT ? 18 : 46);
      }
      for (const other of town.monsters) {
        if (other.active === CreatureStatus.ALERTED && dist(monst.curLoc, other.curLoc) <= 5) {
          monst.active = CreatureStatus.ALERTED;
        }
      }
    }
  }
}

/**
 * `flee_party` (boe.monster.cpp:674) — the eight directions of `seek_party`,
 * each reversed, and **a different fallback**.
 *
 * This port used to reflect the target through the creature's own square and
 * hand that to `seek_party`. It reaches roughly the same first step and then
 * diverges twice: the order the eight directions are tried in is not the same
 * once the mirrored point is far off the map, and — this is the one that shows
 * up in the draw stream — a creature that is **boxed in** does not shove
 * randomly here. It calls `rand_move`, which rolls `get_ran(1,0,24)` pairs
 * looking for somewhere to drift, where the shove is two `get_ran(1,0,2)`.
 * Cornered creatures are exactly the ones that flee, so this fired often.
 */
async function fleeParty(
  session: GameSession, monst: Creature, target: Location,
): Promise<boolean> {
  const l1 = monst.curLoc;
  const l2 = target;
  let acted = false;
  const step = async (dx: number, dy: number): Promise<void> => {
    if (!acted) acted = await tryMove(session, monst, l1, dx, dy);
  };
  if (l1.x > l2.x && l1.y > l2.y) await step(1, 1);
  if (l1.x < l2.x && l1.y < l2.y) await step(-1, -1);
  if (l1.x > l2.x && l1.y < l2.y) await step(1, -1);
  if (l1.x < l2.x && l1.y > l2.y) await step(-1, 1);
  if (l1.x > l2.x) await step(1, 0);
  if (l1.x < l2.x) await step(-1, 0);
  if (l1.y < l2.y) await step(0, -1);
  if (l1.y > l2.y) await step(0, 1);
  if (!acted) {
    futzing++;
    acted = await randMove(session, monst);
  }
  return acted;
}

/**
 * get_monst_sound (boe.combat.cpp:5296) — which *sound type* one of a monster's
 * attacks uses. The return value is an index into `boom_space`'s lookup table,
 * not a sound file: playing it directly is what made a rat's bite sound like a
 * cash register. It is handed to `damagePc`/`damageMonst` as `soundType` and
 * they pass it on to `boomSpace`.
 *
 * eMonstMelee: 0 claw, 1 bite, 2 sting, 3 web, 4 wall touch, 5 punch,
 * 6 club, 7 burn, 8 harm, 9 slime, 10 stab, 11 swing.
 */
function monstSoundType(attacker: Creature, attack: Attack): number {
  switch (attack.type) {
    case MonstMelee.SLIME: return 11;
    case MonstMelee.PUNCH: return 4;
    case MonstMelee.CLAW: return 9;
    case MonstMelee.BITE: return 10;
    case MonstMelee.STING: return 12;
    case MonstMelee.CLUB: return 4;
    case MonstMelee.BURN: return 5;
    case MonstMelee.HARM: return 0;
    case MonstMelee.STAB:
    case MonstMelee.SWING: {
      // A weapon's sound depends on who is swinging it.
      const race = attacker.mon.race;
      if (race === Race.HUMAN) return attack.sides > 9 ? 3 : 2;
      if (race === Race.MAGE) return 1;
      if (race === Race.PRIEST) return 4;
      if (isHumanoid(race) || race === Race.GIANT) return 2;
      return 1;
    }
    default: return 0;
  }
}

/**
 * monster_attack (boe.combat.cpp:2629) — one monster's melee turn, which is up
 * to three attacks from its `attacks` list. Note the to-hit is indexed by
 * `(skill + 4) / 2` rather than by a weapon skill, and that a difficulty
 * adjustment multiplies the damage done to a PC but not to another monster.
 *
 * TODO(M5b): the TOUCH abilities that fire on a landed hit — stun, petrify,
 * drain, steal — need the uAbility port.
 */
export async function monsterAttack(
  session: GameSession,
  monst: Creature,
  target: Living,
): Promise<void> {
  const univ = session.univ;
  // A peaceful monster won't turn on the party or on another ally.
  if (monst.isFriendly && target.isFriendly) return;

  if (monst.mon.attacks.some((a) => a.dice !== 0)) monst.printAttacks(target);

  const pcTarget = target instanceof Player ? target : null;
  const monstTarget = target instanceof Creature ? target : null;

  // Sanctuary: an invisible target may simply not be found. Note this rolls
  // against the *monster's level*, not a skill — a debuff in the original.
  const targetInvisible = (target.status[Status.INVISIBLE] ?? 0) > 0
    || (monstTarget?.mon.invisible ?? false);
  if (targetInvisible) {
    if (univ.rng.getRan(1, 1, 100) > hitChance(Math.trunc(monst.mon.level / 2))) {
      univ.addStringToBuf("  Can't find target!");
      return;
    }
  }

  for (let i = 0; i < monst.mon.attacks.length; i++) {
    const attack = monst.mon.attacks[i]!;
    if (attack.dice <= 0 || !target.isAlive) continue;

    // Hitting a docile creature makes it willing to fight back.
    if (monstTarget && monstTarget.attitude === Attitude.DOCILE) {
      monstTarget.attitude = Attitude.FRIENDLY;
    }

    let r1 = univ.rng.getRan(1, 1, 100);
    r1 -= 5 * Math.min(8, monst.status[Status.BLESS_CURSE] ?? 0);
    r1 += 5 * (target.status[Status.BLESS_CURSE] ?? 0) - 15;
    r1 += 5 * Math.trunc((monst.status[Status.WEBS] ?? 0) / 3);
    if ((monst.status[Status.FORCECAGE] ?? 0) > 0) r1 += 3;
    if ((target.status[Status.FORCECAGE] ?? 0) > 0) r1 += 1;
    if (pcTarget) {
      r1 += 5 * pcTarget.statAdj(Skill.DEXTERITY);
      if (pcTarget.parry < 100) r1 += 5 * pcTarget.parry;
    }

    let r2 = univ.rng.getRan(attack.dice, 1, attack.sides) + 1;
    r2 += Math.min(8, monst.status[Status.BLESS_CURSE] ?? 0);
    r2 -= target.status[Status.BLESS_CURSE] ?? 0;
    if (pcTarget) {
      const adj = univ.difficultyAdjust();
      if (adj > 2) r2 *= 2;
      else if (adj === 2) r2 = Math.trunc((r2 * 3) / 2);
    } else r2 += 1;

    if ((target.status[Status.ASLEEP] ?? 0) > 0 || (target.status[Status.PARALYZED] ?? 0) > 0) {
      r1 -= 80;
      r2 *= 2;
    }

    if (r1 > hitChance(Math.trunc((monst.mon.skill + 4) / 2))) continue;

    let damType = DamageType.WEAPON;
    if (monst.mon.race === Race.UNDEAD || monst.mon.race === Race.SKELETAL) {
      damType = DamageType.UNDEAD;
    } else if (monst.mon.race === Race.DEMON) damType = DamageType.DEMON;

    const storeHp = target.getHealth();
    const soundType = monstSoundType(monst, attack);
    let damaged = 0;
    if (monstTarget) {
      damaged = await damageMonst(univ, monstTarget, 7, r2, damType,
        { doPrint: false, soundType, session });
    } else if (pcTarget) {
      damaged = await damagePc(univ, pcTarget, r2, damType, monst.mon.race, { soundType });
      // **`damage_pc`'s return is not the health it took off** (boe.combat.cpp:
      // 2731). It reports the damage it *decided* on, and the last thing it
      // does with that number is a three-way branch: subtract it, clamp to
      // zero, or — when the PC is **already at zero** — leave the health alone
      // and call `kill_pc`. So a blow that finishes off an unconscious PC comes
      // back positive with the health unmoved, and the C++ zeroes `damaged`
      // here rather than trust it.
      //
      // That matters because `damaged` gates the martyr's shield, the poisoned
      // blade and the whole **touch-ability loop** below. This port trusted the
      // return, so a Dark Wyrm that killed a downed PC still got to roll its
      // paralysing and poisonous touches — one `get_ran(1,1,1000)` the C++
      // never spends, on the one blow in a fight where the two differ.
      if (storeHp - target.getHealth() <= 0) damaged = 0;
    }
    if (damaged <= 0) continue;

    // A shielded target passes some of it back to the attacker.
    if (target.isShielded(univ.rng)) {
      const shared = monst.getSharedDmg(storeHp - target.getHealth(), univ.rng);
      univ.addStringToBuf('  Shares damage!');
      await damageMonst(univ, monst, pcTarget ? 6 : 7, shared, DamageType.MAGIC, { session });
    }

    // Only the first attack carries the poison.
    if (i === 0 && (monst.status[Status.POISONED_WEAPON] ?? 0) > 0) {
      target.poison(monst.status[Status.POISONED_WEAPON] ?? 0, univ.rng);
      monst.status[Status.POISONED_WEAPON] = moveToZero(monst.status[Status.POISONED_WEAPON] ?? 0);
    }

    // Touch abilities fire off a blow that landed — the burning touch, the
    // paralysing touch, the pickpocket.
    await monsterTouches(session, monst, target, i);

    // And what being hit sets off on the target's side.
    if (pcTarget) {
      const specItem = hasAbilEquip(pcTarget, ItemAbil.HIT_CALL_SPECIAL);
      if (specItem) {
        onHitTargetSpecial(
          univ, monst, pcTarget, specItem.item.abilStrength, 'melee', session);
      }
    } else if (monstTarget) {
      const trigger = monstTarget.mon.abil[MonstAbil.HIT_TRIGGER];
      if (trigger?.active) {
        onHitTargetSpecial(
          univ, monst, monstTarget, trigger.special.extra1, 'melee', session);
      }
    }
  }
}

/**
 * The `for(auto& abil : attacker->abil)` tail of monster_attack: every active
 * GENERAL ability whose delivery is TOUCH announces itself and then runs
 * `monst_basic_abil` on the target it just hit.
 *
 * The odds test is kept verbatim and is **backwards**: the C++ skips the
 * ability when the roll comes in *at or under* its odds, so a 1000-in-1000
 * touch never fires and a 0-odds one always does (0 fails the `> 0` guard).
 * It looks like a slip, but a "fix" would change how hard several monsters
 * hit, so it stays with a test pinning it.
 */
async function monsterTouches(
  session: GameSession, monst: Creature, target: Living, attackIndex: number,
): Promise<void> {
  const univ = session.univ;
  const pcTarget = target instanceof Player ? target : null;

  for (let key = MonstAbil.MISSILE; key <= MonstAbil.SUMMON; key++) {
    const abil = monst.mon.abil[key];
    if (!abil?.active) continue;
    if (abilityCategory(key) !== MonstAbilCat.GENERAL) continue;
    if (abil.gen.type !== MonstGen.TOUCH) continue;
    // `TOUCH=1`, the pair to the harness's `BOE_TRACE_TOUCH=1`. Printed
    // *before* the odds roll, because the roll is the divergence this answers:
    // one side enters the loop for an ability and the other never gets there,
    // and the draw stream can only say "somebody spent a `get_ran(1,1,1000)`".
    if (TRACE_TOUCH) {
      // eslint-disable-next-line no-console
      console.log(`      [touch] ${monst.slot} ${monst.mon.name} key=${key}`
        + ` odds=${abil.gen.odds} type=${abil.gen.type}`);
    }
    if (abil.gen.odds > 0 && univ.rng.getRan(1, 1, 1000) <= abil.gen.odds) continue;

    let sound = 0;
    switch (key) {
      case MonstAbil.STUN: univ.addStringToBuf('  Stuns!'); break;
      case MonstAbil.PETRIFY: univ.addStringToBuf('  Petrifying touch!'); break;
      case MonstAbil.DRAIN_SP: univ.addStringToBuf('  Drains magic!'); break;
      case MonstAbil.DRAIN_XP: univ.addStringToBuf('  Drains life!'); break;
      case MonstAbil.KILL: univ.addStringToBuf('  Killing touch!'); break;
      case MonstAbil.STEAL_FOOD:
        // Nothing to steal from another monster.
        if (!pcTarget) continue;
        univ.addStringToBuf('  Steals food!');
        sound = 26;
        break;
      case MonstAbil.STEAL_GOLD:
        if (!pcTarget) continue;
        univ.addStringToBuf('  Steals gold!');
        break;
      case MonstAbil.FIELD: break;
      case MonstAbil.DAMAGE:
      case MonstAbil.DAMAGE2:
        univ.addStringToBuf(damageTouchMsg(abil.gen.extra as DamageType));
        break;
      case MonstAbil.STATUS2:
      case MonstAbil.STATUS: {
        // STATUS2 rides only the first attack; STATUS rides every one.
        if (key === MonstAbil.STATUS2 && attackIndex > 0) continue;
        const msg = statusTouchMsg(abil.gen.extra as Status);
        if (msg === null) continue;
        // Charming something that isn't a creature is meaningless.
        if (abil.gen.extra === Status.CHARM && !(target instanceof Creature)) continue;
        univ.addStringToBuf(msg);
        break;
      }
      default:
        // Everything else isn't a touch at all.
        continue;
    }
    if (sound > 0) livingSound(sound);
    await monsterBasicAbil(session, monst, key, abil, target);
  }
}

/** The DAMAGE/DAMAGE2 half of monster_attack's touch messages. */
function damageTouchMsg(dmg: DamageType): string {
  switch (dmg) {
    case DamageType.FIRE: return '  Burning touch!';
    case DamageType.COLD: return '  Freezing touch!';
    case DamageType.ACID: return '  Acid touch!';
    case DamageType.MAGIC: return '  Shocking touch!';
    case DamageType.SPECIAL:
    case DamageType.UNBLOCKABLE: return '  Eerie touch!';
    case DamageType.POISON: return '  Slimy touch!';
    case DamageType.WEAPON: return '  Drains stamina!';
    case DamageType.UNDEAD: return '  Chilling touch!';
    case DamageType.DEMON: return '  Unholy touch!';
    // MARKED is invalid here, and the C++ prints nothing for it.
    default: return '';
  }
}

/** The STATUS/STATUS2 half. `null` means the ability is skipped entirely. */
function statusTouchMsg(stat: Status): string | null {
  switch (stat) {
    case Status.POISON: return '  Poisonous!';
    case Status.DISEASE: return '  Causes disease!';
    case Status.DUMB: return '  Dumbfounds!';
    case Status.WEBS: return '  Webs!';
    case Status.ASLEEP: return '  Sleeps!';
    case Status.PARALYZED: return '  Paralysis touch!';
    case Status.ACID: return '  Acid touch!';
    case Status.HASTE_SLOW: return '  Slowing touch!';
    case Status.BLESS_CURSE: return '  Cursing touch!';
    case Status.CHARM: return '  Charming touch!';
    case Status.FORCECAGE: return '  Entrapping touch!';
    case Status.INVISIBLE: return '  Revealing touch!';
    case Status.INVULNERABLE: return '  Piercing touch!';
    case Status.MAGIC_RESISTANCE: return '  Overwhelming touch!';
    case Status.MARTYRS_SHIELD: return "  Anti-martyr's touch!";
    case Status.POISONED_WEAPON: return '  Poison-draining touch!';
    // MAIN is invalid.
    default: return null;
  }
}

/**
 * The first half of do_monster_turn: notice the party, and hand out action
 * points. A monster in town gets a third of its speed, and summons expire.
 */
function giveMonstersMoves(session: GameSession): void {
  const univ = session.univ;
  for (const monst of univ.town?.monsters ?? []) {
    // **In combat only** (boe.combat.cpp:2076). This is "see if hostile monster
    // notices party, *during combat*", and the mode test is easy to drop
    // because everything around it runs in town as well. Dropping it costs a
    // `get_ran(1,1,100)` per idle hostile creature on every town turn, which
    // is a big, steady offset in the town's draw stream.
    if (monst.active === CreatureStatus.IDLE && !monst.isFriendly
      && session.mode === GameMode.COMBAT) {
      // A hostile monster rolls to notice the party; the further it can see,
      // the worse its chances, and stealth makes it much worse.
      let r1 = univ.rng.getRan(1, 1, 100);
      // Stealth is a flat 45 — the C++ carries its own TODO wondering whether
      // it ought to scale with level. Kept as it is.
      if ((univ.party.partyStatus[PartyStatus.STEALTH] ?? 0) > 0) r1 += 45;
      r1 += session.canSeeLight(monst.curLoc, closestPcLoc(univ, monst.curLoc)) * 10;
      if (r1 < 50) monst.active = CreatureStatus.ALERTED;
      // And a fight nearby alerts it regardless — `monst_near(j, loc, 5, 1)`
      // (boe.combat.cpp:3946), which is **`vdist`**, the Chebyshev distance,
      // not the `dist` hypotenuse the town copy of this loop uses. The two are
      // not interchangeable: five squares diagonally is `vdist` 5 and `dist` 7,
      // so this alerts a ring of creatures the town rule would leave asleep.
      // Getting it wrong left creatures idle here that the C++ had woken, and
      // an idle creature re-rolls its notice check every turn — a spare
      // `get_ran(1,1,100)` a turn, forever.
      for (const other of univ.town?.monsters ?? []) {
        if (other.isAlive && other.active === CreatureStatus.ALERTED
          && vdist(other.curLoc, monst.curLoc) <= 5) {
          monst.active = CreatureStatus.ALERTED;
        }
      }
    }
    // "Now it looks for PC-friendly monsters" (boe.combat.cpp:2088) — a
    // hostile monster that spots a friendly one nearby (a charmed former ally,
    // a summoned guardian, ...) wakes up for it even with no PC in sight.
    if (monst.active === CreatureStatus.IDLE && !monst.isFriendly) {
      for (const other of univ.town?.monsters ?? []) {
        if (other.isAlive && other.isFriendly && dist(monst.curLoc, other.curLoc) <= 6
          && session.canSeeLight(monst.curLoc, other.curLoc) < 5) {
          monst.active = CreatureStatus.ALERTED;
        }
      }
    }
    // "See if friendly, fighting monster see hostile monster. If so, make
    // mobile" (boe.combat.cpp:2098) — attitude must be exactly FRIENDLY, not
    // merely DOCILE (`isFriendly` is true for both). This is what makes a
    // charmed monster actually turn on its former allies: charm sets
    // attitude to FRIENDLY (Creature.sleep's CHARM branch), and without this
    // check nothing ever gives it a combat turn at all. Forcing `mobile`
    // matters too — a normally-stationary monster (a shopkeeper, say) needs
    // it to be able to close the distance once it's fighting for the party.
    if (monst.active === CreatureStatus.IDLE && monst.attitude === Attitude.FRIENDLY) {
      for (const other of univ.town?.monsters ?? []) {
        if (other.isAlive && !other.isFriendly && dist(monst.curLoc, other.curLoc) <= 6
          && session.canSeeLight(monst.curLoc, other.curLoc) < 5) {
          monst.active = CreatureStatus.ALERTED;
          monst.mobile = true;
        }
      }
    }

    monst.ap = 0;
    if (monst.active === CreatureStatus.ALERTED) {
      // "First note that hostile monsters are around" (boe.combat.cpp:2115).
      // This is what stops a FRIENDLY creature counting as placid while a
      // fight is on, which in turn decides whether it will shove a crate or
      // step onto a bed.
      if (!monst.isFriendly) univ.party.hostilesPresent = 30;
      monst.ap = monst.mon.speed;
      // **`is_town()` is a *mode* question, not "which map is this?"** During a
      // town fight the mode is COMBAT, so this third never applies and a
      // creature gets its full speed — a town turn is worth three combat ones,
      // which is exactly what the division is for. Asking
      // `univ.isInTown()` (party.town_num) instead gave every creature in every
      // town fight one action point, and they crawled.
      if (isTown(session.mode)) monst.ap = Math.max(1, Math.trunc(monst.ap / 3));
      if (univ.party.age % 2 === 0 && (monst.status[Status.HASTE_SLOW] ?? 0) < 0) monst.ap = 0;
      if (monst.ap > 0) {
        const webs = monst.status[Status.WEBS] ?? 0;
        monst.ap = Math.max(0, monst.ap - Math.trunc(webs / 2));
        if (monst.ap === 0) monst.status[Status.WEBS] = Math.max(0, webs - 2);
      }
      if ((monst.status[Status.HASTE_SLOW] ?? 0) > 0) monst.ap *= 2;
    }
    if ((monst.status[Status.ASLEEP] ?? 0) > 0 || (monst.status[Status.PARALYZED] ?? 0) > 0) {
      monst.ap = 0;
    }

    // Summons run out.
    if (monst.isAlive) {
      if (monst.summonTime === 1) {
        monst.active = CreatureStatus.DEAD;
        monst.ap = 0;
        monst.spellNote(SpellNote.DISAPPEARS);
      }
      monst.summonTime = moveToZero(monst.summonTime);
    }
  }
}

/**
 * do_monster_turn (boe.combat.cpp:2056) — every alerted monster spends its
 * action points: attack what's next to it, close on its target, or flee when
 * its morale has gone.
 *
 * Ranged abilities go first: `pickMonsterAbility` walks the monster's uAbility
 * table before it considers a swing, which is why an archer shoots rather than
 * closing.
 *
 */
export async function doMonsterTurn(session: GameSession): Promise<void> {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  // `monsters_going = true; // This affects how graphics are drawn.`
  // (boe.combat.cpp:2065). The try/finally is inline rather than wrapped round
  // a helper on purpose: an extra `await` layer here is an extra microtask per
  // turn, and that is enough to change how the turn interleaves with whatever
  // is driving the game — `verify-screen` diverges on it.
  session.monstersGoing = true;
  try {
    giveMonstersMoves(session);

    // Indexed rather than iterated: a monster's SUMMON appends to this list while
    // the loop is running, and the C++'s `num_monst` is read *before* the loop —
    // so a creature summoned this turn doesn't act until the next one. Awaiting
    // inside the loop makes that ordering observable, where before it wasn't.
    const numMonst = town.monsters.length;

    // **Declared outside the loop because the C++ declares it outside the
    // loop** (`location targ_space,move_targ,l;`, boe.combat.cpp:2060). Both
    // branches below leave it *untouched* when the target is 6 (no one), so a
    // creature with nothing to chase inherits whatever square the last
    // creature to have a target was aiming at — and (0,0) at the top of the
    // call, which is `location`'s default constructor (location.cpp:46). Only
    // the tactic test and the flee call read it in that state, so this is a
    // small quirk with a real effect on the draw stream; a per-creature
    // `targSpace` would be tidier and wrong.
    let targSpace: Location = loc(0, 0);

    for (let i = 0; i < numMonst; i++) {
      const monst = town.monsters[i]!;
      if (!univ.party.pcs.some((pc) => pc.isAlive)) return;

      // A monster that can't reach anything shouldn't spin forever: the C++
      // relies on take_m_ap always firing, so the guard is a safety net for the
      // cases this port hasn't filled in yet.
      let guard = 40;
      // "don't use multiple times per round" — reset per monster, not per
      // action, so a monster with action points left can't call it twice.
      let specialCalled = false;
      // `futzing = 0; // assume monster is fresh` (boe.combat.cpp:2157).
      futzing = 0;
      // `pc_adj[]` — who was in melee with this creature when its turn began.
      // Filled in once per monster, not per action point, because the whole
      // question it answers is "did it leave?".
      const pcAdj = univ.party.pcs.map(
        (pc) => pc.isAlive && monstAdjacent(monst, pc.combatPos));
      while (monst.ap > 0 && monst.isAlive && guard-- > 0) {
        // In combat a monster picks a PC; in town the target is the party as a
        // whole, standing on one square, and do_monsters has already chosen it.
        const inCombat = session.mode === GameMode.COMBAT;
        // `target = monst_pick_target(i); target = switch_target_to_adjacent(i,target);`
        // (boe.combat.cpp:2173). The second call was missing here entirely, so
        // a creature standing in a scrum kept walking toward whoever the picker
        // named — usually the last PC to cast, several squares away — instead of
        // hitting the one it was already next to.
        let target = inCombat
          ? switchTargetToAdjacent(session, monst, monstPickTarget(session, monst))
          : monst.target;
        // **A creature target is chased to where *it* is standing, in town as
        // well as in combat** (boe.combat.cpp:2175-2186). This port used the
        // party's square for the whole town branch, so a charmed creature — or
        // a hostile one that went after a friendly monster — walked toward the
        // party while the C++ walked toward its quarry. Both branches leave
        // `targSpace` alone for target 6; see its declaration.
        const targetPc = target >= 0 ? univ.party.pcs[target] : undefined;
        if (target < NO_ONE) {
          // The C++ reads `univ.party[target]` here without checking the sign,
          // and only clamps a negative target to 6 on the line *after*. Nothing
          // reachable produces one, and a negative index would throw here where
          // the C++ quietly reads past the array, so this leaves `targSpace`
          // alone instead — the same thing the clamp below then implies.
          if (targetPc) targSpace = inCombat ? targetPc.combatPos : univ.party.townLoc;
        } else if (target !== NO_ONE) {
          const other = town.monsters[target - 100];
          if (other) targSpace = other.curLoc;
        }
        // `if((target < 0) || ((target > 5) && (target < 100))) target = 6;`
        // (boe.combat.cpp:2191) — a target index that is neither a PC nor a
        // creature becomes "no one", and it is the *stored* field that is
        // clamped, in both modes.
        monst.target = (target < 0 || (target > 5 && target < 100)) ? NO_ONE : target;
        target = monst.target;

        // "Draw w. monster in center, if can see" — the view follows whichever
        // monster is about to act, so you see where the spear comes from rather
        // than only the damage number it leaves behind. Combat only: in town the
        // camera stays on the party, which is where the action is anyway.
        if (inCombat && monst.ap > 0 && monst.attitude !== Attitude.DOCILE
          && (target !== NO_ONE || !monst.isFriendly)
          && session.partyCanSeeMonst(monst)) {
          focusOn(monst.curLoc);
          // `center = cur_monst->cur_loc; draw_terrain(0); pause(GameSpeed)` — the
          // view rests on the monster *before* it acts, which is only true if the
          // turn stops here. This is also what paces plain movement: a monster
          // walking three squares comes back round this loop three times.
          await animSettle();
        }

        let actedYet = false;

        // **`current_monst_tactic` (boe.combat.cpp:2223)** — "the monster, if
        // evil, looks at the situation and maybe picks a tactic", and the only
        // tactic there is means *back away*. Two creatures do it: a caster
        // with the party close but not yet on top of it, and **an archer with
        // its target inside six squares and not adjacent** — which is what
        // makes bowmen kite instead of walking into melee.
        //
        // It was unported, and it is not cosmetic: it feeds the flee test
        // below, so a monster that should have backed off both *drew* one
        // fewer `get_ran(1,1,6)` and walked the wrong way. Note the gates —
        // more than one action point left, and `futzing == 0`, so a creature
        // that has already wasted a point stops being clever.
        let tactic = 0;
        if (target !== NO_ONE && monst.ap > 1 && futzing === 0) {
          const nearest = closestPcLoc(univ, monst.curLoc);
          const mu = monst.mon.mu ?? 0;
          const cl = monst.mon.cl ?? 0;
          if ((mu > 0 || cl > 0) && dist(monst.curLoc, nearest) < 5
            && !monstAdjacent(monst, nearest)) tactic = 1;
          if ((monst.mon.abil[MonstAbil.MISSILE]?.active ?? false)
            && dist(monst.curLoc, targSpace) < 6
            && !monstAdjacent(monst, targSpace)) tactic = 1;
        }
        if (TRACE_TACTIC) {
          const nearest = closestPcLoc(univ, monst.curLoc);
          // eslint-disable-next-line no-console
          console.log(`      [tactic] ${i} t=${tactic} target=${target} mtarget=${monst.target}`
            + ` ap=${monst.ap} futz=${futzing} morale=${monst.morale}`
            + ` near=(${nearest.x},${nearest.y}) d=${dist(monst.curLoc, nearest)}`
            + ` adj=${monstAdjacent(monst, nearest) ? 1 : 0}`
            + ` targ=(${targSpace.x},${targSpace.y}) dt=${dist(monst.curLoc, targSpace)}`
            + ` spd=${monst.mon.speed} hs=${monst.status[Status.HASTE_SLOW] ?? 0}`
            + ` web=${monst.status[Status.WEBS] ?? 0} at=(${monst.curLoc.x},${monst.curLoc.y})`);
        }

        // Flee when its nerve is gone — but the unliving and the mindless never
        // do — *or* when the tactic above says to. Note the outer test is on
        // `monst.target`, and the inner one on that same index being a living
        // PC: the C++ mixes the stored target and the local `target` here, and
        // they are not always the same number.
        const canFlee = !monst.mon.mindless && monst.mon.race !== Race.UNDEAD
          && monst.mon.race !== Race.SKELETAL;
        if (monst.target !== NO_ONE && ((monst.morale <= 0 && canFlee) || tactic === 1)) {
          if (monst.morale < 0) monst.morale++;
          if (monst.health > 50) monst.morale++;
          if (univ.rng.getRan(1, 1, 6) === 3) monst.morale++;
          const targ = monst.target;
          if (targ < NO_ONE && (univ.party.pcs[targ]?.isAlive ?? false) && monst.mobile) {
            actedYet = await fleeParty(session, monst, targSpace);
            if (actedYet) monst.ap = Math.max(0, monst.ap - 1);
          }
        }

        // One gate over every special attack (boe.combat.cpp:2258) — the
        // spells, the missile abilities and the SPECIAL node all sit inside
        // it. Both directions of sight are required, and this is what makes a
        // monster hold its fire until it has a clear line: without it an
        // archer shot round a corner a turn early, which is a divergence you
        // see in the draw stream long before you see it on screen.
        const canSpecAttack = target !== NO_ONE && monst.attitude !== Attitude.DOCILE
          && monstCanSee(session, monst, targSpace) && canSeeMonst(session, targSpace, monst);

        // **The basic breath weapon goes first**, ahead of the spells
        // (boe.combat.cpp:2261): `DAMAGE2` delivered as a BREATH gets a chance
        // of its own through `monst_breathe`, and only falls through to
        // `pickMonsterAbility` below — where DAMAGE2 is also a candidate — if
        // this roll misses. Two things about the shape are load-bearing:
        // **the odds roll comes before the range test**, so a drake out of
        // reach still spends the draw; and the whole block is skipped once
        // something has acted.
        if (canSpecAttack) {
          const breath = monst.mon.abil[MonstAbil.DAMAGE2];
          if (breath?.active && breath.gen.type === MonstGen.BREATH && !actedYet
            && univ.rng.getRan(1, 1, 1000) < breath.gen.odds
            && dist(monst.curLoc, targSpace) <= breath.gen.range) {
            await monstBreathe(session, monst, targSpace, breath);
            monst.ap = Math.max(0, monst.ap - 4);
            actedYet = true;
          }
        }

        // Spells come before the missile abilities, as they do in the C++
        // (boe.combat.cpp:2272). A caster mostly won't bother when the party is
        // already on top of it — unless it is a high-level one, or a scenario
        // monster (number >= 160), or the coin says otherwise.
        //
        // **No `is_friendly` test here, and that is the C++'s** — the gate at
        // :2258 is target/attitude/sight only, so a *charmed* caster (FRIENDLY,
        // not DOCILE) casts at whatever it is fighting for the party. This port
        // had `&& !monst.isFriendly` on this block and the missile one below;
        // it silenced every charmed spellcaster and every friendly archer, and
        // cost the draws their decisions make.
        if (canSpecAttack) {
          const adjacent = monstAdjacent(monst, targSpace);
          const inRange = dist(monst.curLoc, targSpace) <= 10;
          const mu = monst.mon.mu;
          const cl = monst.mon.cl;
          // **The roll comes before `!acted_yet`, and `&&` is left to right.**
          // The C++ writes `if((mu > 0) && (get_ran(...) < n) && !acted_yet)`
          // (boe.combat.cpp:2272/:2285), so a caster that has *already acted*
          // still spends the draw deciding whether it would have cast. This
          // port asked `!actedYet` first and skipped it, which is one missing
          // `get_ran(1,1,10)` or `get_ran(1,1,8)` per caster per turn.
          //
          // The range test moved too: it belongs to the *inner* condition,
          // beside the adjacency coin, not to the block as a whole.
          if (mu > 0 && univ.rng.getRan(1, 1, 10) < (cl > 0 ? 6 : 9) && !actedYet) {
            if ((!adjacent || univ.rng.getRan(1, 0, 2) < 2
              || monst.number >= 160 || monst.getLevel() > 9) && inRange) {
              await monstCastMage(session, monst, target);
              // The C++ discards the return and counts the turn as spent either
              // way, so a monster that couldn't afford the spell still loses its
              // action points. Its own TODO asks whether that is right.
              monst.ap = Math.max(0, monst.ap - 5);
              actedYet = true;
            }
          }
          if (cl > 0 && univ.rng.getRan(1, 1, 8) < 7 && !actedYet) {
            if ((!adjacent || univ.rng.getRan(1, 0, 2) < 2 || monst.getLevel() > 9) && inRange) {
              await monstCastPriest(session, monst, target);
              monst.ap = Math.max(0, monst.ap - 4);
              actedYet = true;
            }
          }
        }

        // Ranged abilities come before melee — the missile or breath is what an
        // archer or a drake reaches for when the party isn't yet on top of it.
        if (!actedYet && canSpecAttack) {
          // `univ.get_target(target)` (boe.combat.cpp:2379) — the target the
          // monster already has, *not* a fresh one. In town that index was
          // chosen once by `do_monsters`, and re-rolling `select_active_pc`
          // here spent a draw the C++ never spends and shot at the wrong PC.
          const who: Living | null = resolveTarget(session, target);
          if (who && who.isAlive) {
            const picked = pickMonsterAbility(
              session, monst, targSpace, monstAdjacent(monst, targSpace), target);
            if (picked) {
              univ.addStringToBuf(`${monst.mon.name}:`);
              // DRAIN_SP picks its own victim (boe.combat.cpp:2355) — whoever
              // still has spell points, which is often not the PC the monster
              // was walking toward.
              const at = picked.retarget
                ? resolveTarget(session, picked.retarget.target) ?? who
                : who;
              // Everything picked here goes through monst_fire_missile, which
              // sorts out the four kinds of ranged attack itself.
              await monstFireMissile(session, monst, picked.key, picked.abil, at);
              // A touch costs -1 and never gets here; anything else costs its own
              // price, and 0 would spin the loop, so it still gives up a point.
              const cost = abilityCost(picked);
              monst.ap = Math.max(0, monst.ap - Math.max(1, cost));
              actedYet = true;
            }
          }
        }

        // The SPECIAL ability — a scenario node the monster runs itself, once
        // per round at most (boe.combat.cpp:2393). It sits inside the
        // "special attacks" block, so a monster that has already shot can
        // still call it; only the melee below is skipped by `actedYet`.
        //
        // The three `special` slots are: extra1 the node, extra2 what it costs
        // in action points, extra3 the odds in 1000. The node reads its target
        // through the reserved pointers — 21/22 the square, 20 the target
        // (a PC is passed as 11 + index, ready for a SELECT_TARGET node).
        const specAbil = monst.mon.abil[MonstAbil.SPECIAL];
        if (canSpecAttack && specAbil?.active && !specialCalled && session.partyCanSeeMonst(monst)
          && univ.rng.getRan(1, 1, 1000) <= specAbil.special.extra3) {
          specialCalled = true;
          univ.party.forcePtr(21, targSpace.x);
          univ.party.forcePtr(22, targSpace.y);
          univ.party.forcePtr(20, target < NO_ONE ? 11 + target : target);
          const r = await session.runSpecialRaw(
            SpecCtx.MONST_SPEC_ABIL, SpecCtxType.SCEN, specAbil.special.extra1, monst.curLoc);
          // A node that reports a positive value has taken the time itself.
          if (r.a <= 0) monst.ap = Math.max(0, monst.ap - specAbil.special.extra2);
        }

        // Melee, if it can reach. Attacking a PC still needs `!isFriendly` (a
        // charmed creature never swings at the party); attacking another
        // creature only needs `attitude !== DOCILE`, already true here — this
        // is what lets a charmed monster actually fight its former allies.
        if (!actedYet && target !== NO_ONE && monst.attitude !== Attitude.DOCILE) {
          // `iLiving& who = univ.get_target(target)` (boe.combat.cpp:2409) —
          // again the target it already has. Town mode does *not* re-roll a
          // victim here: `do_monsters` picked the PC index once for the whole
          // turn, and drawing again both cost a draw the C++ never makes and
          // let the blow land on someone the monster wasn't targeting.
          let who: Living | null = resolveTarget(session, target);
          // The C++'s two `dynamic_cast`s: a PC is only swung at by a hostile
          // creature, another creature only by a non-docile one (already true
          // in this branch).
          if (who instanceof Player && monst.isFriendly) who = null;
          if (who && who.isAlive && monstAdjacent(monst, targSpace)) {
            await monsterAttack(session, monst, who);
            monst.ap = Math.max(0, monst.ap - 4);
            actedYet = true;
          }
        }

        // The post-action beat (boe.combat.cpp:2428) — flee, spec attacks and
        // melee all fall through to here; plain movement doesn't (it has its
        // own footstep sound instead, in combatMoveMonster).
        if (actedYet && inCombat) {
          bookActionPause();
          // `print_buf(); pause(8);` — the beat that lets one swing's damage
          // number be read before the next monster starts. Waiting for it is the
          // point: the C++ blocks here, and it is the only reason a crowded
          // fight doesn't resolve in a single frame.
          await animSettle();
        }

        // Otherwise close the distance — but only in combat; town-mode movement
        // is do_monsters' job and has already happened.
        // Printed alongside `[mmove]`, and the pair to the harness's line in the
        // same place: the state the move branch is about to decide on. `[mmove]`
        // says a creature stepped somewhere the other side didn't; this says
        // *why* it was going there, which is the half that names the rule.
        if (TRACE_MMOVE) {
          console.log(`      [mbranch] ${monst.slot} acted=${actedYet ? 1 : 0}`
            + ` mob=${monst.mobile ? 1 : 0} friendly=${monst.isFriendly ? 1 : 0}`
            + ` target=${monst.target} targ_space=(${targSpace.x},${targSpace.y})`
            + ` ap=${monst.ap}`);
        }
        if (inCombat) {
          if (!actedYet && monst.mobile) {
            // `move_target` is the *stored* target, not the one picked above —
            // they are the same value here, but the C++ reads the field.
            const moveTarget = monst.target !== NO_ONE
              ? monst.target : closestPc(univ, monst.curLoc);
            // **"First, maybe move out of dangerous space"** (:2443) — a
            // creature standing in a wall of fire heads for clear ground
            // instead of doing anything else this point. `monst_hate_spot`
            // draws (it calls `find_clear_spot`, up to 150 times), so leaving
            // it out was never cosmetic. Note the action point below is spent
            // either way, and the free swings after it still happen.
            const hated = monstHateSpot(session, monst);
            if (hated) {
              await seekParty(session, monst, hated);
            } else if (moveTarget >= 100) {
              // A creature target: still gated on it being alive
              const other = univ.town?.monsters[moveTarget - 100];
              if (other?.isAlive) {
                // `seek_party` runs whichever side `monst` is fighting for —
                // there is no is_friendly gate on this branch. The parry check
                // after it does still require `monst` to be hostile, since a
                // charmed creature walking past a stand-ready PC shouldn't
                // give away a free swing.
                await seekParty(session, monst, other.getLoc());
                if (!monst.isFriendly) await checkParryOpportunity(session, monst);
              }
            } else if (!monst.isFriendly && moveTarget < NO_ONE) {
              const pc = univ.party.pcs[moveTarget]!;
              if (pc.isAlive) {
                await seekParty(session, monst, pc.combatPos);
                await checkParryOpportunity(session, monst);
              }
            }
            // A docile creature wanders instead of closing, and wandering is
            // futzing whether or not it got anywhere (boe.combat.cpp:2464).
            // Inside the "spot is OK, so go nuts" branch: a creature that just
            // stepped out of a fire doesn't also wander.
            if (!hated && monst.attitude === Attitude.DOCILE) {
              actedYet = await randMove(session, monst);
              futzing++;
            }
            monst.ap = Math.max(0, monst.ap - 1);
          }
          // An immobile creature still burns the point (boe.combat.cpp:2470).
          if (!actedYet && !monst.mobile) {
            monst.ap = Math.max(0, monst.ap - 1);
            futzing++;
          }
        } else if (!actedYet) {
          // Town: `do_monsters` already did the walking, so a creature that
          // found nothing to do here simply loses the point.
          monst.ap = Math.max(0, monst.ap - 1);
          futzing++;
        }

        // "pcs attack any fleeing monsters" (boe.combat.cpp:2481) — a PC who
        // was in melee with this creature when its turn began, and isn't now,
        // gets a free swing at it. Distinct from `checkParryOpportunity`, which
        // is the stand-ready swing and fires on a *parry* rather than on the
        // creature leaving. `pcAdj[k]` is cleared once used, so a creature that
        // steps in and out again doesn't hand out a second one.
        if (inCombat) {
          for (let k = 0; k < univ.party.pcs.length; k++) {
            const pc = univ.party.pcs[k]!;
            if (!pc.isAlive || !pcAdj[k] || monst.isFriendly || !monst.isAlive) continue;
            if (monstAdjacent(monst, pc.combatPos)) continue;
            if ((pc.status[Status.INVISIBLE] ?? 0) !== 0) continue;
            if (pc.traits[Trait.PACIFIST]) continue;
            pcAdj[k] = false;
            await pcAttack(univ, k, monst, session);
          }
        }

        // Summoning rides along with the action rather than costing one, and it
        // happens once per action the monster takes — the C++ puts it at the
        // bottom of the same loop, gated on the monster actually seeing its foe.
        if (target !== NO_ONE && session.canSeeLight(monst.curLoc, targSpace) < 5) {
          // RADIATE rolls before SUMMON does, and both use the same stream —
          // don't reorder them.
          const radiate = monst.mon.abil[MonstAbil.RADIATE];
          if (radiate?.active && univ.rng.getRan(1, 1, 100) < radiate.radiate.chance) {
            await placeSpellPattern(session, radiate.radiate.pat, monst.curLoc, {
              field: radiate.radiate.type as FieldType,
              rot: monst.direction + 6,
              // 7 is out of the 0-5 PC range, so nobody is credited with a kill.
              whoHit: 7,
            });
          }
          monsterSummon(session, monst);
        }

        // `if(futzing > 1) // If monster's just pissing around, give up`
        // (boe.combat.cpp:2541). This is the C++'s own termination condition,
        // and it replaces a `if (!actedYet) monst.ap = 0;` invented here when
        // nothing else stopped the loop: that gave up after *one* wasted point
        // rather than two, so a creature that shoved once and then found a way
        // through never got to take it.
        if (futzing > 1) monst.ap = 0;
      }
      monst.ap = 0;
    }

    // --- "Begin monster time stuff loop" (boe.combat.cpp:2553) --------------
    //
    // **A second pass over the same `numMonst` creatures**, after every one of
    // them has acted: acid and poison bite, disease rolls its mischief, and
    // every timed status ticks toward zero. This port had none of it, which
    // meant a webbed or slept creature never came round on its own, a poisoned
    // one never died of it — and, the reason it finally surfaced, **bonus hit
    // points never wore off**.
    //
    // That last one is four lines and no draws, which is exactly why it hid
    // for so long: a creature placed with more health than its definition
    // allows (a guard powered up by `make_town_hostile`, say) sheds one point
    // every fourth turn until it is back to `m_health`. This port left it at
    // full, so a Gremlin the C++ killed with an 11-point swing survived here —
    // and *then* rolled `get_ran(1,1,1000)` to split, which is the draw the
    // divergence actually showed. The health was 1 out, forty turns earlier,
    // and nothing in the draw stream could see it.
    let printedAcid = false;
    let printedPoison = false;
    let printedDisease = false;
    for (let i = 0; i < numMonst; i++) {
      // **An early `return`, not a `break`** (boe.combat.cpp:2556): a party
      // that dies to the acid ticking here skips the centre restore and the
      // parry reset below, exactly as the C++ does.
      if (!univ.party.pcs.some((pc) => pc.isAlive)) return;
      const monst = town.monsters[i];
      if (!monst?.isAlive) continue;

      if ((monst.status[Status.ACID] ?? 0) > 0) {
        if (!printedAcid) {
          univ.addStringToBuf('Acid:');
          printedAcid = true;
        }
        const r1 = univ.rng.getRan(monst.status[Status.ACID] ?? 0, 1, 6);
        await damageMonst(univ, monst, 6, r1, DamageType.ACID, { session });
        monst.status[Status.ACID] = (monst.status[Status.ACID] ?? 0) - 1;
      }

      // The wake-up note fires at **1**, before the decrement takes it to 0.
      if ((monst.status[Status.ASLEEP] ?? 0) === 1) monst.spellNote(SpellNote.AWAKE);
      for (const which of [
        Status.ASLEEP, Status.PARALYZED, Status.INVISIBLE,
        Status.INVULNERABLE, Status.MAGIC_RESISTANCE, Status.MARTYRS_SHIELD,
      ]) {
        monst.status[which] = moveToZero(monst.status[which] ?? 0);
      }

      if (univ.party.age % 2 === 0) {
        for (const which of [Status.BLESS_CURSE, Status.HASTE_SLOW, Status.WEBS]) {
          monst.status[which] = moveToZero(monst.status[which] ?? 0);
        }
        if ((monst.status[Status.POISON] ?? 0) > 0) {
          if (!printedPoison) {
            univ.addStringToBuf('Poisoned monsters:');
            printedPoison = true;
          }
          const r1 = univ.rng.getRan(monst.status[Status.POISON] ?? 0, 1, 6);
          await damageMonst(univ, monst, 6, r1, DamageType.POISON, { session });
          monst.status[Status.POISON] = (monst.status[Status.POISON] ?? 0) - 1;
        }
        if ((monst.status[Status.DISEASE] ?? 0) > 0) {
          if (!printedDisease) {
            univ.addStringToBuf('Diseased monsters:');
            printedDisease = true;
          }
          // Two draws every time, and the second one only *sometimes* shortens
          // the disease — so a diseased creature is a steady pair of draws per
          // even turn for as long as it lasts.
          switch (univ.rng.getRan(1, 1, 5)) {
            case 1: case 2: monst.poison(2); break;
            case 3: monst.slow(2); break;
            case 4: monst.curse(2); break;
            default: monst.scare(10); break;
          }
          if (univ.rng.getRan(1, 1, 6) < 4) {
            monst.status[Status.DISEASE] = (monst.status[Status.DISEASE] ?? 0) - 1;
          }
        }
      }

      if (univ.party.age % 4 === 0) {
        monst.restoreSp(2);
        monst.status[Status.DUMB] = moveToZero(monst.status[Status.DUMB] ?? 0);
        // "Bonus HP and SP wear off" — one point a turn, and only downwards.
        if (monst.mp > monst.maxMp) monst.mp--;
        if (monst.health > monst.maxHealth) monst.health--;
      }
    }

    // "If in town, need to restore center" (boe.combat.cpp:2620). The camera
    // never followed a monster here — that is combat-only — but a missile it
    // throws now moves the view, so the town half of the turn has somewhere to
    // put it back from too. On the main exit only, as in the C++: a wiped
    // party returns above this.
    if (session.mode !== GameMode.COMBAT) {
      session.center = { ...univ.party.townLoc };
    }
    // `for(cPlayer& pc : univ.party) pc.parry = 0;` (boe.combat.cpp:2623) —
    // a guard lasts until the monsters have had their go, and no longer. This
    // was missing, so a parry's damage reduction and to-hit bonus stayed up
    // for the rest of the fight, and a stand-ready PC (parry 100) kept its
    // free swing in hand round after round without ever spending a turn on
    // it again. On the main exit only, as in the C++.
    for (const pc of univ.party.pcs) pc.parry = 0;
  } finally {
    session.monstersGoing = false;
  }
}

/**
 * combat_run_monst (boe.combat.cpp:1867) — the monsters' turn plus the
 * end-of-round upkeep: the clock, the light burning down, and every timed
 * status ticking toward zero.
 *
 * TODO(M6): dump_gold and the OCCASIONAL_STATUS item effects.
 */
export async function combatRunMonst(session: GameSession): Promise<void> {
  const univ = session.univ;
  await doMonsterTurn(session);

  // The fields act right after the monsters do, before the clock and the
  // statuses tick — a wall of fire burns you on the same turn it was cast.
  await processFields(session);

  univ.party.lightLevel = moveToZero(univ.party.lightLevel);
  const lighting = univ.townRecord?.lightingType ?? 0;
  if (lighting === 2) univ.party.lightLevel = Math.max(0, univ.party.lightLevel - 9);
  if (lighting === 3) univ.party.lightLevel = 0;

  univ.party.age++;
  // The long-lived statuses tick every fourth turn; the rest every turn.
  if (univ.party.age % 4 === 0) {
    for (const pc of univ.party.pcs) {
      pc.status[Status.BLESS_CURSE] = moveToZero(pc.status[Status.BLESS_CURSE] ?? 0);
      pc.status[Status.HASTE_SLOW] = moveToZero(pc.status[Status.HASTE_SLOW] ?? 0);
    }
  }
  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    for (const which of [
      Status.INVULNERABLE, Status.MAGIC_RESISTANCE, Status.INVISIBLE,
      Status.MARTYRS_SHIELD, Status.ASLEEP, Status.PARALYZED,
    ]) {
      pc.status[which] = moveToZero(pc.status[which] ?? 0);
    }
  }
  // combat_run_monst's own call (boe.combat.cpp:2018): the timers get their
  // round in a fight too, so a town timer keeps counting while you fight in it.
  specialIncreaseAge(session);
  // Conveyor belts move whoever is standing on one, once a round
  // (boe.combat.cpp:2019). It spends no draws unless someone is shoved into a
  // stone block, which is what made its absence so hard to see.
  await pushThings(session);
  // Poison, disease and acid bite far more often in combat than they do on the
  // road: every other round rather than every fiftieth turn.
  if (univ.party.age % 2 === 0) await doPoison(session);
  if (univ.party.age % 3 === 0) handleDisease(session);
  await handleAcid(session);
  // `handle_marked_damage` is ported (game/damage.ts) but is not called here:
  // combat_run_monst's copy exists for the volleys a *monster* fires, and
  // nothing on the monster side opens one yet. `doCombatCast` is the only
  // caller so far. TODO(M6): open a volley around monst_fire_missile too.
}
