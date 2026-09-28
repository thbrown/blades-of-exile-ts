/**
 * The artificial title bars: `DialogHost` makes room for a window's caption
 * when it opens, and a drag on the caption moves the window rather than
 * clicking it.
 */
import { describe, expect, it } from 'vitest';
import { DialogHost, type ModalScreen } from '../src/dialogs/dialog';
import { desktop } from '../src/render/desktop';
import { shiftRect, type UiRect } from '../src/render/layout';
import { SheetStore } from '../src/render/sheets';
import { tilePattern } from '../src/render/tiling';
import { CAPTION_H } from '../src/render/windowChrome';

function fakeCtx(drawn: { x: number; y: number }[] = []): CanvasRenderingContext2D {
  const noop = (): void => {};
  return {
    font: '', fillStyle: '', strokeStyle: '', textBaseline: '', imageSmoothingEnabled: true,
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText: noop, fillRect: noop, drawImage: (_i: unknown, _sx: number, _sy: number, _sw: number, _sh: number,
      x: number, y: number) => { drawn.push({ x, y }); },
    save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D;
}

/** A window at `at`, recording the clicks that reach it. */
function fakeWindow(at: UiRect): ModalScreen & { clicks: number } {
  let frame = at;
  return {
    clicks: 0,
    draw() {},
    onClick() { this.clicks++; return null; },
    onKey() { return null; },
    bounds: () => frame,
    moveBy: (dx, dy) => { frame = shiftRect(frame, dx, dy); },
  };
}

describe('window captions', () => {
  const room = { w: 800, h: 600 };

  it('opens a window half a caption lower, and drags it by the caption', () => {
    Object.assign(desktop, room);
    const host = new DialogHost(fakeCtx(), new SheetStore(), () => {});
    host.chrome = () => ({ flavour: 'boe', title: 'Blades of Exile' });
    const win = fakeWindow({ left: 100, top: 100, right: 300, bottom: 200 });
    void host.runScreen(win);
    host.draw();
    expect(win.bounds!().top).toBe(100 + CAPTION_H / 2);

    const top = win.bounds!().top;
    // A press on the caption is a drag, not a click on the window.
    expect(host.handleClick(150, top - 5)).toBe(true);
    expect(win.clicks).toBe(0);
    expect(host.handleDrag(190, top + 25)).toBe(true);
    host.handleRelease();
    expect(win.bounds!()).toMatchObject({ left: 140, top: top + 30 });
    // Released, a move is nobody's.
    expect(host.handleDrag(0, 0)).toBe(false);
    // And a press inside is still a click.
    host.handleClick(150, top + 40);
    expect(win.clicks).toBe(1);
  });

  it('keeps the caption on the desktop while dragging', () => {
    Object.assign(desktop, room);
    const host = new DialogHost(fakeCtx(), new SheetStore(), () => {});
    host.chrome = () => ({ flavour: 'exile3', title: 'Exile III: Ruined World' });
    const win = fakeWindow({ left: 100, top: 100, right: 300, bottom: 200 });
    void host.runScreen(win);
    host.draw();
    const top = win.bounds!().top;
    host.handleClick(150, top - 5);
    host.handleDrag(150, -500);
    expect(win.bounds!().top).toBe(CAPTION_H);
  });

  it('draws no caption and moves nothing without chrome', () => {
    Object.assign(desktop, room);
    const host = new DialogHost(fakeCtx(), new SheetStore(), () => {});
    const win = fakeWindow({ left: 100, top: 100, right: 300, bottom: 200 });
    void host.runScreen(win);
    host.draw();
    host.handleClick(150, 95);
    expect(win.bounds!().top).toBe(100);
  });

  it("tiles a window's pattern from the window's own corner", () => {
    const drawn: { x: number; y: number }[] = [];
    const dest = { left: 70, top: 45, right: 100, bottom: 60 };
    tilePattern(fakeCtx(drawn), {} as CanvasImageSource, 0, dest, { x: 70, y: 45 });
    expect(drawn[0]).toEqual({ x: 70, y: 45 });
  });
});
