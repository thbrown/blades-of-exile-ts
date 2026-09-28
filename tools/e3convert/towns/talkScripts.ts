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
/** A scratch flag of the converter's: whether a buyer (119, 137, 150) took anything. */
const SOLD_ANY: [number, number] = [291, 10];
/** Gointz's boat sold (talk script 116), for E3's party+0x1307. */
const GOINTZ_SOLD: [number, number] = [291, 20];
/**
 * Creatures killed in the ursagi's caves (town 51), for Delenn (135). E3
 * counts every non-summoned creature killed there (`m_killed[51]`,
 * party+0x7988); the converter counts the town's own creatures as they die
 * (`KILL_SCRIPTS`), so a wandering one killed there does not count.
 */
const URSAGI_KILLED: [number, number] = [291, 32];

/**
 * What killing one of a town's creatures does, by town (`<onkill>`), before
 * E3's own `kill_monst` cases (`kills.ts`).
 */
export const KILL_SCRIPTS = new Map<number, (b: SpecBuilder) => Step[]>([
  [51, (b) => [b.incFlag(URSAGI_KILLED)]],
]);

/** Crisper's reply by flag 0x22e (0x35 + it). */
const crisper = (b: SpecBuilder): Step => b.switchFlag(f(0x22e), [[b.reply(0x35)], [b.reply(0x36)], [b.reply(0x37)]]);
/** Feral's sale: 1000 gold for E3's horse 1. */
const feral = (b: SpecBuilder): Step[] => [b.pay(1000, [b.reply(0x46), b.giveHorse(1), b.incFlag(f(0x53d))], [b.reply(0x45)])];

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
  // Berra takes the evidence, one piece at a time, each with its journal
  // entry (0x16–0x19).
  [103, (b) => {
    const [rune, scales, shards, hotShards] = EVIDENCE as [number, number, number, number];
    return [b.ifSpecItem(rune, [b.journal(0x16), b.takeSpecItem(rune), b.setFlag(f(0xc96), 1), b.reply(10)], [
      b.ifSpecItem(scales, [b.journal(0x17), b.takeSpecItem(scales), b.setFlag(f(0xc97), 1), b.reply(11)], [
        b.ifSpecItem(shards, [b.journal(0x18), b.takeSpecItem(shards), b.setFlag(f(0xc9e), 1), b.reply(12)], [
          b.ifSpecItem(hotShards, [
            b.journal(0x19), b.takeSpecItem(hotShards), b.setFlag(f(0xc93), 1), b.dialog(0x808),
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
  // and 10 experience each.
  [118, (b) => [b.ifFlagEq(f(0xa3), 0, [b.incFlag(f(0xa3)), b.setFlag(f(0xc84), 1), b.journal(5), b.reply(0x3e, 0x3f)], [
    b.ifFlagAtLeast(f(0xc85), 1, [
      b.ifFlagEq(f(0xa3), 1, [b.xp(10), b.gold(1500), b.setFlag(f(0xa3), 2), b.reply(0x41, 0x42)], [b.reply(0x43)]),
    ], [b.reply(0x40)]),
  ])]],
  ...[125, 126, 127, 128, 129].map((t): [number, TalkScript] => [t, anamaQuestion(t)]),
  // Ahonar, who takes the party into the Anama once three priests have heard
  // it say yes, and never once it has said no three times. Joining turns each
  // PC's mage skill into priest skill (at least 2, at most 7), forgets the
  // mage spells from 30 up, and adds 6 spell points.
  [130, (b) => {
    const join: Step[] = [
      b.dialog(0xbe8), b.setFlag(ANAMA, 3), b.giveSpecItem(ANAMA_RINGS), b.journal(0x20),
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
  [131, (b) => [b.ifFlagEq(f(0xc87), 0, [
    b.ifFlagEq(f(0xca), 0, [b.journal(0x1a), b.reply(0x65, 0x66), b.setFlag(f(0xca), 1)], [b.reply(0x67)]),
  ], [
    b.ifFlagBelow(f(0xca), 2, [b.giveItem(0x136, [b.setFlag(f(0xca), 2)]), b.reply(0x68, 0x69)], [b.reply(0x6a)]),
  ])]],
  // Irvine asks the party to fetch a parcel from his chest (Shayder's spot 8).
  [132, (b) => [b.ifSpecItem(IRVINE_PARCEL, [b.reply(0x6b)], [
    b.ifFlagAtLeast(IRVINE_ASKED, 1, [b.reply(0x6e)], [b.setFlag(IRVINE_ASKED, 1), b.reply(0x6c, 0x6d)]),
  ])]],
  // Mayor Knight's mission (Sharimik). Flags 0xf1 and 0xf2 are the two
  // things Levin (143) and Commander Corie (142) must agree to first.
  [141, (b) => [b.ifFlagEq(KNIGHT, 0, [b.reply(0x8c, 0x8d), b.incFlag(KNIGHT)], [
    b.ifFlagEq(KNIGHT, 1, [b.ifFlagEq(f(0xf1), 0, [b.reply(0x8f)], [
      b.ifFlagEq(f(0xf2), 0, [b.reply(0x8e)], [b.reply(0x90), b.incFlag(KNIGHT), b.giveSpecItem(KNIGHT_PASS), b.journal(0x1c)]),
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
  [155, (b) => {
    const mission = (first: number): Step[] => [0xc3b, 0xc2f, 0xc30, 0xc31].reduceRight<Step[]>(
      (otherwise, flag) => [b.ifFlagEq(f(flag), 1, [b.setFlag(f(flag), 2), b.gold(500), b.reply(first, 0xca)], otherwise)],
      [b.reply(first, 0xc9)]);
    const trophies = [0x68, 0x6a, 0x6c, 0x66].map(partySpecItem);
    const turnIn = trophies.reduceRight<Step[]>(
      (otherwise, k) => [b.ifSpecItem(k, [b.takeSpecItem(k), b.gold(300), ...mission(0xc8)], otherwise)],
      mission(0xc7));
    return [b.ifFlagEq(f(0x122), 0, [b.reply(0xc6, 0xcf), b.setFlag(f(0x122), 1), b.journal(0x21)], turnIn)];
  }],
  // Dwaine, on the Empress and Prazac.
  [156, (b) => [b.ifFlagEq(f(0xc8e), 2, [b.reply(0xce)], [
    b.ifFlagEq(f(0x10e), 0, [b.reply(0xcb, 0xcc), b.journal(0xf), b.setFlag(f(0xc8e), 1), b.setFlag(f(0x10e), 1)], [b.reply(0xcd)]),
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
    b.setFlag(SOLD_ANY, 0),
    b.eachItemOfClass(111, [b.gold(10), b.setFlag(SOLD_ANY, 1)]),
    b.ifFlagEq(SOLD_ANY, 0, [b.reply(0x3b, 0x3c)], [b.reply(0x3d)]),
  ]],
  // Seles, who keeps the portal down to the Tower of Magi, on the demon
  // plot's stage (0xc91): 1–2 go down and retake it; later, 0x1f (nothing to
  // connect to) unless the war is late (0xc92) and special item 6 is not in
  // hand (0x20, the Sphere); before, permission once any mission is done.
  // A stage past 5 keeps E3's default reply, 1.
  [108, (b) => {
    const later: Step[] = [b.ifFlagAtLeast(f(0xc92), 1, [b.ifSpecItem(6, [b.reply(0x1f)], [b.reply(0x20)])], [b.reply(0x1f)])];
    const permitted: Step[] = [0xc85, 0xc87, 0xc8a, 0xc8c].reduceRight<Step[]>(
      (otherwise, flag) => [b.ifFlagAtLeast(f(flag), 1, [b.reply(0x1e)], otherwise)], [b.reply(0x1d)]);
    const start: Step[] = [b.ifFlagAtLeast(f(0xc92), 1, [b.ifSpecItem(6, permitted, [b.reply(0x20)])], permitted)];
    return [b.switchFlag(f(0xc91), [start, [b.reply(0x24)], [b.reply(0x24)], later, later, later], [b.reply(1)])];
  }],
  // Denise's amulet (special item 30) for a scroll (item 0xd3); flag 0x21c
  // picks the reply otherwise (0x21 + it).
  [109, (b) => [b.ifSpecItem(30, [
    b.reply(0x22), b.giveItem(0xd3, [b.setFlag(f(0x21c), 2), b.takeSpecItem(30)]),
  ], [b.switchFlag(f(0x21c), [[b.reply(0x21)], [b.reply(0x22)], [b.reply(0x23)]])])]],
  // Koriba's crystal statue (special item 31) for a Soul Crystal (item 25).
  [110, (b) => [b.ifSpecItem(31, [
    b.reply(0x26), b.giveSpecItem(25), b.takeSpecItem(31), b.setFlag(f(0x223), 2),
  ], [b.switchFlag(f(0x223), [[b.reply(0x25)], [b.reply(0x26)], [b.reply(0x27)]])])]],
  // Gointz sells his boat for 500 gold. E3 marks it sold in party+0x1307, a
  // byte of the first saved town's creatures, and never frees the boat (E3's
  // boat 2, New Cotra's), so the party pays and cannot board it
  // (E3-SUSPECTED-BUGS.md #8). GOINTZ_SOLD stands in for that byte, read as
  // not yet zero.
  [116, (b) => [b.ifFlagEq(GOINTZ_SOLD, 1, [b.reply(0x3a)], [
    b.ifGold(500, [b.reply(0x39), b.takeGold(500), b.setFlag(GOINTZ_SOLD, 1)], [b.reply(0x38)]),
  ])]],
  // Crisper pays 300 gold for the ice pudding (zone 88's spot 5 flag).
  [117, (b) => [b.ifFlagAtLeast(f(0xbc9), 1, [
    b.ifFlagEq(f(0x22e), 0, [b.setFlag(f(0x22e), 2), b.reply(0x36), b.gold(300)], [crisper(b)]),
  ], [crisper(b)])]],
  // Feral sells his horse (E3's horse 1) for 1000 gold, once he has named
  // the price.
  [120, (b) => [b.switchFlag(f(0x53d), [
    [b.reply(0x44), b.incFlag(f(0x53d))],
    feral(b),
  ], [b.ifFlagEq(f(0x53d), 2, [b.reply(0x47)], feral(b))])]],
  // Paulo's herbs (0x549, set by his village's spot 1): Summon Spirit and
  // Charm Foe, taught again whenever asked after.
  [121, (b) => [b.ifFlagAtLeast(f(0x549), 1, [
    b.reply(0x4a, 0x4b), b.setFlag(f(0x549), 0), b.teachSpell(0x73), b.teachSpell(0x75), b.setFlag(f(0x548), 2),
  ], [b.ifFlagBelow(f(0x548), 2, [b.reply(0x48, 0x49), b.setFlag(f(0x548), 1)], [
    b.reply(0x4c), b.teachSpell(0x73), b.teachSpell(0x75),
  ])])]],
  // The ghost teaches Move Mountains.
  [122, (b) => [b.teachSpell(0x74), b.reply(0x4d)]],
  // Erika's amulet (special item 36): once it is fetched (0x262 is 2), she
  // asks to enchant it (journal entry 0x1f on yes); refused, she destroys it.
  // Past 3 keeps E3's default reply, 1.
  [123, (b) => [b.switchFlag(f(0x262), [
    [b.reply(0x4e, 0x4f), b.incFlag(f(0x262))],
    [b.reply(0x50)],
    [b.askDialog(0xd91, [b.reply(0x51, 0x52), b.journal(0x1f)], [b.reply(0x53), b.takeSpecItem(36)]), b.setFlag(f(0x262), 3)],
    [b.ifSpecItem(36, [b.reply(0x54)], [b.reply(0x55)])],
  ], [b.reply(1)])]],
  // Arion's metal (special item 37) for Summon Beast and Conflagration,
  // taught again whenever asked after; asking first marks zone 74's cache
  // (spot 7).
  [124, (b) => [b.ifFlagAtLeast(f(0x55b), 1, [b.reply(0x5a), b.teachSpell(0x10), b.teachSpell(0x11)], [
    b.ifSpecItem(37, [
      b.reply(0x58, 0x59), b.teachSpell(0x10), b.teachSpell(0x11), b.setFlag(f(0x55b), 1), b.takeSpecItem(37),
    ], [b.reply(0x56, 0x57), b.setFlag(f(0xb3f), 1)]),
  ])]],
  // The spider chief tells the way to the roach lair (town 92) once the
  // spiders' fight (zone 55's spot 9 flag: 2 helped, 3 did not) is over.
  [133, (b) => [b.ifFlagBelow(f(0xa83), 2, [b.reply(0x71), b.setFlag(f(0xa83), 1)], [
    // (E3's reply is 0x70 + the flag, which is never past 3.)
    b.switchFlag(f(0xa83), [[], [], [b.reply(0x72, 0x74)], [b.reply(0x73, 0x74)]]),
    b.townVisible(92),
  ])]],
  // Delenn's two jobs (0x5e8): the lizard chief (flag 0x281) for 1000 gold,
  // then the ursagi's caves, which count as cleared past 37 kills, for a
  // sword (item 0x58). Past 4 keeps E3's default reply, 1.
  [135, (b) => [b.switchFlag(f(0x5e8), [
    [b.reply(0x78, 0x79), b.incFlag(f(0x5e8))],
    [b.ifFlagAtLeast(f(0x281), 1, [b.reply(0x7b), b.incFlag(f(0x5e8)), b.gold(1000)], [b.reply(0x7a)])],
    [b.reply(0x7c, 0x7d), b.incFlag(f(0x5e8))],
    [b.ifFlagAtLeast(URSAGI_KILLED, 38, [b.giveItem(0x58), b.reply(0x7f, 0x80), b.incFlag(f(0x5e8))], [b.reply(0x7e)])],
    [b.reply(0x80)],
  ], [b.reply(1)])]],
  // Ivanova teaches Identify for Ernest's book (special item 34); asking
  // first marks his hut (0x3df).
  [136, (b) => {
    const ask: Step[] = [b.reply(0x81, 0x82), b.setFlag(f(0x5e9), 1), b.setFlag(f(0x3df), 1)];
    return [b.ifFlagAtLeast(f(0x5e9), 2, [b.reply(0x85)], [b.ifFlagEq(f(0x5e9), 1, [b.ifSpecItem(34, [
      b.takeSpecItem(34), b.setFlag(f(0x5e9), 2), b.teachSpell(6), b.reply(0x83, 0x84),
    ], ask)], ask)])];
  }],
  // Mervin buys herb packages (type flag 132) at 100 gold each.
  [137, (b) => [
    b.setFlag(SOLD_ANY, 0),
    b.eachItemOfClass(0x84, [b.gold(100), b.setFlag(SOLD_ANY, 1)]),
    b.ifFlagEq(SOLD_ANY, 0, [b.reply(0x87)], [b.reply(0x86)]),
  ]],
  // The two gremlins open the way: terrain 2 at (26,8) and at (14,21), which
  // E3 writes straight into the town's terrain.
  [138, (b) => [b.reply(0x88), b.setTer(26, 8, 2)]],
  [139, (b) => [b.reply(0x89), b.setTer(14, 21, 2)]],
  // Vahkohs frees his undead: the town turns, he moves from his throne
  // (17,24) to the altar at (30,24), and the town's spots 5 and 6 are spent.
  [140, (b) => [
    b.reply(0x8a), b.makeTownHostile(), b.moveCreature({ x: 17, y: 24 }, { x: 30, y: 24 }, 68),
    b.setFlag(f(0x291), 20), b.setFlag(f(0x292), 20),
  ]],
  // Zamora says where the map is for 500 gold.
  [147, (b) => [b.ifFlagEq(f(0x5e6), 1, [b.reply(0xb7)], [
    b.ifGold(500, [b.takeGold(500), b.reply(0xb5), b.setFlag(f(0x5e6), 1)], [b.reply(0xb6)]),
  ])]],
  // Carmine forges a sword (item 0x198) from Arion's metal (special item 37)
  // for 1000 gold. The work (0x654) counts down from 100 at random, a turn
  // in eleven; at 1 the sword is ready. 0x655: he has asked for the metal.
  [148, (b) => [b.ifFlagEq(f(0x654), 1, [
    b.reply(0xad, 0xae), b.giveItem(0x198, [b.setFlag(f(0x654), 0)]),
  ], [b.ifFlagAtLeast(f(0x654), 2, [b.reply(0xac)], [
    b.ifFlagEq(f(0x655), 0, [b.reply(0xa8), b.setFlag(f(0x655), 1)], [
      b.ifSpecItem(37, [b.ifGold(1000, [
        b.reply(0xab), b.slowCountdown(f(0x654), 100), b.takeGold(1000), b.takeSpecItem(37),
      ], [b.reply(0xaa)])], [b.reply(0xa9)]),
    ]),
  ])])]],
  // Masok sells the map to Black Halberd (item 0x1f made readable with
  // 0xb3, `notes.ts`) for 2000 gold. E3 sets the reply to 0xb1 and then to
  // 0xb2 over it, so 0xb1 is never shown (E3-SUSPECTED-BUGS.md #9).
  [149, (b) => [b.ifFlagEq(f(0x64b), 1, [b.reply(0xb4)], [
    b.ifGold(2000, [b.takeGold(2000), b.reply(0xb2), b.giveItem(b.note(31, 0xb3)), b.setFlag(f(0x64b), 1)], [b.reply(0xb3)]),
  ])]],
  // Shirley buys trade goods (type flag 103) at 50 gold each.
  [150, (b) => [
    b.setFlag(SOLD_ANY, 0),
    b.eachItemOfClass(0x67, [b.gold(50), b.setFlag(SOLD_ANY, 1)]),
    b.ifFlagEq(SOLD_ANY, 0, [b.reply(0xb0)], [b.reply(0xaf)]),
  ]],
  // The hermit teaches the Ritual of Sanctification.
  [151, (b) => [b.reply(0xbb), b.teachSpell(0x6c)]],
  // Mia's ring (special item 44).
  [158, (b) => [b.ifFlagAtLeast(f(0x691), 1, [b.reply(0xd5)], [
    b.ifSpecItem(44, [b.reply(0xd4), b.takeSpecItem(44), b.setFlag(f(0x691), 1)], [b.reply(0xd3)]),
  ])]],
  // A prisoner of the giants escapes once the party has found the hidden
  // way out (0x1b0), and counts as the first of Bruskrud's four missions
  // still to do. TODO(E3-3): E3 also takes the prisoner out of the town
  // (`active` 0) and sets his death flag, (30,6)–(30,9) by which prisoner,
  // so he stays gone; the engine can't name the creature being talked to,
  // so he stays, and asking again counts again.
  [159, (b) => [b.ifFlagEq(f(0x1b0), 0, [b.reply(0xd6)], [
    b.reply(0xd7, 0xd8),
    [0xc3b, 0xc2f, 0xc30, 0xc31].reduceRight<Step>((otherwise, flag) =>
      b.ifFlagEq(f(flag), 0, [b.setFlag(f(flag), 1)], [otherwise]), b.seq([])),
  ])]],
  // Rabellino's Nephilim raids (zone 28's spot 9 flag): 3 dealt with them
  // peaceably (500 gold), 5 slew them.
  [160, (b) => [b.switchFlag(f(0x975), [
    [b.reply(0xe0, 0xe1), b.setFlag(f(0x975), 1)],
    [b.reply(0xe2)], [b.reply(0xe2)],
    [b.reply(0xe3), b.gold(500), b.setFlag(f(0x975), 4)],
    [b.reply(0xe5)],
    [b.reply(0xe4)],
  ], [b.reply(0xe2)])]],
  // Yale's undead and lizards (0x58d, 2 once the Chasm of Screams is
  // cleared): a helmet (item 0x178).
  [161, (b) => [b.switchFlag(f(0x58d), [
    [b.reply(0xda, 0xdb), b.incFlag(f(0x58d))],
    [b.reply(0xdc)],
    [b.reply(0xdd, 0xde), b.giveItem(0x178, [b.incFlag(f(0x58d))])],
  ], [b.reply(0xdf)])]],
  // Bohen-Ihrno's ruin (0x2da): once its crystals are found (0x2d7), Word of
  // Recall.
  [162, (b) => [b.ifFlagEq(f(0x2da), 0, [b.reply(0xe6, 0xe7), b.incFlag(f(0x2da))], [
    b.ifFlagEq(f(0x2d7), 0, [b.reply(0xec)], [
      b.ifFlagEq(f(0x2da), 1, [b.reply(0xe9, 0xed), b.teachSpell(0xa0), b.incFlag(f(0x2da))], [b.reply(0xe9)]),
    ]),
  ])]],
  // Bohen-Ihrno and Abra leave (creatures 15 and 16, the town's only
  // monsters of types 91 and 96).
  [163, (b) => [b.ifFlagAtLeast(f(0x2da), 2, [
    b.reply(0xea), b.setFlag(f(0x2db), 1), b.removeCreatures(91), b.removeCreatures(96),
  ], [b.reply(0xeb)])]],
  // Sulfras forges the Alien Beast slayer (item 0x199) from Arion's metal
  // (special item 37) and Khoth's spell (0x4a4). E3 gives it with a word
  // and, if nobody has room, again without one (`FUN_1070_0464`), which can
  // only fail the same way.
  [164, (b) => [b.ifFlagEq(f(0x2c5), 2, [b.reply(0xf5)], [
    b.ifFlagEq(f(0x2c5), 0, [b.reply(0xee, 0xef), b.setFlag(f(0x2c5), 1)], [
      b.ifSpecItem(37, [b.ifFlagAtLeast(f(0x4a4), 1, [
        b.giveItem(0x199), b.takeSpecItem(37), b.journal(0x1e), b.setFlag(f(0x2c5), 2), b.reply(0xf3, 0xf4),
      ], [b.reply(0xf2)])], [
        b.ifFlagAtLeast(f(0x4a4), 1, [b.reply(0xf1)], [b.reply(0xf0, 0xef)]),
      ]),
    ]),
  ])]],
  // Craswell sells three horses (E3's horses 12–14), 750 each.
  [166, horseDealer(f(0x6c3), 3, 750, 12, [0xfe, 0xfd, 0xfc])],
  // Sydow teaches Light Heal All.
  [167, (b) => [b.reply(0xff), b.teachSpell(0x79)]],
  // Cerulian lets the party into the library for 4000 gold.
  [168, (b) => [b.ifFlagAtLeast(f(0x73b), 1, [b.reply(0x102)], [
    b.pay(4000, [b.setFlag(f(0x73b), 1), b.reply(0x100)], [b.reply(0x101)]),
  ])]],
  // Vladimir opens the throne room's door (terrain 124 at (51,40)) once the
  // golems or the giants are dealt with (0xc8c, 0xc8a).
  [169, (b) => {
    const open: Step[] = [b.reply(0x106), b.setTer(0x33, 0x28, 0x7c)];
    return [b.ifFlagAtLeast(f(0xc8a), 1, open, [b.ifFlagAtLeast(f(0xc8c), 1, open, [
      b.ifFlagEq(f(0x1e0), 0, [b.reply(0x103, 0x104), b.setFlag(f(0x1e0), 1)], [b.reply(0x105)]),
    ])])];
  }],
  // Empress Prazac's missive for Anaximander (special item 23), and his
  // answer (24), for which she opens Footracer Province (0xc8f). She takes
  // the answer without asking whether the party has it. Each adds a journal
  // entry (0x10, 0x12).
  [170, (b) => [b.ifSpecItem(23, [b.reply(0x109)], [
    b.ifFlagEq(f(0xc94), 0, [b.reply(0x107, 0x108), b.giveSpecItem(23), b.journal(0x10), b.setFlag(f(0xc94), 1)], [
      b.ifFlagEq(f(0x925), 0, [
        b.reply(0x10a, 0x10b), b.setFlag(f(0x925), 1), b.journal(0x12), b.takeSpecItem(24), b.setFlag(f(0xc8f), 1),
      ], [b.reply(0x10c)]),
    ]),
  ])]],
  // Purgatos gives the Phoenix Egg (special item 38), once, and only once
  // the Filth Factory (town 26) shows on the map; until then, 0x75
  // (1020:3afd).
  [134, (b) => [b.ifFlagAtLeast(f(0x5ce), 1, [b.reply(0x77)], [b.ifTownVisible(26, [
    b.reply(0x76), b.setFlag(f(0x5ce), 1), b.giveSpecItem(38),
  ], [b.reply(0x75)])])]],
]);
