import type { MetaAccessorType } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  type EntityFilterOperator,
  OPERATOR_LABELS,
  operatorArity,
  operatorsForType,
} from './filter-operators.js';

describe('operatorsForType', () => {
  // The type is what keeps the control from offering nonsense: ordering
  // comparisons for a boolean, or substring matching for a number.
  it.each([
    ['number', 'number'],
    ['date', 'date'],
  ] as const)('offers ordering comparisons for a %s', (_label, type) => {
    const operators = operatorsForType(type);

    expect(operators).toEqual(expect.arrayContaining(['gt', 'lt', 'between']));
    expect(operators).not.toContain('like');
  });

  it('offers only equality for a boolean', () => {
    expect(operatorsForType('boolean')).toEqual(['eq', 'ne']);
  });

  it('offers set membership for an enum, but not substring matching', () => {
    const operators = operatorsForType('enum');

    expect(operators).toEqual(expect.arrayContaining(['eq', 'ne', 'in', 'nin']));
    expect(operators).not.toContain('like');
    expect(operators).not.toContain('gt');
  });

  it.each(['string', 'id', 'link', 'linkCollection'] as MetaAccessorType[])(
    'offers substring matching for a %s',
    (type) => {
      const operators = operatorsForType(type);

      expect(operators).toEqual(expect.arrayContaining(['like', 'nlike', 'eq']));
      expect(operators).not.toContain('gt');
    },
  );

  it.each(['number', 'date', 'enum', 'string'] as MetaAccessorType[])(
    'offers the emptiness checks for a %s',
    (type) => {
      expect(operatorsForType(type)).toEqual(
        expect.arrayContaining(['isNull', 'isNotNull']),
      );
    },
  );

  // Boolean is the exception: a boolean member is either true or false, so
  // "is empty" would be a third state the model does not have.
  it('offers no emptiness check for a boolean', () => {
    expect(operatorsForType('boolean')).not.toContain('isNull');
  });

  it('labels every operator it can offer', () => {
    const offered = new Set(
      (
        [
          'number',
          'date',
          'boolean',
          'enum',
          'string',
          'id',
          'link',
          'linkCollection',
        ] as MetaAccessorType[]
      ).flatMap((type) => [...operatorsForType(type)]),
    );

    for (const operator of offered) {
      expect(OPERATOR_LABELS[operator]).toBeTruthy();
    }
  });
});

// Arity is what the builder reads to decide how many value inputs to render;
// getting it wrong renders a range filter with one box.
describe('operatorArity', () => {
  it.each([
    ['isNull', 'none'],
    ['isNotNull', 'none'],
    ['between', 'range'],
    ['nbetween', 'range'],
    ['in', 'list'],
    ['nin', 'list'],
    ['eq', 'single'],
    ['ne', 'single'],
    ['gt', 'single'],
    ['gte', 'single'],
    ['lt', 'single'],
    ['lte', 'single'],
    ['like', 'single'],
    ['nlike', 'single'],
  ] as [EntityFilterOperator, string][])('reports %s as %s', (operator, arity) => {
    expect(operatorArity(operator)).toBe(arity);
  });

  it('covers every labelled operator', () => {
    for (const operator of Object.keys(OPERATOR_LABELS) as EntityFilterOperator[]) {
      expect(['none', 'single', 'list', 'range']).toContain(operatorArity(operator));
    }
  });
});
