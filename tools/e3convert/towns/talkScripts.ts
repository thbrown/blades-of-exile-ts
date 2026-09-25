/**
 * Exile 3's scripted conversation nodes: talk node types 100 and up, each a
 * case of `FUN_1020_2eb0` (`ghidra/project/talkscripts.s`; the jump table is
 * at `1020:4a5f`). Every case sets a reply, strings `4500 + n`, and may change
 * the world first. They run as scenario specials (talk.ts turns the node into
 * CALL_SCEN_SPEC), and their message nodes become the reply.
 */

import { e3DailyFlag } from '../flags';
import { partyFlag as f, partySpecItem, type SpecBuilder, type Step } from '../script';

/** Flags a new day clears (`e3DailyFlag`), for E3's day stamps. */
export const LEVY_PAID = e3DailyFlag(0);
export const ELISA_FED = e3DailyFlag(1);
export const DAILY_FLAGS = [LEVY_PAID, ELISA_FED];
/** A scratch flag of the converter's for a count E3 keeps on the stack. */
const AGROD_SOLD: [number, number] = [291, 10];

/** The fort's four pieces of evidence: special items at party+0x40…+0x46. */
const EVIDENCE = [0x40, 0x42, 0x44, 0x46].map(partySpecItem);

export type TalkScript = (b: SpecBuilder) => Step[];

export const TALK_SCRIPTS = new Map<number, TalkScript>([
  // Levy, Fort Emergence's paymaster: 25 gold once a day. E3 stamps the day
  // in flag (21,7); the converter's daily flag does the same job.
  [100, (b) => [b.ifFlagEq(LEVY_PAID, 1, [b.reply(2)], [b.gold(25), b.setFlag(LEVY_PAID, 1), b.reply(1)])]],
  // Levy's rewards for missions done (their flags reach 2 when reported).
  [101, (b) => {
    const reward = (flag: number, reply: number, item: number, done: number): Step[] =>
      [b.giveItem(item, [b.setFlag(f(flag), done)]), b.reply(reply)];
    return [b.ifFlagEq(f(0xc85), 2, reward(0xc85, 4, 0x107, 3), [
      b.ifFlagEq(f(0xc87), 2, reward(0xc87, 5, 0x173, 3), [
        b.ifFlagEq(f(0xc8a), 2, reward(0xc8a, 6, 0x150, 3), [
          b.ifFlagEq(f(0xc8c), 2, reward(0xc8c, 7, 0xf5, 3), [
            b.ifFlagEq(f(0xc91), 4, reward(0xc91, 0x8b, 0x9d, 5), [b.reply(3)]),
          ]),
        ]),
      ]),
    ])];
  }],
  // Elisa's rations: 8 food once a day (E3's stamp is flag (21,8)).
  [102, (b) => [b.ifFlagEq(ELISA_FED, 1, [b.reply(8)], [b.food(8), b.setFlag(ELISA_FED, 1), b.reply(9)])]],
  // Berra takes the evidence, one piece at a time.
  // TODO(E3-3): each also adds a journal entry (0x16–0x19).
  [103, (b) => {
    const [rune, scales, shards, hotShards] = EVIDENCE as [number, number, number, number];
    return [b.ifSpecItem(rune, [b.takeSpecItem(rune), b.setFlag(f(0xc96), 1), b.reply(10)], [
      b.ifSpecItem(scales, [b.takeSpecItem(scales), b.setFlag(f(0xc97), 1), b.reply(11)], [
        b.ifSpecItem(shards, [b.takeSpecItem(shards), b.setFlag(f(0xc9e), 1), b.reply(12)], [
          b.ifSpecItem(hotShards, [
            b.takeSpecItem(hotShards), b.setFlag(f(0xc93), 1), b.dialog(0x808),
            b.townVisible(87), b.setFlag(f(0x225), 1), b.reply(0x1b),
          ], [b.reply(0x1a)]),
        ]),
      ]),
    ])];
  }],
  // Mazumdar opens the barred way (the fort's spot 4, flag (21,4)).
  [104, (b) => [b.ifFlagEq(f(0xc95), 0, [b.reply(0xd)], [b.setFlag(f(0x15a), 1), b.reply(0xe, 0x18)])]],
  // Solberg teaches mage spells for missions done.
  [105, (b) => [
    b.ifFlagAtLeast(f(0xc85), 1, [b.teachSpell(0x1f), b.teachSpell(0x24)]),
    b.ifFlagAtLeast(f(0xc87), 1, [b.teachSpell(0x28), b.teachSpell(0x2b)]),
    b.ifFlagAtLeast(f(0xc85), 1,
      [b.ifFlagAtLeast(f(0xc87), 1, [b.reply(0x10, 0x11)], [b.reply(0x10)])],
      [b.ifFlagAtLeast(f(0xc87), 1, [b.reply(0x11)], [b.reply(0xf)])]),
  ]],
  // 'X' does the same for two more.
  [106, (b) => [
    b.ifFlagAtLeast(f(0xc8a), 1, [b.teachSpell(0x32), b.teachSpell(0x34)]),
    b.ifFlagAtLeast(f(0xc8c), 1, [b.teachSpell(0x36), b.teachSpell(0x39)]),
    b.ifFlagAtLeast(f(0xc8a), 1,
      [b.ifFlagAtLeast(f(0xc8c), 1, [b.reply(0x13, 0x14)], [b.reply(0x13)])],
      [b.ifFlagAtLeast(f(0xc8c), 1, [b.reply(0x14)], [b.reply(0x12)])]),
  ]],
  // Flanagan's missions, counted in flag 0xc90.
  [107, (b) => [
    b.ifFlagEq(f(0xc90), 0, [b.reply(0x1c)], [
      b.ifFlagBelow(f(0xc90), 4, [
        b.townVisible(86), b.ifFlagBelow(f(0xc90), 3, [b.incFlag(f(0xc90))]), b.reply(0x15, 0x19),
      ], [
        b.ifFlagEq(f(0xc90), 4, [b.incFlag(f(0xc90)), b.reply(0x16)], [b.reply(0x17)]),
      ]),
    ]),
  ]],
  // Mayor Arbuckle's slime mission (Krizsan). The first ask sets it
  // (0xc84), reporting back after Anaximander's report (0xc85) pays 1500 gold
  // and 10 experience each. TODO(E3-3): journal entry 5.
  [118, (b) => [b.ifFlagEq(f(0xa3), 0, [b.incFlag(f(0xa3)), b.setFlag(f(0xc84), 1), b.reply(0x3e, 0x3f)], [
    b.ifFlagAtLeast(f(0xc85), 1, [
      b.ifFlagEq(f(0xa3), 1, [b.xp(10), b.gold(1500), b.setFlag(f(0xa3), 2), b.reply(0x41, 0x42)], [b.reply(0x43)]),
    ], [b.reply(0x40)]),
  ])]],
  // Captain Agrod buys unicorn horns (type flag 111) at 10 gold each.
  [119, (b) => [
    b.setFlag(AGROD_SOLD, 0),
    b.eachItemOfClass(111, [b.gold(10), b.setFlag(AGROD_SOLD, 1)]),
    b.ifFlagEq(AGROD_SOLD, 0, [b.reply(0x3b, 0x3c)], [b.reply(0x3d)]),
  ]],
]);
