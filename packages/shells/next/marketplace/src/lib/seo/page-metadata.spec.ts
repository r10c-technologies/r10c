import { defineLocales, resetLocales } from '@entifix/core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { pageMetadata, storefrontOrigin } from './page-metadata';

describe('storefrontOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the deployment origin', () => {
    vi.stubEnv('STOREFRONT_URL', 'https://tienda.example');
    expect(storefrontOrigin()).toBe('https://tienda.example');
  });

  it('falls back to the dev port', () => {
    vi.stubEnv('STOREFRONT_URL', undefined);
    expect(storefrontOrigin()).toBe('http://localhost:3000');
  });
});

describe('pageMetadata', () => {
  // r10c's locales, as `@r10c/business-ts-i18n` registers them at runtime.
  beforeAll(() => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });
  });
  afterAll(() => {
    resetLocales();
  });

  it('names the page, and every locale as an alternate of it', () => {
    expect(
      pageMetadata({
        locale: 'en',
        path: '/c/lighting',
        title: 'Lighting',
        description: 'Lamps.',
      }),
    ).toEqual({
      title: 'Lighting',
      description: 'Lamps.',
      alternates: {
        canonical: '/en/c/lighting',
        languages: {
          es: '/es/c/lighting',
          en: '/en/c/lighting',
          'x-default': '/es/c/lighting',
        },
      },
    });
  });

  it('spells home as the bare locale, and leaves out what it was not given', () => {
    expect(pageMetadata({ locale: 'es', path: '/' })).toEqual({
      alternates: {
        canonical: '/es',
        languages: { es: '/es', en: '/en', 'x-default': '/es' },
      },
    });
  });
});
