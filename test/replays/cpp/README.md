# Replays recorded by the C++ build

Copied verbatim from `../exile-wasm/test/replays`. These are **not** recordings
made by this port: they were made by the desktop game, and running them here is
the point of M8 — a divergence in any rule shows up as the wrong action type at
the first input it changes.

Each one carries its own saved game inline, base64-encoded in `<load_party>`,
so nothing outside this directory is needed but the scenario itself
(`public/scenarios/valleydy`, `.../zakhazi`).

Curated by `scripts/survey-replays.mjs`, which reports how far each of the 97
files the C++ ships gets before hitting an action this port has no handler for.
**These four are the ones that currently run end to end.** The rest stop on a
divergence the driver now detects: a recorded `move` is always one square from
where the party is, so anything further means the two games have drifted apart
and the run says exactly where. Chasing those down one at a time is what M8 is
— 35 of the 97 now stop that way, which is the milestone's remaining work.

Note the recording never states where the party *was*, only where each step was
aimed. A desync is therefore diagnosed by inference: every recorded destination
is one square from the recording's own position, so a run of them pins it.

Adding to this set is the measure of progress on M8: re-run the survey after
teaching the driver an action, and copy in whatever now completes.
