#!/bin/bash
# Run every replay in the corpus through the native harness and report, one line
# per file, how many actions it dispatched and why it stopped.
#
#   ./tools/cppharness/survey.sh [replay-dir]
#
# This is the C++ side of the number `test/corpus.test.ts` prints for this port.
# A file the harness cannot finish is a *harness* gap, not a port bug, and has
# to be fixed here before the run is worth diffing against.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BOE_CPP_SRC:-$(cd "$HERE/../../../exile-wasm" && pwd)}"
ROOT="${1:-$SRC/test/replays}"

total_ok=0; total_files=0; total_actions=0
while IFS= read -r f; do
  case "$f" in */scenarios/*) continue;; esac
  total_files=$((total_files + 1))
  out="$(BOE_TRACE=1 "$HERE/run.sh" "$f" 2>&1)"
  code=$?
  n=$(printf '%s\n' "$out" | grep -cE '^ +[0-9]+ [a-z_]+ ')
  total_actions=$((total_actions + n))
  why=$(printf '%s\n' "$out" | grep -E '^\[(FATAL )?ERROR\]|^\[CRASH\]' | head -1)
  if [ $code -eq 0 ] && [ -z "$why" ]; then
    total_ok=$((total_ok + 1))
    printf 'OK   %6d  %s\n' "$n" "${f#"$ROOT"/}"
  else
    printf 'STOP %6d  %s  %s\n' "$n" "${f#"$ROOT"/}" "${why:-exit $code}"
  fi
done < <(find "$ROOT" -name '*.xml' | sort)

echo
echo "$total_ok of $total_files ran to the end; $total_actions actions dispatched"
