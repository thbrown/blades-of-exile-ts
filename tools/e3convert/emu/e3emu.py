#!/usr/bin/env python3
"""
Runs EXILE3.EXE's own code, function by function, in an x86 emulator.

    pip install unicorn capstone

Exile III's quest logic was copied out of the EXE by hand (`../towns/`). This
is the check on that copy: it loads the EXE into a real-mode address space
with its NE relocations applied, loads a saved game into the data segments
(the save *is* those segments, see `src/fileio/e3save.ts`), calls a handler
the way the game does, and reports what it showed and what it changed. The
port runs the same handler from the same save, and the two are compared.

Win16 runs in protected mode, but nothing the game logic does needs it: every
segment gets a paragraph of its own below 1 MB (the whole EXE is 0xdabd8
bytes), a segment fixup becomes that paragraph, and the one huge-pointer
constant (`KERNEL.113`, `__AHSHIFT`) becomes real mode's 12.

Calls out of the EXE land in a stub segment. Each stub is a `retf`, and a
code hook on it does the work in Python first: the Borland runtime's string
functions for real, the file calls on real files, Windows' drawing as
nothing. E3 functions that only talk to the player (a message, a dialog) are
redirected to stubs too, which log them and answer from a script. Everything
else, the logic under test, runs as compiled.
"""
import json
import math
import os
import struct
import sys

from unicorn import (UC_ARCH_X86, UC_HOOK_CODE, UC_HOOK_MEM_INVALID, UC_HOOK_INTR, UC_MODE_16, Uc, UcError)
from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_BP, UC_X86_REG_BX, UC_X86_REG_CS, UC_X86_REG_CX,
                               UC_X86_REG_DI, UC_X86_REG_DS, UC_X86_REG_DX, UC_X86_REG_ES, UC_X86_REG_IP,
                               UC_X86_REG_SI, UC_X86_REG_SP, UC_X86_REG_SS)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ghidra'))
import nedis  # noqa: E402

EXE = nedis.EXE
DGROUP = 48
# Data segments the game indexes freely; each gets a whole 64K.
BIG = {44, 45, 46, 47, 48}
STUB_PARA = 0xf500          # the stub segment, just past the EXE: 0x1000 bytes of `retf`
STUB_SIZE = 0x1000
HEAP_PARA = 0xf600          # GlobalAlloc and farmalloc, up to real mode's last byte
HEAP_END = 0x10ffe
MEM_TOP = 0x110000
IMPORT_LIMIT = 200_000


class Stop(Exception):
    pass


def gseg(n):
    return nedis.ghidra_seg(n)


def snum(g):
    return nedis.seg_number(g)


class Emu:
    def __init__(self, exe=EXE):
        self.ne = nedis.Ne(exe)
        self.mu = Uc(UC_ARCH_X86, UC_MODE_16)
        self.mu.mem_map(0, MEM_TOP)
        self.para = {}
        p = 0x0500
        for n, (off, ln, flags) in enumerate(self.ne.segs, start=1):
            size = 0x10000 if n in BIG else (ln + 15) & ~15
            self.para[n] = p
            p += size >> 4
            if off:
                self.mu.mem_write(self.para[n] << 4, self.ne.data(n))
        assert p <= STUB_PARA, hex(p)
        self.stubs = []        # index -> (name, handler)
        self.stub_by_name = {}
        self.stubs_at = {}     # code stubs: offset -> (name, handler)
        self.mu.mem_write(STUB_PARA << 4, b'\xcb' * STUB_SIZE)  # retf everywhere
        self.heap = HEAP_PARA
        self.files = {}        # handle -> [bytearray, pos, path, writable]
        self.paths = {}        # upper-case DOS name -> host path
        self.e3dir = os.path.dirname(os.path.abspath(exe))
        self.end_stub = self.stub('<end>', self._end)
        self._relocate()
        self.mu.hook_add(UC_HOOK_CODE, self._on_stub, begin=STUB_PARA << 4, end=(STUB_PARA << 4) + STUB_SIZE - 1)
        self.mu.hook_add(UC_HOOK_MEM_INVALID, self._on_bad)
        self.mu.hook_add(UC_HOOK_INTR, self._on_int)
        ss = self.para[DGROUP]
        # Win16's task header words: the stack's limits, which the frame
        # helper `1000:102f` checks against (`ss:[0xa]` + 0x440).
        self.ww(ss, 0x0a, 0x8000)
        self.ww(ss, 0x0c, 0xfff0)
        self.ww(ss, 0x0e, 0x8000)
        self.log = []
        self.written = {}
        self.ticks = 0
        self.open_name = 'EXILE3.SAV'
        self.trace_imports = False
        self._strings = None

    # ---------------------------------------------------------------- memory

    def lin(self, g, off):
        """Linear address of Ghidra segment `g` (0x1158) or a raw paragraph."""
        para = self.para[snum(g)] if g >= 0x1000 and g < 0x1200 else g
        return (para << 4) + (off & 0xffff)

    def rb(self, g, off, n=1):
        return bytes(self.mu.mem_read(self.lin(g, off), n))

    def rw(self, g, off):
        return struct.unpack('<H', self.rb(g, off, 2))[0]

    def rsw(self, g, off):
        return struct.unpack('<h', self.rb(g, off, 2))[0]

    def wb(self, g, off, data):
        self.mu.mem_write(self.lin(g, off), bytes(data))

    def ww(self, g, off, v):
        self.wb(g, off, struct.pack('<H', v & 0xffff))

    def rfar(self, seg_para, off):
        return (seg_para << 4) + off

    def cstr(self, para, off, limit=4096):
        a = (para << 4) + off
        out = bytearray()
        while len(out) < limit:
            c = self.mu.mem_read(a + len(out), 1)[0]
            if c == 0:
                break
            out.append(c)
        return bytes(out)

    def string(self, sid):
        """String resource `sid` (RT_STRING blocks of 16), as bytes, or None."""
        if self._strings is None:
            self._strings = {}
            b, ne = self.ne.b, self.ne.ne
            p = ne + struct.unpack_from('<H', b, ne + 0x24)[0]
            shift = struct.unpack_from('<H', b, p)[0]
            p += 2
            while True:
                tid, cnt = struct.unpack_from('<HH', b, p)
                if tid == 0:
                    break
                p += 8
                for _ in range(cnt):
                    off, ln, fl, rid = struct.unpack_from('<HHHH', b, p)
                    p += 12
                    if tid == 0x8006:
                        q = off << shift
                        for k in range(16):
                            n = b[q]
                            if n:
                                self._strings[((rid & 0x7fff) - 1) * 16 + k] = b[q + 1:q + 1 + n]
                            q += 1 + n
        return self._strings.get(sid)

    # ------------------------------------------------------------ relocation

    def _relocate(self):
        ne, b = self.ne, self.ne.b
        for n, (off, ln, flags) in enumerate(ne.segs, start=1):
            if not flags & 0x100 or off == 0:
                continue
            base = self.para[n] << 4
            p = off + ln
            count = struct.unpack_from('<H', b, p)[0]
            p += 2
            for _ in range(count):
                src, kind, at, a, c = struct.unpack_from('<BBHHH', b, p)
                p += 8
                target = kind & 3
                if target == 0:
                    seg = a & 0xff
                    if seg == 0xff:
                        seg, toff = ne.entries[c]
                    else:
                        toff = c
                    tseg, toff = self.para[seg], toff
                elif target in (1, 2):
                    mod = ne.modules[a - 1]
                    name = f'{mod}.{c}' if target == 1 else f'{mod}.name{c}'
                    if name == 'KERNEL.113':   # __AHSHIFT
                        tseg, toff = 0, 12
                    elif name == 'KERNEL.114':  # __AHINCR
                        tseg, toff = 0, 0x1000
                    else:
                        tseg, toff = STUB_PARA, self.import_stub(name)
                else:
                    continue  # OS fixups: the 8087 emulator's interrupts, left as they are
                sites = []
                if kind & 4:
                    sites = [at]
                else:
                    seen = 0
                    while at != 0xffff and at < ln and seen < 10000:
                        sites.append(at)
                        nxt = struct.unpack('<H', self.mu.mem_read(base + at, 2))[0]
                        if src in (0,):
                            nxt = 0xffff
                        at = nxt
                        seen += 1
                for s in sites:
                    self._fix(base + s, src, tseg, toff, bool(kind & 4))

    def _fix(self, addr, src, tseg, toff, additive):
        r = lambda: struct.unpack('<H', self.mu.mem_read(addr, 2))[0]
        if src == 2:      # segment
            v = tseg + (r() if additive else 0)
            self.mu.mem_write(addr, struct.pack('<H', v & 0xffff))
        elif src == 3:    # far pointer
            o = toff + (r() if additive else 0)
            self.mu.mem_write(addr, struct.pack('<HH', o & 0xffff, tseg))
        elif src == 5:    # offset
            o = toff + (r() if additive else 0)
            self.mu.mem_write(addr, struct.pack('<H', o & 0xffff))
        elif src == 0:    # low byte
            self.mu.mem_write(addr, bytes([toff & 0xff]))
        else:
            raise ValueError(f'reloc type {src}')

    # ----------------------------------------------------------------- stubs

    def stub(self, name, handler):
        """A `retf` at a new stub offset; `handler(emu)` runs first."""
        if name in self.stub_by_name:
            return self.stub_by_name[name]
        off = len(self.stubs) * 4
        self.stubs.append((name, handler))
        self.stub_by_name[name] = off
        return off

    def code_stub(self, name, handler, code):
        """A stub that runs `code` (ending in `retf`) after `handler`; from the stub segment's top down."""
        self.code_top = getattr(self, 'code_top', STUB_SIZE) - ((len(code) + 15) & ~15)
        assert self.code_top > len(self.stubs) * 4 + 0x400
        off = self.code_top
        self.mu.mem_write((STUB_PARA << 4) + off, bytes(code))
        self.stubs_at[off] = (name, handler)
        return off

    def code_top_reserve(self, n):
        self.code_top = getattr(self, 'code_top', STUB_SIZE) - ((n + 15) & ~15)
        return self.code_top

    def import_stub(self, name):
        if name in CODE_IMPORTS:
            if name not in self.stub_by_name:
                handler, code = CODE_IMPORTS[name](self)
                self.stub_by_name[name] = self.code_stub(name, handler, code)
            return self.stub_by_name[name]
        return self.stub(name, lambda e, name=name: e._import(name))

    def hook_fn(self, addr, handler, name=None):
        """Redirect E3 function `SSSS:OOOO` (Ghidra address) to `handler(emu)`, a C-convention stub."""
        g, o = (int(x, 16) for x in addr.split(':'))
        off = self.stub(name or addr, handler)
        jmp = bytes([0xea]) + struct.pack('<HH', off, STUB_PARA)
        self.wb(g, o, jmp)

    def _on_stub(self, mu, address, size, _):
        off = address - (STUB_PARA << 4)
        if off in self.stubs_at:
            name, handler = self.stubs_at[off]
            return handler(self)
        if off % 4 or off // 4 >= len(self.stubs):
            return
        name, handler = self.stubs[off // 4]
        handler(self) if not hasattr(handler, '__self__') else handler()

    def _end(self, e=None):
        raise_stop(self)

    def _on_bad(self, mu, access, address, size, value, _):
        print(f'bad memory access {access} at {address:#x} ip={self.where()}', file=sys.stderr)
        return False

    def _on_int(self, mu, intno, _):
        print(f'interrupt {intno:#x} at {self.where()}', file=sys.stderr)
        mu.emu_stop()
        self.failed = f'int {intno:#x}'

    def where(self):
        cs, ip = self.reg(UC_X86_REG_CS), self.reg(UC_X86_REG_IP)
        for n, p in self.para.items():
            if p == cs:
                return f'{gseg(n):04x}:{ip:04x}'
        return f'{cs:04x}:{ip:04x}'

    # -------------------------------------------------------------- the stack

    def reg(self, r):
        return self.mu.reg_read(r)

    def setreg(self, r, v):
        self.mu.reg_write(r, v & 0xffff)

    def arg(self, i):
        """The `i`-th word argument of a far call, at the stub (return address on top)."""
        ss, sp = self.reg(UC_X86_REG_SS), self.reg(UC_X86_REG_SP)
        return struct.unpack('<H', self.mu.mem_read((ss << 4) + ((sp + 4 + 2 * i) & 0xffff), 2))[0]

    def sarg(self, i):
        v = self.arg(i)
        return v - 0x10000 if v & 0x8000 else v

    def ret(self, ax=0, dx=None):
        self.setreg(UC_X86_REG_AX, ax)
        if dx is not None:
            self.setreg(UC_X86_REG_DX, dx)

    def pascal_pop(self, nbytes):
        """Win16 PASCAL: the callee pops its arguments. Move the return address up past them."""
        ss, sp = self.reg(UC_X86_REG_SS), self.reg(UC_X86_REG_SP)
        ra = self.mu.mem_read((ss << 4) + sp, 4)
        sp += nbytes
        self.mu.mem_write((ss << 4) + sp, bytes(ra))
        self.setreg(UC_X86_REG_SP, sp)

    def call(self, addr, *args, limit=200_000_000):
        """Call E3 function `SSSS:OOOO` (C convention, far) with word `args`; returns AX."""
        g, o = (int(x, 16) for x in addr.split(':'))
        ss = self.para[DGROUP]
        sp = 0xfff0
        words = [STUB_PARA, self.end_stub][::-1]
        stack = list(args)[::-1]
        for w in stack:
            sp -= 2
            self.mu.mem_write((ss << 4) + sp, struct.pack('<H', w & 0xffff))
        sp -= 4
        self.mu.mem_write((ss << 4) + sp, struct.pack('<HH', self.end_stub, STUB_PARA))
        for r, v in ((UC_X86_REG_SS, ss), (UC_X86_REG_DS, ss), (UC_X86_REG_ES, ss), (UC_X86_REG_SP, sp),
                     (UC_X86_REG_BP, 0), (UC_X86_REG_SI, 0), (UC_X86_REG_DI, 0)):
            self.setreg(r, v)
        cs = self.para[snum(g)]
        self.setreg(UC_X86_REG_CS, cs)
        self.failed = None
        self.import_calls = 0
        try:
            self.mu.emu_start((cs << 4) + o, (STUB_PARA << 4) + self.end_stub + 1, count=limit)
        except UcError as err:
            raise RuntimeError(f'{err} at {self.where()}') from None
        if self.failed:
            raise RuntimeError(self.failed)
        return self.reg(UC_X86_REG_AX)

    # -------------------------------------------------------------- imports

    def _import(self, name):
        # A loop that waits on Windows (for a click, a key, a message) never
        # ends here: count the calls and give up, naming the loop.
        self.import_calls += 1
        if self.import_calls > IMPORT_LIMIT:
            self.failed = f'stuck: {IMPORT_LIMIT} Windows calls, the last {name} from {self.caller()}'
            self.mu.emu_stop()
            return
        h = IMPORTS.get(name)
        if self.trace_imports:
            print(f'  import {name} from {self.caller()}', file=sys.stderr)
        if h is None:
            self.failed = f'unhandled import {name} from {self.caller()}'
            self.mu.emu_stop()
            return
        h(self)

    def caller(self):
        ss, sp = self.reg(UC_X86_REG_SS), self.reg(UC_X86_REG_SP)
        ip, cs = struct.unpack('<HH', self.mu.mem_read((ss << 4) + sp, 4))
        for n, p in self.para.items():
            if p == cs:
                return f'{gseg(n):04x}:{ip:04x}'
        return f'{cs:04x}:{ip:04x}'


# ------------------------------------------------------------- the game
#
# What a check needs from the game around a handler: a save loaded by E3's
# own `load_file`, the party put on a square, the step taken, and everything
# the player would have seen, in order.

PARTY = 0x1158
PARTY_SIZE = 0x8525
PCS_AT, PC_SIZE = 0x8526, 0x722


class Game(Emu):
    def __init__(self, exe=EXE, answers=(), dice='native'):
        super().__init__(exe)
        self.answers = list(answers)
        # 'native': Borland's rand from `seed`; 'low' / 'high': every roll its
        # least or its most, which the port can be given too (`test/e3emu.test.ts`).
        self.dice = dice
        self.events = []
        self.draws = []
        self.hook_fn('1058:0a12', lambda e: e.ret(1), 'load_bitmap')   # a BMP file: a handle, no pixels
        self.hook_fn('1070:31cd', Game._dialog, 'dialog')
        # The message box every message goes through (`msg`, `msg2` and 21 more).
        self.hook_fn('1008:3b3f', Game._message, 'message')
        self.hook_fn('10d0:4c8d', Game._line, 'line')
        self.hook_fn('1048:004f', Game._get_ran, 'get_ran')

    def text(self, block, i):
        s = self.string(block * 300 + i)
        return None if s is None else s.decode('latin1')

    buttons = {}   # dialog id -> how many buttons it has, for the `last` policy

    def _dialog(self):
        dlg = self.arg(0)
        if self.answers == 'first':
            k = 0
        elif self.answers == 'last':
            k = max(0, self.buttons.get(dlg, 1) - 1)
        else:
            k = self.answers.pop(0) if self.answers else 0
        self.events.append({'kind': 'dialog', 'id': dlg, 'button': k})
        self.ret(k + 1)

    def _message(self):
        """`FUN_1008_3b3f(block, i, block2, j, far title, snd, pic, ...)`: strings `block*300 + i` and, if any, the second."""
        b1, i, b2, j = self.sarg(0), self.sarg(1), self.sarg(2), self.sarg(3)
        title = read_c(self, far(self, 4)).decode('latin1')
        ids, text = [b1, i], [self.text(b1, i)]
        if b2 or j:
            ids += [b2, j]
            text.append(self.text(b2, j))
        ev = {'kind': 'msg', 'id': ids, 'text': text}
        if title:
            ev['title'] = title
        self.events.append(ev)

    def _line(self):
        s = read_c(self, far(self, 0)).decode('latin1')
        self.events.append({'kind': 'line', 'text': s})

    def _get_ran(self):
        times, lo, hi = self.sarg(0), self.sarg(1), self.sarg(2)
        if self.dice == 'low':
            v = times * lo
        elif self.dice == 'high':
            v = times * hi
        else:
            # E3's own: `times` draws of Borland's rand, as `1048:004f` does.
            v = 0
            if hi - lo + 1 != 0:
                for _ in range(times):
                    self.seed = (self.seed * 0x015a4e35 + 1) & 0xffffffff
                    r = (self.seed >> 16) & 0x7fff
                    v += lo + int(math.fmod(r, hi - lo + 1))
        self.draws.append([times, lo, hi, v])
        self.ret(v)

    seed = 1

    # -------------------------------------------------------------- loading

    def load(self, path):
        """E3's `load_file` (`FUN_1040_018e`) on the save at `path`."""
        self.paths['EXILE3.SAV'] = path
        self.call('1040:018e')
        self.events.clear()

    def checkpoint(self):
        """All of memory and the heap's top: what `restore` puts back, much faster than a fresh load."""
        return bytes(self.mu.mem_read(0, MEM_TOP)), self.heap

    def restore(self, cp):
        self.mu.mem_write(0, cp[0])
        self.heap = cp[1]
        self.files.clear()
        self.events.clear()
        self.draws.clear()

    def snapshot(self):
        return {'party': self.rb(PARTY, 0, PARTY_SIZE), 'pcs': self.rb(PARTY, PCS_AT, PC_SIZE * 6)}

    def put_outdoors(self, zone, x, y):
        """The party at (x, y) of `zone`, the 2×2 window around it loaded by E3's `FUN_1040_3677`."""
        zx, zy = zone % 9, zone // 9
        cx, cy = min(zx, 7), min(zy, 8)
        i, j = zx - cx, zy - cy
        self.wb(PARTY, 0x12e2, [cx, cy])
        self.wb(PARTY, 0x12e4, [i, j])
        self.wb(PARTY, 0x12e6, [i * 48 + x, j * 48 + y])
        self.wb(PARTY, 0x12e8, [x, y])
        for a, b in ((1, 1), (0, 1), (1, 0), (0, 0)):
            self.call('1040:3677', cx + a, cy + b, a, b)
        return i * 48 + x, j * 48 + y

    def step_outdoors(self, wx, wy):
        """`FUN_10c0_0c97(loc, 0, 0, &spec)`, what a step outdoors runs: whether the step goes through."""
        out = alloc(self, 16)    # the `&spec` out-parameter
        r = self.call('10c0:0c97', wx | wy << 8, 0, 0, 0, out)
        return r & 0xff


def win(nbytes, result=0):
    def h(e):
        e.ret(result, 0)
        e.pascal_pop(nbytes)
    return h


def raise_stop(e):
    e.mu.emu_stop()


# ------------------------------------------------------------------ imports
#
# Windows calls are PASCAL (the callee pops), and `win16.json` has every one
# the EXE imports, with its name and its arguments' size (from Wine's
# `.spec` files). Anything not given a body below pops its arguments and
# returns 1, which is "it worked" to most of them; drawing, sound and window
# management are all that. What has a body is what the logic reads back:
# files, memory, strings, the clock.

WIN16 = json.load(open(os.path.join(os.path.dirname(__file__), 'win16.json')))


def far(e, i):
    """The far pointer at argument words `i` (offset) and `i + 1` (segment), as (para, off)."""
    return e.arg(i + 1), e.arg(i)


def lin2(p):
    return (p[0] << 4) + p[1]


def read_c(e, p, limit=4096):
    return e.cstr(p[0], p[1], limit)


def write_c(e, p, data):
    e.mu.mem_write(lin2(p), bytes(data) + b'\0')


def host_path(e, name):
    key = os.path.basename(name.replace('\\', '/')).upper()
    if key in e.paths:
        return e.paths[key]
    for f in os.listdir(e.e3dir):
        if f.upper() == key:
            return os.path.join(e.e3dir, f)
    return None


def k_lopen(e):
    name = read_c(e, far(e, 1)).decode('latin1')
    path = host_path(e, name)
    e.pascal_pop(6)
    if not path or not os.path.exists(path):
        e.log.append(('file-missing', name))
        return e.ret(0xffff)
    h = 5 + len(e.files)
    e.files[h] = [bytearray(open(path, 'rb').read()), 0, path, False]
    e.ret(h)


def k_lcreat(e):
    name = read_c(e, far(e, 1)).decode('latin1')
    e.pascal_pop(6)
    h = 5 + len(e.files)
    e.files[h] = [bytearray(), 0, name, True]
    e.log.append(('file-create', name))
    e.ret(h)


def k_lread(e, write=False):
    count, buf, h = e.arg(0), far(e, 1), e.arg(3)
    e.pascal_pop(8)
    f = e.files.get(h)
    if f is None:
        return e.ret(0xffff)
    if write:
        data = bytes(e.mu.mem_read(lin2(buf), count))
        f[0][f[1]:f[1] + count] = data
        f[1] += count
        return e.ret(count)
    data = bytes(f[0][f[1]:f[1] + count])
    f[1] += len(data)
    e.mu.mem_write(lin2(buf), data)
    e.ret(len(data))


def k_llseek(e):
    origin, lo, hi, h = e.arg(0), e.arg(1), e.arg(2), e.arg(3)
    e.pascal_pop(8)
    f = e.files.get(h)
    off = (hi << 16 | lo)
    if off & 0x80000000:
        off -= 1 << 32
    if f is None:
        return e.ret(0xffff, 0xffff)
    f[1] = [0, f[1], len(f[0])][origin] + off
    e.ret(f[1] & 0xffff, f[1] >> 16)


def k_lclose(e):
    h = e.arg(0)
    e.pascal_pop(2)
    f = e.files.pop(h, None)
    if f and f[3]:
        e.written[f[2]] = bytes(f[0])
    e.ret(0)


def alloc(e, nbytes):
    paras = (nbytes + 15) >> 4 or 1
    if e.heap + paras > HEAP_END:
        raise MemoryError('emulated heap is full')
    p = e.heap
    e.heap += paras
    e.mu.mem_write(p << 4, b'\0' * (paras << 4))
    return p


def k_openfile(e):
    style, name = e.arg(0), read_c(e, far(e, 3)).decode('latin1')
    e.pascal_pop(10)
    path = host_path(e, name)
    if style & 0x1000 or not path:   # OF_CREATE, or nothing there
        e.log.append(('openfile', name, style))
        if not path and not style & 0x1000:
            return e.ret(0xffff)
        path = path or name
    h = 5 + len(e.files)
    data = open(path, 'rb').read() if os.path.exists(path) else b''
    e.files[h] = [bytearray(data), 0, path, bool(style & 0x1003)]
    e.ret(h)


def k_globalalloc(e):
    size = e.arg(0) | e.arg(1) << 16
    e.pascal_pop(6)
    e.ret(alloc(e, size))


def k_globallock(e):
    h = e.arg(0)
    e.pascal_pop(2)
    e.ret(0, h)


def gettickcount(e):
    # Every look at the clock is a second later, so a delay loop ends at once.
    e.ticks += 1000
    e.ret(e.ticks & 0xffff, e.ticks >> 16)


def u_loadstring(e):
    mx, buf, sid = e.arg(0), far(e, 1), e.arg(3)
    e.pascal_pop(10)
    s = e.string(sid)
    if s is None:
        write_c(e, buf, b'')
        return e.ret(0)
    s = s[:max(0, mx - 1)]
    write_c(e, buf, s)
    e.ret(len(s))


def getopenfilename(e):
    ofn = far(e, 0)
    e.pascal_pop(4)
    a = lin2(ofn)
    off, seg = struct.unpack('<HH', e.mu.mem_read(a + 24, 4))
    write_c(e, (seg, off), e.open_name.encode('latin1'))
    e.ret(1)


def printf(e, fmt, argw):
    """C's sprintf over the stack words from `argw` on: what E3's format strings use."""
    out, i = bytearray(), 0
    while i < len(fmt):
        c = fmt[i]
        if c != 0x25:
            out.append(c)
            i += 1
            continue
        j = i + 1
        while j < len(fmt) and chr(fmt[j]) in '-+ #0123456789.':
            j += 1
        longf = False
        while j < len(fmt) and chr(fmt[j]) in 'lhNF':
            longf = longf or fmt[j] == ord('l')
            j += 1
        conv = chr(fmt[j])
        spec = fmt[i + 1:j].decode('latin1').replace('l', '').replace('h', '').replace('N', '').replace('F', '')
        spec = ''.join(ch for ch in spec if ch in '-+ #0123456789.')
        if conv == '%':
            out += b'%'
        elif conv in 'dicuxX':
            v = e.arg(argw)
            argw += 1
            if longf:
                v |= e.arg(argw) << 16
                argw += 1
                if conv in 'di' and v & 0x80000000:
                    v -= 1 << 32
            elif conv in 'di' and v & 0x8000:
                v -= 0x10000
            if conv == 'c':
                out += (('%' + spec + 'c') % chr(v & 0xff)).encode('latin1')
            else:
                out += (('%' + spec + {'i': 'd', 'u': 'd'}.get(conv, conv)) % v).encode('latin1')
        elif conv == 's':
            sp = far(e, argw)
            argw += 2
            out += (('%' + spec + 's') % read_c(e, sp).decode('latin1')).encode('latin1')
        else:
            raise ValueError(f'sprintf %{conv}')
        i = j + 1
    return bytes(out)


def rtl_sprintf(e):
    buf, fmt = far(e, 0), far(e, 2)
    s = printf(e, read_c(e, fmt), 4)
    write_c(e, buf, s)
    e.ret(len(s))


def rtl_strcpy(e):
    d, s = far(e, 0), far(e, 2)
    write_c(e, d, read_c(e, s, 65535))
    e.ret(d[1], d[0])


def rtl_strncpy(e):
    d, s, n = far(e, 0), far(e, 2), e.arg(4)
    src = read_c(e, s, n)
    e.mu.mem_write(lin2(d), src + b'\0' * (n - len(src)))
    e.ret(d[1], d[0])


def rtl_strlen(e):
    e.ret(len(read_c(e, far(e, 0), 65535)))


def rtl_strrchr(e):
    s, c = far(e, 0), e.arg(2) & 0xff
    data = read_c(e, s, 65535) + b'\0'
    k = data.rfind(bytes([c]))
    if k < 0:
        return e.ret(0, 0)
    e.ret(s[1] + k, s[0])


def rtl_fmemcpy(e):
    d, s, n = far(e, 0), far(e, 2), e.arg(4)
    e.mu.mem_write(lin2(d), bytes(e.mu.mem_read(lin2(s), n)))
    e.ret(d[1], d[0])


def rtl_farmalloc(e):
    size = e.arg(0) | e.arg(1) << 16
    e.ret(0, alloc(e, size))


def rtl_farcalloc(e):
    size = (e.arg(0) | e.arg(1) << 16) * (e.arg(2) | e.arg(3) << 16)
    e.ret(0, alloc(e, size))


def ret0(e):
    e.ret(0, 0)


def pow_stub(e):
    """`_pow(double, double)`: the result goes back in ST(0), so the stub's code loads it."""
    slot = e.code_top_reserve(8)

    def h(e):
        x, y = struct.unpack('<dd', bytes(e.mu.mem_read((e.reg(UC_X86_REG_SS) << 4) + e.reg(UC_X86_REG_SP) + 4, 16)))
        e.mu.mem_write((STUB_PARA << 4) + slot, struct.pack('<d', math.pow(x, y)))
    # fld qword ptr cs:[slot]; retf
    return h, bytes([0x2e, 0xdd, 0x06]) + struct.pack('<H', slot) + b'\xcb'


CODE_IMPORTS = {'BC450RTL.632': pow_stub}

IMPORTS = {
    'KERNEL.74': k_openfile,
    'KERNEL.85': k_lopen, 'KERNEL.83': k_lcreat, 'KERNEL.82': k_lread,
    'KERNEL.86': lambda e: k_lread(e, write=True), 'KERNEL.84': k_llseek, 'KERNEL.81': k_lclose,
    'KERNEL.15': k_globalalloc, 'KERNEL.18': k_globallock,
    'USER.13': gettickcount, 'USER.15': gettickcount, 'USER.176': u_loadstring, 'COMMDLG.1': getopenfilename,
    'BC450RTL.176': rtl_sprintf, 'BC450RTL.184': rtl_strcpy, 'BC450RTL.197': rtl_strncpy,
    'BC450RTL.193': rtl_strlen, 'BC450RTL.201': rtl_strrchr, 'BC450RTL.371': rtl_fmemcpy,
    'BC450RTL.652': rtl_farmalloc, 'BC450RTL.653': rtl_farcalloc, 'BC450RTL.654': ret0,
    'BC450RTL.95': ret0,
}
# The rest of Windows: pop the arguments, return 1. (PeekMessage: no message.)
ZERO = {'PeekMessage', 'GetMessage', 'IsIconic', 'GetAsyncKeyState', 'GetKeyState', 'GlobalUnlock',
        'GlobalFree', 'ReleaseCapture', 'MessageBeep'}
for _k, _v in WIN16.items():
    if _v is None:
        continue
    _name, _conv, _n = _v
    if _k not in IMPORTS and _conv == 'pascal':
        IMPORTS[_k] = win(_n, 0 if _name in ZERO else 1)
