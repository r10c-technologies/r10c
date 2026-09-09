import {
  Reservation,
  StockItem,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@r10c/entifix-ts-rest-client';
import { Context } from 'effect';

import type { StockAdapters } from '../client-types';

/**
 * The one backend this shell reads, as a **symbolic domain key** rather than an
 * address.
 *
 * The host rewrites it to its own same-origin proxy path before the browser
 * sees the configuration, which is what keeps a real backend address out of the
 * bundle and what carries the httpOnly cookie upstream — a cross-origin call
 * would answer `401`. back-office-app therefore composes stock URLs from a
 * *third* domain key, beside marketplace-admin's and marketplace's.
 *
 * ⚠️ **Plain REST, deliberately not `create: 'command'`.** A specification's
 * create goes through the transaction engine because a Redis sequence assigns
 * its `code` — a non-transactional side effect the saga coordinates. A movement
 * has no server-assigned member anyone waits for, this service runs no
 * transaction engine and its slice publishes no event, so a `202` here would
 * buy a tracker record and an outbox row for nothing.
 */
const STOCK_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'stock-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}. Each page merges only the entity context
 * it needs, so the single tag never collides at the point of use.
 *
 * ⚠️ `save` and `delete` are built for all three even though only
 * `StockMovement` has a route behind them. The adapter set is the transport,
 * not the permission: what withholds Save on the other two is the *served*
 * descriptor, which reports the caller's real affordances — and there is no
 * `stock-item:write` grant in any role and no save route to call. Omitting the
 * adapters instead would move that decision into the browser, where it would be
 * a second answer to a question the service already answers.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, STOCK_SERVICE),
    load: buildEntityRestAdapterLoad(entityConstructor, STOCK_SERVICE),
    save: buildEntityRestAdapterSave(entityConstructor, STOCK_SERVICE),
    delete: buildEntityRestAdapterDelete(entityConstructor, STOCK_SERVICE),
  });
}

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient(),
);

const stockItemRest = createRestRepositoryContext(StockItem);
const stockMovementRest = createRestRepositoryContext(StockMovement);
const reservationRest = createRestRepositoryContext(Reservation);

export function createClientAdapters(): StockAdapters {
  return {
    stockItemRest,
    stockMovementRest,
    reservationRest,
    configurationStore,
  };
}
