# Working on exile-js

**Read `PROGRESS.md` first, then `PLAN.md`.** Between them they hold everything
needed to resume cold: what the project is, what's done, what's next, and the
reverse-engineering findings that were expensive to discover. This is
deliberate — the project is meant to be picked up by any model or session, so
nothing important lives only in a conversation.

## What this is

A from-scratch TypeScript rewrite of the **Blades of Exile game player**
(player only — no scenario or character editor), porting from
`../exile-wasm`, a working C++/Emscripten port of Open Blades of Exile. Part 2
of the plan converts Exile 3 into a scenario the new engine can play.

`../exile-wasm` is the reference implementation **that runs**, and the corpus is
measured against it. But it is Open Blades of Exile — a decade of community
modification — and `../boe-source-1997` is Jeff Vogel's original, which is the
*specification* this port follows where the two disagree. When in doubt about a
rule, read the C++ rather than guessing — `PLAN.md` lists the critical files —
and **read `DIVERGENCES.md` before assuming which C++ is right.**

## Conventions that matter

- **Faithful port.** Same mechanics, the original 605×430 UI, the original
  assets. Where the C++ does something that looks like a bug, keep it and say
  so in a comment — a silent "fix" is a divergence, and replays depend on
  matching behaviour. `get_ran`'s *call order* is part of the spec.
- **Numeric enum values are ported verbatim** where they appear in save or
  scenario files. Don't renumber or reorder them.
- **Original over OBoE where a player could tell, OBoE where only the dice
  differ.** That is the rule `DIVERGENCES.md` records and justifies; the one
  decided case so far is `get_ran`, where matching the original would cost the
  entire replay corpus and change nothing a player can see.
- **`TODO(Mn)` marks every place the port stops short**, naming the milestone
  that fills it in. `grep -rn "TODO(M" src/` is the honest inventory of what's
  missing.
- **Update `PROGRESS.md` and commit it with the work.** New findings go in its
  gotchas log with a date.

## Checks before calling anything done

```
npx vitest run          # all tests, headless, no browser needed
npx tsc --noEmit        # strict, with noUncheckedIndexedAccess
node scripts/floating-promises.mjs   # async calls nobody waits for
node scripts/opcode-sweep.mjs        # special-node opcodes with no case arm
npx vite --port 5199    # then, in another shell:
node scripts/verify-screen.mjs   # drives the real UI in Chromium, screenshots it
```

`floating-promises.mjs` is cheap and worth the habit: **`get_ran`'s call order
is part of the spec**, and a dropped promise breaks the order while leaving
every individual answer correct — so the tests pass, the game looks right, and
the replay corpus reports a divergence in whatever function happened to be
holding the RNG. Write `void f()` where you mean it.

`opcode-sweep.mjs` answers "is this opcode category actually finished?" — it
expands `CATEGORY_RANGES` and reports every `SpecType` with no `case` arm. It
exits 0 today, and it counts **case labels rather than mentions** on purpose:
the hand-rolled version that matched bare `SpecType.NAME` was fooled for months
by `CATEGORY_RANGES` naming its own range endpoints, which hid two real
opcodes.

`verify-screen.mjs` is the end-to-end gate — it exercises every milestone's
demo path and fails on any console error. `SHOTS_DIR=...` chooses where the
screenshots land; look at them, since several real bugs have only ever shown up
visually.
