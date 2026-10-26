import {
  TenantDatabaseResolverTag,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  makeMongoTenantDirectory,
  makeMongoTenantResolver,
  MongoClientLayer,
  MongoClientTag,
  MongoDatabaseLayer,
  MongoHealthProbeLayer,
  MongoRepositoryFactoryLayer,
  MongoTenantRepositoryFactoryLayer,
} from '@entifix/mongo';
import { MongoUnitOfWorkLayer } from '@entifix/mongo/transactions';
import { Effect, Layer } from 'effect';

import type { FleetConfiguration } from './fleet-service.js';

/*
 * How a service holds its Mongo store is the store's plane, not a preference,
 * so each shape is its own function with its own exact type:
 *
 * - one database named at boot (`mongo.db`) — a platform or control store;
 * - the pool and a database per organization, resolved inside each request
 *   from `tenant.dbPrefix`. Naming a database at boot there would put a phantom
 *   store in the register;
 * - the pool alone, for a process whose stores are databases it names itself.
 *
 * `stores` names the readiness probe in the register's vocabulary (ADR 0031).
 */

/**
 * One named database, its probe, and the repository factory and unit of work
 * over it.
 */
export const fleetSingleMongoLayer = (
  { store }: FleetConfiguration,
  stores: readonly string[],
) =>
  Effect.gen(function* () {
    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');
    return Layer.provideMerge(
      Layer.mergeAll(
        MongoHealthProbeLayer(stores),
        MongoRepositoryFactoryLayer,
        MongoUnitOfWorkLayer,
      ),
      MongoDatabaseLayer({ uri, dbName }),
    );
  });

/**
 * The pool, and every organization's database behind it: the tenant resolver,
 * the tenant directory and the repository factory over them.
 *
 * ⚠️ **The prefix is the store.** `tenant_`, `stock_` and `sales_` are three
 * stores in one plane, kept apart by nothing but which prefix this layer was
 * built with. It is read from configuration, never defaulted.
 */
export const fleetTenantMongoLayer = (
  { store }: FleetConfiguration,
  stores: readonly string[],
) =>
  Effect.gen(function* () {
    const uri = yield* store.in('mongo').getString('uri');
    const prefix = yield* store.in('tenant').getString('dbPrefix');
    return Layer.provideMerge(
      fleetTenancyLayer(prefix, stores),
      MongoClientLayer({ uri }),
    );
  });

/** The pool and its probe, nothing else. */
export const fleetMongoPoolLayer = (
  { store }: FleetConfiguration,
  stores: readonly string[],
) =>
  Effect.map(store.in('mongo').getString('uri'), uri =>
    Layer.provideMerge(
      MongoHealthProbeLayer(stores),
      MongoClientLayer({ uri }),
    ),
  );

/**
 * The per-organization half over a pool someone else opened: the probe, the
 * tenant resolver and directory built from one prefix, and the repository
 * factory over them.
 */
export const fleetTenancyLayer = (prefix: string, stores: readonly string[]) =>
  Layer.provideMerge(
    MongoTenantRepositoryFactoryLayer,
    Layer.mergeAll(
      MongoHealthProbeLayer(stores),
      Layer.effect(
        TenantDatabaseResolverTag,
        Effect.map(MongoClientTag, client =>
          makeMongoTenantResolver(client, prefix),
        ),
      ),
      Layer.effect(
        TenantDirectoryTag,
        Effect.map(MongoClientTag, client =>
          makeMongoTenantDirectory(client, prefix),
        ),
      ),
    ),
  );
