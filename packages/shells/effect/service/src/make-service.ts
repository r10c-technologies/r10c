import { createServer } from 'node:http';

import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Layer } from 'effect';

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
  /** Composition root providing everything `router` requires. */
  readonly appLayer: Layer.Layer<R>;
}

/**
 * Boot an Effect service: mount `/api/health`, serve `router` over an
 * `@effect/platform-node` HTTP server with request logging, provide the
 * domain `appLayer`, and launch under `runMain` (SIGINT/SIGTERM interrupt the
 * fiber, so Layer finalizers — db pools, etc. — release deterministically).
 */
export const makeService = <E, R>(def: ServiceDefinition<E, R>): void => {
  const router = def.router.pipe(
    HttpRouter.get(
      '/api/health',
      HttpServerResponse.json({ status: 'ok', service: def.name })
    )
  );

  // Request logging + permissive CORS (frontends call these services
  // cross-origin from their dev ports). Tighten CORS per-environment later.
  const serverLive = HttpServer.serve(router, (app) =>
    HttpMiddleware.logger(HttpMiddleware.cors()(app))
  ).pipe(
    Layer.provide(def.appLayer),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port: def.port }))
  );

  NodeRuntime.runMain(Layer.launch(serverLive));
};
