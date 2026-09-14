import * as core from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import * as routing from './routing.js';

/**
 * The `/routing` entry point exists so Next middleware — which runs on the edge
 * — can negotiate a locale without pulling the i18next runtime into its bundle.
 * Nothing in the type system enforces that, so it is asserted here: the day
 * someone re-exports `createI18n` for convenience, this fails rather than
 * quietly inflating every app's edge bundle.
 *
 * The implementation moved to `@entifix/core`, which is what makes a middleware
 * bundle free of this package entirely — so the agreement asserted below is with
 * core rather than with this package's own barrel.
 */
describe('the routing entry point', () => {
  it('carries the whole negotiation surface middleware needs', () => {
    expect(routing.DEFAULT_LOCALE).toBe('es');
    expect(routing.LOCALES).toEqual(['es', 'en']);
    expect(routing.isLocale('en')).toBe(true);
    expect(routing.splitLocalePath('/es/catalog')).toEqual({
      locale: 'es',
      rest: '/catalog',
    });
    expect(routing.localeHref('en', '/catalog')).toBe('/en/catalog');
    expect(routing.negotiateLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe(
      'en',
    );
  });

  it('carries no i18next runtime, so the edge bundle stays small', () => {
    expect(routing).not.toHaveProperty('createI18n');
    expect(routing).not.toHaveProperty('sharedFallbackI18n');
    expect(routing).not.toHaveProperty('resources');
  });

  it('re-exports core, adding nothing of its own', () => {
    for (const name of Object.keys(routing)) {
      expect(
        core[name as keyof typeof core],
        `${name} is exported from the routing entry but is not core's — a ` +
          'second implementation of locale routing is how the middleware and ' +
          'the server disagree about which locale a request is in',
      ).toBe(routing[name as keyof typeof routing]);
    }
  });
});
