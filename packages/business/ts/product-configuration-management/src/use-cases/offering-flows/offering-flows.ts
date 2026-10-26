import {
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  type BulkOutcome,
  type EntityId,
  type EntitySelection,
  loadRequestFor,
} from '@entifix/core';
import { Data, Effect } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { ProductOfferingPrice } from '../../entities/product-offering-price';
import { ProductSpecification } from '../../entities/product-specification';
import { OfferingCatalogTag } from '../../ports/offering-catalog';
import type { OfferingTransition } from '../../values/offering-transition';
import {
  OfferingPriceRepositoryTag,
  OfferingSpecificationRepositoryTag,
  transitionOffering,
  TransitionOfferingInputTag,
} from '../transition-offering/transition-offering';

export const OFFERING_CHANGED = 'offeringChanged';

/** Another transition landed between this one's read and its write. */
export class OfferingChanged extends Data.TaggedError('OfferingChanged')<{
  readonly id: EntityId;
}> {
  readonly code = OFFERING_CHANGED;
}

/** One page, capped: a bulk action over more is a saga, not a request (#121). */
const BULK_SELECTION_CAP = 500;

const REBUILD_PAGE_SIZE = 100;

/** The three repositories a transition reads, from the organization's store. */
const decide = (input: {
  readonly organizationId: string;
  readonly id: EntityId;
  readonly transition: OfferingTransition;
  readonly source: string;
  readonly at: Date;
}) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    const scope = { organizationId: input.organizationId };
    return yield* transitionOffering.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        yield* factory.for(ProductOffering, scope),
      ),
      Effect.provideService(
        OfferingPriceRepositoryTag,
        yield* factory.for(ProductOfferingPrice, scope),
      ),
      Effect.provideService(
        OfferingSpecificationRepositoryTag,
        yield* factory.for(ProductSpecification, scope),
      ),
      Effect.provideService(TransitionOfferingInputTag, {
        id: input.id,
        transition: input.transition,
        vendorId: input.organizationId,
        source: input.source,
        at: input.at,
      }),
    );
  });

/**
 * Publish or unpublish one offering: decide, then commit the offering and its
 * announcement only if nobody moved it in between. A lost race answers
 * {@link OfferingChanged} — a `409` the vendor retries against what is now
 * there — rather than a second announcement for one click.
 */
export const transitionOfferingFor = (input: {
  readonly organizationId: string;
  readonly id: EntityId;
  readonly transition: OfferingTransition;
  readonly source: string;
}) =>
  Effect.gen(function* () {
    const decision = yield* decide({ ...input, at: new Date() });
    const catalog = yield* OfferingCatalogTag;
    const committed = yield* catalog.commitTransition(
      input.organizationId,
      decision.offering,
      decision.from,
      decision.event,
    );
    if (committed === 'changed') {
      return yield* new OfferingChanged({ id: input.id });
    }
    return decision.offering;
  });

/**
 * The same verb over a selection (#216). One row's refusal never ends the
 * run: each id answers its own outcome, carrying the refusal's code.
 */
export const transitionOfferingSelection = (input: {
  readonly organizationId: string;
  readonly selection: EntitySelection<ProductOffering>;
  readonly transition: OfferingTransition;
  readonly source: string;
}) =>
  Effect.gen(function* () {
    const { selection } = input;
    // `Array.from`, never a spread: SWC's loose helper wraps a `Set`.
    const ids: readonly EntityId[] =
      selection.mode === 'ids'
        ? Array.from(selection.ids)
        : yield* Effect.gen(function* () {
            const factory = yield* EntityRepositoryFactoryTag;
            const offerings = yield* factory.for(ProductOffering, {
              organizationId: input.organizationId,
            });
            const page = yield* offerings.load<ProductOffering>(
              loadRequestFor(selection, {
                page: 1,
                pageSize: BULK_SELECTION_CAP,
              }),
            );
            const excluded = Array.from(selection.excluded).map(String);
            return page.items
              .map(item => item.id)
              .filter(id => excluded.indexOf(String(id)) === -1);
          });

    const outcomes: BulkOutcome[] = [];
    for (const id of ids) {
      outcomes.push(
        yield* transitionOfferingFor({ ...input, id }).pipe(
          Effect.as<BulkOutcome>({ id, ok: true }),
          Effect.catch(failure =>
            Effect.succeed<BulkOutcome>({
              id,
              ok: false,
              code:
                typeof (failure as { code?: unknown }).code === 'string'
                  ? (failure as { code: string }).code
                  : 'unexpected',
            }),
          ),
        ),
      );
    }
    return outcomes;
  });

/**
 * ⚠️ **`status` is server-owned** (ADR 0047): a save carries the stored
 * status across, whatever the body said, and a new offering starts `draft`.
 * Without this the publish verb would be decoration — a `PUT` could set
 * `published` with no price check and no announcement.
 */
export const preserveOfferingLifecycle = (
  offering: ProductOffering,
  organizationId: string,
) =>
  Effect.gen(function* () {
    if (offering.id == null) {
      offering.status = 'draft';
      offering.statusChangedAt = undefined;
      return offering;
    }
    const factory = yield* EntityRepositoryFactoryTag;
    const repository = yield* factory.for(ProductOffering, { organizationId });
    const stored = yield* repository
      .get<ProductOffering>(offering.id)
      .pipe(Effect.option);
    if (stored._tag === 'Some') {
      offering.status = stored.value.status;
      offering.statusChangedAt = stored.value.statusChangedAt;
    }
    return offering;
  });

export type RebuildOutcome =
  'announced' | 'revived' | 'alreadyAnnounced' | 'unannounceable' | 'unstamped';

export type RebuildReport = Record<RebuildOutcome, number>;

/**
 * Re-announce one organization's published offerings (ADR 0050), each **at
 * its own `statusChangedAt`** — never `now`, which would make the walk's
 * event a new publication rather than a redelivery and overwrite the
 * projection's ordering stamp.
 */
export const rebuildPublications = (input: {
  readonly organizationId: string;
  readonly source: string;
}) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    const catalog = yield* OfferingCatalogTag;
    const offerings = yield* factory.for(ProductOffering, {
      organizationId: input.organizationId,
    });
    const report: RebuildReport = {
      announced: 0,
      revived: 0,
      alreadyAnnounced: 0,
      unannounceable: 0,
      unstamped: 0,
    };

    for (let page = 1; ; page += 1) {
      const { items } = yield* offerings.load<ProductOffering>({
        filtering: [{ property: 'status', operator: 'eq', value: 'published' }],
        sorting: [{ 0: { property: 'id', type: 'asc' } }],
        page,
        pageSize: REBUILD_PAGE_SIZE,
      });

      for (const offering of items) {
        const at = offering.statusChangedAt;
        if (at === undefined) {
          report.unstamped += 1;
          continue;
        }
        const decision = yield* decide({
          organizationId: input.organizationId,
          id: offering.id,
          transition: 'publish',
          source: input.source,
          at,
        }).pipe(
          // No `IllegalOfferingTransition`: the walk reads only published
          // offerings, and `published → published` is legal (ADR 0047).
          Effect.catchTags({
            OfferingHasNoPrice: () => Effect.succeed(undefined),
            OfferingHasNoSpecification: () => Effect.succeed(undefined),
          }),
        );
        if (decision === undefined) {
          report.unannounceable += 1;
          continue;
        }
        report[
          yield* catalog.reannounce(input.organizationId, decision.event)
        ] += 1;
      }

      if (items.length < REBUILD_PAGE_SIZE) break;
    }

    yield* Effect.logInfo('rebuilt a tenant catalog').pipe(
      Effect.annotateLogs({ organizationId: input.organizationId, ...report }),
    );
    return report;
  });

/**
 * The walk over every organization's store. One organization's failure is
 * logged and the walk goes on; a directory that cannot be read is logged too,
 * never fatal — the storefront stays empty and says why.
 */
export const rebuildEveryPublication = (source: string) =>
  Effect.gen(function* () {
    const directory = yield* TenantDirectoryTag;
    for (const { organizationId } of yield* directory.list()) {
      yield* rebuildPublications({ organizationId, source }).pipe(
        Effect.catch(error =>
          Effect.logError('rebuilding a tenant catalog failed').pipe(
            Effect.annotateLogs({ organizationId, error: String(error) }),
          ),
        ),
      );
    }
  }).pipe(
    Effect.catch(error =>
      Effect.logError('the catalog rebuild could not enumerate tenants').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );
