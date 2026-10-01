# blades-of-exile-ts: TypeScript rewrite of the Blades of Exile game player (+ Exile 3 as a scenario)

> Two parts: **Part 1** — the BoE player rewrite. **Part 2** — converting Exile 3 into a scenario the new engine can play. Part 2 depends on Part 1's milestones but its converter work can proceed in parallel.

# Part 1: The BoE player

## Context

`../exile-wasm` is a working WASM port of Open Blades of Exile (CBoE): the full ~90k-line C++ game compiled with Emscripten, with SFML/Boost swapped for compat headers that issue Canvas 2D calls via `EM_ASM`. It works, but the architecture fights the browser (ASYNCIFY blocking dialogs, per-draw EM_ASM overhead, stubbed shaders/text metrics). The goal is a clean **from-scratch TypeScript rewrite of the game player** in this repo (`blades-of-exile-ts`), using exile-wasm as the reference implementation.

**Decisions made with user:**
- **Scope:** game player only — scenario editor (~19k loc) and character editor (~3k loc) out of scope.
- **Language:** TypeScript (strict).
- **Fidelity:** faithful port — same mechanics, classic 800×600 UI, original graphics/sounds.
- **Data:** engine reads **original scenario files in-browser** — v2 CBoE `.boes` format (gzip'd ustar tar of XML/.map/.spec). Legacy v1 `.exs` is a stretch goal.

**What's being ported (C++ reference):** ~54,500 loc of core logic — `src/game` (~35k; biggest: `boe.combat.cpp` 5,333, `boe.specials.cpp` 4,735 = ~200-opcode script interpreter, `boe.actions.cpp` 4,438), `src/universe` (~6k, runtime state), `src/scenario` (~9k, content model), top-level utilities (~4k). The `fileio`, `dialogxml`, `gfx/audio/platform` layers get reimplemented with web-native equivalents rather than translated.

## Toolchain & structure

**Vite + TypeScript (strict) + Vitest. No UI framework** — the game is one 800×600 canvas plus an HTML menu bar. `fflate`/`DecompressionStream` for gzip; hand-rolled ~60-line ustar reader; `DOMParser` in browser / `@xmldom/xmldom` in Vitest for one shared XML codepath.

```
blades-of-exile-ts/
  public/
    data/            ← copied from exile-wasm/data (PNG sheets, SND0-99.wav, TTFs, strings, dialogs, cursors)
    scenarios/       ← valleydy/stealth/zakhazi/busywork repacked as .boes (build script)
    bases/           ← pregen party files from rsrc/bases
  src/
    core/            ← rng.ts (mt19937, verbatim port of src/mathutil.cpp get_ran incl. game/unique dual streams),
                       location.ts, dice.ts
    data/            ← cScenario/cTown/cOutdoors/cItem/cTerrain/cMonster/cShop/cSpeech/cSpecial as pure data classes;
                       enums/ ported VERBATIM with same numeric values (race, skills, fields, damage, spells,
                       eSpecType from src/scenario/special.hpp:32-76)
    fileio/          ← tarball.ts, mapParse.ts (ref: src/fileio/map_parse.cpp — CSV grid + & * ! : annotations),
                       specialParse.ts (ref: special_parse.cpp — "@node = N" DSL), per-file XML readers
                       (ref: fileio_scen.cpp + XSDs in rsrc/schemas/), tagfile.ts + saveIo.ts (.exg saves,
                       ref: tagfile.cpp / fileio_party.cpp), resources.ts
    universe/        ← living.ts (iLiving abstract base — keep this polymorphism seam), player.ts, party.ts
                       (incl. SDF flag store), curTown.ts, curOut.ts, universe.ts (= the GameState)
    game/            ← modes.ts (eGameMode enum kept flat/verbatim from boe.consts.hpp:16), loop.ts,
                       actions.ts, town.ts, combat.ts, monsterAi.ts, partyOps.ts, items.ts, magic.ts,
                       talk.ts, shop.ts,
                       specials/ (vm.ts + 7 handler files mirroring boe.specials.cpp's category grouping)
    render/          ← layout.ts (win_to_rects from boe.ui.cpp:33), sheets.ts (28×36 tiles, 10/row, 100/sheet,
                       sheet=pic/100 — from gfxsheets.cpp), terrainView.ts, panels, transcript, buttons
    dialogs/         ← dialogxml reimplementation: parse same ~210 XML defs, canvas-drawn widgets,
                       async runner (runDialog(): Promise<Result>) — implement widgets lazily per milestone
    platform/        ← input.ts, sound.ts, menu.ts, saveStore.ts — lift/port existing web/events.js,
                       savemanager.js (IndexedDB), menu.js, filedialog.js (~1,900 loc of proven JS)
  test/
    fixtures/        ← copied from exile-wasm/test/files (per-format good/bad XML cases)
    replays/         ← curated subset of exile-wasm/test/replays
```

## Key architecture decisions

1. **One `Universe` + `GameSession` object instead of C++ globals.** RNG instance lives on the session and is injected — enables deterministic tests and replay verification. Keep the `game_rand`/`unique_rand` dual-stream split exactly (replays only seed the game stream).
2. **Keep the flat `eGameMode` state machine verbatim** (all 21 modes). "Improving" it into a hierarchy would turn every mode-comparison in the 4,400-line actions port into a translation hazard.
3. **Async replaces ASYNCIFY.** Any C++ chain that blocks on a dialog becomes `async`: `runDialog()` returns a Promise; the specials VM is an async interpreter that awaits message/choice dialogs mid-script. A `dialogStack` gate in the input router suppresses game input while a dialog is up — same observable behavior as C++ modality, no blocking. rAF drives animation/redraw; game logic advances on input events.
4. **Preserve the `iLiving` seam** (abstract class → Player/Creature/Party). All damage/status code targets it; this keeps `boe.combat.cpp` portable nearly line-by-line.
5. **Specials VM:** `SpecialNode` stays the raw 15-short record; interpreter = `Map<eSpecType, OpHandler>` with handlers grouped in files mirroring the C++ sections so each diff-reviews against a slice of `boe.specials.cpp`. Port the shared prelude/postlude (message pooling, once-flags, SDF pointer indirection, jump semantics) first and verbatim — it's the highest-fidelity-risk logic.
6. **Preserve `get_ran` call order when porting combat** — treat the RNG call sequence as part of the spec, so replays can match.

## Milestones (each demo-able)

- **M0 — Skeleton.** Vite+Vitest+CI; port `core/` (mt19937 tests against known vectors); copy assets; draw a grid of terrain tiles using the gfxsheets math. *Demo: tiles on canvas.*
- **M1 — Scenario loads, outdoor walkabout.** gzip+tar reader; scenario/terrain/items/monsters/outdoor XML + .map parsers; .spec parse (no execution). Parser tests vs `test/files` fixtures + full loads of all four bundled scenarios. Terrain view renders; hardcoded party walks the 96×96 outdoors with terrain blockage. *Demo: walk around Valley of Dying Things outdoors.*
- **M2 — Towns + full 800×600 shell.** Town/talk parsing, town enter/exit, doors; full UI chrome (stats, inventory, transcript, action buttons); sound; load a pregen party from `rsrc/bases` via the tagfile reader (early slice of save format). Build the **replay driver** here (feeds `test/replays` action streams into `handleEvent`).
- **M3 — Dialog toolkit + talk + shops.** dialogxml parser + core widgets, async runner; talking and shopping modes. *Demo: buy a sword, talk to townsfolk.*
- **M4 — Specials interpreter, breadth-first.** VM core + general/one-shot/if-then/town opcode groups; step-on/entry/use triggers. *Demo: valleydy's signs, plot gates, item grants work.*
- **M5 — Combat** (biggest; split M5a melee → M5b missiles+AI → M5c spells+patterns+fields). Headless seeded-RNG logic tests. *Demo: clear the first valleydy dungeon.*
- **M6 — Specials depth + party ops.** Remaining opcode groups, resting, alchemy, traps, boats/horses, timers, end-scenario. *Demo: valleydy completable start to finish.*
- **M7 — Save/load + startup flow.** Full `.exg` round-trip (load→save→load deep-equal), IndexedDB store + import/export, scenario picker. *Demo: quit mid-dungeon, reload, continue.*
- **M8 — Fidelity hardening.** Replay golden masters vs C++ build, play through the other three scenarios, cursors/menus/perf polish. Stretch: legacy `.exs` importer.

Effort weighting: M5 ≈ 30%, M4+M6 ≈ 30%, M1–M3 ≈ 30%, rest ≈ 10%.

## Testing & verification

- **Reuse C++ fixtures:** `exile-wasm/test/files/` (per-format good/`bad_*` XML) → parser tests; the four unpacked scenarios in `rsrc/scenarios/` as integration fixtures.
- **Replay golden masters (verified to exist):** `exile-wasm/test/replays/{short,long,parties,scenarios}` record `<srand>` seeds + semantic actions (`<move>`, `<click_control>`, incl. `AllMageSpells.xml`, `OneOfEverything.xml`). Verification tiers: replay runs without desync → end-state snapshot (party stats, SDF array, position) matches C++ build → transcript text matches. Curate the usable subset.
- **Combat formula tables:** one-time instrumented C++ run capturing to-hit/damage values, committed as JSON, table-driven TS tests.
- **End-to-end per milestone:** `npm run dev`, load valleydy, exercise the milestone's demo scenario in-browser; a few Playwright smoke tests at M8.

## Risks

| Risk | Mitigation |
|---|---|
| Specials semantic drift (~200 opcodes, once-flags, SDF pointers, message pooling) | Verbatim enum/field port first; per-section handler files; replay golden masters; per-opcode-group script fixtures |
| Combat formula fidelity / RNG call order | Verbatim mt19937; preserve get_ran call sequence; captured-value tables; spell replays |
| dialogxml scope creep (210 defs) | Player uses ~60–80 defs; implement widgets lazily; coverage script to size work |
| Async re-entrancy (input mid-special) | Single dialogStack gate; assert one special chain at a time |
| Monster AI subtleties | Seeded scenario-in-a-box tests; accept behavioral (not bit-exact) fidelity if replays desync, document deviations |

## Critical reference files (in ../exile-wasm)

- `src/game/boe.specials.cpp` — specials VM semantics (highest-risk port)
- `src/game/boe.combat.cpp` + `src/game/boe.monster.cpp` — combat formulas, turn flow, AI
- `src/universe/universe.hpp:185` — GameState shape; `src/universe/living.hpp:36` — iLiving seam
- `src/game/boe.consts.hpp` — mode enum, UI geometry enums; `src/game/boe.ui.cpp:33` — layout rects
- `src/gfx/gfxsheets.cpp` — tile indexing math
- `rsrc/schemas/readme.md` + `*.xsd` — .boes format spec; `src/fileio/map_parse.cpp`, `special_parse.cpp`, `tagfile.cpp` — non-XML format ground truth
- `src/mathutil.cpp:15` — get_ran RNG (mt19937 dual-stream)
- `web/events.js`, `web/savemanager.js`, `web/menu.js`, `web/filedialog.js` — liftable browser-layer code
- `test/files/`, `test/replays/`, `src/tools/replay.cpp` — test fixtures and replay format

# Part 1b: The scenario library (before Part 2)

## Context

Part 1 plays the four bundled scenarios. The goal here is to play the
**community scenarios**, served from a cloud bucket to anyone who opens the
page. The source is Spiderweb's archive,
https://www.spiderwebsoftware.com/blades/scen_list.html (surveyed 2026-09-23):
about 158 scenarios across three tables (`scen_stuff/solid.html`,
`untried.html`, `first_efforts.html`). Every download sits in one flat
directory, `http://www.spiderwebsoftware.com/ftp/user_scen/`, and almost all are
`.zip` files (one is `.sit`). Each zip holds the scenario as a **legacy `.exs`**
and, when it has custom graphics, `<name>.bmp` (Windows) and `<name>.meg` (Mac
resource fork). Each table row lists category, size, difficulty, content
rating (G/PG/R), description, review score and author. There is no level
range, platform or date. The pages say nothing about redistribution, so
**hosting needs author credit and a way for authors to ask for removal**.
Another archive, "Alexandria" (http://www.personal.psu.edu/bxb11/boe/alexandria/),
is linked as "nearly all Blades scenarios"; it has not been looked at yet.

**Decisions made with user:** storage is a **GCP bucket**. The scenario editor
port, and letting people upload their own scenarios to the bucket, come
**after Part 2**, because Exile 3 may need editor features the original lacks.
When uploads do come, **the bucket must never be publicly writable**: uploads go
through signed, size-limited, content-checked requests, and nothing uploaded is
ever executed. The rule is "no chia mining on the bucket".

## Steps

1. **Packed `.boes` loading — done 2026-09-23.** `fileio/packedSource.ts`
   reads a package from memory, `platform/scenarioStore.ts` keeps installed
   packages in IndexedDB, and the startup screen has "Add a scenario…".
   `scripts/pack-boes.mjs` packs an unpacked tree.
2. **Headless smoke harness — done 2026-09-23** (`test/archiveSmoke.test.ts`,
   `LEGACY_ARCHIVE=1`). Every archive scenario loads, starts a new game, takes
   a few steps and enters every town. It's shallow: specials that need a host
   (dialogs) don't run headless.
3. **Legacy `.exs` importer — done 2026-09-23** (`src/fileio/legacy/`, shared
   by the browser and Node). It matches the C++ field for field on all 171
   legacy files (`test/legacyImport.test.ts`; see DIVERGENCES.md). Port `oldstructs.hpp`, `porting.cpp` (byte order: Mac files are flag
   bytes 10/20/30/40 and big-endian, Windows files are 20/40/60/80 and
   little-endian) and the `import_legacy` family. **The oracle is already on
   disk**: `../boe-source-1997/*/` has VALLEYDY/STEALTH/ZAKHAZI.EXS in *both*
   byte orders, and `public/scenarios/` has OBoE's conversion of the same three.
   Import and deep-compare. Also audit OBoE's `is_legacy` switches in the
   engine (about 16 sites).
4. **Custom graphics — `.bmp` done 2026-09-23.** Windows `.bmp`, with white made transparent
   (`load_spec_graphics_v1`), converted into the sheet layout. Mac `.meg` (a
   PICT inside a resource fork) only if the archive shows scenarios that
   ship no `.bmp`.
5. **Publish pipeline and catalog — built 2026-09-23, not yet published** (needs
   the user's GCP login; see PROGRESS.md). An offline Node tool: zip → `.exs` →
   `.boes`, smoke-tested, then uploaded to the bucket with a `catalog.json`
   (id, title, author, blurb, category, difficulty, content rating, size,
   credit/source URL). The bucket is public-read with CORS for the site's
   origin, and write access is only for the publishing credentials. The
   startup screen lists the catalog and downloads a scenario into the step 1
   store on demand.

# Queued: Rewind (after the TODO inventory is cleared)

**Decided with the user 2026-09-28**: build it, but only once every `TODO(`
in `src/` and `tools/` is done. Not in either original.

- **What it is.** A history of the game, taken every turn, that the player can
  step back through: File → Rewind… shows a timeline (thumbnail, day, place)
  and a key steps back one turn. It replaces the need to "make a manual save
  first" — history starts with the game. Named saves stay as they are.
- **Taken where the resume record is** (`keepResume` in `main.ts`, 2026-09-28):
  only where a save could be made (not mid-action, under a dialog, or in
  combat), so the same rules hold.
- **Storage by content.** A save is a tarball of many small files and most of
  them don't change between turns, so each distinct file is stored once
  (keyed by hash) and a snapshot is a list of hashes. 1,000 turns should then
  cost little more than a few full saves. Measure a save's size and the
  per-turn delta before settling the numbers.
- **Thinning with age:** every turn for the last ~200, then one per 10 turns,
  then one per game day, with files no snapshot uses dropped.
- **Open:** whether it replaces BoE's five-slot autosave (`doAutoSave`) or
  sits beside it — ask the user when this starts.

# Part 2: Playing Exile 3 in blades-of-exile-ts

## Context

`../exile3-mapping` contains the full Exile 3 Windows install (`Exile3/`: EXILE3.EXE, TOWN.DAT 709,200 B, OUTDOOR.DAT 289,800 B, ~30 BMP sheets, MAIDWORD.TTF, strings.txt 1.5 MB) plus the user's own reverse-engineering: `outdoor-to-json.js` already parses OUTDOOR.DAT as **90 zones × 3,220 bytes, each starting with a 48×48 terrain byte-map**, and `display.js` contains a hand-built partial mapping from E3 terrain IDs to BoE-era sprite indices (28×36 tiles — same tile geometry as BoE).

**Decisions made with user:** convert E3 into a **standard `.boes` scenario package** via an offline Node converter (engine stays single-format; extension hooks only where E3 mechanics exceed BoE). Fidelity is **phased, world-first**: walkable world → towns/dialogue/shops → quest logic incrementally.

**Feasibility findings:**
- BoE *is* the generalized Exile 3 engine, so E3's .DAT formats are close cousins of the legacy structs in `exile-wasm/src/oldstructs.hpp`. The BoE legacy `outdoor_record_type` computes to ~4,146 B vs E3's 3,220 B zone — same 2,304 B terrain grid, but **no `special_node_type specials[60]` array (1,320 B)**: E3's special-encounter logic is hardcoded in EXILE3.EXE, not data. The remaining ~916 B/zone (special locs/ids, town-entry locs, sign locs, wandering groups, info rects) needs layout pinning against the oldstructs field order.
- TOWN.DAT divides cleanly at several candidate record sizes (e.g. 4,728 × 150, 3,546 × 200); layout unknown — compare against `town_record_type`/`ave_tr_type`/`talking_record_type` (BoE talking *is* legacy data-driven, so E3 town dialogue is likely in TOWN.DAT or strings resources, i.e. mechanically extractable).
- `strings.txt` is just `strings(1)` output of EXILE3.EXE. The text proper is in the EXE's NE resources: `RT_STRING` for short text and one `RT_DIALOG` per encounter for prose (2026-09-23; see `tools/e3convert/FORMATS.md`).
- EXILE3.EXE is a **16-bit NE** binary. A 2026-09-23 test showed that Ghidra still decompiles its encounter handlers into readable C, so E3-3's "transcribe from decompilation" approach stands.
- Graphics: E3 BMPs (TER1-5, MONST1-9, OBJECTS, PCS, FIELDS, MIXED, TERANIM…) are the direct ancestors of BoE's PNG sheets — converter must handle palette + transparency masking and re-index tiles into BoE's sheet=pic/100 scheme. `display.js`'s mapping table is the seed.
- BoE's scenario format was explicitly designed to express E3 (`town_chop_time` = E3's day-based town destruction is in the legacy struct), so most E3 mechanics should map without engine changes.

## Approach

New directory `blades-of-exile-ts/tools/e3convert/` — a Node/TS converter (runs in Vitest too) that reads the E3 install dir and emits an unpacked v2 scenario tree (`scenario.xml`, `terrain.xml`, `items.xml`, `monsters.xml`, `towns/*`, `out/outX~Y.*`, `graphics/sheetX.png`) which the Part 1 engine loads like any other scenario. E3's files come from Spiderweb's original freeware installer, committed unaltered in `vendor/exile3/` as its licence allows (decided 2026-09-25; README.md, "Licence"); the converter unpacks it and converts at build time, and only the converted, modified output stays uncommitted.

## Phases (keyed to Part 1 milestones)

- **E3-0 — Format groundwork** (parallel with M0–M1). Port `outdoor-to-json.js` into `tools/e3convert`; pin down the remaining 916 B of the outdoor record and the TOWN.DAT record layout by field-order diffing against `oldstructs.hpp` (and, if needed, Ghidra on EXILE3.EXE / EXILE3ED.EXE — user owns the game; RE for interoperability). Build the strings extractor. Deliverable: documented format notes (`tools/e3convert/FORMATS.md`) + parsers with tests.
- **E3-1 — Walkable overworld** (needs M1). Formalize the `display.js` terrain-ID mapping into a data table; BMP→PNG sheet converter with masking; emit `terrain.xml` + 9×10 outdoor sectors as `.map` files. *Demo: walk the Exile 3 overworld in blades-of-exile-ts.*
- **E3-2 — Towns, NPCs, shops, dialogue** (needs M2–M3). Convert town records, monster/item definitions (names from strings extractor), preset creatures/items, talking nodes, shops. *Demo: enter Krizsan, talk to NPCs, buy gear.*
- **E3-3 — Quest logic, incrementally** (needs M4+). Hand-author special nodes in `.spec` format, town by town, guided by Ghidra decompilation of the special-encounter functions in EXILE3.EXE, EXILE3.HLP, and published walkthroughs. Add engine extension hooks only if a mechanic provably can't be expressed in BoE nodes (candidate: the day-driven monster-plague progression — verify `town_chop_time` + timer specials cover it first). Long-tail effort; track per-town coverage in a checklist.

## Risks (Part 2)

| Risk | Mitigation |
|---|---|
| TOWN.DAT layout unknown | Field-order diff vs oldstructs; the shipped E3 editor (EXILE3ED.EXE) and Ghidra as ground truth; validate by rendering known towns |
| Quest-logic scale (hardcoded in EXE, ~100+ towns) | Explicitly phased/world-first per user decision; .spec authoring is data-only, shippable town-by-town |
| Terrain/graphics mapping gaps | display.js seed table + visual diff pages (render every E3 tile next to its mapped sprite) |
| Licensing | The unaltered installer is committed (its licence allows free, unaltered redistribution); the converted scenario is generated at build time, never committed |
