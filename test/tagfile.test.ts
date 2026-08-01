import { describe, expect, it } from 'vitest';
import { TagFile, maybeQuoteString, readMaybeQuotedString } from '../src/fileio/tagfile';
import { Tarball, readTar, writeTar } from '../src/fileio/tarball';

describe('maybe_quote_string', () => {
  it('leaves a plain word alone', () => {
    expect(maybeQuoteString('SDF')).toBe('SDF');
  });

  it('writes the empty string as a pair of apostrophes', () => {
    expect(maybeQuoteString('')).toBe("''");
  });

  it('quotes anything with whitespace in it', () => {
    expect(maybeQuoteString('Fort Talrus')).toBe("'Fort Talrus'");
  });

  it('uses the double quote only when it appears strictly fewer times', () => {
    expect(maybeQuoteString(`he said "no" to me`)).toBe(`'he said "no" to me'`);
    expect(maybeQuoteString(`it's a test`)).toBe(`"it's a test"`);
    // Two double quotes against one apostrophe still picks the apostrophe, and
    // escapes it — the comparison is on the count, not on the escaping cost.
    expect(maybeQuoteString(`it's a "test" now`)).toBe(`'it\\'s a "test" now'`);
  });

  it('escapes backslashes, newlines and form feeds', () => {
    expect(maybeQuoteString('a\nb')).toBe("'a\\nb'");
    expect(maybeQuoteString('a b\\c')).toBe("'a b\\\\c'");
    expect(maybeQuoteString('a\fb')).toBe("'a\\fb'");
  });
});

describe('read_maybe_quoted_string', () => {
  it('round-trips everything maybe_quote_string produces', () => {
    for (const s of ['plain', '', 'two words', 'a\nb', 'back\\slash', `mixed 'and "quotes`]) {
      const [got] = readMaybeQuotedString(maybeQuoteString(s), 0);
      expect(got).toBe(s);
    }
  });

  it('yields the empty string at the end of the input', () => {
    expect(readMaybeQuotedString('   ', 0)).toEqual(['', 3]);
  });
});

describe('cTagFile', () => {
  it('round-trips pages, repeated keys and values', () => {
    const file = new TagFile();
    const page = file.add();
    page.add('AGE', 1234);
    page.add('SDF', 3, 4, 1);
    page.add('SDF', 5, 6, 2);
    page.add('SCENARIO', 'Valley of Dying Things');
    page.add('EASY', false);
    const second = file.add();
    second.add('BOAT', 0);

    const back = TagFile.parse(file.serialise());
    expect(back.pages).toHaveLength(2);
    const p = back.at(0)!;
    expect(p.first('AGE')!.int(0)).toBe(1234);
    expect(p.list('SDF')).toHaveLength(2);
    expect(p.list('SDF')[1]!.values).toEqual(['5', '6', '2']);
    expect(p.first('SCENARIO')!.str(0)).toBe('Valley of Dying Things');
    expect(p.first('EASY')!.bool(0)).toBe(false);
    expect(back.at(1)!.first('BOAT')!.int(0)).toBe(0);
  });

  it('gives a bare keyword line exactly one empty value, as the C++ does', () => {
    const back = TagFile.parse('OBOE\n');
    expect(back.at(0)!.first('OBOE')!.values).toEqual(['']);
    expect(back.at(0)!.firstKey()).toBe('OBOE');
  });

  it('reads booleans by the four true words', () => {
    const p = TagFile.parse('A true\nB yes\nC on\nD 1\nE false\nF wat\n').at(0)!;
    expect(['A', 'B', 'C', 'D'].map((k) => p.first(k)!.bool(0))).toEqual([true, true, true, true]);
    expect(['E', 'F'].map((k) => p.first(k)!.bool(0))).toEqual([false, false]);
  });

  it('walks a repeated key with the read cursor, then resets', () => {
    const p = TagFile.parse('X 1\nX 2\n').at(0)!;
    expect(p.next('X')!.int(0)).toBe(1);
    expect(p.next('X')!.int(0)).toBe(2);
    expect(p.next('X')).toBeUndefined();
    expect(p.next('X')!.int(0)).toBe(1);
  });

  it('encodes and extracts a sparse array', () => {
    const page = TagFile.parse('').add();
    page.encodeSparse('STATUS', [0, 0, 7, 0, -3]);
    expect(page.list('STATUS').map((t) => t.values)).toEqual([
      ['2', '7'],
      ['4', '-3'],
    ]);
    const into: number[] = [];
    page.extractSparse('STATUS', into);
    expect(into).toEqual([0, 0, 7, 0, -3]);
  });

  it('survives a value containing a form feed by escaping it', () => {
    const file = new TagFile();
    file.add().add('STRING', 'page\fbreak');
    const back = TagFile.parse(file.serialise());
    expect(back.pages).toHaveLength(1);
    expect(back.at(0)!.first('STRING')!.str(0)).toBe('page\fbreak');
  });
});

describe('tarball', () => {
  it('round-trips files of assorted sizes', () => {
    const entries = [
      { name: 'save/party.txt', data: new TextEncoder().encode('AGE 5\n') },
      { name: 'save/empty.txt', data: new Uint8Array(0) },
      { name: 'save/big.dat', data: new Uint8Array(1200).fill(0x41) },
    ];
    const back = readTar(writeTar(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(back[0]!.data).toEqual(entries[0]!.data);
    expect(back[1]!.data).toHaveLength(0);
    expect(back[2]!.data).toEqual(entries[2]!.data);
  });

  it('pads every entry to a 512-byte boundary and writes no end marker', () => {
    const out = writeTar([{ name: 'a', data: new Uint8Array(1) }]);
    expect(out).toHaveLength(1024);
  });

  it('writes a ustar header with the C++ checksum spelling', () => {
    const header = writeTar([{ name: 'save/party.txt', data: new Uint8Array(0) }]).subarray(0, 512);
    const text = (from: number, len: number) =>
      new TextDecoder().decode(header.subarray(from, from + len)).replace(/\0.*$/, '');
    expect(text(0, 100)).toBe('save/party.txt');
    expect(text(257, 6)).toBe('ustar');
    expect(text(124, 12)).toBe('00000000000');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    expect(text(148, 8)).toBe(sum.toString(8));
  });

  it('rejects a file name too long for the header', () => {
    expect(() => writeTar([{ name: 'x'.repeat(100), data: new Uint8Array(0) }])).toThrow(/99/);
  });

  it('offers the files by name through Tarball', () => {
    const ball = new Tarball();
    ball.addText('save/party.txt', 'AGE 5\n');
    const back = Tarball.read(ball.serialise());
    expect(back.has('save/party.txt')).toBe(true);
    expect(back.has('save/pc1.txt')).toBe(false);
    expect(back.text('save/party.txt')).toBe('AGE 5\n');
    expect(back.get('save/pc1.txt')).toBeUndefined();
  });
});
