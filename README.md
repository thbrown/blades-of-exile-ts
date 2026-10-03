## What is this?

An AI TypeScript port of the game player of [**Blades of Exile**](https://en.wikipedia.org/wiki/Blades_of_Exile), Jeff Vogel's 1997 fantasy role-playing game for Spiderweb Software, running in the browser. It keeps the original rules, the 605x430 screen and the original art. Besides the three scenarios the game shipped with, it also includes over 300 publicly available community-written scenarios, and you can add others from their `.zip`, `.exs` or `.boes` files.

This port also includes "Exile III: Ruined World" as a custom scenario. Stitched together from the 16-bit windows binary, the "Blades of Exile" original source code, and Open Blades of Exile. Plus a lot of guidance from me comparing it with the original game running in [OTVDM](https://github.com/otya128/winevdm). There are many bugs, It's still a work in progress.

This port also ships with a customizable mobile-device overlay under togglable "View" menu.

<img width="1466" height="690" alt="image" src="https://github.com/user-attachments/assets/69caf09c-8e53-4112-acc4-84ff43ffe9a3" />

## Try it
https://thbrown.github.io/blades-of-exile-ts/

It installs as an app (your browser's "Install" or "Add to Home Screen") and plays offline once it has loaded. Scenarios from the library work offline after you've installed them.

Also some utility pages to help me dev:
[Map](https://thbrown.github.io/blades-of-exile-ts/exile3/map#valorim@168.0,240.0,0.061)
[Items](https://thbrown.github.io/blades-of-exile-ts/exile3/items)

## A Letter from a Human

Dear Fellow Human,

I regret to inform you that, other than the top portion of this README, nearly this whole project was written by AI. And a particularly jargony verbose AI at that. So probably don't waste your time reading it. However, this repo does, in fact, contain a working typescript port of Spiderweb Software's "Blades of Exile".

I started this project because I really love Exile III. If you're reading this, you probably already know that the [original version of this game](https://www.spiderwebsoftware.com/exile3/winexile3.html) is now free to play but wont run on modern windows or mac operating systems. I have been looking for a decade+ for ways to get it to run easily on my PC and, ambitiously, on my phone. I've used [VirtualBox](https://www.virtualbox.org), [OTVDM](https://github.com/otya128/winevdm), and a very clunky [DOSBOX](https://archive.org/details/exile3_ruined_world) in the browser over the years to make this happen. These methods are.... meh. Though I'm still grateful that they exist. What I really want is to just click a button and *POOF* there is Exile III like it was in the olden days. 

Of course there has been Blades of Exile, which [was open sourced a whole ago](https://www.spiderwebsoftware.com/blades/opensource.html) (now it lives at https://codeberg.org/OpenBoE/oboe). I was pleased to find an [itch.io](https://nqn.itch.io/blades-of-exile) version, but I encountered a few bugs after playing through it for a bit and I really just want to play Exile III again. 

So, when AI actually got good for coding (super early 2026) I decided I was going to try to get all of the open Blades of Exile repo to compile to web assembly (WASM), which, if you don't know, is a way to get programs written in languages like C++ to run in the browser. The plan was to then see if there was a way I could scenario-ify Exile III given the assets and old 16-bit binary. The WASM bit worked better than I thought it would, but that's not to say it worked well. [Repo](https://github.com/thbrown/exile-wasm) [Play](https://thbrown.github.io/exile-wasm/). Also, it seems, [I wasn't the only one with this idea](https://spiderwebforums.ipbhost.com/topic/34030-oboe-playable-in-the-browser-via-enscriptenwasm/) [Repo](https://github.com/mtstanfield/blades-of-exile-web) [Play](https://mtstanfield.github.io/blades-of-exile-web/). 

I had the same problem with the corners!

<img width="520" height="456" alt="image" src="https://github.com/user-attachments/assets/018d539e-f927-401b-9023-149626bd102a" />

Both of these implementations are way too buggy to really enjoy.

On top off all that, I know precious little about C++ build systems so was mostly flying blind. So, I decided not to pursue the Exile III scenarioification. On the other hand, I do know a fair bit about FE web dev...

Then it occurred to me. WASM is such a 2024 way of getting old programs running in a web browser. These days we just dispatch 100 sub-agents to port C++ to javascript and *POOF* there is Exile III like it was in the olden days.

In one very important particular way, this type of project is an ideal case for AI use because it hardly requires a lick of aesthetic creativity. Game originally worked like this: attempt to port it... after port, does it look the same? No? fix it. Yes? Port the next thing.

So, I figured I would attempt a straight up javascript/typescript port using AI w/ the WASM build as a reference implementation for comparison. 

With the exception of the main menu (and the mobile overlay), I tried to keep everything identical to how it was in the old game (trying to make smart tradeoffs between OBOE and the original opensourced code).

Now, I have only played a very small part of a few scenarios. So are probably many bugs that I have yet to encounter. But I hope to squash them, slowly over time, progressively as my Claude 5-hour limit continues to reset.

Right now, I'm trying to get Exile III into a BOE scenario. You can see it in the list of scenarios! You can even start playing it! But it doesn't work very well yet. Is it possible to get the whole thing working? Idk, but it's looking increasingly probable and if there was ever a time that this feat was do-able since this game originally came out, it's now. So standby.

I might attempt to port the editor at some point and host some nice cloud bucket for actively sharing/rating new scenarios, but no promises here. It's less likely I will scenario-ify Exile I and Exile II, just because I never played them when I was younger so the nostalgia batteries that are powering this Exile III porting adventure won't work there.

Sincerely,

Thomas

---

## Progress, and how to help

The port runs, but **it needs play-testing**, Exile III above all. It has
only been played through in pieces, and a lot of it has been read out of the
old binary without anyone checking it in play. Nearly every remaining bug is
the kind you only find by playing.

### What needs testing

- **Exile III, start to finish.** Anything that plays differently from the
  original counts: a quest that won't finish, a door that won't open, a
  monster or shop that isn't the same, text that's wrong.
- **The open questions in [`E3-CHECK-IN-ORIGINAL.md`](E3-CHECK-IN-ORIGINAL.md).**
  Each one is something the port couldn't settle by reading the original's
  code, and it says where to go, what to do and what the port does now. Each
  question has its own saved game for the *original* Exile III (`Q01.SAV`
  to `Q27.SAV`): a strong party with the question's story flags and items
  set, standing next to the place to look. They're made from the original's
  installer in `vendor/exile3/`, so they're not committed. To make them:

  ```
  npm install
  npm run e3            # unpacks and converts Exile III into e3data/
  E3_CHECK_SAVES=e3data/check-saves npx vitest run test/e3checkSaves.test.ts
  ```

  That writes the saves to `e3data/check-saves/`, with a `README.TXT` saying
  what each one is for. Copy one over the original's `exile3.sav` (the
  original runs under [OTVDM](https://github.com/otya128/winevdm)) and load
  it there. The port loads the same file too (**File → Open Game… → Import a file…**),
  so you can compare the two.
- **The community scenarios and the three that shipped with Blades of
  Exile.** They're less likely to break than Exile III, but they haven't been
  played much either.
- **The touch controls** on a phone or tablet (View menu).

### Reporting what you find

The best way to help is to play, then
[open an issue](https://github.com/thbrown/blades-of-exile-ts/issues) that
says:

- what happened, and what you expected to happen;
- where you were and what you did just before;
- ideally, **a saved game that shows it**. For a difference from the
  original, the most useful thing of all is an `exile3.sav` that shows the
  difference in *both* the original Exile III and the port. **File → Export
  as Exile III Save…** in the port writes one from where you're standing,
  and both games can load it.

Answers to the questions in `E3-CHECK-IN-ORIGINAL.md` are welcome as issues
too, even "it does the same thing as the port."

## Running it

```
npm install
npm run dev          # http://localhost:5199
npx vitest run       # the tests, headless
```

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

blades-of-exile-ts is released under the **GNU General Public License, version 2**
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
stays with its author. I include them because:

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
this repository saying which scenario. I will take it out of the library and
purge it from the repository's git history, not just from the current
version. Copies other people have already made (forks, clones, caches) are
out of our hands.

**I have no reliable way to confirm who you are.** Many scenarios were
published under handles, most of the email addresses in them stopped working
long ago, and anyone can open an issue under any name. So I will ask for
something that ties you to the scenario. For example:

- a message from the address given in the scenario's own documents or
  archive listing;
- a post from the Spiderweb forum account the scenario was released or
  discussed under;
- or anything else that reasonably shows you are the author.

I'll attempt to decide in good faith, and may decline a request I can't 
connect to the scenario's author. That applies especially to a single request 
covering many scenarios by different authors.