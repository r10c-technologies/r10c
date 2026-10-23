import {
  EntifixConnError,
  type EntifixError,
  envelopeEntityName,
  serializeEntity,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  type OrganizationAnnouncement,
  readOrganizationAnnouncement,
} from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** The slice this queue belongs to: the projection's single writer. */
const SUBSCRIBING_SLICE = 'marketplace';

/** Where the projection lives, taken from the entity so the read routes agree. */
export const VENDOR_COLLECTION = envelopeEntityName(PublishedVendor);

/**
 * `organization.*` on a `work` queue owned by this slice. One replica of the
 * projector handles each announcement; a payload that cannot be read is poison
 * and quarantined at once (ADR 0030).
 */
export const vendorSubscription: Subscription = {
  slice: SUBSCRIBING_SLICE,
  pattern: 'organization.*',
  mode: 'work',
  maxAttempts: 5,
};

/** The driver's duplicate-key code: a unique index refused an insert. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;

/**
 * The unique index the ordering guard relies on. Without it, the conditional
 * upsert below inserts a second record for a vendor whose stored name is newer
 * instead of failing, and the storefront would read whichever came first.
 */
export const ensureVendorIndexes = (
  db: Db,
): Effect.Effect<void, EntifixError> =>
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
 * Applies one announcement to the projection: `'applied'`, or `'stale'` when
 * the stored name was announced later.
 *
 * ⚠️ **Ordered on `announcedAt`, and atomically.** A redelivered or overtaking
 * older announcement must not put an old name back (ADR 0061). The write is a
 * single conditional upsert — replace the record *only if* it is not newer —
 * rather than a read followed by a write, because two announcements handled
 * concurrently would both read the old record and the slower one would win.
 * When a newer record exists the filter matches nothing, the upsert tries to
 * insert, and the unique index on `vendorId` refuses it; that refusal **is** the
 * "older, ignored" outcome. An equal stamp replaces, which is the same document.
 *
 * Replaced wholesale, never merged (ADR 0009): the `$set` carries every member
 * the entity has, each always defined.
 */
export const applyAnnouncement = (
  db: Db,
  announcement: OrganizationAnnouncement,
): Effect.Effect<'applied' | 'stale', EntifixError> =>
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
        // `$set` of the **whole** serialized record, which is a replacement:
        // every member is always present, so no stale key can survive it.
        await db
          .collection(VENDOR_COLLECTION)
          .updateOne(
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

/** Indexes the projection, then binds `organization.*` and starts writing it. */
export const startProjectingVendors = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const db = yield* MongoDatabaseTag;

  yield* ensureVendorIndexes(db);
  yield* bus.subscribe(vendorSubscription, event =>
    Effect.flatMap(readOrganizationAnnouncement(event.data), announcement =>
      applyAnnouncement(db, announcement),
    ),
  );
});
