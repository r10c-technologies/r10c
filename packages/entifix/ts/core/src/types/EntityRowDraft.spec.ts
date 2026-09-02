import { describe, expect, it } from 'vitest';

import {
  isRowDraftArray,
  newRowKey,
  readRowDrafts,
  ROW_KEY,
  seededRowKey,
} from '../index.js';

describe('ROW_KEY', () => {
  it('is a name no accessor in this repo declares', () => {
    expect(ROW_KEY).toBe('$key');
  });
});

describe('newRowKey', () => {
  it('mints a distinct key each call', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newRowKey()));

    expect(keys.size).toBe(50);
  });
});

describe('seededRowKey', () => {
  it('is deterministic, so re-seeding a record rebuilds the same draft', () => {
    // The load-bearing property: `useEntityForm` re-seeds whenever its `entity`
    // changes identity — every render for a caller that builds the record
    // inline — so a random key here makes the draft differ on every pass and
    // React stops with `Maximum update depth exceeded`.
    expect(seededRowKey(2)).toBe(seededRowKey(2));
  });

  it('distinguishes the rows of one record', () => {
    expect(seededRowKey(0)).not.toBe(seededRowKey(1));
  });

  it('never collides with a key minted for an added row', () => {
    const seeded = new Set(
      Array.from({ length: 20 }, (_row, index) => seededRowKey(index)),
    );

    expect(seeded.has(newRowKey())).toBe(false);
  });
});

describe('isRowDraftArray', () => {
  it('accepts an array of keyed string maps', () => {
    expect(
      isRowDraftArray([
        { [ROW_KEY]: 'a', quantity: '2' },
        { [ROW_KEY]: 'b', quantity: '' },
      ]),
    ).toBe(true);
  });

  it('accepts an empty list, which is a user who removed every row', () => {
    expect(isRowDraftArray([])).toBe(true);
  });

  it.each([
    ['a string, which is what a pre-composition draft held', ''],
    ['null', null],
    ['a bare object', { [ROW_KEY]: 'a' } as unknown],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isRowDraftArray(value)).toBe(false);
  });

  it('rejects a row with no key rather than minting one', () => {
    // Minting here would hide a row written by something that does not know the
    // contract, and the key would be re-minted on every render — so the row
    // would lose focus on every keystroke instead of failing visibly.
    expect(isRowDraftArray([{ quantity: '2' }])).toBe(false);
  });

  it('rejects a row whose key is not a string', () => {
    expect(isRowDraftArray([{ [ROW_KEY]: 3, quantity: '2' }])).toBe(false);
  });

  it('rejects a row holding a non-string member', () => {
    // A draft value is what a native input round-trips; a number here means
    // something wrote past the draft contract.
    expect(isRowDraftArray([{ [ROW_KEY]: 'a', quantity: 2 }])).toBe(false);
  });

  it('rejects a nested array masquerading as a row', () => {
    expect(isRowDraftArray([[]])).toBe(false);
  });
});

describe('readRowDrafts', () => {
  it('returns the rows when they are readable', () => {
    const rows = [{ [ROW_KEY]: 'a', quantity: '2' }];

    expect(readRowDrafts(rows)).toEqual(rows);
  });

  it.each([
    ['a string', ''],
    ['null', null],
    ['an unkeyed row', [{ quantity: '2' }]],
  ])('reads %s as no rows rather than throwing', (_label, value) => {
    expect(readRowDrafts(value)).toEqual([]);
  });
});
