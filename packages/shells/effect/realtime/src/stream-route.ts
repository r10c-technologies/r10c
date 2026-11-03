import { permissionFor } from '@entifix/authz';
import { Invalid, Unauthenticated } from '@entifix/core';
import { permits, respond } from '@entifix/service-shell';
import { fleetFailurePolicy } from '@r10c/shells-effect-service';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';

import {
  CAPABILITY_PARAM,
  identifies,
  MAX_CAPABILITIES,
  resolveCaller,
} from './caller.js';
import { PUSH_ENTITIES } from './push-projections.js';
import { RealtimePushTag } from './realtime-push.js';

/** Where the stream is served, behind the edge on every origin (ADR 0072). */
export const STREAM_PATH = '/api/realtime/stream';

/** The browser's parameter names (`@entifix/react-integration/event-source`). */
const TOPIC = 'topic';
const CURSOR = 'lastEventId';

/**
 * How many topics and capabilities one stream may name. A tab subscribes one
 * topic per screen and one per pending flow, so a ceiling far above that bounds
 * the work a single request can ask for without ever being reached by one.
 */
export const MAX_TOPICS = 256;

const LEGAL_TOPIC = /^(entity:[a-z0-9-]+|record:[a-z0-9-]+:[^\s:]+|flow:\S+)$/;

const invalid = (detail: string) =>
  new Invalid({
    errors: [{ pointer: `/query/${TOPIC}`, detail, code: 'malformed' }],
  });

const distinct = (values: readonly string[]) => Array.from(new Set(values));

/**
 * `GET /api/realtime/stream?topic=…&capability=…` — one stream per tab.
 *
 * The caller is a verified session (the `entifix_at` cookie or a bearer), a
 * presented flow capability, or both; with neither there is nothing it could
 * be shown, and it is refused **before** the stream opens, because a `401` on
 * an open `EventSource` kills it for good. Capabilities are compared by digest
 * and never kept in the clear. The cursor is the browser's `lastEventId` on a
 * reopen, or the `Last-Event-ID` header on its own reconnect.
 */
export const streamHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, 'http://realtime.invalid').searchParams;

  const topics = distinct(query.getAll(TOPIC));
  const capabilities = distinct(query.getAll(CAPABILITY_PARAM));
  if (topics.length === 0) return yield* invalid('name at least one topic');
  if (topics.length > MAX_TOPICS || capabilities.length > MAX_CAPABILITIES)
    return yield* invalid('too many topics or capabilities');
  if (!topics.every(topic => LEGAL_TOPIC.test(topic)))
    return yield* invalid('a topic is not entity:, record: or flow:');

  const caller = yield* resolveCaller(capabilities);
  if (!identifies(caller)) return yield* new Unauthenticated();

  const { member } = caller;
  const readable = new Set<string>();
  if (member !== undefined) {
    for (const entity of PUSH_ENTITIES) {
      if (
        yield* permits(member, permissionFor(entity.domain, entity.key, 'read'))
      )
        readable.add(entity.key);
    }
  }

  const cursor = query.get(CURSOR) ?? request.headers['last-event-id'];
  const push = yield* RealtimePushTag;
  return push.respond({
    recipient: caller.recipient,
    topics,
    readable,
    ...(cursor === undefined || cursor === '' ? {} : { cursor }),
    ...(member?.expiresAt === undefined ? {} : { expiresAt: member.expiresAt }),
  });
});

/** The stream, answered through the fleet's failure policy (ADR 0064). */
export const streamRoutes = HttpRouter.add(
  'GET',
  STREAM_PATH,
  respond(streamHandler, fleetFailurePolicy),
);
