import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer } from 'effect';

/** How the management client reaches an instance. */
export interface ZitadelManagementConfig {
  readonly issuer: string;
  /**
   * Personal access token of the seed machine user. Zitadel mints it at first
   * init and `infra/local/ensure.sh` extracts it, so it is per-instance and
   * disposable rather than a configured constant.
   */
  readonly personalAccessToken: string;
}

/** A human user as this client cares about it. */
export interface ZitadelUser {
  readonly userId: string;
  readonly username: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly displayName?: string;
  readonly active: boolean;
}

/** What it takes to create one. */
export interface ZitadelHumanInput {
  readonly username: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly givenName: string;
  readonly familyName: string;
  readonly displayName?: string;
  /** Optional: a user created without one signs in through a social provider. */
  readonly password?: string;
  readonly passwordChangeRequired?: boolean;
}

export interface ZitadelManagement {
  findUserByEmail(
    email: string,
  ): Effect.Effect<ZitadelUser | null, EntifixConnError>;
  getUser(userId: string): Effect.Effect<ZitadelUser | null, EntifixConnError>;
  createHuman(
    input: ZitadelHumanInput,
  ): Effect.Effect<string, EntifixConnError>;
  updateProfile(
    userId: string,
    profile: {
      readonly givenName: string;
      readonly familyName: string;
      readonly displayName?: string;
    },
  ): Effect.Effect<void, EntifixConnError>;
  setActive(
    userId: string,
    active: boolean,
  ): Effect.Effect<void, EntifixConnError>;
  /** Compensating delete. Used when a provisioning half-write must be undone. */
  deleteUser(userId: string): Effect.Effect<void, EntifixConnError>;
}

export class ZitadelManagementTag extends Context.Tag('ZitadelManagementTag')<
  ZitadelManagementTag,
  ZitadelManagement
>() {}

interface V1UserRow {
  readonly id?: string;
  readonly userName?: string;
  readonly state?: string;
  readonly human?: {
    readonly profile?: { readonly displayName?: string };
    readonly email?: {
      readonly email?: string;
      readonly isEmailVerified?: boolean;
    };
  };
}

interface V2User {
  readonly userId?: string;
  readonly username?: string;
  readonly state?: string;
  readonly human?: {
    readonly profile?: { readonly displayName?: string };
    readonly email?: { readonly email?: string; readonly isVerified?: boolean };
  };
}

const ACTIVE = 'USER_STATE_ACTIVE';

/**
 * The slice of Zitadel's management API r10c drives.
 *
 * Only user lifecycle: everything about *credentials* — passwords, TOTP, linked
 * social accounts, recovery — is Zitadel's alone and has no method here on
 * purpose. r10c must not be able to read or set a credential, because the whole
 * point of the swap is that it no longer holds any.
 *
 * Endpoints are a deliberate mix of API versions, matching what Zitadel v4
 * actually offers: search is v1 (the v2 surface has no equivalent email query),
 * everything else is v2.
 */
export const makeZitadelManagement = (
  config: ZitadelManagementConfig,
): ZitadelManagement => {
  const base = config.issuer.replace(/\/$/, '');

  const call = <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Effect.Effect<T, EntifixConnError> =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${config.personalAccessToken}`,
            'content-type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        const payload = text === '' ? {} : (JSON.parse(text) as unknown);
        if (!response.ok) {
          const message =
            (payload as { message?: string }).message ??
            `${method} ${path} answered ${String(response.status)}`;
          throw new Error(message);
        }
        return payload as T;
      },
      catch: error =>
        new EntifixConnError(
          `zitadel management call failed (${method} ${path}): ${String(error)}`,
        ),
    });

  const findUserByEmail = (email: string) =>
    call<{ result?: readonly V1UserRow[] }>(
      'POST',
      '/management/v1/users/_search',
      {
        queries: [
          {
            emailQuery: {
              emailAddress: email,
              method: 'TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE',
            },
          },
        ],
      },
    ).pipe(
      Effect.map(payload => {
        const row = (payload.result ?? [])[0];
        if (row?.id === undefined) return null;
        return {
          userId: row.id,
          username: row.userName ?? '',
          email: row.human?.email?.email,
          emailVerified: row.human?.email?.isEmailVerified === true,
          displayName: row.human?.profile?.displayName,
          active: row.state === ACTIVE,
        } satisfies ZitadelUser;
      }),
    );

  const getUser = (userId: string) =>
    call<{ user?: V2User }>('GET', `/v2/users/${userId}`).pipe(
      Effect.map(payload => {
        const user = payload.user;
        if (user?.userId === undefined) return null;
        return {
          userId: user.userId,
          username: user.username ?? '',
          email: user.human?.email?.email,
          emailVerified: user.human?.email?.isVerified === true,
          displayName: user.human?.profile?.displayName,
          active: user.state === ACTIVE,
        } satisfies ZitadelUser;
      }),
      // A deleted or never-existing id is a `404`, which is an answer rather
      // than a failure: callers ask precisely because they do not know.
      Effect.catchAll(error =>
        /404|NotFound|doesn't exist/i.test(error.message)
          ? Effect.succeed(null)
          : Effect.fail(error),
      ),
    );

  const createHuman = (input: ZitadelHumanInput) =>
    call<{ userId?: string }>('POST', '/v2/users/human', {
      username: input.username,
      profile: {
        givenName: input.givenName,
        familyName: input.familyName,
        ...(input.displayName === undefined
          ? {}
          : { displayName: input.displayName }),
      },
      email: {
        email: input.email,
        isVerified: input.emailVerified === true,
      },
      ...(input.password === undefined
        ? {}
        : {
            password: {
              password: input.password,
              changeRequired: input.passwordChangeRequired === true,
            },
          }),
    }).pipe(
      Effect.flatMap(payload =>
        payload.userId === undefined
          ? Effect.fail(
              new EntifixConnError(
                'zitadel accepted the user but returned no id',
              ),
            )
          : Effect.succeed(payload.userId),
      ),
    );

  const updateProfile = (
    userId: string,
    profile: {
      readonly givenName: string;
      readonly familyName: string;
      readonly displayName?: string;
    },
  ) =>
    call<unknown>('PUT', `/v2/users/human/${userId}`, { profile }).pipe(
      Effect.asVoid,
    );

  const setActive = (userId: string, active: boolean) =>
    call<unknown>(
      'POST',
      `/v2/users/${userId}/${active ? 'reactivate' : 'deactivate'}`,
      {},
    ).pipe(Effect.asVoid);

  const deleteUser = (userId: string) =>
    call<unknown>('DELETE', `/v2/users/${userId}`).pipe(Effect.asVoid);

  return {
    findUserByEmail,
    getUser,
    createHuman,
    updateProfile,
    setActive,
    deleteUser,
  };
};

/** Binds {@link ZitadelManagementTag} from a resolved configuration. */
export const ZitadelManagementLayer = (
  config: ZitadelManagementConfig,
): Layer.Layer<ZitadelManagementTag> =>
  Layer.succeed(ZitadelManagementTag, makeZitadelManagement(config));
