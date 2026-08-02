import { randomUUID } from 'node:crypto';

import type { Notification, NotificationPort } from '@r10c/business-ts-authn';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** Where development notifications are recorded so a test can read them back. */
export const OUTBOX_COLLECTION = 'notification-outbox';

/** How many rows `/api/dev/outbox` returns, newest first. */
export const OUTBOX_PAGE_SIZE = 50;

/**
 * The development {@link NotificationPort}: log it, and record it.
 *
 * The log line is for a developer watching the terminal. The outbox row is what
 * makes the flows testable — Playwright cannot read stdout, so without a
 * readable record the password-reset journey (the module's most
 * security-sensitive path) would have no end-to-end coverage at all.
 *
 * A real transport replaces this one layer; nothing above it changes.
 */
export const makeDevNotificationPort = (db: Db): NotificationPort => {
  const outbox = db.collection(OUTBOX_COLLECTION);

  return {
    send: (notification: Notification) =>
      Effect.gen(function* () {
        yield* Effect.logInfo('notification sent').pipe(
          Effect.annotateLogs({
            'notification.kind': notification.kind,
            'notification.to': notification.to,
            'notification.userId': String(notification.userId),
            // The data carries reset links, so it is annotated for a developer
            // reading their own terminal and never returned over HTTP.
            'notification.data': JSON.stringify(notification.data ?? {}),
          }),
        );

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
          catch: error =>
            new EntifixConnError('Failed to record notification', error),
        });
      }),
  };
};

/** Read the most recent notifications, newest first. */
export const readOutbox = (db: Db, to?: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .collection(OUTBOX_COLLECTION)
        .find(to === undefined ? {} : { to }, { projection: { _id: 0 } })
        .toArray(),
    catch: error => new EntifixConnError('Failed to read outbox', error),
  }).pipe(
    Effect.map(docs =>
      [...docs]
        .sort((left, right) =>
          String(right['sentAt']).localeCompare(String(left['sentAt'])),
        )
        .slice(0, OUTBOX_PAGE_SIZE),
    ),
  );
