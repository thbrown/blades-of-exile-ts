# The C++ harness

A native build of `../exile-wasm` that runs the C++'s own replay recordings, so
this port has something to **ask** rather than a source tree to read. The corpus
runner in `test/corpus.test.ts` says how far each recording gets *here*; this
says how far the same recording gets *there*, in the same shape of trace, and
the first line where the two differ names the rule that diverged.

```
./tools/cppharness/build.sh                     # build (again: incremental)
./tools/cppharness/build.sh --clean             # from scratch
./tools/cppharness/run.sh <replay.xml>          # run one recording
BOE_TRACE=1 ./tools/cppharness/run.sh <replay.xml>
./tools/cppharness/survey.sh                    # the whole corpus, one line each
```

`BOE_TRACE=1` prints one line per replayed action in the same shape as
`CORPUS=1 TRACE=1 ONLY=<file> npx vitest run test/corpus.test.ts`, plus a
`[spec] town node N (Type) at (x,y)` line whenever a square fires its script.
`BOE_TRACE_MONST=1` adds the town's creature list to each line, and pairs with
`MONST=1` on the corpus test — that pairing is what found the townsperson-drift
bucket, on the first turn of a recording that only failed 33 actions later.

## Setup

**No toolchain install is needed** — not scons, not SFML, not emscripten. The
wasm source path already replaces SFML with `src/compat/`, and `shim/emscripten.h`
no-ops the 124 `EM_ASM` sites and 16 `emscripten.h` includes that were the only
thing left in the way. What remains compiles with Apple's clang++ against system
zlib. Boost headers are wanted for a couple of includes and come from
`/opt/homebrew/include`.

The build needs `../exile-wasm` patched:

```
cd ../exile-wasm && git apply ../exile-js/tools/cppharness/exile-wasm.patch
```

Those changes are deliberately **not** committed to that repo — it is the
reference implementation and should stay pristine. Regenerate the patch with
`git diff` there after changing anything.

`-D__EMSCRIPTEN__` selects the SFML-free source path; `-DBOE_NATIVE_REPLAY` is
this harness's own switch, and every hunk of the patch is behind it.

## What the patch changes, and why each one was needed

Roughly in the order they had to be found:

- **`process_args`** — the real one is behind `clara.hpp` from a submodule that
  isn't checked out, and all this needs is `--replay`. The stand-in also applies
  the recording's `<load_prefs>`, because `src/tools/prefs.cpp` is not in the
  wasm source list: nothing else consumes that action, and the game's own `srand`
  then finds it still at the head of the stream and refuses.
- **The gzip save path.** `load_party` sniffs `.exg` as *uncompressed* under
  `__EMSCRIPTEN__` (the browser hands over decoded bytes), but a recording's
  embedded save is a real gzipped `.exg`.
- **`web/web_stubs.cpp`'s zlib stubs.** The browser has no zlib, so the web build
  defines its own `gzopen`/`gzread`/`gzwrite`/`gzclose`. Linked beside `-lz` they
  silently win, and every save reads back as **zero bytes long** — with no error,
  because `gzstreambase` sets badbit and `std::istream`'s constructor then clears
  it again. Left out natively.
- **`ReceivedHelp`.** The prefs loader used to skip int arrays as cosmetic. It is
  the opposite: `give_help` returns early for a topic already in that list, so a
  recording that has seen a hint clicks straight past where the dialog would be.
  Without it the harness raises the dialog and then dies dereferencing a control
  that the recording's next click names in some *other* dialog.
- **`SpecialParser::parseSpecType` — the big one.** The wasm build ships a
  hand-written `.spec` parser in `special_parse.hpp` that knows **22 of the 228
  opcodes** and silently answers `NONE` for the rest. It does not fail; it
  produces a scenario whose scripting is mostly blank nodes, so a scripted square
  shows string 0 of the town where a dialog belonged. The harness builds the
  whole table from `data/strings/specials-opcodes.txt` instead — which is exactly
  what the desktop build does, since `node_properties_t::opcode()` is
  `get_str("specials-opcodes", int(type))`.
- **A missing dialog control throws instead of segfaulting.** `controls[id]` on a
  name the dialog doesn't have inserts a null and dereferences it. The harness
  reports which dialog is up, what the recording clicked and what the dialog
  actually has — a mismatch there always means the game raised a different dialog
  than the recording did.
- **`BOE_PROG_DIR` / `BOE_TEMP_DIR`**, and the temp directories created for real
  (the `EM_ASM` that makes them in the VFS is a no-op natively).
- **The main loop.** Under Emscripten it is handed to the browser; `stubs.cpp`
  calls it in a `while` that stops when the game says so or the replay runs out.
- **A crash handler** in `stubs.cpp`, because the sandbox this runs in does not
  let a debugger attach and a segfault is otherwise a bare exit 139.

## Where the scenarios and data come from

`run.sh` stages a `progDir` of symlinks in `$TMPDIR/boe-harness` rather than
writing into the `../exile-wasm` checkout: `progDir/data` → `data`, and
`progDir/Blades of Exile Scenarios` → `rsrc/scenarios`, which is where
`locate_scenario` (fileio_scen.cpp:111) looks for the three bundled scenarios.
Those files are byte-identical to this port's `public/scenarios`, so both sides
of a diff are reading the same content.

## Known gaps

`survey.sh` is the honest inventory. The two shapes that recur:

- `max-files does not exist in dialog preferences` — the file picker's dialog
  definition wants a pref the harness's stand-in loader doesn't set.
- `Replaying a dialog, have the wrong replay action` — the harness raised a
  dialog the recording didn't, i.e. a real remaining divergence in the build.

What the harness does **not** yet do is dump an end state. Matching the C++'s
final party, SDFs and position is the golden master `PROGRESS.md` still asks for;
the trace is the intermediate step that makes the *first* divergence findable.
