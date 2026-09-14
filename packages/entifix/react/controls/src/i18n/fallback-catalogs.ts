import { controlsCatalogs } from './catalog';

/**
 * Catalogs the no-provider fallback can resolve against, by namespace.
 *
 * Seeded with this package's own `controls`, and open so a package that ships
 * copy for its own components can add it — `@entifix/next-shell` registers
 * `shell` when it is imported. The promise is the same either way: a component
 * that ships its strings renders them without a provider, so an adopter who
 * mounts nothing still gets working UI rather than raw keys.
 *
 * ⚠️ **A plain module, and it has to be.** It used to live in `i18n-context.tsx`,
 * which is `'use client'` — and a package registers its catalog at module scope,
 * in code a Next server also evaluates. Next refuses to call a client function
 * from the server, so the back office failed its build on
 * `Attempted to call registerFallbackCatalog() from the server`. The registry is
 * only a `Map`; nothing about it needs the client.
 */
const fallbackCatalogs = new Map<string, Readonly<Record<string, object>>>([
  [
    'controls',
    { es: controlsCatalogs.es.controls, en: controlsCatalogs.en.controls },
  ],
]);

/** Adds a namespace to the no-provider fallback. Idempotent. */
export function registerFallbackCatalog(
  namespace: string,
  byLocale: Readonly<Record<string, object>>,
): void {
  fallbackCatalogs.set(namespace, byLocale);
}

/** One namespace's catalog in one locale, or `undefined` if nobody registered it. */
export function fallbackCatalogFor(
  namespace: string,
  locale: string,
): object | undefined {
  return fallbackCatalogs.get(namespace)?.[locale];
}
