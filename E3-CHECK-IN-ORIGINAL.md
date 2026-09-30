# Questions to check in the original Exile III

Things the port can't settle by reading EXILE3.EXE, or that were read but
never seen in play. Each entry says where to go, what to do, and what the
port does now, so the answer can be compared directly. When one is answered,
write the answer under it with the date, and fix or confirm the port. Then
move the entry to "Answered" at the bottom.

Coordinates are town squares (x, y), as the port's debug panel
(`?scenario=exile3&debug=1`) and the walkthroughs give them.

## Open

### 1. Colchis: does the secret door into the shade's room open? (2026-09-30)

- **Where:** Colchis (town 125), the southeast corner. The shade's room
  is walled in; its east wall at **(36,39)** looks like a plain wall but is
  terrain 101, a secret door that opens when walked into.
- **Do:** walk into (36,39) from the east, (37,39), a few times.
- **The port:** shows the message about the "just plain odd" secret room
  and refuses the step, every time; the door never opens. That's because
  E3's message spot 113 sits on the same square, and the converter makes a
  message spot on a wall refuse the step (`WALK_INTO`,
  `tools/e3convert/specials.ts`).
- **Question:** does the original open the door (after or instead of the
  message)? If it does, the converter's rule is wrong for secret doors.
- (Casting Move Mountains on the moldy wall at (36,40) gets in either way.)

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
square below and says "Nothing happens." everywhere else. **None of these
is ported**: in the port the ritual does nothing anywhere. For each one,
cast the ritual on the square and note what's shown and what changes
(a door, a creature, an item, a message):

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

Most useful: the Great Circle and the Troglo Temple, which look like
quest steps.

### 4. The Slime Pit's pedestal before any button is pressed (2026-09-30)

- **Where:** the Slime Pit (town 22), level 1. Don't touch the pedestal
  at (32,30).
- **Do:** take the stairs down at (2,60), the far west ones, to level 2,
  and see whether the portcullis just past the stairs is open.
- **The port:** it's open. The pedestal's "last pressed" starts at 0,
  which is the top-right button's portcullis.
- **Question:** is the first way down open from the start in the original?

## Waiting on a ruling (already written up elsewhere)

- **DIVERGENCES.md #30 and #31**, marked "open for the user".
- **E3-SUSPECTED-BUGS.md**: #15–17 are undecided. Each can be checked in
  play: the Steel Razordisks' stack after a throw, Raise Dead with no
  Resurrection Balm, and alchemy when the first ingredient runs out.
- **Outdoor boats** (PROGRESS.md, "Fix known bugs", 2026-09-29): can the
  party board a boat that belongs to someone else *outdoors*? In town, E3
  says "Not your boat."

## Answered

(none yet)
