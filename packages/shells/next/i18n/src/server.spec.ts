import { LOCALE_HEADER } from '@r10c/entifix-ts-i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from './server';

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(requestHeaders.value),
}));

beforeEach(() => {
  requestHeaders.value = new Headers();
});

describe('getRequestLocale', () => {
  it('reads the locale the middleware resolved', async () => {
    requestHeaders.value.set(LOCALE_HEADER, 'en');

    await expect(getRequestLocale()).resolves.toBe('en');
  });

  // Paths the matcher skips (`/api/health`, `/api/config`) arrive without the
  // header; they carry no user-facing copy, so the default is enough.
  it('falls back to the fleet default when the header is absent or junk', async () => {
    await expect(getRequestLocale()).resolves.toBe('es');

    requestHeaders.value.set(LOCALE_HEADER, 'klingon');
    await expect(getRequestLocale()).resolves.toBe('es');
  });
});

describe('getServerT', () => {
  it('translates in the request locale', async () => {
    requestHeaders.value.set(LOCALE_HEADER, 'en');
    const t = await getServerT('shell');

    expect(t('breadcrumbs.home')).toBe('Home');
  });

  it('defaults to the controls namespace', async () => {
    requestHeaders.value.set(LOCALE_HEADER, 'es');
    const t = await getServerT();

    expect(t('controls:table.open')).toBe('Abrir');
  });
});

describe('getServerTranslateKey', () => {
  // Nav labels live in a route table as plain strings, so they cannot satisfy
  // the typed-key signature — this is the widened form they go through.
  it('resolves a key that is only known at runtime', async () => {
    requestHeaders.value.set(LOCALE_HEADER, 'en');
    const translate = await getServerTranslateKey('app');

    expect(translate('admin.nav.products')).toBe('Products');
  });

  it('interpolates parameters', async () => {
    requestHeaders.value.set(LOCALE_HEADER, 'es');
    const translate = await getServerTranslateKey('controls');

    expect(translate('validation.required', { field: 'Código' })).toBe(
      'Código es obligatorio',
    );
  });
});
