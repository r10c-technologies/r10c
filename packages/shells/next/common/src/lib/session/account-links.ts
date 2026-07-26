import type { Locale } from '@r10c/entifix-ts-i18n';

/** An account destination: a catalog key plus the path it lives at. */
export interface AccountDestination {
  /** Key in the `app` namespace. */
  readonly labelKey: string;
  /** Path within auth-app, with no locale prefix. */
  readonly path: string;
}

/**
 * Every account screen, in one list.
 *
 * auth-app owns the whole account surface; the other apps link across to it
 * rather than growing their own copies. Both sides build their menu from this
 * list, so adding a screen is a one-line change here.
 *
 * It lives in the shared shell rather than in auth-app because apps sit in
 * different scopes and cannot import from one another — only downward, into
 * here.
 */
export const ACCOUNT_DESTINATIONS: readonly AccountDestination[] = [
  { labelKey: 'auth.account.profile', path: '/account' },
  { labelKey: 'auth.password.nav', path: '/account/password' },
  { labelKey: 'auth.sessions.nav', path: '/account/sessions' },
];

export interface AccountLink {
  readonly labelKey: string;
  readonly href: string;
}

/**
 * Account links as paths inside auth-app itself, locale-prefixed.
 *
 * Used by auth-app, where these are ordinary in-app navigations.
 */
export const accountPaths = (locale: Locale): readonly AccountLink[] =>
  ACCOUNT_DESTINATIONS.map(destination => ({
    labelKey: destination.labelKey,
    href: `/${locale}${destination.path}`,
  }));

/**
 * Account links as absolute URLs into auth-app, locale already applied.
 *
 * The locale has to be baked in here: `localeHref` deliberately leaves absolute
 * URLs untouched, so a cross-app link that omits it arrives at auth-app with no
 * prefix and re-negotiates from a cookie on a *different origin* — which is how
 * a visitor reading English ends up back in Spanish.
 */
export const accountUrls = (
  authAppUrl: string,
  locale: Locale,
): readonly AccountLink[] =>
  ACCOUNT_DESTINATIONS.map(destination => ({
    labelKey: destination.labelKey,
    href: new URL(`/${locale}${destination.path}`, authAppUrl).toString(),
  }));
