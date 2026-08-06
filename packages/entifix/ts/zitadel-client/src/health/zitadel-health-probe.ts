import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

/** Probe name reported by `/api/health/ready` when Zitadel is unreachable. */
export const ZITADEL_PROBE_NAME = 'zitadel';

/** How long the probe waits before calling the instance unreachable. */
const PROBE_TIMEOUT_MILLIS = 2_000;

/**
 * Registers a readiness probe against the instance's `/debug/ready`.
 *
 * A service that cannot reach Zitadel can still answer liveness — its process
 * is fine — while readiness reports the truth, which is the split Kubernetes
 * acts on: drain traffic, do not restart.
 *
 * The endpoint is unauthenticated on purpose: a readiness check must not spend
 * a credential, and `/debug/ready` reveals nothing beyond "this instance is
 * serving". The deadline matters as much as the check, because an instance that
 * is mid-init accepts the connection and then simply does not answer — which
 * would leave readiness hanging at the one moment it must reply.
 */
export const ZitadelHealthProbeLayer = (
  issuer: string,
): Layer.Layer<never, never, HealthRegistryTag> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      const url = `${issuer.replace(/\/$/, '')}/debug/ready`;

      yield* registry.register({
        name: ZITADEL_PROBE_NAME,
        check: Effect.tryPromise(() =>
          fetch(url, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLIS),
          }),
        ).pipe(
          Effect.map(response => response.ok),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
      });
    }),
  );
