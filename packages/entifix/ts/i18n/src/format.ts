import type { Locale } from './locales';

export interface Formatters {
  /** Calendar date only. */
  date(value: Date | string | number): string;
  /** Date plus wall-clock time. */
  dateTime(value: Date | string | number): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  currency(value: number, currency: string): string;
  relative(value: number, unit: Intl.RelativeTimeFormatUnit): string;
}

/** `undefined` for an unparseable input, so callers can fall back to the raw value. */
function toDate(value: Date | string | number): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const cache = new Map<Locale, Formatters>();

/**
 * Locale-aware formatting, memoized per locale because constructing an `Intl.*`
 * formatter is expensive and these run once per table cell.
 *
 * This exists to kill an argument-less `toLocaleString()`, which resolves against
 * the *runtime's* default locale — Node's on the server, the visitor's in the
 * browser. Those disagree, so the same cell rendered twice produced two strings
 * and React reported a hydration mismatch. Passing the negotiated locale
 * explicitly makes both halves agree by construction.
 */
export function makeFormatters(locale: Locale): Formatters {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const numberFormat = new Intl.NumberFormat(locale);
  const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const formatters: Formatters = {
    date: value => {
      const date = toDate(value);
      return date === undefined ? String(value) : dateFormat.format(date);
    },
    dateTime: value => {
      const date = toDate(value);
      return date === undefined ? String(value) : dateTimeFormat.format(date);
    },
    number: (value, options) =>
      options === undefined
        ? numberFormat.format(value)
        : new Intl.NumberFormat(locale, options).format(value),
    currency: (value, currency) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value),
    relative: (value, unit) => relativeFormat.format(value, unit),
  };

  cache.set(locale, formatters);
  return formatters;
}
