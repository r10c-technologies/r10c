import { createI18n } from '@entifix/i18n';
import { describe, expect, it } from 'vitest';

import { installClientCatalog } from './client.js';
import { clientCatalog, R10C_RESOURCES } from './index.js';

describe('clientCatalog', () => {
  it('keeps the namespaces and the subtrees it is told to, in one locale', () => {
    const catalog = clientCatalog('en', [
      'errors',
      'r10c.storefront.missing',
    ]) as Record<string, Record<string, Record<string, unknown>>>;

    expect(Object.keys(catalog).sort()).toEqual(['errors', 'r10c']);
    expect(catalog['errors']).toBe(R10C_RESOURCES.en.errors);
    expect(catalog['r10c']).toEqual({
      storefront: { missing: R10C_RESOURCES.en.r10c.storefront.missing },
    });
  });

  it('leaves out what a browser never renders', () => {
    const catalog = clientCatalog('es', ['r10c.storefront.nav']) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;

    expect(catalog['entity']).toBeUndefined();
    expect(Object.keys(catalog['r10c']?.['storefront'] ?? {})).toEqual(['nav']);
  });

  it('refuses a path that names nothing', () => {
    expect(() => clientCatalog('es', ['r10c.storefront.gone'])).toThrow(
      /nothing at 'r10c.storefront.gone'/,
    );
  });
});

describe('installClientCatalog', () => {
  it('installs the locale it is handed, and keeps the ones before it', () => {
    installClientCatalog(
      'en',
      clientCatalog('en', ['controls', 'r10c.storefront.missing']),
    );
    installClientCatalog(
      'es',
      clientCatalog('es', ['controls', 'r10c.storefront.missing']),
    );

    for (const locale of ['en', 'es'] as const) {
      expect(createI18n(locale).t('r10c:storefront.missing.heading')).toBe(
        R10C_RESOURCES[locale].r10c.storefront.missing.heading,
      );
    }
    // Not handed, so not installed: the error copy is gone from this graph.
    expect(createI18n('en').exists('errors:notFound')).toBe(false);
  });

  it('installs a locale once: its subset is fixed for a build', () => {
    installClientCatalog('en', { controls: {}, r10c: {} });

    expect(createI18n('en').t('r10c:storefront.missing.heading')).toBe(
      R10C_RESOURCES.en.r10c.storefront.missing.heading,
    );
  });
});
