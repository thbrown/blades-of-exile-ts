/**
 * The Library and Help menus' dialogs, and the lists behind pc-info's "see"
 * buttons — all read-only pages of reference text:
 *
 * - `display_spells` (boe.infodlg.cpp:134) on spell-info.xml,
 * - `display_skills` (:196) on skill-info.xml,
 * - `display_alchemy()` (:337) — the Library's alchemy text on many-str.xml,
 * - `display_alchemy(false)` (pc.editors.cpp:280) — the recipes the party
 *   knows, on pc-alchemy-info.xml,
 * - `display_pc` (pc.editors.cpp:135) — a PC's spell list on pc-spell-info.xml,
 * - `tip_of_day` (boe.dlgutil.cpp:1722),
 * - `show_dialog_action` (boe.actions.cpp:287) — a `cChoiceDlog` whose every
 *   button closes it: the help pages, welcome.xml and about-boe.xml.
 */

import { ALCHEMY_RECIPES, NUM_ALCHEMY } from '../data/alchemy';
import { SKILL_GOLD_COST, SKILL_MAX, SKILL_POINT_COST } from '../data/shop';
import { SPELLS, Spell, spellFromNum } from '../data/spell';
import { getStr } from '../data/strings';
import { GameRng } from '../core/rng';
import { SheetStore } from '../render/sheets';
import { MainStatus, Skill } from '../universe/skills';
import { Universe } from '../universe/universe';
import { DialogControl } from './dialogXml';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

export const LIBRARY_DIALOG_DEFS = [
  'spell-info', 'skill-info', 'pc-alchemy-info', 'pc-spell-info', 'tip-of-day', 'welcome',
  'about-boe', 'help-outdoor', 'help-town', 'help-combat', 'help-fields', 'help-hints',
  'help-magic', 'help-inventory',
];

/**
 * `mage_spell_pos` / `priest_spell_pos` / `skill_pos` — file-level statics in
 * the C++, so the Library reopens on the page it was left on.
 */
const spellPos: Record<'mage' | 'priest', number> = { mage: 0, priest: 0 };
let skillPos = 0;

/** `put_spell_info` (boe.infodlg.cpp:70). */
function putSpellInfo(dlg: XmlDialog, univ: Universe, kind: 'mage' | 'priest'): void {
  const pos = spellPos[kind];
  const skill = kind === 'mage' ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS;
  const spell = spellFromNum(skill, pos);
  const info = SPELLS[spell];
  dlg.setText('name', getStr('magic-names', kind === 'mage' ? pos + 1 : pos + 101));
  const cost = info?.cost ?? 0;
  dlg.setText('cost', `${info?.level ?? 0}/${cost >= 0 ? cost : '?'}`);
  const range = info?.range ?? 0;
  dlg.setText('range', range === 0 ? '' : String(range));
  let desc = getStr(kind === 'mage' ? 'mage-spells' : 'priest-spells', pos + 1);
  // The two raising spells mention resurrection balm between < and >, which
  // only a scenario that uses balm keeps.
  if (spell === Spell.RAISE_DEAD || spell === Spell.RESURRECT) {
    if (univ.scenario.featureFlags['resurrection-balm'] !== undefined) {
      desc = desc.replace('<', '').replace('>', '');
    } else {
      const start = desc.indexOf('<');
      const end = desc.indexOf('>') + 1;
      if (start >= 0 && end > start) desc = desc.slice(0, start) + desc.slice(end);
    }
  }
  dlg.setText('desc', desc);
  dlg.setText('when', getStr('spell-times', info?.when ?? 0));
}

/** `display_spells(mode, force_spell)` — `force` below 100 opens on that spell. */
export function spellInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
  kind: 'mage' | 'priest', force = 100,
): XmlDialog {
  if (force < 100) spellPos[kind] = force;
  const dlg = new XmlDialog(ctx, store, getDialogDef('spell-info'));
  const step = (by: number) => (): 'stay' => {
    spellPos[kind] = (spellPos[kind] + by + 62) % 62;
    putSpellInfo(dlg, univ, kind);
    return 'stay';
  };
  dlg.attachHandler('left', step(-1));
  dlg.attachHandler('right', step(1));
  dlg.setPict('icon', kind === 'mage' ? 14 : 15);
  putSpellInfo(dlg, univ, kind);
  dlg.setText('type', kind === 'mage' ? 'Mage Spells' : 'Priest Spells');
  return dlg;
}

/** `put_skill_info` (boe.infodlg.cpp:156). */
function putSkillInfo(dlg: XmlDialog): void {
  const skill = skillPos as Skill;
  dlg.setText('name', getStr('skills', skillPos * 2 + 1));
  dlg.setNum('skp', SKILL_POINT_COST[skill] ?? 0);
  dlg.setNum('gold', SKILL_GOLD_COST[skill] ?? 0);
  dlg.setNum('max', SKILL_MAX[skill] ?? 0);
  dlg.setText('desc', getStr('skills', skillPos * 2 + 2));
  dlg.setText('tips', getStr('tips', 1 + skillPos));
}

/** `display_skills(force_skill)` — `force` opens on that skill; out of range clamps. */
export function skillInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, force?: Skill,
): XmlDialog {
  if (force !== undefined) skillPos = force;
  skillPos = Math.max(0, Math.min(18, skillPos));
  const dlg = new XmlDialog(ctx, store, getDialogDef('skill-info'));
  dlg.attachHandler('left', () => { skillPos = skillPos === 0 ? 18 : skillPos - 1; putSkillInfo(dlg); return 'stay'; });
  dlg.attachHandler('right', () => { skillPos = (skillPos + 1) % 19; putSkillInfo(dlg); return 'stay'; });
  putSkillInfo(dlg);
  return dlg;
}

/**
 * `display_alchemy()` — the Library page: the "alchemy" string table is a
 * title, a count, and that many pages, on many-str.xml.
 */
export function alchemyHelpDialog(ctx: CanvasRenderingContext2D, store: SheetStore): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('many-str'));
  const numEntries = Number(getStr('alchemy', 2)) || 0;
  let cur = 3;
  dlg.setText('title', getStr('alchemy', 1));
  const put = (): void => { dlg.setText('str', getStr('alchemy', cur)); };
  dlg.attachHandler('left', () => { cur = cur === 3 ? numEntries + 2 : cur - 1; put(); return 'stay'; });
  dlg.attachHandler('right', () => { cur = cur === numEntries + 2 ? 3 : cur + 1; put(); return 'stay'; });
  put();
  return dlg;
}

/**
 * `display_alchemy(false)` — the recipes the party knows, each LED lit or not,
 * and none of them clickable (`cLed::noAction`).
 */
export function alchemyKnownDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('pc-alchemy-info'));
  for (let i = 0; i < NUM_ALCHEMY; i++) {
    const id = `potion${i + 1}`;
    dlg.setText(id, `${getStr('magic-names', i + 200)} (${ALCHEMY_RECIPES[i]?.difficulty ?? 0})`);
    dlg.setLed(id, univ.party.alchemy[i] ? 'red' : 'off');
    const lit = univ.party.alchemy[i] ? 'red' : 'off';
    dlg.attachHandler(id, (me) => { me.setLed(id, lit); return 'stay'; });
  }
  return dlg;
}

/**
 * `display_pc(pc, mode)` in the game's two modes (0 mage, 1 priest): the
 * sixty-two spells as LEDs, lit for those the PC knows, none clickable. The
 * arrows step through every PC who is not ABSENT — dead ones included.
 */
export function pcSpellsDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
  pcIn: number, kind: 'mage' | 'priest',
): XmlDialog {
  let pcNum = pcIn;
  if (univ.party.pcs[pcNum]?.mainStatus === MainStatus.ABSENT) {
    pcNum = Math.max(0, univ.party.pcs.findIndex((p) => p.mainStatus === MainStatus.ALIVE));
  }
  const dlg = new XmlDialog(ctx, store, getDialogDef('pc-spell-info'));
  const title = dlg.getText('title').replace('{{type}}', kind === 'mage' ? 'Mage' : 'Priest');
  const put = (): void => {
    const pc = univ.party.pcs[pcNum]!;
    const known = kind === 'mage' ? pc.mageSpells : pc.priestSpells;
    for (let i = 0; i < 62; i++) dlg.setLed(`spell${i + 1}`, known[i] ? 'red' : 'off');
    dlg.setText('title', title);
    dlg.setText('who', pc.name);
  };
  for (let i = 0; i < 62; i++) {
    const id = `spell${i + 1}`;
    dlg.setText(id, getStr('magic-names', i + (kind === 'mage' ? 1 : 101)));
    dlg.attachHandler(id, () => { put(); return 'stay'; });
  }
  const step = (by: number) => (): 'stay' => {
    do {
      pcNum = (pcNum + by + 6) % 6;
    } while (univ.party.pcs[pcNum]!.mainStatus === MainStatus.ABSENT);
    put();
    return 'stay';
  };
  dlg.attachHandler('left', step(-1));
  dlg.attachHandler('right', step(1));
  dlg.setPict('pic', kind === 'mage' ? 15 : 16); // 15 is explosion, 16 is an ankh
  put();
  return dlg;
}

/**
 * `tip_of_day` — **draws a die** for the first tip, `get_ran(1, 0, n - 51)`
 * where `n` is the size of the tips table, so opening it from the Library
 * moves the game's stream as it does in the C++. "See tips upon startup" is
 * the `GiveIntroHint` preference, written back when the dialog closes.
 */
export function tipOfDayDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, rng: GameRng, tipCount: number,
  showAtStart: boolean,
): { dlg: XmlDialog; showAtStart(): boolean } {
  let page = rng.getRan(1, 0, tipCount - 51);
  const dlg = new XmlDialog(ctx, store, getDialogDef('tip-of-day'));
  dlg.attachHandler('next', (me) => {
    page++;
    if (page === tipCount - 50) page = 0;
    me.setText('tip', getStr('tips', 50 + page));
    return 'stay';
  });
  dlg.setText('tip', getStr('tips', 50 + page));
  dlg.setLed('onstart', showAtStart ? 'red' : 'off');
  return { dlg, showAtStart: () => dlg.getLed('onstart') !== 'off' };
}

/**
 * `show_dialog_action` — `cChoiceDlog(xml).show()`: any button closes it.
 * An LED toggles itself and stays open, as it would with no handler.
 */
export function choiceDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, name: string,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef(name));
  const leds = (c: DialogControl): string[] =>
    (c.kind === 'led' ? [c.name] : c.kind === 'group' ? c.leds.map((l) => l.name) : []);
  for (const c of dlg.def.controls) for (const led of leds(c)) dlg.attachHandler(led, () => 'stay');
  return dlg;
}
