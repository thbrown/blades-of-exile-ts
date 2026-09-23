/**
 * `cPictChoice` (pictchoice.cpp) — pick one picture out of a list, thirty-six
 * to a page, with arrows that wrap from the last page to the first. The paging
 * rules are here so the dialog and the replay driver share them; the dialog is
 * `dialogs/pictChoiceDialog.ts`.
 */

export class PictChoiceState {
  static readonly PER_PAGE = 36;
  page: number;
  cur: number;

  /** `show(cur_sel)` — an out-of-range starting pick becomes the first. */
  constructor(readonly count: number, start: number) {
    this.cur = start >= 0 && start < count ? start : 0;
    this.page = Math.trunc(this.cur / PictChoiceState.PER_PAGE);
  }

  get lastPage(): number {
    return Math.trunc((this.count - 1) / PictChoiceState.PER_PAGE);
  }

  /** The list index shown in slot `i` (0-35) of the current page, or -1. */
  slot(i: number): number {
    const at = this.page * PictChoiceState.PER_PAGE + i;
    return at < this.count ? at : -1;
  }

  /** A click by control name — `left`, `right`, `ledN`, `done`, `cancel`. */
  click(id: string): 'stay' | 'done' | 'cancel' {
    if (id === 'done') return 'done';
    if (id === 'cancel') return 'cancel';
    if (id === 'left') {
      this.page = this.page === 0 ? this.lastPage : this.page - 1;
      return 'stay';
    }
    if (id === 'right') {
      this.page = this.page === this.lastPage ? 0 : this.page + 1;
      return 'stay';
    }
    const led = /^led(\d+)$/.exec(id);
    if (led) this.cur = this.page * PictChoiceState.PER_PAGE + Number(led[1]) - 1;
    // `group` is the LED group itself; the LED that took focus follows it.
    return 'stay';
  }
}
