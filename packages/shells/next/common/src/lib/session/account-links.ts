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
  'account.profile' | 'account.security' | 'account.sessions';

/** An account destination: a catalog key plus the path it lives at. */
export interface AccountDestination {
  /** Key in the `shell` namespace, resolved by whichever control renders it. */
  readonly labelKey: AccountLabelKey;
  /** Path within the host serving the account surface, with no locale prefix. */
  readonly path: string;
}

/**
 * Every account screen, in one list.
 *
 * The sidebar section and the account menu are the same three destinations and
 * were drifting as two hand-kept lists; both build from this one now, so adding
 * a screen is a one-line change here.
 *
 * It lives in the shared shell rather than in the auth shell because the menu
 * is rendered by `BackOfficeShell`, which any host mounts — a `shell:base`
 * package cannot reach up into a `shell:domain` one.
 */
export const ACCOUNT_DESTINATIONS: readonly AccountDestination[] = [
  { labelKey: 'account.profile', path: '/account' },
  // Not `/account/password` any more. r10c holds no password to change, so the
  // screen behind this is a set of links into the provider's own self-service —
  // which is also where a second factor is enrolled and a social account is
  // linked, neither of which had anywhere to live before.
  { labelKey: 'account.security', path: '/account/security' },
  { labelKey: 'account.sessions', path: '/account/sessions' },
];

export interface AccountLink {
  readonly labelKey: AccountLabelKey;
  readonly href: string;
}

/**
 * Account links as locale-prefixed paths on the host that serves them.
 *
 * There is no absolute-URL variant any more. There used to be one, for the apps
 * that linked across to auth-app on another port — the account surface and the
 * back office share an origin now, so every one of these is an ordinary in-app
 * navigation and a cross-origin builder would have no caller.
 */
export const accountPaths = (locale: Locale): readonly AccountLink[] =>
  ACCOUNT_DESTINATIONS.map(destination => ({
    labelKey: destination.labelKey,
    href: `/${locale}${destination.path}`,
  }));
