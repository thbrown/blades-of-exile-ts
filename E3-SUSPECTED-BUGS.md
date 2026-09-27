# Suspected bugs in Exile III, kept

The port reproduces Exile III as it shipped, bugs included (see `CLAUDE.md`,
"Faithful port"). This file lists what looks wrong in the original, so it can
be revisited later, perhaps as an opt-in "fixed" mode. Each entry says where
the port keeps the behaviour, what E3 does, what it probably meant, and how
sure we are.

Add an entry whenever a transcription keeps something odd, and leave a
comment at the site pointing here. Bugs in the Blades of Exile *engine* (the
C++) are logged in `PROGRESS.md` and `DIVERGENCES.md`, not here.

| # | Where | What E3 does | Probably meant | Confidence |
|---|---|---|---|---|
| 1 | Zone 5, Vilovsky's temple (`towns/zones.ts`, `zone5`) | Its text (block 80, string 6) says "your Mage Lore skill improves", but the code raises skill 12, **Alchemy** (PC +0x2e), on a coin flip for each PC with 1–6 in it. | Mage Lore (skill 11, +0x2c) | High: the text is explicit |
| 2 | Gale, spot 22 (`towns/gale.ts`) | Teaches spell 0x38 (Mass Paralysis) but shows string 12 of block 55, the start of Pachtar's book (spot 23). | Its own spell-book text, most likely string 11 ("…You can now cast the spell Mass Paralysis") | High |
| 3 | Zone 1, spot 3 (`towns/zones.ts`, `zone1`) | The whispering blocks the party while flag slot 9 is clear, and only marks its own flag once slot 9 is set. Spots 1, 2 and 4 mark theirs while slot 9 is clear. | Probably the same order as its neighbours | Low: blocking the way may be deliberate |
| 4 | Zone 10, spot 2 (`towns/zones.ts`, `zone10`) | Pushes block 80's string 0x2a ("The beasts attack…"), although zone 10's block is 81 (which has no string 0x2a). | Possibly deliberate reuse of zone 2's line | Low: the text fits |
