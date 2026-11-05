import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addedEntries } from './a11y-baseline-growth.mjs';

describe('addedEntries', () => {
  const before = { 'a|b|home': 'acme/shop#1', 'a|c|home': 'acme/shop#1' };

  it('names an entry the merge base did not have', () => {
    assert.deepEqual(
      addedEntries(before, { ...before, 'x|y|cart': 'acme/shop#2' }),
      ['x|y|cart'],
    );
  });

  it('holds a re-keyed baseline to its old entry count', () => {
    const rekeyed = {
      $fingerprints: 'ancestry-1',
      'a|html > b|home': 'acme/shop#1',
    };
    assert.deepEqual(addedEntries(before, rekeyed), []);
    assert.deepEqual(
      addedEntries(before, {
        ...rekeyed,
        'a|html > c|home': 'acme/shop#1',
        'a|html > d|home': 'acme/shop#1',
      }),
      [
        '1 more entries than before, re-keyed from fingerprint scheme (none) to ancestry-1',
      ],
    );
  });

  it('ignores the scheme marker under one scheme', () => {
    const marked = { $fingerprints: 'ancestry-1', ...before };
    assert.deepEqual(addedEntries(marked, marked), []);
  });

  it('passes a baseline that only shrank or changed an owner', () => {
    assert.deepEqual(addedEntries(before, { 'a|b|home': 'acme/shop#9' }), []);
  });
});
