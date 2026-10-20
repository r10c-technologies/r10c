import { defineLocales } from '@entifix/core';

/**
 * The languages r10c ships, Spanish first and by default.
 *
 * entifix assumes none of its own since 0.3.0 (entifix#35): a host that
 * declares nothing speaks English alone, so without this every URL, cookie and
 * fallback in the fleet would quietly turn English. The declaration is r10c's
 * value, made where the catalogs that speak these languages live.
 *
 * ⚠️ **A side effect, and it has to run in every bundle that asks about a
 * locale.** A Next proxy is bundled apart from the server, the server apart
 * from the browser, and a service apart from all three, and none of them shares
 * module state. So it is imported by both apps' `src/proxy.ts`, by
 * `@r10c/i18n-catalog` (which every layout and provider loads), and by
 * auth-service, which passes the visitor's locale on to the hosted login.
 *
 * Its own subpath so a proxy never loads the catalogs beside it.
 */
declare module '@entifix/core' {
  interface LocaleRegister {
    locale: 'es' | 'en';
  }
}

export const R10C_LOCALES = ['es', 'en'] as const;

export const R10C_DEFAULT_LOCALE = 'es';

defineLocales({ locales: R10C_LOCALES, defaultLocale: R10C_DEFAULT_LOCALE });
