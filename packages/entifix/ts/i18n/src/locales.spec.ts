import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, isLocale, LOCALES } from './locales.js';

describe('locales', () => {
  it('defaults to Spanish', () => {
    expect(DEFAULT_LOCALE).toBe('es');
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('recognises a supported locale', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('es-MX')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});
