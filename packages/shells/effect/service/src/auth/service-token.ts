import { timingSafeEqual } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

/** The header a caller of config-service's fleet lookup presents. */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/**
 * Local-dev default, so `pnpm run mp-admin:dev` stays zero-config. Same
 * convention as the seeded `jwt.secret`: obviously a placeholder, replaced per
 * environment through `CONFIG_SERVICE_TOKEN`.
 */
export const DEV_SERVICE_TOKEN = 'dev-config-service-token-change-me';

/**
 * The expected token, read from the environment on each call rather than captured
 * at module load — so a test can set it without re-importing the module.
 */
export const serviceToken = (): string =>
  process.env.CONFIG_SERVICE_TOKEN ?? DEV_SERVICE_TOKEN;

/** Constant-time comparison, so the token cannot be recovered byte by byte. */
const matches = (provided: string | undefined): boolean => {
  if (provided === undefined) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(serviceToken());
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — the length of a shared secret is not what protects it.
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Guards config-service's fleet configuration lookup.
 *
 * `GET /api/config/:service` hands out `jwt.secret`, `mongo.uri`, `redis.uri` and
 * `rabbitmq.uri` in plaintext, because that is exactly what a booting service
 * needs — the values cannot be redacted here without breaking the boot the route
 * exists to serve. So the route is gated on a shared token instead, which closes
 * the drive-by read that being merely "cluster-internal" did not.
 *
 * This is deliberately **not** service identity: every caller presents the same
 * token, so it proves fleet membership and nothing more. Per-service credentials,
 * with the response scoped to the service that asked, are separate work; this is
 * the cheap step that stops the port from being self-serve.
 *
 * It lives here beside {@link loadRemoteConfiguration}, the client half of the
 * same protocol, so the header and the token cannot drift apart.
 *
 * Health endpoints are **not** guarded — a probe must answer without credentials,
 * or a readiness check becomes an authentication problem.
 */
export const requireServiceToken = <A, E, R>(route: Effect.Effect<A, E, R>) =>
  // The return type is inferred rather than written out: `HttpServerResponse.json`
  // contributes an `HttpBodyError` to the failure channel, and spelling the type
  // out while omitting it is what makes `tsc` refuse the declaration emit — which
  // `@nx/js:swc` hides, leaving a green build with no `.d.ts` and a TS6305
  // cascade in every consumer. `requirePrincipal` infers for the same reason.
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (!matches(request.headers[SERVICE_TOKEN_HEADER])) {
      return yield* HttpServerResponse.json(
        { error: 'unauthenticated', code: 'unauthenticated' },
        { status: 401 },
      );
    }

    return yield* route;
  });
