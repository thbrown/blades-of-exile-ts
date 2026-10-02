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
import { ModalScreen, type TouchChoice } from './dialog';
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
  dlg.touchFace = trainTouchFace(dlg, univ, state, mode, labelText);
  return { dlg, state };
}

/**
 * The training grid's skills, grouped for the touch face: health and spell
 * points first, as the ones most often raised, then the grid's own runs.
 */
const TRAIN_SECTIONS: readonly { title: string; skills: readonly Skill[] }[] = [
  { title: 'Health & Spell Points', skills: [Skill.MAX_HP, Skill.MAX_SP] },
  { title: 'Main Stats', skills: [Skill.STRENGTH, Skill.DEXTERITY, Skill.INTELLIGENCE] },
  { title: 'Combat Skills', skills: [
    Skill.EDGED_WEAPONS, Skill.BASHING_WEAPONS, Skill.POLE_WEAPONS,
    Skill.THROWN_MISSILES, Skill.ARCHERY, Skill.DEFENSE] },
  { title: 'Magic Skills', skills: [Skill.MAGE_SPELLS, Skill.PRIEST_SPELLS, Skill.MAGE_LORE, Skill.ALCHEMY] },
  { title: 'Other Skills', skills: [
    Skill.ITEM_LORE, Skill.DISARM_TRAPS, Skill.LOCKPICKING, Skill.ASSASSINATION, Skill.POISON, Skill.LUCK] },
];

/**
 * The training grid for a finger: the skills down the left in sections, each
 * with its level and the cost of the next, and down the right a −/+ pair for
 * the one picked, then the dialog's own buttons. Unlike the grid, where each
 * skill has a pair of its own, a skill is picked first and then raised or
 * lowered. Only skills the grid shows a − or + for are listed: the rest can't
 * be changed. The pair presses the grid's own `-m`/`-p` buttons, so the rules,
 * refusals and the Anama warning are all the dialog's.
 */
function trainTouchFace(
  dlg: XmlDialog, univ: Universe, state: SpendXp, mode: XpMode, labelText: Map<string, string>,
): NonNullable<XmlDialog['touchFace']> {
  let picked: string = 'hp';
  const changeable = (id: string): boolean => dlg.isVisible(`${id}-p`) || dlg.isVisible(`${id}-m`);
  return {
    view: () => {
      const left: TouchChoice[] = [];
      for (const { title, skills } of TRAIN_SECTIONS) {
        let first = true;
        for (const skill of skills) {
          const id: string = (skillNames as readonly string[])[skill]!;
          if (!changeable(id)) continue;
          const atMax = state.cur(skill) === xpSkillMax(skill);
          const cost = mode >= XpMode.EDIT || atMax ? ''
            : ` · next ${state.cost(skill)} pt${state.cost(skill) !== 1 ? 's' : ''}.${mode === XpMode.TRAIN ? `/${state.goldCost(skill)}gp` : ''}`;
          left.push({
            name: `skill:${id}`, label: labelText.get(id) ?? id,
            detail: `Level ${state.cur(skill)}${atMax ? ' (MAX)' : cost}`, on: id === picked,
            ...(first ? { section: title } : {}),
          });
          first = false;
        }
      }
      // The pick follows the list: a skill that can no longer move (its last
      // point spent) gives way to the first that still can.
      if (!left.some((c) => c.name === `skill:${picked}`) && left[0]) {
        picked = left[0].name.slice('skill:'.length);
        left[0].on = true;
      }
      const right: TouchChoice[] = [];
      if (left.length > 0) {
        const name = labelText.get(picked) ?? picked;
        right.push(
          { name: 'plus', label: `+ ${name}`, disabled: !dlg.isVisible(`${picked}-p`) },
          { name: 'minus', label: `− ${name}`, disabled: !dlg.isVisible(`${picked}-m`) },
        );
      }
      if (dlg.isVisible('left')) {
        right.push({ name: 'left', label: '◀ Previous PC' }, { name: 'right', label: 'Next PC ▶' });
      }
      right.push(
        { name: 'help', label: 'Help' },
        { name: 'cancel', label: 'Cancel', section: '' },
        { name: 'keep', label: 'Keep' },
      );
      const pc = univ.party.pcs[state.who]!;
      const who = mode === XpMode.CREATE && pc.mainStatus !== MainStatus.ALIVE ? 'New PC' : pc.name;
      const purse = `${state.skp} skill pts.${mode === XpMode.TRAIN ? `, ${state.gold} gold` : ''}`;
      return {
        left, leftHeading: left.length > 0 ? `Train ${who}` : `${who}: nothing to train`, right, rightHeading: purse,
      };
    },
    press: (name) => {
      const skill = /^skill:(.+)$/.exec(name);
      if (skill) {
        picked = skill[1]!;
        return null;
      }
      if (name === 'plus' || name === 'minus') {
        const control = `${picked}-${name === 'plus' ? 'p' : 'm'}`;
        return dlg.isVisible(control) ? dlg.pressControl(control) : null;
      }
      return dlg.pressControl(name);
    },
  };
}
