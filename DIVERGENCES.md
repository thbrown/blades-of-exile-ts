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


### 6. Legacy `.exs` import (2026-09-23)

**DECIDED: match OBoE's in-memory import exactly, with one exception.** The
importer (`src/fileio/legacy/`) is held field for field against the C++
loading the same file (`tools/cppharness/dump-scen.sh`,
`test/legacyImport.test.ts`), over all 171 legacy files available: the three
1997 Mac originals and the whole community archive. OBoE's `import_legacy`
conversions are what every legacy scenario has been played with for a decade,
and there's nothing in the 1997 game to compare them with. It never converted
anything, since it read the structs natively.

- **Byte order (the exception): read every field natively.** OBoE reads the
  raw bytes and then byte-swaps a hand-picked list of fields
  (`porting.cpp`). This port reads every multi-byte field in the file's own
  order, which is what the 1997 game did on the platform that wrote the file.
  Where OBoE's list misses a field (a scenario monster's `status[15]`, for
  one), it reads a foreign-endian file wrong. None of those fields feeds
  anything the game uses, so the oracle can't tell the difference.
- **Garbage stays OBoE's garbage.** A negative attack in a corrupt file wraps
  to 65,000-odd dice in OBoE's `unsigned short` (`masks.exs`, whose monster
  block is unreadable in both). Kept, because the oracle is only exact if
  it's kept.
- **`char[]` names run on to the first NUL**, past the field's end, because
  `std::string(field)` reads that way. The 1997 game printed them the same
  way, so this is an agreement, not a divergence.
- **Where the C++ reads uninitialised memory, this port doesn't try.** There
  are three places: the type of a preset field the old game didn't have
  (`cField temp` is never initialised; nothing places such a field either
  way), `cost_adj` on the five junk shops and the healer (`cShop(eShopPreset)`
  never sets it; 0 here, the normal price), and the first strings of a town
  whose record lies past the end of its file (`Shadow.exs`). The test
  excludes each of them by name.
- **Old custom graphics are cut every 360 rows.** OBoE's editor converts an
  old `.bmp` sheet by stepping 280 rows (`convert_sheets`), which misplaces
  every sheet after the first. The game never calls that function; it indexes
  the whole picture (`find_graphic` with `is_old`), and 360-row sheets index
  identically.
- **The copies in the 1997 *Windows* code release don't load in either
  engine.** Their size tables fall 1.5–3.8 KB short of the file. The
  Windows-made scenarios in the archive (48) all have exact tables, so this
  is a quirk of those three files, not of the platform.

### 7. Taking a party into a scenario (2026-09-23)

**DECIDED: the original wherever the two differ** — except custom pictures,
which since 2026-10-03 follow OBoE (below). The party can visibly tell every
difference, and several of OBoE's choices depend on `exportSummons`, which
this port doesn't have yet (`TODO(campaign)`).
Each point below was checked in both sources: `put_party_in_scen` and
`init_party_scen_data` (PARTY.CPP:320, :440), and `put_party_in_scen`
(boe.party.cpp:119) and `cUniverse::enter_scenario` (universe.cpp:1384).
The code is in `Universe.enterScenario` and `GameSession.enterWithParty`.

| | 1997 | OBoE | here |
|---|---|---|---|
| Items taken away | a custom picture (`graphic_num >= 150`, 1000+ here), summoning | call-special abilities, IMPORTANT slayers and wards | **both lists, less exported pictures**: OBoE's abilities don't exist in 1997, so the two lists don't conflict; a picture `exportGraphics` made the party's (10000+) stays |
| Custom pictures | the item goes | copied to the party's sheet on a win (`exportGraphics`), item kept | **OBoE** (2026-10-03, user's decision). 1997 had no party sheet to keep them on, and Exile III's items are *all* custom pictures (sheet 11), so 1997's rule emptied an E3 party's pack at the next scenario's door. A picture still 1000..9999 at the door was never exported (a party saved before this) and still goes |
| Soul crystal | emptied | kept (exported) | emptied |
| Monsters seen (`m_seen`) | emptied | kept | emptied |
| Stored items, on "yes" | all of them, as many as the party can carry | the player picks | all of them |
| `PSD[306][4]` | survives the SDF wipe | wiped | moot: it held the "no instant help" preference, which is a preference here |

- **The journal is emptied.** 1997 empties `journal_str` (PARTY.CPP:373),
  and OBoE has the clear commented out ("Now uncertain if the journal should
  really persist"). The events journal landed 2026-09-27 (§10), and
  `enterScenario` empties it, as the original does.
- **Kept from OBoE, as a likely bug:** `enter_scenario` adds the new
  scenario's auto-start quests without removing the last scenario's, and job
  banks keep their anger. The original has no quests to compare with.
- **Stored items are now saved** (`STORED` pages, as OBoE writes them). This
  port used to drop them on save and load even within a scenario.

---

### 8. The About box (2026-09-23)

**DECIDED: the original.** OBoE's about-boe.xml is its own: "v2.0 alpha",
a scrolling pane of open-source credits and funders, the GPL notice and
GitHub links. The 1997 box is dialog 1062 (GAMEDLOG.RC:1334): version
1.0.1, Spiderweb's copyright, four credits, the trademark line, the $30
shareware note and the 1997 contact addresses. A player can see which one
they get, so the file is the 1997 dialog again, verbatim. The only
difference is that the credits' three-space indent is lost to whitespace
condensing. The page's own masthead links to this port's source.

---

### 9. `day_reached`: three versions, and the engine has OBoE's (2026-09-24)

**DECIDED (2026-09-28): the original's last row in the live game, OBoE's
in a replay**, through an blades-of-exile-ts feature flag, `day-reached` = `1997`, as
§14, §17 and §18 do: an event that never happened passes. The extra days are
unchanged (OBoE's +10 in easy mode); Exile III puts its own +20 into its
data. The first half of what follows is the finding as it stood.

Found while converting Exile 3,
whose `day_reached` (`FUN_10d0_54b8`) is the Windows 1997 one exactly. This
test runs everywhere time matters: talk nodes, creatures that come and go,
towns that fall.

| | Windows 1997 (TEXT.CPP:1653) | Mac 1997 (text.c:1719) | OBoE (boe.text.cpp:1233), this port |
|---|---|---|---|
| Extra days | **+20, always** ("to give party bonus time") | none | +10 in easy mode only |
| "No event" | event 8 | event 0 | event 0 |
| An event that never happened | passes: `key_times` start at 30000 (PARTY.CPP) | passes, the same way | **fails**: `key_times` is a map and a missing key returns false |

The last row is the one a player can see. Take a creature that appears on
day 30 unless event 3 happened first. In both 1997 builds it turns up on day
30 if event 3 never happened. In OBoE it never turns up at all. Neither
original reads an unset event as "no".

- **Exile 3 depends on it.** Its events 0–3 are the four plague sources
  destroyed (`setEvent`), and fourteen towns fall on their day *unless* the
  source went first (`<chop event>`), as do five creatures. The converter
  (`e3DayReached`) used to drop the event, so towns fell to a plague the
  party had already ended; it keeps it now (8 is E3's "none").
- **Legacy BoE scenarios (Part 1b) do depend on it.** A 1997-era scenario
  that uses events gets OBoE's answer. The Windows +20 is another question:
  it depends on which build the scenario was balanced for.
- **Related:** the travelling-NPC rota (time flags 4–6) turns every 1,000
  ticks of age in 1997 (`party.age / 1000 % 3`) and E3. OBoE turns it by the
  day.

---

### 10. The events journal (2026-09-27)

**DECIDED: OBoE's journal, E3's paging, and an blades-of-exile-ts opcode to fill it.**
The 1997 original keeps `journal_str` in the party record and clears it, but
has no dialog that shows it and nothing that adds to it. OBoE ports the rest
(`journal()`, `add_to_journal`, `event-journal.xml`, `<journal>` strings,
`JOURNAL` save pages), but no special node reaches `add_to_journal`, so its
journal is always empty. Exile III's journal is the one that works
(`FUN_1008_3780` adds, `FUN_1008_3507` shows), and E3 adds entries from 33
places in its scripts.

- **The opcode is an blades-of-exile-ts one**: `journal` (48, `SpecType.ADD_JOURNAL`),
  in the gap after `STR_BUF_TO_SIGN` and inside GENERAL's range. `ex1a` is
  the `<journal>` string. OBoE would read a scenario using it as having an
  unknown opcode, which is the same as for every other blades-of-exile-ts extension.
- **Paging follows E3.** OBoE's `fill_journal` indexes `journal[i]` without
  the page, so every page shows the first three entries. Nobody could see
  that in OBoE; a player would see it in E3.
- **Duplicates follow OBoE.** E3 appends every time; `cParty::add_to_journal`
  refuses the same text on the same day. That only matters where an entry
  can fire twice in one day. Zone 73's goblin outpost (entry 3) fires on
  every visit.
- **Replays are unaffected.** Every recording has an empty journal, so the
  driver still takes the early return.

---

### 11. Testing a town's visibility (2026-09-27)

**DECIDED: an blades-of-exile-ts opcode, `if-town-visible` (161,
`SpecType.IF_TOWN_VISIBLE`).** BoE, in 1997 and in OBoE, can hide and show a
town (`town-visible`, SET_TOWN_VISIBILITY) but has no node that reads the
flag back. Exile III's scripts read `can_find_town[t]` in five places: zones
14, 23, 45 and 84 and Purgatos's Phoenix Egg. The opcode jumps to `ex1b` when
town `ex1a` shows, as the other if-then nodes do. It sits in the gap after
`IF_QUEST`, inside IF_THEN's range. A town out of range says "Town out of
range." as the setter does, and doesn't branch. As with `journal` (§10), OBoE
would read a scenario using it as having an unknown opcode.

---

### 12. Who moves when a town turns hostile (2026-09-27)

**DECIDED: a scenario flag, `hostile-movers`, for Exile III's rule.** BoE
(1997 and OBoE) makes every creature it turns mobile and gives guards
(`<guard>`, 1997's `spec_skill` 37) an alert, ×3 health and two statuses.
Exile III's `make_town_hostile` (`FUN_1070_23b9`) gets only monsters 12–20,
91–98 and 149–154 moving and alerted; everyone else turns hostile where they
stand, and only 91 and 92 get the boost. A player sees the difference as a
shopkeeper who stays behind the counter. So `hostile-movers` lists the monsters
that move, and without it the rule is BoE's. The E3 converter writes the list
and marks 91 and 92 `<guard>`. E3's per-town cases (the endings) need no engine
change: they are OBoE's `spec_on_hostile` (`<onoffend>`), whose comment,
"In some towns, doing this will get you killed", is where 1997 had cut them.

---

### 13. How the party came into a town, and a creature's mobility (2026-09-27)

**DECIDED: an blades-of-exile-ts opcode, `if-entry-dir` (162, `SpecType.IF_ENTRY_DIR`),
and TOWN_SET_ATTITUDE values 10–13 and 20–23.** Exile III's town loader reads
its `entry_dir` argument twice: the town's greeting shows only to a party that
walked in (`entry_dir < 9`, not a script's move), and Wolfrider Warren opens a
door to one that came in by entrance 3. BoE uses `entry_dir` to choose a start
square and then forgets it, so the live town now keeps it
(`CurTown.entryDir`, 9 for a loaded game) and the opcode jumps to `ex1c` when
it is from `ex1a` to `ex1b`. It sits after `if-town-visible` (§11).

Castle Troglo's entry sets every creature docile *and still* below stage 7 of
Vothkaro's story, and hostile with its record's mobility from it. No BoE node
touches `mobile`, so TOWN_SET_ATTITUDE takes `10 + a` (attitude `a`, stands
still) and `20 + a` (attitude `a`, moves). OBoE says "Invalid attitude (0-3)."
to both, so no BoE scenario uses them, as with RECT_PLACE_FIELD's `100 + f`.

---

### 14. A town cleaned out or abandoned (2026-09-27)

**DECIDED: the original's rule in the live game, OBoE's in a replay**, through
an blades-of-exile-ts feature flag, `town-thrash` = `1997` (`featureFlags.ts`). The live
game has it; a recording's flag set replaces the build's and never lists it,
so a replay runs OBoE's rule, as with OBoE's own flags. Both 1997 builds
(Windows TOWN.CPP:348 and :375, Mac town.c:329 and :359) and Exile III's town
loader (`10d8:0f4c`, `10d8:1057`) agree, and OBoE differs in three ways a
player can see:

| | 1997 and Exile III | OBoE (boe.town.cpp, town.cpp:191) |
|---|---|---|
| Cleaned out | kills **>** `max_num_monst` | kills **>=** (b8ac49f9, the refactor that made a negative limit mean "never") |
| On the chop day | nothing is said; the line is commented out | "Area has been abandoned." |
| An `after-death` creature (time flag 9, OBoE's 8) | only once the chop day comes | also in a cleaned-out town |

The first is the one most likely to be met: a town with a limit of 40 empties
at 41 kills, not 40. Wandering monsters still stop at the limit (`<` in
MONSTER.CPP:148, as in OBoE), so a town at exactly the limit has neither. The
negative limit is kept: it is a format extension, and no 1997 scenario has
one. Exile III's villages 151 and 152 (limit 40) and village 121's slimes
(after-death) are where it shows there.

The corpus needs OBoE's `>=`: without the flag, `long/VoDT-5-11.xml`
re-enters a town at exactly its limit, keeps a monster the C++ removed, and
parts at draw 9,674 of 31,963 (1,231,440 matched draws fell to 1,209,150).

---

### 15. Town timers that repeat (2026-09-27)

**DECIDED: a scenario flag, `town-timers` = `repeat`.** BoE's town timers
(1997 and OBoE) are zeroed the first time they fire, so "every N ticks" is
really once a game. Exile III's golem generators run on every eighth tick of
age in the Tower of Shifting Floors (`10c0:71cb`), for as long as the party is
there. With the flag, a town's `<timer>` keeps firing on each multiple of its
`freq`; without it, BoE's rule stands. The E3 converter sets it, and E3 has no
other town timers.

---

### 16. A night at an inn (2026-09-27)

**DECIDED: a scenario flag, `inn` = `exile3`, for Exile III's inn.** 1997's
INN node (DLGUTILS.CPP:785) heals `30 × b`, restores `25 × b` spell points,
adds 700 to the party's age and puts it in the bed. OBoE's calls `do_rest`
with the same numbers, which also clears every status, runs disease three
times, restocks shops and fires timers. Exile III's (`1020:269f`) is 1997's
with a **500**-tick night. With the flag, the engine does exactly that; without
it, OBoE's `do_rest(700, …)` stands.

**Not decided:** 1997 against OBoE for an ordinary BoE scenario. A player
could tell (a poisoned PC stays poisoned in 1997), so the rule above would
pick 1997, but it would have to sit behind a feature flag like §14's
to keep the replay corpus. Nothing has been measured yet.

---

### 17. A PC's saving roll against sleep and paralysis (2026-09-27)

**DECIDED: the original's roll in the live game, OBoE's in a replay**, through
an blades-of-exile-ts feature flag, `sleep-save` = `1997`, as in §14. The roll in
`sleep_pc` (1997 PARTY.CPP:904) is `get_ran(1,0,100) + adjust` against
`30 + 2 × the PC's level`. OBoE's `cPlayer::sleep` (pc.cpp:231) rolls
`get_ran(1,1,100) + adjust` against `30 + 2 × level`, where `level` is a local
that has just been set to the PC's **free action** protection. Both declare
that local, but only 1997 tests `adven[which_pc].level`. So in OBoE a PC
without free action saves only when the roll comes in under 30, whatever
their level. In 1997 a level-20 PC saves at under 70. Exile III's `sleep_pc`
(`10b0:1a69`) has 1997's roll. A player can tell. The draw count is the same
(one die either way), so a replay parts only where a save comes out
differently. This is why it needs the flag.

Only sleep and paralysis change. A forcecage is OBoE's alone and keeps OBoE's
roll. Not changed: OBoE's other additions to the function (race
immunities, `STATUS_PROTECTION`), which 1997 content can't reach, and
monsters' saving rolls, which have not been compared.

---

### 18. A failed bash, and its roll (2026-09-27)

**DECIDED: the original's in the live game, OBoE's in a replay**, through an
blades-of-exile-ts feature flag, `bash-door` = `1997`, as in §14 and §17. 1997's
`bash_door` (TOWN.CPP) rolls `get_ran(1,0,100)` and hurts a failed basher
with `damage_pc(pc, get_ran(1,1,4), 4, -1)`: type 4, unblockable. OBoE's
(boe.town.cpp:1204) rolls from 1 and hurts with `eDamageType::SPECIAL`.
A player can tell. The blast is the unblockable one rather than the magic
one, the sound is 5 rather than the plain thud, and invulnerability stops
unblockable damage but not SPECIAL. Found in play-testing Exile III, whose
bash (`10d8:4224`) is 1997's with its own odds (the scenario flag
`bash` = `exile3`, `src/game/doors.ts`). The draw count is the same.

---

### 19. How long a missile holds the turn (2026-09-27)

**DECIDED: the original's.** 1997's `do_missile_anim` (NEWGRAPH.CPP) and
Exile III's (`exile3.c:46769`) note the time as they start and, after the
flight, wait until `pause_len + 40` ms have gone by, `pause_len` being the
launch sound's length: 660 for sound 11, 410 for 12, 200 for 14, 1000 for 53,
500 for 64. OBoE's (boe.newgraph.cpp:347) has no such wait, so its fireball
bursts before its sound has finished. Timing only, with no draws, so no flag:
`holdForSound` in `src/game/missileAnim.ts`.

### 20. The arrows while a spell or missile is aimed (2026-09-28)

**DECIDED: this port's own, at the user's request; a UI change, not a rule.**
In both the original and OBoE an arrow key during targeting is a click on the
square next to the caster, so a spell can only be aimed by mouse. Here the
target starts on the nearest hostile the party can see and reach (skipping
squares a multi-target spell has already picked), the arrows move it, and
Enter — or the middle of the touch pad — takes that square exactly as a click
on it would. A mouse over the view still aims as it always has. Past the view's
edge the cursor scrolls it, by the same `screen_shift` the border arrows use,
where the mode allows the border arrows at all. What reaches
the rules is the same click, so recordings can't tell, and finding the target
draws no dice (`test/aimCursor.test.ts`). `src/game/aimCursor.ts`.

*Extended 2026-09-29, again at the user's request*: with touch controls on,
**Talk** gets the same cursor (`talkAim`). It starts on the nearest visible
townsperson — anyone rather than a hostile — and the pad's middle talks to
the square, which is the click `handle_talk` already takes anywhere in sight.
The pad's eight directions alone only reached the adjacent squares, so a
shopkeeper across a counter needed a precise tap on a phone's small view.

### 21. Naming a town creature by its slot (2026-09-28)

**DECIDED: two blades-of-exile-ts opcodes, `if-creature` (163, IF_THEN) and
`town-creature` (205, TOWN).** Exile III's scripts read and write its
creatures' records directly — `active` (+0), attitude (+2), health (+9) —
where BoE can only act on creatures by kind, by square, or through a
conversation's END_DIE. `if-creature` jumps to `ex1b` when slot `ex1a` is here
(`ex2a` 0), here with attitude `ex2b` (1), or its group not yet brought in
(2: its live encounter code is still set). `town-creature` wakes slot `ex1a`
to hunt (`ex1b` 0), sets its health to `ex1c` (1, uncapped, as E3 writes it),
takes it away (2), or takes it away and sets its death flag (3, END_DIE's
effect); slot -1 is everyone, -2 the creature being talked to. Both touch only
creatures that are here, as E3 tests `active > 0` first.

This replaced a converter workaround: E3's alive tests had been expressed as
invented death flags (`e3DeathFlag`), which also kept those creatures dead
when their town reloaded (E3 brings them back) and made the four Sharimiks'
Spragins one man. And OBoE's `activate_monsters` reads the encounter code off
the town *record*, which never changes, so a script bringing a group in twice
revived the dead; `SpecBuilder.bringIn` now tests the live code first, which
the engine clears, as E3 clears its own. As with §10 and §11, OBoE would read
a scenario using either opcode as having an unknown one.

### 22. Halving the party's health, and taking its magic (2026-09-28)

**DECIDED: two blades-of-exile-ts opcodes in AFFECT's range, `hp-percent` (108) and
`take-magic` (109).** Exile III's Pit of the Wyrm halves every PC's current
health (`cur_health / 2`, dead or alive), and its Great Circle takes every
magic item from the living PCs' packs, curses and all, and destroys the magic
items lying in the town. BoE can heal (which stops at the maximum) or damage
(which can kill), but not scale, and has no node that takes items by their
magic flag. `hp-percent` sets each target's health to `ex1a` percent, rounded
down; `take-magic` empties the targets' packs of magic items, and with `ex1a`
1 the town's floor too. Both do nothing to a creature target, as nine of
OBoE's AFFECT nodes do.

### 23. Exile III's items by Exile III's rules (2026-09-28)

**DECIDED: an item carries its E3 ability code (`Item.e3Ability`, port-only),
and a rule where E3 and BoE part asks it.** The converter maps E3's ability
codes onto BoE's (by name through bladbase, else by `E3_ABILITY_TO_LEGACY`),
which is as close as one number gets — but two E3 codes can land on one BoE
ability and mean different things. Sleep is the first case: E3's `sleep_pc`
(`10b0:19dd`) reads 118 (the Helm of Alertness) as immunity to sleep, 120
(the Ring of Free Action) as immunity to paralysis and 2 off a sleep, and 127
(Resistance) as 2 off a sleep, where BoE's Free Action (both 118 and 120 map
there) takes its strength off a sleep and makes paralysis hopeless, and Will
takes half its strength. `Player.sleep` now leaves items with an E3 code out
of BoE's sums and applies E3's rule to them. An item keeps its code in a save
(`E3ABIL`) and across scenarios, so an E3 ring stays an E3 ring.

The same mechanism now carries E3's combat items (`src/game/e3Items.ts`,
2026-09-28): its to-hit and damage sums for Skill Rings and two kinds of
gauntlets, Accuracy Rings on shots, the eight-case extra-damage table (much
smaller than bladbase's slayers), melee-only venom, +1 action point each
from a Ring and Boots of Speed, and the four worn items that act once a
combat round. BoE's rule skips an item with an E3 code (`notE3`); the item
keeps a BoE ability so that its description still names one.

And, 2026-09-29, its wards: poison, disease and dumbfounding by E3's codes;
damage resistances that always halve (E3 never quarters) and stack by kind,
with the Iceshield a *fire* ward as E3 has it; the Silver Ankh, not a
life-saving item, against undead drain, stun and icy touch; Aescal's Ring
ending disease; Micah's Gloves adding to dexterity's adjustment rather than
the skill. **An E3 item is cursed by its code (14, 95), not bladbase's
flag**, which curses five more items, and lifting the curse zeroes the code,
so uncursed Dancing Boots stop dancing.

And, 2026-09-29, *using* one (`src/game/e3ItemUse.ts`): E3's `use_item`
(`10c0:2c92`) whole — its use-code chart (`1140:0000`), its four mode gates
and its switch, one case per E3 code, on the item's level. Item spells cast
at E3's flat level 6. This fixed a live bug as well as the numbers: the
converter leaves E3's byte +8 (1 on a drinkable potion) in the BoE use type,
where it reads as "harm one", so every E3 healing potion *hurt*. The notes and
books (160–183) stay scenario specials, and the Skribbane Herb (135) stays
unusable pending its strings (`TODO(E3-3)` in that file).

The rest of E3's rules are the scenario's own, by flag, as `bash` is: Exile
III's lock picking is `pick-lock` = `exile3` (`10d8:3f67`, in `doors.ts`),
its Unlock spell `unlock` = `exile3:…` (`10b0:6402`, `e3UnlockSpell`; added
2026-10-01: a table of terrains rather than flag2, so a door past picking can
still be unlocked, and a success leaves the door closed, not open), and its
traps are mapped kind by kind in the converter (`SpecBuilder.trap`).

And, 2026-09-29, **every item-ability test in EXILE3.EXE has been read** (all
52 calls to its four item tests). Nine codes do what BoE's rule does and run
by it: life saving, petrify, regeneration, poison augment, returning
missiles, drain missiles, acid, and the Sapphire and Smoky Crystal as spell
components. The rest now run E3's own rules. Exploding Arrows (92) burst for
a fixed 4d6 fire (`missiles.ts`). The Uranium bar (110) is one roll every
500 turns, made whether or not anyone carries one (`uranium` =
`exile3:<node>`, `e3UraniumTick`). Alchemy (`alchemy` = `exile3`,
`e3MakePotion`) uses E3's tables and 1997's dice. The Resurrection Balm (13)
goes by E3's slot-16 test (`balm` = `exile3`, `e3TakeBalm`). Traps are
`trap` = `exile3` (`e3Trap.ts`). E3-SUSPECTED-BUGS #15–17 are the new odd
cases found.

### 24. A village falling to ruin (2026-09-28)

**DECIDED: an blades-of-exile-ts opcode, `copy-ter` (206, TOWN), and a hidden town
record per village.** Exile III's villages store no map; `FUN_1040_1600`
builds one on every visit from placed buildings, and a building shows its
ruin once its own `(day, event)` has come, or once the village is overrun
(its chop day). BoE's town map is fixed. The converter builds each of the 22
villages this touches a second time with every such building ruined, as a
town record after E3's 200 (hidden, with no entrance), and the village's
entry copies each building's 8×8 square in from it when its day has come.
`copy-ter` copies a rectangle of terrain from another town record, square by
square as CHANGE_TER does. Two small differences stay: the grass scattered
inside a ruined square is the ruins record's roll, not a fresh one; and
where two buildings overlap, copying one square can bring in part of the
other's ruin early.

### 25. Forgetting the towns the party remembers (2026-09-28)

**DECIDED: an blades-of-exile-ts opcode, `forget-towns` (49, GENERAL).** Exile III
empties its four saved towns (`party+0x29a6 + 0x1594k = 200`) twice as its
plot turns — when the roaches' plague ends and when Grah-Hoth's gate is cut —
so their creatures fill again from the records. BoE has the same four slots
(`creature_save`) but no node to empty them; OBoE's debug key does
(`debug_towns_forget`), and the opcode does what it does. OBoE would read a
scenario using it as having an unknown opcode.

### 26. Which vehicles follow a town that changes (2026-09-28)

**DECIDED: two optional attributes on `<town-flag>`, this port's own.**
OBoE's town replacement moves the horses and boats stabled in the entrance
record to the record it chooses. Exile III's loader moves the horses stabled
in any of a declining town's four records, and never a boat.
`span="n"` widens the source to records `town` to `town + n - 1`, and
`rehome="horses"` leaves the boats alone. A scenario without them behaves as
OBoE's; OBoE itself ignores attributes it doesn't know.

### 27. A blast that lands on a square, and a party near one (2026-09-28)

**DECIDED: a scenario flag, `explode-spots` = `exile3`, and an blades-of-exile-ts
opcode, `if-near` (164).** Exile III's slime pools (town 23) and the Agate
Tower's slime maker (town 46) are destroyed by an exploding missile landing on
them (`1018:9a2b`), and each turn they stand they breathe sleep over the
squares around a party within 8 (`10c0:6325`). OBoE lets a square answer a
*spell* (`cast_spell_on_space`, an IF_CONTEXT node in the TARGET context) but
not a missile, and no node measures distance. Under the flag an exploding
missile asks its square as a spell with no spell would; `if-near` jumps when
the party (the acting PC in combat) is nearer than `ex1c` by E3's measure,
the whole part of the straight line.

**Found on the way, a port gap:** OBoE's IF_CONTEXT, in the TARGET context,
passes only for the spell in `ex1b` when it isn't -1 (boe.specials.cpp:3832);
this port had dropped the test. It is back.

### 28. What a summoning spell brings (2026-09-28)

**DECIDED: a scenario flag, `summons` = `exile3`, with Exile III's lists in
the engine (`src/game/e3Summons.ts`).** BoE's `get_summon_monster` draws
random monsters until one has the summon class asked for. Exile III's
monsters have no class: each summoning spell makes one draw from a list of
its own (`DS:0770` in combat, `DS:3072` out of it), in the same place in the
cast, so the rolls either side keep their order. The lists can't be written
as classes: Summon Beast has its own where BoE uses class 1, monsters 73 and
74 are on two lists, and some are on one twice to weight the draw. With the
flag set, Exile III's summons never fail.

### 29. A creature that talks as someone else (2026-09-28)

**DECIDED: a fifth action on this port's `town-creature` (205), run from
the creature's HAIL special.** Exile III's talk start (`1020:1484`) swaps
two personalities with the plot: Seles (41) becomes 46 once the portal
plot starts, and Anaximander (20) becomes his weary self (19) once the
slime, the Filth Factory or the troglodyte war is reported. BoE has no way to
change who a creature is. `town-creature` action 4 with slot -2 has the
conversation the HAIL precedes held as personality `ex1c`, and job deliveries
go by it as E3's do. With `ex2b` set the name and opening words stay the
creature's own. That is Anaximander's case: E3 takes those from the
personality it was called with before swapping its copy, and 19 has no
name. The change lasts for the one conversation, since E3 decides it again
each time.

---

### 30. `poison_weapon`'s nimble-fingers test (2026-09-29)

**OPEN — for the user to rule on.** 1997 (`PARTY.CPP`, `poison_weapon`) and
Exile III (`10b0:30f4`) agree, and OBoE differs twice:

```c
/* 1997 and E3 */                          // OBoE, boe.party.cpp:442
r1 = get_ran(1,0,100);                     r1 = get_ran(1,1,100);
if (adven[pc].traits[3] == FALSE)          if(pc.traits[eTrait::NIMBLE])
    r1 -= 6;                                   r1 -= 6;
```

`traits[3]` is Nimble Fingers, so the original helps everyone *but* the
nimble — plainly inverted, and OBoE fixed it. The roll's range is dice only;
the trait is something a player could tell (a nimble PC botches more often).
1997 has the same inverted test in disarming a trap (`TOWNSPEC.CPP:152`) and
picking a lock (`TOWN.CPP:1126`). Exile III's own items follow E3, as #23
has it: its poisons pass `e3` to `poisonWeapon`, and `pick-lock` = `exile3`
already takes 8 off for the clumsy. Everything else follows OBoE
(`poisonWeapon.ts`, `trap.ts`, `doors.ts`). Following the original there
would move the corpus wherever a weapon is poisoned, a trap disarmed or a
lock picked, so it wants a flag, like `pick-lock`, if it is wanted.

*2026-09-29*: the "Fix known bugs" preference now covers Exile III's side
(E3-SUSPECTED-BUGS #12): with it on, E3's poisons and lock picking help the
nimble. BoE's side is unchanged; the open question is only whether a BoE
scenario should ever get 1997's inverted test.

### 31. A missile spent before its range is checked (2026-09-29)

**OPEN — for the user to rule on.** 1997's `fire_missile` (`COMBAT.C`) and
Exile III's (`1018:38ba`) take the ammunition's charge *first*, then test
the range and the line of sight, and an exploding arrow skips both tests:

```c
/* 1997 and E3 */                             // OBoE, boe.combat.cpp:1597
charges--; (take_item at 0)                   if(dist(...) > range) "Out of range."
if (exploding) { ...blast...; return; }       else if(can_see_light(...) >= 5) ...
if (dist(...) > range) "  Out of range."      else { if(exploding) ... else ...
else if (can_see(...) == 5) "Can't see"            ...; charges-- }
```

So in the original a shot out of range or out of sight loses an arrow, and an
exploding arrow can be aimed anywhere at all, through walls. OBoE spends only
on a shot that flies. A player could tell both. This port follows OBoE for
every scenario, Exile III included; E3's other missile rules (its hit bonus,
its blast) are E3's. Following the original would move no dice for a
refused shot, but it changes ammunition counts that later turns read, so it
would want a flag if it is wanted.

Two smaller things found beside it:
- **Fixed, a port bug**: the exploding branch returned before spending the
  arrow, so exploding arrows never ran out. OBoE's charge loop comes after
  both branches (boe.combat.cpp:1738), and 1997 spends up front, so both
  references spend it.
- E3 reads the ammunition slot again *after* spending, so the last exploding
  arrow of a stack (taken out, the pack shifted up) doesn't explode, and the
  shot goes on as an ordinary one with whatever moved into the slot. 1997
  saved `exploding` first. Not ported. The one E3 stack is four arrows, and
  that shot would need the whole ordinary path run on another item. Noted
  here in case it matters.

### 32. The targeting line's colour (2026-09-29)

**DECIDED: the original's white.** 1997's `draw_targeting_line` draws a 2px
`white_pen` (RGB 255,255,255). OBoE draws `{128,128,128}` with
`sf::BlendAdd`, which lands light over most terrain as well. This port drew
an opaque mid-grey, which matched neither. A player can see it, so the
original wins. `render/screen.ts` `drawTargetingLine`.

### 33. Exile III's creatures that won't talk (2026-09-29)

**DECIDED: Exile III's own rule, by the converter.** E3's talk handler
(`1010:26c0`) checks eight personalities after "Creature is hostile." and a
summoned creature's "No response.", and prints a line of its own for each
instead of opening a conversation: the townsperson (0), the guard (7), the
soldier (8), the creature (9), the apprentice (126), the undead (232), Gale's
incoherent people (342), and the Anama member (142), who nods to a party
holding special item 39 and moves on otherwise. The converter had passed
7–9 and the rest through as real personalities, so Fort Emergence's guards
opened talk block 0's placeholder slots ("n7", "l7"). Now the fixed seven are
BoE's small talk — a personality below -1000 names a scenario string, printed
as "Talk: …" after the same two checks, in E3's order — and the Anama is a
HAIL special that prints and blocks, falling through for a hostile one so
the hostile line still comes first. 342 also tests the town number (below
20), which holds everywhere it's used (Gale, 16–19). No engine change.
`tools/e3convert/towns/muteTalk.ts`.

### 34. Counting a field across a town (2026-09-30)

**DECIDED: an blades-of-exile-ts opcode, `if-field-count` (166).** Exile III's
Concealed Tunnel (town 54) keeps an invisible barrier across its door while a
barrel is left anywhere in the town (`1088:22b8` tests all 64×64 squares), so
the party has to push all five into pits or water. BoE's IF_FIELDS counts a
field over a rectangle, but OBoE's (boe.specials.cpp:3502) and so this port's
test the square `(i, j)` where `i` is the running count, not the column, so it
can't count anything off column 0 until something there counts; this port
keeps that, as scenarios may rely on it. `if-field-count` jumps to `ex1b` when
at least `ex2a` squares of the town carry field `ex1a`. Before it, the
converter read a flag that only the tunnel's far end (spot 14) set, and the
tunnel couldn't be crossed.

### 35. Walls that move (2026-09-30)

**DECIDED: a scenario flag, `moving-walls` = `exile3:<node>:<towns>`, with
Exile III's rules in the engine (`src/game/e3MovingWalls.ts`).** In Exile
III's Concealed Tunnel (town 54) and town 71 the adobe walls (terrain 132)
creep north and the basalt walls (117) south, a square a turn over floor
(150), turning around when they can't go on (`10c0:6aa2`, in the per-turn
town code). A crate, barrel, web, quickfire or barrier ahead stops one. A
wall that comes onto the party carries it along, and carried onto a square
that blocks, the party dies (`FUN_10c0_58b1`, E3's `push_things`, which has
the two walls in its direction table beside the belts); in a fight, the one
PC, with no saving throw. BoE has nothing like it: no node moves terrain
every turn, and a conveyor terrain can't be a wall. Under the flag the walls
move just before `push_things`, as E3's two calls come in that order, in
town and in combat; `node` is the crush message. OBoE ignores the flag and
the walls stand still, which leaves the tunnel's levers out of reach. The
port had no moving walls at all before this, so the tunnel couldn't be
crossed. E3's crush also follows a *belt* that carries the party into a
wall (the same routine), so under the flag the port's BoE belts crush too,
in any town: the Tower of Shifting Floors' are the ones it touches.

### 36. Flying, and the special items that fly (2026-09-30)

**DECIDED: a scenario flag, `special-items` = `exile3:<node>`, with Exile
III's rules in the engine (`src/game/e3Flight.ts`), and E3's fly-over list
as terrain data.** Exile III's special-item button (`FUN_10c0_1f96`) does
something for three items, and the golem plague can't be finished without
one: the Orb of Thralni (item 6) gives six turns of flight, which is the
only way into the Remote Aerie, the Drake Aerie and the Western Spire. The
port had no way to Use any E3 special item, and every E3 terrain had
`fly` false, so flight did nothing even when cast. Now:
- **What can be flown over** is BoE's own `fly_over`: the converter sets it
  on the terrains E3's outdoor move lets a flying party onto (`1010:7945`:
  cave wall, mountains, water, rocks, lava, pits). The high peaks (0x17)
  aren't among them.
- **The Orb** (outdoors, not in a boat or on a horse, not in zone columns 1
  and 2 of E3's top window row) and **the Amulet of Rapid Returning** (item
  7: from the surface, zone rows 2 and down, into Fort Emergence by its
  caves-side door; `node` sets the fort's side) are the engine's. BoE's
  `AFFECT_PARTY_STATUS` can't stand in for the orb: OBoE writes every
  status into Stealth (`specials/affect.ts`), and no node reads where the
  party is outdoors. The Wand of Unusual Results (item 8) is an ordinary
  node. The province maps (0–5, 9) show a picture in E3, which the port
  has no dialog for, and stay unusable.
- **Two refusals** while flying (`1010:7315`–`7442`), "Fly: Ceiling too
  low." near the caves' edges and "Fly: Not over the ocean!" past the
  surface's, written against E3's window corner; the engine's window slides
  on the same rule but stops elsewhere, so they are translated to the whole
  map's squares at those edges (the caves' top row still reads the corner).
- **Landing** (`1010:5be2`): water drowns, mountains and pits kill, lava
  burns (8d10 fire), anything else is safe. BoE kills on anything that
  blocks, and lava doesn't.
OBoE ignores the flag: the items can't be Used and nothing flies.

### 37. A special item that shows a town (2026-10-01)

**DECIDED: a scenario flag, `item-towns` = `exile3:<item>><town>,…`, read
by `e3ItemTownsTick` (`src/game/e3ItemUse.ts`) beside the uranium and herb
ticks.** Exile III's per-turn code (`FUN_10c0_61c4`, `10c0:69ff`) sets
`can_find_town[78]`, the Monastery of Madness, every turn the party holds
special item 16, the silver key Foxfire sells. No script and no talk node
does it, so the port had the key for sale and the monastery hidden for
good, and the Knowledge Brew recipe out of reach. BoE has no opcode for "while
this item is held"; a timer node would show the town once, which is the
same while nothing takes the key, but E3's is a rule of the turn, so it is
one here. The converter writes the one pair E3 has, `16>78`. Like E3, it
never hides the town again. OBoE ignores the flag.

### 38. Towns that drain spell points (2026-10-01)

**DECIDED: a scenario flag, `sp-drain` = `exile3:<towns>`, read by
`e3SpDrainTick` (`src/game/e3SpDrain.ts`) after the moving walls, at the end
of every turn and every combat round.** Exile III's per-turn code
(`FUN_10c0_61c4`, `10c0:7100`) drains the Tower of Zkal, towns 70 and 71:
in town or in a fight there, on a turn whose age is a multiple of 5, each of
the six PCs loses 5 spell points, or all that are left if 5 or fewer. The
tower's first message says so ("You feel the magical energy slowly leaking
out of your minds"), and both walkthroughs pack energy potions for it; the
port printed the warning and drained nothing. BoE has no node for "every
fifth turn, while here" (a town timer could fire the AFFECT_SP, but the rule
is E3's clock, `age % 5`, not the time since entry), so it is a rule of the
turn, as #35 and #37 are. The converter writes `70,71`. OBoE ignores the
flag.

### 39. The race-and-traits screen's experience figure (2026-10-01)

**DECIDED: 1997.** `pick_race_abil`'s "Experience needed to gain each
level" is `get_tnl` of the PC. 1997 edits the PC in place and its
`display_traits_graphics` (INFODLGS.CPP:718) recomputes the number on every
click, so a player sees what a trait costs before keeping it. OBoE edits a
copy and reads the PC's own number once, as the dialog opens, so the figure
never moves. A player can tell, and no draw depends on it, so the port
follows 1997 (`RaceAbilPick.tnl`, `src/dialogs/partyEditor.ts`).

### 40. Exile III's movies (2026-10-01; title and ending 2026-10-04)

Not a 1997/OBoE question — neither has the movies — but where the port's
showing of E3's three (`src/game/e3Movie.ts`) differs from E3's own:

- **Each plays once.** E3's `0e09` loops a movie until a click: the intro
  restarts at frame 518, the title movie at 240, the ending at 888. Here
  each plays to its loop and then gets out of the way.
- **The title movie comes between the opening pictures and the intro**, on
  a new game. E3 loops it behind its title screen, between the start-up
  pictures and New Game; the port has no title screen, so it stands where
  the title screen stood, centred like the intro (where E3 puts it is
  E3-CHECK-IN-ORIGINAL #28). A skip moves on to the intro.
- **After the ending, the victory dialog.** E3 leaves the game in town
  mode in the ending's town (66) at (4,13), every living PC's status at 7
  (`0e09`, `0fcb`–`1031`), a state BoE has no name for. The port ends the
  scenario as BoE does (`handle_victory`), with the party in memory.
- **The ending's PCs are the ones standing.** E3 draws only living PCs,
  and places only those (`DS:5446`); so does the port. A dead PC isn't
  welcomed to Blackcrag in either.
- **It comes after the party is made**, on entering the scenario: E3's New
  Game plays it first and builds the party after, but this port makes parties
  on the startup screen, before any scenario.
- **Their dice are their own** (a separate `GameRng`), not the game stream E3's
  `get_ran` draws on. A player can't tell; the replay corpus would.
- **Escape skips it as well as a click**, and on touch the overlay's Skip.
- **The opening pictures lead into it**: E3 shows the Spiderweb logo and
  the adventurers once, at launch, before the title screen, and can't skip
  them. Here they come right before the movie, on a new game, and each
  skip moves on one scene.
- One guess where E3's code doesn't say: animated terrain steps once a
  frame (E3's `anim_ticks` runs off a timer). The window background is not
  a guess any more: `0e09` calls `paint_pattern(0, 1, rect, 0)`, pattern 0,
  the grey stone (an earlier reading had the arguments the wrong way round
  and took it for an unset slot).

### 41. A monster's attack dice, read from a legacy word (2026-10-01)

**DECIDED for Exile III: 1997's; open for legacy `.exs`.** The old monster
record's attack is one word. 1997 (COMBAT.CPP:2283/2295, and the monster
dialog at INFODLGS.CPP:489) swings whenever it is positive and rolls
`a / 100 + 1` dice of `a % 100`; Exile III's `monster_attack` is the same
(`1018`, the decompile's `/ 100 + 1`). OBoE's `import_legacy`
(monster.cpp:39) takes `a / 100` dice, a die short, and **none at all
below 100** — and a creature with no dice never swings. 97 of E3's 183
attacking monsters had such an attack (its slimes' are 7 and 8), so they
never attacked, back-shots included. The E3 converter now writes 1997's
dice (`emit.ts`). The legacy `.exs` importer (`fileio/legacy/convert.ts`)
still follows OBoE: the library's old scenarios have the same short dice,
and changing that is a decision for them, not for Exile III.

### 42. Exile III's secret doors (2026-10-01)

**DECIDED: Exile III's**, by scenario flags. E3's three hidden doors (101,
118, 133) draw as plain wall. Its move code (`10c0:14df`) turns one into
the wall with its door showing (`+ 1`) and **lets the party through on the
same step**, where its closed doors (`:1517`) and OBoE's step-change refuse
the step the door opens on. So in E3 the door is never seen from outside.
`secret-doors` = `101,118,133` lets the party through, and a message spot on
the door now only says yes, ahead of the door, where it used to open it and
refuse (`specials.ts`). E3's search finds one too ("You find a secret
door!", `10c0:43d4`), under `search` = `exile3`.

### 43. "Search: You find something!" (2026-10-01)

**DECIDED for Exile III: the originals'**, under `search` = `exile3`. OBoE's
`adj_town_look` says it whenever a scripted square can't be stood on. 1997's
Windows ADJ_TOWN_LOOK has the line commented out (SPECIALS.CPP:985), and
Exile III's calls `get_blockage` and ignores the answer; its EXE has no such
string. So a pillar with nothing left to give said "You find something!"
in the port and nothing in E3. BoE scenarios keep OBoE's line.

### 44. The town's sound at the start of a new game (2026-10-01)

**DECIDED: Exile III's**, under `start-sound` = `none`: a new game of E3 starts
in Fort Emergence silently (the user checked), where `put_party_in_scen`
reaches `start_town_mode` and its entry sound in both 1997 and OBoE.

### 45. Where the dice start: the clock at launch (2026-10-01)

**DECIDED: the original's, with an addition.** A live game seeds once, as
the page loads, from the clock (`launchSeed`/`seedForLaunch`,
`src/core/rng.ts`), and `?seed=N` pins it. Loading a saved game doesn't
reseed.
- **Exile III** seeds its one generator once, at launch:
  `srand(GetCurrentTime())` (10e8:0190), milliseconds since Windows started,
  of which `srand` keeps 16 bits. A save holds no seed, so the same save
  rolls differently on every run. Its generator is Borland's `rand()`
  (`1000:0fad`: `seed = seed * 0x015a4e35 + 1`, the top 15 bits), which
  `get_ran` (`FUN_1048_004f`) calls once per die.
- **OBoE** seeds `game_rand` from `time(nullptr)` at startup and never seeds
  `unique_rand`.
- **This port** seeded neither until now, so every page load started both
  streams at mt19937's default seed (5489), and a play-tester who reloaded
  to retry a fight got the same fight. A player could tell, so this follows
  the original (the rule above). Both streams are seeded, the unique one from
  a value derived from the same seed, so `?seed=` pins everything.
- **Not matched, and not matchable**: the numbers themselves. The generator
  is mt19937 and the call order is OBoE's (#1 and the rule above), so a save
  loaded here and in Exile III rolls differently even at the same seed.
  Replays carry their own `<srand>` and are untouched: the corpus doesn't
  pass through `main.ts`.
- `?seed=` is a blades-of-exile-ts addition. The seed is printed to the console
  ("dice seed N") on every load, so a run worth repeating can be.

### 46. Exile III's trap question: Flee or Onward (2026-10-01)

**DECIDED for Exile III: its own words**, under `trap` = `exile3`. Every
one of E3's trap dialogs (0xbba, Krizsan's warehouse floor; 0xd7a, 0xdde,
0x107e and the rest) carries buttons 70 and 71, Flee and Onward, with Flee
first. The converter writes them as ONCE_TRAP nodes, and the engine's custom-
message arm asks with `basic_buttons` 3 and 2, No and Yes, in both 1997 and
OBoE. Under the flag it asks with slots 25 and 26, Flee and Onward: the
same two positions, so the same `btn1`/`btn2` and the same answers. BoE
scenarios keep No/Yes. A player could tell, and it costs no draws.

### 47. The autosave: a branching tree, not a ring of five (2026-10-02)

**DECIDED: redesigned**, not ported. Autosave is not in the 1997 original at
all; it is OBoE's (`try_auto_save`, `boe.fileio.cpp:520`), so no player of the
original can be surprised by it, and OBoE's version had real problems: it
refused to run until the player had made a manual save, it rotated through five
files named `<save>.auto/1..5` (so five moments, however long the game), and
every one of them was its own entry in the file picker.

What this port does instead (`platform/saveStore.ts`, `saveRetention.ts`,
`saveScheduler.ts`; PROGRESS.md "Save trees"). It was first called a save
*series*; it was renamed *tree* the same day, at the user's word:

- **One tree of snapshots per game.** The named moments are the same
  six (`EnterTown`, `ExitTown`, `RestComplete`, `TownWaitComplete`,
  `EndOutdoorCombat`, `Eat`, with the same `Autosave_<reason>` preferences and
  the same defaults, Eat off), now called *milestones*; on top of them a
  **tick** saves after every move, indoors and out (so leaving loses nothing;
  a move that changed nothing writes nothing). `Autosave_Every` was a
  preference for a day and is gone (2026-10-03). A game started from
  the main menu is saved as soon as it starts, which makes its tree, so "Make
  a manual save first" is gone; and going to the main menu saves the game
  rather than asking whether to throw away what is unsaved.
- **A capped pool of autosaves, not rotation** (2026-10-03, replacing a day of
  grid thinning and a 10 MB budget). Each tree keeps up to `maxAuto`
  autosaves (50 by default, set per game in the restore tree); past that, each
  new one evicts an old one at random, weighted `ln(1 + newer)`, so the newest
  never goes and the history thins with age. Milestones, the player's own
  saves, the root, a branch's first save (*branch save*) and every branch's
  last (*end save*) are never evicted and don't count toward the cap. The
  player can delete a milestone, a manual save or an autosave by hand, a
  branch from its first save, and the whole game from its root.
- **Restoring never deletes**: playing on from an older snapshot starts a branch.
- **No game is saved twice in a row** (2026-10-03). A save of the same game
  as the one just written — compared without the tar headers' write times —
  isn't added; if it is the better kind (milestone, then the player's own,
  then an autosave) the save already there takes its kind instead. A loaded
  game counts as the save it came from, so reloading or restoring adds nothing.
- **A reload resumes on the last move** (2026-10-03). The page can go before
  the last move's write lands, so on the way out that move is also parked in
  localStorage, gzipped on the main thread, and the next load of the game adds
  it to the tree. A game's card on the main menu opens the save played last by
  the clock, which after an unplayed restore is not the head.
- **`Autosave_Max` is gone** (nothing rotates), and so are `Autosave_Every` and
  `Autosave_BudgetMb`; stored values of them are ignored. So is the master
  switch, `Autosave` (2026-10-03): the game always saves itself, and a game
  opened by a direct `?scenario=` link no longer waits for a manual save first.

Nothing here touches a rule: saving rolls no dice, and the replay corpus is
unchanged. A player can tell the difference, which is the point.

### 48. `addGraphic` gives every picture its own cell (2026-10-03)

**DECIDED: fixed.** OBoE's `cUniverse::addGraphic` (universe.cpp:1173), which
`exportGraphics` uses to lay pictures onto the party's sheet, finds a free
run of cells and then marks `pos + 1 .. pos + n - 1` used — never `pos`
itself. Every one-cell picture (every item) therefore lands in the same first
free cell, each copy over the last, and all of a party's exported items wear
the last one's picture. Four-cell pictures (PCs, missiles) are only spared
because their other three cells are marked. `exportGraphics.ts` marks `pos`
too.

There is no 1997 behaviour to weigh it against — the original has no party
sheet — and no dice: it changes which cell a picture is copied to, nothing
else. Keeping it would make #7's carried pictures wrong for any party with two
custom items, which is every Exile III party. A save OBoE wrote with its
collapsed numbering still loads, wearing OBoE's pictures.

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
| `resurrection-balm` | scenario-declared | **yes** (2026-09-29, `spellTown.ts`: the caster must carry a balm and uses it up; checked before the charge) |
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
