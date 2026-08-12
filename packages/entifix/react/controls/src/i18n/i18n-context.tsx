'use client';

import {
  createI18n,
  DEFAULT_LOCALE,
  type Formatters,
  type Locale,
  makeFormatters,
  type Namespace,
  sharedFallbackI18n,
} from '@r10c/entifix-ts-i18n';
import type { i18n as I18nInstance } from 'i18next';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from 'react-i18next';

interface I18nContextValue {
  readonly locale: Locale;
  readonly formatters: Formatters;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let fallbackValue: I18nContextValue | undefined;

/**
 * What a control renders when nobody mounted a provider — Storybook, a unit
 * spec, a page that forgot.
 *
 * Deliberately the fleet default rather than a thrown error, unlike `useTheme`.
 * These controls render inside server components, and a control that explodes
 * on a missing ancestor is worse than one that renders Spanish: the failure
 * mode becomes "this screen is Spanish for an English visitor", which the
 * locale-switch e2e catches, not a blank page.
 */
function fallbackI18n(): { instance: I18nInstance; value: I18nContextValue } {
  fallbackValue ??= {
    locale: DEFAULT_LOCALE,
    formatters: makeFormatters(DEFAULT_LOCALE),
  };
  return {
    instance: sharedFallbackI18n([initReactI18next]),
    value: fallbackValue,
  };
}

export interface I18nProviderProps extends PropsWithChildren {
  /** Negotiated upstream — by the Next middleware in an app, by a decorator in Storybook. */
  locale: Locale;
}

/**
 * Binds one locale to the subtree. A fresh i18next instance per locale keeps
 * concurrent server renders from sharing mutable `lng` state; `I18nextProvider`
 * carries it so any nested `useTranslation` resolves against the same catalogs.
 */
export function I18nProvider({ locale, children }: I18nProviderProps) {
  const instance = useMemo(
    () => createI18n(locale, [initReactI18next]),
    [locale],
  );
  const value = useMemo<I18nContextValue>(
    () => ({ locale, formatters: makeFormatters(locale) }),
    [locale],
  );

  return (
    <I18nContext.Provider value={value}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </I18nContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(I18nContext)?.locale ?? fallbackI18n().value.locale;
}

/**
 * Locale-aware `Intl` wrappers. Every date and number a control renders goes
 * through these so the server and the browser agree on the output.
 */
export function useFormatters(): Formatters {
  return useContext(I18nContext)?.formatters ?? fallbackI18n().value.formatters;
}

/**
 * The translate function, typed against the `es` catalog — a key that does not
 * exist is a compile error, not a string of raw key text at runtime.
 */
export function useT<N extends Namespace>(ns?: N) {
  const contextual = useContext(I18nContext);
  const { t } = useTranslation(
    ns,
    contextual === null ? { i18n: fallbackI18n().instance } : {},
  );

  return t;
}

export type TranslateKey = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/**
 * Resolves a key that is only known at runtime — an entity's `labelKey`, one
 * value out of an enum vocabulary.
 *
 * Deliberately separate from {@link useT}, which stays strict. This is the one
 * place the typed-key guarantee is given up, and it is given up for keys that
 * `entifix-ts-core` cannot type: core carries `labelKey` as an opaque string
 * because it has no catalogs to check it against. Authored copy must go through
 * `useT` so a typo stays a compile error.
 */
export function useTranslateKey(): TranslateKey {
  return useT() as unknown as TranslateKey;
}
