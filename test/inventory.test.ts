import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Item, ItemAbil, ItemType, defaultItem } from '../src/data/item';
import { ItemCat, variety } from '../src/data/itemVariety';
import { Scenario } from '../src/data/scenario';
import { GameSession } from '../src/game/session';
import {
  PcChoice, SELECT_PC_CANCEL, SelectPcMode, selectPcOptions,
} from '../src/game/selectPc';
import { dropItemAt, giveThing, handleDropItem } from '../src/game/giveDrop';
import { GameMode } from '../src/game/modes';
import { SpecialHost } from '../src/game/specials/context';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  GiveStatus,
  curWeight,
  equipItem,
  freeWeight,
  giveItem,
  hasAbilEquip,
  itemWeight,
  maxWeight,
  sortItems,
  unequipItem,
} from '../src/universe/inventory';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Skill, Trait } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  // These tests are about the pack's mechanics, so they start from an empty
  // one. `finish_create` gives every PC their racial starting gear in slots 0
  // and 1, which would shift every index and weight below.
  for (const pc of univ.party.pcs) {
    pc.items = pc.items.map(() => defaultItem());
    pc.equip.fill(false);
  }
  return session;
}

/**
 * The two dialogs `give_thing` and `drop_item` can raise, answered by script.
 * `pick` is the select-pc.xml control that gets clicked, the way a recording
 * names it.
 */
class PromptHost implements SpecialHost {
  pick = 'cancel';
  num = -1;
  asked = 0;
  async message(): Promise<void> {}
  async choice(): Promise<number> { return 0; }
  async story(): Promise<void> {}
  async askText(): Promise<string> { return ''; }
  async selectPc(rows: PcChoice[]): Promise<number> {
    this.asked++;
    if (this.pick === 'cancel') return SELECT_PC_CANCEL;
    const which = this.pick.charCodeAt(this.pick.length - 1) - '1'.charCodeAt(0);
    return rows[which]?.canPick === true ? which : SELECT_PC_CANCEL;
  }
  async getNumOfItems(max: number): Promise<number> {
    return this.num < 0 ? max : this.num;
  }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(): void {}
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  endScenario(): void {}
}

function item(over: Partial<Item> = {}): Item {
  return { ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name: 'thing', weight: 10, ...over };
}

describe('item varieties', () => {
  it('matches load_item_type_info', async () => {
    // Two one-handed weapons or two rings can be worn; one of everything else.
    expect(variety(ItemType.ONE_HANDED).equipCount).toBe(2);
    expect(variety(ItemType.RING).equipCount).toBe(2);
    expect(variety(ItemType.ARMOR).equipCount).toBe(1);
    // Potions and scrolls aren't equipment at all.
    expect(variety(ItemType.POTION).equipCount).toBe(0);
    expect(variety(ItemType.SCROLL).equipCount).toBe(0);
    // A two-hander takes both hands; a shield takes one.
    expect(variety(ItemType.TWO_HANDED).numHands).toBe(2);
    expect(variety(ItemType.ONE_HANDED).numHands).toBe(1);
    expect(variety(ItemType.SHIELD).numHands).toBe(1);
    expect(variety(ItemType.ARMOR).numHands).toBe(0);
    // Exclusion categories.
    expect(variety(ItemType.ONE_HANDED).exclusion).toBe(ItemCat.HANDS);
    expect(variety(ItemType.BOW).exclusion).toBe(ItemCat.MISSILE_WEAPON);
    expect(variety(ItemType.ARROW).exclusion).toBe(ItemCat.MISSILE_AMMO);
    expect(variety(ItemType.RING).exclusion).toBe(ItemCat.MISC);
    // Armour and weapon flags.
    expect(variety(ItemType.HELM).isArmour).toBe(true);
    expect(variety(ItemType.BOW).isWeapon).toBe(true);
    expect(variety(ItemType.ARROW).isMissile).toBe(true);
    expect(variety(ItemType.ONE_HANDED).isMissile).toBe(false);
  });
});

describe('weight', () => {
  it('counts stacked ammo and potions per charge', async () => {
    expect(itemWeight(item({ variety: ItemType.ARROW, weight: 2, charges: 10 }))).toBe(20);
    expect(itemWeight(item({ variety: ItemType.POTION, weight: 3, charges: 4 }))).toBe(12);
    // Everything else weighs the same however many charges it has.
    expect(itemWeight(item({ variety: ItemType.WAND, weight: 5, charges: 8 }))).toBe(5);
    expect(itemWeight(item({ variety: ItemType.NO_ITEM, weight: 99 }))).toBe(0);
  });

  it('derives capacity from strength and traits', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.STRENGTH] = 8;
    pc.traits[Trait.STRENGTH] = false;
    pc.traits[Trait.BAD_BACK] = false;
    expect(maxWeight(pc)).toBe(100 + 15 * 8);
    pc.traits[Trait.STRENGTH] = true;
    expect(maxWeight(pc)).toBe(100 + 15 * 8 + 30);
    pc.traits[Trait.BAD_BACK] = true;
    expect(maxWeight(pc)).toBe(100 + 15 * 8 + 30 - 50);
    // Strength above 20 stops helping.
    pc.skills[Skill.STRENGTH] = 40;
    pc.traits[Trait.STRENGTH] = false;
    pc.traits[Trait.BAD_BACK] = false;
    expect(maxWeight(pc)).toBe(100 + 15 * 20);
  });

  it('shifts the carried total for lightening and heavying items', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ weight: 40 });
    expect(curWeight(pc)).toBe(40);
    pc.items[1] = item({ weight: 0, ability: ItemAbil.LIGHTER_OBJECT });
    expect(curWeight(pc)).toBe(10);
    pc.items[1] = item({ weight: 0, ability: ItemAbil.HEAVIER_OBJECT });
    expect(curWeight(pc)).toBe(70);
  });
});

describe('giving items', () => {
  it('routes gold, food and special items to the party', async () => {
    const session = newSession();
    const { party } = session.univ;
    const pc = party.pcs[0]!;
    const gold = party.gold;
    expect(giveItem(pc, party, item({ variety: ItemType.GOLD, itemLevel: 50 })).status).toBe(
      GiveStatus.OK,
    );
    expect(party.gold).toBe(gold + 50);
    const food = party.food;
    giveItem(pc, party, item({ variety: ItemType.FOOD, itemLevel: 20 }));
    expect(party.food).toBe(food + 20);
    giveItem(pc, party, item({ variety: ItemType.SPECIAL, itemLevel: 3 }));
    expect(party.specItems.has(3)).toBe(true);
    // None of those consumed an inventory slot.
    expect(pc.items.every((i) => i.variety === ItemType.NO_ITEM)).toBe(true);
  });

  it('puts an ordinary item in the first free slot and clears floor flags', async () => {
    const session = newSession();
    const { party } = session.univ;
    const pc = party.pcs[0]!;
    const result = giveItem(pc, party, item({ name: 'Sword', property: true, contained: true }));
    expect(result.status).toBe(GiveStatus.OK);
    expect(result.slot).toBe(0);
    expect(pc.items[0]!.name).toBe('Sword');
    expect(pc.items[0]!.property).toBe(false);
    expect(pc.items[0]!.contained).toBe(false);
    expect(result.message).toContain('Jenneke gets');
  });

  it('refuses when too heavy, when full, and when the PC is dead', async () => {
    const session = newSession();
    const { party } = session.univ;
    const pc = party.pcs[0]!;
    expect(giveItem(pc, party, item({ weight: maxWeight(pc) + 1 })).status).toBe(
      GiveStatus.TOO_HEAVY,
    );
    // Fill every slot with weightless junk, then try one more.
    pc.items = pc.items.map(() => item({ weight: 0 }));
    expect(giveItem(pc, party, item({ weight: 0 })).status).toBe(GiveStatus.NO_SPACE);
    pc.mainStatus = MainStatus.DEAD;
    expect(giveItem(pc, party, item({ weight: 0 })).status).toBe(GiveStatus.DEAD);
  });
});

describe('equipping', () => {
  it('allows two one-handed weapons but not three', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    for (let i = 0; i < 3; i++) pc.items[i] = item({ variety: ItemType.ONE_HANDED, weight: 0 });
    expect(equipItem(pc, 0).ok).toBe(true);
    expect(equipItem(pc, 1).ok).toBe(true);
    // Both hands are now full, so the third refuses on hands, not on count.
    expect(equipItem(pc, 2).ok).toBe(false);
  });

  it('needs two free hands for a two-hander', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ variety: ItemType.ONE_HANDED, weight: 0 });
    pc.items[1] = item({ variety: ItemType.TWO_HANDED, weight: 0 });
    expect(equipItem(pc, 0).ok).toBe(true);
    expect(equipItem(pc, 1).ok).toBe(false);
    expect(equipItem(pc, 1).message).toContain('free hands');
    unequipItem(pc, 0);
    expect(equipItem(pc, 1).ok).toBe(true);
  });

  it('allows only one missile weapon and one kind of ammo', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ variety: ItemType.BOW, weight: 0 });
    pc.items[1] = item({ variety: ItemType.CROSSBOW, weight: 0 });
    pc.items[2] = item({ variety: ItemType.ARROW, weight: 0 });
    pc.items[3] = item({ variety: ItemType.BOLTS, weight: 0 });
    expect(equipItem(pc, 0).ok).toBe(true);
    expect(equipItem(pc, 1).ok).toBe(false);
    expect(equipItem(pc, 2).ok).toBe(true);
    expect(equipItem(pc, 3).ok).toBe(false);
  });

  it('refuses to equip things that are not equipment', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ variety: ItemType.POTION, weight: 0 });
    expect(equipItem(pc, 0).ok).toBe(false);
    expect(pc.equip[0]).toBe(false);
  });

  it('will not unequip a cursed item', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ variety: ItemType.ARMOR, weight: 0, cursed: true });
    expect(equipItem(pc, 0).ok).toBe(true);
    expect(unequipItem(pc, 0).ok).toBe(false);
    expect(pc.equip[0]).toBe(true);
  });

  it('finds abilities only on equipped items', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ variety: ItemType.TOOL, weight: 0, ability: ItemAbil.LOCKPICKS });
    expect(hasAbilEquip(pc, ItemAbil.LOCKPICKS)).toBeNull();
    equipItem(pc, 0);
    expect(hasAbilEquip(pc, ItemAbil.LOCKPICKS)?.slot).toBe(0);
  });
});

describe('picking things up and putting them down', () => {
  it('reaches adjacent floor items and hands them over', async () => {
    const session = newSession();
    const town = session.univ.town!;
    const target = town.items.find((i) => !i.contained)!;
    session.univ.party.townLoc = { ...target.itemLoc };
    const { items: reachable } = session.reachableItems(session.univ.party.townLoc);
    expect(reachable).toContain(target);

    const before = town.items.length;
    session.takeItem(target, 0);
    expect(town.items.length).toBe(before - 1);
    expect(session.univ.party.pcs[0]!.items.some((i) => i.name === target.name)).toBe(true);
    // A taken preset item is remembered, so it doesn't reappear.
    expect(town.record.itemTaken[target.isSpecial - 1]).toBe(true);
  });

  /**
   * get_item (boe.items.cpp:483-510) plays a sound on every successful
   * pickup — gold, food and everything else each get their own — and this
   * port's `takeItem` used to play none of them at all.
   */
  it('plays get_item\'s sound for each item kind', async () => {
    const session = newSession();
    const played: number[] = [];
    session.sound = { play: (n: number) => { played.push(n); } } as never;
    const pc = session.univ.party.pcs[0]!;

    const gold = item({ variety: ItemType.GOLD, itemLevel: 10, weight: 0 });
    session.univ.town!.items.push({ ...gold, itemLoc: { ...pc.combatPos } });
    session.takeItem(session.univ.town!.items.at(-1)!, 0);
    expect(played).toEqual([39]);

    played.length = 0;
    const food = item({ variety: ItemType.FOOD, itemLevel: 10, weight: 0 });
    session.univ.town!.items.push({ ...food, itemLoc: { ...pc.combatPos } });
    session.takeItem(session.univ.town!.items.at(-1)!, 0);
    expect(played).toEqual([62]);

    played.length = 0;
    const rock = item({ name: 'Rock', weight: 0 });
    session.univ.town!.items.push({ ...rock, itemLoc: { ...pc.combatPos } });
    session.takeItem(session.univ.town!.items.at(-1)!, 0);
    expect(played).toEqual([0]);

    played.length = 0;
    const boulder = item({ name: 'Boulder', weight: 9999 });
    session.univ.town!.items.push({ ...boulder, itemLoc: { ...pc.combatPos } });
    session.takeItem(session.univ.town!.items.at(-1)!, 0);
    expect(played).toEqual([41]);
  });

  /**
   * A drop is two actions: `handle_drop_item` arms it, and the square it lands
   * on arrives as the click after. The invented version this replaced always
   * put the item on the party's own square.
   */
  it("drops an item on the square that was clicked, and only an adjacent one", async () => {
    const session = newSession();
    const host = new PromptHost();
    const pc = session.univ.party.pcs[0]!;
    pc.items[0] = item({ name: 'Rock', weight: 0 });
    const at = session.univ.party.townLoc;
    const before = session.univ.town!.items.length;

    await handleDropItem(session, 0, 0, host);
    expect(session.mode).toBe(GameMode.DROP_TOWN);
    expect(session.dropSlot).toBe(0);

    // Two squares away is refused, and the item stays in the pack.
    await dropItemAt(session, { x: at.x + 2, y: at.y }, host);
    expect(pc.items[0]!.name).toBe('Rock');
    expect(session.univ.transcript.at(-1)).toContain('must be adjacent');

    await handleDropItem(session, 0, 0, host);
    await dropItemAt(session, { x: at.x + 1, y: at.y }, host);
    expect(pc.items[0]!.variety).toBe(ItemType.NO_ITEM);
    const dropped = session.univ.town!.items;
    expect(dropped.length).toBe(before + 1);
    expect(dropped.at(-1)!.itemLoc).toEqual({ x: at.x + 1, y: at.y });
    expect(session.mode).toBe(GameMode.TOWN);
  });

  /**
   * `give_thing` asks `select_pc(ONLY_CAN_GIVE_FROM_ACTIVE)`, so a PC who
   * couldn't carry the item is never offered — the refusal happens before the
   * dialog, not after it.
   */
  it('hands an item to another PC, and never offers one who could not carry it', async () => {
    const session = newSession();
    const host = new PromptHost();
    const [from, to] = [session.univ.party.pcs[0]!, session.univ.party.pcs[1]!];
    from.items[0] = item({ name: 'Rope', weight: 5 });
    host.pick = 'pick2';
    await giveThing(session, 0, 0, host);
    expect(from.items[0]!.variety).toBe(ItemType.NO_ITEM);
    expect(to.items.some((i) => i.name === 'Rope')).toBe(true);

    // Now overload every possible receiver: nobody is offered, no dialog goes
    // up at all, and the item stays put.
    session.univ.party.pcs.forEach((other, i) => {
      if (i > 0) other.items[0] = item({ name: 'Ballast', weight: freeWeight(other) - 1 });
    });
    from.items[0] = item({ name: 'Anvil', weight: 200 });
    host.asked = 0;
    await giveThing(session, 0, 0, host);
    expect(host.asked).toBe(0);
    expect(from.items[0]!.name).toBe('Anvil');
    expect(session.univ.transcript.at(-1)).toContain('no one has the carrying capacity');
  });

  it('only offers a lockpick prompt to whoever has picks equipped', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[2]!;
    const pick = (): PcChoice[] => selectPcOptions(
      session.univ, SelectPcMode.ONLY_CAN_LOCKPICK, { highlight: Skill.LOCKPICKING });
    let options = pick();
    expect(options.every((o) => !o.canPick)).toBe(true);
    expect(options[2]!.label).toContain('no picks');

    pc.items[0] = item({
      variety: ItemType.TOOL,
      name: 'Lockpicks',
      weight: 0,
      ability: ItemAbil.LOCKPICKS,
      charges: 4,
    });
    options = pick();
    expect(options[2]!.canPick).toBe(false);
    expect(options[2]!.label).toContain('picks not equipped');

    equipItem(pc, 0);
    options = pick();
    expect(options[2]!.canPick).toBe(true);
    expect(options[2]!.label).toContain('Lockpicks x4');
  });

  it('lets a PC with equipped picks actually open a lock', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.LOCKPICKING] = 20;
    pc.items[0] = item({
      variety: ItemType.TOOL,
      name: 'Lockpicks',
      weight: 0,
      ability: ItemAbil.LOCKPICKS,
      abilStrength: 5,
      charges: 20,
    });
    equipItem(pc, 0);

    const town = session.univ.town!.record;
    let where: { x: number; y: number } | null = null;
    for (let x = 1; x < town.maxDim - 1 && !where; x++)
      for (let y = 1; y < town.maxDim - 1 && !where; y++) {
        const spec = session.univ.terrainType(town.terrain[x]![y]!);
        if (spec.special === 9 && spec.flag2 < 5) where = { x, y };
      }
    if (!where) return;
    const opened = session.univ.terrainType(town.terrain[where.x]![where.y]!).flag1;
    for (let i = 0; i < 200; i++) {
      if (town.terrain[where.x]![where.y] === opened) break;
      session.pickLock(where, 0);
    }
    expect(town.terrain[where.x]![where.y]).toBe(opened);
    expect(session.univ.transcript.some((l) => l.includes('Door unlocked'))).toBe(true);
  });

  it('sorts the pack when it gains an item, keeping equal kinds in order', () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    const make = (v: ItemType, name: string): Item => {
      const item = defaultItem();
      item.variety = v;
      item.name = name;
      item.fullName = name;
      item.weight = 1;
      return item;
    };
    // Written straight into the slots, so nothing has sorted them yet.
    pc.items[0] = make(ItemType.ARMOR, 'mail');
    pc.items[1] = make(ItemType.NON_USE_OBJECT, 'rock a');
    pc.items[2] = make(ItemType.NON_USE_OBJECT, 'rock b');
    pc.items[3] = make(ItemType.RING, 'ring');
    pc.equip[0] = true;

    const given = giveItem(pc, session.univ.party, make(ItemType.WAND, 'wand'));
    expect(given.status).toBe(GiveStatus.OK);
    // Priorities: wand 0, ring 5, armor 10, non-use object 11 — and the two
    // rocks keep the order they went in, because the sort only swaps on
    // strictly-less.
    expect(pc.items.slice(0, 5).map((i) => i.name))
      .toEqual(['wand', 'ring', 'mail', 'rock a', 'rock b']);
    // `equip` rides along with the item it belongs to.
    expect(pc.equip[2]).toBe(true);
    expect(pc.equip[0]).toBe(false);
  });

  it('sortItems leaves an already-sorted pack alone', () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    const before = pc.items.map((i) => i.variety);
    sortItems(pc);
    expect(pc.items.map((i) => i.variety)).toEqual(before);
  });
});
