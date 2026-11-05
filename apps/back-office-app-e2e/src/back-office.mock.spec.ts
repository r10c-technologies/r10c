import {
  baseTest as test,
  expect,
  seedSession,
} from '@entifix/testing-e2e/playwright';

/**
 * The back-office gate, from the outside.
 *
 * What is asserted here is the app's edge behaviour — the cookie-presence
 * bounce — and that the layout fails closed on a token it cannot verify. The
 * layout resolves the principal from auth-service's `/api/me`, which the `mock`
 * profile answers from `support/fake-auth-service.mjs` for the token
 * `seedSession` fabricates and refuses for anything else. The **decision** is
 * covered where it is real: by `auth-service-e2e`, and by the live pass.
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
    // The same claims under a signature nobody issued: past the edge, which
    // only checks the cookie is there, and refused by auth-service.
    const forged = (await context.cookies()).map(cookie =>
      cookie.value.endsWith('.e2e-not-a-real-signature')
        ? { ...cookie, value: cookie.value.replace(/\.[^.]+$/, '.forged') }
        : cookie,
    );
    await context.clearCookies();
    await context.addCookies(forged);

    const response = await context.request.get(`${baseURL}/users`, {
      maxRedirects: 0,
    });

    // Past the edge — the cookie is there — but auth-service refuses the
    // token, so the layout cannot resolve a principal and turns the visitor
    // away rather than rendering user management to an unverified caller. The plain
    // `/` (no `redirect=`) is what distinguishes this from the edge bounce
    // above, which is the only way to tell the two 307s apart.
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).not.toContain('redirect=');
  });
});
