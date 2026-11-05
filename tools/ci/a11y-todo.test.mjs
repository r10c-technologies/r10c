import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { closedEntries } from './a11y-todo.mjs';

describe('closedEntries', () => {
  const todo = {
    'Atoms/Button': 'r10c-technologies/entifix#1',
    'Molecules/TabStrip': 'r10c-technologies/entifix#2',
    'Organisms/EntityTable': 'r10c-technologies/entifix#1',
  };

  it('names every entry whose issue is closed', () => {
    const states = { 'r10c-technologies/entifix#1': 'CLOSED' };
    assert.deepEqual(
      closedEntries(todo, issue => states[issue] ?? 'OPEN'),
      [
        ['Atoms/Button', 'r10c-technologies/entifix#1'],
        ['Organisms/EntityTable', 'r10c-technologies/entifix#1'],
      ],
    );
  });

  it('never reads the scheme marker as an issue', () => {
    assert.deepEqual(
      closedEntries({ $fingerprints: 'ancestry-1' }, () => 'CLOSED'),
      [],
    );
  });

  it('names none while every issue is open', () => {
    assert.deepEqual(
      closedEntries(todo, () => 'OPEN'),
      [],
    );
  });
});
