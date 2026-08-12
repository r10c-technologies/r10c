import { expect, test } from '@playwright/test';
import { seedSession } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The back-office gate, from the outside.
 *
 * What is asserted here is the app's edge behaviour only — the cookie-presence
 * bounce — because that is the part that holds without auth-service running.
 * The **role** gate lives in the back-office server layout, which resolves the
 * principal from auth-service over the network; asserting it against a stub
 * would only prove the stub. It is covered where it is real: by
 * `auth-service-e2e` for the decision itself, and by the live verification pass
 * for the rendered page.
 */
test.describe('the /users back office', () => {
  test('bounces a visitor with no session to sign-in', async ({ request }) => {
    // Locale-prefixed on purpose: locale resolution runs ahead of the auth gate,
    // so an unprefixed `/users` spends this hop on `/es/users` instead.
    const response = await request.get('/es/users', { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    // Sign-in sits at the locale-prefixed root, not the bare one — the gate
    // must not drop the visitor's locale on the way out.
    expect(location).toContain('/es?');
    // …carrying where they were headed, so sign-in can return them.
    expect(location).toContain('redirect=%2Fusers');
  });

  test('fails closed when the principal cannot be verified', async ({
    context,
    baseURL,
  }) => {
    // `context.request` rather than the `request` fixture: only the context's
    // client shares the cookie jar `seedSession` just wrote to.
    await seedSession(context, { roles: ['admin'] });

    const response = await context.request.get(`${baseURL}/users`, {
      maxRedirects: 0,
    });

    // Past the edge — the cookie is there — but auth-service is not running,
    // so the layout cannot resolve a principal and turns the visitor away
    // rather than rendering user management to an unverified caller. The plain
    // `/` (no `redirect=`) is what distinguishes this from the edge bounce
    // above, which is the only way to tell the two 307s apart.
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).not.toContain('redirect=');
  });
});
