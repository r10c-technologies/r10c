import { describe, expect, it } from 'vitest';

import { makeFormatters } from './format.js';

describe('makeFormatters', () => {
  it('memoizes per locale so a table cell does not rebuild Intl each render', () => {
    expect(makeFormatters('es')).toBe(makeFormatters('es'));
    expect(makeFormatters('es')).not.toBe(makeFormatters('en'));
  });

  it('formats the same instant differently per locale', () => {
    const value = new Date('2026-07-25T15:30:00Z');
    const es = makeFormatters('es').date(value);
    const en = makeFormatters('en').date(value);

    expect(es).not.toBe(en);
    expect(es).toBe(new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(value));
  });

  it('accepts a string or an epoch as well as a Date', () => {
    const formatters = makeFormatters('es');
    const expected = formatters.date(new Date('2026-07-25T00:00:00Z'));

    expect(formatters.date('2026-07-25T00:00:00Z')).toBe(expected);
    expect(formatters.date(Date.parse('2026-07-25T00:00:00Z'))).toBe(expected);
  });

  it('includes a time in dateTime', () => {
    const value = new Date('2026-07-25T15:30:00Z');
    const formatters = makeFormatters('en');

    expect(formatters.dateTime(value)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(value),
    );
  });

  it('falls back to the raw value when the date cannot be parsed', () => {
    const formatters = makeFormatters('es');

    expect(formatters.date('not a date')).toBe('not a date');
    expect(formatters.dateTime('not a date')).toBe('not a date');
  });

  it('formats numbers, with and without overrides', () => {
    const formatters = makeFormatters('es');

    expect(formatters.number(1234567.5)).toBe(new Intl.NumberFormat('es').format(1234567.5));
    expect(formatters.number(0.42, { style: 'percent' })).toBe(
      new Intl.NumberFormat('es', { style: 'percent' }).format(0.42),
    );
  });

  it('formats currency and relative time', () => {
    const formatters = makeFormatters('en');

    expect(formatters.currency(89, 'USD')).toBe(
      new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(89),
    );
    expect(formatters.relative(-1, 'day')).toBe(
      new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-1, 'day'),
    );
  });
});
