/**
 * How long the storefront keeps a catalog render, as a `cacheLife` profile:
 * fresh for a minute, refreshed in the background after one, and dropped
 * after four.
 *
 * ⚠️ **`expire` under five minutes is the point.** Next leaves a cache entry
 * that short out of the build's prerender and resolves it at request time
 * instead (a "dynamic hole"). A build machine has no fleet, so anything it
 * prerendered from the catalog would be an empty catalog with a TTL — the
 * reason ADR 0051 enumerates nothing at build time. Past the first request the
 * entry is reused, which is what `revalidate = 60` bought before.
 *
 * A minute rather than an hour because it is the window in which a vendor's
 * publication is invisible: the publish verb is a button a vendor presses and
 * then goes looking for the result.
 */
export const CATALOG_CACHE = {
  stale: 60,
  revalidate: 60,
  expire: 240,
} as const;
