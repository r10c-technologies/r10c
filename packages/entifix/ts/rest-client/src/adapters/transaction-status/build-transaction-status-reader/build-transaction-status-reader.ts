import {
  readTransactionRecordEnvelope,
  type TransactionRecord,
  type TransactionStatusReader,
} from '@r10c/entifix-transactions';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import type { EntifixError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../../entity-rest/build-entity-rest-adapter-mixins';
import type { BuildEntityRestOptions } from '../../entity-rest/types';

/**
 * The tracker's own path segment. It is not an entity — nothing decorates a
 * `TransactionRecord` — but the URL is composed the same way every entity URL
 * is, so `buildEntityBaseUrl` (already generic over an arbitrary name) needs no
 * transaction-shaped sibling.
 */
const TRANSACTION_PATH = 'transaction';

/**
 * Reads one transaction's record over HTTP, for a browser reconciling a write it
 * started.
 *
 * ⚠️ **A `404` answers `undefined`, and that is not a failure.** `accepted`
 * reaches the tracker over the bus, so with the broker down the entity write
 * commits — the outbox is in the same Mongo transaction — while no event is ever
 * published and the tracker holds no record at all. A caller that treated this
 * as terminal would un-render a healthy write during a broker outage, which is
 * the moment nobody can tell a UI bug from an outage (ADR 0043). The route also
 * answers `404` for another tenant's record, deliberately, so it cannot be
 * walked to probe ids that are also primary keys — indistinguishable here, and
 * correctly so: neither is a record this caller may reconcile against.
 *
 * Every other status stays an error, so an unreachable service is not quietly
 * read as "no such transaction".
 */
export const buildTransactionStatusReader = (
  options: BuildEntityRestOptions,
): Effect.Effect<TransactionStatusReader, never, ConfigurationRepositoryTag> =>
  Effect.gen(function* () {
    const configurationStore = yield* ConfigurationRepositoryTag;

    return {
      read: (
        transactionId: string,
      ): Effect.Effect<TransactionRecord | undefined, EntifixError> =>
        Effect.gen(function* () {
          const url = yield* adapterMixins.buildEntityBaseUrl(
            configurationStore,
            options,
            TRANSACTION_PATH,
            transactionId,
          );

          const response = yield* performHttpRequestThroughFetch(
            adapterMixins.buildEntityRequest({ method: 'GET', url }),
          );

          return yield* readTransactionRecordEnvelope(response.body);
        }).pipe(
          Effect.catchAll(error =>
            error.details?.['status'] === 404
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        ),
    };
  });
