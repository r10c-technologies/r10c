import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, NotFound } from '@entifix/core';
import { Effect } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { ProductSpecification } from '../../entities/product-specification';
import { SpecificationCommandsTag } from '../../ports/offering-catalog';
import {
  contentHashOf,
  type SpecificationMove,
} from '../../values/specification-lifecycle';
import {
  SpecificationBeingRevised,
  SpecificationChanged,
  SpecificationReleased,
  SpecificationStillPinned,
} from './specification-failures';
import { decideSpecificationMove } from './specification-lifecycle.uc';

/** The organization's specifications, as a repository. */
const specificationsOf = (organizationId: string) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    return yield* factory.for(ProductSpecification, { organizationId });
  });

/**
 * Move one version along its lifecycle — `release`, `retire` or `obsolete` —
 * and answer it as stored. The decision is here; the store only refuses to
 * write over a state that moved, which answers {@link SpecificationChanged}.
 */
export const moveSpecificationFor = (input: {
  readonly organizationId: string;
  readonly id: EntityId;
  readonly move: Exclude<SpecificationMove, 'revise'>;
  readonly at?: Date;
}) =>
  Effect.gen(function* () {
    const specifications = yield* specificationsOf(input.organizationId);
    const specification = yield* specifications.get<ProductSpecification>(
      input.id,
    );
    const { from, to } = yield* decideSpecificationMove(
      specification,
      input.move,
    );
    const at = input.at ?? new Date();

    if (input.move === 'obsolete') {
      // `obsolete` claims nothing live sells it. Publishing needs an `active`
      // pin, so a retired version gains no new published offering while this
      // reads: the count cannot be overtaken.
      const factory = yield* EntityRepositoryFactoryTag;
      const offerings = yield* factory.for(ProductOffering, {
        organizationId: input.organizationId,
      });
      const pinned = yield* offerings.load<ProductOffering>({
        filtering: [
          { property: 'specificationId', operator: 'eq', value: input.id },
          { property: 'status', operator: 'eq', value: 'published' },
        ],
        pageSize: 1,
      });
      if (pinned.items.length > 0) {
        return yield* new SpecificationStillPinned({ id: String(input.id) });
      }
    }

    if (to === 'active') {
      specification.contentHash = yield* contentHashOf(specification);
      specification.validFrom = at;
      specification.validTo = undefined;
    }
    if (to === 'retired') specification.validTo = at;
    specification.lifecycleStatus = to;

    const commands = yield* SpecificationCommandsTag;
    if (
      (yield* commands.move(input.organizationId, specification, from)) ===
      'changed'
    ) {
      return yield* new SpecificationChanged({ id: String(input.id) });
    }
    return specification;
  });

/**
 * Open the next version of an active one, in design, as a copy of what it
 * says — and answer the new record. One draft per series: a revise while
 * another version is in design is refused, and two revises racing on one key
 * are refused by the store's unique version.
 */
export const reviseSpecificationFor = (input: {
  readonly organizationId: string;
  readonly id: EntityId;
}) =>
  Effect.gen(function* () {
    const specifications = yield* specificationsOf(input.organizationId);
    const active = yield* specifications.get<ProductSpecification>(input.id);
    yield* decideSpecificationMove(active, 'revise');
    const specKey = String(active.specKey);

    const drafts = yield* specifications.load<ProductSpecification>({
      filtering: [
        { property: 'specKey', operator: 'eq', value: specKey },
        { property: 'lifecycleStatus', operator: 'eq', value: 'in-design' },
      ],
      pageSize: 1,
    });
    if (drafts.items.length > 0) {
      return yield* new SpecificationBeingRevised({ specKey });
    }

    const next = new ProductSpecification(active.code, active.name);
    next.id = globalThis.crypto.randomUUID();
    next.specKey = active.specKey;
    next.version = (active.version ?? 0) + 1;
    next.lifecycleStatus = 'in-design';
    next.description = active.description;
    next.brandId = active.brandId;
    next.categoryId = active.categoryId;
    next.media = active.media;
    next.fitsDeviceModelIds = active.fitsDeviceModelIds;

    const commands = yield* SpecificationCommandsTag;
    if ((yield* commands.revise(input.organizationId, next)) === 'changed') {
      return yield* new SpecificationBeingRevised({ specKey });
    }
    return next;
  });

/**
 * Delete a version that is still in design. A released one is kept forever —
 * orders name it — so it answers {@link SpecificationReleased}.
 */
export const removeSpecificationFor = (input: {
  readonly organizationId: string;
  readonly id: string;
}) =>
  Effect.gen(function* () {
    const commands = yield* SpecificationCommandsTag;
    const outcome = yield* commands.remove(input.organizationId, input.id);
    if (outcome === 'absent') {
      return yield* new NotFound({ entity: 'product-specification' });
    }
    if (outcome === 'changed') {
      return yield* new SpecificationReleased({
        id: input.id,
        standing: 'released',
      });
    }
    return input.id;
  });

/** The members a save never takes from the body: they are the lifecycle's. */
const SERVER_OWNED = [
  'code',
  'specKey',
  'version',
  'lifecycleStatus',
  'validFrom',
  'validTo',
  'contentHash',
] as const;

/**
 * A new series: version `1`, in design, nothing stamped. `code` and `specKey`
 * are drawn by the store, so whatever the body said is cleared.
 */
export const startSpecificationSeries = (
  specification: ProductSpecification,
): ProductSpecification => {
  specification.version = 1;
  specification.lifecycleStatus = 'in-design';
  specification.specKey = undefined;
  specification.validFrom = undefined;
  specification.validTo = undefined;
  specification.contentHash = undefined;
  return specification;
};

/**
 * ⚠️ **A `PUT` reaches only a version in design**, and carries the lifecycle
 * across from what is stored, whatever the body said (ADR 0079 §1). A release
 * landing between this read and the save has moved the `revision`, so the
 * save itself is refused `staleRevision` — the window this read leaves is
 * closed by the revision check, not by hope.
 */
export const preserveSpecificationLifecycle = (
  specification: ProductSpecification,
  organizationId: string,
) =>
  Effect.gen(function* () {
    if (specification.id == null)
      return startSpecificationSeries(specification);
    const specifications = yield* specificationsOf(organizationId);
    const stored = yield* specifications.get<ProductSpecification>(
      specification.id,
    );
    if (stored.lifecycleStatus !== 'in-design') {
      return yield* new SpecificationReleased({
        id: String(specification.id),
        standing: String(stored.lifecycleStatus),
      });
    }
    for (const member of SERVER_OWNED) {
      (specification as unknown as Record<string, unknown>)[member] =
        stored[member];
    }
    return specification;
  });
