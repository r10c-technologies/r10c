import { describe, expect, it } from 'vitest';

import { isEmpty } from './is-empty.js';

describe('isEmpty', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an empty array', []],
    ['an empty object', {}],
  ])('treats %s as empty', (_label, value) => {
    expect(isEmpty(value)).toBe(true);
  });

  it.each([
    ['a non-empty string', 'a'],
    ['a non-empty array', [0]],
    ['an object with keys', { a: undefined }],
  ])('treats %s as not empty', (_label, value) => {
    expect(isEmpty(value)).toBe(false);
  });

  // Primitives other than strings have no notion of emptiness, so they are
  // never empty — `0` and `false` in particular must not be swallowed by a
  // falsiness check.
  it.each([
    ['zero', 0],
    ['false', false],
    ['NaN', Number.NaN],
    ['a function', () => undefined],
  ])('treats %s as not empty', (_label, value) => {
    expect(isEmpty(value)).toBe(false);
  });
});
