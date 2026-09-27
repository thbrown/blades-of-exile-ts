/**
 * The job board — `show_job_bank` and `fill_job_bank` (boe.dlgutil.cpp:794/770)
 * running on `job-board.xml`.
 *
 * The rules live in `game/jobBank.ts`; this is only the screen. Four offers
 * down the page, a Take beside each, the day along the top and the dispatcher's
 * mood along the bottom. Taking one refills the slot from the board's spares
 * and rewrites the page in place.
 *
 * *The two mismatches in the C++, ported to the file that actually exists*:
 * `show_job_bank` asks for a dialog named `job-bank` (the shipped file is
 * `job-board.xml`) and writes its mood into a control named `prompt` (that
 * file's field is `feedback`). This uses the real file and the real names.
 */

import { JobBank } from '../data/quest';
import { dispatcherMood, jobBoardOffers, takeJob } from '../game/jobBank';
import { JOB_STR, e3JobText, e3Jobs, e3JobsBase, e3JobsFull, takeE3Job } from '../game/e3Jobs';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** How many of the board's six slots the dialog has room for. */
const SHOWN_SLOTS = 4;

/** fill_job_bank — the day, the four offers, and which Take buttons exist. */
export function fillJobBank(dlg: XmlDialog, univ: Universe, bank: JobBank): void {
  dlg.setNum('day', univ.party.calcDay());
  const offers = jobBoardOffers(univ, bank);
  for (let i = 0; i < SHOWN_SLOTS; i++) {
    const offer = offers.find((o) => o.slot === i);
    if (offer) {
      dlg.show(`take${i + 1}`);
      dlg.setText(`job${i + 1}`, offer.text);
    } else {
      dlg.hide(`take${i + 1}`);
      dlg.setText(`job${i + 1}`, '');
    }
  }
}

export function jobBoardDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  univ: Universe, bank: JobBank, personality: number,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('job-board'));
  fillJobBank(dlg, univ, bank);
  dlg.setText('feedback', dispatcherMood(bank.anger));

  for (let i = 0; i < SHOWN_SLOTS; i++) {
    dlg.attachHandler(`take${i + 1}`, () => {
      const quest = univ.scenario.quests[bank.jobs[i]!];
      takeJob(univ, bank, i, personality);
      if (quest) univ.addStringToBuf(`  You take the job: ${quest.name}`);
      // The mood line becomes the acknowledgement and stays that way, which is
      // why a board you have taken two jobs from no longer tells you its mood.
      dlg.setText('feedback', 'Job accepted.');
      fillJobBank(dlg, univ, bank);
      return 'stay';
    });
  }
  return dlg;
}

/**
 * Exile III's board (`FUN_1008_40cb`, dialog 959, which `job-board.xml`
 * copies control for control): the day, the board's four jobs with a Take
 * beside each, and "You have four jobs." along the bottom, with every Take
 * hidden, once the party's four slots are full.
 */
export function e3JobBoardDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe, bank: number,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('job-board'));
  const state = e3Jobs(univ);
  const fill = (): void => {
    dlg.setNum('day', univ.party.calcDay());
    const full = e3JobsFull(state);
    dlg.setText('feedback', full ? univ.scenario.specStrs[(e3JobsBase(univ) ?? 0) + JOB_STR.fourJobs] ?? '' : '');
    for (let i = 0; i < SHOWN_SLOTS; i++) {
      const job = state.boards[bank]?.[i];
      if (job && job.kind > 0) {
        dlg.setText(`job${i + 1}`, e3JobText(univ, job, false).text);
        if (full) dlg.hide(`take${i + 1}`);
        else dlg.show(`take${i + 1}`);
      } else {
        dlg.setText(`job${i + 1}`, '');
        dlg.hide(`take${i + 1}`);
      }
    }
  };
  fill();
  for (let i = 0; i < SHOWN_SLOTS; i++) {
    dlg.attachHandler(`take${i + 1}`, () => {
      takeE3Job(univ, state, bank, i);
      fill();
      return 'stay';
    });
  }
  return dlg;
}
