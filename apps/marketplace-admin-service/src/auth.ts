import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Principal } from '@r10c/business-ts-authn';
import { type TokenClaims, TokenServiceTag } from '@r10c/entifix-ts-business';
import { Effect, Option } from 'effect';

/** The httpOnly cookie the Next app forwards carrying the access token. */
const ACCESS_COOKIE = 'r10c_at';

/** Extract a bearer token from an `Authorization` header, if present. */
const bearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }
  const [scheme, value] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
};

/** Rebuild the request {@link Principal} from verified token claims. */
const claimsToPrincipal = (claims: TokenClaims): Principal => ({
  userId: claims.userId,
  subject: claims.subject,
  sessionId: claims.sessionId,
  roles: claims.roles,
  // Rich/volatile attributes are not in the token; a handler that needs them
  // reads the Redis session by `sessionId`.
  attributes: {},
});

const unauthenticated = HttpServerResponse.json(
  { error: 'unauthenticated' },
  { status: 401 }
);

/**
 * Guard a handler behind a valid access token. Reads the token from the
 * `r10c_at` cookie (the Next app forwards it) or an `Authorization: Bearer`
 * header, verifies it statelessly via {@link TokenServiceTag} (no store round
 * trip), and hands the resolved {@link Principal} to `use`. Any missing or
 * invalid token is a `401`; the wrapped handler's own errors are left intact.
 */
export const requirePrincipal = <A, E, R>(
  use: (principal: Principal) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const token =
      req.cookies[ACCESS_COOKIE] ?? bearerToken(req.headers['authorization']);
    if (token === undefined) {
      return yield* unauthenticated;
    }

    const tokens = yield* TokenServiceTag;
    const claims = yield* tokens.verify(token).pipe(Effect.option);
    if (Option.isNone(claims)) {
      return yield* unauthenticated;
    }

    return yield* use(claimsToPrincipal(claims.value));
  });
