#!/bin/bash
# Build the C++ game natively, to run replays beside this port's and diff them.
#
# **No toolchain install is needed.** The desktop build wants scons + SFML 2 and
# the web build wants emscripten; neither is used here. The wasm source path
# already replaces SFML with `src/compat/`, so the only thing in the way was
# Emscripten itself — 124 EM_ASM sites and 16 `emscripten.h` includes — and
# `shim/emscripten.h` no-ops those. What's left compiles with Apple's clang++
# and links against system zlib.
#
#   ./tools/cppharness/build.sh              # build ../exile-wasm natively
#   ./tools/cppharness/build.sh --clean      # from scratch
#
# Apply `exile-wasm.patch` to ../exile-wasm first (see README.md). Those changes
# are deliberately not committed to that repo.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BOE_CPP_SRC:-$(cd "$HERE/../../../exile-wasm" && pwd)}"
OUT="${BOE_HARNESS_OUT:-$HERE/build}"

[ "${1:-}" = "--clean" ] && rm -rf "$OUT"
mkdir -p "$OUT/obj"

INCLUDES=(-I"$HERE/shim" -I"$SRC/src" -I"$SRC/src/game" -I"$SRC/src/gfx"
  -I"$SRC/src/platform" -I"$SRC/src/universe" -I"$SRC/src/tools" -I"$SRC/src/fileio"
  -I"$SRC/src/fileio/xml-parser" -I"$SRC/src/fileio/gzstream" -I"$SRC/src/dialogxml"
  -I"$SRC/src/pcedit" -I"$SRC/deps/fmtlib/include" -I/opt/homebrew/include)

# `__EMSCRIPTEN__` selects the SFML-free source path; BOE_NATIVE_REPLAY is this
# harness's own switch, which turns the web build's replay *stubs* off so the
# real src/tools/replay.cpp can supply them.
DEFS=(-std=c++17 -D__EMSCRIPTEN__ -DBOE_NATIVE_REPLAY -DTIXML_USE_TICPP
  -DBOOST_FALLTHROUGH='[[fallthrough]]')

# The web build's own source list, plus the two files it leaves out: the real
# replay system, and this harness's stubs.
# (a `while read` loop rather than `mapfile`, which macOS's bash 3.2 lacks)
SOURCES=()
while IFS= read -r line; do SOURCES+=("$line"); done < <(python3 - "$SRC" <<'PY'
import re, sys
src = sys.argv[1]
block = open(f'{src}/build_wasm_common.sh').read().split('SOURCES=(')[1].split(')')[0]
for m in re.findall(r'"([^"]+)"', block):
    print(m.replace('$WEB_DIR', 'web').replace('$SOURCE_DIR', 'src'))
print('src/tools/replay.cpp')
PY
)

# The staleness check compares against the newest *header* as well as the
# source. Two of the harness's changes live in headers (`special_parse.hpp`
# most importantly), and a per-source mtime check alone silently kept the old
# object — which reads as "the edit had no effect" and costs an hour.
NEWEST_HEADER="$(find "$SRC/src" -name '*.hpp' -o -name '*.h' | xargs ls -t 2>/dev/null | head -1)"

echo "Compiling ${#SOURCES[@]} sources from $SRC ..."
for f in "${SOURCES[@]}"; do
  o="$OUT/obj/$(echo "$f" | tr '/' '_').o"
  [ -f "$o" ] && [ "$o" -nt "$SRC/$f" ] && [ "$o" -nt "$NEWEST_HEADER" ] && continue
  ( cd "$SRC" && clang++ "${DEFS[@]}" -c -O0 -g -w "${INCLUDES[@]}" "$f" -o "$o" )
done
clang++ "${DEFS[@]}" -c -w "${INCLUDES[@]}" "$HERE/stubs.cpp" -o "$OUT/obj/stubs.o"

echo "Linking ..."
clang++ -std=c++17 -g -rdynamic -o "$OUT/boe-native" "$OUT"/obj/*.o -lz
echo "Built $OUT/boe-native"
