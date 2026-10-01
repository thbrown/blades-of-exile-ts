/**
 * monsters.xml and items.xml writers: the inverse of `readMonstersFromXml`
 * and `readItemsFromXml`, so the converter can hand the engine's own objects
 * (built by the legacy importer's `convertMonster`/`convertItem`) back to it
 * as a scenario file. `test/xmlWrite.test.ts` holds them to that: every
 * bundled scenario's monsters and items survive read → write → read unchanged.
 *
 * Every field the reader knows is written, defaults included, so nothing
 * depends on the reader's defaults matching the writer's idea of them.
 */

import {
  attitudeStrs, dmgNames, fieldNames, itemAbils, itemTypes, itemUses, monstAbilTypes, monstAbils,
  monstMelee, monstMissiles, monstSummons, pcStatus, raceNames, skillNames, spellPats, talkNodes,
} from '../../src/data/enumTags';
import type { Speech } from '../../src/data/talking';
import { specItemStartWith, specItemUseable, type SpecItem } from '../../src/data/quest';
import { SHOP_PROMPT_TAGS, SHOP_TYPE_TAGS, Shop, ShopItemType, type ShopItem } from '../../src/data/shop';
import type { Item } from '../../src/data/item';
import { NUM_DAMAGE_TYPES, type Monster } from '../../src/data/monster';
import { MonstAbil, MonstAbilCat, MonstSummon, abilityCategory } from '../../src/data/monsterAbility';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tagOf(table: readonly string[], i: number, what: string): string {
  const t = table[i];
  if (t === undefined || t === '') throw new Error(`no ${what} tag for ${i}`);
  return t;
}

/** Tenths of a percent back to the file's percentage (`625` → `62.5`). */
function pct(tenths: number): string {
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

function dice(count: number, sides: number): string {
  return `${count}d${sides}`;
}

function abilityXml(m: Monster, key: MonstAbil): string {
  const a = m.abil[key]!;
  const type = tagOf(monstAbils, key, 'monster ability');
  switch (abilityCategory(key)) {
    case MonstAbilCat.MISSILE:
      return `            <missile type="${type}">
                <type>${tagOf(monstMissiles, a.missile.type, 'missile type')}</type>
                <missile>${a.missile.pic}</missile>
                <strength>${dice(a.missile.dice, a.missile.sides)}</strength>
                <skill>${a.missile.skill}</skill>
                <range>${a.missile.range}</range>
                <chance>${pct(a.missile.odds)}</chance>
            </missile>\n`;
    case MonstAbilCat.GENERAL: {
      let extra = '';
      if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2) extra = tagOf(dmgNames, a.gen.extra, 'damage');
      else if (key === MonstAbil.FIELD) extra = tagOf(fieldNames, a.gen.extra, 'field');
      else if (key === MonstAbil.STATUS || key === MonstAbil.STATUS2 || key === MonstAbil.STUN) {
        extra = tagOf(pcStatus, a.gen.extra, 'status');
      }
      return `            <general type="${type}">
                <type>${tagOf(monstAbilTypes, a.gen.type, 'ability delivery')}</type>
                <missile>${a.gen.pic}</missile>
                <strength>${a.gen.strength}</strength>
                <range>${a.gen.range}</range>
${extra ? `                <extra>${extra}</extra>\n` : ''}                <chance>${pct(a.gen.odds)}</chance>
            </general>\n`;
    }
    case MonstAbilCat.SUMMON: {
      const what = a.summon.type === MonstSummon.SPECIES
        ? `<race>${tagOf(raceNames, a.summon.what, 'race')}</race>`
        : `<${tagOf(monstSummons, a.summon.type, 'summon kind')}>${a.summon.what}</${monstSummons[a.summon.type]}>`;
      return `            <summon type="${type}">
                ${what}
                <min>${a.summon.min}</min>
                <max>${a.summon.max}</max>
                <duration>${a.summon.len}</duration>
                <chance>${pct(a.summon.chance)}</chance>
            </summon>\n`;
    }
    case MonstAbilCat.RADIATE:
      return `            <radiate type="${type}">
                <type>${tagOf(fieldNames, a.radiate.type, 'field')}</type>
                <pattern>${tagOf(spellPats, a.radiate.pat, 'pattern')}</pattern>
                <chance>${a.radiate.chance}</chance>
            </radiate>\n`;
    case MonstAbilCat.SPECIAL:
      return `            <special type="${type}">
                <param>${a.special.extra1}</param>
                <param>${a.special.extra2}</param>
                <param>${a.special.extra3}</param>
            </special>\n`;
    default:
      throw new Error(`monster ability ${key} has no category`);
  }
}

export function monsterXml(m: Monster, id: number): string {
  const abilities: string[] = [];
  if (m.invisible) abilities.push('            <invisible />\n');
  if (m.guard) abilities.push('            <guard />\n');
  m.abil.forEach((a, key) => { if (a.active) abilities.push(abilityXml(m, key)); });
  const resist = Array.from({ length: NUM_DAMAGE_TYPES }, (_, i) =>
    `            <${dmgNames[i]}>${m.resist[i] ?? 100}</${dmgNames[i]}>\n`).join('');
  const loot = m.corpseItem !== 0 || m.corpseItemChance !== 0
    ? `        <loot>\n            <type>${m.corpseItem}</type>\n            <chance>${m.corpseItemChance}</chance>\n        </loot>\n`
    : '';
  return `    <monster id="${id}">
        <name>${esc(m.name)}</name>
        <default-face>${m.defaultFacialPic}</default-face>
        <pic w="${m.xWidth}" h="${m.yWidth}">${m.pictureNum}</pic>
        <race>${tagOf(raceNames, m.race, 'race')}</race>
        <level>${m.level}</level>
        <armor>${m.armor}</armor>
        <skill>${m.skill}</skill>
        <hp>${m.health}</hp>
        <speed>${m.speed}</speed>
        <mage>${m.mu}</mage>
        <priest>${m.cl}</priest>
        <attitude>${tagOf(attitudeStrs, m.defaultAttitude, 'attitude')}</attitude>
        <summon>${m.summonType}</summon>
        <treasure>${m.treasure}</treasure>
        <onsight>${m.seeSpec}</onsight>
        <voice>${m.ambientSound}</voice>
        <attacks>
${m.attacks.map((a) => `            <attack type="${tagOf(monstMelee, a.type, 'attack')}">${dice(a.dice, a.sides)}</attack>\n`).join('')}        </attacks>
        <immunity>
${resist}            <all>${m.invuln}</all>
            <fear>${m.mindless}</fear>
            <assassinate>${m.amorphous}</assassinate>
        </immunity>
        <abilities>
${abilities.join('')}        </abilities>
${loot}    </monster>
`;
}

/** `monsters[0]` is the reserved empty monster and is not written. */
export function monstersXml(monsters: Monster[]): string {
  return `${XML_HEAD}<monsters boes="2.0.0">\n${monsters.slice(1).map((m, i) => monsterXml(m, i + 1)).join('')}</monsters>\n`;
}

export function itemXml(it: Item, id: number): string {
  const weap = it.weapType >= 0 ? `        <weapon-type>${tagOf(skillNames, it.weapType, 'skill')}</weapon-type>\n` : '';
  return `    <item id="${id}">
        <variety>${tagOf(itemTypes, it.variety, 'item variety')}</variety>
        <level>${it.itemLevel}</level>
        <awkward>${it.awkward}</awkward>
        <bonus>${it.bonus}</bonus>
        <protection>${it.protection}</protection>
        <charges>${it.charges}</charges>
${weap}        <missile-type>${it.missile}</missile-type>
        <pic>${it.graphicNum}</pic>
        <flag>${it.typeFlag}</flag>
        <value>${it.value}</value>
        <weight>${it.weight}</weight>
        <class>${it.specialClass}</class>
        <name>${esc(it.name)}</name>
        <full-name>${esc(it.fullName)}</full-name>
        <treasure>${it.treasClass}</treasure>
        <ability>
            <type>${tagOf(itemAbils, it.ability, 'item ability')}</type>
            <strength>${it.abilStrength}</strength>
            <data>${it.abilData}</data>
            <use-flag>${tagOf(itemUses, it.magicUseType, 'use flag')}</use-flag>
        </ability>
        <properties>
            <identified>${it.ident}</identified>
            <magic>${it.magic}</magic>
            <cursed>${it.cursed}</cursed>
            <concealed>${it.concealed}</concealed>
            <enchanted>${it.enchanted}</enchanted>
            <rechargeable>${it.rechargeable}</rechargeable>
            <unsellable>${it.unsellable}</unsellable>
${it.ineptOk ? '            <inept-ok>true</inept-ok>\n' : ''}        </properties>
${it.desc ? `        <description>${esc(it.desc)}</description>\n` : ''}${it.e3Ability >= 0 ? `        <e3-ability>${it.e3Ability}</e3-ability>\n` : ''}${it.e3Item >= 0 ? `        <e3-item>${it.e3Item}</e3-item>\n` : ''}    </item>
`;
}

export function itemsXml(items: Item[]): string {
  return `${XML_HEAD}<items boes="2.0.0">\n${items.map((it, i) => itemXml(it, i)).join('')}</items>\n`;
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/**
 * `talk<n>.xml`, the inverse of `readDialogueFromXml`: all ten personalities
 * (ids `town*10 …`), then the nodes. Text goes in CDATA, as the bundled files
 * have it; the reader trims it either way.
 */
export function dialogueXml(talk: Speech, townNum: number): string {
  const people = talk.people.map((p, i) => `    <personality id="${townNum * 10 + i}">
        <title>${cdata(p.title)}</title>
        <look>${cdata(p.look)}</look>
        <name>${cdata(p.name)}</name>
        <job>${cdata(p.job)}</job>
        <unknown>${cdata(p.dunno)}</unknown>
    </personality>
`).join('');
  const nodes = talk.talkNodes.map((n) => `    <node for="${n.personality}">
        <keyword>${esc(n.link1)}</keyword>
        <keyword>${esc(n.link2)}</keyword>
        <type>${tagOf(talkNodes, n.type, 'talk node type')}</type>
${n.extras.map((x) => `        <param>${x}</param>\n`).join('')}        <text>${cdata(n.str1)}</text>
        <text>${cdata(n.str2)}</text>
    </node>
`).join('');
  return `${XML_HEAD}<dialogue boes="2.0.0">\n${people}${nodes}</dialogue>\n`;
}

/** A spell or recipe's price when nothing overrides it. */
function defaultSpecialCost(type: ShopItemType, n: number): number {
  const probe = new Shop();
  probe.addSpecial(type, n);
  return probe.getItem(0).item.value;
}

const SIMPLE_ENTRY_TAGS: Partial<Record<ShopItemType, string>> = {
  [ShopItemType.MAGE_SPELL]: 'mage-spell',
  [ShopItemType.PRIEST_SPELL]: 'priest-spell',
  [ShopItemType.ALCHEMY]: 'recipe',
  [ShopItemType.SKILL]: 'skill',
  [ShopItemType.TREASURE]: 'treasure',
  [ShopItemType.CLASS]: 'class',
};

function shopEntryXml(e: ShopItem): string {
  const pad = '                ';
  switch (e.type) {
    case ShopItemType.EMPTY:
      return '';
    case ShopItemType.ITEM:
      return `${pad}<item${e.quantity === 0 ? '' : ` quantity="${e.quantity}"`}>${e.index}</item>\n`;
    case ShopItemType.OPT_ITEM: {
      // addItem packs the chance into the thousands place.
      const amount = e.quantity % 1000;
      return `${pad}<item quantity="${amount === 0 ? 'infinite' : amount}" chance="${Math.floor(e.quantity / 1000)}">${e.index}</item>\n`;
    }
    case ShopItemType.CALL_SPECIAL:
      return `${pad}<special>
${pad}    <quantity>${e.quantity === 0 ? 'infinite' : e.quantity}</quantity>
${pad}    <cost>${e.item.value}</cost>
${pad}    <node>${e.item.itemLevel}</node>
${pad}    <icon>${e.item.graphicNum}</icon>
${pad}    <name>${esc(e.item.fullName)}</name>
${pad}    <description>${esc(e.item.desc)}</description>
${pad}</special>\n`;
    default: {
      if (e.type >= ShopItemType.HEAL_WOUNDS) return `${pad}<heal>${e.index}</heal>\n`;
      const t = SIMPLE_ENTRY_TAGS[e.type];
      if (t === undefined) throw new Error(`no shop entry tag for type ${e.type}`);
      // `cost=` is the blades-of-exile-ts extension readShopEntries documents.
      const priced = e.type === ShopItemType.MAGE_SPELL || e.type === ShopItemType.PRIEST_SPELL
        || e.type === ShopItemType.ALCHEMY;
      const cost = priced && e.item.value !== defaultSpecialCost(e.type, e.index) ? ` cost="${e.item.value}"` : '';
      return `${pad}<${t}${cost}>${e.index}</${t}>\n`;
    }
  }
}

/** One `<shop>` of scenario.xml, the inverse of `readShopFromXml`. */
export function shopXml(shop: Shop): string {
  return `        <shop>
            <name>${esc(shop.name)}</name>
            <type>${tagOf(SHOP_TYPE_TAGS, shop.type, 'shop type')}</type>
            <prompt>${tagOf(SHOP_PROMPT_TAGS, shop.prompt, 'shop prompt')}</prompt>
            <face>${shop.face}</face>
            <entries>
${shop.items.map(shopEntryXml).join('')}            </entries>
        </shop>
`;
}

/** One `<special-item>` of scenario.xml, the inverse of `readSpecItemFromXml`. */
export function specialItemXml(item: SpecItem): string {
  const attrs = [
    item.special >= 0 ? ` special="${item.special}"` : '',
    specItemStartWith(item) ? ' start-with="true"' : '',
    specItemUseable(item) ? ' useable="true"' : '',
  ].join('');
  return `        <special-item${attrs}>
            <name>${esc(item.name)}</name>
            <description>${esc(item.descr)}</description>
        </special-item>
`;
}
