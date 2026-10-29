import {
  RequestPrincipalTag,
  type SessionRecord,
  SessionStoreTag,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  implement,
  JsonBody,
  NotFound,
  serializeEntityCollection,
} from '@entifix/core';
import {
  DevMailboxTag,
  UserDevice,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import { Context, Effect, Schema } from 'effect';

/**
 * Whether the development surface is served at all — `false` in production,
 * where its endpoint answers 404 so it does not even admit to existing. The
 * host decides, because whether this is production is a deployment fact.
 */
export class DevSurfaceEnabledTag extends Context.Service<
  DevSurfaceEnabledTag,
  boolean
>()('DevSurfaceEnabledTag') {}

/** What a session row looks like on the wire. */
const serializeSession = (record: SessionRecord, currentSessionId: string) => ({
  sessionId: record.sessionId,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  absoluteExpiresAt: record.absoluteExpiresAt,
  /** So the UI can label the row you are reading it from. */
  current: record.sessionId === currentSessionId,
  device: record.device ?? null,
});

/** A user's live sessions, newest first. */
export const listSessions = (userId: string, currentSessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const records = yield* sessions.listForUser(userId);
    return [...records]
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )
      .map(record => serializeSession(record, currentSessionId));
  });

const Items = Schema.Struct({ items: JsonBody });

/** `GET /api/auth/sessions` — where the caller is signed in. */
const mySessions = defineEndpoint({
  name: 'my-sessions',
  method: 'GET',
  path: '/api/auth/sessions',
  success: Items,
  errors: [DuplicateKey, NotFound],
  guard: { kind: 'session' },
});

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 * The ownership check is the point: the store revokes any id it is handed, so
 * an id that leaked into a log would otherwise be a remote-logout weapon. A
 * session of somebody else's answers exactly as an absent one does — `404`,
 * never `403`, which would confirm a guessed id. Revoking the current session
 * simply signs the caller out.
 */
const revokeMySession = defineEndpoint({
  name: 'revoke-my-session',
  method: 'DELETE',
  path: '/api/auth/sessions/:sessionId',
  params: { sessionId: Schema.String },
  success: Schema.Struct({ ok: Schema.Boolean, signedOut: Schema.Boolean }),
  errors: [DuplicateKey, NotFound],
  guard: { kind: 'session' },
});

/** `GET /api/auth/devices` — the caller's remembered browsers. */
const myDevices = defineEndpoint({
  name: 'my-devices',
  method: 'GET',
  path: '/api/auth/devices',
  success: Items,
  errors: [],
  guard: { kind: 'session' },
});

/**
 * `GET /api/dev/outbox` — the notifications this service has sent. A link
 * sent by mail is never returned in a response body, so without a readable
 * record such a journey could not be tested end to end. Behind a session, and
 * served only while the development surface is enabled.
 */
const devOutbox = defineEndpoint({
  name: 'dev-outbox',
  method: 'GET',
  path: '/api/dev/outbox',
  query: { to: Schema.optionalKey(Schema.String) },
  success: Items,
  errors: [NotFound],
  guard: { kind: 'session' },
});

/**
 * A signed-in user's own sessions and devices, each resolving the caller from
 * the verified token — an id in the URL is never authority. No password
 * endpoints: changing a password, a second factor and account recovery are
 * the provider's self-service.
 */
export const sessionEndpoints = [
  implement(mySessions, () =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      return {
        items: yield* listSessions(
          String(principal.userId),
          principal.sessionId,
        ),
      };
    }),
  ),
  implement(revokeMySession, ({ params }) =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      const sessions = yield* SessionStoreTag;
      const record = yield* sessions.read(params.sessionId);
      if (String(record.userId) !== String(principal.userId)) {
        return yield* new NotFound({ entity: 'session' });
      }
      yield* sessions.revoke(params.sessionId);
      return {
        ok: true,
        signedOut: params.sessionId === principal.sessionId,
      };
    }),
  ),
  implement(myDevices, () =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      const devices = yield* UserDeviceRepositoryTag;
      const items = yield* devices.listForUser(principal.userId);
      return { items: serializeEntityCollection(UserDevice, items) };
    }),
  ),
  implement(devOutbox, ({ query }) =>
    Effect.gen(function* () {
      if (!(yield* DevSurfaceEnabledTag)) {
        return yield* new NotFound({});
      }
      const mailbox = yield* DevMailboxTag;
      return { items: yield* mailbox.read(query.to) };
    }),
  ),
] as const;
