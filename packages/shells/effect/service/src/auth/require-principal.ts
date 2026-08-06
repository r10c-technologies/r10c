import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  parsePermission,
  type Permission,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { type TokenClaims, TokenServiceTag } from '@r10c/entifix-ts-business';
import { Effect, Option } from 'effect';

/** The httpOnly cookie a Next app forwards carrying the access token. */
export const ACCESS_COOKIE = 'r10c_at';

/**
 * The authenticated subject as a service sees it. Structurally identical to
 * `business-ts-authn`'s `Principal`, re-declared here so the shared shell does
 * not depend on a single domain package.
 */
export interface RequestPrincipal {
  readonly userId: TokenClaims['userId'];
  readonly subject: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  /**
   * The organization this request acts for — the storage routing key, absent
   * for a caller with no tenant scope (a buyer, or an operator). Kept out of
   * `attributes` deliberately: attributes are policy inputs, this decides which
   * database a handler reads.
   */
  readonly organizationId?: string;
  /**
   * Which population the caller belongs to — buyer, vendor staff, or platform
   * staff. Carried so a handler never has to infer it from an absent
   * `organizationId`, which a buyer and an operator share.
   *
   * Context, not a grant: what the caller may *do* still comes from `roles`
   * through {@link PolicyDecisionTag}.
   */
  readonly partyRole?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** Extract a bearer token from an `Authorization` header, if present. */
const bearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }
  const [scheme, value] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
};

/** Rebuild the request principal from verified token claims. */
const claimsToPrincipal = (claims: TokenClaims): RequestPrincipal => ({
  userId: claims.userId,
  subject: claims.subject,
  sessionId: claims.sessionId,
  roles: claims.roles,
  // The organization comes from the *verified* token and nowhere else — never
  // from a route parameter, a query string or a body, all of which the caller
  // controls. That is what makes tenant isolation a property of the session
  // rather than of every handler remembering to check.
  organizationId: claims.activeOrganizationId,
  // Same rule, same reason: it comes from the verified token, never from
  // anything the caller can set on the request.
  partyRole: claims.partyRole,
  // Rich/volatile attributes are not in the token; a handler that needs them
  // reads the session store by `sessionId`.
  attributes: {},
});

// `code` is a key in the shared `errors` catalog; `error` stays English for
// logs. `permission` is deliberately still in the 403 — it says which grant was
// missing, which is diagnostic, not a leak.
const unauthenticated = HttpServerResponse.json(
  { error: 'unauthenticated', code: 'unauthenticated' },
  { status: 401 },
);

const forbidden = (permission: Permission) =>
  HttpServerResponse.json(
    { error: 'forbidden', code: 'forbidden', permission },
    { status: 403 },
  );

/**
 * Resolve the caller's principal from the request, or `None`. Reads the token
 * from the `r10c_at` cookie (the Next app forwards it) or an
 * `Authorization: Bearer` header and verifies it statelessly via
 * {@link TokenServiceTag} — no store round trip on the hot path.
 */
const resolvePrincipal = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const token =
    req.cookies[ACCESS_COOKIE] ?? bearerToken(req.headers['authorization']);
  if (token === undefined) {
    return Option.none<RequestPrincipal>();
  }

  const tokens = yield* TokenServiceTag;
  const claims = yield* tokens.verify(token).pipe(Effect.option);
  return Option.map(claims, claimsToPrincipal);
});

/**
 * Guard a handler behind a valid access token — authentication only. Any
 * missing or invalid token is a `401`; the wrapped handler's own errors are
 * left intact.
 */
export const requirePrincipal = <A, E, R>(
  use: (principal: RequestPrincipal) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const principal = yield* resolvePrincipal;
    if (Option.isNone(principal)) {
      return yield* unauthenticated;
    }
    return yield* use(principal.value);
  });

/**
 * Guard a handler behind a permission. Authenticates as above, then asks
 * {@link PolicyDecisionTag} whether this subject may perform the action — so
 * the two failure modes stay distinguishable: `401` means "sign in", `403`
 * means "signed in, not allowed".
 *
 * **This is the authorization boundary.** Filtering a nav menu or hiding a page
 * is presentation; a route that skips this guard is open regardless.
 */
export const requirePermission =
  (permission: Permission) =>
  <A, E, R>(use: (principal: RequestPrincipal) => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const principal = yield* resolvePrincipal;
      if (Option.isNone(principal)) {
        return yield* unauthenticated;
      }

      const { resource, action } = parsePermission(permission);
      const policy = yield* PolicyDecisionTag;
      const allowed = policy.decide({
        subject: { roles: principal.value.roles },
        resource,
        action,
      });
      if (!allowed) {
        return yield* forbidden(permission);
      }

      return yield* use(principal.value);
    });
