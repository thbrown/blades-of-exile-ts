/**
 * Typing into a dialog: `cTextField`'s focus, caret and defocus check, the
 * three dialogs built on it, and the modal stack an error box opens on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addDialogDef, getDialogDef } from '../src/dialogs/dialogStore';
import { DialogHost, ModalScreen } from '../src/dialogs/dialog';
import {
  numOfItemsDialog, numResponseDialog, textResponseDialog,
} from '../src/dialogs/inputDialogs';
import { XmlDialog, fieldTextValid, setFieldErrorSink } from '../src/dialogs/xmlDialog';
import { SheetStore } from '../src/render/sheets';
import { pictChoiceDialog } from '../src/dialogs/pictChoiceDialog';

const DIALOG_DIR = fileURLToPath(new URL('../public/data/dialogs', import.meta.url));

beforeAll(async () => {
  for (const name of ['get-num', 'get-response', '1str-title', 'choose-pict', 'edit-party']) {
    await addDialogDef(name, readFileSync(`${DIALOG_DIR}/${name}.xml`, 'utf8'));
  }
});

afterEach(() => setFieldErrorSink(null));

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

function type(dlg: ModalScreen, text: string): void {
  for (const ch of text) dlg.onKey(ch);
}

describe('the type check a field makes on losing focus', () => {
  it('is lexical_cast: strict, with no spaces and no empty answer', () => {
    expect(fieldTextValid('int', '-12')).toBe(true);
    expect(fieldTextValid('int', '12 ')).toBe(false);
    expect(fieldTextValid('int', '')).toBe(false);
    expect(fieldTextValid('int', '1.5')).toBe(false);
    expect(fieldTextValid('uint', '-1')).toBe(false);
    expect(fieldTextValid('real', '1.5')).toBe(true);
    expect(fieldTextValid('text', '')).toBe(true);
  });
});

describe('get_num_of_items', () => {
  it('starts on the stack size, all selected, so typing replaces it', () => {
    const { dlg, result } = numOfItemsDialog(fakeCtx(), new SheetStore(), 20);
    expect(dlg.getText('prompt')).toBe('How many? (0-20)');
    expect(dlg.focused).toBe('number');
    type(dlg, '7');
    expect(dlg.getText('number')).toBe('7');
    expect(dlg.onKey('Enter')).toBe('okay');
    expect(result('okay')).toBe(7);
  });

  it('an arrow collapses the selection, and then typing appends', () => {
    const { dlg } = numOfItemsDialog(fakeCtx(), new SheetStore(), 20);
    dlg.onKey('End');
    type(dlg, '0');
    expect(dlg.getText('number')).toBe('200');
    dlg.onKey('Backspace');
    dlg.onKey('ArrowLeft');
    dlg.onKey('Delete');
    expect(dlg.getText('number')).toBe('2');
  });

  it('clamps on the way out, and cancel is 0', () => {
    const { dlg, result } = numOfItemsDialog(fakeCtx(), new SheetStore(), 5);
    type(dlg, '99');
    expect(dlg.onKey('Enter')).toBe('okay');
    expect(result('okay')).toBe(5);
    expect(result('cancel')).toBe(0);
  });

  it('refuses to close on something that is not a number, and says why', () => {
    const errors: string[] = [];
    setFieldErrorSink((msg) => errors.push(msg));
    const { dlg } = numOfItemsDialog(fakeCtx(), new SheetStore(), 5);
    type(dlg, 'x');
    expect(dlg.onKey('Enter')).toBeNull();
    expect(errors).toEqual(['You need to enter an integer!']);
    // Escape is cancel, which doesn't ask the field.
    expect(dlg.onKey('Escape')).toBe('cancel');
  });

  it("typed letters go to the field, not to a button's hotkey", () => {
    const { dlg } = numOfItemsDialog(fakeCtx(), new SheetStore(), 5);
    type(dlg, 'c');
    expect(dlg.getText('number')).toBe('c');
  });
});

describe('get_num_response', () => {
  it('has no cancel and refuses a number out of range', () => {
    const errors: string[] = [];
    const { dlg, result } = numResponseDialog(
      fakeCtx(), new SheetStore(), 1, 10, 'Pick one', (m) => errors.push(m));
    expect(dlg.isVisible('cancel')).toBe(false);
    expect(dlg.getText('prompt')).toBe('Pick one (1-10)');
    expect(dlg.getText('number')).toBe('0');
    expect(dlg.onKey('Enter')).toBeNull();
    expect(errors).toEqual(['Number out of range!']);
    type(dlg, '4');
    expect(dlg.onKey('Enter')).toBe('okay');
    expect(result('okay')).toBe(4);
  });
});

describe('get_text_response', () => {
  it('comes back lowercased, and empty on cancel', () => {
    const { dlg, result } = textResponseDialog(fakeCtx(), new SheetStore(), 'Ask about what?');
    expect(dlg.getText('prompt')).toBe('Ask about what?');
    type(dlg, 'Pit');
    expect(dlg.onKey('Enter')).toBe('okay');
    expect(result('okay')).toBe('pit');
    expect(result('cancel')).toBe('');
  });
});

describe('a dialog opened on top of another', () => {
  it('takes the input, and hands it back when it closes', async () => {
    const host = new DialogHost(fakeCtx(), new SheetStore(), () => {});
    const outer = numOfItemsDialog(fakeCtx(), new SheetStore(), 5);
    const inner = textResponseDialog(fakeCtx(), new SheetStore(), 'Inner');
    const outerDone = host.runNested(outer.dlg);
    const innerDone = host.runNested(inner.dlg);
    expect(host.active).toBe(inner.dlg);
    host.handleKey('q');
    host.handleKey('Enter');
    expect(await innerDone).toBe('okay');
    expect(inner.result('okay')).toBe('q');
    expect(host.active).toBe(outer.dlg);
    host.handleKey('Escape');
    expect(await outerDone).toBe('cancel');
    expect(host.active).toBeNull();
  });

  it('the plain run still refuses a second dialog', async () => {
    const host = new DialogHost(fakeCtx(), new SheetStore(), () => {});
    void host.runScreen(numOfItemsDialog(fakeCtx(), new SheetStore(), 5).dlg);
    await expect(host.runScreen(numOfItemsDialog(fakeCtx(), new SheetStore(), 5).dlg))
      .rejects.toThrow('already open');
  });
});

describe('a definition shown twice', () => {
  it("puts a neg-positioned control in the same place both times", () => {
    const place = (): number => {
      const dlg = new XmlDialog(fakeCtx(), new SheetStore(), getDialogDef('edit-party'));
      return dlg.screenRect(dlg.def.byName.get('help')!).left - dlg.frame.left;
    };
    const first = place();
    expect(place()).toBe(first);
    expect(place()).toBe(first);
  });
});

describe('cPictChoice', () => {
  const pcs = Array.from({ length: 37 }, (_, i) => ({ num: i, type: 'pc' as const }));

  it('opens on the page holding the current pick, with it lit', () => {
    const { dlg, state } = pictChoiceDialog(fakeCtx(), new SheetStore(), pcs, 36);
    expect(state.page).toBe(1);
    expect(dlg.getLed('led1')).toBe('red');
    expect(dlg.isVisible('led2')).toBe(false);
    expect(dlg.isVisible('pic2')).toBe(false);
  });

  it('wraps its pages, and picks by LED', () => {
    const { dlg, state } = pictChoiceDialog(fakeCtx(), new SheetStore(), pcs, 0, { noCancel: true });
    expect(dlg.isVisible('cancel')).toBe(false);
    expect(dlg.onKey('ArrowLeft')).toBeNull();
    expect(state.page).toBe(1);
    dlg.onKey('ArrowRight');
    expect(state.page).toBe(0);
    const r = dlg.screenRect(dlg.def.byName.get('led5') ?? dlg.def.controls
      .flatMap((c) => (c.kind === 'group' ? c.leds : []))
      .find((l) => l.name === 'led5')!);
    expect(dlg.onClick(r.left + 2, r.top + 2)).toBeNull();
    expect(state.cur).toBe(4);
    expect(dlg.getLed('led5')).toBe('red');
    expect(dlg.getLed('led1')).toBe('off');
  });

  it('a list that fits one page has no arrows', () => {
    const { dlg } = pictChoiceDialog(fakeCtx(), new SheetStore(), pcs.slice(0, 5), 0);
    expect(dlg.isVisible('left')).toBe(false);
  });
});
