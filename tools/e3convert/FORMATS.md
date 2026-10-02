# Exile 3 file formats

These are working notes for E3-0. Anything not marked **confirmed** is still a
hypothesis. The game files are user-supplied and are never committed.

## EXILE3.EXE — 16-bit Windows (NE), Borland C++ 4.5 — confirmed

- The file is **NE, not PE**: a Windows 3.1 executable with 48 segments. The
  runtime is `BC450RTL.DLL`. Ghidra loads it as `x86:LE:16:Protected Mode`.
- `strings.txt` in the install is just `strings(1)` run over the EXE. It has
  no structure of its own. Read the resources instead.
- The resource table is at `ne + *(u16*)(ne+0x24)`. It starts with an
  alignment shift, followed by `{u16 type, u16 count, u32 0}` blocks, each with
  `count × {u16 off, u16 len, u16 flags, u16 id, u32 0}`. An offset or length
  is `value << shift`. An id with `0x8000` set is numeric.

| type | count | what |
|---|---|---|
| 6 (`RT_STRING`) | 1,365 blocks | **12,472 strings**, ids 301–47,697. Block `b` holds ids `(b-1)*16 … +15`, each a 1-byte length followed by Latin-1 text (≤ 255 chars). Ids come in runs of 300 (`n*300 + k`), which is the Mac `STR#` numbering carried over, as in BoE. |
| 5 (`RT_DIALOG`) | 624 | **Every long encounter text is a dialog.** A control's text is either prose or a BoE-style `kind_num` tag: `1_65`/`0_64` are buttons, and `5_422` is a picture. Example: the Vilovsky temple is dialog **5051**. |
| 100 | 100 | Sound effects, stored as RIFF WAVE files (8-bit mono, 22,050 Hz). |
| 1, 3, 4, 12, 14 | – | cursors, icons, menu and cursor groups |

## Quest logic lives in code — confirmed readable (2026-09-23)

Every encounter is a hardcoded branch in the EXE, and **Ghidra's decompiler
output is good enough to transcribe from.** The test case was the Vilovsky
encounter. There is exactly one `push 5051` in the code, at file offset
`0xdc18e`, which is `10a0:078e` in Ghidra. It sits in `FUN_10a0_0062`, the
**outdoor special-encounter handler**:

- `FUN_10a0_0062(?, int which_special, int encounter, int ...)`. The code
  indexes the loaded zones as `zx*0x1928 + zy*0xc94` (0xc94 = **3,220**, the
  zone size; the 2×2 loaded-zone grid is BoE's `outdoors[2][2]`), then reads
  `+ which_special*2 - 0x470e`, which is `special_locs[which]` (a packed
  location). The encounter number comes from `special_id[which]`, and the
  handler `switch`es on it. Once an encounter runs it zeroes
  `special_id[which]` (at `-0x46ea`).
- Encounter numbers 100–199 and ≥ 200 are generic kinds that are driven by
  flags (`encounter-100`, `encounter-200`). The range 50–59 returns
  immediately. The rest are unique scripts. **50 is not only a marker**: both
  move codes read the spot number back out of `FUN_10c0_0c97` and force the
  step when it is 50 (outdoors `1010:71aa`, in town `1010:807c`, tested
  against blockage at `1010:83a3`), BoE 1997's `spec_num == 50`. That is how
  the fords are crossed (2026-09-30).
- The Vilovsky branch reads almost like source: `fancy_choice(5050)`, then
  flag checks, `fancy_choice(5051)`, `take_gold(5000,1)`, then set flags, play
  sounds 0x97 and 0x9d, and raise a skill of each of the 6 PCs. The PC record
  stride is **0x722 = 1,826 bytes**.
- Auto-analysis found only 643 functions and missed this one. Expect to create
  functions by hand. `ghidra/DecompAll.java` does it for every prologue.

## Tables in the EXE — pinned (`tables.ts`)

E3 keeps its terrain types in code and data, not in a file:

- **Pictures**: `terrain_pic[256]` int16 at `1100:00a0` (segment 33).
  0–239 are TER1–TER5, 50 to a sheet. 300–314 are animations in TERANIM,
  where animation `k` is row `k%5` with its 4 frames in columns
  `4*floor(k/5)…`, BoE's teranim layout.
- **Blockage**: `u8[256]` at `DS:1c7e`. `FUN_1080_14f9` blocks movement at
  ≥ 3; the scale is BoE's `eTerObstruct`.
- **Names**: string `301 + id`. Monster names start at 601.
- **Boats**: a list in the move code, not a table. A boat can enter 22, 24–35,
  50–64, 71, 74, 75 and 86.
- **Doors**: two jump tables. Moving into a terrain (`FUN_10c0_0c97`, cases at
  `10c0:186a`) does the following for each wall style
  (base 101 stone, 118 basalt, 133 adobe):
  - `base` is a secret door drawn as wall. Bumping it becomes `base+1`, a
    passable wall with the door showing, and plays sound 58.
  - `base+2` is a closed door, and becomes `base+6` (open).
  - `base+3`…`base+5` are locked and ask "This door is locked. What do you
    do?" (dialog 993).
  - Picking (`FUN_10d8_3f67`, cases at `10d8:4182`) works only on `base+3`,
    succeeding when the roll is over 35, and adds 3.
  - Terrains 7, 10, 13 and 16 (blockage 1) are walk-through cave walls.
  - The table is reached only after the square's spots have run and said
    yes (`10c0:124d`), so a message spot on a secret door still lets it
    open (`specials.ts`, `DOOR_OPENS`).
- **New game**: `FUN_1010_6b20` calls `start_town_mode(21, 9)`, which puts the
  party in Fort Emergence at the location held in `DS:05f0`, i.e. (59, 6).
  `start_town_mode` is `FUN_10d8_0107`. A direction below 9 means
  `start_locs[dir]`.
- **Talk text**: RT_STRING, with fields separated by `^` (e.g. `…^0^0^99`).
  See `talk.ts`: the node types are the jump table at `1020:2e16`, and the
  arms are in `ghidra/project/talkarms.s`.
- **Shops** (`shops.ts`): the item list is int16s at `1100:02a0`; food is 15
  in-memory item records (63 bytes: the file record with its names at +23 and
  +48) at `1100:1652`; mage/priest/alchemy lists are in the data segment at
  `0x2049`/`0x2070` (spell, cost), `0x21e2`/`0x2194`, and `0x22e6`.
- **Party record** (segment `1158:`, 0x8525 bytes): every field is in
  "exile3.sav" below.
- **Live creature** (`0x5c` bytes a creature, from `0x1427`): active `+0`,
  attitude `+2`, number `+4`, time flag `+0x53`, `extra1` `+0x54`,
  `extra2` `+0x55`, `spec1` `+0x56`, `spec2` `+0x57`.

- **Monsters** (1–190; string `600 + n` is the name, 0 is empty): segment 39
  (`1130:`) holds 28 parallel arrays of 200, which `FUN_1090_0000`
  (`return_monster_template`) gathers into a record. Byte arrays unless
  marked i16:

  | offset | field | offset | field |
  |---|---|---|---|
  | 0 | level | 3000 | mage level |
  | 200 | hp (i16) | 3200 | priest level |
  | 600 | armor | 3400 | breath: kind × 10 + dice row |
  | 800 | skill | 3600 | poison |
  | 1000/1400/1800 | attacks (i16, `(dice-1)*100 + sides`, 1997's) | 3800 | treasure |
  | 2200 / 2400 | a1 / a2–3 attack type | 4000 | special skill |
  | 2600 | race (`m_type`) | 4200 | picture: sprite index, 0 blank |
  | 2800 | speed | 4400 / 4600 | width / height |
  | 4800–5400 | magic/fire/cold/poison resistance: 0, 1 resistant, 2 immune |

  These were checked against BoE's `bladbase` (the 1997 Mac `.exs`), whose
  monsters 1–176 **are** E3's: the same names, levels and HP, with two
  renamed. Every field above agrees on all 176, except that BoE rebalanced the
  attack dice (an earlier note read E3's guard as 2d10 by OBoE's
  `a / 100`; E3 rolls `a / 100 + 1`, so 3d10), changed 5 breaths and 3
  special skills, and renumbered pictures for its own sheets.
  **The breath byte** is two numbers (`monst_breathe`, `1018:78ca`): the
  tens are the kind (0 fire, 1 cold, 2 magic — "acid" in the monster
  dialog), and the units a row of the ten words at `DS:0878`
  (0 1 2 3 4 5 7 10 17 23), plus 2, d8. E3 breathes at 7 squares, not 8.
  bladbase kept the byte as the dice and gave the kind a field of its own.
  **Not in E3's record**, and where E3 answers instead (2026-09-28):
  radiation and loot, nowhere (no monster has either); attitude,
  `place_monster` (`1090:3d56`): hostile A, but troglodytes 149–154 hostile
  B; summon class, none — the spells draw from lists, combat's at
  `DS:0770`/`0775`/`0789`/`0799` (5, 20, 16, 16 bytes: Summon Beast, then
  classes 1–3) and out-of-combat's at `DS:3072`/`3077`/`308b`/`309b`;
  talking face, the words of **segment 40** (`1138:0000`) by monster, 1-based
  into TALKPORT.BMP and 0 for the sprite, overridden for 28 personalities by
  the (personality, face) pairs at `DS:2364` (`1098:984e`). 177–190 are E3's
  own unique characters (Rentar-Ihrno, Athron, Sulfras, Erika …).
  **Sprites**: MONST1–9 use BoE's layout. There are 20 sprites a sheet in
  column pairs (idx < 10 in columns 0/1, else 2/3), with the attack pose 4
  columns further along. Column 1 faces left, the default.
- **Items** (415 records): segment 38 (`1128:`), 59 bytes each,
  little-endian: `i16 variety, i16 level, awkward, bonus, i8 protection,
  charges, skill/use, graphic, ability, type_flag, 0, i16 value, known, magic,
  weight, class, full_name[25], name[15]`. `variety` is BoE's `eItemType`.
  367 have a namesake in bladbase (reordered), which agrees on
  variety/level/awkward/bonus/protection/charges/type_flag/value/weight for
  about 97%. **Ability codes are E3's own**: 94 of 103 map to one BoE legacy
  code, and the other 9 are items BoE retuned. The graphic is an E3 picture
  number (only 134 agree with BoE), not yet mapped to a sheet.

  **In memory** an item is 63 bytes, built by `1068:0886`: +0–15 as the
  table, +16 = 0, +17 magic (table +16), +18 = 0, **+19 (0x13) weight**
  (table +17), +20 class, +21 a word from `DS:0x194e`, `full_name` at +23,
  `name` at +48. A PC's items start at `pc*0x722 − 0x7a5c` in the party
  segment, and the 24 equip bytes follow them.

Ghidra can't recover these `switch` statements: it reports "Could not recover
jumptable". The table is `n` case values followed by `n` target offsets, and
`Disasm.java <addr> <out> <count>` lists the arms.

## exile3.sav: the saved game — pinned 2026-09-30 (`src/fileio/e3save.ts`)

Read from the code, then **checked against seven saves from the original**
(2026-10-01, the user's `~/Desktop/Saves`, not committed): each writes back
byte for byte, and imports and exports again with its party, PCs and flags
unchanged. `E3_SAV=<file or directory> npx vitest run test/e3save.test.ts`
reruns that. What the saves showed:

- **A file can run on past its save.** `save_file` `_lopen`s an existing
  file and never truncates it, so an outdoor save over an in-town one keeps
  its last 24,091 bytes. All seven are 210,745 bytes, the in-town size with
  maps; the reader keeps the tail as `trailing`.
- **A new game's record has no vehicles**: every slot is town 200, not in
  use. E3's table appears in the record once the party has played. An unused
  slot is E3's own vehicle, not a missing one.
- `DS:296c` is a new PC's **priest** spells and `DS:294e` its mage spells.
- The poisoned-weapon word holds the slot last poisoned, which E3 never
  clears (0 at first); it counts only while status 0 lasts.
- An item's word at +21 is where it last lay, and the bytes after a name's
  NUL are whatever was on the stack: neither is game state.
- Enchanting adds " (+1)", " (B)" … to the name, and the table has only the
  plain name. Some records differ only in picture (two Pants) or class (two
  Brews of Lethe), so a converted item keeps its record (`Item.e3Item`).
- An unidentified potion's picture can differ from its record's.

`save_file` is `FUN_1040_0db6` and `load_file` `FUN_1040_018e`: BoE 1997's
pair (FILEIO.CPP:440/138) with E3's sizes. **Little-endian** (it is the
Windows build's memory), unlike the .DAT files.

| bytes | block | memory |
|---|---|---|
| 6 | three words: 5790 outdoors / 1342 town; 5434 (98 also read); 3422 no maps / 5567 maps. The pairs `load_file` accepts are at `DS:12fc` | |
| 0x8525 | party record, XOR 0x5c | `1158:0000` |
| 0x4000 | `setup[4][64][64]` | `1160:a61c` |
| 0x722 × 6 | PCs, XOR 0x6b | `1158:8526` |
| 0x2400 | `out_e[96][96]` | `1160:821b` |
| 0x2abe, 0x1710, 0x1c4d | town only: `c_town`, `t_d`, `t_i` | `1160:0000`, `:2abe`, `:41ce` |
| 0x1c4d × 3 | stored items (115 × 63 B) | `1168:84de` |
| 0x9100, 0x6540 | maps only: towns 0–119 (`[40][8][64]`, `[40][6][48]`, `[40][4][32]`), the 90 zones (`[6][48]`) | `1170:0000`, `:9100` |
| 0x1000, 0x1000 | `sfx`, `misc_i` | `DS:5cb1`, `1160:e61c` |
| 0x5a00 | maps only: villages 120–199 (`[80][6][48]`) | `1168:2000` |

**The party record**, from `init_party` (`FUN_10b0_053c`), which clears
every field in order, and each field's readers:

| offset | field | offset | field |
|---|---|---|---|
| 0x0000 | age (long) | 0x6b96 | `out_c[10]`, 31 B |
| 0x0004 | gold (long) | 0x6ccc | magic shops' stock `[5][10]`, 63 B items |
| 0x0008 | food (long) | 0x791a | `imprisoned_monst[4]` |
| 0x000c | special items, i16[60] | 0x7922 | `m_killed[200]`, per town |
| 0x0084 | flags `[310][10]` | 0x7ab2 | `m_seen[256]` |
| 0x0ca0 | `item_taken[200][8]` (bits) | 0x7bb2 | journal: string u8[120], then day i16[120] at 0x7c2a |
| 0x12e0 | light level | 0x7d1a | `help_received[120]` |
| 0x12e2 | outdoor corner | 0x7d92 | encounter notes i16[140][2] |
| 0x12e4 | `i_w_c` | 0x7fc2 | `talk_save[120]`, 7 B, -1 when empty |
| 0x12e6 | `p_loc` (the 96×96 window) | 0x830a | totals: kills, damage done, xp, damage taken (longs) |
| 0x12e8 | `loc_in_sec` | 0x831a | direction; 0x831c save slot |
| 0x12ea | boats[30], 10 B: loc, loc in sector, sector, i16 town, exists, property | 0x831e | alchemy[17] |
| 0x1416 | `creature_save[4]`, 0x1594 B (60 × 0x5c, which_town, friendly) | 0x832f | the party's jobs, 4 × 12 B |
| 0x6a66 | `in_boat`, **0 for none** | 0x835f | job boards, 6 × 4 × 12 B |
| 0x6a68 | horses[30] | 0x847f | boards failed, u8[6] |
| 0x6b94 | `in_horse` | 0x8485 | `can_find_town[120]`, then `key_times[20]` at 0x84fd (30000 = never) |

`init_party` also sets flags (303, 0–9) and (306, 6) to 1, special items 0
and 1, monsters 0x26, 0x28 and 0x4e seen, and journal entry 0; copies
`DS:29b2` into `can_find_town`; and each boat and horse slot not in use
gets E3's table (`DS:2be0`/`2d0c`, `FUN_10b0_0b7c`).

**A PC** (0x722 B) is BoE 1997's `pc_record_type` exactly, with E3's 63-byte
items: status `+0`, name `+2` (20), skills `+22` (i16[30]), health, sp, xp,
skill points, level `+82…+94`, status `+96` (i16[15]), items `+126` (24 ×
63), equip `+1638`, priest spells `+1662`, mage `+1724` (62 each), graphic
`+1786`, poisoned slot `+1788` (24 none), advan `+1790`, traits `+1805`
(15 each), race, exp_adj, direction `+1820…+1824`. A new PC (`FUN_10b0_0c2d`)
knows `DS:296c`'s mage spells and `DS:294e`'s priest spells (30 each).

**The town blocks** (an in-town save), pinned 2026-10-01 against four saves
from the original made in Fort Emergence, Krizsan, the New Factory and
Ghikra (`src/fileio/e3SaveTown.ts`, `E3CTOWN`/`E3CREATURE`/`E3MONST`/`E3TD`
in `e3save.ts`). `load_file` reads them back with no reload, so they hold
the town whole:

- **`c_town`**: town number `+0`; difficulty `+2` (the string after the
  town's name, `atoi`'d and clamped 0–150, `10d8:2089`); TOWN.DAT's
  common record `+4`, words little-endian and `in_town_rect` in Windows
  order (byte for byte in all four); `explored[64][64]` `+0x426`;
  `hostile` (u8) `+0x1426`; 60 creatures of 0x5c from `+0x1427`;
  `which_town` (i16) `+0x29b7`, `friendly` (i16) `+0x29b9`, `in_boat` (u8)
  `+0x29bb`; the party's square `+0x29bc`; the town's name in a 256-byte
  field `+0x29be`.
- **A creature**: `active` i16 (0 absent or dead, 1, 2 alerted),
  `attitude` i16, `number` u8, `m_loc`, the monster record (68 B) `+7`,
  `mobile` u8 `+75`, `summoned` i16 `+76`, the start record (14 B, as in
  `t_d`) `+78`. Creatures with `spec1` 200–204 or a time flag not yet met
  are there, inactive.
- **The monster record**, `FUN_1090_0000(n)` from segment 39's arrays (200
  a field): number, level, health and max (i16, halved when party+0xc7f is
  set), mp and max (8 a level for a caster, 16 from monster 177), armor,
  skill, three attacks (i16), their types, `m_type`, speed, 0, `mu`, `cl`,
  breath, treasure, special skill, morale twice (10 a level, 20 past 20),
  poison, picture, `status[15]` (i16), direction, immunities (the four
  resistance arrays as 2-bit fields), width, height. Every creature in the
  four saves matches but for health, mp, status and facing.
- **`t_d`**: TOWN.DAT's block in the large town's layout whatever the size
  (`FUN_1040_1e1c`): terrain at a stride of 64, rects in Windows order at
  `+0x1000`, names `+0x1060`, creature starts (words swapped) `+0x11c8`,
  lighting rows at a stride of 64 from `+0x1510`. A smaller town fills the
  start of each part and leaves the rest as the last town had it; a
  medium town clears creature slots 40–59, a village 30–59 and its rects'
  second words.
- **`t_i`**: 115 items, a PC's item record with the square at `+21`, the
  preset's slot plus one at `+12`, and its `property` and `contained` at
  `+16` and `+18`.
- **Fields**, as BoE 1997's FIELDS.CPP: `misc_i` 1 block, 2 special, 4
  web, 8 crate, 16 barrel, 32 fire barrier, 64 force barrier, 128
  quickfire; `explored`'s bits above 1 are force, fire, antimagic, stink,
  ice, blades and sleep; `sfx` the eight stains. Bit 2 is set for each of
  the record's spots on entry, and erasing a one-shot spot
  (`FUN_1038_0282`) is clearing it.

## Byte order: big-endian — confirmed

Both .DAT files are the Mac original's data. The Windows game byte-swaps
selected 16-bit fields after every read, which is the job the 1997 BoE source
calls `port_out`/`port_town`. The list of swapped fields is how the layouts
below were pinned: a swapped word is an int16, and anything else is bytes.
Rects are in Mac order (top, left, bottom, right). The readers use
`LegacyReader(data, true)`.

## OUTDOOR.DAT: 90 zones × 3,220 B — pinned (`outdoor.ts`)

Zone `y*9 + x`, 9 across and 10 down. The loader is `FUN_1040_3677`: it seeks
to `(y*9+x)*0xc94` and reads into `zones[2][2]` at `DS:-0x500e`.

| offset | field | notes |
|---|---|---|
| 0 | `terrain[48][48]` | **`[x][y]`, byte `x*48+y`**, as BoE (the code writes `x*0x30 + y`) |
| 2304 | `special_locs[18]` | the encounter handler centres on it |
| 2340 | `special_id[18]` | encounter number; the handler zeroes it after running (one-shot) |
| 2358 | `exit_locs[8]` | |
| 2374 | `exit_dests[8]` | TOWN.DAT record numbers |
| 2382 | `sign_locs[8]` | |
| 2398 | `wandering[4]` | 24 B each, see below |
| 2494 | `wandering_locs[4]` | the code picks one at random |
| 2502 | `info_rect[8]` | swapped as rects |
| 2566 | area names, 8 × 30 B | inline text, one per `info_rect` (BoE used `strlens` + a string table) |
| 2806 | zone name, 30 B | "Northwestern Valorim" |
| 2836 | `special_enc[4]` | 24 B each |
| 2932 | 288 B bitmap | one bit per tile (48×48), about 9 set per zone. **Open**: no code reads it at a fixed offset. |

**Wandering group, 24 B** (BoE `out_wandering_type` is 22): `monst[7]`,
`friendly[3]`, then swapped int16s at +10, +14, +16, +18, +20 and +22, with
2 unswapped bytes at +12 (often 1). BoE's six are `spec_on_meet,
spec_on_win, spec_on_flee, cant_flee, end_spec1, end_spec2`, but E3's do not
line up with them by position. Pinned 2026-09-27:

| offset | meaning |
|---|---|
| +10 | script, `FUN_10c0_06c3(script, phase)`: phase 0 meeting, 1 won, 2 fled. 2–99 also meet the party from anywhere (BoE's `forced`) |
| +12 | byte: 1 = won't run from a stronger party (`cant_flee`) |
| +14, +16 | flag that, once set, stops the group being placed |
| +18, +20 | message: string `block*300 + i` |
| +22 | when the message shows: 0 at the meeting, and no fight; 1 at the meeting, then the fight; 2 on winning |

The scripts are transcribed in `towns/encounters.ts`.
Slot `monst[0]` is empty in every shipped group.

## TOWN.DAT: 200 records — pinned (`town.ts`)

The loader is `FUN_1040_1e1c`. Record `t` sits at
`t*0x422 + Σ(earlier blocks)`: a 1,058-byte common record, then a block sized
by `t`:

| records | block | size | contents, in order |
|---|---|---|---|
| 0–39 | large | 5,904 | terrain 64×64, 12 room rects, 12 room names × 30 B, 60 creatures × 14 B, lighting 8×64 |
| 40–79 | medium | 3,532 | terrain 48×48, 10 rects, 10 names, 40 creatures, lighting 6×48 |
| 80–119 | small | 1,724 | terrain 32×32, 4 rects, 4 names, 30 creatures, lighting 4×32 |
| 120–199 | village | 640 | 30 creatures, 15 building placements × 8 B, 10 × {rect, 2 B}. **No terrain**: built at load, see below. |

These sum to exactly 709,200. The loader sets `town_size` from the same
ranges, and treats 120+ as medium (48×48).

**Records 120–199 are the villages** (Delan, Delis, Pergies, Inn of Blades …;
about 58 named, the rest "Name"). Their maps are *assembled* by
`FUN_1040_1600` after loading: fill 48×48 with grass (cave floor underground),
then stamp up to 15 8×8 building blocks. Each placement is
`{i16 block, i16 condition, u8 rotation/flip, …}`. The block is cut from a
template map (block `b` is at `((b%8)*8, (b/8)*8)`), and rotation `r%4`
quarter-turns with `r>=4` mirrored. Then it scatters random variants: grass
2→3/4, 0→1, 84→85, 91→92, 36→37. **Pinned** (`village.ts`): the template
is town record 20's map. A placement is `{i16 block, i16 day, u8 rotation, u8
event, u8 x, u8 y}`. A rect entry is `{rect, u8 terrain, u8 kind}`: kinds
0–3 run before the buildings and 10–13 after. Kind % 10 is 1 for the frame
only; otherwise it indexes the fill chance in 20, `[20, 20, 1, 8]`. Because of the random scatter, a
village's grass is re-rolled on every load (cosmetic, and it uses the RNG).

Towns also change state without a village record: records 0–3 are Krizsan and
its later states (0 and 1 differ in "Small Shipyard" vs "Ruined Shipyard").
So are 4–7 (Shayder), 8–11 (Sharimik), 12–15 (Lorelei) and 16–19 (Gale):
the town loader swaps in a later record by day and plot event
(`towns/townStates.ts`).

**Town names** are string `30001 + 20t`, the first of a 20-string block per
town.

**Common record, 1,058 B.** The loader reads it to `DS:0004`, so the addresses
in the disassembly are these offsets + 4.

| offset | field | vs BoE `town_record_type` |
|---|---|---|
| 0x000 | `town_chop_time`, `town_chop_key` | same |
| 0x004 | `wandering[4]` × `monst[4]` | same |
| 0x014 | `wandering_locs[4]` | same |
| 0x01c | `special_locs[40]` | BoE 50 |
| 0x06c | `spec_id[40]` | BoE 50 |
| 0x094 | `sign_locs[12]` | BoE 15 |
| 0x0ac | `lighting` | same |
| 0x0ae | `start_locs[4]` | same |
| 0x0b6 | `exit_specs[4]` | BoE has `exit_locs` first |
| 0x0be | `exit_locs[4]` | pinned 2026-09-30: north, south, east, west (BoE: n, w, s, e), in the zone the party is in; x below 1 unused. E3's end_town_mode `FUN_10d8_252b` reads them as `es:[0xc2]`–`[0xc8]`. Towns 0–19 have all four, a cross round one square of their zone |
| 0x0c6 | `in_town_rect` | same, read Mac-order; but E3's code compares x with the first field (`1080:02e9`), E3-SUSPECTED-BUGS.md #21 |
| 0x0ce | `preset_items[64]` × 10 B | same layout, but `ability` (i16) is gold's or food's amount and otherwise the item's ability byte (+10); `charges` (u8) is its own (town loader `10d8:1531`, `notes.ts`) |
| 0x34e | `max_num_monst` | same |
| 0x350 | int16 | **open** |
| 0x352 | `preset_fields[50]` × 4 B | same |
| 0x41a | 2 × int16 | the message (block, i) shown to a party that walks in (`entry_dir < 9`; `10d8:2281`) |
| 0x41e | 2 × int16 | the same once the town is cleared out; BoE has `spec_on_entry` here, and E3 its own messages instead |

**Creature, 14 B** (BoE 24): `number, start_attitude, start_loc, mobile,
time_flag, extra1, extra2, spec1, spec2` (bytes), then an int16 time code at
+10 (`event*1000 + day`, -1 when unused), then the personality, an int16 at
+12 (confirmed by the talk code). `extra1`/`extra2` do double duty: a
shopkeeper's stock range, an innkeeper's bed. `spec1`/`spec2` is the death
flag, except that 200–204 mark creatures a script brings in.

## Script helpers (E3-3) — identified 2026-09-24

The encounter code calls a small set of helpers. The decompiler drops the
arguments of far calls, so read them from the disassembly (`Disasm.java`).

| function | what it does |
|---|---|
| `FUN_1008_37de(block, i, snd)` | message: string `block*300 + i` |
| `FUN_1008_3812(block, i, block, j, snd)` | message: two strings |
| `FUN_1008_386f(i, j)` | Anaximander's report: block 14 (strings 4200+) |
| `FUN_1008_3780(n)` | journal entry `n`, dated today (party+0x7bb2 / +0x7c2a) |
| `FUN_1070_31cd(dlg, 0)` | show dialog resource `dlg`; returns the control id clicked (1 = the first button) |
| `FUN_10e0_0097(dlg)` | the same, true if the second button |
| `FUN_10e0_0044(i, j, block, snd, flag)` | message once, marking `flag` 20 |
| `FUN_10e0_00ec(item, flag, dlg, reward)` | once: dialog offering `item` (Leave/Take); `reward` 1000s food, 2000s gold, 300s special item |
| `FUN_10e0_03ae(trap, flag, dlg, kind)` | a trapped container |
| `FUN_10e0_07b7(id)` | the location of the town's spot `id` |
| `FUN_1080_1b76(x, y, ter)` | set terrain (town or outdoors) |
| `FUN_1080_1b1f(x, y, a, b)` | swap terrain `a` and `b` at a spot |
| `FUN_10c0_4a61(town, x, y)` | move the party into `town` at `(x, y)` |
| `FUN_1040_2c2d(zx, zy, x, y)` | leave for outdoor zone `(zx, zy)` at `(x, y)` (in the 2×2 window) |
| `FUN_10b0_302f()` | total Mage Lore (skill 11, `pc+0x2c`) of the living PCs; read as levels until 2026-10-01 |
| `FUN_10b0_366a(s)` | teach every PC mage spell `s` (priest `s - 100` from 100) |
| `FUN_10b0_1509(n)` / `FUN_10b0_1fb3(n)` | heal the party / restore spell points |
| `FUN_1090_4053(code, att)` | bring in the creatures whose `spec1` is `code` |
| `FUN_10d0_548b()` | `calc_day()` |
| `FUN_1070_0623(n, redraw)` | pay `n` gold; false if the party has too little |
| `FUN_10b0_183a(pc, n)` | BoE 1997's `disease_pc` (save against level, frailty, sound 66) |
| `FUN_1048_011f(a, b)` | `max(a, b)` |
| `FUN_10d8_3d5b(kind, row, col)` | if flag `(row, col)` is set, every creature of `kind` is gone |
| `FUN_10b0_16e6(pc, n)` | BoE 1997's `dumbfound_pc` |
| `FUN_1038_1185(x, y, type)` | a decal on the floor (`make_sfx`) |
| `FUN_1038_1270(type, pct)` | decal `type` on each square of terrain under 5, each with `pct`% chance |
| `FUN_1080_0917(x, y)` | `sight_obscurity` |
| `FUN_10b0_1bec(pc, n)` / `FUN_10b0_1606(pc, n)` | BoE 1997's `slow_pc` / `curse_pc` |
| `FUN_10b0_19dd(pc, n, type, adjust)` | `sleep_pc`: resisted if `get_ran(1, 0, 100) + adjust < 30 + 2 × level` |
| `FUN_1070_0464(item, ability)` | give `item`, with its ability byte (+10) set to `ability` when > 0, to the first PC with room (`notes.ts`) |
| `FUN_10d0_4c8d(far str)` | a line in the text area; a script's literal is in its own code segment (`PUSH CS; PUSH off`) |

DGROUP `0x3d3c` is the registered-copy flag; the shareware build refuses
some crossings without it ("You need to be registered."). Horses' records
are 10 bytes from party+0x6a68, `property` at +9: 0x6a99 is horse 4's.

Town terrain is in segment 1160 at `0x2abe + 64x + y`, a stride of 64
whatever the town's size.

The PC record (stride 0x722, PC `i` at `i*0x722 - 0x7ada` in segment 1158) is
BoE's `pc_record_type`: `main_status` (+0), `name[20]`, `skills[30]` (+0x16;
mage spells +0x28, priest +0x2a), `max_health` (+0x52), `cur_health`,
`max_sp` (+0x56), `cur_sp`, `experience`, `skill_pts`, `level` (+0x5e), then
`status[15]` (+0x60; disease, status 7, is +0x6e). The mage spell book is at
+0x6bc (`-0x741e`), one byte a spell.

Boats are 10-byte records from party+0x12ea (30 of them), in the same
layout as horses: the town boarding test reads `property` at 0x12f3 + 10k
(`1010:8263`). Their starting values are at `DS:2be0`, the horses' at
`DS:2d0c`.

Creatures with `spec1` 200–204 start absent (`10d8:0d36`), and
`FUN_1090_4053(code, attitude)` brings in those whose `spec1` is `code`. The
converter writes the code as the creature's `<encounter>`.

Flags are addressed as party-record offsets, and flag `(a, b)` is byte
`0x84 + 10a + b`. Special items are the int16s at party+0xc.

## Town script handlers (E3-3)

The town encounter handler `FUN_10c0_0000` switches on the town number for
spots below 100. Each town's (or group of towns') own code, as parsed from
that switch (2026-09-26). Towns not listed have no code of their own.

| towns | handler |
|---|---|
| 0–3 | `FUN_1078_0000` |
| 4–7 | `FUN_1078_01af` |
| 8–11 | `FUN_1078_2f0c` |
| 12–15 | `FUN_1078_0561` |
| 16–19 | `FUN_1078_07f1` |
| 21 | `FUN_1078_0b66` |
| 22 | `FUN_1078_155e` |
| 23 | `FUN_1078_19df` |
| 24 | `FUN_1078_1e05` |
| 25 | `FUN_1078_222d` |
| 26 | `FUN_1078_259e` |
| 27 | `FUN_1078_294f` |
| 28 | `FUN_1078_3303` |
| 29 | `FUN_1078_37c4` |
| 30 | `FUN_1078_3c6f` |
| 31 | `FUN_1078_4089` |
| 32 | `FUN_1078_4491` |
| 33 | `FUN_1078_45b8` |
| 34 | `FUN_1078_4918` |
| 35 | `FUN_1078_4a82` |
| 36 | `FUN_1078_4cde` |
| 37 | `FUN_1078_52ae` |
| 38 | `FUN_1078_55ff` |
| 40 | `FUN_1088_0000` |
| 41 | `FUN_1088_0586` |
| 42 | `FUN_1088_08c7` |
| 43 | `FUN_1088_0ab5` |
| 44 | `FUN_1088_0305` |
| 45 | `FUN_1088_040d` |
| 46 | `FUN_1088_0c28` |
| 47 | `FUN_1088_0f24` |
| 48 | `FUN_1088_1231` |
| 49, 97 | `FUN_1088_1362` |
| 50 | `FUN_1088_1807` |
| 51 | `FUN_1088_1959` |
| 52 | `FUN_1088_1b0d` |
| 53 | `FUN_1088_1e4d` |
| 54 | `FUN_1088_2248` |
| 55 | `FUN_1088_1fe8` |
| 56 | `FUN_1088_2f08` |
| 57 | `FUN_1088_325a` |
| 58 | `FUN_1088_2a45` |
| 59 | `FUN_1088_2c12` |
| 60 | `FUN_1088_4745` |
| 61 | `FUN_1088_4f13` |
| 62 | `FUN_1088_5233` |
| 63 | `FUN_1088_5402` |
| 64 | `FUN_1088_56f5` |
| 65 | `FUN_1088_58a1` |
| 70 | `FUN_1088_3b05` |
| 71 | `FUN_1088_3d98` |
| 72 | `FUN_1088_488c` |
| 73 | `FUN_1088_4ceb` |
| 74 | `FUN_1088_34c3` |
| 75 | `FUN_1088_3993` |
| 76 | `FUN_1088_4188` |
| 77 | `FUN_1088_4336` |
| 78 | `FUN_1088_251e` |
| 79 | `FUN_1088_2822` |
| 80 | `FUN_10b8_0000` |
| 81 | `FUN_10b8_02e2` |
| 82 | `FUN_10b8_1169` |
| 85 | `FUN_10b8_039c` |
| 86 | `FUN_10b8_0117` |
| 87 | `FUN_10b8_1097` |
| 88 | `FUN_10b8_0608` |
| 89 | `FUN_10b8_0856` |
| 90 | `FUN_10b8_0b0c` |
| 91 | `FUN_10b8_18cc` |
| 92, 127, 129, 131–132, 135 | `FUN_10b8_153b` |
| 93 | `FUN_10b8_1bfa` |
| 94 | `FUN_10b8_1d23` |
| 96 | `FUN_10b8_1ae1` |
| 98, 142–145 | `FUN_10b8_1f49` |
| 99 | `FUN_10b8_2220` |
| 101 | `FUN_10b8_2848` |
| 102 | `FUN_10b8_2a00` |
| 103 | `FUN_10b8_2def` |
| 104 | `FUN_10b8_3288` |
| 105 | `FUN_10b8_3477` |
| 106–107 | `FUN_10b8_3941` |
| 108 | `FUN_10b8_3e9d` |
| 109 | `FUN_10b8_44ed` |
| 110 | `FUN_10b8_4437` |
| 111 | `FUN_10b8_46db` |
| 121 | `FUN_10b8_0dc4` |
| 122 | `FUN_10b8_0e93` |
| 123 | `FUN_10b8_10eb` |
| 124 | `FUN_10b8_0f46` |
| 125 | `FUN_10b8_0ff1` |
| 126 | `FUN_10b8_1341` |
| 128, 156–158 | `FUN_10b8_3077` |
| 133, 137, 147–149 | `FUN_10b8_2549` |
| 138–141 | `FUN_10b8_1dbe` |
| 146 | `FUN_10b8_2761` |
| 150–155 | `FUN_10b8_2bf3` |
| 159–162 | `FUN_10b8_382d` |
| 163, 171 | `FUN_10b8_3b6e` |
| 164–166 | `FUN_10b8_3a04` |
| 173 | `FUN_10b8_41f4` |
| 174–177 | `FUN_10b8_3fc5` |

Each is a `switch` on the spot's number, usually through a jump table right
after the function (`show.ts wSEG:OFF:N` prints one): read the table, since
Ghidra's C mislabels arms when it loses track of arguments. The handler
returns 0 to refuse the step.

Towns also have **per-turn code**, at the tail of `FUN_10c0_61c4` (from
10c0:65bf): countdowns in flags for towns 26, 27 and 28 so far.
