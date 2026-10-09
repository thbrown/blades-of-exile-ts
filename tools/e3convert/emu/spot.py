#!/usr/bin/env python3
"""
Runs Exile III's own step-on handler for a list of squares, for
`test/e3emu.test.ts` to hold the converted scripts against.

    python3 tools/e3convert/emu/spot.py < cases.json > results.json

A case is `{"save": path, "zone": z, "x": x, "y": y, "answers": [button, ...]}`:
the save loaded by E3's `load_file`, the party put on (x, y) of outdoor zone
`z`, and the step that E3's `FUN_10c0_0c97` takes there. `answers` are the
buttons pressed, in order, 0 for a dialog's first; past the end it's 0. Or
`first` or `last`, for every dialog's first or last button: the input is then
`{"dialogButtons": {id: count}, "cases": [...]}`, the counts from the
converter's `debug.json`.
`visits` (default 1) is how many times the step is taken.
`dice` is `low` or `high` (every roll its least or its most) or `native`
(Borland's `rand` from `seed`).

A result is what the player saw (`events`), every `get_ran` asked and what it
gave (`draws`, as `[times, min, max, value]`), whether the step went through
(`moved`), and the party record and the PCs before and after (base64), so the
caller can see what changed.
"""
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import e3emu  # noqa: E402


def b64(b):
    return base64.b64encode(b).decode('ascii')


GAME = None
LOADED = {}   # save path -> checkpoint


def run(case):
    global GAME
    if GAME is None:
        GAME = e3emu.Game()
    g = GAME
    with open(case['save'], 'rb') as f:
        if f.read(2) != b'\x9e\x16':   # 5790, E3's "saved outdoors"
            raise SystemExit(f"{case['save']} is saved in town: use an outdoor save")
    if case['save'] not in LOADED:
        g.load(case['save'])
        LOADED[case['save']] = g.checkpoint()
    g.restore(LOADED[case['save']])
    a = case.get('answers', [])
    g.answers = a if isinstance(a, str) else list(a)
    g.dice = case.get('dice', 'native')
    g.seed = case.get('seed', 1)
    w = g.put_outdoors(case['zone'], case['x'], case['y'])
    g.events.clear()
    g.draws.clear()
    before = g.snapshot()
    moved, error = None, None
    try:
        # Twice: what a spot leaves behind (a flag, a spot taken off the map)
        # shows on the second visit.
        for visit in range(case.get('visits', 1)):
            if visit:
                g.events.append({'kind': 'visit'})
            moved = g.step_outdoors(*w)
    except RuntimeError as err:
        error = str(err)
    after = g.snapshot()
    return {
        'events': list(g.events), 'draws': list(g.draws), 'moved': moved, 'error': error,
        'answersLeft': len(g.answers) if isinstance(g.answers, list) else 0,
        'before': {k: b64(v) for k, v in before.items()},
        'after': {k: b64(v) for k, v in after.items()},
    }


def main():
    data = json.load(sys.stdin)
    cases = data['cases'] if isinstance(data, dict) else data
    if isinstance(data, dict):
        e3emu.Game.buttons = {int(k): v for k, v in data.get('dialogButtons', {}).items()}
    out = []
    for i, c in enumerate(cases):
        print(f'{i + 1}/{len(cases)} zone {c["zone"]} ({c["x"]},{c["y"]})', file=sys.stderr)
        out.append(run(c))
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
