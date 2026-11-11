import { permissionForEntity } from '@entifix/authz';
import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  RequestPrincipalTag,
  SessionStoreTag,
  TokenServiceTag,
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
  AccessTokenLifetimeTag,
  AccountRepositoryTag,
  EmailRequired,
  EntityIdentifier,
  IdentifierInUse,
  IdentifierRequired,
  type IdentifierType,
  type Principal,
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
  SignOutSessionInputTag,
  SignOutSessionUC,
  SwitchOrganizationInputTag,
  SwitchOrganizationUC,
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
 * End one of your own sessions — `POST /api/user-device/:id/sign-out-session`,
 * where the id is the **session's**. A device can hold several sessions, and
 * the verb sits on `UserDevice` only because that is the cell that renders it
 * on a row (see the use case). Guarded by the verb, held by every role.
 */
const signOutSession = verbEndpoint(SignOutSessionUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    SignOutSessionUC.run().pipe(
      Effect.provideService(SignOutSessionInputTag, {
        userId: principalOf(context).userId,
        sessionId: request.params?.id as string,
        currentSessionId: principalOf(context).sessionId,
      }),
      Effect.map(({ signedOut }) => ({ ok: true, signedOut })),
    ),
});

/**
 * A device's endpoints are its verbs alone: nothing lists or edits a
 * `UserDevice` through this group, and the caller's own devices are read
 * through `GET /api/auth/devices`. Serving the group is what serves its
 * `$metadata`, which is where the sessions screen reads the verb from.
 */
export const userDeviceApi = defineEntityApi(
  UserDevice,
  entityKey(UserDevice, 'user-device'),
  {
    verbs: [],
    guard: { kind: 'permission' },
    useCases: [signOutSession],
  },
);

/**
 * Move the caller's session to another of their organizations —
 * `POST /api/user-identity/switch-organization`. The answer is the sign-in's
 * own shape, a new session and its token, because that is what it is: the
 * Next app sets the cookies from it exactly as it does after a callback.
 */
const switchOrganization = verbEndpoint(SwitchOrganizationUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const principal = principalOf(context);
      const record = yield* SwitchOrganizationUC.run().pipe(
        Effect.provideService(SwitchOrganizationInputTag, {
          userId: principal.userId,
          sessionId: principal.sessionId,
          organizationId:
            asString(bodyOf(request.payload)['organizationId']) ?? '',
        }),
      );
      const tokens = yield* TokenServiceTag;
      const lifetime = yield* AccessTokenLifetimeTag;
      const accessToken = yield* tokens
        .sign(
          {
            userId: record.userId,
            subject: record.subject,
            sessionId: record.sessionId,
            roles: record.roles,
            activeOrganizationId: record.activeOrganizationId,
            partyRole: record.partyRole,
            partyId: record.partyId,
            entitlements: record.entitlements,
          },
          lifetime.seconds,
        )
        .pipe(Effect.orDie);
      return {
        accessToken,
        sessionId: record.sessionId,
        expiresIn: lifetime.seconds,
        sessionExpiresIn: Math.max(
          0,
          Math.floor(
            (Date.parse(record.absoluteExpiresAt) - Date.now()) / 1000,
          ),
        ),
        principal: {
          userId: record.userId,
          subject: record.subject,
          sessionId: record.sessionId,
          roles: record.roles,
          organizationId: record.activeOrganizationId,
          partyRole: record.partyRole,
          partyId: record.partyId,
          attributes: record.attributes,
        } satisfies Principal,
      };
    }),
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
    useCases: [
      updateAspects,
      revokeSessions,
      signOutOthers,
      switchOrganization,
    ],
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
