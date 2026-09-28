/**
 * The spell picker's description click: alt-click under OBoE's look
 * (`pick_spell_select_led`'s `mod_alt`), right- or ctrl-click under E3's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { CastDialog } from '../src/dialogs/castDialog';
import type { ClickMods } from '../src/dialogs/dialog';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { centreOnDesktop } from '../src/render/desktop';
import { BOE_HEIGHT, BOE_WIDTH } from '../src/render/layout';
import { SheetStore } from '../src/render/sheets';
import { PartyPreset } from '../src/universe/player';
import { Skill } from '../src/universe/skills';
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

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {};
  return {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText: noop, fillRect: noop, strokeRect: noop, drawImage: noop,
    save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop,
    moveTo: noop, lineTo: noop, stroke: noop, createPattern: () => null,
  } as unknown as CanvasRenderingContext2D;
}

/** A picker on the party's mage spells, recording what it asks to describe. */
function picker(e3: boolean): { dlg: CastDialog; described: [string, number][] } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  if (e3) univ.scenario.featureFlags['backgrounds'] = 'exile3';
  else delete univ.scenario.featureFlags['backgrounds'];
  const session = new GameSession(univ);
  session.startNewGame();
  const dlg = new CastDialog(fakeCtx(), new SheetStore(), session, Skill.MAGE_SPELLS, true);
  const described: [string, number][] = [];
  dlg.onDescribe = (kind, num) => { described.push([kind, num]); };
  return { dlg, described };
}

/** Click a spell's lamp in the first column (FRAME 2 + 10 + 6, 2 + 247 + 14 per row). */
function clickFirstSpell(dlg: CastDialog, mods?: ClickMods, row = 0): string | null {
  const origin = centreOnDesktop(BOE_WIDTH, BOE_HEIGHT);
  return dlg.onClick(origin.x + 20, origin.y + 252 + row * 14, mods);
}

describe('the spell description click', () => {
  it('alt-click describes the spell under OBoE, and does not pick it', () => {
    const { dlg, described } = picker(false);
    dlg.onKey(' '); // levels 5-7, so the choice (level 1's first) is elsewhere
    const before = { ...dlg.choice };
    expect(clickFirstSpell(dlg, { alt: true })).toBeNull();
    expect(described).toEqual([['mage', 38]]);
    expect(dlg.choice).toEqual(before);
    // OBoE does not answer E3's right-click.
    clickFirstSpell(dlg, { right: true });
    expect(described).toHaveLength(1);
    expect(dlg.choice).toEqual(before);
  });

  it("right-click and ctrl-click describe it under E3's look", () => {
    const { dlg, described } = picker(true);
    clickFirstSpell(dlg, { right: true });
    clickFirstSpell(dlg, { ctrl: true });
    clickFirstSpell(dlg, { alt: true });
    expect(described).toEqual([['mage', 0], ['mage', 0]]);
  });

  it('a plain click still goes to the picker', () => {
    // The second spell is beyond this caster, so the picker answers with the
    // feedback line — which a description click leaves alone.
    const { dlg, described } = picker(false);
    const feedback = (d: CastDialog): string => (d as unknown as { feedback: string }).feedback;
    clickFirstSpell(dlg, { alt: true }, 1);
    expect(feedback(dlg)).toBe('Pick spell to cast.');
    clickFirstSpell(dlg, undefined, 1);
    expect(described).toEqual([['mage', 1]]);
    expect(feedback(dlg)).toBe(' Spell not available.');
  });
});
