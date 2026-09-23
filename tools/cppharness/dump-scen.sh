#!/bin/bash
# Print what the C++ builds from a scenario file, as JSON (scendump.cpp).
#
#   ./tools/cppharness/dump-scen.sh path/to/scenario.exs > dump.json
#
# `test/legacyImport.test.ts` runs this when the harness is built and holds
# this port's `.exs` import against it. Build first with `build.sh`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BOE_CPP_SRC:-$(cd "$HERE/../../../exile-wasm" && pwd)}"
BIN="${BOE_HARNESS_OUT:-$HERE/build}/boe-native"

[ -x "$BIN" ] || { echo "No $BIN — run tools/cppharness/build.sh first." >&2; exit 1; }
[ $# -eq 1 ] || { echo "usage: $0 <scenario file>" >&2; exit 1; }

WORK="${BOE_HARNESS_WORK:-${TMPDIR:-/tmp}/boe-harness}"
mkdir -p "$WORK/temp"
exec env BOE_DUMP_SCEN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" \
  BOE_DUMP_DATA="$SRC/data" BOE_TEMP_DIR="$WORK/temp" "$BIN"
