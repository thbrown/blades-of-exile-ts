/**
 * `showError` / `showWarning` (strdlog.cpp:107) — the free functions the game
 * rules call when a scenario asks for something impossible: a spell pattern
 * out of range, a quest that doesn't exist, a teleport off the map.
 *
 * They are modal dialogs, and the rules have no dialog host to hand, so this
 * is the same arrangement as `setPrintResult` in `living.ts`: the host
 * installs a sink, and with none installed — tests, the replay driver — the
 * line goes to the message buffer instead, so a broken scenario still says
 * why nothing happened.
 */

import { Universe } from '../universe/universe';

type ErrorSink = (str1: string, str2: string, warning: boolean) => void;

let sink: ErrorSink | null = null;

export function setErrorSink(fn: ErrorSink | null): void {
  sink = fn;
}

export function showError(univ: Universe, str1: string, str2 = ''): void {
  if (sink) sink(str1, str2, false);
  else univ.addStringToBuf(`  Error: ${str1}${str2 ? ` ${str2}` : ''}`);
}

export function showWarning(univ: Universe, str1: string, str2 = ''): void {
  if (sink) sink(str1, str2, true);
  else univ.addStringToBuf(`  Warning: ${str1}${str2 ? ` ${str2}` : ''}`);
}
