#!/bin/bash
# Run every replay in the corpus through the native harness and report, one line
# per file, how many actions it dispatched and why it stopped.
#
#   ./tools/cppharness/survey.sh [replay-dir]
#   BOE_SURVEY_TIMEOUT=120 ./tools/cppharness/survey.sh   # seconds per file
#
# **Every file gets a watchdog.** Four recordings make the harness spin
# forever, and without a timeout the survey never finishes at all — one hung
# file ate 69 minutes of CPU and reported nothing, since the whole run's output
# only lands when it exits. A file killed by the watchdog reports `TIMEOUT`,
# which is a harness gap like any other rather than a silent absence.
#
# This is the C++ side of the number `test/corpus.test.ts` prints for this port.
# A file the harness cannot finish is a *harness* gap, not a port bug, and has
# to be fixed here before the run is worth diffing against.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BOE_CPP_SRC:-$(cd "$HERE/../../../exile-wasm" && pwd)}"
ROOT="${1:-$SRC/test/replays}"

LIMIT="${BOE_SURVEY_TIMEOUT:-120}"

# macOS ships no `timeout(1)`, so run the harness in the background and have a
# watchdog kill it. 124 is coreutils' exit code for a timeout.
#
# **Both background jobs must have stdout closed.** The caller reads this
# function through a command substitution, which does not return until every
# process holding the pipe's write end has let go — so a watchdog that inherits
# stdout makes *every* file take the full timeout, whether it hung or finished
# in two seconds. That is why the run goes to a temp file and is `cat`ed after.
run_limited() {
  local f="$1" tmp; tmp="$(mktemp)"
  ( BOE_TRACE=1 "$HERE/run.sh" "$f" >"$tmp" 2>&1 ) >/dev/null 2>&1 &
  local pid=$!
  ( sleep "$LIMIT"; kill -9 "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watchdog=$!
  wait "$pid"; local code=$?
  kill "$watchdog" 2>/dev/null
  cat "$tmp"; rm -f "$tmp"
  # 137 is SIGKILL, which here only ever comes from the watchdog.
  [ "$code" -eq 137 ] && return 124
  return "$code"
}

total_ok=0; total_files=0; total_actions=0
while IFS= read -r f; do
  case "$f" in */scenarios/*) continue;; esac
  total_files=$((total_files + 1))
  out="$(run_limited "$f")"
  code=$?
  n=$(printf '%s\n' "$out" | grep -cE '^ +[0-9]+ [a-z_]+ ')
  total_actions=$((total_actions + n))
  why=$(printf '%s\n' "$out" | grep -E '^\[(FATAL )?ERROR\]|^\[CRASH\]' | head -1)
  [ $code -eq 124 ] && why="[TIMEOUT] still running after ${LIMIT}s"
  if [ $code -eq 0 ] && [ -z "$why" ]; then
    total_ok=$((total_ok + 1))
    printf 'OK   %6d  %s\n' "$n" "${f#"$ROOT"/}"
  else
    printf 'STOP %6d  %s  %s\n' "$n" "${f#"$ROOT"/}" "${why:-exit $code}"
  fi
done < <(find "$ROOT" -name '*.xml' | sort)

echo
echo "$total_ok of $total_files ran to the end; $total_actions actions dispatched"
