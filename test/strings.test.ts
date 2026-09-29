import { describe, expect, it } from 'vitest';
import { getStr, overrideStrings, setStrings, stringCount } from '../src/data/strings';

describe("a scenario's own lines for a string table", () => {
  it('replaces the lines it has and keeps the game\'s where it is blank', () => {
    setStrings('test-help', 'one\ntwo\nthree\n');
    overrideStrings('test-help', 'ONE\n\nTHREE\nFOUR\n');
    expect([1, 2, 3, 4].map((n) => getStr('test-help', n))).toEqual(['ONE', 'two', 'THREE', 'FOUR']);
    expect(stringCount('test-help')).toBe(4);
  });
});
