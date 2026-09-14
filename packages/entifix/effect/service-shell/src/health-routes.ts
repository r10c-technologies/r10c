import { HttpRouter, HttpServerResponse } from '@effect/platform';
import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryTag,
  ShutdownRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Ref } from 'effect';

/**
 * How long a readiness result is reused. These endpoints are unauthenticated by
 * necessity (a probe cannot hold a session), so without a cache every request
 * would reach Mongo — a cheap lever for anyone who can reach the port, and
 * noise in the datastore's own metrics.
 */
const READY_CACHE_MS = 1_000;

interface CacheEntry {
  readonly at: number;
  readonly report: HealthReport;
}

/**
 * Mount the probe endpoints on a router.
 *
 * - `GET /api/health` — the original endpoint, unchanged. Kept because
 *   Playwright's `readyPath` and existing tooling point at it.
 * - `GET /api/health/live` — **liveness**. Answers from the process alone: no
 *   datastore, no config-service, no session. This is deliberate and load
 *   bearing. A liveness probe that checks dependencies turns a Mongo blip into
 *   "Kubernetes restarts every replica", which is an outage the probe caused.
 * - `GET /api/health/ready` — **readiness**: `200` when every registered probe
 *   passes, `503 {status:'degraded', failing:[…]}` otherwise. Kubernetes pulls
 *   a not-ready pod out of the load balancer without killing it, which is what
 *   a reconnecting client wants. A process that has begun terminating answers
 *   `503 {status:'terminating'}` instead, **before** any probe runs: nothing is
 *   failing, and running the probes would ask a closing pool a question whose
 *   answer changes nothing.
 *
 * The failing list carries probe **names** only — never a URI, host, or driver
 * message. This endpoint answers anyone who can reach the port.
 */
// The return type is inferred rather than annotated: `HttpServerResponse.json`
// widens the router's error channel with `HttpBodyError`, and spelling that out
// here would only duplicate what the platform types already say.
export const withHealthRoutes = <E, R>(
  router: HttpRouter.HttpRouter<E, R>,
  serviceName: string,
) => {
  // One cache per server instance (the e2e mock profile boots services
  // in-process, so a module-level cache would leak across them).
  const cache = Ref.unsafeMake<CacheEntry | null>(null);

  const cachedReport = Effect.gen(function* () {
    const now = Date.now();
    const entry = yield* Ref.get(cache);
    if (entry !== null && now - entry.at < READY_CACHE_MS) return entry.report;

    const registry = yield* HealthRegistryTag;
    const report = yield* registry.report;
    yield* Ref.set(cache, { at: now, report });
    return report;
  });

  return router.pipe(
    HttpRouter.get(
      '/api/health',
      HttpServerResponse.json({ status: 'ok', service: serviceName }),
    ),
    HttpRouter.get(
      '/api/health/live',
      HttpServerResponse.json({ status: 'live', service: serviceName }),
    ),
    HttpRouter.get(
      '/api/health/ready',
      Effect.gen(function* () {
        const shutdown = yield* ShutdownRegistryTag;
        // Ahead of the cache, deliberately: a report cached a moment before the
        // signal landed would go on answering `200` for up to READY_CACHE_MS,
        // which is precisely the window a rolling restart lives in.
        if (yield* shutdown.terminating) {
          return yield* HttpServerResponse.json(
            { status: 'terminating', service: serviceName },
            { status: 503 },
          );
        }

        const report = yield* cachedReport;
        return yield* HttpServerResponse.json(
          report.ready
            ? { status: 'ready', service: serviceName }
            : {
                status: 'degraded',
                service: serviceName,
                failing: report.failing,
              },
          { status: report.ready ? 200 : 503 },
        );
      }),
    ),
  );
};
