/**
 * The spell-casting screen — a port of `cast-spell.xml` and the `pick_spell`
 * machinery around it (boe.party.cpp:2133, :1905).
 *
 * This is deliberately *one* dialog, as the original is. Down the left are the
 * six party members, each with a caster button, a target button, their health,
 * spell points and status icons; below them the spell grid, four columns of
 * one level each, flipped between levels 1-4 and 5-7 by "Other Spells".
 *
 * Layout numbers come straight from the dialog definition: headers on one row
 * at lefts 22/88/200/255/279/303, PC rows 24px apart from y=79, the spell
 * columns at x=10/162/326/486 with their LEDs 14px apart from y=247, and the
 * three buttons along the bottom at y=394.
 */

import { STATUS_ICONS, statIconRect, statusIconFor } from '../data/statusIcons';
import { SPELLS, Spell, spellName } from '../data/spell';
import { pcCanCastType, CastStatus } from '../game/spellCast';
import { CastChoice, NO_TARGET, SPELL_SLOTS, SpellPick } from '../game/spellPick';
import type { GameSession } from '../game/session';
import { Colours } from '../render/colours';
import { centreOnDesktop } from '../render/desktop';
import { BOE_HEIGHT, BOE_WIDTH, UiRect } from '../render/layout';
import { SheetStore } from '../render/sheets';
import {
  drawString, drawStringCentre, drawStringEllipsis, drawStringRight, wrapLines,
} from '../render/text';
import { dialogBackground, dialogTextIsWhite, tilePattern } from '../render/tiling';
import { MainStatus, Skill, Status } from '../universe/skills';
import type { ModalScreen } from './dialog';
import { drawPictAt } from './pict';

const SPELL_KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL';

/** OBoE's keyboard help (cast-spell.xml), with its key names filled in. */
const KEY_HELP = 'Keyboard: 1 2 3 4 5 6 to pick caster, ! @ # $ % ^ to select target, '
  + 'space for Other Spells, key by spell to cast spell. Alt-click spell name for description.';

/** The dialog fills nearly the whole 605x430 screen, as the original's does. */
const FRAME: UiRect = { top: 2, left: 2, bottom: 428, right: 603 };
/**
 * The scenario's dialog background (BoE's dark 5, Exile III's light one), and
 * the text colour that goes with it (dialog.cpp:406).
 */
let TEXT: string = Colours.WHITE;

// --- the six PC rows -------------------------------------------------------
const HEAD_Y = 60;
const ROW_Y = 79;
const ROW_PITCH = 24;
const X_CASTER_HEAD = 22;
const X_CASTER_BTN = 34;
const X_NAME = 88;
const X_TARGET_HEAD = 200;
const X_TARGET_BTN = 206;
const X_ARROW = 231;
const X_HP = 255;
const X_SP = 285;
const X_STATUS = 315;

/** The party rows' columns: a name box, the HP and SP boxes, where icons start. */
interface Cols {
  targetHead: number; target: number; name: number; nameW: number;
  hp: number; sp: number; numW: number; status: number;
}

/** OBoE's `cast-spell.xml`, as this port has always laid it out. */
const OBOE_COLS: Cols = {
  targetHead: X_TARGET_HEAD, target: X_TARGET_BTN, name: X_NAME, nameW: 112,
  hp: X_HP, sp: X_SP, numW: 26, status: X_STATUS,
};

/**
 * 1997's dialog 1098 (GAMEDLOG.RC), which Exile III ships unchanged: names at
 * 88 (122 wide), target buttons at 235, HP at 265 and SP at 304 (32 wide), all
 * 16 high. Status icons follow the SP box.
 */
const E3_COLS: Cols = {
  targetHead: 209, target: 235, name: 88, nameW: 122,
  hp: 265, sp: 304, numW: 32, status: 345,
};

/**
 * Exile III's `frame_dlog_rect`: 1997's two-pen box (DLOGTOOL.CPP:1677, the
 * top and left in one pen, the right and bottom in the other), inflated by 2
 * as `cd_frame_item(…, 2)` asks, in E3's sunken greys.
 */
const E3_FRAME_DARK = 'rgb(128,128,128)';
const E3_FRAME_LIGHT = 'rgb(255,255,255)';

/** 1997's keyboard help (item 78), Exile III's wording. */
const E3_HELP = "Keyboard: Type '1'-'6' to pick caster, Shift-'1' - '6' to select target, "
  + "'space' for Other Spells, key by spell to cast spell. Right-click spell button for description.";

// --- the spell grid --------------------------------------------------------
/**
 * The original's four columns sit at 10/162/326/486 in a dialog window 612px
 * wide — wider than this port's 605px canvas, because the C++ opens it as its
 * own OS window. Pulled in to a 146px pitch so the fourth column and the
 * buttons both fit; everything else keeps the original's numbers.
 */
const COL_X = [10, 156, 302, 448];
const GRID_HEAD_Y = 227;
const LED_Y = 247;
const LED_PITCH = 14;
const LED_W = 14;
const LED_H = 10;
const ROWS_PER_COL = 10;

// --- the buttons -----------------------------------------------------------
const BTN_Y = 394;
const BTN_H = 23;
// Likewise shifted left from the original's 371/479/549 to fit the canvas.
const X_OTHER = 355;
const X_CANCEL = 464;
const X_CAST = 534;
const W_LARGE = 102;
const W_REGULAR = 63;
const SMALL = 23;

/**
 * This dialog is the *screen*; the choosing itself is `SpellPick`, which the
 * replay driver drives too — it answers the same controls from the ids the C++
 * recorded, with no canvas anywhere.
 */
export { NO_TARGET, type CastChoice } from '../game/spellPick';

export class CastDialog implements ModalScreen {
  private readonly pick: SpellPick;

  /**
   * @param canChooseCaster false in combat, where the active PC casts and the
   *   caster buttons are inert (`pick_spell`'s `can_choose_caster`).
   */
  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    private session: GameSession,
    private type: Skill,
    readonly canChooseCaster: boolean,
  ) {
    this.pick = new SpellPick(session, type, canChooseCaster);
  }

  /**
   * The layout below is in 605×430 game-screen coordinates, so the whole
   * dialog is shifted to the middle of the desktop when it opens.
   */
  private readonly origin = centreOnDesktop(BOE_WIDTH, BOE_HEIGHT);

  /** Exile III's look (`backgrounds` = `exile3`): 1997's label colours. */
  private get e3(): boolean {
    return this.session.univ.scenario.featureFlags['backgrounds'] === 'exile3';
  }

  private get cols(): Cols { return this.e3 ? E3_COLS : OBOE_COLS; }

  /**
   * The `feedback` line (item 36): "Pick spell to cast." to begin with, then
   * whatever the last click earned (`pick_spell_select_led`,
   * `pick_spell_target`).
   */
  private feedback = 'Pick spell to cast.';

  get choice(): CastChoice { return this.pick.choice; }

  /** `finish_pick_spell`'s tail — see `SpellPick.finish`. */
  finish(): CastChoice | null { return this.pick.finish(); }

  private get caster(): number { return this.pick.caster; }

  private get target(): number { return this.pick.target; }

  private get spell(): Spell { return this.pick.spell; }

  private get page(): number { return this.pick.page; }

  /** The spell in grid slot `i` on the current page, or NONE for an empty slot. */
  private spellAt(i: number): Spell {
    return this.pick.spellAt(i);
  }

  private ledRect(i: number): UiRect {
    const col = Math.floor(i / ROWS_PER_COL);
    const row = i % ROWS_PER_COL;
    const left = FRAME.left + (COL_X[col] ?? 0) + 6;
    const top = FRAME.top + LED_Y + row * LED_PITCH;
    // The hit area covers the label as well as the lamp, as the original's does.
    return { left, top, right: left + 140, bottom: top + LED_PITCH };
  }

  private rowRects(i: number): { caster: UiRect; target: UiRect } {
    const top = FRAME.top + ROW_Y + i * ROW_PITCH;
    return {
      caster: {
        left: FRAME.left + X_CASTER_BTN, top,
        right: FRAME.left + X_CASTER_BTN + SMALL, bottom: top + SMALL,
      },
      target: {
        left: FRAME.left + this.cols.target, top,
        right: FRAME.left + this.cols.target + SMALL, bottom: top + SMALL,
      },
    };
  }

  private buttonRects(): { other: UiRect; cancel: UiRect; cast: UiRect } {
    const top = FRAME.top + BTN_Y;
    const mk = (x: number, w: number): UiRect =>
      ({ left: FRAME.left + x, top, right: FRAME.left + x + w, bottom: top + BTN_H });
    return {
      other: mk(X_OTHER, W_LARGE),
      cancel: mk(X_CANCEL, W_REGULAR),
      cast: mk(X_CAST, W_REGULAR),
    };
  }

  /** Whether this spell needs a party member picked before it can be cast. */
  private needsTarget(spell: Spell): boolean {
    return this.pick.needsTarget(spell);
  }

  // ------------------------------------------------------------------ input

  /**
   * A control pressed, by the C++'s id — by a click or by its key. Work out
   * what it means for the sound and the feedback line, and hand the id to
   * `SpellPick`.
   */
  private press(id: string): string | null {
    const sound = this.session.sound;
    // `cd_press_button` (DLOGTOOL.CPP:1498/1514): an LED clicks with 34,
    // anything else with 37.
    const led = id.startsWith('spell');
    sound?.play(led ? 34 : 37);
    const slot = led ? this.spellAt(Number(id.slice(5)) - 1) : Spell.NONE;
    const lit = slot !== Spell.NONE && this.castable(slot);
    const action = this.pick.click(id);
    if (led) {
      if (!lit) this.feedback = ' Spell not available.';
      else if (this.needsTarget(slot) && this.target === NO_TARGET) this.feedback = ' Now pick a target.';
      else this.feedback = '';
    } else if (id.startsWith('target')) {
      this.feedback = ' Target selected.';
    }
    // `pick_spell_event_filter`: a spell that wants a target and hasn't one
    // says " Now pick a target." with `force_play_sound(45)` (PARTY.CPP).
    if (lit && this.needsTarget(slot) && this.target === NO_TARGET) sound?.play(45);
    return action === 'stay' ? null : action;
  }

  onClick(atX: number, atY: number): string | null {
    const x = atX - this.origin.x;
    const y = atY - this.origin.y;
    const btns = this.buttonRects();
    const inside = (r: UiRect): boolean =>
      x >= r.left && x < r.right && y >= r.top && y < r.bottom;

    const hit = (id: string): string | null => this.press(id);
    if (inside(btns.cancel)) return hit('cancel');
    if (inside(btns.cast)) return hit('cast');
    if (inside(btns.other)) return hit('other');
    for (let i = 0; i < 6; i++) {
      const { caster, target } = this.rowRects(i);
      if (inside(caster)) return hit(`caster${i + 1}`);
      if (inside(target)) return hit(`target${i + 1}`);
    }
    for (let i = 0; i < SPELL_SLOTS; i++) {
      if (inside(this.ledRect(i))) return hit(`spell${i + 1}`);
    }
    return null;
  }

  onKey(key: string): string | null {
    if (key === 'Escape') return 'cancel';
    if (key === 'Enter') return this.spell === Spell.NONE ? null : 'cast';
    if (key === ' ') {
      this.pick.flipPage();
      return null;
    }
    // 1-6 pick the caster; shift+1-6 pick the target, as the def-keys say.
    const digit = '123456'.indexOf(key);
    if (digit >= 0) return this.press(`caster${digit + 1}`);
    // Each LED's `def-key`: a-z, then A-L (1997's `97 + i`, `65 + i - 26`).
    const letter = SPELL_KEYS.indexOf(key);
    if (letter >= 0 && letter < SPELL_SLOTS && this.spellAt(letter) !== Spell.NONE) {
      return this.press(`spell${letter + 1}`);
    }
    const shifted = '!@#$%^'.indexOf(key);
    if (shifted >= 0) return this.press(`target${shifted + 1}`);
    return null;
  }

  private castable(spell: Spell): boolean {
    return this.pick.castable(spell);
  }

  // ------------------------------------------------------------------- draw

  draw(): void {
    this.ctx.save();
    this.ctx.translate(this.origin.x, this.origin.y);
    this.drawInGameCoords();
    this.ctx.restore();
  }

  private drawInGameCoords(): void {
    const { ctx } = this;
    TEXT = dialogTextIsWhite() ? Colours.WHITE : Colours.BLACK;
    // Exile III's is a window with a black edge, like the port's other
    // dialogs: the 2px round the pattern.
    if (this.e3) {
      ctx.fillStyle = Colours.BLACK;
      ctx.fillRect(0, 0, BOE_WIDTH, BOE_HEIGHT);
    }
    const pats = this.store.get('pixpats');
    if (pats) tilePattern(ctx, pats, dialogBackground(), FRAME);
    else {
      ctx.fillStyle = Colours.BLACK;
      ctx.fillRect(FRAME.left, FRAME.top, FRAME.right - FRAME.left, FRAME.bottom - FRAME.top);
    }
    if (!this.e3) {
      ctx.strokeStyle = Colours.WHITE;
      ctx.lineWidth = 1;
      ctx.strokeRect(FRAME.left + 0.5, FRAME.top + 0.5,
        FRAME.right - FRAME.left - 1, FRAME.bottom - FRAME.top - 1);
    }

    const at = (x: number, y: number, w = 120, h = 16): UiRect =>
      ({ left: FRAME.left + x, top: FRAME.top + y, right: FRAME.left + x + w, bottom: FRAME.top + y + h });

    // `pic`: dialog picture 14 or 15 by the book (boe.party.cpp:2247). The
    // definition's `5_712` is 1997's, which never changed it; Exile III sets
    // 714 + the book (exile3.c:54677), as OBoE does.
    const pic = 14 + (this.type === Skill.PRIEST_SPELLS ? 1 : 0);
    drawPictAt(ctx, this.store, 'dlog', pic, FRAME.left + 8, FRAME.top + 8);

    const { cols } = this;
    drawString(ctx, at(54, 6, 140, 18), 'Select a Spell:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_CASTER_HEAD, HEAD_Y, 70), 'Caster:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(cols.targetHead, HEAD_Y, 70), 'Target:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(cols.hp, HEAD_Y, 30), 'HP:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(cols.sp, HEAD_Y, 30), 'SP:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(cols.status, HEAD_Y, 80), 'Status:', { size: 12, font: 'bold', colour: TEXT });

    // The keyboard help (item 78, 290 wide at 202,0) and the feedback line
    // (item 36, framed, at 30,400).
    const help = this.e3 ? E3_HELP : KEY_HELP;
    const helpStyle = { size: 10, font: 'bold' as const, colour: TEXT };
    let helpY = 4;
    for (const line of wrapLines(ctx, help, 290 - 8, helpStyle)) {
      drawString(ctx, at(202 + 4, helpY, 290), line, helpStyle);
      helpY += 12;
    }
    const fb = at(30, 400, 186);
    this.frameBox(fb);
    drawString(ctx, { ...fb, left: fb.left + 3, top: fb.top + 2 }, this.feedback,
      { size: 10, font: 'bold', colour: TEXT });

    this.drawParty(at);
    this.drawGrid(at);
    this.drawButtons();
  }

  private drawParty(at: (x: number, y: number, w?: number, h?: number) => UiRect): void {
    const { ctx } = this;
    const icons = this.store.get('staticons');
    for (let i = 0; i < 6; i++) {
      const pc = this.session.univ.party.pcs[i];
      if (!pc || pc.mainStatus === MainStatus.ABSENT) continue;
      const y = ROW_Y + i * ROW_PITCH;
      const rects = this.rowRects(i);
      const canCast = pcCanCastType(this.session, pc, this.type) === CastStatus.OK;

      // Caster button: lit for the chosen caster, greyed where they can't cast.
      this.drawSmallButton(rects.caster, String(i + 1),
        this.caster === i, !canCast || !this.canChooseCaster);
      // Exile III greys nobody and shows the caster's name in red (its
      // screen; 1997's frames it); OBoE greys whoever can't cast.
      const nameColour = this.e3 ? (this.caster === i ? Colours.RED : TEXT)
        : canCast ? TEXT : Colours.GREY;
      const { cols } = this;
      const nameBox = at(cols.name, y + 5, cols.nameW);
      if (this.e3) {
        // Every name, HP and SP sits in a box (`cd_text_frame` flag 1), and
        // flag 11 — the caster's name, the target's HP and SP — makes the
        // text red too (DLOGTOOL.CPP:1254). That red is the target's marker,
        // where OBoE draws an arrow.
        this.frameBox(nameBox);
        drawStringEllipsis(ctx, { ...nameBox, left: nameBox.left + 3, top: nameBox.top + 2 },
          pc.name, { size: 12, colour: nameColour });
      } else {
        drawStringEllipsis(ctx, at(cols.name, y + 4, cols.nameW), pc.name, { size: 12, colour: nameColour });
      }

      // Target button and the green arrow that marks the pick.
      this.drawSmallButton(rects.target, String(i + 1), this.target === i, false);
      if (this.target === i && !this.e3) {
        drawString(ctx, at(X_ARROW, y + 4, 24), '->', { size: 12, colour: Colours.GREEN });
      }

      if (this.e3) {
        const targeted = this.target === i;
        const alive = pc.mainStatus === MainStatus.ALIVE;
        [[cols.hp, pc.curHealth], [cols.sp, pc.curSp]].forEach(([x, n]) => {
          const box = at(x!, y + 6, cols.numW);
          this.frameBox(box);
          if (alive) drawString(ctx, { ...box, left: box.left + 3, top: box.top + 2 }, String(n),
            { size: 12, colour: targeted ? Colours.RED : TEXT });
        });
      }
      if (pc.mainStatus === MainStatus.ALIVE) {
        if (!this.e3) {
          drawStringRight(ctx, at(cols.hp, y + 4, cols.numW), String(pc.curHealth),
            { size: 12, colour: Colours.RED });
          drawStringRight(ctx, at(cols.sp, y + 4, cols.numW), String(pc.curSp),
            { size: 12, colour: Colours.BLUE });
        }
        // The same status strip the party panel draws, at the same 13px pitch.
        if (icons) {
          let left = FRAME.left + cols.status;
          for (const key of Object.keys(STATUS_ICONS)) {
            const which = Number(key) as Status;
            const code = statusIconFor(which, pc.status[which] ?? 0);
            if (code < 0) continue;
            const from = statIconRect(code);
            ctx.drawImage(icons, from.left, from.top, 12, 12,
              left, FRAME.top + y + 3, 12, 12);
            left += 13;
          }
        }
      } else {
        // The dialog says so in place of the status icons (`dead1`..`dead6`).
        drawString(ctx, at(this.e3 ? cols.status : cols.hp, y + 4, 90), 'Dead', { size: 12, colour: Colours.GREY });
      }
    }
  }

  private drawGrid(at: (x: number, y: number, w?: number, h?: number) => UiRect): void {
    const { ctx } = this;
    const leds = this.store.get('dlogbtnled');
    const headers = this.page === 0
      ? ['Level 1:', 'Level 2:', 'Level 3:', 'Level 4:']
      : ['Level 5:', 'Level 6:', 'Level 7:', ''];
    headers.forEach((label, col) => {
      if (!label) return;
      drawString(ctx, at((COL_X[col] ?? 0), GRID_HEAD_Y, 100), label,
        { size: 12, font: 'bold', colour: TEXT });
    });

    for (let i = 0; i < 38; i++) {
      const spell = this.spellAt(i);
      if (spell === Spell.NONE) continue;
      const rect = this.ledRect(i);
      const usable = this.castable(spell);
      // eLedState is `{led_green = 0, led_red, led_off}`, and led.hpp:18 spells
      // out what they mean *in this dialog*: red is "you can cast it", green is
      // "this is the one you picked", off is "you can't".
      const state = this.spell === spell ? 0 : usable ? 1 : 2;
      if (leds) {
        ctx.drawImage(leds, state * LED_W, 0, LED_W, LED_H,
          rect.left, rect.top + 1, LED_W, LED_H);
      }
      // Simulacrum's cost depends on the creature, so the C++ shows '?'.
      const rawCost = SPELLS[spell]?.cost ?? 0;
      const cost = rawCost < 0 ? '?' : String(rawCost);
      drawString(ctx, {
        left: rect.left + LED_W + 3, top: rect.top - 1,
        right: rect.right, bottom: rect.top + LED_PITCH,
        // 1997's and Exile III's label is "name key cost" (PARTY.CPP's
        // `put_spell_list`); OBoE's is "name (cost)".
      }, this.e3 ? `${spellName(spell)} ${SPELL_KEYS[i]} ${cost}` : `${spellName(spell)} (${cost})`, {
        // OBoE's DISABLED_COLOUR; 1997 and Exile III leave the label alone
        // and let the LED say it.
        size: 10, font: 'bold', colour: usable || this.e3 ? TEXT : Colours.GREY,
      });
    }
  }

  private drawButtons(): void {
    const { ctx } = this;
    const rects = this.buttonRects();
    const lg = this.store.get('dlogbtnlg');
    const med = this.store.get('dlogbtnmed');
    const label = (r: UiRect, text: string): void => {
      drawStringCentre(ctx, { ...r, top: r.top + 4 }, text,
        { size: 12, colour: Colours.BLACK });
    };
    if (lg) ctx.drawImage(lg, 0, 0, W_LARGE, BTN_H, rects.other.left, rects.other.top, W_LARGE, BTN_H);
    if (med) {
      ctx.drawImage(med, 0, 0, W_REGULAR, BTN_H,
        rects.cancel.left, rects.cancel.top, W_REGULAR, BTN_H);
      ctx.drawImage(med, 0, 0, W_REGULAR, BTN_H,
        rects.cast.left, rects.cast.top, W_REGULAR, BTN_H);
    }
    label(rects.other, 'Other Spells');
    label(rects.cancel, 'Cancel');
    label(rects.cast, 'Cast');
  }

  /**
   * A framed text item: OBoE's `framed` style (as XmlDialog draws it), or
   * Exile III's sunken box. Both sit 2px outside the item's rect.
   */
  private frameBox(rect: UiRect): void {
    const { ctx } = this;
    const r = { top: rect.top - 2, left: rect.left - 2, bottom: rect.bottom + 2, right: rect.right + 2 };
    const dark = this.e3 ? E3_FRAME_DARK : 'rgb(48,48,48)';
    const light = this.e3 ? E3_FRAME_LIGHT : 'rgb(224,224,224)';
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark;
    ctx.beginPath();
    ctx.moveTo(r.left + 0.5, r.bottom - 0.5);
    ctx.lineTo(r.left + 0.5, r.top + 0.5);
    ctx.lineTo(r.right - 0.5, r.top + 0.5);
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.beginPath();
    ctx.moveTo(r.right - 0.5, r.top + 1.5);
    ctx.lineTo(r.right - 0.5, r.bottom - 0.5);
    ctx.lineTo(r.left + 1.5, r.bottom - 0.5);
    ctx.stroke();
  }

  /** A 23x23 button from dlogbtnsm.png; frame 1 is the pressed state. */
  private drawSmallButton(rect: UiRect, key: string, lit: boolean, dim: boolean): void {
    const { ctx } = this;
    const sheet = this.store.get('dlogbtnsm');
    if (sheet) {
      ctx.drawImage(sheet, lit ? SMALL : 0, 0, SMALL, SMALL,
        rect.left, rect.top, SMALL, SMALL);
    }
    drawStringCentre(ctx, { ...rect, top: rect.top + 4 }, key,
      { size: 12, colour: dim ? Colours.GREY : Colours.BLACK });
  }
}
