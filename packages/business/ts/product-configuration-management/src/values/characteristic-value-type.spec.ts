import { describe, expect, it } from 'vitest';

import {
  CharacteristicValueTypes,
  isCharacteristicValueType,
} from './characteristic-value-type.js';

describe('CharacteristicValueTypes', () => {
  it('holds only the types a generic control can render and compare', () => {
    // Every member costs a rendering branch and a comparison rule, which is why
    // this set is narrower than TypeScript's. Adding one is a platform
    // decision; adding a *characteristic* is not.
    expect(CharacteristicValueTypes).toEqual([
      'string',
      'number',
      'boolean',
      'enum',
    ]);
  });
});

describe('isCharacteristicValueType', () => {
  it('accepts every declared type', () => {
    for (const valueType of CharacteristicValueTypes) {
      expect(isCharacteristicValueType(valueType)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isCharacteristicValueType('date')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isCharacteristicValueType(null)).toBe(false);
    expect(isCharacteristicValueType(1)).toBe(false);
  });
});
