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
 * **Four of the five call sites round a combat cast are wired; the fifth is
 * not.** In order, for `VoDT_05-04-2025_14-32-10`'s draws 24-28:
 *
 * | draw | caller | here |
 * |------|--------|------|
 * | 24 | `handle_target_mode` → `draw_terrain` | `targetMode.ts` |
 * | 25 | `advance_time` → `if(need_redraw) draw_terrain()` | **TODO(M8)** |
 * | 26 | `main_loop_iteration` → `redraw_everything` | `replay/driver.ts` |
 * | 27 | `do_combat_cast` → `draw_terrain(2)` | `spellCombatTarget.ts` |
 * | 28 | `place_spell_pattern` → `draw_terrain(0)` | `spellPatterns.ts` |
 *
 * The missing one needs `need_redraw` modelled, which is a per-handler audit —
 * see the PROGRESS entry, which has the ground-truth table for it.
 *
 * **`draw_terrain(2)` is not free, and an earlier note here said it was.**
 * Mode 2 suppresses the working creature's own square and then **sets
 * `mode = 0`** (boe.graphics.cpp:859) and falls through, so it reaches
 * `draw_text_bar` like any other full redraw. What makes some mode-2 calls free
 * is the early-out above that — `if(current_working_monster < 0) return;`.
 * Mode 1, the one that only fills the terrain template, really does cost
 * nothing: it never enters the `if(mode == 0)` block at the end.
 */

import { Spell } from '../data/spell';
import { Skill } from '../universe/skills';
import { pcCanCastType } from './spellCast';
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
  if (!isCombat(session.mode) || univ.curPc >= 6 || session.monstersGoing) return;
  const pc = univ.currentPc;
  const type: Skill = pc.lastCastType;
  // `hint_prefix` is empty for anything but the two spell skills — the only
  // other expected value is `eSkill::INVALID` — and an empty prefix skips the
  // whole block.
  if (type !== Skill.MAGE_SPELLS && type !== Skill.PRIEST_SPELLS) return;
  // "No spell to recast" costs nothing.
  if ((pc.lastCast[type] ?? Spell.NONE) === Spell.NONE) return;
  // `pc_can_cast_spell(current_pc, type) == CAST_OK && spell.cost <= get_magic()`
  // — the left side always runs, and it is the side that draws.
  pcCanCastType(session, pc, type);
}
