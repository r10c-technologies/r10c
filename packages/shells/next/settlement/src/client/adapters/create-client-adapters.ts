import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
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

import type { SettlementAdapters } from '../client-types';

/**
 * The one backend this shell reads, as a **symbolic domain key** rather than an
 * address.
 *
 * The host rewrites it to its own same-origin proxy path before the browser sees
 * the configuration, which is what keeps a real backend address out of the
 * bundle and what carries the httpOnly cookie upstream — a cross-origin call
 * would answer `401`.
 *
 * ⚠️ **Plain REST, deliberately not `create: 'command'`.** Nothing here assigns
 * a server-side member anyone waits for, and this slice's own writes are folds
 * rather than requests. A `202` would buy a tracker record and an outbox row for
 * an agreement somebody is editing in a form.
 */
const SETTLEMENT_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'settlement-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}. Each page merges only the entity context
 * it needs, so the single tag never collides at the point of use.
 *
 * ⚠️ `save` and `delete` are built for all four even though only `Agreement`
 * has a save route and none has a delete. The adapter set is the transport, not
 * the permission: what withholds Save is the *served* descriptor, which reports
 * the caller's real affordances — and for an admin that is `read` even on the
 * agreement, because writing one is an operator act. Omitting the adapters
 * instead would move that decision into the browser, where it would be a second
 * answer to a question the service already answers.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, SETTLEMENT_SERVICE),
    load: buildEntityRestAdapterLoad(entityConstructor, SETTLEMENT_SERVICE),
    save: buildEntityRestAdapterSave(entityConstructor, SETTLEMENT_SERVICE),
    delete: buildEntityRestAdapterDelete(entityConstructor, SETTLEMENT_SERVICE),
  });
}

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient(),
);

const agreementRest = createRestRepositoryContext(Agreement);
const commissionEntryRest = createRestRepositoryContext(CommissionEntry);
const settlementRunRest = createRestRepositoryContext(SettlementRun);
const vendorPayoutRest = createRestRepositoryContext(VendorPayout);

export function createClientAdapters(): SettlementAdapters {
  return {
    agreementRest,
    commissionEntryRest,
    settlementRunRest,
    vendorPayoutRest,
    configurationStore,
  };
}
