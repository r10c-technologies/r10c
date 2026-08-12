import type { ServiceE2eContext } from '@r10c/entifix-ts-testing-e2e/service';

/**
 * Drive a full sign-in the way a browser would, minus the browser.
 *
 * Both legs, deliberately. Reading the `state` back out of the authorization URL
 * rather than letting a spec invent one is what keeps these journeys honest: the
 * callback consumes a token the start route actually minted, so a change that
 * broke the pairing would fail here rather than pass against a hand-made value.
 *
 * In the `mock` profile the `code` **is** the email of whoever is signing in
 * (see `makeFakeZitadel`). In `live` the same call reaches a real Zitadel, where
 * a raw email is not a valid code — which is why the live pass is a browser
 * journey and not this helper.
 */
export const signIn = async (
  service: ServiceE2eContext,
  email: string,
  device?: Record<string, unknown>,
) => {
  const start = await service.client.post('/api/auth/oidc/start', {});
  const state = new URL(start.data.authorizationUrl as string).searchParams.get(
    'state',
  );

  return service.client.post('/api/auth/oidc/callback', {
    code: email,
    state,
    device,
  });
};
