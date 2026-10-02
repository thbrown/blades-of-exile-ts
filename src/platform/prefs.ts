/**
 * The player's preferences — `get_bool_pref` / `set_pref` and friends
 * (tools/prefs.cpp), which the C++ keeps in a file beside the game and this
 * port keeps in `localStorage`.
 *
 * Every read falls back to the default and every write is best-effort:
 * storage can be missing or throw (a private window, blocked site data, a
 * test), and a preference that can't be stored should cost the player nothing
 * worse than being asked again. Nothing here touches the dice.
 */

// The project's old name, kept: renaming it would lose what players have stored.
const KEY = 'exile-js:prefs';

type PrefValue = boolean | number | string | number[];

let cache: Record<string, PrefValue> | null = null;

function load(): Record<string, PrefValue> {
  if (cache) return cache;
  cache = {};
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') cache = parsed as Record<string, PrefValue>;
    }
  } catch {
    // Unreadable storage behaves as empty storage.
  }
  return cache;
}

function save(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Best-effort; the in-memory copy still answers for this session.
  }
}

export function getBoolPref(name: string, def = false): boolean {
  const v = load()[name];
  return typeof v === 'boolean' ? v : def;
}

export function getIntPref(name: string, def = 0): number {
  const v = load()[name];
  return typeof v === 'number' ? v : def;
}

export function setPref(name: string, value: PrefValue): void {
  load()[name] = value;
  save();
}

export function getIarrayPref(name: string): number[] {
  const v = load()[name];
  return Array.isArray(v) ? v : [];
}

export function iarrayPrefContains(name: string, n: number): boolean {
  return getIarrayPref(name).includes(n);
}

export function appendIarrayPref(name: string, n: number): void {
  const list = getIarrayPref(name);
  if (!list.includes(n)) setPref(name, [...list, n]);
}

/** Forget everything — for tests, and for "reset help" (`confirm-reset-help`). */
export function clearPref(name: string): void {
  delete load()[name];
  save();
}

/**
 * The autosave preferences as the C++ stores them: `Autosave`,
 * `Autosave_<reason>` and `Autosave_Max`.
 */
export function readAutosavePrefs(
  reasons: readonly string[], defaults: Record<string, boolean>, maxDefault: number,
): { enabled: boolean; triggers: Record<string, boolean>; max: number } {
  const triggers: Record<string, boolean> = {};
  for (const r of reasons) triggers[r] = getBoolPref(`Autosave_${r}`, defaults[r] ?? true);
  return { enabled: getBoolPref('Autosave', true), triggers, max: getIntPref('Autosave_Max', maxDefault) };
}

/** Tests only: drop the in-memory copy so the next read goes back to storage. */
export function resetPrefsCache(): void {
  cache = null;
}

/** `get_float_pref` — OBoE keeps UIScale as a float, and 1.5 is one of its choices. */
export function getFloatPref(name: string, def = 0): number {
  return getIntPref(name, def);
}
