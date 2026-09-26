# exile-js

**Play it:** https://thbrown.github.io/exile-js/

Dear fellow human,

I regret to inform you that, other than this README letter, this whole project was written by AI. And a particularly jargony verbose AI at that. So probably don't waste your time reading it. However, this repo does, in fact, contain a working javascript port of Spiderweb Software's "Blades of Exile".

I started this project because I really love Exile III and have been looking for a decade for ways to get it to run easily on my PC and, ambitiously, on my phone. I've used VMs, OBVM (or whatever), and a very clunky DOSBOX in the browser over the years to make this happen. These methods are.... meh. Though I'm still grateful that they exist. What I really want is to just click a button and *POOF* there is Exile III like it was in the olden days. I was pleased to find an itch.io version of Blades of Exile - similar and familiar, but I encountered a few bugs after playing through it for a bit and I really just want to play Exile III again. Also, I'm very passionate about things running only in the browser (No [restaurant|rental_car_company|doorbell|oven|smart_front_door_mat] I don't want to download your app) and one big reason for that is that it works well and it's already installed on [almost] literally every device I (and everyone else) own.

So, when AI actually got good for coding (super early 2026) I tried to get it to port Open Blades Of Exile (or whatever version of it that they still had on github) to web assembly (WASM), which, if you don't know, is a way to get programs written in languages like C++ to run in the browser. It worked better than I thought it would. But it was still bad and very glitchy and buggy. (TODO add link to that here so you can see for yourself). Plus, I know precious little about C++ build systems so was mostly flying blind. On the other hand, I do know a fair bit about web browsers, so I figured I would attempt a straight up javascript port using AI w/ the WASM build as a reference implementation for comparison.

So, in one very important particular way, this project is an ideal case for AI use because it hardly requires a lick of aesthetic creativity. Game originally worked like this, attempt to port it... after port, does it look the same? No? fix it. Yes? Port the next thing.

With the exception of the main menu, I tried to keep everything identical to how it was in the old game (trying to make smart tradeoffs between OBOE and the original opensourced code).

Now, I have only played a very small part of a few scenarios. So there are some bugs... many more than "some bugs". But I hope to squash them, slowly over time, progressively as my Claude 5 hour limit continues to reset.

Right now I'm trying to get Exile III into a BOE scenario. Is it possible? Idk, but if there was ever a time when this feat was doable since this game originally came out, it's now. So standby.

I might attempt to port the editor at some point and host some nice cloud bucket for actively sharing/rating new scenarios, but no promises here. It's less likely I will scenario-ify Exile I and Exile II, just because I have never played them when I was younger so the nostalgia batteries that are powering this Exile III porting adventure won't work there.

With all that said, please enjoy this work as you will.

Sincerely,

Thomas

---

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
  Scenarios missing from it come from
  [Kelandon's archive](https://spiderwebstuff.s3.us-west-1.amazonaws.com/archive/archive.html)
  and [TrueSite for Blades](https://truesite4blades.nethergate.net/), and
  forum scores come from the Spiderweb forums'
  [review board](https://spiderwebforums.ipbhost.com/forum/26-blades-of-exile-scenario-reviews/).
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
- **Exile III: Ruined World.** It is Spiderweb's copyright, and it is not
  GPL. Its own licence (`GAMEINFO.TXT`) allows anyone to redistribute it free
  of charge, **unaltered**. So the repository carries Spiderweb's original
  freeware installer, byte for byte, in `vendor/exile3/` (whose README gives
  its source, checksum and terms). The GPL converter in `tools/e3convert/`
  turns it into a scenario when you run `npm run dev`; the converted copy is
  generated, never committed, and left out of the published site.
