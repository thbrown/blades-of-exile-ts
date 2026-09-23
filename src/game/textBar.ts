/**
 * `text_bar_text` (boe.graphics.cpp:686) — the status bar's right-hand hint,
 * *"M: Recast Fireball"*.
 *
 * **This is here because it spends dice.** To decide between "Recast X" and
 * "Cannot recast" it calls `pc_can_cast_spell(current_pc, type)`, whose combat
 * arm rolls `total_encumbrance` (boe.party.cpp:1612) — one `get_ran` per
 * equipped awkward item. `draw_terrain(0)` ends with `draw_text_bar()`
 * (boe.graphics.cpp:1071), so:
 *
 * > once any PC has cast a spell, **every full terrain redraw in combat spends
 * > an encumbrance roll for the acting PC**.
 *
 * Which makes the *number of redraws* part of the spec, and that is the whole
 * difficulty: this port does not block on animation, it books slots on a
 * shared timeline. What it can do is call `drawTerrain` exactly where the C++
 * calls `draw_terrain(0)`, with the same counts — and those counts are
 * constants, not wall-clock: `do_missile_anim` redraws once per step for
 * `num_steps` steps, `do_explosion_anim` eleven times. Both numbers this port
 * already had.
 *
 * **The sites, and where each is paid.** In order, for
 * `VoDT_05-04-2025_14-32-10`'s draws 24-108:
 *
 * | draw(s) | caller | here |
 * |---------|--------|------|
 * | 24 | `handle_target_mode` → `draw_terrain` | `targetMode.ts` |
 * | 25 | `advance_time` → `if(need_redraw) draw_terrain()` | `replay/driver.ts` |
 * | 26 | `main_loop_iteration` → `redraw_everything` | `replay/driver.ts` |
 * | 27 | `do_combat_cast` → `draw_terrain(2)` | `spellCombatTarget.ts` |
 * | 28 | `place_spell_pattern` → `draw_terrain(0)` | `spellPatterns.ts` |
 * | 37-96 | `do_missile_anim`, one per step | `missileAnimFrames` below |
 * | 97 | the same, at the camera swing | `missileAnimFrames` below |
 * | 98-108 | `do_explosion_anim`, eleven frames | `booms.ts`'s `onFrame` |
 *
 * plus `handle_monster_actions`' own `if(need_redraw) draw_terrain()`
 * (`session.monsterActionsCombat`) and `handle_switch_pc`'s in combat.
 *
 * `need_redraw` is modelled in the driver, which is where `replay_action`
 * declares it; PROGRESS.md carries the ground-truth table it was checked
 * against (`BOE_TRACE_MMOVE=1`'s `[advtime] redraw=` column).
 *
 * **`draw_terrain(2)` is not free, and an earlier note here said it was.**
 * Mode 2 suppresses the working creature's own square and then **sets
 * `mode = 0`** (boe.graphics.cpp:859) and falls through, so it reaches
 * `draw_text_bar` like any other full redraw. What makes some mode-2 calls free
 * is the early-out above that — `if(current_working_monster < 0) return;`.
 * Mode 1, the one that only fills the terrain template, really does cost
 * nothing: it never enters the `if(mode == 0)` block at the end.
 */

import { SPELLS, Spell, spellName } from '../data/spell';
import { Skill } from '../universe/skills';
import { CastStatus, pcCanCastType } from './spellCast';
import { GameMode, isCombat } from './modes';
import type { GameSession } from './session';

/**
 * `draw_terrain(0)` — everything this port needs from it, which is the dice.
 *
 * The early-out at the top of `draw_terrain` (boe.graphics.cpp:838) matters:
 * in TALKING, SHOPPING or STARTUP it returns before painting anything, so no
 * hint is computed and no roll is made.
 */
export function drawTerrain(session: GameSession): void {
  const mode = session.mode;
  if (mode === GameMode.TALKING || mode === GameMode.SHOPPING
    || mode === GameMode.STARTUP) return;
  drawTextBar(session);
}

/**
 * `draw_text_bar()` → `text_bar_text()`. Everything before the
 * `pc_can_cast_spell` call is a gate; nothing else in the function draws.
 */
function drawTextBar(session: GameSession): void {
  const univ = session.univ;
  // The hint is kept for the screen to draw: it is computed *here*, where the
  // C++ computes it, so drawing it never rolls a second time.
  session.recastHint = '';
  if (!isCombat(session.mode) || univ.curPc >= 6 || session.monstersGoing) return;
  const pc = univ.currentPc;
  const type: Skill = pc.lastCastType;
  // `hint_prefix` is empty for anything but the two spell skills — the only
  // other expected value is `eSkill::INVALID` — and an empty prefix skips the
  // whole block.
  if (type !== Skill.MAGE_SPELLS && type !== Skill.PRIEST_SPELLS) return;
  const prefix = type === Skill.MAGE_SPELLS ? 'M' : 'P';
  const spell = pc.lastCast[type] ?? Spell.NONE;
  // "No spell to recast" costs nothing.
  if (spell === Spell.NONE) {
    session.recastHint = `${prefix}: No spell to recast`;
    return;
  }
  // `pc_can_cast_spell(current_pc, type) == CAST_OK && spell.cost <= get_magic()`
  // — the left side always runs, and it is the side that draws.
  const ok = pcCanCastType(session, pc, type) === CastStatus.OK
    && (SPELLS[spell]?.cost ?? 0) <= pc.getMagic();
  session.recastHint = ok ? `${prefix}: Recast ${spellName(spell)}` : `${prefix}: Cannot recast`;
}

/**
 * `draw_terrain(2)` — the mode the acting creature's own square is suppressed
 * in, and **the one with an early-out**: `if(current_working_monster < 0)
 * return;` (boe.graphics.cpp:842). Past that it sets `mode = 0` and falls
 * through, so it costs exactly what a full redraw costs.
 *
 * Most of this port's mode-2 sites are inside something that has just set the
 * flag, and call `drawTerrain` directly with a comment saying so. Use this one
 * where the same code is reached both ways — `damageMonst`'s "no damage" arm is
 * the case that needed it.
 */
export function drawTerrain2(session: GameSession): void {
  if (session.workingMonster < 0) return;
  drawTerrain(session);
}

/**
 * `do_missile_anim`'s frame loop, counted rather than drawn
 * (boe.newgraph.cpp:436). One `draw_terrain()` per step for `numSteps` steps,
 * **plus one more** for the camera swing — the recentre block redraws and then
 * does `i--; continue;` to redo the frame, so it costs a redraw of its own and
 * only ever fires once (`!recentered`).
 *
 * The count is a constant, which is what makes this portable at all: this port
 * flies a missile from a timeline slot rather than a frame loop, so it cannot
 * pay the rolls *while* drawing. It pays them here instead, at the same point
 * in the stream.
 *
 * The C++ returns before any of it when nothing was queued (`have_missile`),
 * so the caller must not call this for an empty volley.
 */
export function missileAnimFrames(session: GameSession, numSteps: number): void {
  for (let t = 0; t < numSteps; t++) drawTerrain(session);
  drawTerrain(session);
}
