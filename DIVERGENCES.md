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

**DECIDED: the original wherever the two differ.** The party can visibly tell
every difference, and several of OBoE's choices depend on `exportGraphics`
and `exportSummons`, which this port doesn't have yet (`TODO(campaign)`).
Each point below was checked in both sources: `put_party_in_scen` and
`init_party_scen_data` (PARTY.CPP:320, :440), and `put_party_in_scen`
(boe.party.cpp:119) and `cUniverse::enter_scenario` (universe.cpp:1384).
The code is in `Universe.enterScenario` and `GameSession.enterWithParty`.

| | 1997 | OBoE | here |
|---|---|---|---|
| Items taken away | a custom picture (`graphic_num >= 150`, 1000+ here), summoning | call-special abilities, IMPORTANT slayers and wards | **both lists**: OBoE's abilities don't exist in 1997, so the two lists don't conflict |
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

**OPEN: not decided, and not changed.** Found while converting Exile 3,
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

- **Exile 3 does not depend on it yet.** The converter (`e3DayReached`,
  `tools/e3convert/flags.ts`) puts the +20 into the data and drops the event
  key, which is exactly E3's behaviour until E3-3's scripts set events. That
  is marked `TODO(E3-3)`.
- **Legacy BoE scenarios (Part 1b) do depend on it.** A 1997-era scenario
  that uses events gets OBoE's answer. The Windows +20 is another question:
  it depends on which build the scenario was balanced for.
- **Related:** the travelling-NPC rota (time flags 4–6) turns every 1,000
  ticks of age in 1997 (`party.age / 1000 % 3`) and E3. OBoE turns it by the
  day.

---

### 10. The events journal (2026-09-27)

**DECIDED: OBoE's journal, E3's paging, and an exile-js opcode to fill it.**
The 1997 original keeps `journal_str` in the party record and clears it, but
has no dialog that shows it and nothing that adds to it. OBoE ports the rest
(`journal()`, `add_to_journal`, `event-journal.xml`, `<journal>` strings,
`JOURNAL` save pages), but no special node reaches `add_to_journal`, so its
journal is always empty. Exile III's journal is the one that works
(`FUN_1008_3780` adds, `FUN_1008_3507` shows), and E3 adds entries from 33
places in its scripts.

- **The opcode is an exile-js one**: `journal` (48, `SpecType.ADD_JOURNAL`),
  in the gap after `STR_BUF_TO_SIGN` and inside GENERAL's range. `ex1a` is
  the `<journal>` string. OBoE would read a scenario using it as having an
  unknown opcode, which is the same as for every other exile-js extension.
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

**DECIDED: an exile-js opcode, `if-town-visible` (161,
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

**DECIDED: an exile-js opcode, `if-entry-dir` (162, `SpecType.IF_ENTRY_DIR`),
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
an exile-js feature flag, `town-thrash` = `1997` (`featureFlags.ts`). The live
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
an exile-js feature flag, `sleep-save` = `1997`, as in §14. The roll in
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
exile-js feature flag, `bash-door` = `1997`, as in §14 and §17. 1997's
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
