# Ghidra on EXILE3.EXE

Exile 3's quest logic is compiled into EXILE3.EXE, not stored as data. This is
how to read it. Ghidra comes from Homebrew (`brew install ghidra`, which pulls
in `openjdk@21`). Headless Ghidra needs the JDK on `PATH`, because it cannot
ask for a path without a terminal:

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
GH=/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless
cd tools/e3convert/ghidra
mkdir -p project
$GH project e3 -import <E3 dir>/EXILE3.EXE                 # ~20 s, once
$GH project e3 -process EXILE3.EXE -noanalysis -scriptPath . \
    -postScript DecompAt.java 68bb13 /tmp/out.c              # decompile
```

The project is gitignored because it's derived from the commercial binary.

`DecompAll.java <out.c>` is the main tool. It creates a function at every
Win16 far prologue that auto-analysis missed (auto-analysis finds 643; this
brings it to 1,363), then decompiles all of them into one file to grep. It takes
about a minute. Keep the output in `project/`:

```
$GH project e3 -process EXILE3.EXE -scriptPath $PWD -postScript DecompAll.java $PWD/project/exile3.c
```

The decompiler drops the arguments to Win16 imports (`_llseek`, `_lread`), so
for seek and read sizes use `Disasm.java <seg:off> <out.s>`, which prints the
listing of one function. `-scriptPath` must be absolute.

`DecompAt.java <hex bytes> <out.c>` finds the first occurrence of the bytes,
decompiles the function that contains them, and writes the C. If auto-analysis
never reached that code, the script walks back to the nearest Win16 far
prologue (`8c d0 90 45 55 8b ec`) and creates the function itself. The bytes
to search for are usually `68 lo hi`, i.e. `push imm16` of a dialog or string
ID taken from the resource extractors (see `../FORMATS.md`).

## Without Ghidra: `nedis.py`

Where Ghidra can't be installed (a cloud container whose network policy blocks
its download), `nedis.py` disassembles EXILE3.EXE with capstone
(`pip install capstone`):

```
python3 tools/e3convert/ghidra/nedis.py 10b8:0b0c      # one function, by Ghidra address
python3 tools/e3convert/ghidra/nedis.py --table 10b8:0d8b 18
```

It applies the NE relocations, so far calls print under Ghidra's names
(`call FUN_1008_37de`) and segment fixups say which segment (`; seg 1158` is
the party record, `1160` the current town, `1178` DGROUP). Jump tables after
a `cmp bx, N; jmp word ptr cs:[bx + T]` are printed at the end, indexed by
`bx / 2` (the handlers `dec bx` first, so index `k` is spot `k + 1`).

That covers the town and zone switches, which were always read from the
disassembly anyway (the decompiler drops far calls' arguments). What it
can't do well is Ghidra's other job: finding code. There is no decompiled
`exile3.c` to grep and no function list beyond the prologue scan. `--all`
prints every segment (390,000 lines) for a poor man's cross-reference —
`grep 'es:\[0x6a99\]'` finds every direct write to a party byte — but it
misses indexed and pointer access, which Ghidra's references follow. `--str
SEG:OFF` prints a script's literal string. For the long, stateful code still to do — the demon plot's
countdown, the turn code (`FUN_1010_5889`), the job bank — run Ghidra where
it installs and keep `project/exile3.c` beside the scripts.
