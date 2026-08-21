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
`BOE_TRACE_TARG=1` adds where each creature is *heading* (`TARG=1` on this side).
Outdoors the same switch lists the **ten encounter groups** instead of a town's
creatures, which is what a `seek_party` divergence needs; `MONST=1` prints the
same `outmonst:` line here. `BOE_TRACE_WINDOW=1` (`WINDOW=1` here) adds the
outdoor corner and `i_w_c`, since two windows that agree on every coordinate can
still be stitched from different sectors. `BOE_TRACE_OUTMOVE=1` prints every
square an outdoor group tries to step onto with the terrain it found there —
that pair ("we say 8, it says 93") is how a map divergence gets named.
`BOE_TRACE_ITEMS=1` (`ITEMS=1` here) prints all six packs as
`index:variety/charges/type_flag`, which is what an item divergence looks like
before it turns into a dialog one side raises and the other doesn't. It found
the pack-order bug: the two sides agreed on every item a PC carried and not on
which slot each sat in, which matters because a recording uses items *by slot*.
**`BOE_TRACE_MMOVE=1` (`MMOVE=1` here) prints every step a creature tries** —
`i (from) -> (to) ok|no ap=n`, from `try_move`, in all three modes. This is the
answer to the hardest shape of divergence here: **movement makes no `get_ran`
calls**, so two runs can walk a creature square by square down different paths
with their `[ran]` streams still matching exactly, and the draw that finally
disagrees is hundreds of moves downstream of the rule that caused it. Nothing
else shows that happening; the `monst:` list only samples it once per action,
by which time the turn is over. It also prints `[mbranch] i acted= mob=
friendly= target= targ_space= ap=` at the top of the move branch, on both
sides — `[mmove]` says a creature stepped somewhere the other side didn't, and
`[mbranch]` says *why* it was going there, which is the half that names the
rule. That pair is what found `switch_target_to_adjacent`: identical draws,
identical positions, `target=2` on one side and `target=4` on the other.
**`BOE_TRACE_MMOVE` also prints `[domonst]` and `[notice]`**, both of which
answer the shape above from the other end. `[domonst] mode= party= age=` goes at
the top of `do_monsters`, and it is the one line that pins *when* a turn's
upkeep ran and *where the party was standing* while it ran — two runs can hold
the same party path and still feed `do_monsters` different squares if one of
them charged a turn the other didn't. `[notice] <slot> at (x,y) party=(x,y) d=
att=` prints every candidate for the "Monster saw you!" roll, which turns "this
port makes one extra `get_ran(1,1,100)`" into "creature 13, eight squares away,
that the other side never even considered". Together they found
`handle_get_items`: the two sides agreed on every draw and every square, and
disagreed by one on the *age* at which they were standing there.

Two more, added while chasing turns that make no draws and **currently living
in the `../exile-wasm` working tree rather than in `exile-wasm.patch`** — if
that tree is ever reset, re-add them from the entries in PROGRESS.md:
`[advtime] did= mode= party= age=` at the top of `advance_time`, which says
whether an action charged a turn at all (that is what named
`handle_get_items`), and `[outmove] dest= real= corner= ter= blocked= forced=`
in `outd_move_party`, which prints the destination *after* the window shift
along with the terrain found there (that is what named the window-shift undo).

The `[domonst]` diff is the one to reach for first, and it has one trap: both
sides print it for the **outdoor** half of `do_monsters` as well as the town
half, so a stretch of walking outdoors fills one side's list with entries the
other keeps somewhere else. `grep '\[domonst\] mode=1'` on both before
diffing, or diff the whole thing and read the mode column.

`BOE_TRACE_PCS=1` (`PCS=1` here) prints each PC's `main_status`, health and
combat position. Whether a PC is alive gates more monster behaviour than you
would guess — `do_monster_turn` will not walk toward a dead one, `closest_pc`
skips them — so a party-state divergence reads as a creature that moved on one
side and not the other, with nothing about movement actually wrong. Reach for
it to *rule that out* before chasing the movement code, which is exactly the
detour it was written to end.
`BOE_TRACE_LIGHT=1` adds `light=<level> rad=<radius> lit=<0|1> ltype=<n>` — the
party's light and whether its own square counts as lit. `pt_in_light` gates
`can_see_light`, which gates every notice roll in a dark town, so a divergence
there reads as a creature that saw the party on one side and not the other with
every position agreeing. There is no `LIGHT=1` on this side yet; print it from a
scratch `console.log` when you need the pair.

**`BOE_TRACE_RAN=n` is the sharpest of them**: it dumps the first *n* draws from
the game stream, and `RAN=n` prints the identical format here. Diff the two and
the first differing line is the rule that diverged — usually a `get_ran` one side
makes and the other doesn't, which no amount of staring at positions would find.
`BOE_TRACE_RAN_STACK=k` prints the C++ stack for draw *k* (`RANSTACK=k` here), so
"they part at draw 12" becomes "`play_ambient_sound`, which you never ported".
Only the game stream is traced: `unique_rand` is seeded from the clock and is
deliberately outside the replay's determinism.

**`scripts/diverge.mjs` does all of that for you**, and is what to reach for
first:

```
node scripts/diverge.mjs ZKR_15-05-2025_18-04-58   # one file, with the stack
node scripts/diverge.mjs --all --stacks            # every file, ranked by rule
node scripts/diverge.mjs --all                     # faster, ranked by draw args
node scripts/diverge.mjs --all --refresh           # ignore the trace cache
```

It runs both sides, caches their traces under `tools/cppharness/traces/`, finds
the first draw they disagree on, and — because both engines stream their action
lines and their draw lines down one stdout — prints **the action each side was
replaying when it happened**, then re-runs this port with `RANSTACK` to name the
function. `--all` groups the whole corpus by that signature and sorts by how many
recordings each one accounts for, which is the queue: fix the rule that unblocks
fourteen files before the one that unblocks one.

**Use `--stacks`.** Without it the bucket key is the action plus the draw's
arguments, and that over-splits badly: `rand_move`'s range depends on the monster
and the town, so one rule scatters across `get_ran(1,1,70)`, `get_ran(1,0,24)`,
`get_ran(1,1,100)` … and the corpus comes back as twenty-nine buckets, most of
them one file. `--stacks` spends one extra run per diverging file to ask this
port which function made the draw, and keys on that instead — the same corpus
collapses onto named rules (`doMonsters`, `monstCheckOneSpecialTerrain`,
`pickTargetPc`), which is an order of work rather than a list.

Even then the bucket is a **ranking device, not a proof**, in two ways. Same
function is not the same bug — open a bucket's files singly before treating them
as one fix. And the frame names where *this port* was standing at the first
differing draw, which when one side takes a branch the other doesn't is the first
innocent bystander rather than the culprit: the `playAmbientSound` bucket turned
out to be a move the C++ refuses and this port allows, one action earlier. Read a
bucket as "start here", never as "the bug is in this function".

The two engines also print their action line at **opposite ends** of the action —
the C++ in `pop_next_action` before running it, this port in `onStep` after — so
a draw sits after its action's line on one side and before it on the other. The
script corrects for this; if you are reading raw traces by hand, that is why the
`draws=N` field on this port's lines counts draws printed *above* the line.

Two things it knows that a hand-run `diff` does not. A recording whose actions
all dispatch can still have parted from the C++ hundreds of draws earlier —
`ZKR_15-05-2025_18-04-58` runs all 1,033 of its actions and diverges at draw
6,080 — so *finishing is not passing*, and draws are the honest measure. And a
recording the **harness** cannot finish is a harness gap rather than a port bug
(`survey.sh` says the same); those are reported in a separate table, but their
draws are still compared up to the point the harness died, since a divergence
inside that prefix is real either way.

The manual form still works, and is the fallback when the script's parsing
loses:

```
BOE_TRACE_RAN=4000 ./tools/cppharness/run.sh <replay.xml> | grep '\[ran\]' > /tmp/c
CORPUS=1 ONLY=<name> RAN=4000 npx vitest run test/corpus.test.ts | grep '\[ran\]' > /tmp/j
diff /tmp/c /tmp/j | head
```

Two traps if you run the port's side by hand. Pass the test file **before** any
flags — vitest treats `--disable-console-intercept` as taking a value and will
swallow a positional that follows it, running the whole suite so that every other
test's draws land in the trace. And leave console interception on only for short
runs: it prefixes every line with a banner, which is affordable for a few
thousand draws and not for a hundred thousand.

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
