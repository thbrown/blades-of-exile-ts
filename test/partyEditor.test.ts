/**
 * The party editor's screens, driven the way a player drives them: each
 * dialog the flow opens is answered by clicking or typing into it, through a
 * host that hands the dialogs to a script instead of a screen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { STRING_TABLES, setStrings } from '../src/data/strings';
import { addDialogDef } from '../src/dialogs/dialogStore';
import { ModalScreen } from '../src/dialogs/dialog';
import {
  PARTY_EDITOR_DIALOG_DEFS, PartyEditorHost, createPc, editParty, pickPcName, pickRaceAbil,
} from '../src/dialogs/partyEditor';
import { PICT_CHOICE_DIALOG_DEFS } from '../src/dialogs/pictChoiceDialog';
import { SPEND_XP_DIALOG_DEFS, spendXpDialog } from '../src/dialogs/spendXpDialog';
import { XmlDialog } from '../src/dialogs/xmlDialog';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { XpMode } from '../src/game/createPc';
import { SheetStore } from '../src/render/sheets';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Race, Skill, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const DIALOG_DIR = fileURLToPath(new URL('../public/data/dialogs', import.meta.url));
const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
  for (const name of [...PARTY_EDITOR_DIALOG_DEFS, ...PICT_CHOICE_DIALOG_DEFS, ...SPEND_XP_DIALOG_DEFS]) {
    await addDialogDef(name, readFileSync(`${DIALOG_DIR}/${name}.xml`, 'utf8'));
  }
  for (const table of ['traits', 'skills']) {
    setStrings(table, readFileSync(new URL(`../public/data/strings/${table}.txt`, import.meta.url), 'utf8'));
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

/** One step of a script: act on the dialog that just opened. */
type Step = (dlg: ModalScreen) => void;

/** Click a control by name, the way `DialogHost` routes a real click. */
function click(dlg: ModalScreen, name: string): string | null {
  const x = dlg as XmlDialog;
  const r = x.screenRect(x.def.byName.get(name)!);
  return dlg.onClick(r.left + 2, r.top + 2);
}

/**
 * A host whose `nest` hands each dialog to the next scripted step, then keeps
 * feeding it keys and clicks until it closes. A step closes its dialog by
 * returning through `answer`.
 */
function scriptedHost(univ: Universe, steps: ((dlg: ModalScreen) => string)[]): PartyEditorHost {
  const ctx = fakeCtx();
  const store = new SheetStore();
  const host: PartyEditorHost = {
    ctx, store, univ,
    nest: async (screen) => {
      const step = steps.shift();
      if (!step) throw new Error('a dialog opened that the script did not expect');
      return step(screen);
    },
    spendXp: async (who, mode) => {
      const { dlg } = spendXpDialog(ctx, store, univ, who, mode, { nest: host.nest, redraw: () => {} });
      return (await host.nest(dlg)) === 'keep';
    },
    redraw: () => {},
  };
  return host;
}

/** A step that clicks some controls and then closes on the last one. */
function clicks(...names: string[]): (dlg: ModalScreen) => string {
  return (dlg) => {
    let closed: string | null = null;
    for (const name of names) closed = click(dlg, name) ?? closed;
    if (closed === null) throw new Error(`clicking ${names.join(', ')} did not close the dialog`);
    return closed;
  };
}

function newUniverse(): Universe {
  return new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
}

describe('pick_race_abil', () => {
  it('in display mode changes nothing, and Escape is Done', async () => {
    const univ = newUniverse();
    const pc = univ.party.pcs[0]!;
    const before = [...pc.traits];
    let info = '';
    const host = scriptedHost(univ, [(dlg) => {
      click(dlg, 'good1');
      click(dlg, 'race3');
      const x = dlg as XmlDialog;
      info = x.getText('info');
      expect(x.getLed('good1')).toBe(pc.traits[Trait.TOUGHNESS] ? 'red' : 'off');
      expect(x.isVisible('cancel')).toBe(false);
      return dlg.onKey('Escape')!;
    }]);
    await pickRaceAbil(host, pc, 1);
    expect(pc.traits).toEqual(before);
    expect(pc.race).toBe(Race.HUMAN);
    // …but the click still explained what was clicked.
    expect(info).toContain('Slith');
  });

  it('in edit mode keeps the LEDs on Done and drops them on Cancel', async () => {
    const univ = newUniverse();
    const pc = univ.party.pcs[0]!;
    await pickRaceAbil(scriptedHost(univ, [clicks('race2', 'bad3', 'cancel')]), pc, 0);
    expect(pc.race).toBe(Race.HUMAN);
    await pickRaceAbil(scriptedHost(univ, [clicks('race2', 'bad3', 'done')]), pc, 0);
    expect(pc.race).toBe(Race.NEPHIL);
    expect(pc.traits[Trait.FRAIL]).toBe(true);
  });

  it('shows the experience a level would cost as the LEDs change (1997)', async () => {
    const univ = newUniverse();
    const pc = univ.party.pcs[0]!;
    pc.race = Race.HUMAN;
    pc.traits.fill(false);
    const seen: string[] = [];
    await pickRaceAbil(scriptedHost(univ, [(dlg) => {
      const x = dlg as XmlDialog;
      seen.push(x.getText('xp'));
      click(dlg, 'good2'); // Magically Apt, +20%
      seen.push(x.getText('xp'));
      click(dlg, 'race3'); // Slithzerikai, +20%
      seen.push(x.getText('xp'));
      return click(dlg, 'cancel')!;
    }]), pc, 0);
    expect(seen).toEqual(['100', '120', '144']);
  });

  it("in Exile III offers only that game's species and traits, but shows one a PC already has", async () => {
    const univ = newUniverse();
    const flags = univ.scenario.featureFlags;
    flags['traits'] = 'exile3';
    try {
      const pc = univ.party.pcs[0]!;
      pc.race = Race.HUMAN;
      pc.traits.fill(false);
      pc.traits[Trait.ANAMA] = true;
      const seen: boolean[] = [];
      await pickRaceAbil(scriptedHost(univ, [(dlg) => {
        const x = dlg as XmlDialog;
        seen.push(x.isVisible('race3'), x.isVisible('race4'), x.isVisible('bad5'), x.isVisible('bad6'), x.isVisible('bad7'));
        return click(dlg, 'cancel')!;
      }]), pc, 0);
      expect(seen).toEqual([true, false, true, false, true]);
    } finally {
      delete flags['traits'];
    }
  });

  it('loads its descriptions with the game', () => {
    expect(STRING_TABLES).toContain('traits');
  });
});

describe('pick_pc_name', () => {
  it('refuses an empty name and one that starts with a digit, and says why', async () => {
    const univ = newUniverse();
    const errors: string[] = [];
    const host = scriptedHost(univ, [(dlg) => {
      const x = dlg as XmlDialog;
      x.onKey('Delete');
      for (;;) {
        // select-all on the old name, so one Backspace clears it
        if (x.getText('name') === '') break;
        x.onKey('Backspace');
      }
      click(dlg, 'okay');
      errors.push(x.getText('error'));
      for (const ch of '2nd') x.onKey(ch);
      click(dlg, 'okay');
      errors.push(x.getText('error'));
      x.onKey('Home');
      x.onKey('Delete');
      return click(dlg, 'okay')!;
    }]);
    await pickPcName(host, 0);
    expect(errors).toEqual(['Cannot be empty.', 'Must begin with a letter.']);
    expect(univ.party.pcs[0]!.name).toBe('nd');
  });
});

describe('create_pc', () => {
  it('runs all four dialogs and makes the PC', async () => {
    const univ = newUniverse();
    univ.party.pcs[5]!.mainStatus = MainStatus.ABSENT;
    const host = scriptedHost(univ, [
      clicks('race4', 'good2', 'done'),
      clicks('str-p', 'str-p', 'keep'),
      clicks('led9', 'done'),
      (dlg) => {
        for (const ch of 'Vex') dlg.onKey(ch);
        return dlg.onKey('Enter')!;
      },
    ]);
    expect(await createPc(host, 6, false)).toBe(true);
    const pc = univ.party.pcs[5]!;
    expect(pc.name).toBe('Vex');
    expect(pc.race).toBe(Race.VAHNATAI);
    expect(pc.traits[Trait.MAGICALLY_APT]).toBe(true);
    expect(pc.whichGraphic).toBe(8);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    expect(pc.skills[Skill.STRENGTH]).toBeGreaterThanOrEqual(3);
    // Not in startup, so finished now: the two starting items are in the pack.
    expect(pc.items.filter((i) => i.variety !== 0).length).toBeGreaterThan(0);
    expect(pc.curHealth).toBe(pc.maxHealth);
  });

  it('cancelling the skill points abandons the PC', async () => {
    const univ = newUniverse();
    univ.party.pcs[2]!.mainStatus = MainStatus.ABSENT;
    const host = scriptedHost(univ, [clicks('done'), clicks('cancel')]);
    expect(await createPc(host, 6, true)).toBe(false);
    expect(univ.party.pcs[2]!.mainStatus).toBe(MainStatus.ABSENT);
  });
});

describe('edit_party', () => {
  it('deletes a PC on Yes, and moves the current PC off an empty slot', async () => {
    const univ = newUniverse();
    univ.curPc = 0;
    let editor: XmlDialog | null = null;
    const host = scriptedHost(univ, []);
    // The editor itself stays up while the confirm is answered, so the
    // script has to be able to come back to it.
    host.nest = async (screen) => {
      const x = screen as XmlDialog;
      if (x.def.byName.has('delete1')) {
        editor = x;
        click(x, 'delete1');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(x.getText('name1')).toBe('Empty.');
        expect(x.isVisible('trait1')).toBe(false);
        expect(x.getText('delete1')).toBe('Create');
        return click(x, 'done')!;
      }
      // delete-pc-confirm.xml
      return x.onKey('y')!;
    };
    await editParty(host);
    expect(editor).not.toBeNull();
    expect(univ.party.pcs[0]!.mainStatus).toBe(MainStatus.ABSENT);
    expect(univ.curPc).toBe(1);
  });

  it('opens training in creation mode — skill points, no gold', () => {
    const univ = newUniverse();
    const { dlg } = spendXpDialog(fakeCtx(), new SheetStore(), univ, 0, XpMode.CREATE,
      { nest: async () => '', redraw: () => {} });
    expect(dlg.isVisible('gold')).toBe(false);
    expect(dlg.isVisible('left')).toBe(false);
  });

  it('for a finger, trains a skill picked from the list with one +/− pair', () => {
    const univ = newUniverse();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 20;
    const { dlg, state } = spendXpDialog(fakeCtx(), new SheetStore(), univ, 0, XpMode.CREATE,
      { nest: async () => '', redraw: () => {} });
    const view = dlg.touchView();
    expect(view.left).toHaveLength(21);
    expect(view.left![0]!.on).toBe(true);
    expect(view.right.map((c) => c.name)).toEqual(['plus', 'minus', 'help', 'cancel', 'keep']);
    const before = state.cur(Skill.DEXTERITY);
    dlg.touchPress('skill:dex');
    expect(dlg.touchView().left!.find((c) => c.on)!.name).toBe('skill:dex');
    dlg.touchPress('plus');
    expect(state.cur(Skill.DEXTERITY)).toBe(before + 1);
    expect(dlg.touchView().right.find((c) => c.name === 'minus')!.disabled).toBe(false);
    dlg.touchPress('minus');
    expect(state.cur(Skill.DEXTERITY)).toBe(before);
  });

  it('for a finger, lists the party and acts on the PC picked', async () => {
    const univ = newUniverse();
    univ.party.pcs[3]!.mainStatus = MainStatus.ABSENT;
    const opened: string[] = [];
    const host = scriptedHost(univ, []);
    host.nest = async (screen) => {
      const x = screen as XmlDialog;
      if (x.def.byName.has('delete1')) {
        const view = x.touchView();
        expect(view.left!.map((c) => c.label)[3]).toBe('4. Empty');
        x.touchPress('slot:3');
        expect(x.touchView().right.map((c) => c.label)).toEqual(['Create', 'Help', 'Done']);
        x.touchPress('slot:1');
        expect(x.touchView().right.map((c) => c.name)).toEqual(['name', 'delete', 'trait', 'train', 'pic', 'help', 'done']);
        x.touchPress('trait');
        await Promise.resolve();
        return x.touchPress('done')!;
      }
      opened.push(x.def.byName.has('race1') ? 'race' : 'other');
      return 'cancel';
    };
    await editParty(host);
    expect(opened).toEqual(['race']);
  });
});
