import { timingSafeEqual } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  type Permission,
  serviceCrossingAllows,
} from '@r10c/business-ts-authz';
import { Context, Effect } from 'effect';

/**
 * The header carrying the crossing secret.
 *
 * ⚠️ **Deliberately not `x-service-token`.** That header is config-service's
 * fleet lookup, and the two secrets are not comparable: one grants a
 * configuration *read*, this one a tenant-data *write* for any organization the
 * caller names. Sharing the header name is how a proxy configured to forward the
 * fleet token ends up presenting it to a route that writes stock, and how a
 * copy-pasted value looks right while being the wrong secret entirely
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/**
 * The header naming the organization the caller is acting for.
 *
 * It rides beside the token rather than inside the request body because
 * entities are organization-agnostic by rule — no `organizationId` member, no
 * tenant filter — so there is nowhere in an entity envelope for it to live. A
 * header also serves the crossings that carry no body at all (releasing a hold,
 * converting one), which a body field would have needed a second convention for.
 *
 * On its own it grants **nothing**: it is only read after the token has proved
 * the caller is the fleet, so the input the caller controls is never the input
 * that authorizes.
 */
export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * The crossing secret this service expects, provided at the composition root
 * from its own configuration.
 *
 * A `Context.Tag` rather than an environment read, which is the difference from
 * {@link requireServiceToken}: the value is a per-service secret held in
 * config-service as an `is_secret` row, so it arrives through the same boot
 * fetch as `mongo.uri` and can be rotated without redeploying a container.
 */
export class ServiceCrossingTokenTag extends Context.Tag(
  'ServiceCrossingTokenTag',
)<ServiceCrossingTokenTag, string>() {}

/** Constant-time comparison, so the secret cannot be recovered byte by byte. */
const matches = (provided: string | undefined, expected: string): boolean => {
  if (provided === undefined) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, so lengths are compared
  // first — the length of a shared secret is not what protects it.
  return left.length === right.length && timingSafeEqual(left, right);
};

const unauthenticated = HttpServerResponse.json(
  { error: 'unauthenticated', code: 'unauthenticated' },
  { status: 401 },
);

const forbidden = (permission: Permission) =>
  HttpServerResponse.json(
    { error: 'forbidden', code: 'forbidden', permission },
    { status: 403 },
  );

const organizationRequired = HttpServerResponse.json(
  {
    error: 'the crossing must name an organization',
    code: 'invalidRequest',
    detail: `${ORGANIZATION_HEADER} is required`,
  },
  { status: 400 },
);

/**
 * Guard a **service-to-service** tenant crossing: the second — and only other —
 * way a request resolves the organization it acts for.
 *
 * The first is {@link requireOrganization}, which reads the session's
 * `activeOrganizationId` and is the only *user-facing* resolution. This one
 * exists because a platform-plane caller sometimes acts for an organization the
 * principal is not a member of: checkout reserving a vendor's stock, where the
 * organization comes from the **item** and a buyer's session carries none — and
 * never will, since making a buyer a member of every vendor they buy from would
 * be a far worse breach than the problem it solved.
 *
 * There is no third path, no fallback and no operator branch. A request
 * satisfying neither guard simply never reaches a tenant handle
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md);
 * ADR 0012's operator crossing is a *different* mechanism — a person choosing an
 * organization, which needs a human's permission, a time box and a `Crossing`
 * record).
 *
 * ⚠️ **This guard reads no cookie and no `Authorization` header, and that is
 * the design.** A route guarded here accepts the crossing token and nothing
 * else: two accepted credentials on one route means the weaker one is the
 * security level. It matters concretely — `super-admin` holds `*:*:*`, which
 * matches every crossing permission, so a route that also took a session would
 * be reachable by an operator's browser tab.
 *
 * Three checks, in this order, so nothing is revealed before fleet membership is
 * proven:
 *
 * 1. the token, compared in constant time → `401`;
 * 2. the permission, against `SERVICE_CROSSING_PERMISSIONS` → `403`. The token
 *    proves the caller is the fleet; it does not say what the caller may do, and
 *    fleet membership is not a capability;
 * 3. the organization header, non-blank → `400`.
 *
 * **The recorded residual** (ADR 0023, not argued away here): a shared secret
 * means any process holding it can name any organization. What bounds it is the
 * permission above, the fact that only the slices needing it are configured with
 * the key, and the request log. What would remove it is an RS256 service token
 * carrying a scope claim, which is named work rather than a gap nobody noticed.
 */
export const requireServiceCrossing =
  (permission: Permission) =>
  <A, E, R>(use: (organizationId: string) => Effect.Effect<A, E, R>) =>
    // The return type is inferred rather than written out, for the reason
    // `requireServiceToken` records: `HttpServerResponse.json` contributes an
    // `HttpBodyError` to the failure channel, and spelling the type out while
    // omitting it is what makes the declaration emit fail invisibly.
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const expected = yield* ServiceCrossingTokenTag;

      if (!matches(request.headers[CROSSING_TOKEN_HEADER], expected)) {
        return yield* unauthenticated;
      }

      if (!serviceCrossingAllows(permission)) {
        return yield* forbidden(permission);
      }

      const organizationId = request.headers[ORGANIZATION_HEADER]?.trim();
      if (organizationId === undefined || organizationId === '') {
        return yield* organizationRequired;
      }

      return yield* use(organizationId);
    });

/**
 * The same fleet check, for a participant that has **no organization to name**.
 *
 * ⚠️ **A platform-plane store is the whole difference.** `requireServiceCrossing`
 * above ends with an organization header because it is about to resolve a tenant
 * database handle from it, and a blank one there would read some other vendor's
 * storage. order-service names one database at boot, so there is no handle to
 * choose — and demanding a header nothing consumes would be theatre that a
 * caller learns to satisfy with any value.
 *
 * What is unchanged, and is the part that matters: the token proves the caller
 * is the fleet, {@link SERVICE_CROSSING_PERMISSIONS} says what the fleet may do,
 * and **no session is accepted**. A saga step is not a person's act — the buyer
 * behind a checkout holds no grant over the order the coordinator is writing on
 * their behalf, and accepting their session here would make the weaker
 * credential the security level ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * The recorded residual carries over verbatim: a shared secret means any process
 * holding it can act, bounded by the permission and by which slices are
 * configured with the key.
 */
export const requireCrossing =
  (permission: Permission) =>
  <A, E, R>(route: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const expected = yield* ServiceCrossingTokenTag;

      if (!matches(request.headers[CROSSING_TOKEN_HEADER], expected)) {
        return yield* unauthenticated;
      }

      if (!serviceCrossingAllows(permission)) {
        return yield* forbidden(permission);
      }

      return yield* route;
    });
