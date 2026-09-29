/**
 * String resources — the get_str(file, n) lookups the C++ makes against the
 * text files in data/strings (ref: get_str in tools/strings.cpp). Each file is
 * one string per line and the index is **1-based**, matching the C++.
 *
 * Tables are registered up front (loadStringTables below, or setStrings in
 * tests) because the code that needs them — shop stock, spell names — is
 * synchronous.
 */

const tables = new Map<string, string[]>();

export function setStrings(name: string, text: string): void {
  // Trailing newline would otherwise add a phantom entry.
  tables.set(name, text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));
}

/**
 * A scenario's own lines for one of the game's tables (`strings/NAME.txt` in
 * its package, as OBoE's resource path lets a scenario replace any resource):
 * each non-empty line replaces the game's, and a blank one leaves it, so a
 * scenario that never wrote a string keeps the game's. Exile III ships its
 * instant help this way.
 */
export function overrideStrings(name: string, text: string): void {
  const own = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const table = [...(tables.get(name) ?? [])];
  own.forEach((line, i) => {
    if (line !== '') table[i] = line;
    else table[i] ??= '';
  });
  tables.set(name, table);
}

export function hasStrings(name: string): boolean {
  return tables.has(name);
}

/** How many strings a table holds — `ResMgr::strings.get(name)->size()`. */
export function stringCount(name: string): number {
  return tables.get(name)?.length ?? 0;
}

/** get_str — 1-based line lookup; missing entries give an empty string. */
export function getStr(name: string, index: number): string {
  return tables.get(name)?.[index - 1] ?? '';
}

/** Every table the game player reads. */
export const STRING_TABLES = [
  'magic-names',
  'skills',
  'mage-spells',
  'priest-spells',
  'alchemy',
  'item-abilities',
  'item-types-display',
  'shop-specials',
  // give_help's instant help, and the Library's tip of the day.
  'help',
  'tips',
  'spell-times',
];

export async function loadStringTables(
  fetchText: (url: string) => Promise<string>,
  names: string[] = STRING_TABLES,
): Promise<void> {
  await Promise.all(
    names.map(async (name) => setStrings(name, await fetchText(`/data/strings/${name}.txt`))),
  );
}
