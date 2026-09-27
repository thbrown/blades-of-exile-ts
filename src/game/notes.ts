/**
 * The rules behind the party's three journals — `talk_notes_event_filter`,
 * `adventure_notes_event_filter` and `journal_event_filter`
 * (boe.infodlg.cpp:573, :499 and :624) — apart from
 * any screen, so that the dialogs and the replay driver run the same code.
 * They are two ports of one C++ function otherwise, and have drifted before.
 */

import { GameMode } from './modes';
import { Universe } from '../universe/universe';
import { EncNote, JournalEntry, TalkNote } from '../universe/party';

export type NotesKind = 'talk' | 'encounter' | 'events';

/**
 * Why a journal will not open, or null when it will. Both only open when there
 * is something in them, and `talk_notes` alone also refuses while a
 * conversation is on screen. The C++ prints these rather than showing a dialog.
 */
export function notesRefusal(univ: Universe, mode: GameMode, which: NotesKind): string | null {
  if (which === 'talk') {
    if (mode === GameMode.TALKING) return "Talking notes: Can't read while talking.";
    if (univ.party.talkSave.length === 0) return 'Nothing in your talk journal.';
    return null;
  }
  if (which === 'events')
    return univ.party.journal.length === 0 ? 'Nothing in your events journal.' : null;
  if (univ.party.specialNotes.length === 0) return 'Nothing in your journal.';
  return null;
}

/**
 * `talk_notes` — one saved reply per page. Left and right wrap; Delete removes
 * the page shown and closes the journal when that was the last one.
 */
export class TalkNotesPager {
  /** `store_page_on`. */
  page = 0;
  /** `store_num_i`. */
  count: number;
  /**
   * The C++ hides both arrows only when the journal *opens* with one page, and
   * leaves them up when deleting brings it down to one ("TODO: if
   * store_num_i==1, we must also hide the right/left buttons"). Harmless — both
   * then wrap to the page already shown.
   */
  readonly arrows: boolean;

  constructor(private notes: TalkNote[]) {
    this.count = notes.length;
    this.arrows = this.count > 1;
  }

  /** The note `put_talk` (:565) shows — nothing once the page has run off the end. */
  get shown(): TalkNote | undefined {
    return this.page < this.count ? this.notes[this.page] : undefined;
  }

  /** One click. Returns whether the journal closes. */
  click(id: string): boolean {
    if (id === 'done') return true;
    if (id === 'left') this.page = this.page === 0 ? this.count - 1 : this.page - 1;
    else if (id === 'right') this.page = this.page === this.count - 1 ? 0 : this.page + 1;
    else if (id === 'del') {
      this.notes.splice(this.page, 1);
      if (this.page === this.count - 1) this.page = 0;
      if (--this.count === 0) return true;
    }
    return false;
  }
}

/**
 * `adventure_notes` — the encounter notes, three to a page, each with its own
 * Delete. Only the note's text is shown; where it was found is kept but not
 * displayed.
 */
export class EncounterNotesPager {
  page = 0;
  /**
   * `store_num_i` is taken once, when the journal opens, and **deleting does
   * not update it** — so the page the arrows wrap at stays where it started,
   * and paging onto a page the deletions emptied shows three blank rows. Kept
   * as written.
   */
  readonly count: number;
  readonly arrows: boolean;

  constructor(private notes: EncNote[]) {
    this.count = notes.length;
    this.arrows = this.count > 3;
  }

  private get lastPage(): number {
    return Math.floor((this.count - 1) / 3);
  }

  /** The three rows of the page shown; undefined is a blank row with no Delete. */
  get rows(): (EncNote | undefined)[] {
    return [0, 1, 2].map((i) => this.notes[this.page * 3 + i]);
  }

  click(id: string): boolean {
    if (id === 'done') return true;
    if (id === 'left') this.page = this.page === 0 ? this.lastPage : this.page - 1;
    else if (id === 'right') this.page = this.page === this.lastPage ? 0 : this.page + 1;
    else if (id.startsWith('del')) {
      // A Delete is hidden beside a blank row, so the index always exists.
      const n = Number(id.slice(3)) - 1;
      this.notes.splice(this.page * 3 + n, 1);
    }
    return false;
  }
}

/**
 * `journal` (boe.infodlg.cpp:653) — the events journal, three entries to a
 * page, each with its day. Left and right wrap; there is no Delete.
 *
 * OBoE's `fill_journal` indexes `journal[i]` without the page, so every page
 * shows the first three entries. Nothing in OBoE ever adds one, so nobody
 * could see that; Exile III, whose journal this is, pages properly
 * (`FUN_1008_3507`), and so does this. See DIVERGENCES.md.
 */
export class EventJournalPager {
  page = 0;
  readonly count: number;
  readonly arrows: boolean;

  constructor(private entries: JournalEntry[]) {
    this.count = entries.length;
    this.arrows = this.count > 3;
  }

  private get lastPage(): number {
    return Math.floor((this.count - 1) / 3);
  }

  /** The three rows of the page shown; undefined is a blank row. */
  get rows(): (JournalEntry | undefined)[] {
    return [0, 1, 2].map((i) => this.entries[this.page * 3 + i]);
  }

  click(id: string): boolean {
    if (id === 'done') return true;
    if (id === 'left') this.page = this.page === 0 ? this.lastPage : this.page - 1;
    else if (id === 'right') this.page = this.page === this.lastPage ? 0 : this.page + 1;
    return false;
  }
}
