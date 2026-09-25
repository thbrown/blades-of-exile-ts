#!/usr/bin/env python3
"""Print the disassembly of talk script case(s) from project/talkscripts.s.

Make that file first (from tools/e3convert/ghidra):
  $GH project e3 -process EXILE3.EXE -noanalysis -scriptPath $PWD \
      -postScript Disasm.java 1020:2eb0 $PWD/project/talkscripts.s 6000
Usage: talkcase.py 100 101 ...
The table is FUN_1020_2eb0's jump table at 1020:4a5f (types 100-170)."""
import sys, re
lines = open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'project/talkscripts.s')).read().splitlines()
table = "2ee7 2f21 3019 3053 3142 3168 31ee 3274 333a 32d1 33d9 3459 3421 3421 3421 34a9 34f3 353b 3587 3615 364f 36ae 371f 372d 37b0 3822 3822 3822 3822 3822 3875 3a01 3a70 3aa8 3ae6 3b27 3bc4 3c36 3c6e 3c7f 3c90 3cd1 3dca 3e14 3e8e 3f04 3f39 3f9b 3fe3 4096 40ee 4125 4138 418b 41b2 4218 43ac 43f7 4459 449a 45b7 4632 4695 46f4 4734 47f0 4862 48c4 48d2 490b 495e".split()
addrs = sorted(set(int(a,16) for a in table)) + [0x49e8]
skip = re.compile(r'MOV (AX|DX),(0x11[0-9a-f]{2}|ES)$')
for t in map(int, sys.argv[1:]):
    a = int(table[t-100],16); b = min(x for x in addrs if x > a)
    print(f'=== type {t} ({a:x}..{b:x})')
    for l in lines:
        m = re.match(r'1020:([0-9a-f]{4})\s+(.*)', l)
        if not m: continue
        ad = int(m.group(1),16)
        if a <= ad < b and not skip.search(m.group(2)) and not m.group(2).startswith('ADD SP'): print(' ', m.group(1), m.group(2))
