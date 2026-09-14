import { DEFAULT_LOCALE, EntifixBuildError, type Locale } from '@r10c/entifix-ts-core';
import i18next, {
  type i18n,
  type Namespace,
  type ThirdPartyModule,
} from 'i18next';

/** One locale's catalogs, keyed by namespace. */
export type LocaleCatalogs = Readonly<Record<string, object>>;

/**
 * Every catalog an application renders: entifix's framework namespaces plus the
 * host's own, already merged.
 *
 * ⚠️ **Supplied by the host, never assembled here.** This package used to import
 * five namespaces directly, two of which were r10c product copy — `'r10c Admin'`
 * shipped inside the framework. Taking them as a value is what lets two
 * applications with different copy share one i18next setup.
 */
export interface I18nCatalogs {
  readonly resources: Readonly<Record<string, LocaleCatalogs>>;
  readonly namespaces: readonly string[];
  readonly defaultNS: string;
}

let installed: I18nCatalogs | undefined;

/**
 * Hand this package the application's catalogs. Call it once, from a module
 * every entry point imports.
 *
 * ⚠️ **A registry rather than an argument, and the reason is the call site.**
 * Every other seam in entifix takes its value at a composition root — a `Layer`,
 * a React provider, a hook option. `getServerT` has neither: it is called
 * directly inside React server components scattered across an application, with
 * nothing in between to thread a parameter through. So the seam is module
 * initialization, and the failure mode is made loud below rather than silent.
 *
 * Locale *routing* needs none of this. `@entifix/core`'s locale helpers carry
 * no catalogs, so Next middleware reads a cookie and a header without ever
 * loading i18next or a single translation.
 */
export function defineCatalogs(catalogs: I18nCatalogs): void {
  installed = catalogs;
}

const required = (): I18nCatalogs => {
  if (installed === undefined) {
    throw new EntifixBuildError(
      'No i18n catalogs are installed. Call `defineCatalogs({ resources, ' +
        'namespaces, defaultNS })` once from a module every entry point ' +
        'imports, before the first server render.',
    );
  }
  return installed;
};

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
 * package taking a dependency on React.
 */
export function createI18n(
  locale: Locale,
  modules: readonly ThirdPartyModule[] = [],
): i18n {
  const catalogs = required();
  const instance = modules.reduce<i18n>(
    (acc, module) => acc.use(module),
    i18next.createInstance(),
  );

  instance.init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...catalogs.namespaces],
    defaultNS: catalogs.defaultNS,
    resources: catalogs.resources,
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
 * It lives here rather than in the Next i18n shell because a `layer:shell`
 * package may not depend on another `layer:shell` package — and the storefront
 * shell, which has a real `[locale]` segment and therefore never reads a
 * request, is exactly the caller that needs it.
 */
export function getServerTFor<N extends Namespace>(locale: Locale, ns?: N) {
  // `Namespace` is i18next's own, so it resolves to whatever union the *host*
  // declared in `CustomTypeOptions`. This package names no namespace of its own
  // and imports no catalog — which is the whole point — while a caller still
  // gets a `t` bound to the namespace it asked for, and an unknown key stays a
  // compile error.
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

/** Drops the installed catalogs and the shared instance. For specs. */
export function resetCatalogs(): void {
  installed = undefined;
  shared = undefined;
}
