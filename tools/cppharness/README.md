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
BOE_SURVEY_TIMEOUT=90 ./tools/cppharness/survey.sh   # seconds per file
```

**`survey.sh` gives every file a watchdog, and it has to.** Four recordings
hang the harness forever, and a survey with one hung file never finishes —
worse, because its output only lands when it exits, it reports *nothing at
all*. One run ate 69 minutes of CPU and printed an empty file. macOS ships no
`timeout(1)`, so the run is backgrounded and killed by a watchdog; a killed
file reports `TIMEOUT`, which is a harness gap like any other rather than a
silent absence. It is what named the four hangs — `AskAboutNonsense`,
`CallOnUse`, `CallOnUse-legacy`, `SpellcastPage2`, all stuck at **action 2**.

`BOE_TRACE=1` prints one line per replayed action in the same shape as
`CORPUS=1 TRACE=1 ONLY=<file> npx vitest run test/corpus.test.ts`, plus a
`[spec] <LIST> node N type T (Name) at (x,y)` line for **every node a chain
runs**, in any of the three lists (`SCEN`/`OUTDOOR`/`TOWN`), with `[spec]
queued …` when a chain fires while another is already running. `SPEC=1` prints
the same line here. The two engines spell the opcode differently — the enum
identifier there, the scenario editor's own wording here — so the **numeric**
type is what the two traces diff on. This line used to sit in
`check_special_terrain` and so could only ever see a town square's chain, which
made outdoor and scenario scripts invisible on the C++ side; that is what hid
the Za-Khazi Run clock bug for a week.
`BOE_TRACE_MONST=1` adds the town's creature list to each line — position,
`a<active>` and **`h<health>`** — and pairs with `MONST=1` on the corpus test.
That pairing is what found the townsperson-drift bucket, on the first turn of a
recording that only failed 33 actions later. The health column is there because
"it split on one side and died on the other" is a health divergence wearing a
rules divergence's clothes: it names a creature whose hit points drifted apart
*turns* earlier, in code that made no draws at all.
`BOE_TRACE_TARG=1` adds where each creature is *heading* (`TARG=1` on this side).
Outdoors the same switch lists the **ten encounter groups** instead of a town's
creatures, which is what a `seek_party` divergence needs; `MONST=1` prints the
same `outmonst:` line here. `BOE_TRACE_WINDOW=1` (`WINDOW=1` here) adds the
outdoor corner and `i_w_c`, since two windows that agree on every coordinate can
still be stitched from different sectors. `BOE_TRACE_OUTMOVE=1` prints every
square an outdoor group tries to step onto with the terrain it found there —
that pair ("we say 8, it says 93") is how a map divergence gets named.
It also prints `[outmove]` for the **party's** own steps, out of
`outd_move_party`, and **that half now has a pair here**: `MMOVE=1` prints the
same `dest= real= corner= ter= blocked= forced=` line from this port's
`outdMoveParty`. Diffing the two `ter=` columns over a whole recording is a map
comparison for free — 1,317 outdoor steps of `ASR_20-05-2025_07-20-41` agreed on
every square but one, and that one square was the bug.
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
att= see= stealth=` prints every candidate for the "Monster saw you!" roll,
which turns "this port makes one extra `get_ran(1,1,100)`" into "creature 13,
eight squares away, that the other side never even considered". The `see=`
column is `can_see_light`, the term that decides the roll without costing a
draw — **6 means "not in the light at all"** and is by itself enough to fail
it. A side that never prints 6 where the other does is not disagreeing about
line of sight; it is disagreeing about the town's `lighting` grid, and
`LIGHT=1` / `BOE_TRACE_LIGHT=1` is the next thing to diff. `[domonst]` and
`[notice]` together found `handle_get_items`: the two sides agreed on every draw
and every square, and disagreed by one on the *age* at which they were standing
there.

Two more, added while chasing turns that make no draws: `[advtime] did= mode=
party= age=` at the top of `advance_time`, which says whether an action charged
a turn at all (that is what named `handle_get_items`), and `[outmove] dest=
real= corner= ter= blocked= forced=` in `outd_move_party`, which prints the
destination *after* the window shift along with the terrain found there (that
is what named the window-shift undo). Both are in `exile-wasm.patch` now — an
older note here said they lived only in the `../exile-wasm` working tree, and
that stopped being true.

**`BOE_TRACE_CENTER=1` adds `center=(x,y)` to every action line** (`CENTER=1`
here), and it is the one to reach for whenever a recorded `move` looks too
long — or whenever two runs disagree about what the party can *see*. The camera
is not only a camera: `party_can_see`'s town branch passes anything on screen
**or** anything at all once `center` has left the party's square, and
`do_missile_anim` moves it and never puts it back. A `center` that has drifted
is a creature the party can suddenly see, and nothing else in either trace
shows it.
`handle_terrain_screen_actions` builds every move destination from `center`,
not from the party and not from the acting PC, and the three drift apart the
moment `screen_shift` scrolls the view or a spell is cancelled. It settled
whether `ZKR-5-16-12-30`'s two-square combat move was this port losing the
party or the recording genuinely containing one: the C++ prints
`center=(21,19)` beside a destination of `(22,17)`, so it is the recording.

The `[domonst]` diff is the one to reach for first, and it has one trap: both
sides print it for the **outdoor** half of `do_monsters` as well as the town
half, so a stretch of walking outdoors fills one side's list with entries the
other keeps somewhere else. `grep '\[domonst\] mode=1'` on both before
diffing, or diff the whole thing and read the mode column.

`BOE_TRACE_LIGHT=1` pairs with **`LIGHT=1`** here, which prints
`light= rad= lit= ltype=` in the same order: the party's lantern, the radius it
buys, whether the party's own square is in the town's permanent `lighting`
grid, and the town's lighting type. That pairing named `set_up_lights`' missing
line-of-sight test — `lit=1` here against `lit=0` there, on a square eight
squares from any lamp and behind a wall.

`BOE_TRACE_PCS=1` (`PCS=1` here) prints each PC's `main_status`, health,
**max** health, **level**, **spell points** and combat position. Spell points
are in it because `pc_can_cast_spell` refuses on them and **a refusal makes no
draws at all** — so "one side cast the spell and the other didn't" reads in the
draw stream as whatever rule happened to run next, arbitrarily far away.
`[cast]`'s `sp=0` says the cast was refused; this column is where the two runs
first disagreed about the number. The maximum is there because almost every
heal in `increase_age` is gated on `cur_health < max_health` rather than on the
current value alone, so "one side healed and the other didn't" is as often a
disagreement about the ceiling as about the roll. Whether a PC is alive gates more monster behaviour than you
would guess — `do_monster_turn` will not walk toward a dead one, `closest_pc`
skips them — so a party-state divergence reads as a creature that moved on one
side and not the other, with nothing about movement actually wrong. Reach for
it to *rule that out* before chasing the movement code, which is exactly the
detour it was written to end.
**`BOE_TRACE_ENC=1`** prints `[enc] <pc name>` on every call to
`cPlayer::total_encumbrance`, which rolls once per equipped awkward item and is
therefore one of the few *draw-making* functions the C++ calls from places a
rewrite would never think to call anything — including, notably,
`text_bar_text()` (boe.graphics.cpp:719), i.e. **drawing the status bar**.
There is no pair for it on this side; it answers the question "who is spending
these `get_ran(1,0,70)`s", and the answer is usually a redraw.

**`BOE_TRACE_TOUCH=1` (`TOUCH=1` here)** prints one line per ability the
`for(auto& abil : attacker->abil)` tail of `monster_attack` reaches — the
attacker, the ability key, its odds and its delivery — **before** the odds
roll. That ordering is the point: the divergence it answers is one side
spending a `get_ran(1,1,1000)` on a touch ability and the other never entering
the loop at all, and the draw stream cannot tell "the ability is missing here"
from "the attack never landed there".

**`BOE_TRACE_CAST=1`** prints one line at the top of `combat_cast_mage_spell` —
`[cast] mage pc= status= sp= skill= enc= forced= recast=` — *before* the spell
is picked. It exists because "the cast-spell dialog never opened" and "the PC
cannot cast" look identical from outside, and the difference decides whether
the recording is stale or this build is wrong. It settled the corpus's largest
harness bucket in one line: `status=2` is `NO_CAST_ANAMA`, and this port
refuses in the same place, so the recording's next click was always going to
have nothing to click.

`BOE_TRACE_PICKT=1` prints one line per candidate `monst_pick_target_monst`
weighs — `alive`, whether the two are friendly, the distance, and the best so
far — plus a line per call. It exists because that loop's tie-break draw fires
only when a candidate *equals* the running best, so its **draw count is a
function of which candidates are rejected**, and the rejections are invisible
in every other trace. Comparing the two candidate lists side by side is what
showed that `monst_can_see(i, monst[i].cur_loc)` — a creature asked whether it
can see its own square — is really a *lighting* test, and that this port had
dropped it as a no-op. There is no pair for that half on this side; add a
scratch `console.log` in `pickTargetMonst` when you need one.

It also prints one line per call to `monst_pick_target` itself — the creature,
whether it is in combat and friendly, `spell_caster`, `missile_firer`, its
stored target, and (when there is a caster) that PC's square, whether the
creature can see it and whether it is alive. **`PICKT=1` prints that line here
too**, and the pair is what to diff: the two "who annoyed me last" priorities
each spend a `get_ran(1,1,5)` before testing anything, so a creature that
disagrees about the caster's *square* still makes the first draw and then takes
a different branch — which reads in the draw stream as a divergence in whatever
the next rule happens to be. That is how the missing `push_things` was found.

**`BOE_TRACE_PCPOS=1` prints one line whenever a PC's combat position
changes**, checked on every traced draw (so it needs `BOE_TRACE_RAN=n` too, and
lands between two numbered draws). A PC that moved with nobody watching is the
hardest divergence to place: the action line only prints the *active* PC,
`pcs:` is a snapshot taken at action dispatch, and everything in between is
invisible. It answered "who moved three PCs one square north between draws 8998
and 8999?" in one run — the answer being `push_things`, the conveyor belts,
which spend no draws at all and so cannot be seen any other way. There is no
pair for it here; `PCS=1`'s snapshot is usually enough once you know which
action to look at.

**`BOE_TRACE_TACTIC=1` (`TACTIC=1` here)** prints one line per action point a
creature spends in `do_monster_turn`, taken just before the flee test:
`i t= target= mtarget= ap= futz= morale= near= d= adj= targ= dt= spd= hs= web=
at=`. It answers the shape the draw stream is worst at — **two runs that agree
on every draw and disagree about a creature's *state***, because the flee
branch's `get_ran(1,1,6)` is the first draw either side spends on the
disagreement and by then the cause is arbitrarily far back. `uniq` is not
wanted here: the line is per action point, and the number of lines a creature
produces is itself the signal. It found the creature-status save bug —
identical everything except `hs=1` against `hs=0`, one line after a
`load_party`, which named the file format rather than the rules.

**Every action line carries `cur=` and `dir=`** — `univ.cur_pc` and
`univ.party.direction` — on both sides. Outside combat the line names no PC at
all, and `cur_pc` still decides who the get-items screen hands its pile to: a
`cur_pc` that drifted is otherwise invisible until an item lands in the wrong
pack a thousand actions later. `dir=` is the party's *facing*, which nothing
prints and nothing else reads — except `start_town_combat`, which deals the
whole party onto the board from it, so a facing that drifted three hundred
actions earlier surfaces as four PCs standing on the wrong squares.

**`BOE_TRACE_CAST=1` also prints one line per target `do_combat_cast` weighs**:
`[cast] spell= from= to= adjust= range= dist= obsc=`, taken right after
`can_see_light`. Every input to the five refusals, so "the C++ cast it and this
port said `Can't see target`" becomes one column instead of a hunt — it named
both the rotated `place_party` formation and a door this port had not opened.

**`BOE_TRACE_ALTER=1` prints every `alter_space`** (`ALTER=1` here):
`town= (x,y) former -> ter` in a town, and
`out (x,y) global (X,Y) former -> ter` outdoors.
Terrain a *game* has changed is state, it survives a town exit, and nothing in
the draw stream can see it; a door open on one side and shut on the other is a
line of sight that differs and a spell that is refused.
The **outdoor** arm was added 2026-09-04 and paid for itself immediately: the
coordinates there are *sector-local* and go through `local_to_global`, which
this port was not doing, so one `CHANGE_TER` landed 48 squares from where the
C++ put it and left a mountain standing in a pass the recording walked through.
Pair it with `[outmove]`: `ter=` on the two sides is the cheapest way to see
that the two runs are holding different ground.

**`BOE_TRACE_PICKSP=1` prints the spell picker's caster memory**: `[picksp]
enter type= stored= cur= forced=` at the top of `pick_spell`, and `[picksp]
finish toast= spell= pc_casting=` on every way out. There is no pair for it
here; it answers "who is paying for this spell", which is a recurring shape in
this corpus because there are **three** globals involved (`pc_casting`,
`store_last_cast_*`, `store_*_caster`) and the picker opens on the *stored* one,
not on `univ.cur_pc`. `toast=1` is a cancel, and a cancel writes the memory —
which is why a picker the recording walks away from still changes who casts
next.

**`BOE_TRACE_PICK=1` prints one line per `pick_lock`**: `pc= at (x,y) ter= r1=
adj= dex= diff= lock= str= slot= break=`. Every term of the two rolls, so a
broken lockpick can be attributed without guessing which input differed — it is
what showed that `skill()` and `skills[]` are not the same number.

**`BOE_TRACE_GI=1` (`GI=1` here) prints the get-items screen's pile and every
row taken from it**: `[gi] open who= cur= n= [variety/charges/type_flag@x,y …]`
when the screen goes up, then `[gi] take idx= who= cur= first= n= item=` per
click. The pile is printed in **row order**, which is the order a recording's
`item3-key` indexes into, and with each item's square, because the two ways a
row can name different things are a different *reach* and a different *order*.
Like `PICK`, it answers a divergence the draw stream cannot see: **taking an
item spends no draws**, so two engines can hand the same recording's clicks to
different PCs, or find nothing under a row the other side had an item on, and
stay byte-identical until — thousands of actions later — one of them raises a
"how many?" prompt over a stack the other never split. It named the arena reach
rule on its first run: fifteen items there against nine here, the six missing
ones all six squares away on one square.

**`BOE_TRACE_GET=1` (`DBGGET=1` here) prints one `[getitem]` line per
`handle_get_items`** — `mode= town= cur_pc= combat_pos= town_loc= pcs=…` on the
way in and `j=` on the way out — and it is the pair to `GI` above rather than a
duplicate of it: `GI` prints the *pile*, this prints **which square was swept
and why**. The split in `handle_get_items` is `MODE_TOWN` against *everything
else* (boe.actions.cpp:1396), so outdoors it sweeps `univ.current_pc()
.combat_pos`, and `cur_pc` there is routinely **6** — `party[6]` is `party[0]`
(party.cpp:1143), and its `combat_pos` is a leftover from the last fight that
nothing else in either trace prints. It named the rout divergence: `mode=0
town=200 cur_pc=6 combat_pos=(20,23)` on one side against a cleared `(-1,-1)`
on the other, on a square neither engine was anywhere near.

**`BOE_TRACE_XP=1` prints every `award_xp` call and the state that decides
whether it rolls**: `[xp] pc= amt= force= status= level=`. The function is
silent when it refuses — a dead PC, a level over 49, more than 200 points
without `force` — and its `get_ran(1,1,100)` is the only thing the draw stream
sees, so "did it even get called?" is otherwise unanswerable. `grep force=1`
answers the narrower question of whether a **special** handed out the
experience, since `AFFECT_XP` is the only caller that forces.

**`BOE_TRACE_CLEAR=1` (`CLEAR=1` here) prints every candidate
`find_clear_spot` tries and which of its six tests turned it down**:
`[clear] from(x,y) try(x,y) mode= off= blk= see= pc= party= unsafe= adj=`. The
loop spends **two draws per try** and stops the moment one is accepted, so a
single disagreement about a single rejection shifts every draw after it — and
the draw stream cannot say *which* test disagreed, only that the counts differ.

Diff the two side by side and read the first line that differs. **If the
candidate *lists* agree and one side simply has more tries, the disagreement is
not in `find_clear_spot` at all**: it is in what the caller drew before it. That
is how the `summon1` bucket was closed — the candidate lists were identical and
the C++ had three extra tries, which turned out to be this port spending a
`get_ran(3,1,4)` per summoned creature where `SUMMON_HOST` rolls one for the
whole host.

**`BOE_TRACE_PRESET=1` prints the floor a town lays down when you walk in**:
`[preset] town= presets= placed= taken={ … }`, then one line per item actually
placed with its `is_special`, variety and square. The `taken=` set is the whole
point — it is `is_item_taken` read back after the save has been applied, and it
is what decides which presets are missing. An item on one engine's floor and
not the other's is invisible until a `get_item` screen opens over it, which can
be thousands of actions later and reads as a spurious dialog rather than as a
missing item.

It earned its keep immediately: town 6 of `VoDT_04-05-2025_15-47-42` prints
`taken={ 0 1 2 3 23 27 }` where this port had read the same `ITEMTAKEN` string
as `{15,19,39,40,41,42}` — the same six bits, mirrored. **The `.exg` format's
bitsets are index-order, not boost's**, because the build that wrote every save
in the corpus does not use boost: `src/compat/dynamic_bitset.hpp` is the wasm
build's own reimplementation and its stream operators run
`for(i = 0; i < size; ++i)`, so character *i* is bit *i*. Both conventions
round-trip within one engine, which is why it hid.

**`BOE_TRACE_PUSH=1` prints every `push_things` call and every conveyor test
it makes**: `[push] call mode= belt= combat= town= age=`, then `[push] pcN at
(x,y) ter=`, `[push]   check (x,y) w= u d l r v2=` and `[push] pcN (x,y) ->
(x,y)` for one that actually moves. There is no pair for it here yet — the
port's own conveyor code is small enough to read. It exists because **a belt
moves a PC without spending a single draw**: a port that pushes on a turn this
one doesn't stays byte-identical in the draw stream and surfaces two hundred
actions later as a spell cast from the wrong square. The `v2=` column is the
point of the `check` line — it is the *scenario's* feature flag, not the
replay's, and that distinction is what the trace was written to settle.

**`BOE_TRACE_AGE=1` prints one line per tick the clock takes, and who took it**:
`[age] increase_age mode= horse= -> N`, `[age] CHANGE_TIME +n -> N` and `[age]
do_rest +n -> N`. Those three are the *only* things in the game that move
`univ.party.age`, so the trace is complete by construction. Reach for it
whenever the two runs agree on every draw and disagree about **which turn it
is** — every `age % n` upkeep (shop restock, wandering monsters, timers) hangs
off that number, and a clock that has drifted shows up as a draw one side makes
and the other doesn't, arbitrarily far from the cause. It found the Za-Khazi
Run drift in one run: an outdoor move that cost 40 ticks there and 10 here was
a `CHANGE_TIME +30` on a *scenario* node the terrain called.

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

## Orphaned dialog actions, in both directions

The recording and this build can disagree about whether a dialog is open, and
it happens in both directions. Neither is a rules divergence you can fix here,
and dying on either throws away every draw after it.

**The recording answers a dialog this build never raised.** Its `click_control`
falls through `replay_action`'s chain to the "Couldn't replay action" throw. The
cause is a *refusal*: `handle_spellcast` on an Anama PC prints "You're an
Anama!" and returns without opening the cast-spell dialog, and this port refuses
in the same place — the recording is stale, made by a build whose rules
differed. These are skipped now (`[orphan] … no dialog is open; skipping`), for
`click_control`, `field_input`, `field_focus`, `field_selection`, `handleTab`
and `scrollbar_setPosition`. **33 files** used to stop here; none do.

**This build raises a dialog the recording never saw.** That is `Replaying a
dialog, have the wrong replay action`, and the message now names the dialog and
prints its `title` and `str1`, which is the whole diagnosis — it turned an
undifferentiated pile into a histogram the moment it landed. All but one are
dismissed by triggering the escape button, falling back to the default one;
`BOE_STRICT_DIALOG=1` restores the throw.

**`party-death` is the exception.** Dismissing it does not bring the party
back: the game drops to MODE_STARTUP, every later action lands on a game that
has ended, and the run walks off into a destroyed dialog — the tell is a
control-name list that comes back as heap garbage. It stops instead, saying
that this build's party died where the recording's lived. **18 files** end
there, and it is the largest single thing left in the oracle.

A click that lands while a dialog *is* up still gets the strict treatment: that
case really does mean the two builds raised different dialogs. Note the lookup
behind it is **recursive** (`findControl`), because `controls` holds only the
top level — seven files used to die on `Dialog 'pick-save' has no control
'save1'` about a dialog that defines `save1` one level down inside
`<stack name='list'>`. Upstream has the same bug and is left alone.

## Known gaps

`survey.sh` is the honest inventory; **43 of 87** run to the end. What's left,
in size order:

- **18** `The party died here and the recording's did not` — see above.
- **7** `Dialog '…' has no control '…'`, all singles now, all genuinely
  different dialogs (`confirm-spend-xp`, `attack-friendly`, `1str`, `2str`, …).
- **5** `TIMEOUT` — four of them hang at action 2 and have never been looked at.
- **5** `Tried to access out-of-range element` in a 48×48 `vector2d`.
- **3** scenarios whose feature flags it refuses (`conveyor-belts … 'V2'`).
- **2** signal 11, **1** signal 10.
- one each: `Unexpectedly failed to give item!`, a missing scenario, and
  `max-files does not exist in dialog preferences` (the file picker's dialog
  definition wants a pref the harness's stand-in loader doesn't set).

What the harness does **not** yet do is dump an end state. Matching the C++'s
final party, SDFs and position is the golden master `PROGRESS.md` still asks for;
the trace is the intermediate step that makes the *first* divergence findable.
