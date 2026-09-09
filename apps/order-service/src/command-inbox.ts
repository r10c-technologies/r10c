import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { ClientSession, Db } from 'mongodb';

/** Where a claimed command id is recorded, in the `order` database. */
export const COMMAND_INBOX_COLLECTION = 'command_inbox';

/** The header a saga dispatch carries its command id in. */
export const COMMAND_ID_HEADER = 'x-command-id';

const DUPLICATE_KEY = 11_000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

export const ensureCommandInboxIndexes = (db: Db) =>
  Effect.promise(() =>
    db
      .collection(COMMAND_INBOX_COLLECTION)
      .createIndex({ commandId: 1 }, { unique: true, name: 'commandId_1' }),
  );

/**
 * Claim a command id **inside** a caller's transaction.
 *
 * ⚠️ **This is what stops an at-least-once dispatch from writing two orders.**
 * `POST /api/product-order` mints a fresh order id per call, so a redelivered
 * saga command would otherwise write a *second* receipt against holds that were
 * only ever taken once — and the buyer would see two orders for one checkout
 * ([ADR 0052](../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * The same shape as stock-service's, deliberately copied rather than shared: the
 * two live in different stores with different writers, and a package they both
 * imported would be a seam between two slices for eleven lines of Mongo.
 *
 * ⚠️ **The session is not optional.** The claim and the write must commit or
 * roll back together. Claimed outside, a crash between the two leaves an id that
 * says the order was written when it was not, and every retry is then refused as
 * a duplicate forever.
 *
 * Returns `false` when the id was already claimed, which the caller answers as
 * "you already have this" rather than as a failure. It does **not** throw: a
 * redelivery is the mechanism working, not an error.
 */
export const claimCommand = (
  db: Db,
  session: ClientSession,
  commandId: string,
): Promise<boolean> =>
  db
    .collection(COMMAND_INBOX_COLLECTION)
    .insertOne(
      { commandId, claimedAt: new Date().toISOString() },
      { session },
    )
    .then(() => true)
    .catch((error: unknown) => {
      if (isDuplicateKey(error)) {
        return false;
      }
      throw new EntifixConnError('Failed to claim the command id', error, {
        commandId,
      });
    });
