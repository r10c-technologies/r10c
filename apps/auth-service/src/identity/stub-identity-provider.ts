import type { IdentityProvider, Principal } from '@r10c/business-ts-authn';
import { UnauthenticatedError } from '@r10c/business-ts-authn';
import { Effect } from 'effect';

/**
 * PLACEHOLDER adapter — same stub the Nest `auth-api` uses, so the two shells
 * are compared on identical behaviour. The real Zitadel + Redis implementation
 * would slot in behind {@link IdentityProvider} exactly as it would in Nest.
 *
 * Difference from the Nest version: this file imports from the package ROOT
 * (`@r10c/business-ts-authn`), not the `/contracts` subpath. In a stage-3 shell
 * the root barrel — entity classes and all — bundles cleanly, so the firewall
 * is unnecessary here.
 */
export function makeStubIdentityProvider(): IdentityProvider {
  return {
    resolveSession(
      sessionId: string
    ): Effect.Effect<Principal, UnauthenticatedError> {
      if (!sessionId) {
        return Effect.fail(new UnauthenticatedError('empty session id'));
      }

      const principal: Principal = {
        userId: 'stub-user',
        subject: `stub-sub:${sessionId}`,
        sessionId,
        roles: [],
        attributes: {},
      };

      return Effect.succeed(principal);
    },

    resolveIdentifier(
      type: string,
      value: string
    ): Effect.Effect<never, UnauthenticatedError> {
      return Effect.fail(
        new UnauthenticatedError(`stub cannot resolve identifier ${type}:${value}`)
      );
    },
  };
}
