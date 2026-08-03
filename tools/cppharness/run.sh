#!/bin/bash
# Run one of the C++ build's own replays through the native harness.
#
#   ./tools/cppharness/run.sh ../exile-wasm/test/replays/long/ASR_05-05-2025_21-13-55.xml
#   BOE_TRACE=1 ./tools/cppharness/run.sh <replay.xml>   # one line per action
#
# `BOE_TRACE=1` prints the same shape of line as
# `CORPUS=1 TRACE=1 ONLY=<file> npx vitest run test/corpus.test.ts`, so the two
# traces diff line for line and the first difference names the rule that
# diverged. It also prints `[spec] town node N (Type) at (x,y)` whenever a
# square fires its script.
#
# Build first with `./tools/cppharness/build.sh`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BOE_CPP_SRC:-$(cd "$HERE/../../../exile-wasm" && pwd)}"
BIN="${BOE_HARNESS_OUT:-$HERE/build}/boe-native"

[ -x "$BIN" ] || { echo "No $BIN — run tools/cppharness/build.sh first." >&2; exit 1; }
[ $# -ge 1 ] || { echo "usage: $0 <replay.xml>" >&2; exit 1; }

# The game resolves everything under `progDir`: `progDir/data` for its
# resources and `progDir/Blades of Exile Scenarios/<name>` for the three
# bundled scenarios (locate_scenario, fileio_scen.cpp:111). ../exile-wasm has
# those two under different names, so stage a directory of symlinks rather than
# writing anything into that checkout.
WORK="${BOE_HARNESS_WORK:-${TMPDIR:-/tmp}/boe-harness}"
mkdir -p "$WORK/prog" "$WORK/temp"
ln -sfn "$SRC/data" "$WORK/prog/data"
ln -sfn "$SRC/rsrc/scenarios" "$WORK/prog/Blades of Exile Scenarios"

exec env BOE_PROG_DIR="$WORK/prog" BOE_TEMP_DIR="$WORK/temp" "$BIN" --replay "$1"
