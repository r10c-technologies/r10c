import {
  OfferingPriceRepositoryTag,
  OfferingSpecificationRepositoryTag,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  transitionOffering,
  TransitionOfferingInputTag,
} from '@r10c/business-ts-product-configuration-management';
import { EventSourceTag } from '@r10c/entifix-transactions';
import {
  type ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { EntifixError } from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoClientTag,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { TenantDatabasePrefix, tenantDatabases } from '../outbox/relay';
import {
  ensureOutboxIndexes,
  makeMongoOutbox,
  reviveQuarantined,
} from '../outbox/store';

/** Offerings read from one tenant per page. Nothing holds a whole store. */
const PAGE_SIZE = 100;

/** What became of one stored-`published` offering. */
export type RebuildOutcome =
  /** Announced for the first time — the fresh-lab case. */
  | 'announced'
  /** Its announcement had been quarantined, and is queued again. */
  | 'revived'
  /** Already on the bus, and nothing to do. */
  | 'alreadyAnnounced'
  /** Publishing it would be refused: no price, or no specification. */
  | 'unannounceable'
  /** It carries no `statusChangedAt`, so there is no moment to re-emit. */
  | 'unstamped';

/** One tenant's tally, in the order a reader cares about it. */
export type RebuildReport = Record<RebuildOutcome, number>;

const emptyReport = (): RebuildReport => ({
  announced: 0,
  revived: 0,
  alreadyAnnounced: 0,
  unannounceable: 0,
  unstamped: 0,
});

/**
 * Re-announces one offering, or says why it could not be.
 *
 * ⚠️ **It runs `transitionOffering` rather than building a payload.**
 * `published → published` is legal (ADR 0047: republication is how a vendor's
 * correction reaches the storefront), so the use case produces exactly the
 * message the original publication produced, through exactly the same code —
 * including both preconditions. A second payload builder here would be the
 * second declaration site ADR 0049 deleted from the projector, and it would
 * drift the first time a member is added to the snapshot.
 *
 * The moved offering is discarded on purpose: its status is already what the
 * transition set it to, so there is nothing to save and no reason to open a
 * transaction.
 */
const announce = (
  db: Db,
  offering: ProductOffering,
  organizationId: string,
  source: string,
): Effect.Effect<RebuildOutcome, EntifixError, ConfigurationRepositoryTag> =>
  Effect.gen(function* () {
    const at = offering.statusChangedAt;

    if (at === undefined) {
      // Nothing to re-emit: stamping `now` here would mint a new publication
      // rather than redeliver one, and overwrite the projection's ordering key.
      // A seeded lab that predates the stamped seed lands here, which is what
      // makes a reset the honest remedy rather than a convenience.
      yield* Effect.logWarning(
        'offering has no status moment to re-announce',
      ).pipe(
        Effect.annotateLogs({
          database: db.databaseName,
          offeringId: String(offering.id),
        }),
      );
      return 'unstamped';
    }

    const decision = yield* transitionOffering.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, ProductOffering),
      ),
      Effect.provideService(
        OfferingPriceRepositoryTag,
        makeMongoRepository(db, ProductOfferingPrice),
      ),
      Effect.provideService(
        OfferingSpecificationRepositoryTag,
        makeMongoRepository(db, ProductSpecification),
      ),
      Effect.provideService(TransitionOfferingInputTag, {
        id: offering.id,
        transition: 'publish',
        // The tenant database's own name, minus the prefix. Legal here for the
        // reason `tenantDatabases` is: this slice is the single writer of every
        // one of these stores, so it is reading its own.
        vendorId: organizationId,
        source,
        // ⚠️ The **stored** moment, never `now`. This is what makes the event id
        // identical to the original announcement's and therefore makes the whole
        // walk idempotent.
        at,
      }),
      // A refusal is this offering's problem and not the walk's: it is reported
      // and the next offering is attempted. A driver failure is not caught here
      // — it belongs to the tenant, and the caller isolates that.
      Effect.catchTags({
        IllegalOfferingTransition: () => Effect.succeed(undefined),
        OfferingHasNoPrice: () => Effect.succeed(undefined),
        OfferingHasNoSpecification: () => Effect.succeed(undefined),
      }),
    );

    if (decision === undefined) {
      yield* Effect.logWarning('offering cannot be announced').pipe(
        Effect.annotateLogs({
          database: db.databaseName,
          offeringId: String(offering.id),
          specificationId: offering.specificationId,
        }),
      );
      return 'unannounceable';
    }

    const enqueued = yield* makeMongoOutbox(db).enqueue(decision.event);
    if (enqueued === 'enqueued') return 'announced';

    // `duplicate` means this exact announcement is already on file. That is the
    // right answer for one already delivered and the wrong one for an entry the
    // relay gave up on — see `reviveQuarantined`, which touches only the latter.
    const revived = yield* reviveQuarantined(db, decision.event.id);
    return revived ? 'revived' : 'alreadyAnnounced';
  });

/**
 * Re-announces every stored-`published` offering in one tenant database.
 *
 * Paged and sequential. "A job with a rate" is the shape a fleet-wide fan-out
 * has to have: nothing holds a tenant's offerings — let alone the fleet's — in
 * memory, and the page is **sorted by id** so `skip`/`limit` cannot repeat or
 * miss a row the way an unsorted scan can.
 *
 * `ensureOutboxIndexes` first, exactly as the relay's sweep and the transition
 * route do: a tenant database appears on its first write, and the unique index
 * on `eventId` is what makes this walk idempotent rather than a duplicate
 * factory, so it must exist before the first insert and not eventually.
 */
export const rebuildTenantPublications = (
  db: Db,
  organizationId: string,
  source: string,
): Effect.Effect<RebuildReport, EntifixError, ConfigurationRepositoryTag> =>
  Effect.gen(function* () {
    yield* ensureOutboxIndexes(db);

    const offerings = makeMongoRepository(db, ProductOffering);
    const report = emptyReport();

    for (let page = 1; ; page += 1) {
      const { items } = yield* offerings.load<ProductOffering>({
        filtering: [{ property: 'status', operator: 'eq', value: 'published' }],
        // Keyed by numeric priority — `EntitySorting` is a record, not a
        // tuple. Sorted at all because `skip`/`limit` over an unsorted scan may
        // repeat a document on one page and miss it on the next.
        sorting: [{ 0: { property: 'id', type: 'asc' } }],
        page,
        pageSize: PAGE_SIZE,
      });

      for (const offering of items) {
        report[yield* announce(db, offering, organizationId, source)] += 1;
      }

      if (items.length < PAGE_SIZE) break;
    }

    yield* Effect.logInfo('rebuilt a tenant catalog').pipe(
      Effect.annotateLogs({ database: db.databaseName, ...report }),
    );

    return report;
  });

/**
 * Re-announces every published offering the fleet holds, once, at boot.
 *
 * ⚠️ **Enumerating tenants is legal here for the reason it is legal in the
 * relay, and for no other**: `marketplace-admin` is the single writing slice of
 * every `tenant_<organizationId>` store, so this reads its own. It is
 * deliberately not ADR 0012's discretionary human crossing (a person picks no
 * organization here) and not ADR 0023's determined one (there is no caller to
 * authorize) — both of which are, in any case, still unbuilt.
 *
 * ⚠️ **Per tenant, not per pass.** The relay wraps its whole sweep in one
 * `catchAll`, which is survivable there because another sweep follows in 15s;
 * this runs once, so one tenant's failure must not take the tenants after it
 * with it.
 *
 * Forked, so a fleet-wide scan does not hold up the server's boot, and it
 * registers no shutdown hook: it is a one-shot, and interrupting a partial walk
 * loses nothing the next boot does not redo.
 */
export const startPublicationRebuild = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const prefix = yield* TenantDatabasePrefix;
  const source = yield* EventSourceTag;

  yield* Effect.forkDaemon(rebuildFleet(client, prefix, source));
});

const rebuildFleet = (client: MongoClient, prefix: string, source: string) =>
  Effect.gen(function* () {
    const names = yield* tenantDatabases(client, prefix);

    for (const name of names) {
      yield* rebuildTenantPublications(
        client.db(name),
        name.slice(prefix.length),
        source,
      ).pipe(
        Effect.catchAll(error =>
          Effect.logError('rebuilding a tenant catalog failed').pipe(
            Effect.annotateLogs({ database: name, error: String(error) }),
          ),
        ),
      );
    }
  }).pipe(
    Effect.catchAll(error =>
      Effect.logError('the catalog rebuild could not enumerate tenants').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );
