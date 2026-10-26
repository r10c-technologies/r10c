import { type SessionRecord, SessionStoreTag } from '@entifix/business';
import { serializeEntityCollection } from '@entifix/core';
import { requirePermission, requirePrincipal } from '@entifix/service-shell';
import {
  DevMailboxTag,
  SIGN_OUT_OTHERS,
  SignOutOtherSessionsInputTag,
  SignOutOtherSessionsUC,
  UserDevice,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import { Context, Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import { serverError } from './auth-responses.js';

/**
 * Whether the development surface is served at all — `false` in production,
 * where its routes answer 404 so they do not even admit to existing. The host
 * decides, because whether this is production is a deployment fact.
 */
export class DevSurfaceEnabledTag extends Context.Service<
  DevSurfaceEnabledTag,
  boolean
>()('DevSurfaceEnabledTag') {}

const notFound = () =>
  HttpServerResponse.json(
    { error: 'not found', code: 'notFound' },
    { status: 404 },
  );

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

/** Read a user's live sessions, newest first. */
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

/** `GET /api/auth/sessions` — where the caller is signed in. */
const mySessionsRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const items = yield* listSessions(
      String(principal.userId),
      principal.sessionId,
    );
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catch(serverError)),
);

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 *
 * The ownership check is the point. `SessionStore.revoke` will kill any id it is
 * handed; the moment a route accepts an id from the outside, a session id that
 * leaks into a log or a URL would otherwise become a remote-logout weapon.
 * Revoking your CURRENT session is allowed and simply signs you out.
 */
const revokeMySessionRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const target = params.sessionId as string;
    const sessions = yield* SessionStoreTag;

    const record = yield* sessions.read(target);
    if (String(record.userId) !== String(principal.userId)) {
      // Deliberately 404, not 403: confirming the id exists would tell a caller
      // they guessed a real session belonging to someone else.
      return yield* notFound();
    }

    yield* sessions.revoke(target);
    return yield* HttpServerResponse.json({
      ok: true,
      signedOut: target === principal.sessionId,
    });
  }).pipe(Effect.catch(notFound)),
);

/**
 * `POST /api/auth/sessions/revoke-others` — keep this one, end the rest.
 *
 * Guarded by the verb the use case declares rather than by the session alone,
 * so the grant is real authorization instead of decoration.
 *
 * ⚠️ Every role holds `sign-out-others`, because ending your own sessions is a
 * control the account owner must always have. A role added later that omits it
 * loses self-service, and nothing fails the build over it.
 */
const revokeOtherSessionsRoute = requirePermission(SIGN_OUT_OTHERS)(principal =>
  Effect.gen(function* () {
    yield* SignOutOtherSessionsUC.run().pipe(
      Effect.provideService(SignOutOtherSessionsInputTag, {
        userId: principal.userId,
        keepSessionId: principal.sessionId,
      }),
    );
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catch(serverError)),
);

/** `GET /api/auth/devices` — the caller's remembered browsers. */
const myDevicesRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const devices = yield* UserDeviceRepositoryTag;
    const items = yield* devices.listForUser(principal.userId);
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(UserDevice, items),
    });
    // `catchCause`, not `catch`: a bad value in a stored document throws
    // rather than failing, and a defect would otherwise escape as an empty 500
    // with nothing in the body to debug from.
  }).pipe(Effect.catchCause(serverError)),
);

/**
 * `GET /api/dev/outbox` — the notifications this service has sent.
 *
 * It exists because a link sent by mail is deliberately never returned in a
 * response body: without a readable record, such a journey could not be tested
 * end to end at all, and an untested recovery flow is one that quietly rots. A
 * single switch guards it, so the check is written once, here.
 */
const devOutboxRoute = Effect.gen(function* () {
  if (!(yield* DevSurfaceEnabledTag)) return yield* notFound();

  const mailbox = yield* DevMailboxTag;
  const req = yield* HttpServerRequest.HttpServerRequest;
  const to = new URL(req.url, 'http://localhost').searchParams.get('to');
  const items = yield* mailbox.read(to ?? undefined);
  return yield* HttpServerResponse.json({ items });
}).pipe(Effect.catchCause(serverError));

/**
 * A signed-in user's own sessions and devices. Every one of these resolves the
 * caller from the verified token and checks ownership — an id in the URL is
 * never authority. No password routes: changing a password, enrolling a second
 * factor and recovering an account are the provider's self-service.
 */
export const sessionRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/api/auth/sessions', mySessionsRoute),
  HttpRouter.route(
    'POST',
    '/api/auth/sessions/revoke-others',
    revokeOtherSessionsRoute,
  ),
  HttpRouter.route(
    'DELETE',
    '/api/auth/sessions/:sessionId',
    revokeMySessionRoute,
  ),
  HttpRouter.route('GET', '/api/auth/devices', myDevicesRoute),
  HttpRouter.route('GET', '/api/dev/outbox', devOutboxRoute),
]);
