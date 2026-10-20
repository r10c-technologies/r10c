import { defaultLocale, isLocale, locales } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { R10C_DEFAULT_LOCALE, R10C_LOCALES } from './locales.js';

describe("r10c's locale declaration", () => {
  it('declares Spanish first and by default, and English beside it', () => {
    expect(locales()).toEqual(R10C_LOCALES);
    expect(defaultLocale()).toBe(R10C_DEFAULT_LOCALE);
    expect(defaultLocale()).toBe('es');
    expect(isLocale('es')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});
