import { randomUUID } from 'node:crypto';

import {
  type RememberedDevice,
  UserDevice,
  type UserDeviceRepository,
} from '@r10c/business-ts-authn';
import type { DeviceContext } from '@r10c/entifix-ts-business';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
  EntifixConnError,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

export const DEVICE_COLLECTION = 'user-device';

/** Projection dropping Mongo's internal `_id`, matching the entity adapters. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

/**
 * `lastSeenAt` as a number, whatever shape it came back in.
 *
 * Deserialization passes accessor values straight through rather than coercing
 * them, so a `date` member holds whatever the document held. Rows this adapter
 * wrote carry real `Date`s, but a row written by anything else (a seed, an
 * import, an older build) may carry an ISO string — and calling `getTime()` on
 * that is a defect, not a failure, so it escapes the route's error handling and
 * answers an empty 500.
 */
const seenAtMillis = (device: UserDevice): number => {
  const value = device.lastSeenAt as Date | string | undefined;
  if (value === undefined) return 0;
  return value instanceof Date ? value.getTime() : Date.parse(String(value));
};

/**
 * MongoDB-backed {@link UserDeviceRepository}.
 *
 * Durable rather than derived from live sessions: Redis sessions expire, so a
 * laptop left alone for a week would come back looking brand new and fire a
 * "new device" alert at its rightful owner. Alerts that cry wolf get ignored,
 * and this one is the only warning a user gets that their password leaked.
 */
export const makeMongoUserDeviceRepository = (db: Db): UserDeviceRepository => {
  const devices = db.collection(DEVICE_COLLECTION);

  const fail = (message: string, error: unknown) =>
    new EntifixConnError(message, error);

  const remember = (userId: EntityId, device: DeviceContext) =>
    Effect.gen(function* () {
      const existing = yield* Effect.tryPromise({
        try: () =>
          devices.findOne(
            { userId, deviceId: device.deviceId },
            WITHOUT_MONGO_ID,
          ),
        catch: error => fail('Failed to read device from MongoDB', error),
      });

      const now = new Date();
      const doc = {
        id: existing?.['id'] ?? randomUUID(),
        userId,
        deviceId: device.deviceId,
        browser: device.browser,
        os: device.os,
        type: device.type,
        lastIp: device.ip,
        // Real `Date`s, not ISO strings: Mongo stores them as BSON dates, and
        // the entity declares them as dates. Writing strings made `lastSeenAt`
        // come back as a string, since deserialization passes values through.
        firstSeenAt: existing?.['firstSeenAt'] ?? now,
        lastSeenAt: now,
      };

      if (existing === null) {
        // `insertMany` even for one doc: the only insert form the shared Mongo
        // fake implements, so this adapter also runs in the hermetic e2e.
        yield* Effect.tryPromise({
          try: () => devices.insertMany([{ ...doc }]),
          catch: error => fail('Failed to insert device into MongoDB', error),
        });
      } else {
        yield* Effect.tryPromise({
          try: () =>
            devices.updateOne(
              { userId, deviceId: device.deviceId },
              { $set: { lastSeenAt: doc.lastSeenAt, lastIp: doc.lastIp } },
            ),
          catch: error => fail('Failed to update device in MongoDB', error),
        });
      }

      const entity = yield* deserializeSingleEntity(UserDevice, doc);
      return {
        device: entity as UserDevice,
        isNew: existing === null,
      } satisfies RememberedDevice;
    });

  const listForUser = (userId: EntityId) =>
    Effect.gen(function* () {
      const docs = yield* Effect.tryPromise({
        try: () => devices.find({ userId }, WITHOUT_MONGO_ID).toArray(),
        catch: error => fail('Failed to list devices from MongoDB', error),
      });
      // Same widening the shared Mongo repository does after a collection
      // deserialize (`make-mongo-repository.ts`).
      const entities = (yield* deserializeEntityCollection(
        UserDevice,
        docs,
      )) as unknown as UserDevice[];
      // Most recently seen first: the device you are reading this on should be
      // at the top of the list.
      return [...entities].sort(
        (left, right) => seenAtMillis(right) - seenAtMillis(left),
      );
    });

  return { remember, listForUser };
};
