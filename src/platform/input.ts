/**
 * Keyboard/mouse routing. Stands in for the SFML event loop in boe.main.cpp,
 * with a dialog gate that will suppress game input once modal dialogs exist
 * (the async replacement for the C++ ASYNCIFY blocking dialogs).
 */

import { Direction } from '../core/location';

/** Arrow keys plus the numeric keypad, as the original accepts both. */
export const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: Direction.N,
  ArrowDown: Direction.S,
  ArrowLeft: Direction.W,
  ArrowRight: Direction.E,
  Home: Direction.NW,
  PageUp: Direction.NE,
  End: Direction.SW,
  PageDown: Direction.SE,
  Numpad8: Direction.N,
  Numpad9: Direction.NE,
  Numpad6: Direction.E,
  Numpad3: Direction.SE,
  Numpad2: Direction.S,
  Numpad1: Direction.SW,
  Numpad4: Direction.W,
  Numpad7: Direction.NW,
};

export interface InputHandlers {
  onMove(dir: Direction, key?: string): void;
  /**
   * `right` is the right button: a quick look on the terrain view. `alt` and
   * `ctrl` are the keys held, which a dialog may read (`ClickMods`).
   */
  onClick(x: number, y: number, right?: boolean, held?: { alt: boolean; ctrl: boolean }): void;
  onKey(key: string, event: KeyboardEvent): void;
  /**
   * Where the pointer is, in canvas coordinates, or null once it leaves. The
   * targeting overlay needs this: `draw_targeting_line` reads
   * `mouse_window_coords()` every frame, which is how the spell's footprint
   * follows the cursor before you commit to a square.
   */
  onHover?(x: number, y: number): void;
  onHoverEnd?(): void;
  /**
   * Pointer movement and release anywhere on the page, not just over the
   * canvas — what dragging the automap window needs. The exile-wasm build does
   * the same thing, routing every mouse event to the map handler while a drag
   * is in progress "so dragging stays smooth even when the cursor moves
   * outside the map bounds" (boe.main.cpp:1524).
   */
  onDrag?(x: number, y: number): void;
  onRelease?(x: number, y: number): void;
  /**
   * A finger has started to slide from (x, y). Start dragging whatever is
   * there that drags — the map window, a dialog's caption — and say whether
   * anything did; `onDrag` and `onRelease` then follow the finger. A mouse
   * needs none of this: its press is a click the moment it goes down, and
   * the click is what starts the drag. A finger's press only becomes one
   * when it lifts, which is too late.
   */
  onDragStart?(x: number, y: number): boolean;
  /**
   * The mouse wheel or a touchpad over the canvas, in notches (positive
   * down, and 0 while a touchpad's small moves add up to one). True if
   * something there scrolls, so the page doesn't.
   */
  onWheel?(x: number, y: number, notches: number): boolean;
}

/** How long a finger rests before it counts as the right button, and how far it may drift. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;
/**
 * Pixels of wheel per notch: a mouse's notch is 100 in Chrome and Safari, and
 * a touchpad sends a stream of a few pixels each, which add up to notches.
 */
const WHEEL_NOTCH = 100;
/** `WheelEvent.deltaMode`'s line and page, in pixels. */
const WHEEL_LINE = 40;
const WHEEL_PAGE = 800;

export class InputRouter {
  /** Non-empty while a modal dialog is up; game input is ignored then. */
  dialogStack: unknown[] = [];
  /**
   * A touch that is being held, which becomes a right-click if it stays put:
   * a phone's only way to the quick look and the spell descriptions. Not the
   * `contextmenu` event, which Android sends for a long press and iOS doesn't.
   */
  private press: { id: number; x: number; y: number; timer: number } | null = null;
  /** The long press fired, so the mouse events the browser makes of that touch are not a click too. */
  private swallowMouse = false;
  /**
   * A finger on the canvas that may yet drag something: `maybe` until it has
   * slid past the slop, then `dragging` if `onDragStart` took it or `no`.
   */
  private slide: { id: number; x: number; y: number; state: 'maybe' | 'dragging' | 'no' } | null = null;
  /** Wheel pixels not yet a whole notch. */
  private wheel = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: InputHandlers,
  ) {}

  attach(): void {
    window.addEventListener('keydown', (ev) => this.onKeyDown(ev));
    this.canvas.addEventListener('mousedown', (ev) => this.onMouseDown(ev));
    this.canvas.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    this.canvas.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    for (const end of ['pointerup', 'pointercancel'] as const) {
      this.canvas.addEventListener(end, (ev) => {
        if (this.press?.id === ev.pointerId) this.cancelPress();
        if (this.slide?.id !== ev.pointerId) return;
        if (this.slide.state === 'dragging') {
          const at = this.toCanvas(ev);
          this.handlers.onRelease?.(at.x, at.y);
        }
        this.slide = null;
      });
    }
    // The original has no context menu. A right-click reaches `onClick` with
    // `right` set, as 1997's WM_RBUTTONDOWN reaches `handle_action`.
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.canvas.addEventListener('mousemove', (ev) => this.onMouseMove(ev));
    this.canvas.addEventListener('mouseleave', () => this.handlers.onHoverEnd?.());
    this.canvas.addEventListener('wheel', (ev) => {
      const at = this.toCanvas(ev);
      const px = ev.deltaY * (ev.deltaMode === 1 ? WHEEL_LINE : ev.deltaMode === 2 ? WHEEL_PAGE : 1);
      // A turn the other way starts afresh.
      if (Math.sign(px) !== Math.sign(this.wheel)) this.wheel = 0;
      this.wheel += px;
      const notches = Math.trunc(this.wheel / WHEEL_NOTCH);
      this.wheel -= notches * WHEEL_NOTCH;
      if (this.handlers.onWheel?.(at.x, at.y, notches)) ev.preventDefault();
    }, { passive: false });
    window.addEventListener('mousemove', (ev) => {
      const at = this.toCanvas(ev);
      this.handlers.onDrag?.(at.x, at.y);
    });
    window.addEventListener('mouseup', (ev) => {
      const at = this.toCanvas(ev);
      this.handlers.onRelease?.(at.x, at.y);
    });
  }

  private get blocked(): boolean {
    return this.dialogStack.length > 0;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.blocked) return;
    const dir = KEY_DIRECTIONS[ev.code] ?? KEY_DIRECTIONS[ev.key];
    if (dir !== undefined) {
      ev.preventDefault();
      this.handlers.onMove(dir, ev.key);
      return;
    }
    this.handlers.onKey(ev.key, ev);
  }

  private onPointerDown(ev: PointerEvent): void {
    // Any new press starts clean — a mouse's too, on a laptop with a
    // touchscreen: its mouse events are real clicks unless it is held.
    this.swallowMouse = false;
    this.cancelPress();
    this.slide = null;
    if (ev.pointerType !== 'touch') return;
    const { clientX, clientY } = ev;
    this.slide = { id: ev.pointerId, x: clientX, y: clientY, state: 'maybe' };
    const timer = window.setTimeout(() => {
      this.press = null;
      if (this.blocked) return;
      this.swallowMouse = true;
      const at = this.toCanvas({ clientX, clientY });
      this.handlers.onClick(at.x, at.y, true, { alt: false, ctrl: false });
    }, LONG_PRESS_MS);
    this.press = { id: ev.pointerId, x: clientX, y: clientY, timer };
  }

  private onPointerMove(ev: PointerEvent): void {
    const slide = this.slide;
    if (!slide || slide.id !== ev.pointerId) return;
    if (slide.state === 'maybe') {
      if (Math.hypot(ev.clientX - slide.x, ev.clientY - slide.y) <= LONG_PRESS_SLOP) return;
      // Sliding: not a long press any more, and a drag only if it began on
      // something that drags.
      this.cancelPress();
      const from = this.toCanvas({ clientX: slide.x, clientY: slide.y });
      slide.state = !this.blocked && this.handlers.onDragStart?.(from.x, from.y) ? 'dragging' : 'no';
      // The mouse events the browser may still make of this touch are not a click.
      if (slide.state === 'dragging') this.swallowMouse = true;
    }
    if (slide.state !== 'dragging') return;
    ev.preventDefault();
    const at = this.toCanvas(ev);
    this.handlers.onDrag?.(at.x, at.y);
  }

  private cancelPress(): void {
    if (this.press) window.clearTimeout(this.press.timer);
    this.press = null;
  }

  private onMouseDown(ev: MouseEvent): void {
    if (this.swallowMouse) {
      this.swallowMouse = false;
      return;
    }
    if (this.blocked) return;
    const at = this.toCanvas(ev);
    this.handlers.onClick(at.x, at.y, ev.button === 2, { alt: ev.altKey, ctrl: ev.ctrlKey });
  }

  private onMouseMove(ev: MouseEvent): void {
    // A dialog hides the terrain view, so stop tracking rather than leaving a
    // stale crosshair behind it.
    if (this.blocked) {
      this.handlers.onHoverEnd?.();
      return;
    }
    const at = this.toCanvas(ev);
    this.handlers.onHover?.(at.x, at.y);
  }

  /** The canvas is drawn at native size and may be CSS-scaled up. */
  private toCanvas(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }
}
