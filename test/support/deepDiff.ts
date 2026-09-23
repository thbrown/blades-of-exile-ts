/** Every path at which two values differ, for tests that compare whole models. */
export function deepDiff(a: unknown, b: unknown, path = '', out: string[] = [], limit = 200): string[] {
  if (out.length >= limit) return out;
  if (Object.is(a, b)) return out;
  if (a instanceof Map && b instanceof Map) {
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) deepDiff(a.get(k), b.get(k), `${path}<${String(k)}>`, out, limit);
    return out;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    return deepDiff(Array.from(a as Uint8Array), Array.from(b as Uint8Array), path, out, limit);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) deepDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out, limit);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}
