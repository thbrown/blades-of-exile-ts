/**
 * The party's three journals — `talk_notes`, `adventure_notes` and `journal`
 * (boe.infodlg.cpp:594, :530 and :653) — running on `talk-notes.xml`,
 * `adventure-notes.xml` and `event-journal.xml`. Options > Talk Notes,
 * Encounter Notes and Journal open them. The paging and deleting rules are `game/notes.ts`'s; this is only
 * the screen.
 */

import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { EncounterNotesPager, EventJournalPager, TalkNotesPager } from '../game/notes';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

export const NOTES_DIALOG_DEFS = ['talk-notes', 'adventure-notes', 'event-journal'];

export function talkNotesDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
): XmlDialog {
  const pager = new TalkNotesPager(univ.party.talkSave);
  const dlg = new XmlDialog(ctx, store, getDialogDef('talk-notes'));
  const putTalk = (): void => {
    const note = pager.shown;
    if (!note) return;
    dlg.setText('loc', note.inTown);
    dlg.setText('who', note.whoSaid);
    dlg.setText('str1', note.str1);
    dlg.setText('str2', note.str2);
  };
  for (const id of ['left', 'right', 'del']) {
    dlg.attachHandler(id, () => {
      if (pager.click(id)) return 'close';
      putTalk();
      return 'stay';
    });
  }
  putTalk();
  if (!pager.arrows) {
    dlg.hide('left');
    dlg.hide('right');
  }
  return dlg;
}

export function adventureNotesDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
): XmlDialog {
  const pager = new EncounterNotesPager(univ.party.specialNotes);
  const dlg = new XmlDialog(ctx, store, getDialogDef('adventure-notes'));
  const fill = (): void => {
    pager.rows.forEach((note, i) => {
      dlg.setText(`str${i + 1}`, note?.theStr ?? '');
      if (note) dlg.show(`del${i + 1}`);
      else dlg.hide(`del${i + 1}`);
    });
  };
  for (const id of ['left', 'right', 'del1', 'del2', 'del3']) {
    dlg.attachHandler(id, () => {
      if (pager.click(id)) return 'close';
      fill();
      return 'stay';
    });
  }
  fill();
  if (!pager.arrows) {
    dlg.hide('left');
    dlg.hide('right');
  }
  return dlg;
}

export function eventJournalDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
): XmlDialog {
  const pager = new EventJournalPager(univ.party.journal);
  const dlg = new XmlDialog(ctx, store, getDialogDef('event-journal'));
  const fill = (): void => {
    pager.rows.forEach((entry, i) => {
      dlg.setText(`str${i + 1}`, entry?.theStr ?? '');
      dlg.setText(`day${i + 1}`, entry ? `Day: ${entry.day}` : '');
    });
  };
  for (const id of ['left', 'right']) {
    dlg.attachHandler(id, () => {
      if (pager.click(id)) return 'close';
      fill();
      return 'stay';
    });
  }
  fill();
  if (!pager.arrows) {
    dlg.hide('left');
    dlg.hide('right');
  }
  return dlg;
}
