/**
 * The edge's route table — the one source both the local Envoy config and the
 * cluster's Envoy Gateway manifests are rendered from
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 *
 * A server-sent stream cannot cross a Next route handler, so the browser no
 * longer reaches Next directly: the edge owns the origins the browser, Zitadel's
 * redirects, config-service's origin rows and the e2e base URLs all name, and
 * Next moves to the origin + 200.
 */

/** One browser-facing origin and the Next app behind it. */
export interface Origin {
  /** The port the browser names, `300N`. Owned by the edge. */
  readonly origin: number;
  /** The Nx project, unscoped — also the cluster `Service` name. */
  readonly app: string;
}

export const ORIGINS: readonly Origin[] = [
  { origin: 3000, app: 'marketplace-app' },
  { origin: 3001, app: 'back-office-app' },
];

/**
 * Where Next listens behind an origin: `320N`. Derived, never written down a
 * second time, so the two cannot drift apart.
 */
export const UPSTREAM_OFFSET = 200;
export const upstreamOf = (origin: Origin): number =>
  origin.origin + UPSTREAM_OFFSET;

/**
 * The realtime slice's prefix, routed to realtime-service on every origin.
 *
 * `prefix` is matched element-wise — `/api/realtime` and `/api/realtime/…`,
 * never `/api/realtimeX` — which is Gateway API's `PathPrefix` and Envoy's
 * `path_separated_prefix`, so the two renderings mean the same thing.
 */
export const REALTIME = {
  app: 'realtime-service',
  prefix: '/api/realtime',
  stream: '/api/realtime/stream',
  port: 3191,
} as const;

/**
 * The push heartbeat, in seconds: how often an idle stream sends a comment
 * frame. Mirrors `PUSH_HEARTBEAT` in `@entifix/service-shell/push/sse`, and
 * `@r10c/docs-check` fails when the installed release moves it.
 */
export const HEARTBEAT_S = 15;

/**
 * Every idle timeout on the path, in seconds. More than twice the heartbeat, so
 * one lost frame never closes a healthy stream.
 */
export const IDLE_TIMEOUT_S = 45;

/**
 * Where the local edge reaches the host's processes from inside its container.
 * `serve.sh` maps it with `--add-host=host.docker.internal:host-gateway`, which
 * Docker Desktop already provides and a Linux runner needs.
 */
export const LOCAL_UPSTREAM_HOST = 'host.docker.internal';

/** The container `serve.sh` runs, and `edge:free-ports` removes. */
export const CONTAINER = 'r10c-edge';
