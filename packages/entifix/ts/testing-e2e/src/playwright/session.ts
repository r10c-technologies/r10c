import type { BrowserContext } from '@playwright/test';

import { isMockProfile } from '../profile/profile';

/** Let a hosted-UI step navigate before the next one is inspected. */
const STEP_SETTLE_MS = 1_500;

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

    // A step machine rather than a fixed sequence, because the hosted UI's path
    // is not fixed. Three shapes a scripted login/password pair walks into:
    //
    // - **"Select Account"**, when the browser still holds a provider session
    //   from an earlier spec. There is no login field on it at all.
    // - **"2-Factor Setup"**, offered after the password to anyone with no
    //   enrolled factor. `forceMfa` is off, so it is a prompt with a Skip.
    // - **no screen at all**, when the provider session is still live and the
    //   authorization completes on the redirect.
    //
    // The loop's exit condition is the access cookie rather than the URL,
    // because that is what "signed in" actually means here and it is the only
    // one of the three that a landing origin does not lie about — the callback
    // lands on whichever app the redirect names, not on auth-app.
    for (let step = 0; step < 8; step += 1) {
      if ((await context.cookies()).some(c => c.name === ACCESS_COOKIE)) break;

      const otherUser = page.getByRole('link', { name: /other user/i });
      if (await otherUser.count()) {
        await otherUser.first().click();
        await page.waitForTimeout(STEP_SETTLE_MS);
        continue;
      }

      // Skipping the enrolment offer, not declining MFA: a user who HAS a
      // factor is asked to verify instead, and that screen has no Skip — which
      // is why a spec needing an enrolled user must seed its own code.
      const skip = page.getByRole('button', { name: /^skip$/i });
      if (await skip.count()) {
        await skip.first().click();
        await page.waitForTimeout(STEP_SETTLE_MS);
        continue;
      }

      // `:visible` is load-bearing on both, not defensive styling. The password
      // page carries a HIDDEN `loginName` input as an autocomplete hint, so a
      // plain name selector matches it, reports a count of one, and then blocks
      // forever in `fill` waiting for an element that will never be visible.
      const loginName = page.locator('input[name="loginName"]:visible');
      if (await loginName.count()) {
        await loginName.fill(options.identifier);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(STEP_SETTLE_MS);
        continue;
      }

      const password = page.locator('input[name="password"]:visible');
      if (await password.count()) {
        await password.fill(options.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(STEP_SETTLE_MS);
        continue;
      }

      // No cookie yet and nothing recognisable to do — an MFA challenge, or a
      // screen this fixture has not been taught. Say which, because a bare
      // timeout would send the reader looking in the wrong place.
      throw new Error(
        `seedSession: stuck on the hosted login at ${page.url()} ("${await page.title()}"). ` +
          'It is asking for something this fixture does not handle — a second factor, most likely.',
      );
    }

    if (!(await context.cookies()).some(c => c.name === ACCESS_COOKIE)) {
      throw new Error(
        `seedSession: finished the hosted login but no ${ACCESS_COOKIE} cookie was set. Is auth-service running and seeded into Zitadel?`,
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
