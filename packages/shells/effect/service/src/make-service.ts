import { createServer } from 'node:http';

import { HttpMiddleware, HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
  makeShutdownRegistry,
  type ShutdownRegistry,
  ShutdownRegistryTag,
  WiringRegistryLayer,
  WiringRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { withHealthRoutes } from './health-routes.js';
import { withServiceDescriptionRoute } from './service-description-route.js';

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
  /**
   * The slices this process hosts, by their `tools/slices/` name.
   *
   * It cannot be derived. `EventSourceTag` names only the *emitting* slice, and
   * one deployment may host several: ADR 0021 co-deploys `transaction` inside
   * marketplace-admin-service. `dev-infra:map` checks each name against the
   * register's own `deployments`, so a wrong one fails the diff rather than
   * quietly mislabelling the fleet.
   */
  readonly slices: readonly string[];
  /** The service's routes; its `R` is satisfied by `appLayer`. */
  readonly router: HttpRouter.HttpRouter<E, R>;
  /**
   * Composition root providing everything `router` requires.
   *
   * It may also *require* {@link HealthRegistryTag} — that is how a client
   * layer's readiness probe registers itself — {@link WiringRegistryTag}, which
   * is how the bus records what it bound, and {@link ShutdownRegistryTag},
   * which is how it registers what draining it means. All three instances are
   * provided here, once, so the probes, the bus, the drain and the routes that
   * read them share one apiece.
   */
  readonly appLayer: Layer.Layer<
    R,
    never,
    HealthRegistryTag | ShutdownRegistryTag | WiringRegistryTag
  >;
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
 * `shutdown` overrides the registry, which is what {@link makeService} needs:
 * only a real process boot has a SIGTERM to latch, and an in-process e2e boot
 * that installed one would leave a process listener per service it started.
 */
export const makeServerLayer = <E, R>(
  def: ServiceDefinition<E, R>,
  port: number = def.port,
  shutdown: ShutdownRegistry = makeShutdownRegistry().registry,
) => {
  const router = withServiceDescriptionRoute(
    withHealthRoutes(def.router, def.name),
    def.name,
    def.slices,
  );

  // Request logging + permissive CORS (frontends call these services
  // cross-origin from their dev ports). Tighten CORS per-environment later.
  // `provideMerge` (not `provide`) so the registries the client layers
  // registered into are the same instances the readiness and description routes
  // read.
  const appLayer = def.appLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        HealthRegistryLayer,
        WiringRegistryLayer,
        Layer.succeed(ShutdownRegistryTag, shutdown),
      ),
    ),
  );

  // The graceful shutdown, and its **position** is the mechanism (ADR 0030).
  // Build order is `appLayer` → this → `serve`, so release order is the
  // reverse: the drain runs after the server has stopped taking requests and
  // *before* the connections it needs are closed. A signal handler could not
  // give that ordering — `runMain` interrupts the fiber on SIGTERM, and a
  // handler racing that interrupt would drain against a closing client.
  const drained = Layer.provideMerge(
    Layer.scopedDiscard(
      Effect.acquireRelease(Effect.void, () => shutdown.drain),
    ),
    appLayer,
  );

  return HttpServer.serve(router, app =>
    HttpMiddleware.logger(HttpMiddleware.cors()(app)),
  ).pipe(
    Layer.provide(drained),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
};

/**
 * Boot an Effect service: build {@link makeServerLayer} and launch it under
 * `runMain` (SIGINT/SIGTERM interrupt the fiber, so Layer finalizers — the
 * shutdown drain, then the db pools — release deterministically).
 *
 * The signal listeners here do **one** thing: flip the readiness latch, in the
 * same tick `runMain`'s own listener starts the interrupt, so
 * `GET /api/health/ready` stops claiming to be ready immediately rather than
 * when the finalizers get around to running. The draining itself is the
 * finalizer's, because only layer ordering can guarantee the connections are
 * still open while it happens.
 *
 * The `preStop` grace period ADR 0030 also names is **not** here and could not
 * be: Kubernetes runs it before it sends SIGTERM, and this repo declares no
 * Deployment for a service. It lands with the first one.
 */
export const makeService = <E, R>(def: ServiceDefinition<E, R>): void => {
  const shutdown = makeShutdownRegistry();
  process.once('SIGTERM', shutdown.begin);
  process.once('SIGINT', shutdown.begin);

  // `disablePrettyLogger` keeps `runMain` from swapping Effect's `defaultLogger`
  // for `prettyLoggerDefault`. A service that replaces `defaultLogger` (e.g. to
  // route logs through `@r10c/entifix-ts-tooling`) needs it present to replace;
  // services that don't simply keep the structured default logger.
  NodeRuntime.runMain(
    Layer.launch(makeServerLayer(def, def.port, shutdown.registry)),
    { disablePrettyLogger: true },
  );
};
