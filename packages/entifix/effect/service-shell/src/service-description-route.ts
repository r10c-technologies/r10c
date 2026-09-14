import { HttpRouter, HttpServerResponse } from '@effect/platform';
import type { BoundSubscription, ProbeKind } from '@r10c/entifix-ts-business';
import {
  HealthRegistryTag,
  WiringRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect } from 'effect';

import { requireServiceToken } from './auth/service-token.js';

/**
 * The path the wiring document is served at.
 *
 * Two **static** segments, which matters: `HttpRouter` resolves through
 * `find-my-way-ts`, where a static segment beats a parametric one but there is
 * no backtracking once a parametric branch has matched. A `/api/:something`
 * route registered anywhere in the same router would otherwise swallow this one
 * and answer its own `404` — the failure ADR 0026 hit with `$metadata`.
 */
export const SERVICE_DESCRIPTION_PATH = '/api/$service';

/** One thing this process is connected to, named logically. */
export interface DescribedTarget {
  /** The Store's register name, an exchange, or a service. Never a URI. */
  readonly name: string;
  /** The readiness probe that covers it, so the two documents line up. */
  readonly probe: string;
}

/**
 * What a service says about its own wiring.
 *
 * Shape, not values — `/api/config` is the sibling that serves the parameters a
 * service was given, redacted. Keeping them apart is deliberate: one is redacted
 * because it holds credentials, the other gated because it holds a map, and
 * merging them forces the stricter rule onto both (ADR 0031).
 */
export interface ServiceDescription {
  readonly service: string;
  /**
   * The slices this process hosts. More than one means co-deployment
   * (ADR 0021) — `marketplace-admin-service` runs the `transaction` slice too.
   */
  readonly slices: readonly string[];
  readonly stores: readonly DescribedTarget[];
  readonly brokers: readonly DescribedTarget[];
  readonly upstreams: readonly DescribedTarget[];
  /** Distinct event names this process has emitted since boot. */
  readonly published: readonly string[];
  /** The bus bindings this process actually made. */
  readonly subscriptions: readonly BoundSubscription[];
}

/**
 * Everything the two registries know, sorted by what it is.
 *
 * Generated from the **health probe registrations**, which is the one source
 * that cannot drift: a service that gains a datastore gains its probe by merging
 * the client's probe layer, so it gains a line here with no edit of its own.
 */
const describe = (
  service: string,
  slices: readonly string[],
): Effect.Effect<
  ServiceDescription,
  never,
  HealthRegistryTag | WiringRegistryTag
> =>
  Effect.gen(function* () {
    const health = yield* HealthRegistryTag;
    const wiring = yield* WiringRegistryTag;
    const probes = yield* health.probes;

    const ofKind = (kind: ProbeKind): readonly DescribedTarget[] =>
      probes
        .filter(probe => probe.kind === kind)
        .flatMap(probe =>
          probe.targets.map(name => ({ name, probe: probe.name })),
        );

    return {
      service,
      slices,
      stores: ofKind('datastore'),
      brokers: ofKind('broker'),
      upstreams: ofKind('upstream'),
      published: yield* wiring.published,
      subscriptions: yield* wiring.subscriptions,
    };
  });

/**
 * Mount `GET /api/$service` on a router.
 *
 * **Gated by `X-Service-Token`.** This names every store, exchange and upstream
 * a service has, which is a reconnaissance map rather than diagnostics. The
 * repository's precedent on maps of the model is uniform: `$metadata` answers
 * `404` rather than `403` so it cannot be walked as an oracle, readiness serves
 * probe names only, and `redactConfiguration` blanks anything flagged secret
 * because `/api/config` is unauthenticated. The health endpoints stay open —
 * a probe cannot hold a credential.
 *
 * The token is fleet membership, which is the right shape here: the readers are
 * `dev-infra:map` and CI, not a person and not a browser.
 *
 * **Logical names only.** Nothing in the response is a URI, and emphatically
 * nothing is `tenant_<organizationId>` — the tenant databases are named after
 * organizations, so leaking one turns a wiring document into a customer list.
 * The names come from a probe's `targets`, which are Store register names by
 * construction.
 */
export const withServiceDescriptionRoute = <E, R>(
  router: HttpRouter.HttpRouter<E, R>,
  serviceName: string,
  slices: readonly string[],
) =>
  router.pipe(
    HttpRouter.get(
      SERVICE_DESCRIPTION_PATH,
      requireServiceToken(
        Effect.flatMap(describe(serviceName, slices), description =>
          HttpServerResponse.json(description),
        ),
      ),
    ),
  );
