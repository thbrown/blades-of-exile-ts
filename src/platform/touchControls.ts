/**
 * Touch controls: two translucent pads laid over the game for phones held
 * sideways. Not in the original, which had a keyboard and a mouse.
 *
 * The right pad is the eight directions, with Space (pause, or stand ready)
 * in the middle — the numeric keypad a phone doesn't have. The left pad is
 * the toolbar of the current mode, bigger than the game's own 38px buttons
 * are once the screen is scaled to a phone, plus a few keys the toolbar has
 * no button for.
 *
 * Nothing here is a new way into the game. A direction or a key is a real
 * `keydown` on the window, so it passes the same gates the keyboard does, and
 * a toolbar button calls the same `pressToolbar` a click on the canvas does.
 * Replays record the action, not the input (replay/recorder.ts), so they
 * can't tell the difference either.
 */

import { ToolbarButton, buttonIconRect, placeButtons } from '../render/layout';
import type { ToolbarMode } from '../render/screen';
import { getBoolPref, setPref } from './prefs';

const PREF = 'TouchControls';

/**
 * Whether the pads are wanted. Unset, it follows the device: on where the
 * main pointer is a finger and there's no mouse or trackpad at all, so a
 * laptop with a touchscreen keeps its keyboard layout.
 */
export function touchControlsOn(): boolean {
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches === true
    && globalThis.matchMedia?.('(any-pointer: fine)').matches !== true;
  return getBoolPref(PREF, coarse);
}

export function setTouchControls(on: boolean): void {
  setPref(PREF, on);
}

/** What the pads need from the game, asked on every redraw. */
export interface TouchPadHost {
  /** Which toolbar is up, or null when the pads should hide (no game, a dialog, a shop, a conversation). */
  mode(): ToolbarMode | null;
  buttons(mode: ToolbarMode): readonly ToolbarButton[];
  press(which: ToolbarButton): void;
  /** `buttons.png`, or the scenario's own, once it's loaded. */
  sheet(): ImageBitmap | undefined;
}

/** A key the toolbar has no button for, and the modes it's offered in. */
interface ExtraKey {
  label: string;
  key: string;
  title: string;
  modes: readonly ToolbarMode[];
}

const EXTRA_KEYS: readonly ExtraKey[] = [
  // `handle_wait` (boe.actions.cpp:3094): the long wait, town only.
  { label: 'Wait', key: 'w', title: 'Wait (w)', modes: ['town'] },
  // Backs out of Look, targeting and the missile arm, as Escape does.
  { label: 'Esc', key: 'Escape', title: 'Cancel (Escape)', modes: ['out', 'town', 'combat'] },
];

/** The eight directions as keys the router already reads (input.ts). */
const DPAD: readonly (readonly [string, string, string])[] = [
  // [key, arrow, title]
  ['Home', '↖', 'North-west'], ['ArrowUp', '↑', 'North'], ['PageUp', '↗', 'North-east'],
  ['ArrowLeft', '←', 'West'], [' ', '•', 'Pause / stand ready (Space)'], ['ArrowRight', '→', 'East'],
  ['End', '↙', 'South-west'], ['ArrowDown', '↓', 'South'], ['PageDown', '↘', 'South-east'],
];

/** Held, a direction repeats: first after this long, then at this rate. */
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 170;

function sendKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  /** What the left pad was last built for, so a redraw that changes nothing is free. */
  private shownMode: ToolbarMode | null = null;
  private shownSheet: ImageBitmap | undefined;
  private repeat: { timer: number; pointer: number } | null = null;
  private triedLandscape = false;

  constructor(private readonly host: TouchPadHost) {
    this.root = document.createElement('div');
    this.root.id = 'touch-pads';
    this.left = document.createElement('div');
    this.left.className = 'touch-pad touch-actions';
    this.right = document.createElement('div');
    this.right.className = 'touch-pad touch-dpad';
    this.root.append(this.left, this.right);
    this.buildDpad();
    document.body.append(this.root);

    const cover = document.createElement('div');
    cover.id = 'rotate-cover';
    cover.innerHTML = '<div class="rotate-phone" aria-hidden="true"></div><p>Turn your phone sideways to play.</p>';
    document.body.append(cover);

    // The first touch in the game asks for full screen and a landscape lock,
    // which need a gesture to ask from. Android grants both; an iPhone has
    // neither API, and gets the cover in portrait instead.
    window.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch' && this.shownMode !== null) void this.goLandscape();
    }, { capture: true });
  }

  /** Bring the pads in line with the game. Called from every redraw. */
  sync(): void {
    const on = touchControlsOn();
    document.body.classList.toggle('touch-controls', on);
    const mode = on ? this.host.mode() : null;
    this.root.hidden = mode === null;
    if (mode === null) {
      this.stopRepeat();
      return;
    }
    const sheet = this.host.sheet();
    if (mode === this.shownMode && sheet === this.shownSheet) return;
    this.shownMode = mode;
    this.shownSheet = sheet;
    this.buildActions(mode, sheet);
  }

  private buildDpad(): void {
    for (const [key, arrow, title] of DPAD) {
      const b = this.padButton(title);
      b.textContent = arrow;
      if (key === ' ') b.classList.add('centre');
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.stopRepeat();
        sendKey(key);
        if (key === ' ') return;
        // Moves repeat while held, as a held arrow key does. A move that
        // arrives mid-step is dropped by the game (`midAction`), so the
        // rate only has to be about right.
        const pointer = ev.pointerId;
        const timer = window.setTimeout(() => {
          if (this.repeat?.pointer !== pointer) return;
          this.repeat.timer = window.setInterval(() => sendKey(key), REPEAT_EVERY_MS);
        }, REPEAT_DELAY_MS);
        this.repeat = { timer, pointer };
        b.setPointerCapture?.(ev.pointerId);
      });
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        b.addEventListener(end, (ev) => {
          if (this.repeat?.pointer === ev.pointerId) this.stopRepeat();
        });
      }
      this.right.append(b);
    }
  }

  private buildActions(mode: ToolbarMode, sheet: ImageBitmap | undefined): void {
    this.left.replaceChildren();
    for (const placed of placeButtons(this.host.buttons(mode))) {
      const b = this.padButton(ToolbarButton[placed.btn].toLowerCase());
      b.dataset['button'] = ToolbarButton[placed.btn];
      if (sheet) b.append(iconCanvas(sheet, placed.btn));
      else b.textContent = ToolbarButton[placed.btn];
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.host.press(placed.btn);
      });
      this.left.append(b);
    }
    for (const extra of EXTRA_KEYS) {
      if (!extra.modes.includes(mode)) continue;
      const b = this.padButton(extra.title);
      b.classList.add('text');
      b.dataset['key'] = extra.key;
      b.textContent = extra.label;
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        sendKey(extra.key);
      });
      this.left.append(b);
    }
  }

  private padButton(title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'touch-button';
    b.title = title;
    b.setAttribute('aria-label', title);
    // A button that takes focus would swallow the next real keypress's
    // default handling, and a phone would scroll it into view.
    b.tabIndex = -1;
    return b;
  }

  private stopRepeat(): void {
    if (!this.repeat) return;
    window.clearTimeout(this.repeat.timer);
    window.clearInterval(this.repeat.timer);
    this.repeat = null;
  }

  private async goLandscape(): Promise<void> {
    if (this.triedLandscape) return;
    this.triedLandscape = true;
    const doc = document.documentElement;
    try {
      if (!document.fullscreenElement && doc.requestFullscreen) await doc.requestFullscreen({ navigationUI: 'hide' });
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await orientation.lock?.('landscape');
    } catch {
      // Refused, or not a phone: the cover still asks in portrait.
    }
  }
}

/** One toolbar icon, cut from the sheet as `drawToolbar` cuts it. */
function iconCanvas(sheet: ImageBitmap, btn: ToolbarButton): HTMLCanvasElement {
  // The bottom row's buttons are half height, with a 32×16 label for an icon.
  const [placed] = placeButtons([btn]);
  const src = buttonIconRect(placed!);
  const c = document.createElement('canvas');
  c.width = src.right - src.left;
  c.height = src.bottom - src.top;
  c.className = c.height < c.width ? 'touch-icon wide' : 'touch-icon';
  c.getContext('2d')!.drawImage(sheet, src.left, src.top, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}
