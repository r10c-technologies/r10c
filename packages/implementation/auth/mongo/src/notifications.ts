import { randomUUID } from 'node:crypto';

import { Unavailable } from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  type DevMailbox,
  DevMailboxTag,
  type MailboxNotice,
  type Notification,
  type NotificationPort,
} from '@r10c/business-ts-authn';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/** Where development notifications are recorded so a test can read them back. */
export const OUTBOX_COLLECTION = 'notification-outbox';

/** How many rows `/api/dev/outbox` returns, newest first. */
export const OUTBOX_PAGE_SIZE = 50;

/**
 * The development {@link NotificationPort}: record it.
 *
 * The outbox row is what makes the flows testable — Playwright cannot read
 * stdout, so without a readable record the password-reset journey (the
 * module's most security-sensitive path) would have no end-to-end coverage at
 * all. It is also where a developer reads a reset link: a cell does not log
 * (ADR 0064).
 *
 * A real transport replaces this one layer; nothing above it changes.
 */
export const makeDevNotificationPort = (db: Db): NotificationPort => {
  const outbox = db.collection(OUTBOX_COLLECTION);

  return {
    send: (notification: Notification) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            outbox.insertMany([
              {
                id: randomUUID(),
                kind: notification.kind,
                to: notification.to,
                userId: String(notification.userId),
                data: notification.data ?? {},
                sentAt: new Date().toISOString(),
              },
            ]),
          catch: () => new Unavailable({ dependency: 'mongo' }),
        });
      }),
  };
};

/**
 * The {@link DevMailbox} over this port's outbox: one address's notices or
 * everyone's, newest first, one page at most.
 */
export const makeDevMailbox = (db: Db): DevMailbox => ({
  read: to =>
    Effect.tryPromise({
      try: () =>
        db
          .collection(OUTBOX_COLLECTION)
          .find(to === undefined ? {} : { to }, { projection: { _id: 0 } })
          .toArray(),
      catch: () => new Unavailable({ dependency: 'mongo' }),
    }).pipe(
      Effect.map(docs =>
        [...docs]
          .sort((left, right) =>
            String(right['sentAt']).localeCompare(String(left['sentAt'])),
          )
          .slice(0, OUTBOX_PAGE_SIZE)
          .map((doc): MailboxNotice => ({
            kind: String(doc['kind']),
            to: String(doc['to']),
            userId: String(doc['userId']),
            data: (doc['data'] ?? {}) as Record<string, string>,
            sentAt: String(doc['sentAt']),
          })),
      ),
    ),
});

/** Binds {@link DevMailboxTag} over the service's database. */
export const DevMailboxLayer = Layer.effect(
  DevMailboxTag,
  Effect.map(MongoDatabaseTag, db => makeDevMailbox(db as Db)),
);
