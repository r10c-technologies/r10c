import { describe, expect, it } from 'vitest';

import {
  drawOrderNumber,
  normalizeOrderNumber,
  ORDER_NUMBER,
  ORDER_NUMBER_ALPHABET,
} from './order-number.js';

describe('an order number', () => {
  it('is eight Crockford characters in two halves, with no I, L, O or U', () => {
    for (let draw = 0; draw < 200; draw += 1)
      expect(drawOrderNumber()).toMatch(ORDER_NUMBER);
    expect(ORDER_NUMBER_ALPHABET).toHaveLength(32);
    expect(ORDER_NUMBER_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('is drawn at random, not counted', () => {
    const numbers = new Set(Array.from({ length: 100 }, drawOrderNumber));
    expect(numbers.size).toBe(100);
  });

  it('reads back what a person typed, however they typed it', () => {
    for (const typed of ['7kq4-m2xd', '7KQ4 M2XD', '7KQ4M2XD', ' 7kq4m2xd '])
      expect(normalizeOrderNumber(typed)).toBe('7KQ4-M2XD');
    expect(normalizeOrderNumber('l0o1-iIlL')).toBe('1001-1111');
  });

  it('refuses what cannot be a number', () => {
    for (const typed of ['7KQ4-M2X', '7KQ4-M2XDE', 'UUUU-UUUU', ''])
      expect(normalizeOrderNumber(typed)).toBeUndefined();
  });
});
