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

`DecompAt.java <hex bytes> <out.c>` finds the first occurrence of the bytes,
decompiles the function that contains them, and writes the C. If auto-analysis
never reached that code, the script walks back to the nearest Win16 far
prologue (`8c d8 90 45 55 8b ec`) and creates the function itself. The bytes
to search for are usually `68 lo hi`, i.e. `push imm16` of a dialog or string
ID taken from the resource extractors (see `../FORMATS.md`).
