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
import { knownBugRows } from '../src/dialogs/knownBugsDialog';
import { KNOWN_BUGS } from '../src/game/bugFixes';
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
  playSounds: true, gameSpeed: 1, targetLock: true, autoTarget: true, showInstantHelp: true,
  easyMode: false, lessWm: false,
  displayMode: DisplayMode.CENTRE, uiScale: 2, fixBugs: false,
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

  it('offers "Fix known bugs" in the save-browser row the browser never shows', async () => {
    const out = await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => {
        const d = screen as XmlDialog;
        expect(d.isVisible('fancypicker')).toBe(true);
        expect(d.getText('fancypicker')).toBe('Fix known bugs in the original games');
        expect(d.getLed('fancypicker')).toBe('off');
        expect(click(d, 'fancypicker')).toBeNull();
        return click(d, 'okay')!;
      },
    });
    expect(out?.fixBugs).toBe(true);
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

  it('the "?" beside Fix known bugs lists them, a page at a time', async () => {
    const opened: XmlDialog[] = [];
    await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => {
        const d = screen as XmlDialog;
        if (opened.length === 0) {
          opened.push(d);
          // Just after the LED's label, on its row.
          const help = d.screenRect(d.def.byName.get('fixbugs-help')!);
          const led = d.screenRect(d.def.byName.get('fancypicker')!);
          expect(help.left).toBeGreaterThan(led.left + 100);
          expect(Math.abs(help.top - led.top)).toBeLessThan(4);
          expect(click(d, 'fixbugs-help')).toBeNull();
          return click(d, 'okay')!;
        }
        opened.push(d);
        return 'done';
      },
    });
    expect(opened).toHaveLength(2);
    const list = opened[1]!;
    expect(list.getText('num1')).toBe('E3 #1');
    expect(list.getText('page')).toMatch(/^Page 1 of \d+$/);
    expect(click(list, 'right')).toBeNull();
    expect(list.getText('page')).toMatch(/^Page 2 of/);
  });

  it('lists every known bug, and says which the preference leaves alone', () => {
    const rows = knownBugRows();
    expect(rows).toHaveLength(Object.keys(KNOWN_BUGS).length);
    expect(rows.find((r) => r.num === 'E3 #4')?.text).toMatch(/Not changed: /);
    expect(rows.find((r) => r.num === 'E3 #24')?.text).not.toMatch(/Not changed/);
    expect(rows.at(-1)?.num).toBe('BoE #100');
  });

  it('the touch overlay lists the settings under their headings', async () => {
    await preferencesDialog(fakeCtx(), new SheetStore(), base, {
      resetHelp: () => {},
      nest: async (screen) => {
        const right = screen.touchView!()!.right;
        const sections = right.filter((c) => c.section !== undefined).map((c) => c.section);
        expect(sections).toEqual(['Game speed', 'Targeting', 'Miscellaneous', '']);
        expect(right.find((c) => c.name === 'fast')?.section).toBe('Game speed');
        // The "?" follows its own row.
        const led = right.findIndex((c) => c.name === 'fancypicker');
        expect(right[led + 1]?.name).toBe('fixbugs-help');
        return click(screen, 'okay')!;
      },
    });
  });
});

