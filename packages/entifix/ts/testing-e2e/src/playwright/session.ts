import type { BrowserContext } from '@playwright/test';

import { isMockProfile } from '../profile/profile';

/** The cookies auth-app sets, host-scoped so the fleet shares them in dev. */
const ACCESS_COOKIE = 'r10c_at';
const SESSION_COOKIE = 'r10c_sid';
const LOCALE_COOKIE = 'r10c_locale';

export interface SeedSessionOptions {
  /** Roles the seeded principal should carry. */
  roles?: readonly string[];
  /**
   * The organization the seeded session acts for. Tenant-plane routes resolve
   * their storage from this claim, so a spec that exercises one and omits it
   * gets `409 no-active-organization` rather than data. Pass `null` to seed a
   * session with no tenant scope on purpose — an operator, or a buyer.
   */
  activeOrganizationId?: string | null;
  /**
   * Which population the seeded principal belongs to — `customer`, `vendor` or
   * `operator`. Defaults to `vendor`, matching the default organization: a
   * session that acts for one is a vendor member's. A spec exercising platform
   * staff passes `operator` together with `activeOrganizationId: null`.
   */
  partyRole?: string;
  /**
   * Locale to pin the run to. Seeded in both profiles so a run does not depend
   * on the CI machine's `Accept-Language` — without it the same spec renders
   * Spanish locally and English on a differently-configured runner.
   */
  locale?: string;
  /**
   * Identifier + password for the `live` profile's real sign-in, performed
   * against Zitadel's hosted login page. The default is the seeded super-admin
   * and the dev password `auth-service` provisions them with.
   */
  identifier?: string;
  password?: string;
  /** Where auth-app is served in `live`. */
  authAppUrl?: string;
}

const base64url = (value: string): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * A structurally valid, **deliberately unsigned** access token. It satisfies
 * exactly the two things the mock profile exercises — the middleware's cookie
 * presence check and the server-rendered nav's unverified role read — and
 * nothing else: no service verifies it, because in `mock` the services are msw
 * fixtures. Signing it would need the private key, which the suite has no
 * business knowing and which is exactly what asymmetric signing exists to keep
 * out of places like this.
 */
const fabricateToken = (
  roles: readonly string[],
  activeOrganizationId: string | null,
  partyRole: string,
): string => {
  const header = base64url(
    JSON.stringify({ alg: 'RS256', kid: 'e2e-not-a-real-key', typ: 'JWT' }),
  );
  const payload = base64url(
    JSON.stringify({
      userId: 'e2e-user',
      subject: 'e2e-user',
      sessionId: 'e2e-session',
      roles,
      partyRole,
      ...(activeOrganizationId === null ? {} : { activeOrganizationId }),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  return `${header}.${payload}.e2e-not-a-real-signature`;
};

/**
 * Sign in for real, through Zitadel's hosted login page.
 *
 * There is no API shortcut left and that is by design: auth-app has no endpoint
 * that accepts a password, because r10c holds none
 * ([ADR 0016](../../../../../docs/adr/0016-zitadel-authenticates-r10c-authorizes.md)).
 * The only way to obtain a real session is the flow a person performs, so the
 * `live` profile performs it — which also means this fixture exercises the
 * redirect, the PKCE exchange and the callback rather than skipping them.
 *
 * Selectors are the hosted UI's, so they are the fragile part of this file. They
 * are targeted by `name` rather than by class or test id, since those are the
 * attributes Zitadel's login form actually commits to.
 */
const signInThroughHostedUi = async (
  context: BrowserContext,
  options: {
    readonly authAppUrl: string;
    readonly identifier: string;
    readonly password: string;
  },
): Promise<void> => {
  const page = await context.newPage();
  try {
    await page.goto(`${options.authAppUrl}/api/auth/oidc/start`);

    await page.fill('input[name="loginName"]', options.identifier);
    await page.click('button[type="submit"]');

    await page.fill('input[name="password"]', options.password);
    await page.click('button[type="submit"]');

    // Back on our origin with cookies set. Waiting on the URL rather than on a
    // selector keeps this independent of whatever the landing page renders.
    await page.waitForURL(url => !url.host.includes('30080'), {
      timeout: 30_000,
    });

    const cookies = await context.cookies();
    if (!cookies.some(cookie => cookie.name === ACCESS_COOKIE)) {
      throw new Error(
        `seedSession: signed in but no ${ACCESS_COOKIE} cookie was set. Is auth-service running and seeded into Zitadel?`,
      );
    }
  } finally {
    await page.close();
  }
};

/**
 * Give the browser context a signed-in session before the first navigation.
 *
 * Profile-aware, because "being signed in" means different things in each:
 * `mock` fabricates the cookie, while `live` performs a **real sign-in** through
 * the provider's hosted page so the token is one auth-service actually minted
 * and the downstream `requirePermission` checks are genuinely exercised.
 *
 * Call it before `page.goto` — an app whose middleware protects the route will
 * otherwise redirect away before the spec can assert anything.
 */
export const seedSession = async (
  context: BrowserContext,
  {
    roles = ['user'],
    activeOrganizationId = 'e2e-organization',
    partyRole = 'vendor',
    locale = 'es',
    identifier = 'ada@example.com',
    password = 'Password123!',
    authAppUrl = process.env['AUTH_APP_URL'] ?? 'http://localhost:3002',
  }: SeedSessionOptions = {},
): Promise<void> => {
  if (!isMockProfile()) {
    await signInThroughHostedUi(context, {
      authAppUrl,
      identifier,
      password,
    });
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, domain: 'localhost', path: '/' },
    ]);
    return;
  }

  await context.addCookies([
    {
      name: ACCESS_COOKIE,
      value: fabricateToken(roles, activeOrganizationId, partyRole),
      domain: 'localhost',
      path: '/',
    },
    {
      name: SESSION_COOKIE,
      value: 'e2e-session',
      domain: 'localhost',
      path: '/',
    },
    {
      name: LOCALE_COOKIE,
      value: locale,
      domain: 'localhost',
      path: '/',
    },
  ]);
};
