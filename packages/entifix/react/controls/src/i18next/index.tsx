'use client';

import { type Locale, makeFormatters } from '@entifix/core';
import { createI18n, sharedFallbackI18n } from '@entifix/i18n';
import type { i18n as I18nInstance } from 'i18next';
import { type PropsWithChildren, useMemo } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { type Translator,TranslatorProvider } from '../i18n/i18n-context';

/**
 * The i18next binding of the translator port.
 *
 * Behind a subpath, with `i18next`, `react-i18next` and `@entifix/i18n` as
 * optional peers, so the controls themselves stay adoptable without any of it.
 * Package-level dependencies are not per-subpath — the optional peers are what
 * does the work, the same arrangement as `@entifix/mongo/transactions`.
 */
const translatorFor = (
  instance: I18nInstance,
  locale: Locale,
): Translator => ({
  locale,
  formatters: makeFormatters(locale),
  // `Translator.t` takes a plain string, because the port has to be
  // implementable without i18next at all. i18next's own `Namespace` is whatever
  // union the host declared, and it is not this adapter's job to know it — the
  // key stays checked at the `useT('shell')` call site, where the augmentation
  // is in scope.
  t: (ns, key, params) => {
    const fixed = instance.getFixedT(
      locale,
      (ns ?? null) as Parameters<I18nInstance['getFixedT']>[1],
    ) as (key: string, params?: Record<string, unknown>) => string;
    return fixed(key, params);
  },
});

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
  const translator = useMemo(
    () => translatorFor(instance, locale),
    [instance, locale],
  );

  return (
    <TranslatorProvider translator={translator}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </TranslatorProvider>
  );
}

/**
 * A translator over the shared fallback instance, for a caller that has
 * catalogs installed but no provider in the tree — a spec, a Storybook
 * decorator that renders one control.
 */
export function fallbackI18nextTranslator(locale: Locale): Translator {
  return translatorFor(sharedFallbackI18n([initReactI18next]), locale);
}
