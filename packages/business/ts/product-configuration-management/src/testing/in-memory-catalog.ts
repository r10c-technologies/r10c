import { Effect } from 'effect';

import type { ProductSpecification } from '../entities/product-specification';
import type {
  OfferingCatalog,
  SpecificationCommands,
} from '../ports/offering-catalog';
import type { OfferingStatus } from '../values/offering-status';
import { isNeverPublished } from '../values/offering-status';

/** An organization's offerings, by id, as each one stands. */
export type OfferingSeed = Readonly<
  Record<
    string,
    ReadonlyArray<{
      readonly id: string;
      readonly status: string;
      readonly revision?: number;
    }>
  >
>;

/** An organization's prices, by id, at the revision each one stands at. */
export type PriceSeed = Readonly<
  Record<
    string,
    ReadonlyArray<{ readonly id: string; readonly revision?: number }>
  >
>;

/**
 * An {@link OfferingCatalog} held in memory, for the specs of whatever
 * consumes the port. It runs `describeOfferingCatalogContract`, so a
 * transition commits only from the status and revision it was decided
 * against.
 */
export const makeInMemoryOfferingCatalog = (
  seed: OfferingSeed = {},
  priceSeed: PriceSeed = {},
): OfferingCatalog => {
  const stored = new Map<string, { status: string; revision?: number }>();
  for (const [organizationId, offerings] of Object.entries(seed)) {
    for (const { id, status, revision } of offerings) {
      stored.set(`${organizationId}/${id}`, { status, revision });
    }
  }
  const prices = new Map<string, { revision?: number }>();
  // `<organization>/<series>|<key>` → the offering holding the combination.
  const slots = new Map<string, string>();
  for (const [organizationId, seeded] of Object.entries(priceSeed)) {
    for (const { id, revision } of seeded) {
      prices.set(`${organizationId}/${id}`, { revision });
    }
  }
  const announced = new Set<string>();

  return {
    commitTransition: (organizationId, offering, from, event) =>
      Effect.sync(() => {
        const key = `${organizationId}/${String(offering.id)}`;
        const record = stored.get(key);
        if (record?.status !== from || record.revision !== offering.revision)
          return 'changed';
        record.status = offering.status;
        record.revision = (record.revision ?? 0) + 1;
        announced.add(`${organizationId}/${event.id}`);
        return 'committed';
      }),
    setSaleUnit: (organizationId, offering) =>
      Effect.sync(() => {
        const record = stored.get(`${organizationId}/${String(offering.id)}`);
        if (
          record === undefined ||
          !isNeverPublished(record.status as OfferingStatus) ||
          record.revision !== offering.revision
        )
          return 'changed';
        record.revision = (record.revision ?? 0) + 1;
        return 'committed';
      }),
    setStockSource: (organizationId, offering) =>
      Effect.sync(() => {
        const record = stored.get(`${organizationId}/${String(offering.id)}`);
        if (record === undefined || record.revision !== offering.revision)
          return 'changed';
        record.revision = (record.revision ?? 0) + 1;
        return 'committed';
      }),
    setVariant: (organizationId, offering, slot) =>
      Effect.sync(() => {
        const id = String(offering.id);
        const record = stored.get(`${organizationId}/${id}`);
        if (record === undefined || record.revision !== offering.revision)
          return 'changed';
        const claim =
          slot === undefined
            ? undefined
            : `${organizationId}/${slot.series}|${slot.key}`;
        const holder = claim === undefined ? undefined : slots.get(claim);
        if (holder !== undefined && holder !== id) return 'taken';
        for (const [key, owner] of slots)
          if (owner === id && key.startsWith(`${organizationId}/`))
            slots.delete(key);
        if (claim !== undefined) slots.set(claim, id);
        record.revision = (record.revision ?? 0) + 1;
        return 'committed';
      }),
    setPriceTiers: (organizationId, price) =>
      Effect.sync(() => {
        const record = prices.get(`${organizationId}/${String(price.id)}`);
        if (record === undefined || record.revision !== price.revision)
          return 'changed';
        record.revision = (record.revision ?? 0) + 1;
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

/** What the in-memory commands remember of one version. */
interface StoredVersion {
  readonly specKey: string | undefined;
  readonly version: number | undefined;
  lifecycleStatus: ProductSpecification['lifecycleStatus'];
  validTo?: Date;
  revision: number;
}

/** An organization's specification versions, as each one stands. */
export type SpecificationSeed = Readonly<
  Record<
    string,
    ReadonlyArray<
      Pick<
        ProductSpecification,
        'id' | 'specKey' | 'version' | 'lifecycleStatus'
      >
    >
  >
>;

/**
 * A {@link SpecificationCommands} held in memory, for the specs of whatever
 * consumes the port: a counter per organization, the records its keys wrote,
 * and where each version stands. It runs
 * `describeSpecificationCommandsContract`.
 */
export const makeInMemorySpecificationCommands = (
  seed: SpecificationSeed = {},
): SpecificationCommands => {
  const counters = new Map<string, number>();
  const byKey = new Map<string, ProductSpecification>();
  const versions = new Map<string, StoredVersion>();
  const at = (organizationId: string, id: unknown) =>
    `${organizationId}/${String(id)}`;
  for (const [organizationId, seeded] of Object.entries(seed)) {
    for (const { id, specKey, version, lifecycleStatus } of seeded) {
      versions.set(at(organizationId, id), {
        specKey,
        version,
        lifecycleStatus,
        revision: 1,
      });
    }
  }
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
        specification.specKey = specification.code;
        specification.revision = 1;
        versions.set(at(organizationId, specification.id), {
          specKey: specification.specKey,
          version: specification.version,
          lifecycleStatus: specification.lifecycleStatus,
          revision: 1,
        });
        if (scoped !== undefined) byKey.set(scoped, specification);
        return specification;
      }),
    move: (organizationId, specification, from) =>
      Effect.sync(() => {
        const stored = versions.get(at(organizationId, specification.id));
        if (
          stored?.lifecycleStatus !== from ||
          stored.revision !== specification.revision
        )
          return 'changed';
        if (specification.lifecycleStatus === 'active') {
          for (const [key, other] of versions) {
            if (
              key.startsWith(`${organizationId}/`) &&
              other !== stored &&
              other.specKey === stored.specKey &&
              other.lifecycleStatus === 'active'
            ) {
              other.lifecycleStatus = 'retired';
              other.validTo = specification.validFrom;
              other.revision += 1;
            }
          }
        }
        stored.lifecycleStatus = specification.lifecycleStatus;
        stored.revision += 1;
        specification.revision = stored.revision;
        return 'committed';
      }),
    revise: (organizationId, next) =>
      Effect.sync(() => {
        for (const [key, other] of versions) {
          if (
            key.startsWith(`${organizationId}/`) &&
            other.specKey === next.specKey &&
            other.version === next.version
          ) {
            return 'changed';
          }
        }
        next.revision = 1;
        versions.set(at(organizationId, next.id), {
          specKey: next.specKey,
          version: next.version,
          lifecycleStatus: next.lifecycleStatus,
          revision: 1,
        });
        return 'committed';
      }),
    remove: (organizationId, id) =>
      Effect.sync(() => {
        const key = at(organizationId, id);
        const stored = versions.get(key);
        if (stored === undefined) return 'absent';
        if (stored.lifecycleStatus !== 'in-design') return 'changed';
        versions.delete(key);
        return 'removed';
      }),
  };
};
