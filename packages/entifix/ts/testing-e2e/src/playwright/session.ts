import type { BrowserContext, Page } from '@playwright/test';

import { isMockProfile } from '../profile/profile';

/** Give a hosted-UI component time to hydrate before its input is retyped. */
const STEP_SETTLE_MS = 1_000;

/**
 * Ceiling for a single hosted-UI action. Short on purpose: an action that cannot
 * complete has lost a race with a navigation, and the step machine wants to look
 * again rather than sit on it until the test's own timeout fires.
 */
const ACTION_TIMEOUT_MS = 10_000;

/** How long a step waits for the next screen: 40 × 250ms = 10s. */
const STEP_POLLS = 40;
const STEP_POLL_MS = 250;

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
 * Fill one field of the hosted login and submit it.
 *
 * The retype is load-bearing, not defensive. v2 disables Continue on
 * `!formState.isValid` — react-hook-form state, not the DOM value — and
 * Playwright can type into the input before Next has hydrated the component.
 * Those keystrokes reach the DOM and never reach the form, so the button never
 * enables, and the failure screenshot shows the value sitting in the field as if
 * nothing were wrong. Typing again once the component is live registers it.
 *
 * `pressSequentially` rather than `fill` for the same reason at a smaller scale,
 * and because it is what the login's own acceptance suite uses.
 *
 * Every action is bounded and nothing here throws: losing a race with a
 * navigation is normal (the screen this was called for is already gone), and the
 * caller re-reads the route and decides what to do next. An unbounded action
 * would instead hang until the whole test times out, and report the wrong step.
 */
const submitHostedField = async (
  page: Page,
  testId: string,
  value: string,
): Promise<void> => {
  const input = page.getByTestId(testId);
  const submit = page.getByTestId('submit-button');
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await input.pressSequentially(value, { timeout: ACTION_TIMEOUT_MS });
      if (await submit.isEnabled()) break;
      // The keystrokes went to a component that was not listening yet. Clear
      // what the DOM kept and type it again into the hydrated one.
      await page.waitForTimeout(STEP_SETTLE_MS);
      await input.fill('', { timeout: ACTION_TIMEOUT_MS });
    }
    await submit.click({ timeout: ACTION_TIMEOUT_MS });
  } catch {
    // Deliberately swallowed — see above.
  }
};

/**
 * Wait for the hosted login to actually move on.
 *
 * A fixed sleep after each step is a race, not a wait: when the redirect is slow
 * the loop re-reads the same route and acts on a screen that is mid-navigation,
 * and when it is fast the sleep is wasted. This returns as soon as the route
 * changes or the session lands, whichever comes first.
 */
const waitForNextStep = async (
  context: BrowserContext,
  page: Page,
  fromPath: string,
): Promise<void> => {
  for (let i = 0; i < STEP_POLLS; i += 1) {
    if ((await context.cookies()).some(c => c.name === ACCESS_COOKIE)) return;
    if (new URL(page.url()).pathname !== fromPath) return;
    await page.waitForTimeout(STEP_POLL_MS);
  }
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
 * Written against the **v2** hosted login (`ghcr.io/zitadel/zitadel-login`,
 * `infra/local/zitadel-login`). Screens are told apart by their **route**, not by
 * what is on them: v2 gives each step its own path under `/ui/v2/login`, while
 * its `data-testid`s are reused across screens (`reset-button` is "Reset
 * password" on one and "Skip" on another). Routes are also what the login app's
 * own acceptance suite drives, so they are the part of its surface most likely
 * to survive a release.
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
    // is not fixed. Four shapes a scripted login/password pair walks into:
    //
    // - **`/loginname`**, the identifier screen, where a cold run starts.
    // - **`/password`**, after it.
    // - **`/mfa/set`**, offered after the password to anyone with no enrolled
    //   factor. `forceMfa` is off, so it is a prompt with a skip.
    // - **`/accounts`**, when the browser still holds a provider session from an
    //   earlier spec. There is no login field on it at all.
    // - **no screen at all**, when the provider session is still live and the
    //   authorization completes on the redirect.
    //
    // The loop's exit condition is the access cookie rather than the URL,
    // because that is what "signed in" actually means here and it is the only
    // one of the three that a landing origin does not lie about — the callback
    // lands on whichever app the redirect names, not on auth-app.
    for (let step = 0; step < 8; step += 1) {
      if ((await context.cookies()).some(c => c.name === ACCESS_COOKIE)) break;

      const path = new URL(page.url()).pathname;

      if (path.endsWith('/accounts')) {
        await page
          .getByRole('link', { name: /add another account/i })
          .click({ timeout: ACTION_TIMEOUT_MS });
        await waitForNextStep(context, page, path);
        continue;
      }

      // Skipping the enrolment offer, not declining MFA: a user who HAS a
      // factor is challenged at `/otp/...` or `/u2f` instead, and those screens
      // have no skip — which is why a spec needing an enrolled user must seed
      // its own code.
      if (path.includes('/mfa/set')) {
        await page
          .getByTestId('reset-button')
          .click({ timeout: ACTION_TIMEOUT_MS });
        await waitForNextStep(context, page, path);
        continue;
      }

      if (path.endsWith('/loginname')) {
        await submitHostedField(
          page,
          'username-text-input',
          options.identifier,
        );
        await waitForNextStep(context, page, path);
        continue;
      }

      if (path.endsWith('/password')) {
        await submitHostedField(page, 'password-text-input', options.password);
        await waitForNextStep(context, page, path);
        continue;
      }

      // No cookie yet and on a route this fixture has not been taught — an MFA
      // challenge, a password change demand, or a screen v2 grew since. Name the
      // route, because a bare timeout would send the reader looking in the wrong
      // place.
      throw new Error(
        `seedSession: stuck on the hosted login at ${page.url()} ("${await page.title()}"). ` +
          `Route "${path}" is not one this fixture handles — a second factor, most likely.`,
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
