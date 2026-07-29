import { createServer } from 'node:http';

import { HttpMiddleware, HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import { Layer } from 'effect';

import { withHealthRoutes } from './health-routes.js';

/**
 * Definition of an Effect-native backend service.
 *
 * `router` carries the service's routes and, in its `R` type parameter, the
 * exact set of domain services those routes require. `appLayer` must provide
 * that same `R` — the composition root. Because `R` is tracked in the type, a
 * missing dependency is a COMPILE error here, not a runtime surprise. This is
 * the uniform skeleton every `*-service` composes; the HTTP server, logging,
 * `/api/health`, and graceful shutdown live here so services stay thin.
 */
export interface ServiceDefinition<E, R> {
  /** Service name, surfaced on `/api/health`. */
  readonly name: string;
  /** Port to bind. Convention: 310N for domain services, 319x for platform. */
  readonly port: number;
  /** The service's routes; its `R` is satisfied by `appLayer`. */
  readonly router: HttpRouter.HttpRouter<E, R>;
  /**
   * Composition root providing everything `router` requires.
   *
   * It may also *require* {@link HealthRegistryTag} — that is how a client
   * layer's readiness probe registers itself. The registry instance is provided
   * here, once, so the probes and the `/api/health/ready` route share it.
   */
  readonly appLayer: Layer.Layer<R, never, HealthRegistryTag>;
}

/**
 * The service as a `Layer`: `/api/health` mounted, `router` served over an
 * `@effect/platform-node` HTTP server with request logging, `appLayer`
 * provided.
 *
 * Split out of {@link makeService} so the same wiring can be launched more than
 * one way. `makeService` runs it under `runMain` for production; the e2e mock
 * profile launches it in-process on an ephemeral port (see `serveTestService`).
 * Sharing this function is the point — a second assembly of router + health +
 * middleware would let the thing under test drift from the thing that ships.
 *
 * `port` overrides `def.port`, which is what an in-process boot needs.
 */
export const makeServerLayer = <E, R>(
  def: ServiceDefinition<E, R>,
  port: number = def.port,
) => {
  const router = withHealthRoutes(def.router, def.name);

  // Request logging + permissive CORS (frontends call these services
  // cross-origin from their dev ports). Tighten CORS per-environment later.
  // `provideMerge` (not `provide`) so the registry the client layers registered
  // their probes into is the same instance the readiness route reads.
  const appLayer = def.appLayer.pipe(Layer.provideMerge(HealthRegistryLayer));

  return HttpServer.serve(router, app =>
    HttpMiddleware.logger(HttpMiddleware.cors()(app)),
  ).pipe(
    Layer.provide(appLayer),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
};

/**
 * Boot an Effect service: build {@link makeServerLayer} and launch it under
 * `runMain` (SIGINT/SIGTERM interrupt the fiber, so Layer finalizers — db
 * pools, etc. — release deterministically).
 */
export const makeService = <E, R>(def: ServiceDefinition<E, R>): void => {
  // `disablePrettyLogger` keeps `runMain` from swapping Effect's `defaultLogger`
  // for `prettyLoggerDefault`. A service that replaces `defaultLogger` (e.g. to
  // route logs through `@r10c/entifix-ts-tooling`) needs it present to replace;
  // services that don't simply keep the structured default logger.
  NodeRuntime.runMain(Layer.launch(makeServerLayer(def)), {
    disablePrettyLogger: true,
  });
};
