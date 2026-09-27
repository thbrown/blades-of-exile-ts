/**
 * Exile 3's scripted conversation nodes: talk node types 100 and up, each a
 * case of `FUN_1020_2eb0` (`ghidra/project/talkscripts.s`; the jump table is
 * at `1020:4a5f`). Every case sets a reply, strings `4500 + n`, and may change
 * the world first. They run as scenario specials (talk.ts turns the node into
 * CALL_SCEN_SPEC), and their message nodes become the reply.
 */

import { Skill } from '../../../src/universe/skills';
import { e3DailyFlag } from '../flags';
import { partyFlag as f, partySpecItem, type SpecBuilder, type Step } from '../script';
import { SLOAN_RING, RING_HIDDEN } from './sharimik';
import { ANAMA, ANAMA_RINGS, IRVINE_ASKED, IRVINE_PARCEL } from './shayder';
import { OSTOTH_TALK } from './newCotra';
import { HAWKE_DAY } from './dungeons2';

/** Flags a new day clears (`e3DailyFlag`), for E3's day stamps. */
export const LEVY_PAID = e3DailyFlag(0);
export const ELISA_FED = e3DailyFlag(1);
export const DAILY_FLAGS = [LEVY_PAID, ELISA_FED, HAWKE_DAY];
/** A scratch flag of the converter's for a count E3 keeps on the stack. */
const AGROD_SOLD: [number, number] = [291, 10];

/** The fort's four pieces of evidence: special items at party+0x40…+0x46. */
const EVIDENCE = [0x40, 0x42, 0x44, 0x46].map(partySpecItem);

/** Sharimik's mission for Mayor Knight, 0–3 (talk script 141). */
const KNIGHT = f(0xe8);
/** Special items the mayor hands over and asks for (party+0x5e, +0x62). */
const KNIGHT_PASS = partySpecItem(0x5e);
const KNIGHT_PROOF = partySpecItem(0x62);
/** Sloan and Ginny's ring, 0–2 (talk scripts 144–145). */
const GINNY = f(0xe7);

/**
 * A horse dealer: while `sold` is under `stock`, `price` gold buys E3's horse
 * `first + sold` (its property byte cleared). Replies: sold out, too poor,
 * sold.
 */
const horseDealer = (sold: [number, number], stock: number, price: number, first: number, r: [number, number, number]): TalkScript =>
  (b) => [b.ifFlagBelow(sold, stock, [b.pay(price, [
    b.reply(r[2]), b.switchFlag(sold, Array.from({ length: stock }, (_, k) => [b.giveHorse(first + k)])), b.incFlag(sold),
  ], [b.reply(r[1])])], [b.reply(r[0])])];

/** How often the party has said yes, and no, to the Anama's priests. */
const ANAMA_YES = f(0x57f);
const ANAMA_NO = f(0x580);

export type TalkScript = (b: SpecBuilder) => Step[];

/**
 * Joining the Anama, PC by PC (talk script 130): priest skill gains the mage
 * skill, or 2 if that is more, up to 7; mage skill goes to 0; and 6 spell
 * points more.
 */
export function anamaConversion(b: SpecBuilder): Step {
  return b.eachPc(() => [
    b.ifStat(Skill.MAGE_SPELLS, 2, [
      b.whileStat(Skill.MAGE_SPELLS, 1, [b.addStat(Skill.MAGE_SPELLS, -1), b.addStat(Skill.PRIEST_SPELLS, 1)]),
    ], [b.addStat(Skill.MAGE_SPELLS, -1), b.addStat(Skill.PRIEST_SPELLS, 2)]),
    b.whileStat(Skill.PRIEST_SPELLS, 8, [b.addStat(Skill.PRIEST_SPELLS, -1)]),
    b.addStat(Skill.MAX_SP, 6),
  ]);
}

/**
 * Types 125–129 share one case: an Anama priest asks whether the party
 * believes, once each (flag `party+0x4fd+type`), with dialog `type + 0x1031`,
 * and counts the answers for Ahonar (130).
 */
const anamaQuestion = (type: number): TalkScript => (b) => {
  const asked = f(0x4fd + type);
  return [b.ifFlagAtLeast(asked, 1, [b.reply(0x5d)], [
    b.askDialog(type + 0x1031, [b.reply(0x5b), b.incFlag(ANAMA_YES)], [b.incFlag(ANAMA_NO), b.reply(0x5c)]),
    b.setFlag(asked, 1),
  ])];
};

export const TALK_SCRIPTS = new Map<number, TalkScript>([
  ...OSTOTH_TALK,
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
  ...[125, 126, 127, 128, 129].map((t): [number, TalkScript] => [t, anamaQuestion(t)]),
  // Ahonar, who takes the party into the Anama once three priests have heard
  // it say yes, and never once it has said no three times. Joining turns each
  // PC's mage skill into priest skill (at least 2, at most 7), forgets the
  // mage spells from 30 up, and adds 6 spell points.
  // TODO(E3-3): journal entry 0x20.
  [130, (b) => {
    const join: Step[] = [
      b.dialog(0xbe8), b.setFlag(ANAMA, 3), b.giveSpecItem(ANAMA_RINGS),
      anamaConversion(b),
      ...Array.from({ length: 32 }, (_, i) => b.forgetSpell(30 + i)),
      b.reply(0x70),
    ];
    const notYet: Step[] = [b.ifSpecItem(ANAMA_RINGS, [
      // A ring the party was never given: Ahonar takes it, and that is that.
      b.setFlag(ANAMA_NO, 5), b.takeSpecItem(ANAMA_RINGS), b.reply(0x63, 0x64),
    ], [b.ifFlagAtLeast(ANAMA_NO, 3, [b.reply(0x60)], [
      b.ifFlagAtLeast(ANAMA_YES, 3, [b.askDialog(0xbe7, join, [b.reply(0x6f)])], [b.reply(0x5e, 0x5f)]),
    ])])];
    return [b.ifFlagEq(ANAMA, 0, notYet, [b.ifFlagEq(ANAMA, 3, [b.reply(0x61)], [b.reply(0x62)])])];
  }],
  // Mayor Bernathy's mission, and a reward (item 0x136) once flag 0xc87 is set.
  // TODO(E3-3): journal entry 0x1a.
  [131, (b) => [b.ifFlagEq(f(0xc87), 0, [
    b.ifFlagEq(f(0xca), 0, [b.reply(0x65, 0x66), b.setFlag(f(0xca), 1)], [b.reply(0x67)]),
  ], [
    b.ifFlagBelow(f(0xca), 2, [b.giveItem(0x136, [b.setFlag(f(0xca), 2)]), b.reply(0x68, 0x69)], [b.reply(0x6a)]),
  ])]],
  // Irvine asks the party to fetch a parcel from his chest (Shayder's spot 8).
  [132, (b) => [b.ifSpecItem(IRVINE_PARCEL, [b.reply(0x6b)], [
    b.ifFlagAtLeast(IRVINE_ASKED, 1, [b.reply(0x6e)], [b.setFlag(IRVINE_ASKED, 1), b.reply(0x6c, 0x6d)]),
  ])]],
  // Mayor Knight's mission (Sharimik). Flags 0xf1 and 0xf2 are the two
  // things Levin (143) and Commander Corie (142) must agree to first.
  // TODO(E3-3): journal entry 0x1c.
  [141, (b) => [b.ifFlagEq(KNIGHT, 0, [b.reply(0x8c, 0x8d), b.incFlag(KNIGHT)], [
    b.ifFlagEq(KNIGHT, 1, [b.ifFlagEq(f(0xf1), 0, [b.reply(0x8f)], [
      b.ifFlagEq(f(0xf2), 0, [b.reply(0x8e)], [b.reply(0x90), b.incFlag(KNIGHT), b.giveSpecItem(KNIGHT_PASS)]),
    ])], [
      b.ifFlagEq(KNIGHT, 2, [b.ifSpecItem(KNIGHT_PROOF, [
        b.reply(0x92, 0x93), b.incFlag(KNIGHT), b.takeSpecItem(KNIGHT_PROOF),
      ], (() => {
        // Or the job was done another way: town 28 turned (its flag is 7),
        // or flag 0xc8a.
        const other: Step[] = [b.reply(0xd9), b.incFlag(KNIGHT), b.takeSpecItem(KNIGHT_PROOF), b.takeSpecItem(KNIGHT_PASS)];
        return [b.ifFlagEq(f(0x1a4), 7, other, [b.ifFlagAtLeast(f(0xc8a), 1, other, [b.reply(0x91)])])];
      })())], [b.reply(0x94)]),
    ]),
  ])]],
  // Commander Corie agrees once flag 0x47f is set.
  [142, (b) => [b.ifFlagEq(KNIGHT, 0, [b.reply(0x95)], [
    b.ifFlagEq(f(0xf2), 1, [b.reply(0x99)], [
      b.ifFlagAtLeast(f(0x47f), 1, [b.reply(0x98), b.setFlag(f(0xf2), 1)], [b.reply(0x96, 0x97)]),
    ]),
  ])]],
  // Levin agrees for a 1000 gold bribe, once he has named his price.
  [143, (b) => [b.ifFlagEq(KNIGHT, 0, [b.reply(0x9a)], [
    b.ifFlagAtLeast(f(0xf1), 1, [b.reply(0x9e)], [
      b.ifFlagAtLeast(f(0xfb), 1, [b.pay(1000, [b.reply(0x9d), b.setFlag(f(0xf1), 1)], [b.reply(0x9f)])],
        [b.reply(0x9b, 0x9c), b.setFlag(f(0xfb), 1)]),
    ]),
  ])]],
  // Ginny wants her ring back: 500 food and 10 experience each for it.
  [144, (b) => [b.ifFlagEq(GINNY, 0, [b.reply(0xa0), b.incFlag(GINNY)], [
    b.ifFlagEq(GINNY, 2, [b.reply(0xa4)], [b.ifSpecItem(SLOAN_RING, [
      b.reply(0xa2, 0xa3), b.takeSpecItem(SLOAN_RING), b.incFlag(GINNY), b.food(500), b.xp(10),
    ], [b.reply(0xa1)])]),
  ])]],
  // Sloan says where he hid it.
  [145, (b) => [b.ifFlagEq(GINNY, 2, [b.reply(0xa7)], [
    b.ifSpecItem(SLOAN_RING, [b.reply(0xa6)], [b.reply(0xa5), b.setFlag(RING_HIDDEN, 1)]),
  ])]],
  // Bryk sells the three horses in his stable (E3's horses 4–6), 500 each.
  [146, horseDealer(f(0x5e7), 3, 500, 4, [0xb9, 0xba, 0xb8])],
  // Kendra pays 1000 gold for Irvine's parcel.
  [152, (b) => [b.ifSpecItem(IRVINE_PARCEL, [
    b.takeSpecItem(IRVINE_PARCEL), b.reply(0xbd, 0xbe), b.setFlag(f(0x119), 1), b.gold(1000),
  ], [b.ifFlagEq(f(0x119), 0, [b.reply(0xbc)], [b.reply(0xbf)])])]],
  // Kendra opens the guild's door: terrain 132 at (13,21) becomes 134.
  [153, (b) => [b.ifTer(13, 21, 0x84, [b.reply(0xc0), b.setTer(13, 21, 0x86)], [b.reply(0xc1)])]],
  // Geoffrey sells an Anama ring for 2500 gold, to anyone not a member.
  [154, (b) => [b.ifFlagAtLeast(f(0x123), 1, [b.reply(0xc3)], [
    b.ifFlagEq(ANAMA, 3, [b.reply(0xc5)], [b.pay(2500, [
      b.reply(0xc4), b.giveSpecItem(ANAMA_RINGS), b.setFlag(f(0x123), 1),
    ], [b.reply(0xc2)])]),
  ])]],
  // Bruskrud pays 300 for each of four trophies (special items 45–48), and
  // 500 for each of four missions (flags 0xc3b, 0xc2f, 0xc30, 0xc31 at 1).
  // TODO(E3-3): journal entry 0x21.
  [155, (b) => {
    const mission = (first: number): Step[] => [0xc3b, 0xc2f, 0xc30, 0xc31].reduceRight<Step[]>(
      (otherwise, flag) => [b.ifFlagEq(f(flag), 1, [b.setFlag(f(flag), 2), b.gold(500), b.reply(first, 0xca)], otherwise)],
      [b.reply(first, 0xc9)]);
    const trophies = [0x68, 0x6a, 0x6c, 0x66].map(partySpecItem);
    const turnIn = trophies.reduceRight<Step[]>(
      (otherwise, k) => [b.ifSpecItem(k, [b.takeSpecItem(k), b.gold(300), ...mission(0xc8)], otherwise)],
      mission(0xc7));
    return [b.ifFlagEq(f(0x122), 0, [b.reply(0xc6, 0xcf), b.setFlag(f(0x122), 1)], turnIn)];
  }],
  // Dwaine, on the Empress and Prazac. TODO(E3-3): journal entry 0xf.
  [156, (b) => [b.ifFlagEq(f(0xc8e), 2, [b.reply(0xce)], [
    b.ifFlagEq(f(0x10e), 0, [b.reply(0xcb, 0xcc), b.setFlag(f(0xc8e), 1), b.setFlag(f(0x10e), 1)], [b.reply(0xcd)]),
  ])]],
  // Lewis sells the four horses in Lorelei's stables (E3's horses 7–10), 600 each.
  [157, horseDealer(f(0x111), 4, 600, 7, [0xd2, 0xd1, 0xd0])],
  // Pasi shows the way in to Gale (flag 0x136, the concealed door) to anyone
  // who has done something for the fort (0xc85, 0xc87, 0xc8a), or who dealt
  // with the golems (0xc8c).
  [165, (b) => {
    const trusted: Step[] = [b.reply(0xf8, 0xf9), b.setFlag(f(0x136), 1)];
    return [b.ifFlagAtLeast(f(0xc8c), 1, [b.reply(0xfa), b.setFlag(f(0x136), 1)], [
      b.ifFlagAtLeast(f(0x136), 1, [b.reply(0xfb)], [
        b.ifFlagEq(f(0xc85), 0, [b.ifFlagEq(f(0xc87), 0, [
          b.ifFlagEq(f(0xc8a), 0, [b.reply(0xf6, 0xf7)], trusted),
        ], trusted)], trusted),
      ]),
    ])];
  }],
  // Captain Agrod buys unicorn horns (type flag 111) at 10 gold each.
  [119, (b) => [
    b.setFlag(AGROD_SOLD, 0),
    b.eachItemOfClass(111, [b.gold(10), b.setFlag(AGROD_SOLD, 1)]),
    b.ifFlagEq(AGROD_SOLD, 0, [b.reply(0x3b, 0x3c)], [b.reply(0x3d)]),
  ]],
]);
