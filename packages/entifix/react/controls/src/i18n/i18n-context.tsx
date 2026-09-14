'use client';

import {
  DEFAULT_LOCALE,
  type Formatters,
  type Locale,
  makeFormatters,
} from '@r10c/entifix-ts-core';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import { fallbackCatalogFor } from './fallback-catalogs';

/**
 * Resolving a key to a sentence. The whole of what a control needs from an i18n
 * library, and deliberately not i18next's `TFunction`.
 *
 * ⚠️ **This port is what makes the controls adoptable on their own.** They used
 * to import `createI18n` directly, so taking a table meant taking i18next,
 * react-i18next and a Spanish catalog — the first of the three composition
 * defects the tier register was written to catch. The i18next binding now lives
 * behind `@entifix/react-controls/i18next`, and the peers it needs are optional.
 */
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

export interface Translator {
  readonly locale: Locale;
  readonly formatters: Formatters;
  /** `ns` is the namespace a caller asked for, or the default when omitted. */
  t(ns: string | undefined, key: string, params?: Record<string, unknown>): string;
}

const I18nContext = createContext<Translator | null>(null);

let fallback: Translator | undefined;

/** `'table.empty'` → the string at that path, or `undefined`. */
const at = (catalog: object, key: string): string | undefined => {
  let node: unknown = catalog;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
};

/**
 * Resolves a key, honouring i18next's `_one`/`_other` plural suffixes when the
 * caller passed a `count`.
 *
 * ⚠️ **Two plural forms, not a CLDR rule set.** i18next asks `Intl.PluralRules`
 * and handles languages with six categories; this covers the two that Spanish
 * and English have, which is what this package's own catalog is written in. An
 * adopter whose locale needs more than that wants the real thing — which is
 * what `@entifix/react-controls/i18next` is, and why it exists.
 */
const lookup = (
  catalog: object,
  key: string,
  params?: Record<string, unknown>,
): string | undefined => {
  const count = params?.['count'];
  if (typeof count === 'number') {
    const plural = at(catalog, `${key}_${count === 1 ? 'one' : 'other'}`);
    if (plural !== undefined) return plural;
  }
  return at(catalog, key);
};

const interpolate = (text: string, params?: Record<string, unknown>): string =>
  params === undefined
    ? text
    : text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      );

/**
 * What a control renders when nobody mounted a provider — Storybook, a unit
 * spec, a page that forgot.
 *
 * Deliberately a working translator rather than a thrown error, unlike
 * `useTheme`. These controls render inside server components, and a control
 * that explodes on a missing ancestor is worse than one that renders Spanish:
 * the failure mode becomes "this screen is Spanish for an English visitor",
 * which the locale-switch e2e catches, not a blank page.
 *
 * It resolves against **this package's own catalog**, which is the point of the
 * catalog living here: the controls arrive already able to speak, so an adopter
 * who wants no i18n library at all still gets a working table rather than one
 * captioned `table.empty`. A key outside `controls` — a host's namespace, an
 * entity label — has nothing here to resolve against and comes back as itself.
 */
function fallbackTranslator(): Translator {
  fallback ??= {
    locale: DEFAULT_LOCALE,
    formatters: makeFormatters(DEFAULT_LOCALE),
    t: (ns, key, params) => {
      // `useTranslateKey` hands over a fully qualified `entity:gadget.label`,
      // because a runtime key carries its own namespace. i18next strips the
      // prefix and answers with the bare key when it cannot resolve one, and
      // this matches that so swapping the binding in or out changes nothing a
      // caller can see.
      const [prefix, ...rest] = key.split(':');
      const qualified = rest.length > 0;
      const namespace = qualified ? prefix : ns;
      const bare = qualified ? rest.join(':') : key;

      const catalog = fallbackCatalogFor(namespace ?? 'controls', DEFAULT_LOCALE);
      if (catalog === undefined) return bare;
      const text = lookup(catalog, bare, params);
      return text === undefined ? bare : interpolate(text, params);
    },
  };
  return fallback;
}

export interface TranslatorProviderProps extends PropsWithChildren {
  readonly translator: Translator;
}

/**
 * Binds one translator to the subtree.
 *
 * A host with no i18n library builds one of these by hand; a host using
 * i18next mounts `I18nProvider` from `@entifix/react-controls/i18next`, which
 * builds it from a per-locale instance.
 */
export function TranslatorProvider({
  translator,
  children,
}: TranslatorProviderProps) {
  const value = useMemo(() => translator, [translator]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The translator in scope, or the key-returning fallback. */
export function useTranslator(): Translator {
  return useContext(I18nContext) ?? fallbackTranslator();
}

export function useLocale(): Locale {
  return useTranslator().locale;
}

/**
 * Locale-aware `Intl` wrappers. Every date and number a control renders goes
 * through these so the server and the browser agree on the output.
 */
export function useFormatters(): Formatters {
  return useTranslator().formatters;
}

/**
 * The translate function for one namespace.
 *
 * ⚠️ **Typed by the host, not by this package.** TypeScript permits exactly one
 * `declare module 'i18next' { interface CustomTypeOptions }` per compilation, so
 * the catalogs can be owned per package but the type gate cannot — a second
 * declaration is `TS2717`. entifix therefore ships each namespace's `Resources`
 * type and the host composes the single augmentation, which is what keeps every
 * `useT('shell')` and `useT('app')` call site compiling exactly as before.
 */
export function useT(ns?: string): Translate {
  const translator = useTranslator();
  return useMemo(
    () => (key, params) => translator.t(ns, key, params),
    [translator, ns],
  );
}

export type TranslateKey = Translate;

/**
 * Resolves a key that is only known at runtime — an entity's `labelKey`, one
 * value out of an enum vocabulary.
 *
 * Deliberately separate from {@link useT}, which stays strict. This is the one
 * place the typed-key guarantee is given up, and it is given up for keys that
 * `@entifix/core` cannot type: core carries `labelKey` as an opaque string
 * because it has no catalogs to check it against. Authored copy must go through
 * `useT` so a typo stays a compile error.
 */
export function useTranslateKey(): TranslateKey {
  return useT();
}
