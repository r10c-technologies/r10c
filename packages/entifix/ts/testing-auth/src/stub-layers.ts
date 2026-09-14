import type { PolicyDecision } from '@r10c/business-ts-authz';
import { PolicyDecisionTag } from '@r10c/business-ts-authz';
import type { TokenClaims, TokenService } from '@r10c/entifix-ts-business';
import { TokenServiceTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { STUB_CLAIMS, stubAccessToken } from './stub-principal';

/**
 * A `TokenService` that trusts every token and answers with fixed claims.
 *
 * ⚠️ **This is the whole reason the package is `type:testing`.** `verify` does
 * not check a signature, so wiring this into anything reachable from a network
 * is an open door. It exists so an example can serve `$metadata` without an
 * identity provider — and it does that by replacing the *port*, not by adding
 * an unauthenticated branch to `entity-metadata-route.ts`. ADR 0026's point is
 * that the descriptor is filtered by the verified principal; a hole punched in
 * the route for a demo would become the adoption pattern.
 */
export const makeFixedTokenService = (
  claims: TokenClaims = STUB_CLAIMS,
): TokenService => ({
  // A stub token carries its own `exp`, so the requested lifetime is not read;
  // and `verify` ignores the token by design — see the note above.
  sign: signed => Effect.succeed(stubAccessToken(signed)),
  verify: () => Effect.succeed(claims),
});

export const FixedTokenServiceLayer = (
  claims: TokenClaims = STUB_CLAIMS,
): Layer.Layer<TokenServiceTag> =>
  Layer.succeed(TokenServiceTag, makeFixedTokenService(claims));

/** A `PolicyDecision` that grants every request. */
export const AllowAllPolicy: PolicyDecision = { decide: () => true };

export const AllowAllPolicyLayer: Layer.Layer<PolicyDecisionTag> =
  Layer.succeed(PolicyDecisionTag, AllowAllPolicy);
