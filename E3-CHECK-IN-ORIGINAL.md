# Questions to check in the original Exile III

Things the port can't settle by reading EXILE3.EXE, or that were read but
never seen in play. Each entry says where to go, what to do, and what the
port does now, so the answer can be compared directly. When one is answered,
write the answer under it with the date, and fix or confirm the port. Then
move the entry to "Answered" at the bottom.

Coordinates are town squares (x, y), as the port's debug panel
(`?scenario=exile3&debug=1`) and the walkthroughs give them.

**Saved games for the original** (2026-09-30): `E3_CHECK_SAVES=e3data/check-saves
npx vitest run test/e3checkSaves.test.ts` writes one `exile3.sav` per
question, `Q01.SAV` to `Q29.SAV` and `Q32.SAV` (#3 has ten, `Q03A`–`Q03J`; #2 shares `Q01`; #26, #28, #30 and #31 need none), and a
`README.TXT` saying what each holds and where to walk. Each has a strong
party (every spell E3 sells, and Major Blessing) with the question's flags
and items set, standing in the town by the place to look (2026-10-01), or
outdoors where the question is about getting there.
Add a recipe there when adding a question. (`File > Export as Exile III
Save…` in the port writes one from any game, outdoors.)

## Open

### 2. Move Mountains: which rubble? (2026-09-30)

- **Where:** anywhere a stone, basalt or adobe wall (plain, cracked or
  moldy) can be seen. The Colchis wall at (36,40) is one.
- **Do:** cast Move Mountains on it: once on the surface with grass in
  view, and once underground.
- **The port:** the wall becomes rubble, cave rubble underground and
  surface rubble on the surface. E3 picks between them by the ground its
  terrain drawing last saw (`DS:3dd2`), and the port assumes the order it
  draws the 9×9 view in. That only matters on a view holding both grass
  and cave floor.
- **Question:** is the rubble picture the one you'd expect in each place?
  And do any walls *not* crumble that you'd expect to? The list is 111–113,
  128–130 and 143–145.

### 3. Ritual of Sanctification's special squares (2026-09-30)

E3's cast handler for the ritual (`FUN_10b0_682f`) has a case for each
square below and says "Nothing happens." everywhere else. All are ported
now (`tools/e3convert/towns/sanctify.ts`). For each one, cast the ritual
on the square and note what's shown and what changes (a door, a creature,
an item, a message):

| Town | Square | What the code seems to do |
|---|---|---|
| Goblin Lair (44) | (44,2) | a message |
| Bandit Hideout (45) | (22,2) | a message |
| Agate Tower (46) | (12,19) | a message and a reward, once (flag 0x253) |
| Shayder (4–7) | (20,14) | a message, and something reset on all six PCs |
| Friendly, Happy Spiders (48) | (11,15) | a message, a reward and a group. It tests its flag (0x26c) for 0 and then sets it to 0 again, so it may repeat (an E3 bug?) |
| Lair of the Ursagi (51) | (43,3) and (43,4) | a message |
| Troglo Temple L2 (101) | (25,13) | changes three things, a two-part message, a group appears, once |
| Troglo Temple L2 (101) | (28,25) | a group appears, a message, once |
| Castle Troglo (28) | (14,38) | a message, once |
| Under Castle Troglo (29) | (7,56) | a message, once |
| Monastery of Madness (78) | (24,5) | a message |
| The Great Circle (62) | (23,24) | a long script, once: it counts something across the party and ends one of two ways |

Most useful: the Troglo Temple, which looks like a quest step.

**Partly answered 2026-10-01 (with `Q03D`, `Q03E` and `Q03J`), and the port
already matched all three:**
- **Shayder:** "This was a horrible, horrible mistake..." and the game
  ends.
- **The spiders:** "You cast the spell, and easily disrupt..." and a demon
  appears. Cast again: the same message, but no demon. So the flag bug
  repeats the message and the experience, not the demon, because
  `FUN_1090_4053` only brings in creatures that are still absent.
  E3-SUSPECTED-BUGS.md #18 is corrected. Test: `e3quests.test.ts`, "The
  Ritual elsewhere, as the original answered".
- **The Great Circle:** "Dazed, you raise your blade..." It doesn't repeat.

Still open: the other nine squares.

### 4. The Slime Pit's pedestal before any button is pressed (2026-09-30)

- **Where:** the Slime Pit (town 22), level 1. Don't touch the pedestal
  at (32,30).
- **Do:** take the stairs down at (2,60), the far west ones, to level 2,
  and see whether the portcullis just past the stairs is open.
- **The port:** it's open. The pedestal's "last pressed" starts at 0,
  which is the first button's (control 5, the bottom-left one on the
  panel) portcullis.
- **Question:** is the first way down open from the start in the original?

### 6. The Anama: does learning Mage Spells again throw a member out? (2026-09-30)

- **Where:** anywhere a trainer sells skills, after joining the Anama
  (Ahonar in Shayder, "join", once three priests have heard a yes).
- **Do:** raise a PC's Mage Spells skill at a trainer; then go back to
  Shayder's temple and try the members-only doors and the altar.
- **The port:** nothing happens. Joining sets Mage Spells to 0 and the
  flag 0xac to 3, and the only way the port knows to lose membership is
  walking through the upper temple's treasure barrier (0xac to 2, and
  Shayder turns hostile). Tuxedo Jack's walkthrough says a member can
  leave "by either increasing your Mage Skill or robbing their temple".
  No E3 message about it has turned up, and the trainer's code wasn't
  checked for it.
- **Question:** can a member train Mage Spells at all, and does it end
  the membership (or make Shayder hostile)?

### 7. King Vothkaro's question (2026-09-30)

- **Where:** Castle Troglo, the throne room, after the cell door opens
  the second time.
- **Do:** talk to Vothkaro. When he asks "Have you read the scroll I left
  you?", answer the button that isn't Yes.
- **The port:** a line of text and no conversation (`FUN_1020_1484`,
  `1020:14bf`); asked again later, the same question. Yes moves the
  story on and the conversation opens.
- **Question:** is that what happens? And does he ask at all once the
  story has passed that point?

### 8. The giants' rune panel (2026-09-30)

- **Where:** the lower Caves of the Giants, the rune behind the padlocked
  door (about (50,23)).
- **Do:** press the two buttons at the bottom left of the ring, then the
  two on the right. Note whether all seven runes light and the door
  opens. Then try Tuxedo Jack's 7, 5, 6, 2, 4, 6 and note which buttons
  his numbers mean.
- **The port:** the engine's prompt can only name the buttons, so it
  names them by where they sit in E3's ring (bottom, lower left, upper
  left, top, upper right, lower right, bottom right). Walkthrough A's
  order lights all seven; Tuxedo Jack's numbers do too, but only read as
  some other numbering of the same seven buttons.
- **Since 2026-10-07** the port draws E3's panel itself, buttons where the
  dialog puts them and each lit rune's name (Glah, Frag, …) in its box, so
  the positions are no longer the port's words.
- **Question:** do the runes' names light in the same boxes as in the port?

### 9. The Concealed Tunnel's moving walls (2026-09-30)

- **Where:** the Concealed Tunnel, past the barrels' barrier.
- **Do:** stand in a wall's path with room behind you, then with a wall
  behind you; and stand a creature (a summoned one will do) in a wall's
  path.
- **The port:** a wall that reaches the party carries it a square; one
  that would carry it into a wall kills the whole party ("…raspberry
  jam"), or in a fight only the PC it reached. A wall goes straight over
  a creature ahead of it (E3-SUSPECTED-BUGS.md #19).
- **Question:** is that what happens, and does a creature stop a wall?

### 10. The Barrier Cavern's crystal (2026-09-30)

- **Where:** the Barrier Cavern, the crystal on its pedestal.
- **Do:** smash it, and look at the two great barriers before leaving.
- **The port:** they vanish at once. (Until today they stayed up until
  the party came back into the cavern, a converter bug.)
- **Question:** do they vanish at once in the original?

### 11. The giants' four prisoners (2026-09-30)

- **Where:** the upper Caves of the Giants, after finding the concealed
  way out.
- **Do:** ask each of the four prisoners about "escape", two men and two
  women.
- **The port:** all four go. The women have no words of their own; E3's
  talk nodes carry a second personality in their last field, and the
  men's "escape" names theirs. Until today the port read only the first,
  so the women couldn't be freed and Bruskrud's last two rewards were
  out of reach.
- **Question:** do the women answer "escape" in the original?

### 12. Zalifar and the spire, before the drake (2026-09-30)

- **Where:** the Remote Aerie, north-east of Gale (fly east from (315,106)).
- **Do:** before going near the drake, ask Zalifar about "spire".
- **The port:** he tells where the golems' spire is and it goes on the
  map, as E3's talk data says; "assistance" is the only answer that waits
  for the drake.
- **Question:** does the original answer "spire" straight away?

### 13. The spires' barrier rings (2026-09-30)

- **Where:** any of the four golem spires round the Tower of Shifting
  Floors.
- **Do:** walk round the ring of barriers before dispelling anything.
- **The port:** one diagonal side of each ring is missing (a town holds 50
  preset fields; a ring needs 56), so the party can walk in
  (E3-SUSPECTED-BUGS.md #20).
- **Question:** is there a gap in the ring in the original?

### 14. Killing Dalakros (2026-09-30)

- **Where:** the Drake Aerie, south-west of Greendale.
- **Do:** refuse him the food, kill him, and ask Zalifar about
  "assistance".
- **The port:** Zalifar helps. His answer waits on the flag the drake sets
  when the party swears; E3's turn code copies the drake's death into it
  (`10c0:6fb8`), which the port does as he dies. Until today killing him
  left Zalifar asking for help with the drake.
- **Question:** does Zalifar help right away, or only a turn later?

### 15. Flying (2026-09-30)

- **Where:** anywhere outdoors, with the Orb of Thralni.
- **Do:** fly and come down on lava; try the orb in the far north
  (zone columns 1–2 of the top rows) and in a boat.
- **The port:** lava burns everyone (8d10) and doesn't kill; the far north
  says "Use orb: For some reason, it fails."; a boat says "Use: Leave boat
  first." Until today no special item could be Used and nothing could fly.
- **Question:** do those match, and does the orb's flight last six moves?

### 16. Leaving the fortress under Tinraya (2026-09-30)

- **Where:** the Keep of Tinraya (Footracer Province, (78,63)), down its
  stairs, through the cell and the Crystal Souls, and out by the west side
  of the level below.
- **The port:** the party comes out at (72,63), beside the lower level's own
  entrance, west of the keep. Until today it came out on the keep's own
  doorstep and walked straight back in: the converter dropped each town's
  four exit squares (E3's town record `0x0be`, read by its end_town_mode).
- **Question:** does the original put you west of the keep, by the lava?

### 17. The rune doors under Tinraya (2026-09-30)

- **Where:** the rune-covered doors at (28,7) and (12,32) of the level
  under the keep.
- **The port:** the converted terrain is a locked door, so a party without
  the Murder Cave's key (or the Vahnatai key) can still pick it or cast
  Unlock on it.
- **Question:** can you get through without the key in the original?

### 18. Fort Emergence's little cell (2026-09-30)

- **Where:** Fort Emergence, the far southwest corner: the secret door at
  (2,58) and the two squares behind it, (1,59) and (2,59).
- **Do:** walk into the cell.
- **Why:** E3's code tests a town's edge rectangle with x and y swapped
  (E3-SUSPECTED-BUGS.md #21); read that way, the cell is outside the town.
- **The port:** an ordinary dead end.
- **Question:** does walking in put you outside the fort?

### 19. Rentar-Ihrno's panel (2026-09-30)

- **Where:** her pedestal in the Keep of Rentar-Ihrno, with every lever
  below pulled.
- **Do:** press Begin Process first, before Release Slime Compounds.
- **The port:** the controls beep and, since 2026-10-07, the panel stays
  open, as E3's code (`FUN_1008_51e5`) keeps it.
- **Question:** does the panel stay up, and does anything else happen?

### 20. The Lair of Drakos's shifting floor (2026-09-30)

- **Where:** the Lair of Drakos, level 1 (the island east of Kneece): the
  floor of pillars at x 19–25, y 26–28, with the squares that shift it
  along y 29 and the two that reset it at (21,30) and (23,30).
- **Do:** from (21,30), walkthrough A's moves: northwest, west, east, west,
  east four times, west, east, then north.
- **Why:** E3's code (`1088:3651` on) shifts row 28 left, row 27 right and
  row 26 left. Read that way, A's moves leave the gaps at x 22, 20 and 22,
  and the last north is blocked; turning every row the other way would make
  them line up at x 23. The port follows the code.
- **The port:** A's moves don't get through. Northwest, east, east, east,
  west, east, west, east, east, west, then north, northwest, northeast and
  north does, and comes out at (23,25), beside walkthrough B's (22,25).
- **Question:** do A's moves open the way north? If they do, which way
  does each row move as you step along y 29?

### 21. The way back across the Pit of the Wyrm's floor (2026-10-01)

- **Where:** the Pit of the Wyrm, level 2: the floor room past the door at
  (15,42) (the lever behind the southernmost crypt door makes it), a grid
  at x 16–21, y 40–42, with the bier's door at (21,39).
- **Do:** cross by walkthrough A's moves (east, north, north, east, south,
  east, south, east, east, north, north, east, north). Then come back by
  A's "start at (21,39)": south, west, south, west, west, north, west,
  south, west, south.
- **Why:** each square stepped on charges the whole grid and makes only its
  own few neighbours safe (`1088:454c` on), so the square the party last
  stood on is charged. After the crossing that is (21,40), right below the
  bier's door.
- **The port:** A's way across works, as does B's ("right, up, up, …").
  A's first step back, south onto (21,40), zaps ("bolts of lightning") and
  the party stays put. A's second, west, is a wall. Southwest onto (20,40)
  is safe, and from there A's moves after its first two take the party
  back to the door.
- **Question:** does south from the bier's door zap in the original too?
  (A throw, which the port gives for stepping on (19,40), (21,41) or
  (17,42) when they're safe, makes (21,40) safe again.)

### 22. Walking to the Pit of the Wyrm (2026-10-01)

- **Where:** east of Bremerton. The Pit's entrance is at (261,130) of the
  world map, the walkthroughs' coordinates.
- **Do:** without flying, go north round the lake by the bridge at
  (227,129), east through the hills, then west through the mountains at
  (273,129) and (272,129), and again at (261,127) and (260,127).
- **Why:** those four mountain squares carry E3's spot 50, the "way
  through" that lets the party step onto Delan's ford. Both walkthroughs fly
  the rivers instead.
- **The port:** lets the party through all four, so the Pit can be walked
  to.
- **Question:** are they passes in the original too?

### 23. The Remote Cave's crate (2026-10-01)

- **Where:** the Remote Cave (town 72), west of (57,68), in the room of
  chasms past the door at (15,1). Three crates stand at (1,18), (2,18)
  and (3,18).
- **Do:** walkthrough A's moves from (3,17): S, N ×15, NW, E ×7, NE, then
  "south two". Then its step 8, SW.
- **Why:** walking into a crate that can't move on swaps it with the party
  (the first S does this, putting the crate at (3,17)). In the port A's
  "south two" leaves the crate at (10,4) with the party at (10,3), and A's
  SW then runs into the chasm. Walkthrough B starts its own list from
  exactly there ("at 10,3 with a crate one square south") with an extra S
  first; with that S, A's remaining moves put the crate on the rune at
  (13,2), as the test (`the Black Halberd`) does.
- **The port:** needs three Ss at A's step 7.
- **Question:** in the original, does A's "south two" work as written (so
  the port pushes or swaps differently), or is A one S short?

### 24. Foxfire's key and the Monastery of Madness (2026-10-01)

- **Where:** Foxfire the bard, in Bengaro, Poulsbo or Malloc (a different
  one each day), and the Monastery of Madness at (331,463) on the
  southernmost Remote Isle.
- **Do:** before buying her key, cross to that isle (Storm Port's ferry,
  the boat people at (306,440) and (312,451), the stones east of (308,464))
  and walk north into the monastery's square. Then buy the key ("payment",
  500 gold) and try again.
- **Why:** nothing in E3's scripts reveals the monastery; its turn code
  shows it every turn the key is held (`10c0:69ff`).
- **The port:** the monastery is hidden (the party walks onto the square
  and stays outdoors) until a turn after the key is bought.
- **Question:** is it the same in the original: no way in without the key,
  and on the map as soon as it is bought?

### 25. The Tower of Zkal: its drain, and Zkal's death (2026-10-01)

- **Where:** the Tower of Zkal, at (295,271) of the world map, the south
  end of the undead island below Gale.
- **Do:** walk in, note a PC's spell points, and wait (Space) ten turns,
  then start a fight in the tower and watch them over ten rounds. Later, on
  level 2, kill Zkal (the Lich in the room past the lever room) and go back
  through the tunnels.
- **Why:** E3's per-turn code takes 5 spell points from every PC on each
  turn whose age is a multiple of 5 (`10c0:7100`), in town or in a fight
  there, and the port now does the same (DIVERGENCES.md #38). Walkthrough
  B says killing Zkal "spawned a crapload of undead all over the tunnels";
  E3's kill code for him shows a dialog, gives 20 experience and sets a
  flag nothing reads (`10c0:564c`), and the port does only that.
- **The port:** 5 points every fifth turn, down to 0; nothing new appears
  when Zkal dies.
- **Question:** is the drain 5 every fifth turn, and in a fight too? Do
  undead appear after Zkal's death, or does B mean the tower's own
  wanderers?

### 26. The intro movie's look and pace (2026-10-01)

- **Where:** the title screen, **Intro** (or New Game); no save needed.
- **Do:** watch the whole of "Exile (verb) - ..." through to "Good luck.",
  timing it, and take a screenshot or two: one during the history, one
  during the battle.
- **Why:** the script was read from the EXE (`1098:3148`) and plays the
  same frames, but three things depend on the running game: the pace (the
  port waits 48 × 16 ms between frames, as `0e09`'s `Delay`s add up, and
  missiles and explosions take their 1997 times), what fills the window
  around the picture (the port tiles the game's background pattern; E3's
  `FUN_1058_1695` takes its pattern from a stack slot nobody set), and the
  caption font (the port uses its bold face at 10 pixels).
- **The port:** about three and a half minutes from the first line to
  "Good luck.", on the background pattern, the picture centred 30 pixels up.
- **Question:** how long does it take? What is behind the picture? Do the
  captions look like the port's? And at launch: are the logo (3 s) and the
  adventurers (5 s) on black, the logo a little above centre?

### 27. Colchis: when do the slimes first notice you? (2026-10-01)

- **Where:** Colchis (town 125), walked into from the world by its
  **north** gate: outdoors (10,29) of zone (3,9), stepping south. Use a
  party that has never seen a slime, so "This is very odd..." comes up.
- **Do:** walk in, read the message, then take one step. Note whether
  "Monster saw you!" (and the growl) comes on the move that entered the
  town or only after the step. Try it four or five times from the same
  save.
- **The port:** the message comes up on arrival, as it does in E3, and the
  monsters then get a turn on that same move. The disassembly says E3 does
  the same (`1010:2108` sets `did_something` for the outdoor move, and
  entering the town at `1010:22ba` clears only `need_redraw`), and whether
  one of them notices you is a d100 roll (`r1 < 50`), so "Monster saw you!"
  should come on arrival in some tries and only after the step in others.
- **Question:** does it ever come on the entering move? If it never does,
  E3's monsters don't act on that move, and the port needs to know why.

### 28. The title movie and the ending (2026-10-04)

- **Where:** the title screen (movie 0 plays behind it), and the end: the
  pedestal in the Keep of Rentar-Ihrno, Release, Power Up, Begin with all
  four vats full. A save just before the pedestal would do for the second.
- **Do:** watch the title screen's movie once round (the party raiding
  Varik's temple, to "Oh, shut up."), and the ending through to "Farewell,
  and goodnight.". Then click, and note **what the game does after the
  ending**: where the party is, whether it can still move, save or load.
- **Why:** both scripts were read from the EXE (`1098:47dd`, `1098:1dcb`),
  but where E3 puts the title movie on its title screen isn't known (the
  port centres it as it does the intro), and what comes after the ending
  is odd in the code: `0e09` leaves the game in town mode in the ending's
  own town (66) at (4,13), with every living PC's status set to 7, which
  is no status BoE has. The port goes to the victory dialog instead.
- **The port:** the title movie between the opening pictures and the intro
  on a new game, about three minutes; the ending before the victory dialog,
  about four, with the party's own PCs, "Welcome, <name>" for each.
- **Question:** where on the title screen is the movie? And after the
  ending's click, what can the party do?

### 29. Does a dungeon fill up again? (2026-10-05)

- **Where:** the Goblin Lair (town 44), or any dungeon with a fight in it.
- **Do:** kill some of its creatures, walk out, and walk straight back in.
  Then do it again, but visit **four other towns or dungeon levels** before
  coming back.
- **Why:** reported in play-testing: "all the enemies spawn again". E3's
  `end_town_mode` (`10d8:2591`) saves the town's creatures only while
  `overall_mode` (DGROUP 0x3d50) is 1, into one of four slots
  (party+0x1416 + 0x1594·k, town number at +0x29a6) taken round-robin; its
  loader (`10d8:0873`) restores a town found there and builds any other
  afresh from its records. That is 1997's rule too (TOWN.CPP:241, :575).
  A town is also "cleaned out" once more than its limit have died there
  (the Goblin Lair's is 100; 183 of E3's towns have 10000).
- **The port:** the same: straight back in, the dead stay dead; after four
  other towns, the dungeon is full again.
- **Question:** in the original, is the dungeon full again in either case?
  If it stays empty after four other towns, E3 remembers its dead some way
  the port hasn't read.
- **The user's recollection (2026-10-05):** the bandits' camp stayed empty
  when they came back much later. Read against the EXE, the Bandit Hideout
  (town 45) has 39 creatures and a limit of 100 kills, so it can't be
  "cleaned out"; it isn't among the towns the loader empties on a flag
  (22, 23, 36, 46, 50, 52, 90, 200, `10d8:107b`–`1166`); and none of its
  creatures has a time flag. By the code it fills again once four other
  towns have been visited — so if it doesn't, something else is at work.
  (A camp met outdoors would be a once-only encounter, not a town.)

### 30. What does an archer's arrow sound like when it hits? (2026-10-06)

- **Where:** anywhere with Archers — the Bandit Hideout (town 45) has
  eleven.
- **Do:** stand back and let them shoot; listen to a shot that *hits*,
  and to one that hits a monster beside the party.
- **Why:** reported in play-testing: the hit "plays the punch sound like a
  broadsword". E3's monster shot (`1018:76ca`) damages with 0x514 = 1300,
  sound slot 13, and its `boom_space` table at EXE 0x145a2 is 1997's
  (`{97,69,…,89,98}`), so slot 13 is file 98. In the port, an Archer's
  hit plays 98 (checked in the browser), its twang 12 before it; a melee
  hit from a sword plays 70, a punch 97.
- **Question:** in the original, is the hit 98 (the same as the party's
  own arrows hitting)? If it is something else, which?

### 31. Do monsters walk through a secret door the party has found? (2026-10-06)

- **Where:** any secret door the party has opened (Colchis's, at (36,39)).
- **Do:** open it, step back, and let a monster come for you.
- **Why:** reported in play-testing: "enemies move through secret doors".
  An unfound one (101, 118, 133) is now wall to them, as E3 has it — only
  the party's move and search code (`10c0:0c97`, `10c0:4409`) ever opens
  one. A found one (102, 119, 134) is `terrain_blocked` 1 at `DS:1c7e`
  (sight blocked, movement not), which is the only test E3 has, so a
  monster can walk through it in the port.
- **The step code (2026-10-06):** a creature's step refuses the squares on
  the table at `1090:3595`, and the found doors aren't on it — so by the
  code, yes, it comes through.
- **Question:** in the original, does a monster come through a door the
  party has found?

### 32. How the panels' empty boxes look (2026-10-07)

- **Where:** the Filth Factory (town 26), level 1, the control room's
  panel at (41,15). `Q32.SAV` stands the party beside it.
- **Do:** use it and take a screenshot before pressing anything.
- **The port:** every panel is drawn from its E3 dialog the way the
  Slime Pit's pedestal is, which a screenshot of the original confirmed
  (DIVERGENCES.md #55). In that one, a text control E3 leaves empty was
  drawn framed, so the port frames every empty one: the factory's 250×16
  strip under the labels left of Leave (which E3's handler,
  `FUN_1008_436d`, never writes into), and the boxes the other panels
  fill as they're pressed — the troglodyte gate's dial numbers, the
  giants' rune names, the Tinraya cell panel's Dha/Kaik words.
- **Question:** is the factory's box there in the original, and are the
  other panels' boxes framed too?

## Waiting on a ruling (already written up elsewhere)

- **DIVERGENCES.md #30 and #31**, marked "open for the user".
- **E3-SUSPECTED-BUGS.md**: #15–17 are undecided. Each can be checked in
  play: the Steel Razordisks' stack after a throw, Raise Dead with no
  Resurrection Balm, and alchemy when the first ingredient runs out.
- **Outdoor boats** (PROGRESS.md, "Fix known bugs", 2026-09-29): can the
  party board a boat that belongs to someone else *outdoors*? In town, E3
  says "Not your boat."

## Answered

### 5. Shayder's mayor: gold as well as the ring? (2026-09-30)

- **Where:** Shayder's City Hall, Mayor Bernathy, at about (51,37).
- **Do:** after burning the Filth Factory, ask her about "mission" and
  note what the party gains.
- **The port:** the Gold Skill Ring, and no gold. That's what E3's talk
  script does (`talkScripts.ts`, script 131): one item,
  flag 0xca to 2. Tuxedo Jack's walkthrough says "500 gold and a Gold
  Skill Ring".
- **Question:** does she pay 500 gold too? If so, the gold is somewhere
  the port hasn't read.

**Answered 2026-10-01 (with `Q05.SAV`): no gold, only the ring.** The port
already does the same: E3's talk script 131 is the whole reward, and Tuxedo
Jack's "500 gold" is wrong.

### 1. Colchis: does the secret door into the shade's room open? (2026-09-30)

**Answered 2026-10-01 (sixth play-test, with `Q01.SAV`): yes.** In the
original the door at (36,39) stays plain wall until the party is through
it; the port showed the door's outline from outside. E3's move code
(`10c0:14df`) opens a secret door and lets the party through on the same
step, after the spot's message (DIVERGENCES.md #42). The port now does
the same, and its search finds one too.

