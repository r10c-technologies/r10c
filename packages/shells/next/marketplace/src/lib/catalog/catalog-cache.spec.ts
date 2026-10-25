import { describe, expect, it } from 'vitest';

import { CATALOG_CACHE } from './catalog-cache';

describe('CATALOG_CACHE', () => {
  /**
   * The property the lifetime exists for. Next leaves a cache entry whose
   * `expire` is under five minutes out of every prerender; one second past it
   * and `next build` bakes whatever it could read — on a build machine, an
   * empty catalog — into the static shell (ADR 0051).
   */
  it('expires too soon to be prerendered', () => {
    expect(CATALOG_CACHE.expire).toBeLessThan(5 * 60);
  });

  it('keeps a publication invisible for a minute at most', () => {
    expect(CATALOG_CACHE.revalidate).toBeLessThanOrEqual(60);
    expect(CATALOG_CACHE.stale).toBeLessThanOrEqual(CATALOG_CACHE.expire);
  });
});
