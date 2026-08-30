/**
 * Trace switches that more than one module needs, kept here so a low-level file
 * can print without importing a high-level one. Every flag is read once at
 * module load and guarded on `process` existing at all: these files run in the
 * browser too, where `process.env.X` written bare throws `ReferenceError`.
 */

const env = (name: string): boolean => Boolean(
  typeof process !== 'undefined' ? process.env?.[name] : undefined);

/**
 * `AGE=1` — one line per tick the clock takes, and who took it. The pair to the
 * harness's `BOE_TRACE_AGE=1`. Only three things move `party.age` on either
 * side — `increase_age`, `CHANGE_TIME` and `do_rest` — so the trace is complete
 * by construction, which is what makes it worth having: every `age % n` upkeep
 * hangs off that number, and a clock that has drifted shows up as a draw one
 * side makes and the other doesn't, arbitrarily far from the cause.
 */
export const TRACE_AGE = env('AGE');
