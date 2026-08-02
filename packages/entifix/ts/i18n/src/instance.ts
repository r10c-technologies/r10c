import i18next, { type i18n, type ThirdPartyModule } from 'i18next';

import { DEFAULT_LOCALE, type Locale } from './locales';
import { defaultNS, type Namespace, NAMESPACES, resources } from './resources';

/**
 * Builds an isolated i18next instance for one locale.
 *
 * Always an *instance*, never the `i18next` singleton: a server renders several
 * locales concurrently, and a shared singleton would let one request's `lng`
 * leak into another's markup.
 *
 * Catalogs are bundled rather than fetched, so `init` completes synchronously
 * (`initAsync: false`) and the first paint is already translated — no Suspense
 * boundary, no flash of untranslated keys.
 *
 * `modules` is how the React binding passes `initReactI18next` without this
 * package — which sits at `entifix:tooling` — taking a dependency on React.
 */
export function createI18n(
  locale: Locale,
  modules: readonly ThirdPartyModule[] = [],
): i18n {
  const instance = modules.reduce<i18n>(
    (acc, module) => acc.use(module),
    i18next.createInstance(),
  );

  instance.init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...NAMESPACES],
    defaultNS,
    resources,
    initAsync: false,
    interpolation: {
      // React escapes for us; double-escaping turns "Café" into "Caf&#233;".
      escapeValue: false,
    },
  });

  return instance;
}

/**
 * A translate function for a locale the caller already holds — a route param,
 * typically — bound to one namespace.
 *
 * Request-free by construction, and that is the point: a component built on it
 * touches neither `headers()` nor `cookies()`, so the page containing it stays
 * statically renderable and can be prerendered once per locale. Its
 * request-reading counterpart is `getServerT` in `@r10c/shells-next-i18n`,
 * which re-exports this one for symmetry at app call sites.
 *
 * It lives here, at `entifix:tooling`, rather than in the Next i18n shell
 * because a `layer:shell` package may not depend on another `layer:shell`
 * package — and the storefront shell, which has a real `[locale]` segment and
 * therefore never reads a request, is exactly the caller that needs it.
 */
export function getServerTFor(locale: Locale, ns?: Namespace) {
  return createI18n(locale).getFixedT(locale, ns ?? null);
}

let shared: i18n | undefined;

/**
 * The instance used when no provider is mounted — Storybook, a unit spec, a
 * screen that forgot.
 *
 * One per process, shared across packages on purpose. Each React package
 * resolves copy through its own `useTranslation`, and react-i18next falls back
 * to its *uninitialized* global when no provider is in the tree — which renders
 * raw keys at the user. Handing every caller the same initialized default
 * instance makes that failure mode "the fleet default locale" instead.
 *
 * Built lazily, so an app that always mounts a provider never pays for it.
 */
export function sharedFallbackI18n(
  modules: readonly ThirdPartyModule[] = [],
): i18n {
  shared ??= createI18n(DEFAULT_LOCALE, modules);
  return shared;
}
