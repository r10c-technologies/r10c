import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CharacteristicSpecification } from './characteristic-specification.entity.js';

describe('CharacteristicSpecification', () => {
  it('serializes the vendor code with the dictionary term it resolves to', () => {
    const characteristic = new CharacteristicSpecification(
      'spec-1',
      'talla',
      'enum',
    );
    characteristic.id = 'char-1';
    characteristic.termId = 'term-size';

    expect(
      serializeEntity(CharacteristicSpecification, characteristic),
    ).toEqual({
      id: 'char-1',
      specificationId: 'spec-1',
      code: 'talla',
      valueType: 'enum',
      termId: 'term-size',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const characteristic = await Effect.runPromise(
      deserializeSingleEntity(CharacteristicSpecification, {
        id: 'char-2',
        specificationId: 'spec-2',
        code: 'weightGrams',
        valueType: 'number',
        termId: undefined,
      }),
    );

    expect(characteristic?.code).toBe('weightGrams');
    expect(characteristic?.valueType).toBe('number');
    expect(characteristic?.termId).toBeUndefined();
  });

  it('defaults to an unresolved string characteristic', () => {
    // Unresolved is the *usable* default: requiring a term would put the
    // operator back on the critical path of every onboarding, which is the
    // problem specifications exist to remove.
    const characteristic = new CharacteristicSpecification();

    expect(characteristic.specificationId).toBe('');
    expect(characteristic.code).toBe('');
    expect(characteristic.valueType).toBe('string');
    expect(characteristic.termId).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const characteristic = new CharacteristicSpecification();
    characteristic.specificationId = 'spec-3';
    characteristic.code = 'size';
    characteristic.valueType = 'boolean';
    characteristic.termId = undefined;

    expect(characteristic.specificationId).toBe('spec-3');
    expect(characteristic.code).toBe('size');
    expect(characteristic.valueType).toBe('boolean');
    expect(characteristic.termId).toBeUndefined();
  });

  it('keeps the term optional, so a vendor is unblocked without being comparable', () => {
    const byName = new Map(
      describeEntityColumns(CharacteristicSpecification).map(column => [
        column.name,
        column,
      ]),
    );

    expect(byName.get('termId')?.required).not.toBe(true);
    // Filterable so the operator can find which vendor codes recur unresolved —
    // that is how the platform vocabulary is meant to grow.
    expect(byName.get('termId')?.filterable).toBe(true);
    expect(byName.get('code')?.required).toBe(true);
  });

  it('holds no value here, because a value belongs to an instance', () => {
    // A `CharacteristicSpecification` defines the member; a `CharacteristicValue`
    // on an offering holds it. Fusing them would make the definition unshareable
    // across every offering that uses the spec.
    const names = describeEntityColumns(CharacteristicSpecification).map(
      column => column.name,
    );

    expect(names).toEqual([
      'id',
      'specificationId',
      'code',
      'valueType',
      'termId',
    ]);
  });
});
