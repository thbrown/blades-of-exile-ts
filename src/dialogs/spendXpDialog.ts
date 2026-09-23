/**
 * `spend_xp` (pc.editors.cpp:644) on `spend-xp.xml` — the skill grid, with a
 * −/+ pair beside every skill, health and spell points. The rules are
 * `SpendXp`'s (`game/createPc.ts`); this is `draw_xp_skills` and the two event
 * filters around it.
 *
 * `draw_xp_skills` (pc.editors.cpp:391) colours each number by what it can
 * still do — green if it can go up, red if only down, white if neither — and
 * hides the buttons that would be refused. Each label carries the step's cost,
 * "(3 pts.)", or "(3 pts./50gp)" at a trainer, or "(MAX)".
 */

import { skillNames } from '../data/enumTags';
import { getStr } from '../data/strings';
import { SpendXp, XpMode, xpSkillMax } from '../game/createPc';
import { SheetStore } from '../render/sheets';
import { giveHelp } from '../universe/living';
import { MainStatus, Skill } from '../universe/skills';
import { Universe } from '../universe/universe';
import { ModalScreen } from './dialog';
import { getDialogDef } from './dialogStore';
import { strDialog } from './strDialog';
import { XmlDialog } from './xmlDialog';

export const SPEND_XP_DIALOG_DEFS = ['spend-xp', 'confirm-spend-xp'];

/** LABEL_OFFSET_COL1 / COL2 — the two columns' label widths, halved as addLabelFor doubles them. */
const LABEL_OFFSET_COL1 = 85;
const LABEL_OFFSET_COL2 = 74;

export interface SpendXpHost {
  /** Open a dialog on top of this one (the confirm box, a warning). */
  nest(screen: ModalScreen): Promise<string>;
  /** `display_skills` for one skill — the Alt-click description. */
  showSkillInfo?(skill: Skill): void;
  /** Repaint after an asynchronous change. */
  redraw(): void;
}

export function spendXpDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
  who: number, mode: XpMode, host: SpendXpHost,
): { dlg: XmlDialog; state: SpendXp } {
  const dlg = new XmlDialog(ctx, store, getDialogDef('spend-xp'));
  const state = new SpendXp(univ, who, mode);

  // Making a new PC, you can't switch to train the others.
  if (mode === XpMode.CREATE) dlg.hide('left').hide('right');
  if (mode !== XpMode.TRAIN) dlg.hide('gold-label').hide('gold');

  const labelText = new Map<string, string>();
  labelText.set('hp', 'Health');
  labelText.set('sp', 'Spell Pts.');
  for (let i = 0; i < 19; i++) labelText.set(skillNames[i]!, getStr('skills', 1 + 2 * i));

  // `addLabelFor` runs once, before anything is coloured, so every label
  // starts — and stays — the default white (pc.editors.cpp:696).
  for (let i = 0; i <= 20; i++) {
    const id = skillNames[i]!;
    dlg.setLabel(id, labelText.get(id) ?? '', 'left',
      i < 9 || i >= 19 ? LABEL_OFFSET_COL1 : LABEL_OFFSET_COL2, true);
  }

  const draw = (): void => {
    const pc = univ.party.pcs[state.who]!;
    dlg.setText('recipient',
      mode === XpMode.CREATE && pc.mainStatus !== MainStatus.ALIVE ? 'New PC' : pc.name);
    for (let i = 0; i <= 20; i++) {
      const skill = i as Skill;
      const id = skillNames[i]!;
      // White means it can't change, red only down, green up.
      let colour = 'white';
      dlg.hide(`${id}-m`).hide(`${id}-p`);
      if (state.canChange(skill, false)) {
        dlg.show(`${id}-m`);
        colour = 'red';
      }
      if (state.canChange(skill, true)) {
        dlg.show(`${id}-p`);
        colour = 'light-green';
      }
      dlg.setColour(id, colour);
      dlg.setNum(id, state.cur(skill));
      // `add_cost_to_label`: health and spell points test the PC's *own*
      // maximum, the skills the working copy's (pc.editors.cpp:420).
      const atMax = i === Skill.MAX_HP ? pc.maxHealth === xpSkillMax(Skill.MAX_HP)
        : i === Skill.MAX_SP ? pc.maxSp === xpSkillMax(Skill.MAX_SP)
          : state.cur(skill) === xpSkillMax(skill);
      let label = labelText.get(id) ?? '';
      if (atMax) label += ' (MAX)';
      else if (mode < XpMode.EDIT) {
        const skp = state.cost(skill);
        label += ` (${skp} pt${skp !== 1 ? 's' : ''}.`;
        if (mode === XpMode.TRAIN) label += `/${state.goldCost(skill)}gp`;
        label += ')';
      }
      dlg.setLabel(id, label, 'left', i < 9 || i >= 19 ? LABEL_OFFSET_COL1 : LABEL_OFFSET_COL2, true);
    }
    dlg.setNum('gold', mode === XpMode.CREATE ? 0 : state.gold);
    dlg.setNum('skp', state.skp);
  };

  const anamaWarning = (): void => {
    void host.nest(strDialog(ctx, store, {
      str1: 'The oaths of an Anama member include eschewing research into arcane magics. '
        + 'By increasing your mage spells skill, you will be in violation of this oath. '
        + 'If you keep this change, you will be afflicted with a terrible permanent curse.',
      title: 'The Anama Curse', pic: 41, picType: 5,
    }));
  };

  const onStep = (id: string, alt: boolean) => (): 'stay' => {
    const what = state.click(id, alt);
    if (state.anamaWarning) anamaWarning();
    if (what === 'info') {
      const which = skillNames.indexOf(id.slice(0, -2) as (typeof skillNames)[number]);
      if (which >= 0) host.showSkillInfo?.(which as Skill);
    }
    draw();
    return 'stay';
  };
  for (let i = 0; i <= 20; i++) {
    const id = skillNames[i]!;
    dlg.attachHandler(`${id}-m`, onStep(`${id}-m`, false));
    dlg.attachHandler(`${id}-p`, onStep(`${id}-p`, false));
  }

  // `spend_xp_navigate_filter` (pc.editors.cpp:482).
  dlg.attachHandler('keep', () => { state.keep(); return 'close'; });
  dlg.attachHandler('cancel', () => 'close');
  dlg.attachHandler('help', () => { giveHelp(10, 11, true); return 'stay'; });
  for (const dir of ['left', 'right'] as const) {
    dlg.attachHandler(dir, () => {
      if (!state.needsConfirm) {
        state.switchPc(dir);
        draw();
        return 'stay';
      }
      // `confirm_switch_pc`: Keep saves this PC first, Discard just moves on,
      // Cancel stays put.
      const confirm = new XmlDialog(ctx, store, getDialogDef('confirm-spend-xp'));
      confirm.setText('keep-msg',
        confirm.getText('keep-msg').replace('{{PC}}', univ.party.pcs[state.who]!.name));
      void host.nest(confirm).then((choice) => {
        if (choice === 'cancel') return;
        if (choice === 'keep') state.keep();
        state.switchPc(dir);
        draw();
        host.redraw();
      });
      return 'stay';
    });
  }
  draw();
  return { dlg, state };
}
