import { audienceAdmits, type DomainEvent } from '@entifix/core';
import {
  makeServerPush,
  type PushConnection,
  type ServerPushOptions,
  ServerPushTag,
} from '@entifix/service-shell/push';
import {
  makeSsePush,
  type SsePushConnection,
  type SsePushDials,
} from '@entifix/service-shell/push/sse';
import { Context, Effect, Layer } from 'effect';
import type { HttpServerResponse } from 'effect/http';

import {
  PUSH_PROJECTIONS,
  type Pushed,
  type PushProjection,
} from './push-projections.js';

/**
 * One open stream: who is listening, and which entities their role lets them
 * read — decided once, at open, from `ROLE_PERMISSIONS` through the policy
 * decision port, never from the token.
 */
export interface RealtimeConnection extends SsePushConnection {
  readonly readable: ReadonlySet<string>;
}

/** The stream this replica serves, and the door the bus feeds it through. */
export interface RealtimePush {
  /** Projects a domain event and hands each variant to the open connections. */
  readonly publish: (event: DomainEvent) => Effect.Effect<void>;
  /** The held-open response for one connection. */
  readonly respond: (
    connection: RealtimeConnection,
  ) => HttpServerResponse.HttpServerResponse;
}

export class RealtimePushTag extends Context.Service<
  RealtimePushTag,
  RealtimePush
>()('@r10c/shells-effect-realtime/RealtimePush') {}

export interface RealtimePushOptions {
  /** The SSE adapter's dials, read from configuration (ADR 0072). */
  readonly dials: SsePushDials;
  /** What a reopened stream replays; the adapter's default is one `resync`. */
  readonly resume?: ServerPushOptions['resume'];
  /** The projection table; the shell's own by default. */
  readonly projections?: Readonly<Record<string, PushProjection>>;
}

const NOTHING_READABLE: ReadonlySet<string> = new Set();

const readableOf = (connection: PushConnection): ReadonlySet<string> =>
  (connection as Partial<RealtimeConnection>).readable ?? NOTHING_READABLE;

/**
 * Whether one pushed variant reaches one connection.
 *
 * ⚠️ **Fails closed twice.** The audience decides first — an event naming no
 * audience reaches nobody — and the gate second, so a connection opened
 * without a computed read set receives hints and never a record.
 */
export const admitsVariant = (
  pushed: Pushed | undefined,
  connection: PushConnection,
): boolean => {
  if (pushed === undefined) return false;
  if (!audienceAdmits(pushed.event.audience, connection.recipient))
    return false;
  const { gate } = pushed;
  if (gate.to === 'all') return true;
  const reads = readableOf(connection).has(gate.entity);
  return gate.to === 'readers' ? reads : !reads;
};

/** The topics one routed variant is delivered on; none for an unrouted event. */
export const routedTopics = (pushed: Pushed | undefined): readonly string[] =>
  pushed?.topics ?? [];

/**
 * The push hub and its SSE transport, with the projections between the bus and
 * them. Each variant is routed by identity: the hub asks for an event's topics
 * and whether a connection admits it, and the answer is the variant the
 * projection produced for that very object.
 */
export const makeRealtimePush = ({
  dials,
  resume,
  projections = PUSH_PROJECTIONS,
}: RealtimePushOptions) =>
  Effect.gen(function* () {
    const routing = new WeakMap<DomainEvent, Pushed>();
    const push = yield* makeServerPush({
      topicsOf: event => routedTopics(routing.get(event)),
      admits: (event, connection) =>
        admitsVariant(routing.get(event), connection),
      ...(resume === undefined ? {} : { resume }),
    });
    const sse = yield* makeSsePush(dials).pipe(
      Effect.provideService(ServerPushTag, push),
    );

    return RealtimePushTag.of({
      publish: event => {
        const project = projections[event.name];
        if (project === undefined) return Effect.void;
        return Effect.forEach(
          project(event),
          pushed => {
            routing.set(pushed.event, pushed);
            return push.publish(pushed.event);
          },
          { discard: true },
        );
      },
      respond: connection => sse.respond(connection),
    });
  });

export const RealtimePushLayer = (options: RealtimePushOptions) =>
  Layer.effect(RealtimePushTag, makeRealtimePush(options));
