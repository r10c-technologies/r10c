/**
 * The value types a vendor may give a characteristic.
 *
 * Closed, and deliberately narrower than TypeScript's: this set is what a
 * generic form control and a generic filter control have to be written against,
 * so every member here costs a rendering branch and a comparison rule. Adding
 * one is a platform decision; adding a *characteristic* is not, which is the
 * whole point of the specification mechanism.
 */
export const CharacteristicValueTypes = [
  'string',
  'number',
  'boolean',
  'enum',
] as const;

export type CharacteristicValueType = (typeof CharacteristicValueTypes)[number];

/** Narrow an unknown value to a characteristic value type. */
export const isCharacteristicValueType = (
  value: unknown,
): value is CharacteristicValueType =>
  typeof value === 'string' &&
  (CharacteristicValueTypes as readonly string[]).includes(value);
