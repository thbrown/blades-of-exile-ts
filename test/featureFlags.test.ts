/**
 * Feature flags — the mechanism by which the C++ reproduces its own history.
 *
 * The rule that matters and is easy to get backwards: on replay the recorded
 * set **replaces** the build's, so a flag the recording never mentions is
 * *off*, not defaulted.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  SUPPORTED_FEATURES, currentFeatureFlags, hasFeatureFlag, resetFeatureFlags,
  scenarioFeatureGap, setFeatureFlags,
} from '../src/game/featureFlags';
import { parseReplay, writeReplay } from '../src/replay/format';
import { parseXmlDoc } from '../src/fileio/xml';

afterEach(() => { resetFeatureFlags(); });

describe('feature flags', () => {
  it('starts as everything this build supports', () => {
    expect(hasFeatureFlag('empty-wandering-monster-bug', 'fixed')).toBe(true);
    expect(hasFeatureFlag('target-lock', 'V1')).toBe(true);
    expect(hasFeatureFlag('target-lock', 'V2')).toBe(true);
  });

  it('answers no for a version it does not have, and for a flag it has never heard of', () => {
    expect(hasFeatureFlag('target-lock', 'V3')).toBe(false);
    expect(hasFeatureFlag('no-such-feature', 'V1')).toBe(false);
  });

  /**
   * The whole point. A recording that lists two flags runs with *those two*,
   * and everything else off — including flags this build supports perfectly
   * well, because the recording was made before they existed.
   */
  it('replaces the whole set, so an unlisted flag is off rather than defaulted', () => {
    setFeatureFlags({ 'target-lock': ['V1'] });
    expect(hasFeatureFlag('target-lock', 'V1')).toBe(true);
    // Supported by the build, absent from the recording, therefore off.
    expect(hasFeatureFlag('empty-wandering-monster-bug', 'fixed')).toBe(false);
    // And a version the recording did not list is off too.
    expect(hasFeatureFlag('target-lock', 'V2')).toBe(false);
  });

  it('an empty set turns everything off', () => {
    setFeatureFlags({});
    for (const flag of Object.keys(SUPPORTED_FEATURES)) {
      for (const version of SUPPORTED_FEATURES[flag]!) {
        expect(hasFeatureFlag(flag, version)).toBe(false);
      }
    }
  });

  /**
   * Refusing beats guessing: running a recording with a feature this build
   * cannot produce would give a different game and blame the divergence on
   * whatever surfaced first.
   */
  it('refuses a recording that needs a version this build cannot produce', () => {
    expect(() => setFeatureFlags({ 'target-lock': ['V9'] }))
      .toThrow(/target-lock should support 'V9'/);
    expect(() => setFeatureFlags({ 'invented-feature': ['V1'] }))
      .toThrow(/invented-feature/);
  });

  it('resets to the build defaults', () => {
    setFeatureFlags({});
    resetFeatureFlags();
    expect(hasFeatureFlag('magic-resistance', 'fixed')).toBe(true);
  });

  it('reports the set in force, for a recording to write down', () => {
    setFeatureFlags({ 'talk-go-back': ['StackV1'] });
    expect(currentFeatureFlags()).toEqual({ 'talk-go-back': ['StackV1'] });
  });
});

describe('the flag block in a replay file', () => {
  const doc = `<actions>
    <feature_flags>
      <empty-wandering-monster-bug><version>fixed</version></empty-wandering-monster-bug>
      <target-lock><version>V1</version><version>V2</version></target-lock>
    </feature_flags>
    <srand>7</srand>
    <move>(3,4)</move>
  </actions>`;

  it('reads a flag with several versions', async () => {
    const replay = parseReplay(await parseXmlDoc(doc, 'r.xml'));
    expect(replay.featureFlags).toEqual({
      'empty-wandering-monster-bug': ['fixed'],
      'target-lock': ['V1', 'V2'],
    });
  });

  /**
   * It is an action as well as a field: the C++ pops it off the same stream
   * during startup, so it has to keep its place in the order.
   */
  it('keeps it in the action list too', async () => {
    const replay = parseReplay(await parseXmlDoc(doc, 'r.xml'));
    expect(replay.actions.map((a) => a.type)).toEqual(['feature_flags', 'move']);
  });

  it('round-trips without dropping a version or writing the block twice', async () => {
    const replay = parseReplay(await parseXmlDoc(doc, 'r.xml'));
    const again = parseReplay(await parseXmlDoc(writeReplay(replay), 'r.xml'));
    expect(again.featureFlags).toEqual(replay.featureFlags);
    expect(again.actions.map((a) => a.type)).toEqual(['feature_flags', 'move']);
  });

  /** No block at all is distinct from an empty one, and reads as `null`. */
  it('reports a missing block as null', async () => {
    const replay = parseReplay(await parseXmlDoc('<actions><move>(1,1)</move></actions>', 'r.xml'));
    expect(replay.featureFlags).toBeNull();
  });
});

/**
 * `put_party_in_scen`'s gate (boe.party.cpp:188). It asks `has_feature_flag`,
 * so it reads the set **in force** — which during a replay is the recording's,
 * not this build's, and that is the whole reason the C++ refuses to launch
 * Za-Khazi in `short/bad-item-graphic.xml`.
 */
describe('the gate a scenario has to pass to be played at all', () => {
  it('passes a scenario whose features this build has', () => {
    expect(scenarioFeatureGap({ 'conveyor-belts': 'V2' })).toBeNull();
    expect(scenarioFeatureGap({})).toBeNull();
  });

  it('refuses one the set in force does not cover, however capable the build is', () => {
    // The build supports conveyor-belts V2 (see SUPPORTED_FEATURES) — but a
    // recording that does not mention the flag turns it off.
    setFeatureFlags({ 'target-lock': ['V1'] });
    expect(scenarioFeatureGap({ 'conveyor-belts': 'V2' }))
      .toMatch(/conveyor-belts should support 'V2'/);
  });

  it('names the first flag it cannot supply, in the C++\'s wording', () => {
    resetFeatureFlags();
    expect(scenarioFeatureGap({ 'made-up-feature': 'V9' }))
      .toBe('This scenario requires a feature that is not supported in your version '
        + "of Blades of Exile: made-up-feature should support 'V9'");
  });
});
