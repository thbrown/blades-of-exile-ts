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
 * **TODO(M8): nothing calls `drawTerrain` yet, and that is deliberate.** The
 * rule below is ported and correct; the call sites are not, and wiring *some*
 * of them is worse than wiring none. Measured: the missile and explosion loops
 * plus `place_spell_pattern`'s `draw_terrain(0)` — three of the five redraws
 * the head recording needs — moved the corpus by +87 draws and pushed one file
 * backwards, because a combat stream that is short by two rolls is no better
 * aligned than one short by five. The two that remain are `advance_time`'s
 * redraw and the main loop's `redraw_everything`, and the second needs
 * `need_redraw` modelled. See the `text_bar_text` lead in PROGRESS.md.
 *
 * Only `mode == 0` reaches `draw_text_bar`. `draw_terrain(1)` (the one that
 * fills the terrain template) and `draw_terrain(2)` (the monster-suppressing
 * one) draw nothing here, which is why the animation set-up passes cost
 * nothing and only the frame loops do.
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
