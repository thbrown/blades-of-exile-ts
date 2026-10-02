/**
 * Where the two touch pads sit, how big they are and how see-through: one
 * scale, x/y offset and opacity for each side, kept as preferences and
 * handed to the stylesheet as custom properties on the root element. Also
 * the size of the buttons in the strips that dialogs, conversations and the
 * spell picker put down the sides (`touchDialog.ts`, `touchSpells.ts`),
 * which are all the same size. Not in the original — none of this is
 * (`touchControls.ts`).
 *
 * The settings panel is plain DOM, like the menu bar it opens from, and
 * changes the pads live, so a player can see where they're putting them.
 */

import { getFloatPref, setPref } from './prefs';

export type PadSide = 'left' | 'right';

export interface PadLayout {
  /** 1 is the pads' own size. */
  scale: number;
  /** CSS pixels from where the pad sits by default; +x is right, +y down. */
  x: number;
  y: number;
  /**
   * The buttons' alpha: 1 is solid, lower lets the game through. The arrows
   * and icons fade with it, but less, so they stay legible (`--ink`).
   */
  opacity: number;
}

const DEFAULT: PadLayout = { scale: 1, x: 0, y: 0, opacity: 0.6 };

interface Setting {
  field: keyof PadLayout;
  label: string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
}

const SETTINGS: readonly Setting[] = [
  { field: 'scale', label: 'Size', min: 0.5, max: 1.8, step: 0.05, show: (v) => `${Math.round(v * 100)}%` },
  { field: 'x', label: 'Across', min: -300, max: 300, step: 2, show: (v) => `${v}px` },
  { field: 'y', label: 'Up/down', min: -200, max: 200, step: 2, show: (v) => `${v}px` },
  { field: 'opacity', label: 'Opacity', min: 0.15, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%` },
];

/** The strips' buttons: width and height, each a multiple of their own size. */
interface ButtonSetting {
  pref: string;
  css: string;
  label: string;
  /** Narrower and taller than the strips were first made, which play-testing preferred. */
  fallback: number;
}

const BUTTON_SETTINGS: readonly ButtonSetting[] = [
  { pref: 'TouchButtonWidth', css: '--tb-w', label: 'Width', fallback: 0.85 },
  { pref: 'TouchButtonHeight', css: '--tb-h', label: 'Height', fallback: 1.1 },
];

const BUTTON_RANGE = { min: 0.5, max: 2, step: 0.05, show: (v: number) => `${Math.round(v * 100)}%` };

const prefName = (side: PadSide, field: keyof PadLayout): string =>
  `Touch${side === 'left' ? 'Left' : 'Right'}${field[0]!.toUpperCase()}${field.slice(1)}`;

export function readPadLayout(side: PadSide): PadLayout {
  const out = { ...DEFAULT };
  for (const s of SETTINGS) out[s.field] = getFloatPref(prefName(side, s.field), DEFAULT[s.field]);
  return out;
}

/** Hand both pads' layouts to the stylesheet (`--tl-*` left, `--tr-*` right). */
export function applyPadLayout(): void {
  const root = document.documentElement.style;
  for (const side of ['left', 'right'] as const) {
    const p = side === 'left' ? 'tl' : 'tr';
    const l = readPadLayout(side);
    root.setProperty(`--${p}-scale`, String(l.scale));
    root.setProperty(`--${p}-x`, `${l.x}px`);
    root.setProperty(`--${p}-y`, `${l.y}px`);
    root.setProperty(`--${p}-opacity`, String(l.opacity));
  }
  for (const b of BUTTON_SETTINGS) root.setProperty(b.css, String(getFloatPref(b.pref, b.fallback)));
}

let open: HTMLElement | null = null;

/** The View menu's Touch Controls Layout panel. A second call closes it. */
export function openTouchLayoutPanel(): void {
  if (open) {
    open.remove();
    open = null;
    return;
  }
  const panel = document.createElement('div');
  panel.id = 'touch-layout';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Touch controls layout');
  // Sliders take the arrow keys; the game, listening on the window, mustn't.
  panel.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') close();
  });
  // Nor the taps: the canvas underneath would take one as a move.
  panel.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  const close = (): void => {
    panel.remove();
    open = null;
  };

  const heading = document.createElement('h3');
  heading.textContent = 'Touch Controls Layout';
  panel.append(heading);

  const inputs: { side: PadSide; setting: Setting; input: HTMLInputElement; value: HTMLElement }[] = [];
  const columns = document.createElement('div');
  columns.className = 'tl-columns';
  for (const side of ['left', 'right'] as const) {
    const col = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = side === 'left' ? 'Left' : 'Right';
    col.append(legend);
    const layout = readPadLayout(side);
    for (const setting of SETTINGS) {
      const row = document.createElement('label');
      row.className = 'tl-row';
      const name = document.createElement('span');
      name.textContent = setting.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(setting.min);
      input.max = String(setting.max);
      input.step = String(setting.step);
      input.value = String(layout[setting.field]);
      const value = document.createElement('output');
      value.textContent = setting.show(layout[setting.field]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        setPref(prefName(side, setting.field), v);
        value.textContent = setting.show(v);
        applyPadLayout();
      });
      row.append(name, input, value);
      col.append(row);
      inputs.push({ side, setting, input, value });
    }
    columns.append(col);
  }
  panel.append(columns);

  // The strips' buttons, under the two pads.
  const buttons = document.createElement('fieldset');
  buttons.className = 'tl-buttons';
  const buttonsLegend = document.createElement('legend');
  buttonsLegend.textContent = 'Dialog buttons';
  buttons.append(buttonsLegend);
  const buttonInputs: { setting: ButtonSetting; input: HTMLInputElement; value: HTMLElement }[] = [];
  for (const setting of BUTTON_SETTINGS) {
    const row = document.createElement('label');
    row.className = 'tl-row';
    const name = document.createElement('span');
    name.textContent = setting.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(BUTTON_RANGE.min);
    input.max = String(BUTTON_RANGE.max);
    input.step = String(BUTTON_RANGE.step);
    const now = getFloatPref(setting.pref, setting.fallback);
    input.value = String(now);
    const value = document.createElement('output');
    value.textContent = BUTTON_RANGE.show(now);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setPref(setting.pref, v);
      value.textContent = BUTTON_RANGE.show(v);
      applyPadLayout();
    });
    row.append(name, input, value);
    buttons.append(row);
    buttonInputs.push({ setting, input, value });
  }
  panel.append(buttons);

  const foot = document.createElement('div');
  foot.className = 'tl-foot';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    for (const { side, setting, input, value } of inputs) {
      setPref(prefName(side, setting.field), DEFAULT[setting.field]);
      input.value = String(DEFAULT[setting.field]);
      value.textContent = setting.show(DEFAULT[setting.field]);
    }
    for (const { setting, input, value } of buttonInputs) {
      setPref(setting.pref, setting.fallback);
      input.value = String(setting.fallback);
      value.textContent = BUTTON_RANGE.show(setting.fallback);
    }
    applyPadLayout();
  });
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'primary';
  done.textContent = 'Done';
  done.addEventListener('click', close);
  foot.append(reset, done);
  panel.append(foot);

  document.body.append(panel);
  open = panel;
}
