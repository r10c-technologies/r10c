import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  ConfigurationRepositoryTag,
  TenantDatabaseResolverTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  makeMongoTenantResolver,
  MongoClientLayer,
  MongoClientTag,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  observabilityFromConfiguration,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { ReservationTtlSecondsTag } from './reservation-ttl';

const SERVICE_NAME = 'stock-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The stock-service composition root — the `stock` store's only writer.
 *
 * **`MongoClientLayer`, not `MongoDatabaseLayer`**, for the same reason
 * marketplace-admin-service uses it and marketplace-service does not: every
 * handle here is `stock_<organizationId>`, resolved inside the request from the
 * verified session. Naming a database at boot would create one nothing ever
 * writes — the phantom store ADR 0020 struck `marketplace_admin` for — and the
 * readiness probe does not need one, since it pings `admin`.
 *
 * ⚠️ **The prefix is `stock_`, not `tenant_`.** They are two stores in the same
 * plane with the same partitioning, and the only thing keeping them apart is
 * which prefix this resolver was built with. A copied `tenant_` row here would
 * merge the catalog and the stock store silently: every read would work, every
 * write would land, and two domains would own one database.
 *
 * No Redis, no AMQP. This slice takes no distributed lock — ADR 0010 prohibits
 * one per decrement, because it would serialize every purchase of a popular
 * item through a single key — draws from no sequence, and declares no published
 * event, so there is no outbox to commit alongside a write.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    // Tenant storage: one Mongo database per organization, named from the
    // organization id. Configuration rather than a constant for the reason the
    // catalog's is — the convention is stated once, in config-service, instead
    // of being duplicated across the services that follow it.
    const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    // ⚠️ **This service's own crossing secret — not `CONFIG_SERVICE_TOKEN`.**
    // The fleet already has a shared token gating config-service's lookup, and
    // reusing it here would be one line of work and would turn a single leaked
    // secret into a tenant-data *write* capability across every organization.
    // The two grants are not comparable: one reads configuration, the other
    // moves a vendor's stock. Separate secrets bound the blast radius of a
    // rotation or a compromise
    // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
    //
    // It is an `is_secret` row, which is the security boundary rather than a
    // label: an unflagged row is served in full from the *unauthenticated*
    // `GET /api/config` this service also mounts.
    const crossingToken = yield* store.in('service').getString('token');

    // How long a hold survives. Configuration rather than a constant for the
    // reason `tenant.dbPrefix` is — see `reservation-ttl.ts`.
    const reservationTtlSeconds = yield* store
      .in('reservation')
      .getNumber('ttlSeconds');

    // Log level + sink and the OTLP endpoint, read from this service's own
    // configuration. Which keys and which are optional is the shell's, so every
    // service reads them the same way.
    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    const connections = Layer.mergeAll(
      MongoClientLayer({ uri }),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem: jwtPublicKey,
          keyId: jwtKeyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      // The authorization policy. Static role→permission table today; swapping
      // in an attribute-aware engine is a change of this line alone.
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
      Layer.succeed(ServiceCrossingTokenTag, crossingToken),
      Layer.succeed(ReservationTtlSecondsTag, reservationTtlSeconds),
    );

    // The connection contributes its own readiness probe, named by the logical
    // Store it backs rather than by the driver, so `/api/health/ready`
    // describes this service in the register's vocabulary (ADR 0031).
    const withProbes = Layer.provideMerge(
      MongoHealthProbeLayer(['stock']),
      connections,
    );

    // The tenant resolver: one client, N database handles. It needs the pool
    // (`MongoClientTag`) rather than a shared `Db`, and it is built here — at
    // the composition root — because only this file knows which driver backs
    // the port.
    const tenancy = Layer.provide(
      Layer.effect(
        TenantDatabaseResolverTag,
        Effect.map(MongoClientTag, client =>
          makeMongoTenantResolver(client, tenantPrefix),
        ),
      ),
      withProbes,
    );

    return Layer.merge(observability, Layer.provideMerge(tenancy, withProbes));
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
