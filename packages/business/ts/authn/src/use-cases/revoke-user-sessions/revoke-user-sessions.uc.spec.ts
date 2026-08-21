import { SessionStoreTag } from '@r10c/entifix-ts-business';
import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AccountRepositoryTag,
  type Notification,
  NotificationPortTag,
} from '../../repository/index.js';
import {
  RevokeUserSessionsInputTag,
  RevokeUserSessionsUC,
} from './revoke-user-sessions.uc.js';

const unused = (name: string) =>
  Effect.fail(new EntifixLogicError(`${name} not used in revoke`));

const stubAccounts = (contact: string | null) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(null),
    findById: () => Effect.succeed(null),
    findContactAddress: () => Effect.succeed(contact),
    linkExternalSubject: () => Effect.void,
    projectIdentity: () => Effect.void,
    createAccount: () => unused('createAccount'),
    updateUserAspects: () => unused('updateUserAspects'),
  });

const stubSessions = (
  onRevoke: (userId: unknown) => void,
  outcome: Effect.Effect<void, EntifixLogicError> = Effect.void,
) =>
  SessionStoreTag.of({
    create: () => unused('create'),
    read: () => unused('read'),
    touch: () => unused('touch'),
    listForUser: () => unused('listForUser'),
    revoke: () => unused('revoke'),
    revokeAllForUserExcept: () => unused('revokeAllForUserExcept'),
    revokeAllForUser: userId => {
      onRevoke(userId);
      return outcome;
    },
  });

const stubNotifications = (
  onSend: (notification: Notification) => void,
  outcome: Effect.Effect<void, EntifixLogicError> = Effect.void,
) =>
  NotificationPortTag.of({
    send: notification => {
      onSend(notification);
      return outcome;
    },
  });

const runRevoke = (
  sessions: ReturnType<typeof stubSessions>,
  accounts: ReturnType<typeof stubAccounts>,
  notifications: ReturnType<typeof stubNotifications>,
  userId = 'target-1',
) =>
  Effect.runPromiseExit(
    RevokeUserSessionsUC.run().pipe(
      Effect.provideService(SessionStoreTag, sessions),
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(NotificationPortTag, notifications),
      Effect.provideService(RevokeUserSessionsInputTag, { userId }),
    ),
  );

describe('RevokeUserSessionsUC', () => {
  it('revokes every session and tells the owner', async () => {
    let revoked: unknown;
    let sent: Notification | undefined;

    const exit = await runRevoke(
      stubSessions(userId => {
        revoked = userId;
      }),
      stubAccounts('owner@example.com'),
      stubNotifications(notification => {
        sent = notification;
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(revoked).toBe('target-1');
    expect(sent).toEqual({
      kind: 'sessions-revoked',
      userId: 'target-1',
      to: 'owner@example.com',
    });
  });

  it('still revokes when the account has nowhere to be told', async () => {
    let revoked = false;
    let notified = false;

    const exit = await runRevoke(
      stubSessions(() => {
        revoked = true;
      }),
      stubAccounts(null),
      stubNotifications(() => {
        notified = true;
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(revoked).toBe(true);
    expect(notified).toBe(false);
  });

  it('does not let a failed notification undo the revocation', async () => {
    let revoked = false;

    const exit = await runRevoke(
      stubSessions(() => {
        revoked = true;
      }),
      stubAccounts('owner@example.com'),
      stubNotifications(
        () => undefined,
        Effect.fail(new EntifixLogicError('smtp down')),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(revoked).toBe(true);
  });

  it('fails when the session store does', async () => {
    const exit = await runRevoke(
      stubSessions(
        () => undefined,
        Effect.fail(new EntifixLogicError('redis down')),
      ),
      stubAccounts('owner@example.com'),
      stubNotifications(() => undefined),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
