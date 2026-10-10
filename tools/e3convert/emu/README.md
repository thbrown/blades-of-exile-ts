# Running EXILE3.EXE's own code

Exile III's quest logic was copied out of the EXE by hand (`../towns/`). This
directory is the automated check on that copy: it runs the EXE's own
functions in an x86 emulator and compares what they do with what the port
does, from the same saved game.

```
python3 -m venv tools/e3convert/emu/.venv
tools/e3convert/emu/.venv/bin/pip install unicorn capstone

npx vitest run test/e3emu.test.ts                      # the pinned cases (seconds)
E3EMU_SWEEP=1 npx vitest run test/e3emu.test.ts -t 'every outdoor spot'   # (about 90 minutes)
E3EMU_TOWN_SWEEP=1 npx vitest run test/e3emu.test.ts -t 'every town spot' # (E3EMU_TOWNS=12,26 for some)
E3EMU_CASE=5,14,37,1/1,low npx vitest run test/e3emu.test.ts -t 'one case'
E3EMU_TOWN_CASE=12,41,49,last,high npx vitest run test/e3emu.test.ts -t 'one town case'
tools/e3convert/emu/.venv/bin/python tools/e3convert/emu/timings.py SAVE   # combat animation timings
```

The test finds the venv by itself (`E3EMU_PYTHON` overrides it) and skips
when there's no E3 or no emulator.

## How it works

- **`e3emu.py`** loads EXILE3.EXE into a real-mode address space, one
  paragraph per NE segment (the whole EXE is 0xdabd8 bytes, so it fits under
  1 MB), and applies the relocations: a segment fixup becomes that
  paragraph, `__AHSHIFT` becomes 12. Calls out of the EXE go to a stub
  segment of `retf`s with a Python hook in front of each:
  - Windows (`win16.json`: every import's name and argument size, from
    Wine's `.spec` files) pops its arguments and returns 1, except the calls
    the logic reads back: files (on real files), `GlobalAlloc`,
    `LoadString` (from the EXE's own string table), the clock (a second per
    look, so delay loops end at once).
  - The Borland runtime's `sprintf`, `strcpy` and friends, done in Python;
    `_pow` returns in ST(0), so its stub is code.
  - E3's own functions that only talk to the player are redirected the same
    way: `FUN_1008_3b3f`, the message box every message goes through;
    `FUN_1070_31cd`, a dialog, which answers from a list of buttons;
    `FUN_10d0_4c8d`, a line of text. (Not the journal, `FUN_1008_3780`:
    it writes the party record, so it has to run.) And `get_ran`
    (`FUN_1048_004f`), so both sides can be given the same dice.
  - A loop that waits on Windows (for a click) would never end; after
    200,000 Windows calls the run stops and names the loop's caller.
- **`Game`** then does what a check needs: `load` runs E3's `load_file`
  (`FUN_1040_018e`) on a save, which loads the outdoor zones and the town
  with E3's own code; `put_outdoors` sets the party's place and reloads the
  2×2 window (`FUN_1040_3677`); `step_outdoors` takes the step
  (`FUN_10c0_0c97`, `check_special_terrain`). In town, `put_town` puts the
  party on a square (`1160:29bc`) and `step_town` takes E3's whole town move
  (`FUN_1010_8001`): the spots and fields (`0c97` mode 1), boats and horses,
  the locked-door dialog (993) and the terrain's blockage, so where the
  party ends up is E3's own answer to "can I walk there?". `checkpoint`/`restore`
  put all of memory back, so a batch loads each save once.
- **`spot.py`** runs a batch of cases (JSON on stdin) and prints what the
  player saw, the dice asked, whether the step went through, and the party
  record and the PCs before and after.
- **`timings.py`** times E3's hit, missile and explosion animations on a
  virtual clock (each `Delay` and synchronous sound adds its length), at
  each game speed. PROGRESS.md has the table against the port's.
- **`test/e3emu.test.ts`** runs each case through the port first (the
  quest runner, from the same save via `applyE3Save`), which says how many
  buttons each dialog has, then through E3 with the same buttons, and
  compares. The party and PCs are compared through `exportE3Save`, byte by
  byte but only where either side changed something. A byte only E3 changed
  that the export doesn't reproduce is listed as **unmodeled**, not as a
  difference.

## Dice

The port's engine doesn't roll the way E3 does: a BoE `if-rand` is
`get_ran(1,1,100) < n` where E3 flips `get_ran(1,0,1)`, and a stat node rolls
its own die. So E3's raw dice can't be fed to the port. Every case instead runs
twice, with every roll at its least (`low`) and at its most (`high`), on both
sides. A threshold test then goes the same way on both if it was transcribed
the right way round, and damage is at its least or its most, so a wrong range
shows. The `get_ran` calls themselves are reported under `dice`, not as
differences.

## Limits

- Town cases need an in-town save. The test makes one per town as
  `test/e3checkSaves.test.ts` makes its own: Q12's party walked in and
  exported (`E3EMU_SAVES_DIR` keeps them, to run E3 on by hand). Each spot
  is stepped onto from an open square beside it with no spot of its own; a
  spot with no such square is skipped and counted. A case stops visiting
  once the town changes or the party splits.
- Talk scripts and the encounter scripts (`FUN_10c0_06c3`) need their own
  entry points.
- One save is one state of the world. A spot that tests a flag only shows
  the branch that save takes; other saves (`E3EMU_SAVE`) show the others.
- The comparison stops at the end of the step. Anything E3 does on the next
  turn (an encounter group walking up to the party) is outside it.
- Nothing graphical is checked: a bitmap load returns a dummy handle.
