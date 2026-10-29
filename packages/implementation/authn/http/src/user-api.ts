import { permissionForEntity } from '@entifix/authz';
import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  RequestPrincipalTag,
  SessionStoreTag,
  verbEndpoint,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  entityKey,
  implement,
  JsonBody,
  NotFound,
  serializeEntity,
} from '@entifix/core';
import {
  AccountRepositoryTag,
  EmailRequired,
  EntityIdentifier,
  IdentifierInUse,
  IdentifierRequired,
  type IdentifierType,
  ProviderDirectoryTag,
  ProviderUnavailable,
  provisionProviderHuman,
  RegisterInputTag,
  registerUserUCFactory,
  RevokeUserSessionsInputTag,
  RevokeUserSessionsUC,
  RoleNotAllowed,
  SignOutOtherSessionsInputTag,
  SignOutOtherSessionsUC,
  UnknownRole,
  UnknownStatus,
  UpdateUserAspectsInputTag,
  UpdateUserAspectsUC,
  UserDevice,
  UserIdentity,
  UserStatus,
} from '@r10c/business-ts-authn';
import { isRole, type Role } from '@r10c/business-ts-authz-grants';
import { Effect, Schema } from 'effect';

import { asString, bodyOf } from './request-body.js';
import { listSessions } from './session-api.js';

/** The caller a session-guarded verb runs for; the guard always provides one. */
const principalOf = (context: EntityApiContext) =>
  context.principal as NonNullable<EntityApiContext['principal']>;

/** A requested role, refused when it is not one of the ladder's. */
const roleOf = (value: unknown) =>
  value === undefined
    ? Effect.succeed(undefined)
    : isRole(value)
      ? Effect.succeed(value as Role)
      : Effect.fail(new UnknownRole());

/**
 * `POST /api/user-identity` — administrative account creation, through the
 * SAME use case a first sign-in runs: a generic write would skip identifier
 * uniqueness and the tier rule. The actor comes from the verified principal.
 *
 * Two systems, in a fixed order and without a saga: the local record first,
 * because it owns the role and the party the provider never sees, then the
 * provider's human. If the second half fails the account stands with no
 * external subject — it cannot sign in, and submitting the same form again
 * repairs it (ADR 0016). No password is read, and none may be supplied.
 */
const createUser = (request: EntityApiRequest, context: EntityApiContext) =>
  Effect.gen(function* () {
    const body = bodyOf(request.payload);
    const identifiers = (
      Array.isArray(body['identifiers']) ? body['identifiers'] : []
    )
      .map(entry => bodyOf(entry))
      .map(entry => ({
        type: asString(entry['type']) as IdentifierType | undefined,
        value: asString(entry['value']),
      }))
      .filter(
        (entry): entry is { type: IdentifierType; value: string } =>
          entry.type !== undefined && entry.value !== undefined,
      );
    if (identifiers.length === 0) return yield* new IdentifierRequired();
    const role = yield* roleOf(body['role']);
    const email = identifiers.find(entry => entry.type === 'email')?.value;
    if (email === undefined) return yield* new EmailRequired();
    const displayName = asString(body['displayName']);

    const subject = yield* registerUserUCFactory().pipe(
      Effect.provideService(RegisterInputTag, {
        displayName,
        identifiers,
        role,
        actorRoles: principalOf(context).roles,
      }),
    );
    yield* provisionProviderHuman(
      yield* AccountRepositoryTag,
      yield* ProviderDirectoryTag,
      {
        userId: subject.userId,
        email,
        username: identifiers.find(entry => entry.type === 'username')?.value,
        displayName,
      },
    );
    return subject;
  });

/**
 * Change a user's role or status, then revoke their sessions: grants derive
 * from the `roles` claim, so without the revocation a demoted user keeps
 * their old access until the token expires.
 */
const updateAspects = verbEndpoint(UpdateUserAspectsUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const userId = request.params?.id as string;
      const body = bodyOf(request.payload);
      const role = yield* roleOf(body['role']);
      const rawStatus = asString(body['status']);
      const status = Object.values(UserStatus).includes(rawStatus as UserStatus)
        ? (rawStatus as UserStatus)
        : undefined;
      if (rawStatus !== undefined && status === undefined) {
        return yield* new UnknownStatus();
      }
      const principal = principalOf(context);
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
      return serializeEntity(UserIdentity, updated);
    }),
});

/**
 * Sign a user out everywhere. Guarded by the verb the use case declares, not
 * by `user-device:write`: that grant describes the record, this one the act.
 * Telling the owner is the use case's job, and stays best-effort.
 */
const revokeSessions = verbEndpoint(RevokeUserSessionsUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest) =>
    RevokeUserSessionsUC.run().pipe(
      Effect.provideService(RevokeUserSessionsInputTag, {
        userId: request.params?.id as string,
      }),
      Effect.as({ ok: true }),
    ),
});

/**
 * Keep this session, end the rest. Guarded by the verb so the grant is real
 * authorization rather than decoration.
 *
 * ⚠️ Every role holds `sign-out-others`, because ending your own sessions is
 * a control the account owner must always have.
 */
const signOutOthers = verbEndpoint(SignOutOtherSessionsUC, {
  guard: { kind: 'permission' },
  handler: (_request: EntityApiRequest, context: EntityApiContext) =>
    SignOutOtherSessionsUC.run().pipe(
      Effect.provideService(SignOutOtherSessionsInputTag, {
        userId: principalOf(context).userId,
        keepSessionId: principalOf(context).sessionId,
      }),
      Effect.as({ ok: true }),
    ),
});

/**
 * Administering other people's accounts, every endpoint permission-gated:
 * this is the authorization boundary, and a hidden menu entry protects
 * nothing.
 */
export const userIdentityApi = defineEntityApi(
  UserIdentity,
  entityKey(UserIdentity, 'user-identity'),
  {
    verbs: ['list', 'get', 'create'],
    guard: { kind: 'permission' },
    override: {
      create: {
        payload: JsonBody,
        errors: [
          IdentifierRequired,
          EmailRequired,
          UnknownRole,
          RoleNotAllowed,
          IdentifierInUse,
          ProviderUnavailable,
          DuplicateKey,
        ],
        handler: createUser,
      },
    },
    useCases: [updateAspects, revokeSessions, signOutOthers],
  },
);

export const entityIdentifierApi = defineEntityApi(
  EntityIdentifier,
  entityKey(EntityIdentifier, 'entity-identifier'),
  { verbs: ['list', 'get'], guard: { kind: 'permission' } },
);

/**
 * `GET /api/user-identity/:id/sessions` — an administrator's view of where a
 * user is signed in, for incident response. Another user's device history is
 * not public just because the caller happens to be staff.
 */
const userSessions = defineEndpoint({
  name: 'user-sessions',
  method: 'GET',
  path: '/api/user-identity/:id/sessions',
  params: { id: Schema.String },
  success: Schema.Struct({ items: JsonBody }),
  errors: [DuplicateKey, NotFound],
  guard: {
    kind: 'permission',
    permission: permissionForEntity(UserDevice, 'read'),
  },
});

export const userSessionEndpoints = [
  implement(userSessions, ({ params }) =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      return { items: yield* listSessions(params.id, principal.sessionId) };
    }),
  ),
] as const;
