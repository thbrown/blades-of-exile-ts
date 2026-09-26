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

exile-js never ships a modified copy of the game. `tools/e3convert/` (GPL)
unpacks this installer and converts it into a scenario on the developer's
machine (`npm run dev` runs `tools/e3convert/ensure.ts`); the result,
`public/scenarios/exile3/`, is generated and never committed, and the
published site's build leaves it out (`vite.config.ts`, `withholdExile3`).
Offering Exile III on the published site means converting in the player's
browser from this installer, which the site may serve as it is.
