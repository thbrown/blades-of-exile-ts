/**
 * Exile III's job boards: couriers' work handed out by six boards and paid on
 * delivery. E3's jobs are *generated*, not authored, so BoE's quests (a fixed
 * list the scenario writes) cannot hold them. This is E3's own system, ported
 * from EXILE3.EXE:
 *
 * - `FUN_1008_3c91` fills all six boards (a new party, and every 4,000 ticks);
 * - `FUN_1008_40cb`/`FUN_1008_3e97` show a board and take a job from it;
 * - `FUN_10d0_2540` writes a job's text and works out its pay;
 * - `FUN_1020_1484` (start_talk_mode) pays for a delivery;
 * - `FUN_1010_5889` (the per-tick clock) fails a job past its deadline;
 * - `FUN_10c0_5051` (kill_monst) takes the body a "magical supplies" job wants.
 *
 * An blades-of-exile-ts extension, not in BoE or OBoE: a scenario with the feature flag
 * `job-boards` set to `exile3:<n>` has them, and `n` is the first of the
 * scenario strings the converter wrote for them (`JOB_STR` below). The text
 * comes from the scenario, since it is E3's; the numbers here are E3's too,
 * copied from its data segments at the addresses given, and
 * `test/e3convert.test.ts` reads them back out of the EXE to check them.
 *
 * The state lives in the party record in E3 (party+0x832f on), and here in
 * `Party.e3Jobs`, saved on its own page (`E3JOBS`).
 */

import type { Universe } from '../universe/universe';
import type { GameSession } from './session';
import { PIC_SCEN } from '../data/special';

/** One job, E3's 12-byte record (party+0x835f + bank*0x30 + job*0xc). */
export interface E3Job {
  /** +0: 0 none, 1 message, 2 delivery, 3 magical supplies, 4 rush delivery, 5 rush message. */
  kind: number;
  /** +4: the goods (2, 4), or the monster to slay (3; -1 once its body is taken). */
  extra: number;
  /** +6: days to do it in, on a board; the last day it may be done, once taken. */
  days: number;
  /** +8: whom it goes to, an index into the `E3_JOB_TARGET_*` tables. */
  target: number;
  /** +10: the board that gave it out. */
  bank: number;
}

export interface E3JobState {
  /** Six boards of four jobs. */
  boards: E3Job[][];
  /** The party's four jobs (party+0x832f). */
  held: E3Job[];
  /**
   * party+0x847f: the party missed a deadline for this board, which refuses
   * it work until a daily 1-in-51 roll forgives it.
   */
  failed: boolean[];
}

export const E3_JOB_BANKS = 6;
export const E3_JOBS_PER_BOARD = 4;
export const E3_JOBS_HELD = 4;

/**
 * `1100:0000` — each target's personality, E3's (1-based; the engine's is one
 * less), or -1 for no target. Talking to that person delivers the job.
 */
export const E3_JOB_TARGET_PERSONALITY = [
  89, 95, 98, 100, 102, 135, 185, 138, 143, 191, 171, 165, 145, 153, 211, 212, 204, 207, 216, 220,
  219, 263, 265, 233, 244, 272, 281, 285, 306, 309, 304, 354, 356, 357, 358, 324, 330, -1, -1, -1,
];

/** `1100:0050` — where each target lives, as a zone of the world (x, y). */
export const E3_JOB_TARGET_LOCS: [number, number][] = [
  [2, 9], [2, 9], [1, 9], [0, 9], [0, 9], [2, 8], [1, 6], [2, 7], [0, 6], [2, 5],
  [0, 7], [1, 6], [0, 6], [0, 6], [3, 7], [2, 6], [4, 7], [4, 9], [5, 8], [6, 9],
  [5, 9], [6, 6], [6, 6], [3, 6], [3, 6], [3, 4], [3, 4], [3, 4], [1, 4], [0, 3],
  [2, 3], [6, 1], [6, 1], [3, 2], [3, 2], [6, 2], [6, 2], [0, 0], [0, 0], [0, 0],
];

/** `DS:02ae` — where each board is, as a zone of the world (x, y). */
export const E3_JOB_BANK_LOCS: [number, number][] = [[2, 9], [0, 6], [3, 6], [3, 4], [6, 2], [0, 0]];

/**
 * The converter's strings, from the flag's base. E3 keeps the names and
 * messages in its string table (list 19, strings 5700 on) and the formats in
 * its code segment (`10d0:2308` on).
 */
export const JOB_STR = {
  /** 40: whom each target is, `5701 + target`. */
  targets: 0,
  /** 16: the goods, `5740 + extra`. */
  goods: 40,
  /** 5: what the recipient says, by kind 1–5 (5761–5765). */
  delivered: 56,
  /** 5770: a deadline missed. */
  deadline: 61,
  /** 5771: a supplies job's recipient, before its monster is slain. */
  noBody: 62,
  /** 5772: the monster slain. */
  bodyTaken: 63,
  /** "within %d days", "by Day %d". */
  within: 64,
  byDay: 65,
  /** "We need someone to" / "You must", then the same with "convey" and "deliver". */
  need: 66,
  must: 67,
  needConvey: 68,
  mustConvey: 69,
  needDeliver: 70,
  mustDeliver: 71,
  /** The six formats: message, delivery, supplies (parts), supplies (slay), rush delivery, rush message. */
  formats: 72,
  /** `1008:40b6`, "You have four jobs.". */
  fourJobs: 78,
  /** `1020:1d00`, the talk reply once the board closes. */
  business: 79,
  /** `10d0:0b26`, the item panel's title over the party's jobs. */
  panelTitle: 80,
  count: 81,
} as const;

/** The first of the job strings, or null in a scenario without E3's job boards. */
export function e3JobsBase(univ: Universe): number | null {
  const flag = univ.scenario.featureFlags['job-boards'];
  if (flag === undefined || !flag.startsWith('exile3:')) return null;
  const base = Number(flag.slice('exile3:'.length));
  return Number.isInteger(base) && base >= 0 ? base : null;
}

function jobStr(univ: Universe, which: number): string {
  const base = e3JobsBase(univ) ?? 0;
  return univ.scenario.specStrs[base + which] ?? '';
}

const emptyJob = (): E3Job => ({ kind: 0, extra: 0, days: 0, target: 0, bank: 0 });

/**
 * The party's job state, made (and the boards filled) the first time it is
 * needed. E3 fills the boards when a party is made (`FUN_10b0_053c`); nothing
 * a player can see depends on the draws happening that early.
 */
export function e3Jobs(univ: Universe): E3JobState {
  let state = univ.party.e3Jobs;
  if (!state) {
    state = {
      boards: Array.from({ length: E3_JOB_BANKS }, () => Array.from({ length: E3_JOBS_PER_BOARD }, emptyJob)),
      held: Array.from({ length: E3_JOBS_HELD }, emptyJob),
      failed: new Array<boolean>(E3_JOB_BANKS).fill(false),
    };
    univ.party.e3Jobs = state;
    generateE3Jobs(univ, state);
  }
  return state;
}

/** `FUN_1080_0000`: the distance between two zones, truncated. */
export function e3ZoneDistance(a: [number, number], b: [number, number]): number {
  return Math.trunc(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2));
}

const bankToTarget = (bank: number, target: number): number =>
  e3ZoneDistance(E3_JOB_BANK_LOCS[bank] ?? [0, 0], E3_JOB_TARGET_LOCS[target] ?? [0, 0]);

/**
 * `FUN_1008_3c91`: every board's four jobs, rolled afresh. A job with no
 * target, or whose target is in the board's own zone, is no job. Note the
 * kind and target are drawn even then, and that a job's days are drawn after
 * its goods or monster.
 */
export function generateE3Jobs(univ: Universe, state: E3JobState): void {
  const rng = univ.rng;
  for (let bank = 0; bank < E3_JOB_BANKS; bank++) {
    for (let j = 0; j < E3_JOBS_PER_BOARD; j++) {
      const job = state.boards[bank]![j]!;
      let kind = rng.getRan(1, 0, 5);
      const target = rng.getRan(1, 0, 39);
      if ((E3_JOB_TARGET_PERSONALITY[target] ?? -1) < 0) kind = 0;
      job.target = target;
      job.bank = bank;
      const dist = bankToTarget(bank, target);
      if (dist === 0) kind = 0;
      job.kind = kind;
      // E3 leaves a slot's other fields as they were when it rolls no job.
      switch (kind) {
        case 1:
          job.days = rng.getRan(1, 0, 3) + (dist + 1) * 3;
          break;
        case 2:
          job.extra = rng.getRan(1, 0, 9);
          job.days = rng.getRan(1, 0, 4) + (dist + 1) * 3;
          break;
        case 3:
          job.extra = rng.getRan(1, 0, 1) === 0 ? rng.getRan(1, 0x3a, 0x58) : rng.getRan(1, 0x73, 0x89);
          job.days = rng.getRan(2, 1, 6) + (dist + 1) * 5 + 10;
          break;
        case 4:
        case 5:
          job.extra = rng.getRan(1, 10, 15);
          job.days = rng.getRan(1, 0, 1) + dist;
          break;
      }
    }
  }
}

/** The C runtime's `sprintf`, for E3's `%s` and `%d`. */
function format(fmt: string, args: (string | number)[]): string {
  let i = 0;
  return fmt.replace(/%[sd]/g, () => String(args[i++] ?? ''));
}

/**
 * `FUN_10d0_2540`: a job's text and its pay. `held` is the party's own list
 * ("You must … by Day n"); a board's says "We need someone to … within n
 * days". Pay grows with the distance from the board to the target.
 */
export function e3JobText(univ: Universe, job: E3Job, held: boolean): { text: string; pay: number } {
  if (job.kind <= 0) return { text: '', pay: 0 };
  const s = (k: number) => jobStr(univ, k);
  const who = s(held ? JOB_STR.must : JOB_STR.need);
  const time = format(s(held ? JOB_STR.byDay : JOB_STR.within), [job.days]);
  const target = s(JOB_STR.targets + job.target);
  const dist = bankToTarget(job.bank, job.target);
  const goods = s(JOB_STR.goods + job.extra);
  switch (job.kind) {
    case 1: {
      const pay = dist * 60 + 60;
      return { text: format(s(JOB_STR.formats), [s(held ? JOB_STR.mustConvey : JOB_STR.needConvey), target, time, pay]), pay };
    }
    case 2: {
      const pay = dist * 70 + 75;
      return { text: format(s(JOB_STR.formats + 1), [who, goods, target, time, pay]), pay };
    }
    case 3: {
      const pay = dist * 150 + 400;
      if (job.extra < 0) return { text: format(s(JOB_STR.formats + 2), [who, target, time, pay]), pay };
      const monster = univ.scenario.scenMonsters[job.extra]?.name ?? '';
      return { text: format(s(JOB_STR.formats + 3), [who, monster, target, time, pay]), pay };
    }
    case 4: {
      const pay = dist * 140 + 200;
      return { text: format(s(JOB_STR.formats + 4), [who, goods, target, time, pay]), pay };
    }
    case 5: {
      const pay = dist * 120 + 150;
      return { text: format(s(JOB_STR.formats + 5), [s(held ? JOB_STR.mustDeliver : JOB_STR.needDeliver), target, time, pay]), pay };
    }
    default:
      return { text: '', pay: 0 };
  }
}

/**
 * The party's jobs as the item panel lists them (`FUN_10d0_0b5b`, "Your
 * current jobs:"): slot numbers with a job in them. E3 shows two at a time.
 */
export function e3HeldJobs(univ: Universe): number[] {
  const held = univ.party.e3Jobs?.held ?? [];
  return held.flatMap((j, k) => (j.kind > 0 ? [k] : []));
}

/** How many jobs the item panel has room for at once. */
export const E3_JOBS_ON_PANEL = 2;

/** Whether all four of the party's slots are taken (`FUN_1008_40cb`'s test). */
export function e3JobsFull(state: E3JobState): boolean {
  return state.held.every((j) => j.kind !== 0);
}

/**
 * `FUN_1008_3e97`, a Take button: the job goes into the party's first free
 * slot, its days become a date, and it leaves the board. False when there is
 * no free slot (E3 hides the buttons then) or nothing to take.
 */
export function takeE3Job(univ: Universe, state: E3JobState, bank: number, slot: number): boolean {
  const job = state.boards[bank]?.[slot];
  if (!job || job.kind <= 0) return false;
  const free = state.held.findIndex((j) => j.kind === 0);
  if (free < 0) return false;
  state.held[free] = { ...job, days: job.days + univ.party.calcDay() };
  job.kind = 0;
  return true;
}

function message(session: GameSession, which: number): Promise<void> {
  const univ = session.univ;
  const text = jobStr(univ, which);
  if (!session.host) {
    univ.addStringToBuf(text);
    return Promise.resolve();
  }
  return session.host.message(text, '', '', univ.scenario.introPic, PIC_SCEN);
}

/**
 * `FUN_1020_1484`'s deliveries, as a conversation starts: each of the
 * party's jobs whose target this is gets paid and ends, except a supplies
 * job whose monster is still alive, which only earns a reminder.
 */
export async function deliverE3Jobs(session: GameSession, personality: number): Promise<void> {
  const univ = session.univ;
  if (e3JobsBase(univ) === null || !univ.party.e3Jobs) return;
  const state = univ.party.e3Jobs;
  for (const job of state.held) {
    if (job.kind <= 0 || (E3_JOB_TARGET_PERSONALITY[job.target] ?? -1) - 1 !== personality) continue;
    if (job.kind === 3 && job.extra > 0) {
      await message(session, JOB_STR.noBody);
      continue;
    }
    await message(session, JOB_STR.delivered + job.kind - 1);
    univ.party.gold += e3JobText(univ, job, false).pay;
    job.kind = 0;
  }
}

/**
 * `FUN_10c0_5051`'s part: a slain monster of a supplies job's kind gives up
 * its body. Every such job takes one, each with its own message.
 */
export function e3JobKill(session: GameSession | undefined, monster: number): void {
  const univ = session?.univ;
  if (!univ || e3JobsBase(univ) === null || !univ.party.e3Jobs) return;
  for (const job of univ.party.e3Jobs.held) {
    if (job.kind !== 3 || job.extra !== monster) continue;
    void message(session!, JOB_STR.bodyTaken);
    job.extra = -1;
  }
}

/**
 * The job boards' share of E3's clock (`FUN_1010_5889`), from `ageBefore` to
 * the party's age now. Each new day, every board has a 1-in-51 chance of
 * forgiving a missed deadline, and then any job past its date fails and
 * angers its board. At every 4,000 ticks the boards are rolled afresh.
 *
 * E3 steps its clock one move at a time and tests `age % 4000 == 0`; this
 * port's clock can jump several ticks at once, so both tests are "was the
 * mark crossed", once for each day or 4,000 crossed.
 */
export function e3JobsTick(session: GameSession, ageBefore: number): void {
  const univ = session.univ;
  if (e3JobsBase(univ) === null) return;
  const state = e3Jobs(univ);
  const age = univ.party.age;
  const dayOf = (a: number) => Math.floor(a / 3700) + 1;
  for (let day = dayOf(ageBefore) + 1; day <= dayOf(age); day++) {
    for (let bank = 0; bank < E3_JOB_BANKS; bank++) {
      if (univ.rng.getRan(1, 0, 50) === 25) state.failed[bank] = false;
    }
    for (const job of state.held) {
      if (job.kind <= 0 || day <= job.days) continue;
      void message(session, JOB_STR.deadline);
      state.failed[job.bank] = true;
      job.kind = 0;
    }
  }
  for (let k = Math.floor(ageBefore / 4000) + 1; k <= Math.floor(age / 4000); k++) generateE3Jobs(univ, state);
}
