import { expect, test } from '@playwright/test';
import { seedSession } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The account surface's edge behaviour.
 *
 * The regression that matters here: the middleware used to bounce **every**
 * authenticated visitor away from every path except `/users`, which made the
 * whole account surface unreachable — arriving at `/account` with a valid
 * session sent you straight back to the admin app. These assertions pin the
 * path classes that fixed it.
 *
 * As in `back-office.mock.spec.ts`, only the edge is asserted: the rendered page
 * needs auth-service to resolve a principal, and that is covered by
 * `auth-service-e2e` and by the live verification pass.
 */
test.describe('the /account surface', () => {
  test('bounces a visitor with no session to sign-in', async ({ request }) => {
    const response = await request.get('/es/account', { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location).toContain('/es?');
    // Carrying where they were headed, so sign-in returns them to /account
    // rather than dumping them on the admin app.
    expect(location).toContain('redirect=%2Faccount');
  });

  test('does NOT bounce an authenticated visitor away', async ({
    context,
    baseURL,
  }) => {
    await seedSession(context, { roles: ['user'] });

    const response = await context.request.get(`${baseURL}/es/account`, {
      maxRedirects: 0,
    });

    // The old middleware answered 307 to DEFAULT_REDIRECT here, which is what
    // made every account screen unreachable. Anything but a redirect to the
    // admin app means the path class is right; the layout may still turn the
    // visitor away because auth-service is not running, but it must not be the
    // *edge* sending them to :3001.
    const location = response.headers()['location'] ?? '';
    expect(location).not.toContain('3001');
  });

  test.describe('password recovery', () => {
    for (const path of ['/es/forgot-password', '/es/reset-password']) {
      test(`${path} stays reachable while signed in`, async ({
        context,
        baseURL,
      }) => {
        // Recovery has to work whether or not you still hold a session: you may
        // be signed in here and resetting because you lost another device.
        await seedSession(context, { roles: ['user'] });

        const response = await context.request.get(`${baseURL}${path}`, {
          maxRedirects: 0,
        });

        expect(response.headers()['location'] ?? '').not.toContain('3001');
      });
    }
  });
});
