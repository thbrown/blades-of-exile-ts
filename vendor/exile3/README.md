# Exile III: Ruined World — the original installer

`EXL3INST.EXE` is Spiderweb Software's own download of *Exile III: Ruined
World* for Windows, v1.0, exactly as they distribute it:

- fetched from <http://www.spiderwebsoftware.com/ftp/installers/win/EXL3INST.EXE>
  (linked from <http://www.spiderwebsoftware.com/exile3/winexile3.html>,
  which says "This game is now free to play") on 2026-09-25;
- SHA-256 `1a03ede845ba69cb3fffe75bdfd0c9525a6f2004769d6754ff12fb5e9101e71c`,
  which `tools/e3convert/installer.ts` checks before using it.

**It is not covered by this repository's GPL.** Exile III is copyright 1997
Jeff Vogel / Spiderweb Software, Inc., all rights reserved. It is here under
the licence in its own `GAMEINFO.TXT`:

> The author grants permission for this disk to be copied and distributed, if
> no fee is charged, other than that necessary to make up for duplication and
> distribution expenses. [...] All copies must be unaltered.

So this file is kept complete and unaltered, and nobody may be charged for it.

exile-js never ships a modified copy of the game. The published site serves
this installer as it is (at `exile3/EXL3INST.EXE`, with this README), and
the player's browser converts it the first time Exile III is played, with
the GPL converter in `tools/e3convert/` running in a worker, and keeps the
result locally (`src/platform/exile3.ts`). For development, `npm run dev`
converts it into `public/scenarios/exile3/`, which is never committed and
which the site's build leaves out (`vite.config.ts`, `exile3Installer`).
