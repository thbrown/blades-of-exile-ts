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
**These three are the ones that currently run end to end.** The rest are mostly
waiting on `handle_spellcast`, whose spell picker is a dialog and therefore
needs the driver to answer `click_control` against the real dialogxml
definitions — the next slice of this work.

Adding to this set is the measure of progress on M8: re-run the survey after
teaching the driver an action, and copy in whatever now completes.
