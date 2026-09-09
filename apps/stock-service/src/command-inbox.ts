import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { ClientSession, Db } from 'mongodb';

/** Where a claimed command id is recorded, per tenant database. */
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
 * ⚠️ **This is what stops an at-least-once dispatch from overselling.**
 * `POST /api/reservation` mints a fresh reservation id per call, so a redelivered
 * saga command would otherwise take a *second* hold against the same line:
 * stock held by nobody, the ledger correct at every step, and availability
 * quietly wrong. That is precisely the class of bug the reservation design
 * exists to prevent, reintroduced above it
 * ([ADR 0052](../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * ⚠️ **The session is not optional, and this is the difference from
 * `makeMongoInbox`.** That one inserts on its own connection, which is correct
 * for a bus consumer whose fold it then performs in a separate transaction —
 * but here the claim and the hold must commit or roll back together. Claimed
 * outside, a crash between the two leaves an id that says the hold was taken
 * when it was not, and the retry is then refused as a duplicate forever.
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
