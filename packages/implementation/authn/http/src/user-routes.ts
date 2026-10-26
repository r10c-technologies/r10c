import { permissionForEntity } from '@entifix/authz';
import { SessionStoreTag } from '@entifix/business';
import { EntifixBuildError, serializeEntity } from '@entifix/core';
import { makeEntityRoutes, requirePermission } from '@entifix/service-shell';
import {
  AccountRepositoryTag,
  EntityIdentifier,
  type IdentifierType,
  ProviderDirectoryTag,
  provisionProviderHuman,
  RegisterInputTag,
  registerUserUCFactory,
  REVOKE_SESSIONS,
  RevokeUserSessionsInputTag,
  RevokeUserSessionsUC,
  UPDATE_ASPECTS,
  UpdateUserAspectsInputTag,
  UpdateUserAspectsUC,
  UserDevice,
  UserIdentity,
  UserStatus,
} from '@r10c/business-ts-authn';
import { isRole, type Role } from '@r10c/business-ts-authz-grants';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import {
  asString,
  readBody,
  respondAuthError,
  serverError,
} from './auth-responses.js';
import { listSessions } from './session-routes.js';

/** Every user-management route speaks this vocabulary, derived from the entity. */
const USER_WRITE = permissionForEntity(UserIdentity, 'write');
/** Looking at somebody else's sessions. Ending them is a verb of its own. */
const DEVICE_READ = permissionForEntity(UserDevice, 'read');

/** Read the requested role from a body, rejecting an unrecognised one. */
const parseRole = (value: unknown): Role | undefined =>
  isRole(value) ? value : undefined;

/**
 * Parse an administrative account-creation body into the use-case input, or
 * fail 400.
 *
 * No password is read, and none may be supplied: the account this creates has
 * no credential in r10c at all, and the one the provider holds is set through
 * the provisioning call that follows.
 */
const parseRegister = (body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const rawIdentifiers = Array.isArray(body['identifiers'])
      ? body['identifiers']
      : [];
    const identifiers = rawIdentifiers
      .map(entry => entry as Record<string, unknown>)
      .map(entry => ({
        type: asString(entry['type']) as IdentifierType | undefined,
        value: asString(entry['value']),
      }))
      .filter(
        (entry): entry is { type: IdentifierType; value: string } =>
          entry.type !== undefined && entry.value !== undefined,
      );

    if (identifiers.length === 0) {
      return yield* Effect.fail(
        new EntifixBuildError('an account needs at least one identifier'),
      );
    }

    return { displayName: asString(body['displayName']), identifiers };
  });

/**
 * `GET /api/user-identity/:id/sessions` — an administrator's view of where a
 * user is signed in, for incident response. Another user's device history is
 * not public just because the caller happens to be staff.
 */
const userSessionsRoute = requirePermission(DEVICE_READ)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const items = yield* listSessions(params.id as string, principal.sessionId);
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catch(serverError)),
);

/**
 * `DELETE /api/user-identity/:id/sessions` — sign a user out everywhere.
 *
 * Guarded by the verb the use case declares, not by `user-device:write`: that
 * grant describes the record, this one the act. Telling the owner is the use
 * case's job, and stays best-effort.
 */
const revokeUserSessionsRoute = requirePermission(REVOKE_SESSIONS)(() =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    yield* RevokeUserSessionsUC.run().pipe(
      Effect.provideService(RevokeUserSessionsInputTag, {
        userId: params.id as string,
      }),
    );
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catch(serverError)),
);

/**
 * `POST /api/user-identity` — administrative account creation.
 *
 * Deliberately the SAME use case a first sign-in runs: a generic entity write
 * would skip identifier uniqueness and the tier rule. The actor comes from the
 * verified principal, never from the body.
 *
 * Two systems, written in a fixed order and without a saga. The local record
 * goes first because it owns the role and the party — the two things the
 * provider never sees — and the human second. If the second half fails the
 * caller gets a `409` and the account is left with no external subject: it
 * cannot sign in, it is listed like any other, and submitting the same form
 * again repairs it (ADR 0016).
 */
const createUserRoute = requirePermission(USER_WRITE)(principal =>
  Effect.gen(function* () {
    const body = yield* readBody;
    const input = yield* parseRegister(body);
    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }

    const email = input.identifiers.find(
      identifier => identifier.type === 'email',
    )?.value;
    if (email === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'an email identifier is required', code: 'emailRequired' },
        { status: 400 },
      );
    }

    const subject = yield* registerUserUCFactory().pipe(
      Effect.provideService(RegisterInputTag, {
        ...input,
        role,
        actorRoles: principal.roles,
      }),
    );

    yield* provisionProviderHuman(
      yield* AccountRepositoryTag,
      yield* ProviderDirectoryTag,
      {
        userId: subject.userId,
        email,
        username: input.identifiers.find(
          identifier => identifier.type === 'username',
        )?.value,
        displayName: input.displayName,
      },
    );

    return yield* HttpServerResponse.json(subject, { status: 201 });
  }).pipe(Effect.catch(respondAuthError)),
);

/**
 * `PATCH /api/user-identity/:id` — change a user's role or status, then revoke
 * their sessions. Revocation is what makes the change immediate: grants are
 * derived from the `roles` claim, so without it a demoted user would keep their
 * old access until the token expired.
 */
const updateUserRoute = requirePermission(UPDATE_ASPECTS)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const body = yield* readBody;
    const userId = params.id as string;

    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }
    const rawStatus = asString(body['status']);
    const status = Object.values(UserStatus).includes(rawStatus as UserStatus)
      ? (rawStatus as UserStatus)
      : undefined;
    if (rawStatus !== undefined && status === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown status', code: 'unknownStatus' },
        { status: 400 },
      );
    }

    const updated = yield* UpdateUserAspectsUC.run().pipe(
      Effect.provideService(UpdateUserAspectsInputTag, {
        userId,
        role,
        status,
        actorUserId: principal.userId,
        actorRoles: principal.roles,
      }),
    );

    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUser(userId);

    return yield* HttpServerResponse.json(
      serializeEntity(UserIdentity, updated),
    );
  }).pipe(Effect.catch(respondAuthError)),
);

/**
 * Administering other people's accounts, every route permission-gated: this is
 * the authorization boundary, and a hidden menu entry protects nothing. The
 * canonical records are read the generic way, behind their own permission.
 */
export const userRoutes = Layer.mergeAll(
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/user-identity', createUserRoute),
    HttpRouter.route('PATCH', '/api/user-identity/:id', updateUserRoute),
    HttpRouter.route(
      'GET',
      '/api/user-identity/:id/sessions',
      userSessionsRoute,
    ),
    HttpRouter.route(
      'DELETE',
      '/api/user-identity/:id/sessions',
      revokeUserSessionsRoute,
    ),
  ]),
  makeEntityRoutes(UserIdentity, {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
  }),
  makeEntityRoutes(EntityIdentifier, {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
  }),
);
