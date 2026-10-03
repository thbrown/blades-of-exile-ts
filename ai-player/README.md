# The AI player

A way to have Claude play Blades of Exile through Claude Code — as an LLM test,
and to find out whether a scenario can actually be finished. The game runs in
a real Chromium window you can watch; Claude plays it through an MCP server
that describes the screen as text and turns its choices into the same key
presses, clicks and button presses a person makes.

Everything lives in this folder. The game itself only carries two small hooks
for it (`__touchHost` and `__pendingSquare` in `src/main.ts`, beside the other
verification hooks).

## Playing

```
cd ai-player
npm install                 # once: the MCP SDK
claude --model haiku        # or sonnet, opus
```

Then ask it to play, for example:

> Start a new game of Valley of Dying Things and play it through to the end.

Claude Code starts the `exile` server from `.mcp.json`. On its first tool call
the server opens a Chromium window on the game, starting `npx vite --port 5199`
from the repo root if nothing is running there. The player's instructions are
`CLAUDE.md` in this folder. `.claude/settings.json` lets it use the game
tools and its own notes without asking, and denies Bash and the web, so it
can't look up a walkthrough. (It could still Read the source with permission.
The instructions ask it not to, and Claude Code asks you first.)

Scenarios it can start: whatever is in `public/scenarios/` (the four BoE
originals, and `exile3` once converted). A `seed` makes the dice repeatable.

## What it leaves behind

- `runs/<time>/actions.jsonl`: every tool call, what it did, and any page
  errors or console errors.
- `runs/<time>/shot-*.png`: every screenshot it took.
- `runs/journal.md` and `runs/findings.md`: its own notes, and the bugs it
  thinks it found.
- `runs/profile/`: the browser profile, which holds the save games, so a
  later session can carry on from the main menu. Its checkpoints are blue
  stars in File → Restore, in that window.

`runs/` is not committed.

## Options

Environment variables for the server (put them in `.mcp.json`'s `env`):

- `EXILE_HEADLESS=1`: no window, for running unattended.
- `EXILE_URL`: another copy of the game (default `http://localhost:5199/`).
- `EXILE_PROFILE`: another profile. Two players at once need two profiles.
  Chromium locks a profile to one window.
- `CHROMIUM_PATH`: a Chromium other than Playwright's.

## Trying the tools without Claude

```
node ai-player/scripts/smoke.mjs      # every tool, headless, on a throwaway profile
node ai-player/scripts/calls.mjs '[["start_game",{"scenario":"valleydy","seed":1}],["move",{"direction":"north-east"}]]'
```

`calls.mjs` runs a list of tool calls and prints what Claude would see.

## How it works

- `server/server.mjs` is the MCP server. It owns the browser (Playwright,
  with a persistent profile), and after every action it waits until the game
  is waiting for the player again: no animation running, no turn being
  resolved, or a dialog up.
- `bridge/bridge.ts` is loaded into the page from the Vite dev server. It
  reads the game through the hooks the page already exposes for verification
  (`__session`, `__univ`, `__dialogs`), and acts through `__touchHost`, the
  phone controls' view of the game: its toolbar, the choices of whatever
  dialog is up, the talk words, and the spell picker. It also works out where
  a map square or an inventory button is on the canvas, for the server's
  mouse. The root `tsconfig.json` includes it, so `npx tsc --noEmit` catches
  an engine change that breaks it.
- The game is pinned to "Game Screen Only" (`DisplayMode` 5) with instant help
  off, in that profile only.
