/** `pick_preferences` — the settings a browser can honour, round-tripped. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDialogDef } from '../src/dialogs/dialogStore';
import { ModalScreen } from '../src/dialogs/dialog';
import {
  PREFERENCES_DIALOG_DEFS, Preferences, preferencesDialog,
} from '../src/dialogs/preferencesDialog';
import { XmlDialog } from '../src/dialogs/xmlDialog';
import { DEFAULT_AUTOSAVE_PREFS } from '../src/game/autosave';
import { DisplayMode, UI_SCALE_FIT, desktop } from '../src/render/desktop';
import { SheetStore } from '../src/render/sheets';

const DIALOG_DIR = fileURLToPath(new URL('../public/data/dialogs', import.meta.url));
beforeAll(async () => {
  for (const name of PREFERENCES_DIALOG_DEFS) {
    await addDialogDef(name, readFileSync(`${DIALOG_DIR}/${name}.xml`, 'utf8'));
  }
});

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {};
  return {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText: noop, fillRect: noop, strokeRect: noop, drawImage: noop,
    save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop,
    moveTo: noop, lineTo: noop, stroke: noop, createPattern: () => null,
  } as unknown as CanvasRenderingContext2D;
}

function click(dlg: ModalScreen, name: string): string | null {
  const x = dlg as XmlDialog;
  const r = x.screenRect(x.def.byName.get(name)!);
  return dlg.onClick(r.left + 2, r.top + 2);
}

const base: Preferences = {
  playSounds: true, gameSpeed: 1, targetLock: true, showInstantHelp: true,
  autosave: DEFAULT_AUTOSAVE_PREFS, easyMode: false, lessWm: false,
  displayMode: DisplayMode.CENTRE, uiScale: 2,
};

describe('the preferences dialog', () => {
  it('shows the current settings and hands back the changed ones on OK', async () => {
    let seen: XmlDialog | null = null;
    const out = await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => {
        const d = screen as XmlDialog;
        seen = d;
        expect(d.getLed('med')).toBe('red');
        expect(d.isVisible('display')).toBe(false);
        // None of these closes the dialog: an LED only toggles.
        for (const id of ['snail', 'nosound', 'nohelp', 'easier']) expect(click(d, id)).toBeNull();
        return click(d, 'okay')!;
      },
    });
    expect(seen).not.toBeNull();
    expect(out).toMatchObject({
      gameSpeed: 3, playSounds: false, showInstantHelp: false, easyMode: true, lessWm: false,
    });
  });

  it('Cancel keeps nothing', async () => {
    const out = await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => { click(screen, 'nosound'); return screen.onKey('Escape')!; },
    });
    expect(out).toBeNull();
  });

  it('clicking the lit speed leaves it lit', async () => {
    const out = await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => { click(screen, 'med'); return click(screen, 'okay')!; },
    });
    expect(out?.gameSpeed).toBe(1);
  });

  it('offers alignment and scale when the desktop has room for the whole dialog', async () => {
    Object.assign(desktop, { w: 1000, h: 700 });
    try {
      const out = await preferencesDialog(fakeCtx(), new SheetStore(), base, {
        resetHelp: () => {},
        nest: async (screen) => {
          const d = screen as XmlDialog;
          expect(d.isVisible('display')).toBe(true);
          expect(d.getLed('mid')).toBe('red');
          expect(d.getLed('2')).toBe('red');
          expect(d.getText('other')).toBe('Fit');
          expect(d.frame.bottom).toBeLessThanOrEqual(700);
          click(d, 'tl');
          click(d, 'tl'); // clicking the lit one again leaves it lit
          click(d, 'other');
          return click(d, 'okay')!;
        },
      });
      expect(out).toMatchObject({ displayMode: DisplayMode.TOP_LEFT, uiScale: UI_SCALE_FIT });
    } finally {
      Object.assign(desktop, { w: 605, h: 430 });
    }
  });

  it('a compact dialog hands the display settings back unchanged', async () => {
    const out = await preferencesDialog(fakeCtx(), new SheetStore(), { ...base, displayMode: 4, uiScale: 1.5 }, {
      resetHelp: () => {},
      nest: async (screen) => click(screen, 'okay')!,
    });
    expect(out).toMatchObject({ displayMode: 4, uiScale: 1.5 });
  });
});
