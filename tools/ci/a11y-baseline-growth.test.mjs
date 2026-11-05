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

  it('passes a baseline that only shrank or changed an owner', () => {
    assert.deepEqual(addedEntries(before, { 'a|b|home': 'acme/shop#9' }), []);
  });
});
