import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { DictionaryTerm } from './dictionary-term.entity.js';

describe('DictionaryTerm', () => {
  it('serializes the shared code with its value set and unit', () => {
    const term = new DictionaryTerm('size');
    term.id = 'term-1';
    term.values = ['s', 'm', 'l'];
    term.unit = 'eu';

    expect(serializeEntity(DictionaryTerm, term)).toEqual({
      id: 'term-1',
      code: 'size',
      values: ['s', 'm', 'l'],
      unit: 'eu',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const term = await Effect.runPromise(
      deserializeSingleEntity(DictionaryTerm, {
        id: 'term-2',
        code: 'weight',
        values: [],
        unit: 'g',
      }),
    );

    expect(term?.code).toBe('weight');
    expect(term?.unit).toBe('g');
    expect(term?.values).toEqual([]);
  });

  it('starts as an open term with no values, which is a legitimate shape', () => {
    // A code and a unit with no enumerated values is exactly right for
    // something like `weight`; requiring a value set would forbid it.
    const term = new DictionaryTerm();

    expect(term.code).toBe('');
    expect(term.values).toEqual([]);
    expect(term.unit).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const term = new DictionaryTerm();
    term.code = 'colour';
    term.values = ['red', 'blue'];
    term.unit = undefined;

    expect(term.code).toBe('colour');
    expect(term.values).toEqual(['red', 'blue']);
    expect(term.unit).toBeUndefined();
  });

  it('carries the unit on the term, not on each vendor characteristic', () => {
    // Two vendors quoting grams and kilograms under one term is exactly the
    // incomparability the dictionary exists to remove.
    const names = describeEntityColumns(DictionaryTerm).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'code', 'values', 'unit']);
  });

  it('keeps the value set on the wire but out of the query allowlist', () => {
    // A string array is outside the `MetaAccessorTypes` taxonomy — the same
    // situation as `Membership.roleIds` — and an array compared as a scalar
    // matches nothing, so filtering it would be a silently empty result.
    const values = describeEntityColumns(DictionaryTerm).find(
      column => column.name === 'values',
    );

    expect(values?.filterable).toBe(false);
    expect(values?.sortable).toBe(false);

    const term = new DictionaryTerm('size');
    term.values = ['s'];
    expect(serializeEntity(DictionaryTerm, term)).toMatchObject({
      values: ['s'],
    });
  });

  it('makes the code findable, since resolving is a lookup by code', () => {
    const code = describeEntityColumns(DictionaryTerm).find(
      column => column.name === 'code',
    );

    expect(code?.filterable).toBe(true);
    expect(code?.required).toBe(true);
  });
});
