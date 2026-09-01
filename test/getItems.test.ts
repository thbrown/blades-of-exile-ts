/**
 * `GetItemsPick` — the pick-up-items screen with no screen attached.
 *
 * The point of this class is that the live dialog and the replay driver drive
 * it through the *same* `click(id)` with the C++'s own control names, so these
 * tests are written against those names rather than against the dialog.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemType } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { GetItemsPick, NOBODY } from '../src/game/getItems';
import { GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus } from '../src/universe/skills';
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

function started(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

/** The pile on the floor, as `get_item` would have gathered it. */
function pile(s: GameSession) {
  return s.reachableItems(s.univ.party.townLoc).items;
}

describe('the get-items screen', () => {
  it('starts on the current PC', () => {
    const s = started();
    s.univ.curPc = 2;
    expect(new GetItemsPick(s, pile(s)).who).toBe(2);
  });

  it('hands the pile to whichever PC button was clicked', () => {
    const s = started();
    const pick = new GetItemsPick(s, pile(s));
    pick.click('pc4');
    expect(pick.who).toBe(3);
  });

  /**
   * The C++ hides a button it can't use, so this click cannot happen there —
   * but a *recording* can still name it, and quietly handing the pile to a dead
   * PC would be worse than ignoring it.
   */
  it('ignores a click on a PC who cannot carry anything', () => {
    const s = started();
    s.univ.party.pcs[3]!.mainStatus = MainStatus.DEAD;
    const pick = new GetItemsPick(s, pile(s));
    const before = pick.who;
    pick.click('pc4');
    expect(pick.who).toBe(before);
  });

  it('takes the item under the row that was clicked, and drops it out of the list', () => {
    const s = started();
    // Put something reachable on the party's own square.
    const town = s.univ.town!;
    const loc = { ...s.univ.party.townLoc };
    town.items.push({
      ...town.items[0]!, variety: ItemType.POTION, name: 'Test Potion',
      // Not anyone's property: `take` would stop and raise `steal-item`
      // otherwise, and this test is about the taking.
      itemLoc: loc, contained: false, ident: true, property: false,
    });
    const items = pile(s);
    const target = items.findIndex((i) => i.name === 'Test Potion');
    expect(target).toBeGreaterThanOrEqual(0);
    const before = items.length;

    const pick = new GetItemsPick(s, items);
    pick.click('pc1');
    // Row buttons are one-based and relative to the scroll position.
    pick.first = 0;
    pick.take(target);

    expect(pick.items.length).toBe(before - 1);
    expect(s.univ.party.pcs[0]!.items.some((i) => i.name === 'Test Potion')).toBe(true);
  });

  it('closes only on Done', () => {
    const s = started();
    const pick = new GetItemsPick(s, pile(s));
    expect(pick.click('pc2')).toBe('stay');
    expect(pick.click('up')).toBe('stay');
    expect(pick.click('item1-key')).toBe('stay');
    expect(pick.click('done')).toBe('done');
  });

  /** Eight rows at a time; the arrows only move in whole pages. */
  it('scrolls a page at a time and will not run off either end', () => {
    const s = started();
    const pick = new GetItemsPick(s, pile(s));
    pick.click('up');
    expect(pick.first).toBe(0);
    // With fewer than eight items there is nowhere to go.
    if (pick.items.length <= 8) {
      pick.click('down');
      expect(pick.first).toBe(0);
    }
  });

  it('reports nobody when the whole party is down', () => {
    const s = started();
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    const pick = new GetItemsPick(s, pile(s));
    expect(pick.who).toBe(NOBODY);
    // And a row click then does nothing rather than throwing.
    expect(() => pick.click('item1-key')).not.toThrow();
  });
});
