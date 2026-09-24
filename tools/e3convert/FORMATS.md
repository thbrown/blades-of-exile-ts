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
  immediately. The rest are unique scripts.
- The Vilovsky branch reads almost like source: `fancy_choice(5050)`, then
  flag checks, `fancy_choice(5051)`, `take_gold(5000,1)`, then set flags, play
  sounds 0x97 and 0x9d, and raise a skill of each of the 6 PCs. The PC record
  stride is **0x722 = 1,826 bytes**.
- Auto-analysis found only 643 functions and missed this one. Expect to create
  functions by hand. `ghidra/DecompAll.java` does it for every prologue.

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
2 unswapped bytes at +12 (often 1). **Open**: which int16 is which. BoE's six
are `spec_on_meet, spec_on_win, spec_on_flee, cant_flee, end_spec1,
end_spec2`, but the +12 gap means E3's do not line up with them by position.
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
| 120–199 | variant | 640 | 30 creatures, 15 × 8 B (first two words swapped), 10 × {rect, 2 B}. **No terrain.** |

These sum to exactly 709,200. The loader sets `town_size` from the same
ranges, and treats 120+ as medium. **Open**: what a variant record is. Towns
also change state without one: records 0 and 1 are the same town before and
after ("Small Shipyard" becomes "Ruined Shipyard"). `FUN_1040_1600` runs after
a variant loads.

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
| 0x0be | 4 locations | **open**: probably `exit_locs`, but a cross around (20,33) in town 0 |
| 0x0c6 | `in_town_rect` | same |
| 0x0ce | `preset_items[64]` × 10 B | same layout |
| 0x34e | `max_num_monst` | same |
| 0x350 | int16 | **open** |
| 0x352 | `preset_fields[50]` × 4 B | same |
| 0x41a | 4 × int16 | **open** (BoE continues with `spec_on_entry` …, then specials E3 doesn't have) |

**Creature, 14 B** (BoE 24): `number, start_attitude, start_loc, mobile,
time_flag, extra1, extra2, spec1, spec2` (bytes), then 3 unknown bytes
(+10/+11 are always 255), and `+13` personality (distinct per named NPC,
shared by guards). **Open**: confirm the personality against the talk code.
