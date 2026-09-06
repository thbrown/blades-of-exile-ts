import { describe, expect, it } from 'vitest';
import { calcRect, findGraphic } from '../src/render/sheets';
import { pcGraphic } from '../src/render/pcPics';
import { monsterGraphic } from '../src/render/monsterPics';
import { Direction } from '../src/core/location';

describe('tile sheet math (gfxsheets.cpp)', () => {
  it('calc_rect offsets the 28x36 base rect', async () => {
    const r = calcRect(3, 2);
    expect(r.left).toBe(84);
    expect(r.top).toBe(72);
    expect(r.width).toBe(28);
    expect(r.height).toBe(36);
  });

  it('find_graphic maps pic number to sheet + cell rect', async () => {
    // pic 0 → sheet 0, cell (0,0)
    expect(findGraphic(0)).toMatchObject({ sheet: 0, rect: { left: 0, top: 0 } });
    // pic 57 → sheet 0, col 7 row 5
    expect(findGraphic(57)).toMatchObject({ sheet: 0, rect: { left: 196, top: 180 } });
    // pic 234 → sheet 2, cell 34 → col 4 row 3
    expect(findGraphic(234)).toMatchObject({ sheet: 2, rect: { left: 112, top: 108 } });
  });
});

/**
 * The attack pose — `draw_combat_pc`'s third argument (boe.graphutil.cpp:221)
 * and `pic_mode += 10` for creatures (:200). The two layouts move it
 * differently, which is the whole reason this is worth pinning.
 */
describe('the attack pose', () => {
  it('a pcs-sheet graphic drops 288 pixels, and nothing else moves', async () => {
    const standing = pcGraphic(5, Direction.N)!;
    const swinging = pcGraphic(5, Direction.N, true)!;
    expect(swinging.sheetName).toBe(standing.sheetName);
    expect(swinging.rect.left).toBe(standing.rect.left);
    expect(swinging.rect.top).toBe(standing.rect.top + 288);
    expect(swinging.rect.bottom).toBe(standing.rect.bottom + 288);
  });

  it('…and facing right still moves it one column, in either pose', async () => {
    const left = pcGraphic(5, Direction.N, true)!;
    const right = pcGraphic(5, Direction.S, true)!;
    expect(right.rect.left).toBe(left.rect.left + 28);
    expect(right.rect.top).toBe(left.rect.top);
  });

  /**
   * A PC whose graphic is 100 or more borrows a monster sprite, and there the
   * pose is `+10` on the *mode* — four columns along, not 288 pixels down.
   */
  it('a borrowed monster graphic uses the mode instead', async () => {
    const direct = monsterGraphic(3, 10, 0)!;
    const viaPc = pcGraphic(103, Direction.N, true)!;
    expect(viaPc).toEqual(direct);
  });

  it('and a creature\'s attack sprite is four columns along', async () => {
    const standing = monsterGraphic(3, 0, 0)!;
    const swinging = monsterGraphic(3, 10, 0)!;
    expect(swinging.sheetName).toBe(standing.sheetName);
    expect(swinging.rect.left).toBe(standing.rect.left + 4 * 28);
    expect(swinging.rect.top).toBe(standing.rect.top);
  });
});
