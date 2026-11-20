import { type EntifixFailure, NotFound, Unavailable } from '@entifix/core';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  makeMongoOutbox,
  makeMongoUnitsOfWork,
  mongoUnitFault,
  reviveQuarantined,
} from '@entifix/mongo/transactions';
import {
  type EventBus,
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  organizationAnnouncedEvent,
  type OrganizationAnnouncement,
  type SellerFiscalIdentity,
} from '@r10c/business-ts-party-contracts';
import {
  type FiscalIdentity,
  OrganizationFiscalIdentityTag,
  OrganizationPaymentLinkAcceptanceTag,
  OrganizationWhatsappNumberTag,
} from '@r10c/business-ts-party-management';
import { isTaxRegime } from '@r10c/business-ts-tax-policy';
import { Effect, Layer } from 'effect';
import type { Db, Document, MongoClient } from 'mongodb';

/** Where an organization lives — its entity key, as every collection name is. */
export const ORGANIZATION_COLLECTION = 'organization';

/** Where an organization's provisioning lives (ADR 0007). */
export const ENTITLEMENT_COLLECTION = 'entitlement';

/** The domain whose entitlement makes a seller ship cash on delivery. */
const SHIPPING_DOMAIN = 'shipping-order-management';
const STOCK_DOMAIN = 'stock-management';

/** What an organization's entitlement says about how it sells, in public. */
export interface CommerceFacts {
  readonly acceptsCod: boolean;
  readonly holdsStock: boolean;
}

const NO_COMMERCE: CommerceFacts = { acceptsCod: false, holdsStock: false };

/**
 * What an entitlement row provisions that a buyer or a flow may know: shipping,
 * and so cash on delivery; stock, and so a hold a checkout may take.
 */
export const commerceOf = (
  entitlement: Document | null | undefined,
): CommerceFacts => {
  const domains = entitlement?.['domains'];
  if (!Array.isArray(domains)) return NO_COMMERCE;
  return {
    acceptsCod: domains.includes(SHIPPING_DOMAIN),
    holdsStock: domains.includes(STOCK_DOMAIN),
  };
};

/**
 * What an organization says about itself in public, or `undefined` when the
 * stored row cannot be announced: no name, or no stamp to order it by. Its
 * commerce facts come from its entitlement, read beside it in the same store.
 */
export const announcementOf = (
  row: Document,
  commerce: CommerceFacts = NO_COMMERCE,
): OrganizationAnnouncement | undefined => {
  const { id, name, updatedAt } = row;
  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  const fiscal = fiscalOf(row);
  if (fiscal === undefined) return undefined;
  if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
    return undefined;
  }
  return {
    organizationId: id,
    displayName: name,
    announcedAt: updatedAt.toISOString(),
    acceptsCod: commerce.acceptsCod,
    holdsStock: commerce.holdsStock,
    // Authored on the organization itself, not provisioned (ADR 0081 §1).
    acceptsLink: row['acceptsPaymentLink'] === true,
    whatsappNumber:
      typeof row['whatsappNumber'] === 'string' ? row['whatsappNumber'] : '',
    fiscal,
  };
};

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * The stored fiscal identity, or `undefined` while any member is blank. An
 * organization with none cannot be sold from — every order copies it — so it
 * is not announced at all rather than announced half-described (ADR 0078 §6).
 */
const fiscalOf = (row: Document): SellerFiscalIdentity | undefined => {
  const { taxId, legalName, taxRegime, establishmentCode } = row;
  return filled(taxId) &&
    filled(legalName) &&
    filled(taxRegime) &&
    filled(establishmentCode)
    ? { taxId, legalName, taxRegime, establishmentCode }
    : undefined;
};

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

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
  /**
   * Members written only when the organization does not exist yet — what a
   * seed proposes and the organization itself then owns. The fiscal identity
   * is seeded this way, so a boot never overwrites what an `admin` stated
   * through `set-fiscal-identity`.
   */
  initial: Readonly<Record<string, unknown>> = {},
): Effect.Effect<
  'written' | 'unchanged',
  EntifixFailure,
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
              catch: mongoUnitFault,
            });
            if (
              stored !== null &&
              holds(stored, row) &&
              announcementOf(stored) !== undefined
            ) {
              return yield* Effect.fail(new Unchanged());
            }

            const entitlement = yield* Effect.tryPromise({
              try: () =>
                handle
                  .collection(ENTITLEMENT_COLLECTION)
                  .findOne({ organizationId: row['id'] }, { session }),
              catch: mongoUnitFault,
            });
            // Strictly after the last stamp: the stamp is the announcement's
            // id and version, so two writes in one millisecond would share
            // them, and the second would be taken for a redelivery of the
            // first and dropped.
            const previous = stored?.['updatedAt'];
            const stamp =
              previous instanceof Date && previous.getTime() >= now.getTime()
                ? new Date(previous.getTime() + 1)
                : now;
            const written =
              stored === null
                ? { ...initial, ...row, updatedAt: stamp }
                : { ...row, updatedAt: stamp };
            yield* Effect.tryPromise({
              try: () =>
                organizations.updateOne(
                  { id: row['id'] },
                  { $set: written },
                  { upsert: true, session },
                ),
              catch: mongoUnitFault,
            });
            // Announced from the whole record, not from the members this write
            // set: a write of the fiscal identity alone still re-states the
            // name beside it.
            const announcement = announcementOf(
              { ...stored, ...written },
              commerceOf(entitlement),
            );
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
/** One organization a seed proposes: its row, and what only a new one gets. */
export interface OrganizationSeed {
  readonly row: Readonly<Record<string, unknown>>;
  readonly initial?: Readonly<Record<string, unknown>>;
}

export const seedOrganizations = (seeds: ReadonlyArray<OrganizationSeed>) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    const source = yield* EventSourceTag;
    for (const { row, initial } of seeds) {
      yield* writeOrganization(client, db, row, source, new Date(), initial);
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
): Effect.Effect<OrganizationRebuildReport, EntifixFailure> =>
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
      catch: storeUnavailable,
    });
    // ⚠️ **Entitlements re-stated at the organization's own stamp.** A
    // provisioning change moves no organization stamp, so the walk is what
    // carries it out: the projector's equal-stamp case rewrites the record.
    const entitlements = yield* Effect.tryPromise({
      try: () => db.collection(ENTITLEMENT_COLLECTION).find({}).toArray(),
      catch: storeUnavailable,
    });
    const commerceBy = new Map(
      entitlements.map(entitlement => [
        entitlement['organizationId'] as unknown,
        commerceOf(entitlement),
      ]),
    );

    for (const row of rows) {
      const announcement = announcementOf(row, commerceBy.get(row['id']));
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

const readOrganization = (
  db: Db,
  organizationId: string,
): Effect.Effect<Document, NotFound | Unavailable> =>
  Effect.gen(function* () {
    const stored = yield* Effect.tryPromise({
      try: () =>
        db.collection(ORGANIZATION_COLLECTION).findOne({ id: organizationId }),
      catch: storeUnavailable,
    });
    if (stored === null) {
      return yield* Effect.fail(new NotFound({ entity: 'organization' }));
    }
    return stored;
  });

/**
 * Members the organization states about itself, written through
 * {@link writeOrganization} so the record and its announcement stay one unit.
 * An organization is provisioned by the operator, never created here — an
 * unknown id answers `NotFound` rather than upserting a nameless row.
 */
const writeOwnMembers = (
  client: MongoClient,
  db: Db,
  source: string,
  bus: EventBus,
  maxAttempts: number,
  organizationId: string,
  members: Readonly<Record<string, unknown>>,
): Effect.Effect<void, NotFound | EntifixFailure> =>
  Effect.gen(function* () {
    yield* readOrganization(db, organizationId);
    yield* writeOrganization(
      client,
      db,
      { id: organizationId, ...members },
      source,
      new Date(),
    ).pipe(
      Effect.provideService(EventBusTag, bus),
      Effect.provideService(OutboxMaxAttempts, maxAttempts),
    );
  });

/**
 * The organization's own statement of its fiscal identity
 * (`set-fiscal-identity`), written through {@link writeOrganization} so the
 * record and its announcement stay one unit: the published vendor projection
 * is what every new order copies the identity from.
 *
 * An organization is provisioned by the operator, never created here — an
 * unknown id answers `NotFound` rather than upserting a nameless row.
 */
export const makeMongoOrganizationFiscalIdentity = (
  client: MongoClient,
  db: Db,
  source: string,
  bus: EventBus,
  maxAttempts: number,
) => ({
  get: (
    organizationId: string,
  ): Effect.Effect<FiscalIdentity | undefined, NotFound | Unavailable> =>
    readOrganization(db, organizationId).pipe(
      Effect.map(stored => {
        const fiscal = fiscalOf(stored);
        return fiscal !== undefined && isTaxRegime(fiscal.taxRegime)
          ? { ...fiscal, taxRegime: fiscal.taxRegime }
          : undefined;
      }),
    ),
  set: (
    organizationId: string,
    identity: FiscalIdentity,
  ): Effect.Effect<void, NotFound | EntifixFailure> =>
    writeOwnMembers(client, db, source, bus, maxAttempts, organizationId, {
      taxId: identity.taxId,
      legalName: identity.legalName,
      taxRegime: identity.taxRegime,
      establishmentCode: identity.establishmentCode,
    }),
});

/**
 * The organization's fiscal identity port over the `auth` store — what
 * `set-fiscal-identity` reads and writes through (ADR 0078 §6).
 */
export const MongoOrganizationFiscalIdentityLayer = Layer.effect(
  OrganizationFiscalIdentityTag,
  Effect.gen(function* () {
    return makeMongoOrganizationFiscalIdentity(
      yield* MongoClientTag,
      yield* MongoDatabaseTag,
      yield* EventSourceTag,
      yield* EventBusTag,
      yield* OutboxMaxAttempts,
    );
  }),
);

/**
 * The organization's own choice to take payment links
 * (`set-payment-link-acceptance`, ADR 0081 §1), written through
 * {@link writeOrganization} so the published vendor's `acceptsLink` follows in
 * the same unit.
 */
export const makeMongoOrganizationPaymentLinkAcceptance = (
  client: MongoClient,
  db: Db,
  source: string,
  bus: EventBus,
  maxAttempts: number,
) => ({
  get: (
    organizationId: string,
  ): Effect.Effect<boolean, NotFound | Unavailable> =>
    readOrganization(db, organizationId).pipe(
      Effect.map(stored => stored['acceptsPaymentLink'] === true),
    ),
  set: (
    organizationId: string,
    accepts: boolean,
  ): Effect.Effect<void, NotFound | EntifixFailure> =>
    writeOwnMembers(client, db, source, bus, maxAttempts, organizationId, {
      acceptsPaymentLink: accepts,
    }),
});

/**
 * The organization's own WhatsApp number (`set-whatsapp-number`, #671),
 * written through {@link writeOrganization} so the published vendor follows in
 * the same unit.
 */
export const makeMongoOrganizationWhatsappNumber = (
  client: MongoClient,
  db: Db,
  source: string,
  bus: EventBus,
  maxAttempts: number,
) => ({
  get: (
    organizationId: string,
  ): Effect.Effect<string, NotFound | Unavailable> =>
    readOrganization(db, organizationId).pipe(
      Effect.map(stored =>
        typeof stored['whatsappNumber'] === 'string'
          ? stored['whatsappNumber']
          : '',
      ),
    ),
  set: (
    organizationId: string,
    number: string,
  ): Effect.Effect<void, NotFound | EntifixFailure> =>
    writeOwnMembers(client, db, source, bus, maxAttempts, organizationId, {
      whatsappNumber: number,
    }),
});

/** The WhatsApp number port over the `auth` store (#671). */
export const MongoOrganizationWhatsappNumberLayer = Layer.effect(
  OrganizationWhatsappNumberTag,
  Effect.gen(function* () {
    return makeMongoOrganizationWhatsappNumber(
      yield* MongoClientTag,
      yield* MongoDatabaseTag,
      yield* EventSourceTag,
      yield* EventBusTag,
      yield* OutboxMaxAttempts,
    );
  }),
);

/** The payment-link acceptance port over the `auth` store (ADR 0081 §1). */
export const MongoOrganizationPaymentLinkAcceptanceLayer = Layer.effect(
  OrganizationPaymentLinkAcceptanceTag,
  Effect.gen(function* () {
    return makeMongoOrganizationPaymentLinkAcceptance(
      yield* MongoClientTag,
      yield* MongoDatabaseTag,
      yield* EventSourceTag,
      yield* EventBusTag,
      yield* OutboxMaxAttempts,
    );
  }),
);
