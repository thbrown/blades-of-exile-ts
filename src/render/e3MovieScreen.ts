/**
 * Exile III's intro movie on screen (`game/e3Movie.ts` is the movie itself).
 *
 * E3 keeps two pictures, and so does this: the terrain gworld that
 * `draw_terrain` paints off screen (279 × 351, the terrain view with its
 * border), and what is on screen, which only changes when something copies to
 * it. The difference shows: the second half of an explosion repaints the
 * gworld but copies only the explosions' own squares, so a creature put down
 * between the halves appears inside the flash before the rest of the frame.
 *
 * It is a modal screen over the whole desktop, as E3's `FUN_1098_0e09` takes
 * over its window: the background, the picture in the middle (30 pixels above
 * centre, as there), and "Click mouse to continue." in the bottom right. A
 * click or Escape skips it, and the touch overlay has a Skip button.
 */

import type { ModalScreen, TouchView } from '../dialogs/dialog';
import type { Scenario } from '../data/scenario';
import {
  E3Movie, MovieSkipped, TER_SCRN,
  type MovieGfx, type MovieRan, type MovieSprite, type MovieStage, type Rect,
} from '../game/e3Movie';
import { Colours } from './colours';
import { desktop } from './desktop';
import { SFX_SPRITES } from './fieldPics';
import { itemGraphic } from './itemPics';
import { PANEL_IMAGES, TER_INSET_X, TER_INSET_Y, TER_VIEW_CENTER, TER_VIEW_TILES } from './layout';
import { monsterDims, monsterGraphic } from './monsterPics';
import { pcGraphic } from './pcPics';
import { calcRect, type SheetStore, TILE_H, TILE_W } from './sheets';
import { terrainGraphic } from './terrainPics';
import { drawString, drawStringCentre } from './text';
import { FieldType } from '../data/fields';

/** `sfx` bits, as `make_sfx` writes them, to the decal each one draws. */
const SFX_BITS: [number, FieldType][] = [
  [1, FieldType.SFX_SMALL_BLOOD], [2, FieldType.SFX_MEDIUM_BLOOD], [4, FieldType.SFX_LARGE_BLOOD],
  [8, FieldType.SFX_SMALL_SLIME], [16, FieldType.SFX_LARGE_SLIME], [32, FieldType.SFX_ASH],
  [64, FieldType.SFX_BONES], [128, FieldType.SFX_RUBBLE],
];

export interface E3MovieHost {
  /** `play_sound`. */
  sound(n: number): void;
  /** Something changed on screen: draw the desktop again. */
  repaint(): void;
  /** The pattern behind everything, over `rect` of the desktop. */
  background(ctx: CanvasRenderingContext2D, rect: Rect): void;
  /** The movie's dice; its own, not the game's. */
  ran: MovieRan;
  /** Whether to say "Click mouse to continue." — not on touch, where the overlay has Skip. */
  prompt(): boolean;
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas for the movie');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export class E3MovieScreen implements ModalScreen, MovieGfx {
  /** For the scripts that drive the UI, to know the movie from a dialog. */
  readonly kind = 'e3-movie';
  private readonly gworld = canvas(TER_SCRN.w, TER_SCRN.h);
  private readonly shown = canvas(TER_SCRN.w, TER_SCRN.h);
  private readonly movie: E3Movie;
  private skipped = false;
  private readonly waiting = new Set<() => void>();
  private repaintQueued = false;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly store: SheetStore,
    scen: Scenario,
    private readonly host: E3MovieHost,
  ) {
    this.movie = new E3Movie(scen, this, host.ran);
    this.shown.fillStyle = Colours.BLACK;
    this.shown.fillRect(0, 0, TER_SCRN.w, TER_SCRN.h);
  }

  /** Play the movie; resolves when it ends or is skipped. */
  async play(): Promise<void> {
    try {
      await this.movie.play();
    } catch (e) {
      if (!(e instanceof MovieSkipped)) throw e;
    }
  }

  /** Stop wherever it is: every wait, now and later, throws `MovieSkipped`. */
  skip(): void {
    this.skipped = true;
    for (const stop of this.waiting) stop();
    this.waiting.clear();
  }

  // ----------------------------------------------------------- MovieGfx

  wait(ms: number): Promise<void> {
    if (this.skipped) return Promise.reject(new MovieSkipped());
    return new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        clearTimeout(timer);
        reject(new MovieSkipped());
      };
      const timer = setTimeout(() => {
        this.waiting.delete(stop);
        resolve();
      }, ms);
      this.waiting.add(stop);
    });
  }

  now(): number {
    return performance.now();
  }

  sound(n: number): void {
    if (!this.skipped) this.host.sound(n);
  }

  showTerrain(): void {
    this.shown.drawImage(this.gworld.canvas, 0, 0);
    this.queueRepaint();
  }

  showSprites(sprites: MovieSprite[], only?: { left: number; top: number }[]): void {
    if (only) {
      for (const r of only) this.shown.drawImage(this.gworld.canvas, r.left, r.top, TILE_W, TILE_H, r.left, r.top, TILE_W, TILE_H);
    } else {
      this.shown.drawImage(this.gworld.canvas, 0, 0);
    }
    for (const s of sprites) {
      const img = this.store.get(s.sheet);
      if (!img) continue;
      const g = this.shown;
      g.save();
      if (s.clip) {
        g.beginPath();
        g.rect(s.clip.left, s.clip.top, s.clip.right - s.clip.left, s.clip.bottom - s.clip.top);
        g.clip();
      }
      g.drawImage(img, s.sx, s.sy, s.w, s.h, s.x, s.y, s.w, s.h);
      g.restore();
    }
    this.queueRepaint();
  }

  /**
   * `draw_terrain` with `cartoon_happening` (GRAPHICS.CPP): every square is
   * drawn, seen or not, with no trim and no light; then the decals, the items,
   * the creatures on screen and the PCs; and last the caption, which a draw
   * shows once and clears (`1050:47a5`).
   */
  paintTerrain(stage: MovieStage): void {
    const g = this.gworld;
    const panel = this.store.get(PANEL_IMAGES.terView);
    if (panel) g.drawImage(panel, 0, 0);
    else {
      g.fillStyle = Colours.BLACK;
      g.fillRect(0, 0, TER_SCRN.w, TER_SCRN.h);
    }
    const c = stage.center;
    const at = (q: number, r: number): { x: number; y: number } =>
      ({ x: TER_INSET_X + q * TILE_W, y: TER_INSET_Y + r * TILE_H });
    const onView = (q: number, r: number): boolean =>
      q >= 0 && r >= 0 && q < TER_VIEW_TILES && r < TER_VIEW_TILES;
    const blit = (sheet: string, rect: { left: number; top: number; width: number; height: number },
      x: number, y: number): void => {
      const img = this.store.get(sheet);
      if (img) g.drawImage(img, rect.left, rect.top, rect.width, rect.height, x, y, TILE_W, TILE_H);
    };
    // Terrain gets the movie's frame for its animation; E3's timer runs
    // `anim_ticks` on in a cartoon instead of holding it at 0.
    const anim = Math.max(0, stage.frame);
    const fields = this.store.get('fields');
    for (let q = 0; q < TER_VIEW_TILES; q++)
      for (let r = 0; r < TER_VIEW_TILES; r++) {
        const x = c.x + q - TER_VIEW_CENTER;
        const y = c.y + r - TER_VIEW_CENTER;
        const p = at(q, r);
        if (x < 0 || y < 0 || x >= 64 || y >= 64) {
          g.fillStyle = Colours.BLACK;
          g.fillRect(p.x, p.y, TILE_W, TILE_H);
          continue;
        }
        const type = stage.terrainType(stage.terrain[x]![y]!);
        const tg = type ? terrainGraphic(type.picture, anim) : null;
        if (tg) blit(tg.sheetName, tg.rect, p.x, p.y);
        const bits = stage.sfx[x]![y]!;
        if (bits !== 0 && fields) {
          for (const [bit, field] of SFX_BITS) {
            if ((bits & bit) === 0) continue;
            const sprite = SFX_SPRITES.find(([f]) => f === field)?.[1];
            if (!sprite) continue;
            const src = calcRect(sprite.col, sprite.row);
            g.drawImage(fields, src.left, src.top, src.width, src.height, p.x, p.y, TILE_W, TILE_H);
          }
        }
      }
    for (const item of stage.items) {
      const q = item.loc.x - c.x + TER_VIEW_CENTER;
      const r = item.loc.y - c.y + TER_VIEW_CENTER;
      if (!onView(q, r)) continue;
      const ig = itemGraphic(item.graphic);
      const img = ig && this.store.get(ig.sheetName);
      if (!ig || !img) continue;
      const p = at(q, r);
      g.drawImage(img, ig.rect.left, ig.rect.top, ig.rect.width, ig.rect.height,
        p.x + ig.inset.x, p.y + ig.inset.y, TILE_W - 2 * ig.inset.x, TILE_H - 2 * ig.inset.y);
    }
    // Creatures: any on screen, seen or not (`point_onscreen` for a cartoon).
    stage.creatures.forEach((m, i) => {
      if (!m.active) return;
      if (Math.abs(c.x - m.loc.x) > 4 || Math.abs(c.y - m.loc.y) > 4) return;
      const q = m.loc.x - c.x + TER_VIEW_CENTER;
      const r = m.loc.y - c.y + TER_VIEW_CENTER;
      const { w, h } = m.picture >= 1000 ? { w: m.width, h: m.height } : monsterDims(m.picture);
      const mode = (m.direction >= 4 ? 1 : 0) + (stage.posing === 100 + i ? 10 : 0);
      for (let part = 0; part < w * h; part++) {
        const pq = q + (part % w);
        const pr = r + Math.floor(part / w);
        if (!onView(pq, pr)) continue;
        const mg = monsterGraphic(m.picture, mode, part, w * h);
        if (mg) blit(mg.sheetName, mg.rect, at(pq, pr).x, at(pq, pr).y);
      }
    });
    stage.pcs.forEach((pc, i) => {
      const q = pc.loc.x - c.x + TER_VIEW_CENTER;
      const r = pc.loc.y - c.y + TER_VIEW_CENTER;
      if (!onView(q, r)) return;
      const pg = pcGraphic(pc.graphic, pc.direction, stage.posing === i);
      if (pg) blit(pg.sheetName, pg.rect, at(q, r).x, at(q, r).y);
    });
    if (stage.caption) {
      this.drawCaption(stage.caption.text, stage.caption.at, c);
      stage.caption = null;
    }
  }

  /**
   * `1050:48bd`: a 90 × 10 box centred over the speaker's square and 10
   * pixels into it, the line centred in it (DT_CENTER, unclipped), in black
   * ringed with white — drawn once in black, then four times in white a pixel
   * off each way round (−1, −1), then in black there.
   */
  private drawCaption(text: string, at: { x: number; y: number }, c: { x: number; y: number }): void {
    const left = (at.x - c.x + 4) * 28 + 13 - 30;
    const top = (at.y - c.y + 4) * 36 + 3;
    // Mode 1 takes 6 off either side before centring.
    const box = { left: left + 6, top, right: left + 90 - 6, bottom: top + 10 };
    const style = { font: 'bold' as const, size: 10 };
    const put = (dx: number, dy: number, colour: string): void => drawStringCentre(this.gworld,
      { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy },
      text, { ...style, colour });
    put(0, 0, Colours.BLACK);
    for (const [dx, dy] of [[-2, -1], [0, -1], [-1, -2], [-1, 0]] as const) put(dx, dy, Colours.WHITE);
    put(-1, -1, Colours.BLACK);
  }

  private queueRepaint(): void {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    requestAnimationFrame(() => {
      this.repaintQueued = false;
      this.host.repaint();
    });
  }

  // -------------------------------------------------------- ModalScreen

  /** Where the picture sits: centred, and 30 pixels up (`0e09`'s `- 0x1e`). */
  private origin(): { x: number; y: number } {
    return {
      x: Math.floor((desktop.w - TER_SCRN.w) / 2),
      y: Math.max(0, Math.floor((desktop.h - TER_SCRN.h) / 2) - 30),
    };
  }

  draw(): void {
    const { ctx } = this;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.host.background(ctx, { left: 0, top: 0, right: desktop.w, bottom: desktop.h });
    const o = this.origin();
    ctx.drawImage(this.shown.canvas, o.x, o.y);
    // `FUN_10d0_550f("Click mouse to continue.", right - 150, bottom - 20)`.
    if (this.host.prompt()) drawString(ctx, { left: desktop.w - 150, top: desktop.h - 20, right: desktop.w, bottom: desktop.h },
      'Click mouse to continue.', { colour: Colours.WHITE });
    ctx.restore();
  }

  onClick(): string | null {
    return 'skip';
  }

  onKey(key: string): string | null {
    return key === 'Escape' ? 'skip' : null;
  }

  touchView(): TouchView {
    return { right: [{ name: 'skip', label: 'Skip' }] };
  }

  touchPress(name: string): string | null {
    return name === 'skip' ? 'skip' : null;
  }
}
