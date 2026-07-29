import type { Locale } from '@r10c/entifix-ts-i18n';

/**
 * The catalog keys naming these destinations, in the `shell` namespace.
 *
 * They are keys of `shell` and not of `app` because this list is shell-owned:
 * the module that authors a string owns its catalog entry and resolves it. When
 * they lived under `app:auth.*`, every host app had to resolve a key belonging
 * to a *different* app's sub-tree just to render this menu.
 *
 * Typed as a union rather than `string` so `useT('shell')` still checks them —
 * no `useTranslateKey` escape hatch is needed to render the menu.
 */
export type AccountLabelKey =
  'account.profile' | 'account.password' | 'account.sessions';

/** An account destination: a catalog key plus the path it lives at. */
export interface AccountDestination {
  /** Key in the `shell` namespace, resolved by whichever control renders it. */
  readonly labelKey: AccountLabelKey;
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
  { labelKey: 'account.profile', path: '/account' },
  { labelKey: 'account.password', path: '/account/password' },
  { labelKey: 'account.sessions', path: '/account/sessions' },
];

export interface AccountLink {
  readonly labelKey: AccountLabelKey;
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
