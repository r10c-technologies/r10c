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
   * Locale to pin the run to. Seeded in both profiles so a run does not depend
   * on the CI machine's `Accept-Language` — without it the same spec renders
   * Spanish locally and English on a differently-configured runner.
   */
  locale?: string;
  /** Identifier + password for the `live` profile's real sign-in. */
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
 * fixtures. Signing it would need `jwt.secret`, which the suite has no business
 * knowing.
 */
const fabricateToken = (roles: readonly string[]): string => {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      userId: 'e2e-user',
      subject: 'e2e-user',
      sessionId: 'e2e-session',
      roles,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  return `${header}.${payload}.e2e-not-a-real-signature`;
};

/**
 * Give the browser context a signed-in session before the first navigation.
 *
 * Profile-aware, because "being signed in" means different things in each:
 * `mock` fabricates the cookie, while `live` performs a **real sign-in** through
 * auth-app so the token is one auth-service actually minted and the downstream
 * `requirePermission` checks are genuinely exercised.
 *
 * Call it before `page.goto` — an app whose middleware protects the route will
 * otherwise redirect away before the spec can assert anything.
 */
export const seedSession = async (
  context: BrowserContext,
  {
    roles = ['user'],
    locale = 'es',
    identifier = 'ada@example.com',
    password = 'password123',
    authAppUrl = process.env['AUTH_APP_URL'] ?? 'http://localhost:3002',
  }: SeedSessionOptions = {},
): Promise<void> => {
  if (!isMockProfile()) {
    const response = await context.request.post(
      `${authAppUrl}/api/auth/login`,
      {
        data: { identifier, password },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `seedSession: live sign-in failed (${response.status()}). Is auth-app running at ${authAppUrl} with its seed users?`,
      );
    }
    // The login handler set the cookies on the request context; move them onto
    // the browser context so page navigations carry them.
    await context.addCookies(
      await context.request.storageState().then(state => state.cookies),
    );
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, domain: 'localhost', path: '/' },
    ]);
    return;
  }

  await context.addCookies([
    {
      name: ACCESS_COOKIE,
      value: fabricateToken(roles),
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
