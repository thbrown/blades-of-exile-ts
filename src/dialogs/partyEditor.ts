/**
 * Building and changing the party: `edit_party` (boe.dlgutil.cpp:1681),
 * `create_pc` (boe.party.cpp:249) and the four dialogs it chains —
 * `pick_race_abil` (pc.editors.cpp:247), `spend_xp` (see `spendXpDialog.ts`),
 * `pick_pc_graphic` (boe.party.cpp:2403) and `pick_pc_name` (:2445).
 *
 * The rules are `game/createPc.ts`'s, shared with the replay driver; this is
 * the screens. Every dialog here opens *on top of* its parent, as the C++'s
 * `parent` argument does, so the editor stays drawn behind a character being
 * made.
 */

import { getStr } from '../data/strings';
import { PcGraphicPick, RaceAbilPick, XpMode, newPc, pcNameOk } from '../game/createPc';
import { giveE3StartItems } from '../game/e3StartItems';
import { SheetStore } from '../render/sheets';
import { giveHelp } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Race, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { ModalScreen, type TouchChoice } from './dialog';
import { getDialogDef } from './dialogStore';
import { pictChoiceDialog } from './pictChoiceDialog';
import { XmlDialog } from './xmlDialog';

export const PARTY_EDITOR_DIALOG_DEFS = [
  'edit-party', 'pick-race-abil', 'pick-pc-name', 'delete-pc-confirm', 'new-party',
  'restart-game',
];

export interface PartyEditorHost {
  ctx: CanvasRenderingContext2D;
  store: SheetStore;
  univ: Universe;
  /** Open a dialog on top of whatever is up. */
  nest(screen: ModalScreen): Promise<string>;
  /** `spend_xp(who, mode)` — true if kept. */
  spendXp(who: number, mode: XpMode): Promise<boolean>;
  redraw(): void;
}

/** `pick_race_abil`'s mode: 0 edit, 1 just display, 2 everything but the race. */
export type RaceAbilMode = 0 | 1 | 2;

/**
 * `pick_race_abil` on pick-race-abil.xml. The LEDs are the working copy
 * (`RaceAbilPick`), and only Done in an editing mode writes them back.
 *
 * The "Experience needed" number follows the LEDs, as 1997's
 * `display_traits_graphics` (INFODLGS.CPP:718) recomputes `get_tnl` on every
 * click. OBoE reads the PC's own once, when the dialog opens, so the number
 * never moved (DIVERGENCES.md #39).
 * A click on anything, editable or not, puts that thing's description in the
 * box at the bottom.
 */
export async function pickRaceAbil(
  host: PartyEditorHost, pc: Player, mode: RaceAbilMode,
): Promise<void> {
  const { ctx, store } = host;
  const dlg = new XmlDialog(ctx, store, getDialogDef('pick-race-abil'));
  const pick = new RaceAbilPick(pc);
  const show = (): void => {
    for (let r = 0; r < 4; r++) dlg.setLed(`race${r + 1}`, pick.race === r ? 'red' : 'off');
    for (let i = 0; i < 10; i++) dlg.setLed(`good${i + 1}`, pick.traits[i] ? 'red' : 'off');
    for (let i = 0; i < 7; i++) dlg.setLed(`bad${i + 1}`, pick.traits[i + 10] ? 'red' : 'off');
    dlg.setNum('xp', pick.tnl());
  };
  const select = (id: string) => (): 'stay' => {
    let abilStr = 0;
    const race = /^race(\d)$/.exec(id);
    const good = /^good(\d+)$/.exec(id);
    const bad = /^bad(\d)$/.exec(id);
    if (race) {
      abilStr = 36 + (Number(race[1]) - 1) * 2;
      // Can't edit race.
      if (mode === 0) pick.click(id);
    } else if (bad) {
      abilStr = 22 + (Number(bad[1]) - 1) * 2;
      if (mode !== 1) pick.click(id);
    } else if (good) {
      abilStr = 2 + (Number(good[1]) - 1) * 2;
      if (mode !== 1) pick.click(id);
    }
    if (abilStr > 0) dlg.setText('info', getStr('traits', abilStr));
    show();
    return 'stay';
  };
  for (let r = 1; r <= 4; r++) dlg.attachHandler(`race${r}`, select(`race${r}`));
  for (let i = 1; i <= 10; i++) dlg.attachHandler(`good${i}`, select(`good${i}`));
  for (let i = 1; i <= 7; i++) dlg.attachHandler(`bad${i}`, select(`bad${i}`));
  // Exile III's own screen (dialog 1013) has three species, ten advantages
  // and five disadvantages: no Vahnatai, Pacifist or Anama Member. A PC
  // that already has one (a party made in Blades of Exile) still shows it,
  // so it can be seen and taken off.
  if (host.univ.scenario.featureFlags['traits'] === 'exile3') {
    if (pick.race !== Race.VAHNATAI) dlg.hide('race4');
    if (!pick.traits[Trait.PACIFIST]) dlg.hide('bad6');
    if (!pick.traits[Trait.ANAMA]) dlg.hide('bad7');
  }
  dlg.attachHandler('done', () => 'close');
  if (mode !== 1) {
    dlg.attachHandler('cancel', () => 'close');
  } else {
    dlg.hide('cancel');
    dlg.setEscapeButton('done');
  }
  dlg.setText('info', mode === 1
    ? 'Click on button by name for description.'
    : 'Click on advantage button to add/remove.');
  show();
  const closed = await host.nest(dlg);
  if (closed === 'done' && mode !== 1) pick.keep();
}

/**
 * `pick_pc_graphic` — a `cPictChoice` over PC pictures 0-36. In creation mode
 * (0) Cancel is hidden, and backing out anyway would make the PC ABSENT.
 */
export async function pickPcGraphic(
  host: PartyEditorHost, spot: number, mode: 0 | 1,
): Promise<boolean> {
  const pc = host.univ.party.pcs[spot]!;
  const picts = Array.from({ length: PcGraphicPick.COUNT }, (_, i) => ({ num: i, type: 'pc' as const }));
  const { dlg, state } = pictChoiceDialog(host.ctx, host.store, picts, pc.whichGraphic, {
    prompt: 'Select a graphic for your PC:',
    noCancel: mode === 0,
  });
  dlg.setPict('mainpic', 7);
  dlg.setText('help', 'Click button to left of graphic to select.');
  const madeChoice = (await host.nest(dlg)) === 'done';
  if (mode === 0 && !madeChoice && pc.mainStatus < MainStatus.ABSENT) {
    pc.mainStatus = MainStatus.ABSENT;
  } else if (madeChoice) {
    pc.whichGraphic = state.cur;
  }
  return madeChoice;
}

/**
 * `pick_pc_name` — OK only closes on a usable name, and says what's wrong
 * otherwise (`pc_name_event_filter`, boe.party.cpp:2430). There is no Cancel.
 */
export async function pickPcName(host: PartyEditorHost, spot: number): Promise<void> {
  const pc = host.univ.party.pcs[spot]!;
  const dlg = new XmlDialog(host.ctx, host.store, getDialogDef('pick-pc-name'));
  dlg.setText('name', pc.name);
  dlg.attachHandler('okay', (me) => {
    const name = me.getText('name');
    if (name === '') {
      me.setText('error', 'Cannot be empty.');
      return 'stay';
    }
    if (!pcNameOk(name)) {
      me.setText('error', 'Must begin with a letter.');
      return 'stay';
    }
    pc.name = name;
    return 'close';
  });
  await host.nest(dlg);
}

/**
 * `create_pc(spot)` — a blank PC and the four dialogs. `inStartup` is the
 * C++'s `overall_mode == MODE_STARTUP`: a PC made while the party is still
 * being built is finished later with the rest; one added to a party already
 * playing is finished now.
 */
export async function createPc(
  host: PartyEditorHost, spotIn: number, inStartup: boolean,
): Promise<boolean> {
  const { univ } = host;
  const spot = spotIn === 6 ? univ.party.freeSpace() : spotIn;
  if (spot === 6) return false;
  const pc = newPc(univ, spot);

  await pickRaceAbil(host, pc, 0);
  // spend_xp's Cancel in creation mode abandons the PC (pc.editors.cpp:484).
  if (!(await host.spendXp(spot, XpMode.CREATE))) {
    pc.mainStatus = MainStatus.ABSENT;
    return false;
  }
  await pickPcGraphic(host, spot, 0);
  await pickPcName(host, spot);

  pc.mainStatus = MainStatus.ALIVE;
  if (!inStartup) {
    pc.finishCreate();
    giveE3StartItems(host.univ, pc, false);
  }
  pc.curHealth = pc.maxHealth;
  pc.curSp = pc.maxSp;
  return true;
}

/** `delete-pc-confirm.xml` — "consign this character to the eternal void". */
export async function confirmDeletePc(host: PartyEditorHost): Promise<boolean> {
  const dlg = new XmlDialog(host.ctx, host.store, getDialogDef('delete-pc-confirm'));
  return (await host.nest(dlg)) === 'yes';
}

/**
 * `edit_party` on edit-party.xml: a row per slot with the PC's picture and
 * name, and Delete (or Create, for an empty slot), Race/Traits, Train and
 * Graphic. Clicking a name renames; clicking an empty slot's name creates.
 *
 * Returns once Done is clicked. The C++ then moves `cur_pc` off a slot that
 * no longer holds a living PC.
 */
export async function editParty(host: PartyEditorHost): Promise<void> {
  const { ctx, store, univ } = host;
  const dlg = new XmlDialog(ctx, store, getDialogDef('edit-party'));

  // `put_party_stats` (boe.dlgutil.cpp:1614).
  const putPartyStats = (): void => {
    for (let i = 0; i < 6; i++) {
      const n = i + 1;
      const pc = univ.party.pcs[i]!;
      if (pc.mainStatus !== MainStatus.ABSENT) {
        dlg.setText(`name${n}`, pc.name);
        dlg.show(`trait${n}`).show(`train${n}`).show(`pic${n}`).show(`pc${n}`);
        dlg.setText(`delete${n}`, 'Delete');
        dlg.setPictType(`pc${n}`, 'pc', pc.whichGraphic);
      } else {
        dlg.setText(`name${n}`, 'Empty.');
        dlg.hide(`trait${n}`).hide(`train${n}`).hide(`pic${n}`).hide(`pc${n}`);
        dlg.setText(`delete${n}`, 'Create');
      }
    }
    host.redraw();
  };

  // One sub-dialog at a time: the editor stays deaf while one is up, but a
  // handler runs synchronously and the chain it starts does not.
  let busy = false;
  const run = (fn: () => Promise<void>) => (): 'stay' => {
    if (busy) return 'stay';
    busy = true;
    void fn().finally(() => {
      busy = false;
      putPartyStats();
    });
    return 'stay';
  };

  const create = async (i: number): Promise<void> => {
    giveHelp(56, 0);
    await createPc(host, i, true);
  };

  for (let i = 0; i < 6; i++) {
    const n = i + 1;
    const pc = (): Player => univ.party.pcs[i]!;
    dlg.attachHandler(`name${n}`, run(async () => {
      if (pc().mainStatus === MainStatus.ABSENT) await create(i);
      else await pickPcName(host, i);
    }));
    dlg.attachHandler(`trait${n}`, run(() => pickRaceAbil(host, pc(), 0)));
    dlg.attachHandler(`train${n}`, run(async () => { await host.spendXp(i, XpMode.CREATE); }));
    dlg.attachHandler(`pic${n}`, run(async () => {
      if (pc().mainStatus === MainStatus.ABSENT) return;
      await pickPcGraphic(host, i, 1);
    }));
    // This button is also Create for an empty slot.
    dlg.attachHandler(`delete${n}`, run(async () => {
      if (pc().mainStatus !== MainStatus.ABSENT) {
        if (await confirmDeletePc(host)) pc().mainStatus = MainStatus.ABSENT;
      } else {
        await create(i);
      }
    }));
  }
  dlg.attachHandler('help', () => { giveHelp(22, 23, true); return 'stay'; });
  dlg.attachHandler('done', () => (busy ? 'stay' : 'close'));
  dlg.touchFace = editPartyTouchFace(dlg, univ);
  putPartyStats();
  await host.nest(dlg);

  if (univ.currentPc.mainStatus !== MainStatus.ALIVE) {
    const first = univ.party.pcs.findIndex((p) => p.mainStatus === MainStatus.ALIVE);
    if (first >= 0) univ.curPc = first;
  }
}

/**
 * The party editor for a finger: the six slots down the left, and down the
 * right what can be done to the one picked — Name, Delete, Race/Traits,
 * Train and Graphic, or Create for an empty slot — then Help and Done. Each
 * presses that slot's own button on the dialog.
 */
function editPartyTouchFace(dlg: XmlDialog, univ: Universe): NonNullable<XmlDialog['touchFace']> {
  let picked = 0;
  const ACTIONS: [string, string][] = [
    ['name', 'Name'], ['delete', 'Delete'], ['trait', 'Race/Traits'], ['train', 'Train'], ['pic', 'Graphic'],
  ];
  return {
    view: () => {
      const left: TouchChoice[] = univ.party.pcs.map((pc, i) => pc.mainStatus === MainStatus.ABSENT
        ? { name: `slot:${i}`, label: `${i + 1}. Empty`, on: i === picked }
        : { name: `slot:${i}`, label: `${i + 1}. ${pc.name}`, detail: `Level ${pc.level} ${RACE_NAMES[pc.race] ?? ''}`, on: i === picked });
      const pc = univ.party.pcs[picked]!;
      const right: TouchChoice[] = pc.mainStatus === MainStatus.ABSENT
        ? [{ name: 'delete', label: 'Create' }]
        : ACTIONS.map(([name, label]) => ({ name, label }));
      right.push({ name: 'help', label: 'Help' }, { name: 'done', label: 'Done' });
      const heading = pc.mainStatus === MainStatus.ABSENT ? `Slot ${picked + 1}` : pc.name;
      return { left, leftHeading: 'Party', right, rightHeading: heading };
    },
    press: (name) => {
      const slot = /^slot:(\d)$/.exec(name);
      if (slot) {
        picked = Number(slot[1]);
        return null;
      }
      if (ACTIONS.some(([a]) => a === name)) return dlg.pressControl(`${name}${picked + 1}`);
      return dlg.pressControl(name);
    },
  };
}

const RACE_NAMES: Partial<Record<Race, string>> = {
  [Race.HUMAN]: 'Human', [Race.NEPHIL]: 'Nephilim', [Race.SLITH]: 'Slithzerikai', [Race.VAHNATAI]: 'Vahnatai',
};

/**
 * `start_new_game(false)` from the startup screen, up to the point where a
 * scenario is entered: new-party.xml, the editor on the default party, then
 * `finish_create` is left to `GameSession.startNewGame`, which does it for
 * every living PC. Returns false if the player cancels or leaves nobody.
 *
 * The C++ then asks where to save (`do_save(true)`); this port does not ask:
 * the game's first save, manual or the autosave's, starts its tree.
 */
export async function startNewParty(host: PartyEditorHost): Promise<boolean> {
  const confirm = new XmlDialog(host.ctx, host.store, getDialogDef('new-party'));
  if ((await host.nest(confirm)) === 'cancel') return false;
  await editParty(host);
  return host.univ.party.pcs.some((pc) => pc.mainStatus === MainStatus.ALIVE);
}

