import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { TransactionStoreTag } from '@r10c/entifix-transactions';
import { makeEnvelope } from '@r10c/entifix-ts-core';
import {
  LoadedConfigurationTag,
  redactConfiguration,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', detail: String(error) },
    { status: 500 },
  );

/** `GET /api/transaction/:id` — the record a client polls after its `202`. */
const byIdRoute = Effect.gen(function* () {
  const store = yield* TransactionStoreTag;
  const params = yield* HttpRouter.params;
  const record = yield* store.get(params.id ?? '');
  if (record === undefined) {
    return yield* HttpServerResponse.json(
      { message: 'transaction not found' },
      { status: 404 },
    );
  }
  return yield* HttpServerResponse.json(
    makeEnvelope('transactionEvent', record.entity, record),
  );
}).pipe(Effect.catchAll(serverError));

/** `GET /api/transaction` — every tracked transaction. */
const listRoute = Effect.gen(function* () {
  const store = yield* TransactionStoreTag;
  const records = yield* store.list();
  return yield* HttpServerResponse.json({
    meta: { type: 'transactionEvent', entity: 'transaction' },
    data: records,
  });
}).pipe(Effect.catchAll(serverError));

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/transaction-manager',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

/**
 * transaction-manager routes. `/api/health` is added by the service base; the
 * bus subscription + recovery sweep are wired in the app layer, not here.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get('/api/transaction', listRoute),
  HttpRouter.get('/api/transaction/:id', byIdRoute),
);
