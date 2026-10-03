import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTar, sameTarContents, writeTar } from '../src/fileio/tarball';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const files = (party: string) => [
  { name: 'save/party.txt', data: text(party) },
  { name: 'save/town.txt', data: text('TOWN 3\n'.repeat(200)) },
];

describe('sameTarContents', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ignores the time each header was written', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    const a = writeTar(files('GOLD 10\n'));
    vi.setSystemTime(1_000_123_000);
    const b = writeTar(files('GOLD 10\n'));
    expect(a).not.toEqual(b);
    expect(sameTarContents(a, b)).toBe(true);
    expect(readTar(b).map((e) => e.name)).toEqual(['save/party.txt', 'save/town.txt']);
  });

  it('notices a change anywhere in a file, or in a name', () => {
    const a = writeTar(files('GOLD 10\n'));
    expect(sameTarContents(a, writeTar(files('GOLD 11\n')))).toBe(false);
    const renamed = writeTar([{ name: 'save/partY.txt', data: text('GOLD 10\n') }, files('')[1]!]);
    expect(sameTarContents(a, renamed)).toBe(false);
  });
});
