import { describe, expect, it } from 'vitest';

import { joinFieldPath, parseRowFieldPath, rowFieldPath } from '../index.js';

describe('rowFieldPath', () => {
  it('names a member of one row', () => {
    expect(rowFieldPath('items', 2, 'quantity')).toBe('items[2].quantity');
  });
});

describe('parseRowFieldPath', () => {
  it('reads a row path back', () => {
    expect(parseRowFieldPath('items[2].quantity')).toEqual({
      member: 'items',
      index: 2,
      child: 'quantity',
    });
  });

  it('reads index zero, which is falsy and easy to lose', () => {
    expect(parseRowFieldPath('items[0].quantity')?.index).toBe(0);
  });

  it.each([
    ['a plain member name, which every existing caller uses', 'name'],
    ['a member with no row index', 'items.quantity'],
    ['a row with no child member', 'items[2]'],
    ['a non-numeric index', 'items[a].quantity'],
    ['an empty string', ''],
  ])('returns undefined for %s', (_label, path) => {
    expect(parseRowFieldPath(path)).toBeUndefined();
  });

  it('round-trips whatever rowFieldPath builds', () => {
    expect(parseRowFieldPath(rowFieldPath('lines', 11, 'amount'))).toEqual({
      member: 'lines',
      index: 11,
      child: 'amount',
    });
  });
});

describe('joinFieldPath', () => {
  it('joins a nested schema issue path into a row path', () => {
    expect(joinFieldPath(['items', 2, 'quantity'])).toBe('items[2].quantity');
  });

  it('leaves a top-level member exactly as it was', () => {
    // This is the compatibility guarantee: before nested paths existed
    // `issueFieldName` returned the head, and for a one-segment path that is
    // still the whole answer, so no existing rule changes meaning.
    expect(joinFieldPath(['name'])).toBe('name');
  });

  it('treats a numeric string segment as an index', () => {
    // Some schema libraries report array positions as strings.
    expect(joinFieldPath(['items', '2', 'quantity'])).toBe('items[2].quantity');
  });

  it('joins a plain nested object path with dots', () => {
    expect(joinFieldPath(['address', 'city'])).toBe('address.city');
  });

  it('reads an empty path as an empty string', () => {
    expect(joinFieldPath([])).toBe('');
  });
});
