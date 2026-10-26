import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';

/** A route set served in process, for a spec to call. */
export interface ServedRoutes {
  /** `fetch`, against the route set: no port, no socket. */
  readonly call: (path: string, init?: RequestInit) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

/**
 * Serves `routes` over `services` with Effect's own web handler.
 *
 * What an `http` cell's spec runs against (ADR 0063). It is not the
 * framework's `serveTestService`: that boots a whole service — runtime,
 * health routes, a listening port — and the cell's boundary rule forbids the
 * runtime half, rightly, because a cell must not choose how it is hosted.
 * Here the cell's real routes run their real guards, use cases and envelopes
 * against whatever doubles of its ports the spec provides.
 */
export const serveRoutes = <A, E, R, S, SE>(
  routes: Layer.Layer<A, E, R>,
  services: Layer.Layer<S, SE, never>,
): ServedRoutes => {
  // Merged, not provided: a route's requirements are resolved per request from
  // what the application layer *outputs*, so the services must be part of it.
  const { handler, dispose } = HttpRouter.toWebHandler(
    Layer.merge(routes, services) as never,
    { disableLogger: true },
  );
  const serve = handler as (request: Request) => Promise<Response>;
  return {
    call: (path, init) => serve(new Request(`http://cell${path}`, init)),
    dispose,
  };
};
