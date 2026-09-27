#!/usr/bin/env python3
"""
Disassembles EXILE3.EXE without Ghidra, for machines that can't install it.

    pip install capstone
    python3 tools/e3convert/ghidra/nedis.py 10b8:0b0c          # one function
    python3 tools/e3convert/ghidra/nedis.py 10b8:0b0c 10b8:1000 # a range
    python3 tools/e3convert/ghidra/nedis.py --table 10b8:0c40 20  # a jump table

Addresses are Ghidra's (segment n is `0x1000 + (n-1)*8`), so the names in
FORMATS.md and the scripts' comments work unchanged. The NE relocations are
applied: a far call prints as `call FUN_SSSS_OOOO`, an import as
`call KERNEL.20`, and a far pointer or segment fixup says what it names. A
function runs from its Win16 far prologue (`... 45 55 8b ec`) to the next one.

`E3_EXE` names the EXE; the default is the one `ensureE3Unpacked` writes.
"""
import os
import re
import signal
import struct
import sys

from capstone import CS_ARCH_X86, CS_MODE_16, Cs

EXE = os.environ.get('E3_EXE', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'e3data', 'EXILE3.EXE'))


class Ne:
    def __init__(self, path):
        self.b = open(path, 'rb').read()
        b = self.b
        ne = struct.unpack_from('<H', b, 0x3c)[0]
        self.ne = ne
        nseg = struct.unpack_from('<H', b, ne + 0x1c)[0]
        seg_tab = ne + struct.unpack_from('<H', b, ne + 0x22)[0]
        self.align = struct.unpack_from('<H', b, ne + 0x32)[0]
        modref = ne + struct.unpack_from('<H', b, ne + 0x28)[0]
        imp_names = ne + struct.unpack_from('<H', b, ne + 0x2a)[0]
        nmod = struct.unpack_from('<H', b, ne + 0x1e)[0]
        self.modules = []
        for i in range(nmod):
            o = imp_names + struct.unpack_from('<H', b, modref + 2 * i)[0]
            self.modules.append(b[o + 1:o + 1 + b[o]].decode('latin1'))
        self.segs = []
        for i in range(nseg):
            off, ln, flags, _ = struct.unpack_from('<HHHH', b, seg_tab + 8 * i)
            self.segs.append((off << self.align, ln or 0x10000, flags))
        self.entries = self._entries(ne + struct.unpack_from('<H', b, ne + 0x04)[0])
        self.fix = [dict() for _ in range(nseg)]
        for n in range(1, nseg + 1):
            self._relocs(n)

    def _entries(self, p):
        """Entry ordinal -> (segment, offset)."""
        b, out, ordinal = self.b, {}, 1
        while True:
            cnt = b[p]
            if cnt == 0:
                return out
            ind = b[p + 1]
            p += 2
            for _ in range(cnt):
                if ind == 0:
                    pass
                elif ind == 0xff:
                    seg, off = b[p + 3], struct.unpack_from('<H', b, p + 4)[0]
                    out[ordinal] = (seg, off)
                    p += 6
                    ordinal += 1
                    continue
                else:
                    out[ordinal] = (ind, struct.unpack_from('<H', b, p + 1)[0])
                    p += 3
                    ordinal += 1
                    continue
                ordinal += 1
            if ind == 0:
                continue

    def data(self, n):
        off, ln, _ = self.segs[n - 1]
        return self.b[off:off + ln]

    def _relocs(self, n):
        off, ln, flags = self.segs[n - 1]
        if not flags & 0x100 or off == 0:
            return
        b = self.b
        p = off + ln
        count = struct.unpack_from('<H', b, p)[0]
        p += 2
        data = self.data(n)
        for _ in range(count):
            src, kind, at, a, c = struct.unpack_from('<BBHHH', b, p)
            p += 8
            target = kind & 3
            if target == 0:
                seg = a & 0xff
                if seg == 0xff:
                    seg, toff = self.entries.get(c, (0, c))
                else:
                    toff = c
                name = f'{ghidra_seg(seg):04x}:{toff:04x}'
            elif target == 1:
                name = f'{self.modules[a - 1]}.{c}'
            elif target == 2:
                name = f'{self.modules[a - 1]}.name{c}'
            else:
                name = f'osfixup{a}'
            if kind & 4:  # additive: a single site
                self.fix[n - 1][at] = (src, name)
                continue
            seen = 0
            while at != 0xffff and at < len(data) and seen < 10000:
                self.fix[n - 1][at] = (src, name)
                at = struct.unpack_from('<H', data, at)[0]
                seen += 1


def ghidra_seg(n):
    return 0x1000 + (n - 1) * 8


def seg_number(g):
    return (g - 0x1000) // 8 + 1


def fun_name(target):
    if ':' in target and not target.startswith('osfixup'):
        s, o = target.split(':')
        return f'FUN_{s}_{o}'
    return target


PROLOGUE = bytes([0x45, 0x55, 0x8b, 0xec])


def function_end(data, start):
    """The next far prologue after `start` (its first byte), or the segment's end."""
    p = data.find(PROLOGUE, start + 8)
    while p != -1:
        # The prologue is `mov ax, ds` (8c d8) or `push ds; pop ax` (1e 58), then nop.
        if data[p - 1] == 0x90:
            return p - 3
        p = data.find(PROLOGUE, p + 1)
    return len(data)


def disasm(ne, gseg, start, end=None):
    n = seg_number(gseg)
    data = ne.data(n)
    fix = ne.fix[n - 1]
    if end is None:
        end = function_end(data, start)
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    md.skipdata = True
    tables = []
    bound = None
    for ins in md.disasm(data[start:end], start):
        text = f'{ins.mnemonic} {ins.op_str}'.strip()
        m = re.match(r'cmp bx, (0x[0-9a-f]+|\d+)$', text)
        if m:
            bound = int(m.group(1), 0)
        m = re.match(r'jmp word ptr cs:\[bx \+ (0x[0-9a-f]+)\]$', text)
        if m and bound is not None:
            tables.append((ins.address, int(m.group(1), 16), bound + 1))
        notes = []
        for k in range(ins.address, ins.address + ins.size):
            if k in fix:
                src, name = fix[k]
                if ins.bytes[0] == 0x9a and k == ins.address + 1:
                    text = f'call {fun_name(name)}'
                elif src == 2:
                    notes.append(f'seg {name.split(":")[0]}')
                else:
                    notes.append(f'reloc({src}) {name}')
        line = f'{gseg:04x}:{ins.address:04x}  {text}'
        if notes:
            line += '    ; ' + ', '.join(notes)
        print(line)
    for at, table, count in tables:
        print(f'; jump table at {gseg:04x}:{table:04x} (from {at:04x}), by bx/2:')
        for i in range(count):
            print(f';   {i:3d} -> {struct.unpack_from("<H", data, table + 2 * i)[0]:04x}')


def main():
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    ne = Ne(EXE)
    args = sys.argv[1:]
    if args and args[0] == '--table':
        s, o = (int(x, 16) for x in args[1].split(':'))
        count = int(args[2])
        data = ne.data(seg_number(s))
        for i in range(count):
            print(f'{i:3d}: {s:04x}:{struct.unpack_from("<H", data, o + 2 * i)[0]:04x}')
        return
    if not args:
        print(__doc__)
        return
    s, o = (int(x, 16) for x in args[0].split(':'))
    end = int(args[1].split(':')[1], 16) if len(args) > 1 else None
    disasm(ne, s, o, end)


if __name__ == '__main__':
    main()
