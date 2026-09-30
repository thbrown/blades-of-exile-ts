/**
 * The party and inventory panels blown up for a finger. Their own buttons
 * are a few pixels wide at a phone's scale, so a tap on either panel (with
 * touch controls on) opens it again over the game, as large as the screen
 * allows, with a ✕ to close it.
 *
 * It is only a picture, like the other touch strips: every redraw copies the
 * panel's pixels from the game canvas, and a tap is handed back to the host
 * in game-screen coordinates, which does exactly what a click on the panel
 * there does.
 */

import type { UiRect } from '../render/layout';

export interface TouchSheetHost {
  /** The panel to show, on the game screen; null when none should show. */
  panel(): UiRect | null;
  /** The game canvas, and where the game screen sits on it. */
  source(): { canvas: HTMLCanvasElement; x: number; y: number };
  /** A tap on the panel, in game-screen coordinates. */
  tap(x: number, y: number): void;
  close(): void;
}

/** Room kept clear either side of the panel, so ✕ never covers it. */
const CLOSE_ROOM = 56;
const MARGIN = 6;

export class TouchSheet {
  private readonly root: HTMLElement;
  private readonly view: HTMLCanvasElement;
  private shown: UiRect | null = null;

  constructor(private readonly host: TouchSheetHost) {
    this.root = document.createElement('div');
    this.root.id = 'touch-sheet';
    this.root.hidden = true;
    // A tap here is the sheet's; the canvas under it mustn't take it as well.
    this.root.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    // Anywhere off the panel closes it, as ✕ does.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.host.close();
    });

    this.view = document.createElement('canvas');
    this.view.className = 'sheet-panel';
    this.view.addEventListener('click', (ev) => {
      const panel = this.shown;
      if (!panel) return;
      const box = this.view.getBoundingClientRect();
      const x = panel.left + Math.floor((ev.clientX - box.left) * this.view.width / box.width);
      const y = panel.top + Math.floor((ev.clientY - box.top) * this.view.height / box.height);
      this.host.tap(x, y);
    });
    this.view.addEventListener('contextmenu', (ev) => ev.preventDefault());

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-close';
    close.tabIndex = -1;
    close.textContent = '✕';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.host.close());

    this.root.append(this.view, close);
    document.body.append(this.root);
  }

  sync(on: boolean): void {
    const panel = on ? this.host.panel() : null;
    this.root.hidden = panel === null;
    this.shown = panel;
    if (panel === null) return;
    const w = panel.right - panel.left;
    const h = panel.bottom - panel.top;
    if (this.view.width !== w) this.view.width = w;
    if (this.view.height !== h) this.view.height = h;
    const { canvas, x, y } = this.host.source();
    const ctx = this.view.getContext('2d');
    ctx?.drawImage(canvas, x + panel.left, y + panel.top, w, h, 0, 0, w, h);

    // As large as fits, keeping the panel's shape.
    const box = this.root.getBoundingClientRect();
    const scale = Math.max(0, Math.min((box.width - 2 * CLOSE_ROOM) / w, (box.height - 2 * MARGIN) / h));
    this.view.style.width = `${Math.floor(w * scale)}px`;
    this.view.style.height = `${Math.floor(h * scale)}px`;
  }
}
