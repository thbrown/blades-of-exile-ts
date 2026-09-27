# exile-js

**Play it:** https://thbrown.github.io/exile-js/

Dear fellow human,

I regret to inform you that, other than this README letter, this whole project was written by AI. And a particularly jargony verbose AI at that. So probably don't waste your time reading it. However, this repo does, in fact, contain a working javascript port of Spiderweb Software's "Blades of Exile".

I started this project because I really love Exile III and have been looking for a decade for ways to get it to run easily on my PC and, ambitiously, on my phone. I've used VMs, OBVM (or whatever), and a very clunky DOSBOX in the browser over the years to make this happen. These methods are.... meh. Though I'm still grateful that they exist. What I really want is to just click a button and *POOF* there is Exile III like it was in the olden days. 

Of course there has been Blades of Exile, which was open sourced a whole ago. I was pleased to find an itch.io version, but I encountered a few bugs after playing through it for a bit and I really just want to play Exile III again. 

So, when AI actually got good for coding (super early 2026) I decided I was going to try to get all of the open Blades of Exile repo to compile to web assembly (WASM), which, if you don't know, is a way to get programs written in languages like C++ to run in the browser. Then see if there was a way I could scenario-ify exile III given the assets and old 16-bit binary. The WASM bit worked better than I thought it would, but that's not to say it worked well. It was still very glitchy and very buggy. (TODO add link to that here so you can see for yourself). On top off all that, I know precious little about C++ build systems so was mostly flying blind. So I decided no to pursue the Exile III scenarioification. On the other hand, I do know a fair bit about FE web dev...

Then it occurred to me. WASM is so a 2024 way of getting old programs running in a web browser. These days we just dispatch 100 sub-agents to port C++ to javascript and *POOF* there is Exile III like it was in the olden days.

In one very important particular way, this type of project is an ideal case for AI use because it hardly requires a lick of aesthetic creativity. Game originally worked like this, attempt to port it... after port, does it look the same? No? fix it. Yes? Port the next thing.

So, I figured I would attempt a straight up javascript port using AI w/ the WASM build as a reference implementation for comparison. 

With the exception of the main menu, I tried to keep everything identical to how it was in the old game (trying to make smart tradeoffs between OBOE and the original opensourced code).

Now, I have only played a very small part of a few scenarios. So there are some bugs... probably many more than "some bugs". But I hope to squash them, slowly over time, progressively as my Claude 5-hour limit continues to reset.

Right now I'm trying to get Exile III into a BOE scenario. You can see it in the list of scenarios! You can even start playing it! But it doesn't work very well yet. Is it possible to get the whole thing working? Idk, but if there was ever a time when this feat was doable since this game originally came out, it's now. So standby.

I might attempt to port the editor at some point and host some nice cloud bucket for actively sharing/rating new scenarios, but no promises here. It's less likely I will scenario-ify Exile I and Exile II, just because I never played them when I was younger so the nostalgia batteries that are powering this Exile III porting adventure won't work there.

With all that said, please enjoy this work as you will.

Sincerely,

Thomas

---

A from-scratch TypeScript port of the game player of **Blades of Exile**, Jeff
Vogel's 1997 fantasy role-playing game for Spiderweb Software, running in the
browser. It keeps the original rules, the 605×430 screen and the original
art. Besides the three scenarios the game shipped with, it plays the
community's own: 341 of them from the scenario archives are built in, and
you can add others from their `.zip`, `.exs` or `.boes` files.

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

- **Community scenarios.** Each belongs to its author. They are included in
  this repository under fair use (see below), not under the GPL.
- **Exile III: Ruined World.** It is Spiderweb's copyright, and it is not
  GPL. Its own licence (`GAMEINFO.TXT`) allows anyone to redistribute it free
  of charge, **unaltered**. So the repository carries Spiderweb's original
  freeware installer, byte for byte, in `vendor/exile3/` (whose README gives
  its source, checksum and terms). The site serves that installer as it is,
  and your browser converts it with the GPL converter (`tools/e3convert/`)
  the first time you play, keeping the result locally. A converted copy is
  never committed or published.

### Community scenarios: fair use, and removal on request

The community scenarios in the library (`docs/library/`) are included in this
repository and on the site under the fair use doctrine. Copyright in each one
stays with its author. We include them because:

- **The purpose is preservation, and it is non-commercial.** The scenarios are
  free to play here, as they always were. Nothing is sold, and there are no
  ads.
- **They were made to be shared freely.** Their authors released them free of
  charge through public archives. Keeping them playable takes nothing from
  anyone and keeps their work in front of new players.
- **They are unaltered.** Each download is the author's own file as
  published. It is only trimmed to the scenario, its graphics and the
  author's documents, and it is credited with a link to its listing.

The [cboe-scenarios](https://github.com/NQNStudios/cboe-scenarios) archive
takes the same approach.

**If you wrote one of these scenarios and want it removed,** open an issue on
this repository saying which scenario. We will take it out of the library and
purge it from the repository's git history, not just from the current
version. Copies other people have already made (forks, clones, caches) are
out of our hands.

**We have no reliable way to confirm who you are.** Many scenarios were
published under handles, most of the email addresses in them stopped working
long ago, and anyone can open an issue under any name. So we will ask for
something that ties you to the scenario. For example:

- a message from the address given in the scenario's own documents or
  archive listing;
- a post from the Spiderweb forum account the scenario was released or
  discussed under;
- or anything else that reasonably shows you are the author.

We decide in good faith, and we may decline a request we can't connect to the
scenario's author. That applies especially to a single request covering many
scenarios by different authors.

