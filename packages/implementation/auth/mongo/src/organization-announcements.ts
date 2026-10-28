import { type TransitionalFailure, Unavailable } from '@entifix/core';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  makeMongoOutbox,
  makeMongoUnitsOfWork,
  OutboxMaxAttempts,
  reviveQuarantined,
} from '@entifix/mongo/transactions';
import {
  type EventBus,
  EventBusTag,
  EventSourceTag,
} from '@entifix/transactions';
import {
  organizationAnnouncedEvent,
  type OrganizationAnnouncement,
} from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';
import type { Db, Document, MongoClient } from 'mongodb';

/** Where an organization lives — its entity key, as every collection name is. */
export const ORGANIZATION_COLLECTION = 'organization';

/**
 * What an organization says about itself in public, or `undefined` when the
 * stored row cannot be announced: no name, or no stamp to order it by.
 */
export const announcementOf = (
  row: Document,
): OrganizationAnnouncement | undefined => {
  const { id, name, updatedAt } = row;
  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
    return undefined;
  }
  return {
    organizationId: id,
    displayName: name,
    announcedAt: updatedAt.toISOString(),
  };
};

/** The unit's abort when the stored row already says what the seed says. */
class Unchanged {
  readonly _tag = 'Unchanged';
}

/** Whether every member the seed states already holds the seed's value. */
const holds = (stored: Document, row: Readonly<Record<string, unknown>>) =>
  Object.entries(row).every(([key, value]) => stored[key] === value);

/**
 * Writes one organization **and its announcement in the same transaction**
 * (ADR 0028's outbox, ADR 0061's announcement), or does nothing when the stored
 * row already says what `row` says.
 *
 * ⚠️ **Unchanged is a no-op, stamp included.** The seed runs on every boot, and
 * a stamp moved on each one would re-announce every organization at a new
 * moment on every restart — a rename-shaped message for something nobody
 * renamed. A row is stamped `now` only when this write is what changed it, and
 * that stamp is the one the rebuild walk re-states later.
 *
 * It is the one path that writes an organization today. The first rename or
 * provisioning route (ADR 0011) is this function's second caller, not a second
 * implementation of it.
 */
export const writeOrganization = (
  client: MongoClient,
  db: Db,
  row: Readonly<Record<string, unknown>>,
  source: string,
  now: Date,
): Effect.Effect<
  'written' | 'unchanged',
  TransitionalFailure,
  EventBusTag | OutboxMaxAttempts
> =>
  Effect.gen(function* () {
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;

    const outcome = yield* makeMongoUnitsOfWork(client)
      .forDatabase(db)
      .run(
        unit =>
          Effect.gen(function* () {
            const { db: handle, session } = unit.handle;
            const organizations = handle.collection(ORGANIZATION_COLLECTION);
            const stored = yield* Effect.tryPromise({
              try: () => organizations.findOne({ id: row['id'] }, { session }),
              catch: () => new Unavailable({ dependency: 'mongo' }),
            });
            if (
              stored !== null &&
              holds(stored, row) &&
              announcementOf(stored) !== undefined
            ) {
              return yield* Effect.fail(new Unchanged());
            }

            const written = { ...row, updatedAt: now };
            yield* Effect.tryPromise({
              try: () =>
                organizations.updateOne(
                  { id: row['id'] },
                  { $set: written },
                  { upsert: true, session },
                ),
              catch: () => new Unavailable({ dependency: 'mongo' }),
            });
            const announcement = announcementOf(written);
            if (announcement !== undefined) {
              unit.emit(organizationAnnouncedEvent(announcement, source));
            }
          }),
        {
          // At commit, not at the relay's next sweep (#393's rule): a rename
          // reaches the storefront's seller line as soon as it is written.
          afterCommit: drainOutboxNow(db).pipe(
            Effect.provideService(EventBusTag, bus),
            Effect.provideService(OutboxMaxAttempts, maxAttempts),
          ),
        },
      );
    return outcome._tag === 'committed'
      ? ('written' as const)
      : ('unchanged' as const);
  });

/** Seeds the organizations through {@link writeOrganization}, one at a time. */
export const seedOrganizations = (
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    const source = yield* EventSourceTag;
    for (const row of rows) {
      yield* writeOrganization(client, db, row, source, new Date());
    }
  });

export type OrganizationRebuildOutcome =
  /** Announced for the first time — a store written before the outbox existed. */
  | 'announced'
  /** Its announcement had been quarantined, and is queued again. */
  | 'revived'
  /** Already sent once, and published again as a re-statement — see below. */
  | 'restated'
  /** No name or no `updatedAt`, so there is nothing to say or no moment to say it at. */
  | 'unannounceable';

export type OrganizationRebuildReport = Record<
  OrganizationRebuildOutcome,
  number
>;

/**
 * Re-announces every organization in the store, **at the moment of its own
 * last write and never at `now`** (ADR 0061, after ADR 0050).
 *
 * That rule is what makes the walk safe to run at any time. An unchanged
 * organization reproduces its original message id, which the outbox's unique
 * index already holds; a rename that landed while the walk ran carries a later
 * stamp, so the projector's guard keeps it over anything the walk re-states.
 *
 * ⚠️ **An announcement the outbox already sent is published again, directly.**
 * "Sent" is not "received": `reset.sh` wipes RabbitMQ, the bus drops a message
 * no queue is bound for, and on a fresh lab auth-service can send before
 * marketplace-service has declared its `organization.*` queue. That message is
 * gone, and the outbox — which counts it delivered — would never send it again,
 * leaving the storefront with no seller names on every later boot. Publishing
 * the re-statement on each boot is what makes the projection converge: same id,
 * same stamp, so the projector's equal-stamp case rewrites the same record. It
 * skips the outbox because nothing is being written, so there is no write for
 * it to be atomic with; a re-statement lost to a broker outage is repaired by
 * the next boot.
 */
export const rebuildOrganizationAnnouncements = (
  db: Db,
  bus: EventBus,
  source: string,
): Effect.Effect<OrganizationRebuildReport, TransitionalFailure> =>
  Effect.gen(function* () {
    const report: OrganizationRebuildReport = {
      announced: 0,
      revived: 0,
      restated: 0,
      unannounceable: 0,
    };
    const outbox = makeMongoOutbox(db);

    const rows = yield* Effect.tryPromise({
      try: () => db.collection(ORGANIZATION_COLLECTION).find({}).toArray(),
      catch: () => new Unavailable({ dependency: 'mongo' }),
    });

    for (const row of rows) {
      const announcement = announcementOf(row);
      if (announcement === undefined) {
        report.unannounceable += 1;
        continue;
      }

      const event = organizationAnnouncedEvent(announcement, source);
      if ((yield* outbox.enqueue(event)) === 'enqueued') {
        report.announced += 1;
      } else if (yield* reviveQuarantined(db, event.id)) {
        report.revived += 1;
      } else {
        yield* bus.publish(event);
        report.restated += 1;
      }
    }

    return report;
  });
