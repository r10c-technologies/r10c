import { Effect } from 'effect';

import { IdentityProviderTag, SessionIdTag } from '../../repository';

/**
 * Resolves the opaque session id in context to the authenticated
 * {@link Principal}. The gateway runs this on the request path: it yields the
 * {@link SessionIdTag} (the value read from the session cookie) and the
 * {@link IdentityProviderTag} (bound in the shell to the Zitadel + Redis
 * adapter), and returns the principal to hydrate into the request / mint an
 * internal token from.
 *
 * The use-case references neither Zitadel, Redis, nor a framework — only the
 * tags — so it runs unchanged over a real provider or a test stub.
 */
export function resolveSessionUCFactory() {
  return Effect.gen(function* () {
    const identityProvider = yield* IdentityProviderTag;
    const sessionId = yield* SessionIdTag;

    return yield* identityProvider.resolveSession(sessionId);
  });
}
