/**
 * The converter's monsters.xml / items.xml writers (tools/e3convert/xmlWrite)
 * against the port's readers: every bundled scenario's monsters and items,
 * read, written back out, and read again, must come back identical.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readItemsFromXml } from '../src/fileio/itemsXml';
import { readMonstersFromXml } from '../src/fileio/monstersXml';
import { readDialogueFromXml } from '../src/fileio/townXml';
import { parseXmlDoc } from '../src/fileio/xml';
import { readShopFromXml, readSpecItemFromXml } from '../src/fileio/scenarioXml';
import { readdirSync } from 'node:fs';
import { dialogueXml, itemsXml, monstersXml, shopXml, specialItemXml } from '../tools/e3convert/xmlWrite';

const root = (xml: string, name: string) => parseXmlDoc(xml, name);

describe.each(['valleydy', 'stealth', 'zakhazi', 'busywork'])('%s', (scen) => {
  const file = (n: string) => readFileSync(new URL(`../public/scenarios/${scen}/${n}`, import.meta.url), 'utf8');

  it('monsters survive a round trip through the writer', async () => {
    const before = readMonstersFromXml(await root(file('monsters.xml'), 'monsters.xml'));
    const after = readMonstersFromXml(await root(monstersXml(before), 'written'));
    expect(after).toEqual(before);
  });

  it('items survive a round trip through the writer', async () => {
    const before = readItemsFromXml(await root(file('items.xml'), 'items.xml'));
    const after = readItemsFromXml(await root(itemsXml(before), 'written'));
    expect(after).toEqual(before);
  });

  it('dialogue survives a round trip through the writer', async () => {
    const towns = readdirSync(new URL(`../public/scenarios/${scen}/towns`, import.meta.url))
      .map((f) => /^talk(\d+)\.xml$/.exec(f)?.[1]).filter((n): n is string => n !== undefined).map(Number);
    expect(towns.length).toBeGreaterThan(0);
    for (const t of towns) {
      const before = readDialogueFromXml(await root(file(`towns/talk${t}.xml`), 'talk'), t, 'talk');
      const after = readDialogueFromXml(await root(dialogueXml(before, t), 'written'), t, 'written');
      expect(after).toEqual(before);
    }
  });

  it('shops and special items survive a round trip through the writer', async () => {
    const doc = await root(file('scenario.xml'), 'scenario.xml');
    const all = (name: string) => Array.from(doc.getElementsByTagName(name));
    for (const el of all('shop')) {
      const before = readShopFromXml(el);
      const again = await root(shopXml(before), 'written');
      expect(readShopFromXml(again)).toEqual(before);
    }
    for (const el of all('special-item')) {
      const before = readSpecItemFromXml(el);
      const again = await root(specialItemXml(before), 'written');
      expect(readSpecItemFromXml(again)).toEqual(before);
    }
  });
});
