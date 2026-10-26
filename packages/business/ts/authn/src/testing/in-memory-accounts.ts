import type { DeviceContext } from '@entifix/business';
import type { EntityId } from '@entifix/core';
import { Effect } from 'effect';

import { IdentifierType } from '../entities/entity-identifier';
import { UserDevice } from '../entities/user-device';
import { UserIdentity, UserStatus } from '../entities/user-identity';
import { AuthnError } from '../errors';
import type { AccountRepository } from '../repository/account.repository';
import type { MailboxNotice } from '../repository/identity-provider-ports';
import type { UserDeviceRepository } from '../repository/user-device.repository';
import type { NotificationSubject } from './notification-port.contract';

interface Identifier {
  readonly userId: EntityId;
  readonly type: string;
  value: string;
}

/**
 * An {@link AccountRepository} held in memory, for the specs of whatever
 * consumes the port. It runs `describeAccountRepositoryContract`.
 */
export const makeInMemoryAccountRepository = (): AccountRepository => {
  const users = new Map<string, UserIdentity>();
  const identifiers: Identifier[] = [];

  const copy = (user: UserIdentity | undefined) =>
    user === undefined
      ? null
      : Object.assign(new UserIdentity(), {
          id: user.id,
          displayName: user.displayName,
          status: user.status,
          role: user.role,
        });
  const identifierOf = (userId: EntityId, type: string) =>
    identifiers.find(one => one.userId === userId && one.type === type);
  const setIdentifier = (userId: EntityId, type: string, value: string) => {
    const current = identifierOf(userId, type);
    if (current === undefined) identifiers.push({ userId, type, value });
    else current.value = value;
  };

  return {
    findByIdentifier: value =>
      Effect.sync(() => {
        const found = identifiers.find(one => one.value === value);
        return found === undefined
          ? null
          : copy(users.get(String(found.userId)));
      }),
    findById: userId => Effect.sync(() => copy(users.get(String(userId)))),
    updateUserAspects: (userId, changes) =>
      Effect.suspend(() => {
        const user = users.get(String(userId));
        if (user === undefined) {
          return Effect.fail(
            new AuthnError('user not found', undefined, { userId }),
          );
        }
        if (changes.role !== undefined) user.role = changes.role;
        if (changes.status !== undefined) user.status = changes.status;
        return Effect.succeed(copy(user) as UserIdentity);
      }),
    findContactAddress: userId =>
      Effect.sync(
        () => identifierOf(userId, IdentifierType.Email)?.value ?? null,
      ),
    createAccount: input =>
      Effect.suspend(() => {
        const taken = input.identifiers.find(wanted =>
          identifiers.some(one => one.value === wanted.value),
        );
        if (taken !== undefined) {
          return Effect.fail(
            new AuthnError('identifier already in use', undefined, {
              value: taken.value,
            }),
          );
        }
        const user = Object.assign(new UserIdentity(), {
          id: globalThis.crypto.randomUUID(),
          displayName: input.displayName,
          status: UserStatus.Active,
          role: input.role,
        });
        users.set(String(user.id), user);
        for (const { type, value } of input.identifiers) {
          identifiers.push({ userId: user.id, type, value });
        }
        return Effect.succeed(copy(user) as UserIdentity);
      }),
    linkExternalSubject: (userId, subject) =>
      Effect.sync(() =>
        setIdentifier(userId, IdentifierType.ExternalSubject, subject),
      ),
    projectIdentity: (userId, projection) =>
      Effect.sync(() => {
        const user = users.get(String(userId));
        if (user !== undefined && projection.displayName !== undefined) {
          user.displayName = projection.displayName;
        }
        if (projection.email !== undefined) {
          setIdentifier(userId, IdentifierType.Email, projection.email);
        }
      }),
  };
};

/**
 * A {@link UserDeviceRepository} held in memory, for the specs of whatever
 * consumes the port. It runs `describeUserDeviceRepositoryContract`.
 */
export const makeInMemoryUserDeviceRepository = (): UserDeviceRepository => {
  const devices = new Map<string, UserDevice>();

  return {
    remember: (userId, context: DeviceContext) =>
      Effect.sync(() => {
        const key = `${String(userId)}:${context.deviceId}`;
        const known = devices.get(key);
        const now = new Date();
        const device = Object.assign(new UserDevice(), {
          id: known?.id ?? globalThis.crypto.randomUUID(),
          userId,
          deviceId: context.deviceId,
          browser: context.browser,
          os: context.os,
          type: context.type,
          lastIp: context.ip,
          firstSeenAt: known?.firstSeenAt ?? now,
          lastSeenAt: now,
        });
        devices.set(key, device);
        return { device, isNew: known === undefined };
      }),
    listForUser: userId =>
      Effect.sync(() =>
        Array.from(devices.values())
          .filter(device => device.userId === userId)
          .sort(
            (left, right) =>
              Number(right.lastSeenAt) - Number(left.lastSeenAt),
          ),
      ),
  };
};

/**
 * A notification port that keeps what it delivers, with the mailbox that
 * reads it back, for the specs of whatever sends a notice. It runs
 * `describeNotificationPortContract`.
 */
export const makeInMemoryNotificationPort = (): NotificationSubject => {
  const delivered: MailboxNotice[] = [];
  return {
    port: {
      send: notification =>
        Effect.sync(() => {
          delivered.unshift({
            kind: notification.kind,
            to: notification.to,
            userId: String(notification.userId),
            data: notification.data ?? {},
            sentAt: new Date().toISOString(),
          });
        }),
    },
    mailbox: {
      read: to =>
        Effect.sync(() =>
          delivered.filter(notice => to === undefined || notice.to === to),
        ),
    },
  };
};
