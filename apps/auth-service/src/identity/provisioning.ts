import {
  type AccountRepository,
  AccountRepositoryTag,
  AuthnError,
  type AuthSubject,
  authSubjectFromUser,
  IdentifierType,
  type NewIdentifierInput,
  RegisterInputTag,
  registerUserUCFactory,
  UnauthenticatedError,
  UserStatus,
} from '@r10c/business-ts-authn';
import type { EntityId } from '@r10c/entifix-ts-core';
import type {
  ZitadelIdentity,
  ZitadelManagement,
} from '@r10c/entifix-ts-zitadel-client';
import { Effect } from 'effect';

/** Stamped on identifier rows this provider owns, so their origin is readable. */
export const PROVIDER = 'zitadel';

/**
 * Turn a verified sign-in into the subject a session is opened for.
 *
 * Three steps, in this order and no other:
 *
 * 1. Resolve the `sub` to a canonical user, provisioning one on first sight.
 * 2. Refuse anyone who is not `active`, before a session can exist.
 * 3. Project the provider's identity attributes onto the local record.
 *
 * The projection runs on **every** sign-in rather than only at provisioning.
 * That is what makes the local email and display name a mirror instead of a
 * second source of truth: a change made in Zitadel lands here the next time the
 * user appears, and nothing else ever writes those members.
 */
export const resolveSignIn = (
  accounts: AccountRepository,
  identity: ZitadelIdentity,
): Effect.Effect<AuthSubject, AuthnError | UnauthenticatedError> =>
  Effect.gen(function* () {
    const existing = yield* accounts.findByIdentifier(identity.subject);
    const user = existing ?? (yield* provisionFromIdentity(accounts, identity));

    // Checked here, not in the token verifier: Zitadel proved *who* this is,
    // and whether they may still hold a session is r10c's question. A suspended
    // user with a perfectly valid `id_token` gets nothing.
    if (user.status !== UserStatus.Active) {
      return yield* Effect.fail(
        new UnauthenticatedError(
          'the account is not active',
          'accountInactive',
        ),
      );
    }

    // The email is projected **only when the provider says it is verified**.
    // Without that gate, anyone could set an unverified address in Zitadel and
    // have it written onto their local identifier row — which would not let them
    // sign in as the victim (the `sub` is what resolves an account), but would
    // collide with the victim's identifier and send that person's device alerts
    // to the attacker. It is the same rule `EntityIdentifier.verified` states
    // and the same rule provisioning follows on first sight.
    yield* accounts.projectIdentity(user.id, {
      displayName: identity.displayName,
      email: identity.emailVerified ? identity.email : undefined,
      emailVerified: identity.emailVerified,
      username: identity.preferredUsername,
    });

    // Re-read so the subject carries the just-projected attributes rather than
    // the values this sign-in has already superseded.
    const refreshed = yield* accounts.findById(user.id);
    return authSubjectFromUser(refreshed ?? user);
  }).pipe(
    Effect.catchAll(error =>
      error instanceof UnauthenticatedError
        ? Effect.fail(error)
        : Effect.fail(
            new AuthnError(
              `sign-in could not be resolved: ${String(error)}`,
              'signInFailed',
              error,
            ),
          ),
    ),
  );

/**
 * First sight of a subject: create the local record it will key against.
 *
 * A self-registration always lands on the default role — `registerUserUCFactory`
 * enforces that, and going through it rather than writing the account directly
 * is what keeps identifier uniqueness and the tier rule in one place.
 *
 * The email is recorded only when Zitadel says it is verified. An unverified
 * address attached at provisioning would let someone claim an address they do
 * not control and have every later sign-in match on it.
 */
const provisionFromIdentity = (
  accounts: AccountRepository,
  identity: ZitadelIdentity,
) =>
  Effect.gen(function* () {
    const identifiers: NewIdentifierInput[] = [
      {
        type: IdentifierType.ExternalSubject,
        value: identity.subject,
        verified: true,
        provider: PROVIDER,
      },
    ];
    if (identity.email !== undefined && identity.emailVerified) {
      identifiers.push({
        type: IdentifierType.Email,
        value: identity.email,
        verified: true,
      });
    }

    const subject = yield* registerUserUCFactory().pipe(
      Effect.provideService(RegisterInputTag, {
        displayName: identity.displayName ?? identity.preferredUsername,
        identifiers,
      }),
      Effect.provideService(AccountRepositoryTag, accounts),
    );

    const user = yield* accounts.findById(subject.userId);
    if (user === null) {
      return yield* Effect.fail(
        new AuthnError('the provisioned account could not be read back'),
      );
    }
    return user;
  });

/**
 * Ensure a Zitadel human exists for an already-created local account, then join
 * the two.
 *
 * This is the administrative and seeding path, and it is deliberately **not** a
 * saga. The local record is written first because it owns the role and the
 * party; if the provider write fails, what is left is an account with no
 * external subject — it cannot sign in, it is visible in the users list, and
 * running this again repairs it. One legible half-state beats a compensation
 * that can itself fail.
 *
 * Idempotent by lookup rather than by flag: an existing human with this address
 * is adopted instead of rejected, which is what makes a retry a repair.
 */
export const provisionZitadelHuman = (
  accounts: AccountRepository,
  zitadel: ZitadelManagement,
  input: {
    readonly userId: EntityId;
    readonly email: string;
    readonly username?: string;
    readonly displayName?: string;
    readonly password?: string;
  },
): Effect.Effect<string, AuthnError> =>
  Effect.gen(function* () {
    const existing = yield* zitadel.findUserByEmail(input.email);
    const { givenName, familyName } = splitName(
      input.displayName ?? input.email,
    );

    const zitadelUserId =
      existing?.userId ??
      (yield* zitadel.createHuman({
        username: input.username ?? input.email,
        email: input.email,
        // Dev-seeded and administratively created users start verified: the
        // address came from an operator, not from whoever is signing up.
        emailVerified: true,
        givenName,
        familyName,
        displayName: input.displayName,
        password: input.password,
        passwordChangeRequired: false,
      }));

    yield* accounts.linkExternalSubject(input.userId, zitadelUserId, PROVIDER);
    return zitadelUserId;
  }).pipe(
    Effect.catchAll(error =>
      Effect.fail(
        new AuthnError(
          `the identity provider could not be provisioned: ${String(error)}`,
          'providerUnavailable',
          error,
        ),
      ),
    ),
  );

/**
 * Zitadel requires a given and a family name; r10c only holds a display name.
 * Splitting on the last space is a guess, and it is a safe one because nothing
 * reads these two back — the display name is projected whole.
 */
const splitName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return { givenName: displayName, familyName: '·' };
  return {
    givenName: parts.slice(0, -1).join(' '),
    familyName: parts[parts.length - 1] as string,
  };
};
