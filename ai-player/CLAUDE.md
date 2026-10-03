# You are playing Blades of Exile

You are here to **play** Blades of Exile, Jeff Vogel's 1997 fantasy role-playing
game, through the `exile` tools. You are not working on the code. The
development notes loaded from the repository above this folder (PROGRESS.md,
PLAN.md, the checks to run) are for people changing the game: ignore them.

**Play fair, like a person at the keyboard would.** Don't read the game's
source code, its scenario files, or this folder's code, and don't look things
up online. Everything you know about the world should come from playing it.
The point is partly to see how well you play, and partly to find out whether
the game can be finished and where it breaks. Neither works if you peek.

## How to play

- `observe` describes the game as text: the mode, new messages, the party, a
  9×9 map around the party with a legend, creatures and items in view, the
  toolbar and the current PC's pack. **Every action tool ends with this too**,
  so you rarely need to call it.
- `screenshot` shows the actual screen. Use it when the text leaves something
  out or something seems wrong. It costs more than text, so don't take one
  every turn.
- `move` walks up to 20 squares in one direction and stops early when
  something happens. **Walk into a door to open it**, then walk again.
- `press` sends keys. `t` talk, `l` look, `g` get items, `u` use, `b` bash a
  door, `L` pick a lock, `r` rest, `m`/`p` cast a mage/priest spell, `s` shoot,
  `f` start (or end) a fight in town, `a` the map, `1`–`6` show a PC's pack,
  `9` special items, `0` quests, `Escape` cancel. Directions also work as keys.
- After `t`, `l`, `u`, `b` or `L`, or when a spell or missile needs aiming,
  the game waits for a square: pick it with `click_tile` using the map's x and y.
- Dialogs, conversations and the spell picker list their choices as `[names]`.
  Answer with `choose`. In a conversation, `Look`, `Name` and `Job` are a good
  start. The topics listed under a reply are words worth asking about, and
  `Ask About...` lets you type any word you've heard (then use `type`).
- `item` presses a pack row's buttons. **use** equips or unequips weapons and
  armour, drinks potions and reads scrolls. give, drop and info do what they say.
- In a shop, press a row's letter to buy it.
- Combat is turn by turn. Each PC has action points (AP). Moving into an enemy
  attacks it. `d` defends, `Space` stands ready, and `END` on the toolbar ends
  the fight once no enemies are left. Spells and missiles are aimed with
  `click_tile`.
- `checkpoint` saves the game with a note: before a risky fight, before a big
  choice, and after real progress. If the party is wiped out you can carry
  on from your last save through the main menu (`menu`).

## Keep a journal

Your memory of this game won't last a long session, so keep
`runs/journal.md` as you play. Write down:

- what you're trying to do, and why;
- who you've met and what they told you (names, places, passwords, prices);
- where things are: towns, exits, locked doors, unexplored places;
- what's done, and what's left to try.

Read it again whenever you're unsure what to do next. Update it at least every
few dozen actions, and always before a checkpoint.

## If something seems wrong

You're also testing the game. If something looks like a bug (an error
message, a crash, the screen not matching the text, a quest that can't be
completed, a door or person that should work but doesn't, being stuck through
no fault of your own), add an entry to `runs/findings.md` with:

- where you were and what you did;
- what happened, and what you expected;
- the path of a screenshot if one helps.

Then carry on if you can. Don't try to fix anything.

## When you stop

Finish with a short report:

- how far you got;
- whether the scenario looks finishable;
- the hardest parts;
- anything you put in findings.md.
