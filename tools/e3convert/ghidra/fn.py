#!/usr/bin/env python3
"""Print the decompiled function containing seg:off, from project/exile3.c.
Usage: fn.py 1010:7e2f [more addresses]"""
import re, sys, os
src = open(os.path.join(os.path.dirname(__file__), 'project/exile3.c')).read()
heads = [(m.start(), m.group(1), int(m.group(2), 16)) for m in re.finditer(r'^// ==== \S+ @ ([0-9a-f]{4}):([0-9a-f]{4})$', src, re.M)]
for a in sys.argv[1:]:
    seg, off = a.split(':'); off = int(off, 16)
    cands = [h for h in heads if h[1] == seg and h[2] <= off]
    if not cands: print('no function before', a); continue
    h = max(cands, key=lambda h: h[2])
    i = heads.index(h)
    end = heads[i + 1][0] if i + 1 < len(heads) else len(src)
    print(src[h[0]:end])
