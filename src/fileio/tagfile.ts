// Port of src/fileio/tagfile.cpp + the two string helpers in fileio.cpp:146/182.
//
// A tag file is the save format's text container. A file is a list of *pages*
// separated by form feeds; a page is a list of *tags*, one per line, each
// `KEY value value ...` with the values quoted only when they need it. Keys
// repeat freely — `SDF` appears once per set flag — so a page keeps both the
// ordered list (which is what gets written back out) and a per-key list with
// its own read cursor, exactly as cTagFile_Page does.

export type TagValue = string | number | boolean;

/** `maybe_quote_string` (fileio.cpp:182). */
export function maybeQuoteString(which: string, force = false): string {
  if (which === '') return "''";
  if (!force && !/[ \t\n\f]/.test(which) && which[0] !== '"' && which[0] !== "'") {
    return which;
  }
  let apos = 0;
  let quot = 0;
  for (const c of which) {
    if (c === "'") apos++;
    else if (c === '"') quot++;
  }
  // Surround it in whichever quote character appears fewer times. Note the
  // comparison is strict, so a tie picks the apostrophe.
  const quoteC = quot < apos ? '"' : "'";
  let out = quoteC;
  for (const c of which) {
    if (c === quoteC) out += '\\' + quoteC;
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\f') out += '\\f';
    else out += c;
  }
  return out + quoteC;
}

/**
 * `read_maybe_quoted_string` (fileio.cpp:146), reading from `src` at `pos`.
 * Returns the value and the position just past it. At end of input it yields
 * the empty string, which is how a bare keyword line ends up with exactly one
 * empty value.
 */
export function readMaybeQuotedString(src: string, pos: number): [string, number] {
  let i = pos;
  while (i < src.length && /[ \t\n\v\f\r]/.test(src[i]!)) i++;
  const delim = src[i];
  if (delim !== '"' && delim !== "'") {
    // Unquoted: everything up to the next whitespace.
    const start = i;
    while (i < src.length && !/[ \t\n\v\f\r]/.test(src[i]!)) i++;
    return [src.slice(start, i), i];
  }
  i++;
  let result = '';
  for (;;) {
    // getline(from, nextPart, delim)
    const end = src.indexOf(delim, i);
    let nextPart = end === -1 ? src.slice(i) : src.slice(i, end);
    i = end === -1 ? src.length : end + 1;
    let reachedEnd = true;
    if (nextPart.endsWith('\\')) {
      // A backslash immediately before the delimiter escapes it, so the string
      // carries on past what getline stopped at.
      nextPart = nextPart.slice(0, -1) + delim;
      reachedEnd = false;
    }
    // Collapse double backslashes, drop single ones, and translate \n \t \f.
    // The C++ leaves a trailing lone backslash alone (`iter + 1 != end`).
    let unescaped = '';
    for (let j = 0; j < nextPart.length; j++) {
      if (nextPart[j] === '\\' && j + 1 < nextPart.length) {
        j++;
        const c = nextPart[j]!;
        unescaped += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'f' ? '\f' : c;
      } else {
        unescaped += nextPart[j];
      }
    }
    result += unescaped;
    if (reachedEnd) break;
    if (i >= src.length) break;
  }
  return [result, i];
}

function encodeValue(v: TagValue): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(Math.trunc(v));
  return v;
}

/** One line of a page: a key and its values. */
export class Tag {
  constructor(
    readonly key: string,
    readonly values: string[] = [],
  ) {}

  /** `extract(i, std::string&)` — an absent value leaves the target alone, so
   * callers get their own default back rather than `undefined`. */
  str(i: number, def = ''): string {
    return i < this.values.length ? this.values[i]! : def;
  }

  int(i: number, def = 0): number {
    if (i >= this.values.length) return def;
    const n = parseInt(this.values[i]!, 10);
    return Number.isNaN(n) ? def : n;
  }

  /** `extract(i, bool&)` — anything that isn't one of the four true words is false. */
  bool(i: number, def = false): boolean {
    if (i >= this.values.length) return def;
    const v = this.values[i]!;
    return v === 'true' || v === 'yes' || v === 'on' || v === '1';
  }

  /** Values written with `as_hex`. */
  hex(i: number, def = 0): number {
    if (i >= this.values.length) return def;
    const n = parseInt(this.values[i]!, 16);
    return Number.isNaN(n) ? def : n;
  }

  push(...values: TagValue[]): this {
    for (const v of values) this.values.push(encodeValue(v));
    return this;
  }

  /** `writeTo` — the key, then each value, space separated. */
  serialise(): string {
    let out = this.key;
    for (const v of this.values) out += ' ' + maybeQuoteString(v);
    return out + '\n';
  }
}

export class TagPage {
  /** `tag_list` — every tag in the order it was added; this is what's written. */
  readonly tags: Tag[] = [];
  private readonly byKey = new Map<string, Tag[]>();
  private readonly cursor = new Map<string, number>();

  add(key: string, ...values: TagValue[]): Tag {
    const tag = new Tag(key);
    tag.push(...values);
    this.tags.push(tag);
    let list = this.byKey.get(key);
    if (list === undefined) {
      list = [];
      this.byKey.set(key, list);
    }
    list.push(tag);
    return tag;
  }

  has(key: string): boolean {
    const list = this.byKey.get(key);
    return list !== undefined && list.length > 0;
  }

  /** Every tag with this key, in order. */
  list(key: string): readonly Tag[] {
    return this.byKey.get(key) ?? [];
  }

  /** The first tag with this key, or undefined. */
  first(key: string): Tag | undefined {
    return this.byKey.get(key)?.[0];
  }

  /**
   * `cTagFile_TagList::operator>>`'s read cursor: each call hands back the next
   * tag with that key, and once they run out the cursor resets to the start and
   * this returns undefined — which is the C++'s "the extract proxy is false now"
   * signal.
   */
  next(key: string): Tag | undefined {
    const list = this.byKey.get(key);
    if (list === undefined) return undefined;
    const i = this.cursor.get(key) ?? 0;
    if (i >= list.length) {
      this.cursor.set(key, 0);
      return undefined;
    }
    this.cursor.set(key, i + 1);
    return list[i];
  }

  /** `getFirstKey` — the empty string on an empty page. */
  firstKey(): string {
    return this.tags[0]?.key ?? '';
  }

  /** `encodeSparse` over a plain array: one tag of `index value` per non-default entry. */
  encodeSparse(key: string, values: readonly number[], def = 0): void {
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== def) this.add(key, i, values[i]!);
    }
  }

  /** `extractSparse` back into an existing array, leaving untouched slots alone. */
  extractSparse(key: string, into: number[], def = 0): void {
    for (const tag of this.list(key)) {
      const i = tag.int(0, -1);
      if (i < 0) continue;
      while (into.length <= i) into.push(def);
      into[i] = tag.int(1, def);
    }
  }

  serialise(): string {
    let out = '';
    for (const tag of this.tags) out += tag.serialise();
    return out;
  }
}

export class TagFile {
  readonly pages: TagPage[] = [];

  add(): TagPage {
    const page = new TagPage();
    this.pages.push(page);
    return page;
  }

  at(i: number): TagPage | undefined {
    return this.pages[i];
  }

  clear(): void {
    this.pages.length = 0;
  }

  serialise(): string {
    return this.pages.map((p) => p.serialise()).join('\f');
  }

  /**
   * `cTagFile::readFrom` — split on form feeds, then one tag per line. Note the
   * C++ reads the key with `>>` and the rest of the line with `getline`, so a
   * line with a key and nothing after it still produces one (empty) value.
   */
  static parse(text: string): TagFile {
    const file = new TagFile();
    for (const pageText of text.split('\f')) {
      const page = file.add();
      for (const line of pageText.split('\n')) {
        if (line.trim() === '') continue;
        let pos = 0;
        while (pos < line.length && /[ \t\r]/.test(line[pos]!)) pos++;
        const keyStart = pos;
        while (pos < line.length && !/[ \t\r]/.test(line[pos]!)) pos++;
        const key = line.slice(keyStart, pos);
        if (key === '') continue;
        const tag = page.add(key);
        // The values stream is the remainder of the line; it always yields at
        // least one (possibly empty) value, matching cTagFile_Tag::readFrom.
        let rest = pos;
        for (;;) {
          const [value, next] = readMaybeQuotedString(line, rest);
          tag.values.push(value);
          if (next >= line.length) break;
          rest = next;
        }
      }
    }
    return file;
  }
}

/** `as_hex` — the save version stamp is written this way. */
export function asHex(n: number): string {
  return n.toString(16);
}
