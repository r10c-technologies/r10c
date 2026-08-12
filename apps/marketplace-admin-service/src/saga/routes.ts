import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { TransactionStoreTag } from '@r10c/entifix-transactions';
import { makeEnvelope } from '@r10c/entifix-ts-core';
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

/**
 * The `transaction` slice's read surface, mounted by the host router.
 *
 * These are the routes the catalog's own `202` points clients at. Now that both
 * slices share a process they answer on the same origin, which is why the
 * accepted-transaction link is a relative href — the client already knows the
 * origin, and a slice that moves out again changes its deployment, not the
 * contract.
 *
 * There is deliberately no `/api/config` here: the host already serves one, and
 * two `/api/config` routes in one router is the kind of duplication a merge is
 * supposed to remove rather than carry forward.
 */
export const sagaRoutes = <E, R>(router: HttpRouter.HttpRouter<E, R>) =>
  router.pipe(
    HttpRouter.get('/api/transaction', listRoute),
    HttpRouter.get('/api/transaction/:id', byIdRoute),
  );
