import { Effect } from 'effect';

import type { ProductSpecification } from '../entities/product-specification';
import type {
  OfferingCatalog,
  SpecificationCommands,
} from '../ports/offering-catalog';

/** An organization's offerings, by id, as the status each one stands at. */
export type OfferingSeed = Readonly<
  Record<
    string,
    ReadonlyArray<{ readonly id: string; readonly status: string }>
  >
>;

/**
 * An {@link OfferingCatalog} held in memory, for the specs of whatever
 * consumes the port. It runs `describeOfferingCatalogContract`, so a
 * transition commits only from the status it was decided against.
 */
export const makeInMemoryOfferingCatalog = (
  seed: OfferingSeed = {},
): OfferingCatalog => {
  const statuses = new Map<string, string>();
  for (const [organizationId, offerings] of Object.entries(seed)) {
    for (const { id, status } of offerings) {
      statuses.set(`${organizationId}/${id}`, status);
    }
  }
  const announced = new Set<string>();

  return {
    commitTransition: (organizationId, offering, from, event) =>
      Effect.sync(() => {
        const key = `${organizationId}/${String(offering.id)}`;
        if (statuses.get(key) !== from) return 'changed';
        statuses.set(key, offering.status);
        announced.add(`${organizationId}/${event.id}`);
        return 'committed';
      }),
    reannounce: (organizationId, event) =>
      Effect.sync(() => {
        const key = `${organizationId}/${event.id}`;
        if (announced.has(key)) return 'alreadyAnnounced';
        announced.add(key);
        return 'announced';
      }),
  };
};

/**
 * A {@link SpecificationCommands} held in memory, for the specs of whatever
 * consumes the port: a counter per organization and the records its keys
 * wrote. It runs `describeSpecificationCommandsContract`.
 */
export const makeInMemorySpecificationCommands = (): SpecificationCommands => {
  const counters = new Map<string, number>();
  const byKey = new Map<string, ProductSpecification>();
  return {
    create: (organizationId, specification, idempotencyKey) =>
      Effect.sync(() => {
        const scoped =
          idempotencyKey === undefined
            ? undefined
            : `${organizationId}:${idempotencyKey}`;
        const known = scoped === undefined ? undefined : byKey.get(scoped);
        if (known !== undefined) return known;
        const next = (counters.get(organizationId) ?? 0) + 1;
        counters.set(organizationId, next);
        specification.id = globalThis.crypto.randomUUID();
        specification.code = `product-${String(next).padStart(3, '0')}`;
        if (scoped !== undefined) byKey.set(scoped, specification);
        return specification;
      }),
  };
};
