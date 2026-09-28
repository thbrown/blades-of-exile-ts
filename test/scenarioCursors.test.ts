import { afterEach, describe, expect, it } from 'vitest';
import { cursorCss, setScenarioCursors } from '../src/platform/cursors';

/** A scenario's `cursors` flag swaps the pictures, hotspots and all. */
describe("a scenario's own cursors", () => {
  afterEach(() => setScenarioCursors(undefined, () => ''));

  it('replaces the named ones and leaves the rest as BoE drew them', () => {
    setScenarioCursors('sword:7:9,look:16:16,nonsense:1:1', (n) => `own/${n}.png`);
    expect(cursorCss('sword')).toBe('url(own/sword.png) 7 9, auto');
    expect(cursorCss('look')).toBe('url(own/look.png) 16 16, auto');
    expect(cursorCss('boot')).toContain('data/cursors/boot.gif');
    setScenarioCursors(undefined, (n) => `own/${n}.png`);
    expect(cursorCss('sword')).toContain('data/cursors/sword.gif');
  });
});
