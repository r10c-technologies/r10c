import { Invalid, makeEnvelope, NotFound } from '@entifix/core';
import { respond } from '@entifix/service-shell';
import {
  admitsFlowReader,
  FLOW_STATUS_LIST,
  FlowStatusStoreTag,
  toFlowStatusBody,
} from '@r10c/business-ts-flow-contracts';
import { fleetFailurePolicy } from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import {
  CAPABILITY_PARAM,
  identifies,
  MAX_CAPABILITIES,
  resolveCaller,
} from './caller.js';

/** Where a flow's status is read (ADR 0072, ADR 0073). */
export const FLOW_PATH = '/api/realtime/flow';

/** How many flows one list read may name — a tab's pending set, with room. */
export const MAX_FLOW_IDS = 100;

const queryOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, 'http://realtime.invalid').searchParams;

const invalid = (pointer: string, detail: string) =>
  new Invalid({ errors: [{ pointer, detail, code: 'malformed' }] });

/** Who is asking, from the session and any capabilities on the query. */
const callerOf = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const capabilities = queryOf(request).getAll(CAPABILITY_PARAM);
  if (capabilities.length > MAX_CAPABILITIES)
    return yield* invalid(
      `/query/${CAPABILITY_PARAM}`,
      'too many capabilities',
    );
  return yield* resolveCaller(capabilities);
});

const notFound = () => new NotFound({ entity: 'flow' });

/**
 * `GET /api/realtime/flow/:id` — where one flow stands, as the `flowStatus`
 * envelope the browser's catch-up decodes.
 *
 * ⚠️ **A miss of any kind is `404`.** Not projected yet, another
 * organization's flow, a capability that does not hash to the stored digest,
 * no credential at all — each answers exactly as an absent record does, so a
 * read confirms nothing about a flow its caller may not see. The browser
 * already reads `404` as "still pending" (ADR 0073).
 */
export const flowStatusHandler = Effect.gen(function* () {
  const caller = yield* callerOf;
  const { id } = yield* HttpRouter.params;
  if (id === undefined || id === '' || !identifies(caller))
    return yield* notFound();
  const store = yield* FlowStatusStoreTag;
  const record = yield* store.read(id);
  if (record === undefined || !admitsFlowReader(record, caller.recipient))
    return yield* notFound();
  return yield* HttpServerResponse.json(
    makeEnvelope('flowStatus', 'flow', toFlowStatusBody(record)),
  );
});

/**
 * `GET /api/realtime/flow?ids=a,b` — every flow among `ids` the caller may
 * read, and silently not the others, for the same reason a single miss is a
 * `404`.
 */
export const flowStatusListHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const ids = Array.from(
    new Set(
      (queryOf(request).get('ids') ?? '')
        .split(',')
        .map(id => id.trim())
        .filter(id => id !== ''),
    ),
  );
  if (ids.length === 0) return yield* invalid('/query/ids', 'name a flow');
  if (ids.length > MAX_FLOW_IDS)
    return yield* invalid('/query/ids', 'too many flows');
  const caller = yield* callerOf;
  const store = yield* FlowStatusStoreTag;
  const records = identifies(caller) ? yield* store.readMany(ids) : [];
  return yield* HttpServerResponse.json(
    makeEnvelope(
      FLOW_STATUS_LIST,
      'flow',
      records
        .filter(record => admitsFlowReader(record, caller.recipient))
        .map(toFlowStatusBody),
    ),
  );
});

/**
 * The flow reads, served beside the `HttpApi` like the stream: a read answered
 * to a session **or** a capability has no guard kind of its own, so the shell
 * resolves the caller itself and the store decides nothing about who asks.
 */
export const flowRoutes = Layer.mergeAll(
  HttpRouter.add(
    'GET',
    `${FLOW_PATH}/:id`,
    respond(flowStatusHandler, fleetFailurePolicy),
  ),
  HttpRouter.add(
    'GET',
    FLOW_PATH,
    respond(flowStatusListHandler, fleetFailurePolicy),
  ),
);
