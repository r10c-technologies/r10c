import {
  EntifixConnError,
  envelopeEntityName,
  serializeEntity,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  PublishedVendor,
  PublishedVendorsTag,
} from '@r10c/business-ts-marketplace-vendor';
import type { OrganizationAnnouncement } from '@r10c/business-ts-party-contracts';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

export const VENDOR_COLLECTION = envelopeEntityName(PublishedVendor);

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;

/**
 * One record per vendor. The unique index is what turns a stale upsert into
 * a duplicate-key error rather than a second record: the filter misses the
 * newer document, the upsert tries to insert, and the index refuses.
 */
export const ensureVendorIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection(VENDOR_COLLECTION)
        .createIndex({ vendorId: 1 }, { unique: true });
    },
    catch: error =>
      new EntifixConnError('Failed to index the published vendors', error),
  });

/**
 * The vendor projection's write: **one conditional upsert**, ordered on
 * `announcedAt` in the filter itself, so two concurrent handlers cannot
 * interleave the way a read-then-write guard lets the slower one win
 * (ADR 0061). `$set` of the whole serialized record is a replacement: every
 * member is always present, so no stale key survives it.
 */
const applyAnnouncement = (db: Db, announcement: OrganizationAnnouncement) =>
  Effect.tryPromise({
    try: async () => {
      const at = new Date(announcement.announcedAt);
      const vendor = new PublishedVendor(
        announcement.organizationId,
        announcement.displayName,
      );
      vendor.id = announcement.organizationId;
      vendor.announcedAt = at;
      try {
        await db.collection(VENDOR_COLLECTION).updateOne(
          {
            vendorId: announcement.organizationId,
            announcedAt: { $lte: at },
          },
          { $set: serializeEntity(PublishedVendor, vendor) },
          { upsert: true },
        );
        return 'applied' as const;
      } catch (error) {
        if (isDuplicateKey(error)) return 'stale' as const;
        throw error;
      }
    },
    catch: error =>
      new EntifixConnError('Failed to write the published vendor', error, {
        vendorId: announcement.organizationId,
      }),
  });

export const MongoPublishedVendorsLayer = Layer.effect(
  PublishedVendorsTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    yield* ensureVendorIndexes(db);
    return {
      apply: announcement => applyAnnouncement(db, announcement),
    };
  }),
);
