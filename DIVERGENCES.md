# Where OBoE departs from the 1997 original

This port has **three** references, and they do not agree. This file is the
catalogue of where they differ, why, and which one this port follows.

| | what it is | role here |
|---|---|---|
| `../boe-source-1997` | Jeff Vogel's original, Release 3, GPL v2 | the **specification** |
| `../exile-wasm` | Open Blades of Exile, a decade of community work on top | the **oracle** (it runs) |
| `../exile-wasm/test/replays` | 87 recordings from *several* OBoE builds | the **corpus** |

## Why this file exists

Without it, a corpus divergence is ambiguous: *is this port wrong, or did OBoE
change the rule?* Reading the 1997 source answers that in one grep, and this
file is where the answer gets kept so nobody pays for it twice.

**The corpus is entirely OBoE's.** The 1997 code has no replay system — no
`record_action`, no `<actions>` XML — so no recording can come from it. The
recordings disagree with `../exile-wasm` because they were made by *older OBoE
builds*, not because they are older than OBoE.

## The rule this port follows

> **Follow the original where the difference is observable to a player.
> Keep OBoE where the difference is only in RNG consumption.**

The second half is not a fudge, and it buys something specific: the corpus is
the only automated correctness signal the project has, and a change in
`get_ran`'s *draw count* destroys it globally (see #1). A change that returns
the same value and spends a different number of dice is invisible to a player
and worth trading away; a change to what a spell does is not.

**A further reason to prefer the original, for Part 2:** the 1997 code is
contemporaneous with the Exile 3 binary, and its structs are laid out the way
E3's data is. OBoE's refactored `cPlayer`/`eSkill`/`eTrait` world will map to
that binary much worse than `pc_record_type` and `adven[i].skills[9]` do.

## How to use it

Before implementing a rule to fix a corpus divergence:

```
grep -rin '<the rule>' ../boe-source-1997/'Windows Code Release 3'/*.CPP
```

The Windows half is the readable one. The Mac half is the same logic in
classic-Mac C with CR line endings — `tr '\r' '\n' < file.c` to read it — and
is worth checking before calling any divergence real, since OBoE descends from
both. Every "verified" entry below was checked against both.

---

## Verified divergences

### 1. `get_ran(n, x, x)` spends `n` draws in the original and none in OBoE

**DECIDED: keep OBoE's behaviour.**

```c
/* 1997, GLOBAL.CPP:19 */                 // OBoE, mathutil.cpp:15
if ((max - min + 1) == 0) return 0;       if (max < min) max = min;
for (i = 1; i < times + 1; i++) {         if (max == min) return times * min;
    store = rand() % (max - min + 1);     //  ^ returns without drawing
```

The original's guard fires only for `max == min - 1`. `max == min` falls into
the loop and spends `times` calls on `rand() % 1`. **Same value, different draw
count.** The generators differ too (`rand()` vs `std::mt19937`), but that is
not the problem — the draw count is.

These calls are **invisible in every trace**, because the trace hook sits after
OBoE's early return. `BOE_TRACE_RAN_DEGENERATE=1` counts them: **307 in
`VoDT_01-05-2025_17-52-13` alone**, all `get_ran(1,1,1)`, scattered from early
in the run. Adopting the original here parts the streams within a few actions
and they never realign — the corpus stops being an oracle on day one.

No player can observe the difference. This is the one place where deviating
from the original costs nothing and buys everything.

### 2. `place_wand_monst`'s extra spawns are a different rule entirely

**OPEN — this port currently follows OBoE.** `src/game/wandering.ts:255`.

The original (`MONSTER.CPP:152`, and `monster.c:150` identically) does, for
**each non-zero** `monst[i]`, three position blocks of two draws each:

```c
if (wandering[r1].monst[i] != 0) {
    p_loc = locs[r2]; p_loc.x += get_ran(1,0,4)-2; p_loc.y += get_ran(1,0,4)-2;
    if (!is_blocked(p_loc)) place_monster(monst[i], p_loc);
    p_loc = locs[r2]; …two more draws…
    if ((r1 >= 2) && (i == 0) && !is_blocked(p_loc)) place_monster(monst[i], p_loc);
    p_loc = locs[r2]; …two more draws…
    if ((r1 == 3) && (i == 1) && !is_blocked(p_loc)) place_monster(monst[i], p_loc);
}
```

So: **six draws per non-zero slot, none for empty slots**; the extra copies are
of `monst[i]` itself; and the gate is purely the group index `r1` and the slot
`i`, with **no die roll at all**.

OBoE (`boe.monster.cpp:66`) instead has a `try_place_extra_monster` lambda that
spends **three** draws (two for the position, plus a new `r3 = get_ran(1,0,3)`),
runs on **every** iteration whether or not `monst[i]` is set, and places
**`monst[3]`** gated on `r3 >= 2`.

Different draw count, different draw sites, different monster placed, different
gate. OBoE's comment calls its unflagged branch "buggy behavior … preserved so
old replays will run correctly" — but the behaviour it preserves is **OBoE's own
earlier version**, not the original's.

Note this interacts with two flags every recording carries
(`empty-wandering-monster-bug`, `too-many-extra-wandering-monsters-bug`), so
changing it is a corpus-wide event. Don't take it casually.

**Bonus, already ported:** OBoE guards the trailing call with
`has_feature_flag("too-many-extra-wandering-monsters", "fixed")` — missing the
`-bug` the flag is registered under, so it is dead code. Kept deliberately;
see the comment in `wandering.ts`.

### 3. Magic resistance — two changes, only one of them flagged

**OPEN — this port currently follows OBoE.**

The original (`PARTY.CPP:3466`):

```c
// Mag. res helps w. fire and cold
if (((damage_type == 1) || (damage_type == 5)) && (adven[which_pc].status[5] > 0))
        how_much = how_much / 2;
```

OBoE (`boe.party.cpp:2612`) changes it twice:

- **Flagged.** `magic-resistance: fixed` adds `MAGIC` and `ACID` to the damage
  types ("Resist Magic used to not help with magic damage!"). Recordings that
  predate it don't declare the flag and get the original set.
- **Not flagged.** OBoE adds `else if(magic_res < 0) how_much *= 2;` —
  **negative magic resistance now doubles damage**. The original has no such
  branch at all, under any flag.

The second is invisible to the feature-flag mechanism and would silently change
any scenario that applies negative magic resistance.

### 4. Traits: 15 in the original, 17 in OBoE

**DEFERRED to Part 2 (Exile 3).**

`GLOBAL.H:414` is `Boolean advan[15], traits[15]`. OBoE's `eTrait`
(`skills_traits.hpp:45`) runs to 16, adding `PACIFIST = 15` and `ANAMA = 16` —
both back-ported from Exile III.

`ANAMA` gates mage casting in OBoE (`boe.party.cpp:1598`, `NO_CAST_ANAMA`) and
appears in the original **once**, at `COMBAT.CPP:1350`, as a `+25` damage bonus
against demons driven by a scenario flag (`PSD[4][0] == 3`) rather than a PC
trait. Nothing sets `ANAMA` at runtime in OBoE either — it is a
character-creation trait — so it is inert for Part 1.

Its twin, `PACIFIST`, *is* covered by a feature flag
(`pacifist-spellcast-check`); `ANAMA` is not, four lines away in the same
function. That asymmetry is a good example of the flag mechanism being
incomplete rather than wrong.

### 5. Buying a boat or a horse when none is left

**DECIDED: follow the original.** `src/game/talk.ts`, `BUY_SHIP`/`BUY_HORSE`.
The Mac half is identical (`dialogutils.c:917`).

```c
/* 1997, DLGUTILS.CPP:906 */                  // OBoE, boe.dlgutil.cpp:1088
for (i = b; i <= b + c; i++)                  b = minmax(0, boats.size() - 1, b);
  if ((i >= 0) && (i < 30) &&                 c = minmax(0, boats.size() - b, c);
      (party.boats[i].property == TRUE)) {    auto iter = find_if(boats.begin() + b,
    party.gold -= a; …property = FALSE;           boats.begin() + b + c, …property);
    i = 1000; }                               if(iter != boats.end()) {
if (i < 1000) "There are no boats left."          gold -= a; iter->property = false;
```

OBoE searches `[b, b+c)` but tests the result against `boats.end()` rather
than against the end of *that range*. When the range is sold out, `find_if`
returns `boats.begin() + b + c`, which is not `end()` unless the range happens
to finish the list — so the party **pays for a boat and gets nothing**
(`boats[b+c]` is marked the party's, and it either already was or was never
for sale), and never hears "There are no boats left." A player can tell.

The original walks `b..b+c` **inclusive**, one more vehicle than its own
editor's "Total number of boats sold" promises (`Scen Ed/STRINGS.RC:12144`) —
and the shipped scenarios were written against that, not against the label.
Stealth's horse trader (town 1, Bearden) is `buy-horse 400 0 2`, and the town
has exactly **three** horses for sale, 0-2. Under the original each purchase
takes the next of the three and the fourth hears "There are no horses left."
Under OBoE the third purchase *also* works, but only through the bug —
`find_if` misses and returns `begin()+2`, which is horse 2 — and every
purchase after that takes 400 gold and hands over nothing. Neither version
draws, so the corpus cannot see the choice.

---

## Agreements worth recording

The catalogue is not only for differences. When the two references **agree**
and this port does not, that is a plain port bug and the entry is closed as
soon as it is fixed — but it is worth writing down that the question was asked,
so nobody asks it twice.

- **Declining a generic portal does not block the move.** `TOWN_GENERIC_PORTAL`
  touches neither `ret_a` nor `next_spec` on "No" — OBoE at
  `boe.specials.cpp:3972` sets `*ctx.ret_a = 1` only inside the "yes" branch,
  and the original does the same at `SPECIALS.CPP:2584` (`*a = 1` under
  `FCD(870,0) == 2` alone). Its custom-text sibling `TOWN_PORTAL` *does* block
  on decline (`:4073`), and the two are separate `case`s in the C++.
  This port had merged them, so the generic portal inherited the custom one's
  refusal and the party stopped one square short. Fixed 2026-08-31;
  `ZKR_15-05-2025_18-04-58` went from 6,674/6,676 draws to **all 6,676**.

## OBoE's own list of deliberate deviations

`boe.main.cpp:107` is a community-written changelog of behaviours OBoE
versioned on purpose. Every recording declares which version it was made with,
and `replay_feature_flags` (`boe.main.cpp:1186`) does `feature_flags =
recorded_flags` — **replacing the build's whole table**, so a flag a recording
never mentions reads as *legacy*.

This table is the free seed of this catalogue. **Its comments are OBoE's
claims, not verified facts** — #2 and #3 above are both entries whose real
behaviour turned out to differ from what the comment implies. Status column is
whether *this file* has checked it against 1997.

| flag | OBoE's description | checked? |
|---|---|---|
| `magic-resistance` | "Resist Magic used to not help with magic damage!" | **yes — see #3, and it hides a second, unflagged change** |
| `too-many-extra-wandering-monsters-bug` | "would create more than 1-2 of the last monster type" | **yes — see #2, the legacy branch is not the original either** |
| `empty-wandering-monster-bug` | "would spawn nameless monsters of type 0" | partly, via #2 |
| `pacifist-spellcast-check` | legacy "lets the player select combat spells and click 'Cast' which will fail" | not yet |
| `store-spell-target` / `store-spell-caster` | "fixed" | not yet |
| `conveyor-belts` | "Diagonal conveyor belts and big monster physics" | not yet — 3 corpus files refuse on it |
| `resurrection-balm` | scenario-declared | not yet |
| `target-lock` V1/V2 | screen-shift policy when targeting | not yet — UI, likely no rules effect |
| `talk-go-back` StackV1 | talk-mode history | not yet — UI |
| `file-picker-dialog` V1 | in-game save picker | not yet — UI, but see the `pick-save` harness gap |
| `scenario-meta-format` V2 | file format | not yet |
| `debug-enter-town`, `debug-kill-party` | debug actions | not yet — debug only |

## Open question this catalogue has not answered

The recordings' spellcast block (20 files) is **not** explained by #4. Gating
the Anama check behind a flag does not open the dialog: the PC has zero mage
skill and zero spell points, and the original refuses on the same grounds
before `pick_spell` (`COMBAT.CPP:4096`). So the recording's build opened a mage
picker for a PC who could not cast — behaviour in **neither** reference. The
`pacifist-spellcast-check` comment describes exactly that shape as legacy, so
the likely answer is a general dialog-opening policy that changed and was only
flagged for the Pacifist case. Unproven.
