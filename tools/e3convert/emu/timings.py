#!/usr/bin/env python3
"""
How long EXILE3.EXE's combat animations hold the game, measured by running
its own code, for setting the port's timing knobs (`src/game/anim.ts`,
`booms.ts`, `missileAnim.ts`) against numbers.

    tools/e3convert/emu/.venv/bin/python tools/e3convert/emu/timings.py SAVE

`SAVE` is an in-town save (`E3EMU_SAVES_DIR` keeps the ones `test/e3emu.test.ts`
makes). The clock is virtual: `Delay(n)` (`1048:024c`) adds its 16n ms, a
synchronous sound (`sndPlaySound` without `SND_ASYNC`) adds its WAV's length,
and every other look at the clock adds 1 ms, so a busy-wait on the clock
measures itself. What it can't see is drawing time on the original's
hardware, nor Windows 3.1/95's 55 ms clock tick, which rounds each `Delay`.

Each case prints its total and every wait and sound, in order, at game
speeds 0 to 3 (party+0xc7e; E3's `init_party` sets 1).
"""
import struct
import sys
import os
import wave

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_SP, UC_X86_REG_SS

sys.path.insert(0, os.path.dirname(__file__))
import e3emu  # noqa: E402

SOUNDS = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'public', 'scenarios', 'exile3', 'sounds')


def wav_ms(n):
    try:
        with wave.open(os.path.join(SOUNDS, f'SND{n}.wav')) as w:
            return round(1000 * w.getnframes() / w.getframerate())
    except (OSError, wave.Error):
        return None


def tick(e):
    e.ticks += 1
    e.ret(e.ticks & 0xffff, e.ticks >> 16)


LOG = []
SOUND = [None]   # the sound `force_play_sound` (1030:05a4) was asked for


def snd_play(e):
    flags = e.arg(0)
    n = SOUND[0]
    ms = wav_ms(n) if n is not None and n < 0x8000 else None
    sync = not flags & 1
    LOG.append((e.ticks, f'sound {n if n < 0x8000 else n - 0x10000}', 'sync' if sync else 'async', ms))
    if sync and ms:
        e.ticks += ms
    e.pascal_pop(6)
    e.ret(1)


e3emu.IMPORTS['USER.13'] = tick
e3emu.IMPORTS['USER.15'] = tick
e3emu.IMPORTS['MMSYSTEM.2'] = snd_play


def main():
    g = e3emu.Game()
    g.load(sys.argv[1])

    def delay(e):
        n = e.sarg(0)
        LOG.append((e.ticks, f'Delay({n})', e.caller()))
        e.ticks += 16 * n
    g.hook_fn('1048:024c', delay, 'Delay')

    def on_force(mu, _addr, _size, _):
        sp = (g.reg(UC_X86_REG_SS) << 4) + g.reg(UC_X86_REG_SP)
        SOUND[0] = struct.unpack('<H', mu.mem_read(sp + 4, 2))[0]
    at = (g.para[e3emu.snum(0x1030)] << 4) + 0x5a4
    g.mu.hook_add(UC_HOOK_CODE, on_force, begin=at, end=at)

    cp = g.checkpoint()
    x, y = g.town_loc()

    def boom(sound):
        # boom_space(where, mode, type, damage, sound): 1050:59c2.
        return lambda: g.call('1050:59c2', x | y << 8, 0, 0, 5, sound)

    def missile(steps, sound):
        # do_missile_anim(num_steps, origin, sound): 1098:7034. One missile
        # three squares east; store_missiles at 1138:017c, 10 bytes each.
        def f():
            for i in range(30):
                g.wb(0x1138, 0x17c + 10 * i + 2, struct.pack('<h', -1))
            g.wb(0x1138, 0x17c, bytes([x + 3, y]) + struct.pack('<hhhh', 4, 0, 0, 0))
            g.wb(0x1178, 0x53be, [1])   # have_missile
            g.wb(0x1178, 0x3d59, [1])   # boom_anim_active
            g.call('1098:7034', steps, x | y << 8, sound)
        return f

    def explosion(btype):
        # do_explosion_anim(sound, special_draw): 1098:7a1b. One boom on the
        # party; store_booms at 1138:02a8, 14 bytes each.
        def f():
            for i in range(30):
                g.wb(0x1138, 0x2a8 + 14 * i + 8, struct.pack('<h', -1))
            g.wb(0x1138, 0x2a8, bytes([x, y]) + struct.pack('<hhhhhh', 10, 0, 0, btype, 0, 0))
            g.wb(0x1178, 0x53bf, [1])   # have_boom
            g.wb(0x1178, 0x3d59, [1])
            g.call('1098:7a1b', 5, 0)
        return f

    cases = [
        ('hit, sound type 0 (a sword)', boom(0)),
        ('hit, sound type 6 (the squish)', boom(6)),
        ('missile, 100 steps, sound 12 (an arrow)', missile(100, 12)),
        ('missile, 60 steps, sound 11 (a one-target Fireball)', missile(60, 11)),
        ('explosion, boom type 0 (fire)', explosion(0)),
        ('explosion, boom type 1 (cold)', explosion(1)),
    ]
    for name, fn in cases:
        for speed in range(4):
            g.restore(cp)
            g.wb(e3emu.PARTY, 0xc7e, [speed])
            LOG.clear()
            g.ticks = 0
            fn()
            print(f'{name}, speed {speed}: {g.ticks} ms')
            for entry in LOG:
                print('   ', *entry)


if __name__ == '__main__':
    main()
