import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  type SagaInstance,
  SagaStoreTag,
} from '@r10c/entifix-transactions';
import { makeEnvelope } from '@r10c/entifix-ts-core';
import {
  type RequestPrincipal,
  requirePrincipal,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * An instance the caller may not read is indistinguishable from one that is not
 * there.
 *
 * `403` would make the endpoint an oracle: a saga id is a `randomUUID`, and a
 * caller able to tell "not yours" from "no such flow" can confirm that a given
 * checkout happened. The sibling `GET /api/transaction/:id` answers the same
 * way for the same reason.
 */
const notFound = HttpServerResponse.json(
  { error: 'saga not found', code: 'notFound' },
  { status: 404 },
);

/**
 * Which organizations a flow actually touched, read off what it dispatched.
 *
 * ⚠️ **Derived from the calls rather than stored on the instance, because a
 * flow has no single organization.** A basket spanning two vendors takes holds
 * in two tenant databases, so the honest answer is a set — and it is a set that
 * only exists once the calls have been made. The platform-plane steps (the
 * order write, the capture) carry none at all, which is why this reads every
 * call rather than the first.
 */
const organizationsIn = (instance: SagaInstance): ReadonlySet<string> => {
  const organizations = new Set<string>();
  for (const outcome of instance.outcomes) {
    for (const call of outcome.calls) {
      if (call.organizationId !== undefined) {
        organizations.add(call.organizationId);
      }
    }
  }
  return organizations;
};

/**
 * `GET /api/saga/:id` — where a flow stopped, and what has been reversed.
 *
 * This is the concrete thing ADR 0039 chose orchestration *for*: the answer is
 * a read against one store rather than a correlation across the logs of three
 * services. The store has been able to answer it since #231; nothing served it
 * until #233.
 *
 * ⚠️ **Session-guarded and scoped, with no permission of its own.** The
 * `transaction` slice declares `domains: []`, and a permission is
 * `<domain>:<entity>:<action>` — so inventing one here would put a domain name
 * in a namespace nothing is provisioned for (ADR 0005, ADR 0039). The scope is
 * the principal's organization appearing among the calls the flow made.
 *
 * ⚠️ **Fails closed.** An instance that died before its first call reached a
 * participant carries no organization at all and is therefore readable by
 * nobody — the same direction the sibling route fails in, and the same reason:
 * a record that belongs to nobody must not belong to everybody. Such an
 * instance is not invisible, it is surfaced by the sweep's log and its metric,
 * which is where an unowned flow belongs.
 */
const byIdRoute = requirePrincipal((principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const store = yield* SagaStoreTag;
    const params = yield* HttpRouter.params;
    const instance = yield* store.get(params.id ?? '');

    if (
      instance === undefined ||
      principal.organizationId === undefined ||
      !organizationsIn(instance).has(principal.organizationId)
    ) {
      return yield* notFound;
    }

    return yield* HttpServerResponse.json(
      makeEnvelope('sagaInstance', instance.definition, instance),
    );
  }),
).pipe(Effect.catchAll(serverError));

/**
 * The instance read surface.
 *
 * `GET /api/saga/:id` sits beside `POST /api/saga/:definition` — same path
 * shape, different verb, and no collision because `find-my-way-ts` routes on
 * the method first. There is deliberately no list: the `saga` store is
 * control-plane and single-partition, so an unfiltered index is every
 * organization's flows, which is the surface #194 deleted
 * `GET /api/transaction` for.
 */
export const sagaInstanceRoutes = <E, R>(router: HttpRouter.HttpRouter<E, R>) =>
  router.pipe(HttpRouter.get('/api/saga/:id', byIdRoute));
