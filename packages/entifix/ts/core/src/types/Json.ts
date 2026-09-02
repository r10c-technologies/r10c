/**
 * A value that survives `JSON.parse(JSON.stringify(x))` unchanged.
 *
 * It exists to make one rule checkable at compile time: **anything persisted as
 * an autosaved draft is JSON round-trippable, period** — no class instances, no
 * `EntityLink`, no `Date`. A draft is written through `createJSONStorage`, so a
 * value that is not this is not "mostly preserved"; it comes back as something
 * else (a `Date` as a string, an entity as a bare object, a `Map` as `{}`) and
 * the loss is silent.
 *
 * Note the deliberate asymmetry with `UiPreferencesState`, the other persisted
 * client store: that one writes through IndexedDB's **structured clone**, which
 * does preserve a `Date` and a `Map`. The two contracts differ, so a type that
 * describes one must not be reused for the other.
 *
 * `undefined` is absent on purpose — `JSON.stringify` drops an `undefined`
 * member rather than round-tripping it, so a draft holding one restores with
 * that key missing. Model "no value" as `null`, or leave the key out.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object — the shape a draft always takes at its top level. */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Whether a runtime value is {@link JsonValue}-shaped.
 *
 * The type above is the compile-time half; this is what a restore boundary needs,
 * because a value read back out of storage arrives as `unknown` and no cast makes
 * it true. Deliberately structural rather than a `JSON.stringify` round trip: a
 * cycle throws there, and a `Date` survives it while being exactly what this must
 * reject.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    // `NaN` and `Infinity` serialize as `null`, so they do not round-trip.
    return type !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (type !== 'object') return false;
  // A plain object only. `Object.create(null)` is JSON-safe too and is what a
  // `JSON.parse` reviver can produce, so both prototypes are accepted.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}
