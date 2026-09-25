# exile-js

**Play it:** https://thbrown.github.io/exile-js/

A from-scratch TypeScript port of the game player of **Blades of Exile**, Jeff
Vogel's 1997 fantasy role-playing game for Spiderweb Software, running in the
browser. It keeps the original rules, the 605×430 screen and the original
art. Besides the three scenarios the game shipped with, it plays the
community's own: 168 of them from Spiderweb's scenario archive are built in,
and you can add others from their `.zip`, `.exs` or `.boes` files.

> **Built with heavy use of AI.** Most of the code here was written by an AI
> coding assistant (Anthropic's Claude, through Claude Code), directed by a
> person. It is checked against the C++ it ports rather than taken on trust:
> the original game's recorded playthroughs are replayed through both engines
> and compared draw by draw, a legacy scenario is imported by both and compared
> field by field, and every milestone is exercised in a real browser. See
> `PROGRESS.md` for what those checks cover and what they don't.

## Running it

```
npm install
npm run dev          # http://localhost:5199
npx vitest run       # the tests, headless
```

`CLAUDE.md` lists every check, and `PROGRESS.md` and `PLAN.md` hold the state
of the project and its plan.

## Where it comes from

- **Blades of Exile** by Spiderweb Software. The 1997 source release is the
  specification this port follows.
- **Open Blades of Exile**, the community's continuation of that source,
  through a WebAssembly build of it, which is the running reference.
- **The community scenarios** in the library come from
  [Spiderweb's scenario archive](https://www.spiderwebsoftware.com/blades/scen_list.html).
  Each belongs to its author, and each card in the game links to its listing.
  The files are trimmed to the scenario, its graphics and the author's
  documents.

## Licence

exile-js is released under the **GNU General Public License, version 2**
(`LICENSE`), the licence Spiderweb Software released the Blades of Exile source
under. The 1997 release's own `Blades of Exile License.txt` says so, as does
Open Blades of Exile. It is version 2 only: the release names no "or any later
version".

The GPL covers the code, and the Blades of Exile data this repository ships
(graphics, sounds, fonts, dialogs and the bundled scenarios) is taken from Open
Blades of Exile's GPL tree. The GPL does not cover:

- **Community scenarios.** Each belongs to its author. They are fetched from
  the archive by script and never committed.
- **Exile III: Ruined World.** Spiderweb made it freeware in 2013, but its own
  licence allows non-profit redistribution only of the complete, unmodified
  archive. The converted scenario is a modified work, so it stays out of the
  repository (`public/scenarios/exile3/` is ignored) until Spiderweb agrees
  otherwise.
