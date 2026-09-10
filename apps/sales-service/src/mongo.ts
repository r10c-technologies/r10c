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
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { seedSales } from './seed';

const SERVICE_NAME = 'sales-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The sales-service composition root — the `sales` store's only writer.
 *
 * **`MongoClientLayer`, not `MongoDatabaseLayer`.** Every handle here is
 * `sales_<organizationId>`, resolved inside the request from the verified
 * session. Naming a database at boot would create one nothing ever writes — the
 * phantom store ADR 0020 struck `marketplace_admin` for — and the readiness
 * probe does not need one, since it pings `admin`.
 *
 * ⚠️ **The prefix is `sales_`, and it is the only thing separating this store
 * from two others in the same plane with the same partitioning.** A copied
 * `tenant_` or `stock_` row here would merge two stores silently: every read
 * would work, every write would land, and two domains would own one database.
 *
 * No Redis, no AMQP, and no crossing token **inbound**. Nothing in the fleet
 * calls this service on another organization's behalf: a channel is authored by
 * a member of the organization that owns it, so a verified session is the only
 * credential any route here accepts.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    // Tenant storage: one Mongo database per organization, named from the
    // organization id. Configuration rather than a constant, so the convention
    // is stated once — in config-service — instead of in every service that
    // follows it.
    const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');

    // The local demo vendor, whose channels this service seeds. The same id
    // auth-service provisions and the catalog and stock services seed under.
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

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
    );

    // The connection contributes its own readiness probe, named by the logical
    // Store it backs rather than by the driver, so `/api/health/ready`
    // describes this service in the register's vocabulary (ADR 0031).
    const withProbes = Layer.provideMerge(
      MongoHealthProbeLayer(['sales']),
      connections,
    );

    // The tenant resolver: one client, N database handles. It needs the pool
    // rather than a shared `Db`, and it is built here — at the composition root
    // — because only this file knows which driver backs the port.
    const tenancy = Layer.provide(
      Layer.effect(
        TenantDatabaseResolverTag,
        Effect.map(MongoClientTag, client =>
          makeMongoTenantResolver(client, tenantPrefix),
        ),
      ),
      withProbes,
    );

    // The demo vendor's channels, written on first boot into `sales_<id>`.
    //
    // ⚠️ **`Layer.provideMerge` over the tenancy layer, never a sibling in a
    // `Layer.mergeAll`.** `mergeAll` builds its members concurrently and Mongo
    // creates a tenant database on first write, so a sibling touching
    // `sales_<id>` would race the seed on a fresh `dev:reset` and see a store
    // that is empty, half-seeded or seeded depending on scheduling.
    const seeded = Layer.provideMerge(
      Layer.effectDiscard(seedSales(`${tenantPrefix}${demoOrganizationId}`)),
      tenancy,
    );

    return Layer.merge(observability, Layer.provideMerge(seeded, withProbes));
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
