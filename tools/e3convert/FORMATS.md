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
  `+ which_special*2 - 0x470e`. So each zone record holds a table of
  **16-bit encounter numbers**, and the handler `switch`es on them.
- Encounter numbers 100–199 and ≥ 200 are generic kinds that are driven by
  flags (`encounter-100`, `encounter-200`). The range 50–59 returns
  immediately. The rest are unique scripts.
- The Vilovsky branch reads almost like source: `fancy_choice(5050)`, then
  flag checks, `fancy_choice(5051)`, `take_gold(5000,1)`, then set flags, play
  sounds 0x97 and 0x9d, and raise a skill of each of the 6 PCs. The PC record
  stride is **0x722 = 1,826 bytes**.
- Auto-analysis found only 643 functions and missed this one. Expect to create
  functions by hand (`ghidra/DecompAt.java` does it).

## OUTDOOR.DAT — 90 zones × 3,220 B

- `+0`: 48×48 terrain bytes, row-major (the user's `outdoor-to-json.js`).
  **Confirmed.**
- The encounter-number table read by `FUN_10a0_0062` is at a zone offset still
  to be pinned. It's reached via `-0x470e` relative to the zone array's base
  in segment `1158`.
- The rest of the 916 B: to do.

## TOWN.DAT — 709,200 B

- Byte autocorrelation suggests **100 × 7,092 B**. Not yet checked by
  rendering a town.
