import { MongoDatabaseTag } from '@entifix/mongo';
import { seedCollection } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { AGREEMENT_COLLECTION } from './settlement-index';
import { agreementTempData } from './settlement-temp-data';

const asRecords = (
  data: ReadonlyArray<object>,
): ReadonlyArray<Record<string, unknown>> =>
  data as ReadonlyArray<Record<string, unknown>>;

/**
 * Seeds the demo vendor's agreement on first boot.
 *
 * ⚠️ **A lab with no agreement settles nothing at all.** The fold prices a line
 * through the agreement in force for that vendor, and a vendor with none gets no
 * commission entry and an error-level log — deliberately, because guessing a
 * default rate would invent a commercial term nobody negotiated. So without this
 * the whole fleet looks healthy, every probe is green, sales complete, and the
 * commission ledger stays empty with only a log line to say why.
 *
 * ⚠️ **The ledger is not seeded, and that is the difference from stock's seed.**
 * Stock seeds movements *and* the totals they add up to, because both are
 * records a vendor reads. A commission entry is produced by a captured sale, and
 * a seeded one would be a row no payment explains — a payout that could not be
 * traced back to its entries is the exact thing this domain exists to prevent.
 * The lab fills this ledger by ringing up a sale.
 *
 * **Control plane, one database.** Unlike sales and stock this writes the store's
 * one named database rather than a per-organization handle, so it takes no
 * database name — the layer already resolved it.
 */
export const seedSettlement = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;

    yield* seedCollection(
      db,
      AGREEMENT_COLLECTION,
      asRecords(agreementTempData(organizationId)),
    );
  });
