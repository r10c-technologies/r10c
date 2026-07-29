/**
 * Probe route handlers for the Next apps, mirroring what
 * `@r10c/shells-effect-service` mounts on the backends.
 *
 * They ship from `@r10c/shells-next-common/server` because a route handler must
 * not come from the `"use client"` bundle.
 */

/** How long a readiness result is reused, so probes cannot hammer config-service. */
const READY_CACHE_MS = 1_000;

/** A readiness check that hangs is a readiness check that failed. */
const READY_TIMEOUT_MS = 2_000;

interface ReadyState {
  readonly at: number;
  readonly ready: boolean;
}

export interface HealthRouteOptions {
  /** The app's package name, echoed back so a probe says what it reached. */
  readonly app: string;
  /** Base URL of config-service, e.g. `http://localhost:3190`. */
  readonly configApiUrl: string;
  /** The app's config key, i.e. the `:service` in `GET /api/config/:service`. */
  readonly configKey: string;
}

/**
 * Build the `GET` handlers for `/api/health`, `/api/health/live` and
 * `/api/health/ready`.
 *
 * **Liveness** answers from the process alone — no config-service, no backend,
 * no session. That is what makes it usable as Playwright's `readyPath` and what
 * keeps a dependency blip from getting the app killed by Kubernetes later.
 *
 * **Readiness** checks the one dependency the app cannot render without: its
 * configuration. It deliberately does *not* chain to the domain backend —
 * cascading readiness turns one degraded service into a fleet-wide outage, and
 * a page that renders with a degraded backend is still worth serving.
 */
export const createHealthRoutes = (options: HealthRouteOptions) => {
  let cached: ReadyState | null = null;

  const checkConfig = async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `${options.configApiUrl}/api/config/${options.configKey}`,
        { signal: AbortSignal.timeout(READY_TIMEOUT_MS), cache: 'no-store' },
      );
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    /** `GET /api/health` — the original endpoint, unchanged. */
    health: () => Response.json({ status: 'ok', app: options.app }),

    /** `GET /api/health/live` */
    live: () => Response.json({ status: 'live', app: options.app }),

    /** `GET /api/health/ready` */
    ready: async () => {
      const now = Date.now();
      if (cached === null || now - cached.at >= READY_CACHE_MS) {
        cached = { at: now, ready: await checkConfig() };
      }

      return cached.ready
        ? Response.json({ status: 'ready', app: options.app })
        : Response.json(
            { status: 'degraded', app: options.app, failing: ['config'] },
            { status: 503 },
          );
    },
  };
};
