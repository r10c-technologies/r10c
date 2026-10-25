import { defineLocales, resetLocales } from '@entifix/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type CatalogSlug,
  catalogSlug,
  memoizeSlugLookup,
} from './catalog-slug';

describe('catalogSlug', () => {
  // r10c's locales, as `@r10c/business-ts-i18n` registers them at runtime.
  beforeAll(() => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });
  });
  afterAll(() => {
    resetLocales();
  });

  it('reads a product and a category address', () => {
    expect(catalogSlug('/es/p/offering-1')).toEqual({
      locale: 'es',
      kind: 'product',
      key: 'offering-1',
    });
    expect(catalogSlug('/en/c/desk-lamps/')).toEqual({
      locale: 'en',
      kind: 'category',
      key: 'desk-lamps',
    });
  });

  it('decodes the key the way the route parameter is decoded', () => {
    expect(catalogSlug('/es/c/l%C3%A1mparas')?.key).toBe('lámparas');
  });

  it('names nothing for every other path', () => {
    expect(catalogSlug('/es')).toBeUndefined();
    expect(catalogSlug('/es/search')).toBeUndefined();
    expect(catalogSlug('/es/p/offering-1/extra')).toBeUndefined();
    expect(catalogSlug('/de/p/offering-1')).toBeUndefined();
  });
});

describe('memoizeSlugLookup', () => {
  const slug = (key: string): CatalogSlug => ({
    locale: 'es',
    kind: 'product',
    key,
  });

  it('asks once within the lifetime, and again after it', async () => {
    let clock = 0;
    const lookup = vi.fn(async () => true);
    const check = memoizeSlugLookup(lookup, {
      ttl: 60_000,
      max: 10,
      now: () => clock,
    });

    await check(slug('a'));
    clock = 59_999;
    expect(await check(slug('a'))).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);

    clock = 60_000;
    await check(slug('a'));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps a miss, which is a definite answer', async () => {
    const lookup = vi.fn(async () => false);
    const check = memoizeSlugLookup(lookup, { ttl: 60_000, max: 10 });

    expect(await check(slug('gone'))).toBe(false);
    expect(await check(slug('gone'))).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failed read', async () => {
    const lookup = vi.fn(async () => undefined);
    const check = memoizeSlugLookup(lookup, { ttl: 60_000, max: 10 });

    expect(await check(slug('a'))).toBeUndefined();
    await check(slug('a'));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('starts over rather than growing past its bound', async () => {
    const lookup = vi.fn(async () => true);
    const check = memoizeSlugLookup(lookup, { ttl: 60_000, max: 2 });

    await check(slug('a'));
    await check(slug('b'));
    await check(slug('c')); // full: cleared, then `c` held
    await check(slug('a'));
    expect(lookup).toHaveBeenCalledTimes(4);
    await check(slug('c'));
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it('keeps products and categories apart', async () => {
    const lookup = vi.fn(
      async (asked: CatalogSlug) => asked.kind === 'product',
    );
    const check = memoizeSlugLookup(lookup, { ttl: 60_000, max: 10 });

    expect(await check(slug('x'))).toBe(true);
    expect(await check({ locale: 'es', kind: 'category', key: 'x' })).toBe(
      false,
    );
  });
});
