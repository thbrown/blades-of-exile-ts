/**
 * Exile III's job boards, for the engine's `job-boards` extension
 * (`src/game/e3Jobs.ts`): the strings it reads from the scenario, in the
 * order `JOB_STR` lays out, and E3's tables as the EXE holds them, which the
 * test compares with the engine's copies.
 */

import { JOB_STR } from '../../src/game/e3Jobs';
import { neAutoDataSegment, readNeSegment } from './ne';

/** Segment 33 (`1100:`), where the targets' tables are. */
const TARGET_SEGMENT = 33;
export const E3_JOB_TARGETS = 40;

/** The tables the engine copies: `1100:0000`, `1100:0050` and `DS:02ae`. */
export function readE3JobTables(exe: Uint8Array): {
  personality: number[]; targetLocs: [number, number][]; bankLocs: [number, number][];
} {
  const seg = readNeSegment(exe, TARGET_SEGMENT);
  const ds = readNeSegment(exe, neAutoDataSegment(exe));
  const word = (b: Uint8Array, at: number) => (((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)) << 16) >> 16;
  const locs = (b: Uint8Array, at: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, k) => [b[at + 2 * k] ?? 0, b[at + 2 * k + 1] ?? 0]);
  return {
    personality: Array.from({ length: E3_JOB_TARGETS }, (_, k) => word(seg, 2 * k)),
    targetLocs: locs(seg, 0x50, E3_JOB_TARGETS),
    bankLocs: locs(ds, 0x2ae, 6),
  };
}

/**
 * The job strings, `JOB_STR.count` of them. `str` is E3's string table (list
 * 19 is strings 5700 on) and `exeString` reads a C string from the code.
 */
export function e3JobStrings(str: (id: number) => string, exeString: (seg: number, off: number) => string): string[] {
  const out = new Array<string>(JOB_STR.count).fill('');
  const put = (at: number, s: string) => { out[at] = s; };
  for (let t = 0; t < E3_JOB_TARGETS; t++) put(JOB_STR.targets + t, str(5701 + t));
  for (let g = 0; g < 16; g++) put(JOB_STR.goods + g, str(5740 + g));
  for (let k = 0; k < 5; k++) put(JOB_STR.delivered + k, str(5761 + k));
  put(JOB_STR.deadline, str(5770));
  put(JOB_STR.noBody, str(5771));
  put(JOB_STR.bodyTaken, str(5772));
  // FUN_10d0_2540's formats, in segment 10d0.
  const code = (off: number) => exeString(0x10d0, off);
  put(JOB_STR.within, code(0x2308));
  put(JOB_STR.byDay, code(0x2317));
  put(JOB_STR.need, code(0x2321));
  put(JOB_STR.must, code(0x2334));
  put(JOB_STR.needConvey, code(0x233e));
  put(JOB_STR.mustConvey, code(0x2358));
  put(JOB_STR.needDeliver, code(0x24b4));
  put(JOB_STR.mustDeliver, code(0x24cf));
  [0x2368, 0x23a3, 0x23d5, 0x241a, 0x2465, 0x24e0].forEach((off, k) => put(JOB_STR.formats + k, code(off)));
  put(JOB_STR.fourJobs, exeString(0x1008, 0x40b6));
  put(JOB_STR.business, exeString(0x1020, 0x1d00));
  put(JOB_STR.panelTitle, code(0x0b26));
  return out;
}
