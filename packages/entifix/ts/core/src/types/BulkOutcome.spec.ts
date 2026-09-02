import { describe, expect, it } from 'vitest';

import { type BulkOutcome, failedIds, succeededCount } from './BulkOutcome.js';

const outcomes: BulkOutcome[] = [
  { id: 'a', ok: true },
  { id: 'b', ok: false, code: 'alreadyRetired' },
  { id: 'c', ok: true },
  { id: 'd', ok: false, code: 'forbidden' },
];

describe('failedIds', () => {
  it('names only the rows that failed', () => {
    expect(failedIds(outcomes)).toEqual(['b', 'd']);
  });

  it('is empty when every row was written', () => {
    expect(failedIds([{ id: 'a', ok: true }])).toEqual([]);
  });
});

describe('succeededCount', () => {
  /**
   * Both halves are reported because either one alone lies: the failures alone
   * hide the rows that *were* written, and the successes alone hide the ones
   * that were not.
   */
  it('counts the rows that were written', () => {
    expect(succeededCount(outcomes)).toBe(2);
  });

  it('is zero when every row failed', () => {
    expect(succeededCount([{ id: 'a', ok: false, code: 'forbidden' }])).toBe(0);
  });
});
