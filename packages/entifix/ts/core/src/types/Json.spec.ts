import { describe, expect, it } from 'vitest';

import { isJsonValue } from './Json.js';

describe('isJsonValue', () => {
  it.each([
    ['a string', 'brand-1'],
    ['a finite number', 42],
    ['a boolean', false],
    ['null', null],
    ['an array of primitives', ['a', 1, true, null]],
    ['a nested object', { a: { b: [1, { c: 'd' }] } }],
    ['an empty object', {}],
  ])('accepts %s', (_label, value) => {
    expect(isJsonValue(value)).toBe(true);
  });

  it('accepts a null-prototype object, which a JSON.parse reviver can produce', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['a'] = 1;

    expect(isJsonValue(bare)).toBe(true);
  });

  // Each of these survives a `JSON.stringify` call without erroring and comes
  // back as something else — which is exactly the silent loss the rule exists to
  // stop, and why this is structural rather than a round-trip attempt.
  it.each([
    ['a Date', new Date()],
    ['a Map', new Map()],
    ['a class instance', new (class Brand {})()],
    ['a function', () => undefined],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    expect(isJsonValue(value)).toBe(false);
  });

  it('rejects a value nested anywhere inside', () => {
    expect(isJsonValue({ a: { b: [1, new Date()] } })).toBe(false);
    expect(isJsonValue([{ a: undefined }])).toBe(false);
  });
});
